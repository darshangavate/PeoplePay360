"use strict";

const mongoose = require("mongoose");
const Payrun = require("./payrun.model");
const { PAYRUN_STATUSES } = Payrun;
const eligibilityService = require("./payrollEligibility.service");
const calculation = require("./payrollCalculation.service");
const employeeService = require("../employees/employee.service");
const contractResolution = require("../contracts/contractResolution.service");
const scheduleService = require("../schedules/schedule.service");
const attendanceService = require("../attendance/attendance.service");
const timeOffService = require("../timeOff/timeOff.service");
const salaryConfigService = require("../salaryConfig/salaryConfig.service");
const payslipService = require("../payslips/payslip.service");
const payslipEmailService = require("../notifications/payslipEmail.service");
const AppError = require("../../core/errors/AppError");
const paginate = require("../../core/http/pagination");

const expectedCodes = new Set([
  "CTR-004",
  "CTR-005",
  "CTR-006",
  "CTR-007",
  "PAY-004",
  "PAY-005",
  "PAY-006",
  "PAY-014",
  "PAY-015",
  "PSL-002",
]);
const blocking = (employee, code, message, details = {}) => ({
  employee,
  code,
  severity: "BLOCKING",
  message,
  details,
});

function createPayrunService({
  Model = Payrun,
  eligibility = eligibilityService,
  employees = employeeService,
  contracts = contractResolution,
  schedules = scheduleService,
  attendance = attendanceService,
  timeOff = timeOffService,
  salaryConfig = salaryConfigService,
  payslips = payslipService,
  emails = payslipEmailService,
  calculate = calculation,
  transaction = (work) => Model.db.transaction(work),
  now = () => new Date(),
} = {}) {
  async function getPayrun(id) {
    if (!mongoose.isObjectIdOrHexString(id))
      throw new AppError("RESOURCE_NOT_FOUND", "Payrun not found.", 404);
    const record = await Model.findById(id);
    if (!record)
      throw new AppError("RESOURCE_NOT_FOUND", "Payrun not found.", 404);
    return record;
  }
  async function loadSelected(ids) {
    const records = await employees.getEmployeesByIds(ids);
    if (records.length !== ids.length)
      throw new AppError(
        "RESOURCE_NOT_FOUND",
        "One or more selected Employees do not exist.",
        404,
      );
    return records;
  }
  async function createDraft(input, actor) {
    const scope = await eligibility.validateScope(input);
    const selected = await loadSelected(input.selectedEmployeeIds);
    await eligibility.assertEmployeesEligible({
      employeeList: selected,
      salaryStructureId: String(scope.salaryStructure._id),
      periodStart: scope.periodStart,
      periodEnd: scope.periodEnd,
    });
    return Model.create({
      name: input.name,
      salaryStructure: scope.salaryStructure._id,
      periodStart: scope.periodStart,
      periodEnd: scope.periodEnd,
      employees: input.selectedEmployeeIds,
      status: PAYRUN_STATUSES.DRAFT,
      createdBy: actor.id || actor._id,
    });
  }
  async function listPayruns({
    status,
    salaryStructureId,
    from,
    to,
    page,
    limit,
  }) {
    const filter = {};
    if (status) filter.status = status;
    if (salaryStructureId) filter.salaryStructure = salaryStructureId;
    if (from) filter.periodEnd = { $gte: from };
    if (to) filter.periodStart = { $lte: to };
    return paginate(
      Model,
      filter,
      { page, limit },
      { periodStart: -1, _id: -1 },
    );
  }
  async function updateDraft(id, input) {
    const record = await getPayrun(id);
    if (record.status !== PAYRUN_STATUSES.DRAFT)
      throw new AppError(
        "RESOURCE_CONFLICT",
        "Only a Draft Payrun can be updated.",
        409,
      );
    if (input.selectedEmployeeIds) {
      const selected = await loadSelected(input.selectedEmployeeIds);
      await eligibility.assertEmployeesEligible({
        employeeList: selected,
        salaryStructureId: String(record.salaryStructure),
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
      });
      record.employees = input.selectedEmployeeIds;
    }
    if (input.name !== undefined) record.name = input.name;
    return record.save();
  }
  async function deleteDraft(id) {
    const record = await getPayrun(id);
    if (record.status !== PAYRUN_STATUSES.DRAFT)
      throw new AppError(
        "RESOURCE_CONFLICT",
        "Only a Draft Payrun can be deleted.",
        409,
      );
    await Model.deleteOne({ _id: record._id });
    return { deleted: true };
  }
  function normalizeError(employeeId, error) {
    let code = error.code;
    if (code === "CTR-003") code = "PAY-004";
    if (code === "CTR-002") code = "PAY-005";
    if (
      String(code).startsWith("SAL-") ||
      String(code).startsWith("STR-") ||
      code === "RESOURCE_NOT_FOUND"
    )
      code = "PAY-014";
    if (!expectedCodes.has(code)) return null;
    const messages = {
      "PAY-004":
        "No applicable contract exists for the selected payroll period.",
      "PAY-005":
        "Multiple contracts are applicable for the selected payroll period.",
      "PAY-014": "Payroll calculation could not produce a valid result.",
    };
    return blocking(
      employeeId,
      code,
      messages[code] || error.message,
      error.details || {},
    );
  }
  function assertComputeAllowed(payrun) {
    if (
      [PAYRUN_STATUSES.DRAFT, PAYRUN_STATUSES.COMPUTED].includes(payrun.status)
    )
      return;
    if (payrun.status === PAYRUN_STATUSES.PAID) {
      throw new AppError("PAY-008", "Compute requested after PAID.", 409);
    }
    if (payrun.status === PAYRUN_STATUSES.VALIDATED) {
      throw new AppError(
        "RESOURCE_CONFLICT",
        "Validated Payrun cannot be recomputed.",
        409,
      );
    }
    throw new AppError(
      "RESOURCE_CONFLICT",
      "Payrun cannot be computed from its current status.",
      409,
    );
  }
  async function computeEmployee(payrun, employeeId, structure, rules) {
    const normalizedEmployeeId = String(employeeId);
    const normalizedSalaryStructureId = String(payrun.salaryStructure);
    try {
      const employee = await employees.getEmployee(normalizedEmployeeId);
      if (employee.employmentStatus !== "ACTIVE")
        throw new AppError("PAY-015", "Employee is inactive.", 422, "BLOCKING");
      const contract = await contracts.resolveApplicableContract({
        employeeId: normalizedEmployeeId,
        periodStart: payrun.periodStart,
        periodEnd: payrun.periodEnd,
        salaryStructureId: normalizedSalaryStructureId,
      });
      if (!contract.salaryStructure)
        throw new AppError(
          "CTR-006",
          "Applicable contract has no Salary Structure.",
          422,
          "BLOCKING",
        );
      const duplicate = await payslips.findDuplicateOutsidePayrun({
        employeeId: normalizedEmployeeId,
        salaryStructureId: normalizedSalaryStructureId,
        periodStart: payrun.periodStart,
        periodEnd: payrun.periodEnd,
        payrunId: String(payrun._id),
      });
      if (duplicate)
        throw new AppError(
          "PAY-006",
          "A Payslip already exists for this employee and payroll scope.",
          422,
          "BLOCKING",
        );
      const schedule = await schedules.getSchedule(
        String(contract.workingSchedule),
      );
      const [attendanceRecords, leaveRequests] = await Promise.all([
        attendance.findForPayroll(
          normalizedEmployeeId,
          payrun.periodStart,
          payrun.periodEnd,
        ),
        timeOff.findApprovedForPayroll(
          normalizedEmployeeId,
          payrun.periodStart,
          payrun.periodEnd,
        ),
      ]);
      const expected = calculate.calculateExpectedTime(
        payrun.periodStart,
        payrun.periodEnd,
        schedule,
      );
      const leave = calculate.calculateUnpaidLeave(leaveRequests, expected);
      const attendanceSummary =
        calculate.summarizeAttendance(attendanceRecords);
      const payrollContext = calculate.buildPayrollContext({
        contract,
        expected,
        leave,
        attendance: attendanceSummary,
      });
      const computed = calculate.executeSalaryRules(
        rules,
        payrollContext,
        salaryConfig.calculateRules,
      );
      const warnings = calculate.buildWarnings(
        employee,
        attendanceSummary,
        expected,
      );
      return {
        success: true,
        employeeId: normalizedEmployeeId,
        snapshot: {
          payrun: payrun._id,
          employee: employee._id,
          contract: contract._id,
          salaryStructure: payrun.salaryStructure,
          periodStart: payrun.periodStart,
          periodEnd: payrun.periodEnd,
          status: "COMPUTED",
          workedDays: payrollContext.WORKED_DAYS,
          payrollContext: {
            expectedWorkingDays: payrollContext.EXPECTED_WORKING_DAYS,
            expectedWorkingMinutes: payrollContext.EXPECTED_WORKING_MINUTES,
            workedDays: payrollContext.WORKED_DAYS,
            unpaidLeaveDays: payrollContext.UNPAID_LEAVE_DAYS,
            unpaidLeaveHours: payrollContext.UNPAID_LEAVE_HOURS,
            attendanceWorkedHours: payrollContext.ATTENDANCE_WORKED_HOURS,
            presentCount: payrollContext.presentCount,
            lateCount: payrollContext.lateCount,
            overtimeCount: payrollContext.overtimeCount,
            absentCount: payrollContext.absentCount,
            missingCheckoutCount: payrollContext.missingCheckoutCount,
            manualCorrectionCount: payrollContext.manualCorrectionCount,
            dailyRate: payrollContext.DAILY_RATE,
          },
          employeeSnapshot: {
            employeeId: employee.employeeId,
            name: `${employee.firstName} ${employee.lastName}`.trim(),
            departmentId: employee.department,
            jobPosition: employee.jobPosition,
          },
          contractSnapshot: {
            contractId: contract._id,
            wage: contract.wage,
            startDate: contract.startDate,
            endDate: contract.endDate,
            departmentId: contract.department,
            jobPosition: contract.jobPosition,
            workingScheduleId: contract.workingSchedule,
          },
          salaryStructureSnapshot: {
            salaryStructureId: structure._id,
            name: structure.name,
            code: structure.code,
          },
          ...computed,
          warnings,
        },
        warnings,
      };
    } catch (error) {
      const issue = normalizeError(employeeId, error);
      if (!issue) throw error;
      return { success: false, employeeId, issue };
    }
  }
  async function computePayrun(id) {
    const payrun = await getPayrun(id);
    assertComputeAllowed(payrun);
    const salaryStructureId = String(payrun.salaryStructure);
    const structure = await salaryConfig.getStructure(salaryStructureId);
    const rules = await salaryConfig.getOrderedActiveRules(salaryStructureId);
    const results = [];
    for (const employeeId of payrun.employees)
      results.push(await computeEmployee(payrun, employeeId, structure, rules));
    const issues = [];
    for (const result of results) {
      if (result.success)
        for (const warning of result.warnings)
          issues.push({ employee: result.employeeId, ...warning });
      else issues.push(result.issue);
    }
    await transaction(async (session) => {
      for (const result of results) {
        if (result.success)
          await payslips.upsertComputedPayslip(result.snapshot, session);
        else
          await payslips.removeUnfinalizedPayslipForEmployee(
            payrun._id,
            result.employeeId,
            session,
          );
      }
      payrun.warnings = issues;
      payrun.status = PAYRUN_STATUSES.COMPUTED;
      payrun.computedAt = now();
      await payrun.save({ session });
    });
    return {
      payrun,
      summary: {
        successfulPayslips: results.filter((result) => result.success).length,
        blockingEmployees: results.filter((result) => !result.success).length,
        warnings: issues.filter((issue) => issue.severity === "WARNING").length,
      },
      issues,
    };
  }
  function assertPayslipSet(
    payrun,
    records,
    requiredStatus,
    errorCode,
    message,
    statusCode = 422,
  ) {
    const selected = new Set(payrun.employees.map(String));
    const actual = records.map((record) => String(record.employee));
    if (
      selected.size !== payrun.employees.length ||
      records.length !== payrun.employees.length ||
      new Set(actual).size !== actual.length ||
      actual.some((id) => !selected.has(id))
    ) {
      throw new AppError(errorCode, message, statusCode, "ERROR");
    }
    if (records.some((record) => record.status !== requiredStatus)) {
      throw new AppError(errorCode, message, statusCode, "ERROR");
    }
  }
  async function validatePayrun(id, actor) {
    const payrun = await getPayrun(id);
    if (payrun.status !== PAYRUN_STATUSES.COMPUTED) {
      throw new AppError("PAY-011", "Validate requested before COMPUTED.", 422);
    }
    await transaction(async (session) => {
      if (
        (payrun.warnings || []).some((issue) => issue.severity === "BLOCKING")
      ) {
        throw new AppError(
          "PAY-007",
          "Blocking payroll issues must be resolved before validation.",
          422,
        );
      }
      const records = await payslips.findForPayrun(payrun._id, session);
      assertPayslipSet(
        payrun,
        records,
        PAYRUN_STATUSES.COMPUTED,
        "PAY-007",
        "Every selected Employee must have exactly one computed Payslip.",
      );
      if (records.some((record) => !Number.isFinite(record.netSalary))) {
        throw new AppError(
          "PSL-002",
          "Net Salary calculation is missing.",
          422,
          "BLOCKING",
        );
      }
      await payslips.updateStatusForPayrun({
        payrunId: payrun._id,
        fromStatus: PAYRUN_STATUSES.COMPUTED,
        toStatus: PAYRUN_STATUSES.VALIDATED,
        session,
      });
      payrun.status = PAYRUN_STATUSES.VALIDATED;
      payrun.validatedAt = now();
      payrun.validatedBy = actor.id || actor._id;
      await payrun.save({ session });
    });
    return payrun;
  }
  async function markPayrunPaid(id, actor) {
    const payrun = await getPayrun(id);
    if (payrun.status !== PAYRUN_STATUSES.VALIDATED) {
      throw new AppError(
        "PAY-010",
        "Mark Paid requested before VALIDATED.",
        422,
      );
    }
    await transaction(async (session) => {
      const records = await payslips.findForPayrun(payrun._id, session);
      assertPayslipSet(
        payrun,
        records,
        PAYRUN_STATUSES.VALIDATED,
        "PAY-010",
        "All Payslips must be validated before the Payrun can be marked paid.",
      );
      await payslips.updateStatusForPayrun({
        payrunId: payrun._id,
        fromStatus: PAYRUN_STATUSES.VALIDATED,
        toStatus: PAYRUN_STATUSES.PAID,
        session,
      });
      payrun.status = PAYRUN_STATUSES.PAID;
      payrun.paidAt = now();
      payrun.paidBy = actor.id || actor._id;
      await payrun.save({ session });
    });
    return payrun;
  }
  async function sendPayslips(id) {
    const payrun = await getPayrun(id);
    if (payrun.status !== PAYRUN_STATUSES.PAID) {
      throw new AppError(
        "RESOURCE_CONFLICT",
        "Only Paid Payruns can send Payslips.",
        409,
      );
    }
    const records = await payslips.findForPayrun(payrun._id);
    assertPayslipSet(
      payrun,
      records,
      PAYRUN_STATUSES.PAID,
      "RESOURCE_CONFLICT",
      "Every selected Employee must have exactly one Paid Payslip.",
      409,
    );
    const results = [];
    for (const payslip of records) {
      let employee;
      try {
        employee = await employees.getEmployee(payslip.employee);
        if (!employee.email) {
          results.push({
            employeeId: String(payslip.employee),
            employeeCode: payslip.employeeSnapshot?.employeeId,
            status: "FAILED",
            reason: "Employee email is missing.",
          });
          continue;
        }
        const attachment = await payslips.generatePdfForRecord(payslip, payrun);
        const period = `${new Date(payslip.periodStart).toISOString().slice(0, 10)} to ${new Date(payslip.periodEnd).toISOString().slice(0, 10)}`;
        await emails.sendPayslip({
          to: employee.email,
          subject: `Payslip - ${period}`,
          filename: attachment.filename,
          pdf: attachment.buffer,
        });
        results.push({
          employeeId: String(employee._id),
          employeeCode: employee.employeeId,
          status: "SENT",
        });
      } catch (error) {
        results.push({
          employeeId: String(payslip.employee),
          employeeCode:
            employee?.employeeId || payslip.employeeSnapshot?.employeeId,
          status: "FAILED",
          reason:
            error.code === "PSL-005"
              ? "Payslip PDF generation failed."
              : "Email delivery failed.",
        });
      }
    }
    return {
      payrunId: String(payrun._id),
      sent: results.filter((result) => result.status === "SENT").length,
      failed: results.filter((result) => result.status === "FAILED").length,
      results,
    };
  }
  async function findForReporting({ employeeIds, from, to } = {}) {
    const filter = {};
    if (employeeIds) filter.employees = { $in: employeeIds };
    if (from) filter.periodEnd = { $gte: from };
    if (to) filter.periodStart = { $lte: to };
    return Model.find(filter);
  }
  const listPayslips = (id) =>
    payslips.listPayslips({ payrunId: id, page: 1, limit: 100 });
  return {
    createDraft,
    listPayruns,
    getPayrun,
    updateDraft,
    deleteDraft,
    computePayrun,
    validatePayrun,
    markPayrunPaid,
    sendPayslips,
    findForReporting,
    listPayslips,
  };
}

module.exports = { createPayrunService, ...createPayrunService() };

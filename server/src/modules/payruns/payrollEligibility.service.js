"use strict";
const employeeService = require("../employees/employee.service");
const contractResolution = require("../contracts/contractResolution.service");
const salaryConfigService = require("../salaryConfig/salaryConfig.service");
const payslipService = require("../payslips/payslip.service");
const AppError = require("../../core/errors/AppError");
const errors = require("../../core/errors/errorCodes");
const error = (def, details = {}) =>
  new AppError(def.code, def.message, def.statusCode, "ERROR", details);
const failure = (def, message = def.message) => ({
  eligible: false,
  code: def.code,
  reason: message,
});
const structureId = (value) => String(value?._id ?? value);
const employeeSummary = (employee) => ({
  _id: employee._id,
  employeeId: employee.employeeId,
  name: `${employee.firstName} ${employee.lastName}`.trim(),
  department: employee.department,
  employeeType: employee.employeeType,
});

function createPayrollEligibilityService({
  employees = employeeService,
  contracts = contractResolution,
  salaryConfig = salaryConfigService,
  payslips = payslipService,
} = {}) {
  async function validateScope({ salaryStructureId, periodStart, periodEnd }) {
    if (!salaryStructureId) throw error(errors.PAYRUN_STRUCTURE_INVALID);
    if (periodStart > periodEnd) throw error(errors.PAYRUN_INVALID_PERIOD);
    let structure;
    try {
      structure = await salaryConfig.getStructure(salaryStructureId);
    } catch (e) {
      if (e.code === "RESOURCE_NOT_FOUND")
        throw error(errors.PAYRUN_STRUCTURE_INVALID);
      throw e;
    }
    if (!structure.active) throw error(errors.PAYRUN_STRUCTURE_INVALID);
    await salaryConfig.getOrderedActiveRules(salaryStructureId);
    return { salaryStructure: structure, periodStart, periodEnd };
  }
  async function evaluateEmployeeEligibility({
    employee,
    salaryStructureId,
    periodStart,
    periodEnd,
  }) {
    if (employee.employmentStatus !== "ACTIVE")
      return failure(errors.PAYRUN_EMPLOYEE_INACTIVE);
    const matches = await contracts.findApplicableContracts({
      employeeId: employee._id,
      periodStart,
      periodEnd,
    });
    if (!matches.length) return failure(errors.PAYRUN_NO_CONTRACT);
    if (matches.length > 1) return failure(errors.PAYRUN_MULTIPLE_CONTRACTS);
    const contract = matches[0];
    if (!contract.salaryStructure)
      return failure(
        errors.CONTRACT_STRUCTURE_MISSING,
        "Applicable contract has no Salary Structure.",
      );
    if (structureId(contract.salaryStructure) !== String(salaryStructureId))
      return failure(errors.CONTRACT_STRUCTURE_MISMATCH);
    if (
      await payslips.existsForPayrollScope({
        employeeId: employee._id,
        salaryStructureId,
        periodStart,
        periodEnd,
      })
    )
      return failure(errors.PAYRUN_DUPLICATE_PAYSLIP);
    return { eligible: true, employee, contract };
  }
  async function previewEligibility(input) {
    const scope = await validateScope(input);
    const candidates = await employees.findPayrollCandidates({
      departmentId: input.departmentId,
      employeeType: input.employeeType,
    });
    const eligibleEmployees = [];
    const ineligibleEmployees = [];
    for (const employee of candidates) {
      const result = await evaluateEmployeeEligibility({
        employee,
        salaryStructureId: structureId(scope.salaryStructure),
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
      });
      const summary = employeeSummary(employee);
      if (result.eligible)
        eligibleEmployees.push({
          ...summary,
          contractId: result.contract._id,
          wage: result.contract.wage,
        });
      else
        ineligibleEmployees.push({
          employeeId: employee._id,
          employeeCode: employee.employeeId,
          name: summary.name,
          reasonCode: result.code,
          message: result.reason,
        });
    }
    return {
      scope: {
        salaryStructure: scope.salaryStructure,
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
      },
      eligibleEmployees,
      ineligibleEmployees,
      counts: {
        eligible: eligibleEmployees.length,
        excluded: ineligibleEmployees.length,
      },
    };
  }
  async function assertEmployeesEligible({
    employeeList,
    salaryStructureId,
    periodStart,
    periodEnd,
  }) {
    const invalid = [];
    for (const employee of employeeList) {
      const result = await evaluateEmployeeEligibility({
        employee,
        salaryStructureId,
        periodStart,
        periodEnd,
      });
      if (!result.eligible)
        invalid.push({
          employeeId: employee._id,
          employeeCode: employee.employeeId,
          code: result.code,
          reason: result.reason,
        });
    }
    if (invalid.length)
      throw new AppError(
        invalid[0].code,
        "One or more selected employees are no longer eligible for this Payrun.",
        422,
        "ERROR",
        { employees: invalid },
      );
    return true;
  }
  return {
    validateScope,
    evaluateEmployeeEligibility,
    previewEligibility,
    assertEmployeesEligible,
  };
}
module.exports = {
  createPayrollEligibilityService,
  ...createPayrollEligibilityService(),
};

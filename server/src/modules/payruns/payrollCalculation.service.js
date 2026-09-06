"use strict";

const AppError = require("../../core/errors/AppError");
const formulas = require("../salaryConfig/formula.service");
const DAY = 86400000;
const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const dateOnly = (value) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

function scheduleMap(schedule) {
  return new Map(
    schedule.workingDays.map((line) => [
      line.day,
      line.isWorkingDay ? round(line.dailyHours * 60) : 0,
    ]),
  );
}
function scheduledDates(periodStart, periodEnd, schedule) {
  const map = scheduleMap(schedule);
  const result = [];
  for (
    let date = dateOnly(periodStart);
    date <= periodEnd;
    date = new Date(date.getTime() + DAY)
  ) {
    const minutes = map.get(DAY_NAMES[date.getUTCDay()]) || 0;
    if (minutes > 0) result.push({ date: new Date(date), minutes });
  }
  return result;
}
function calculateExpectedTime(periodStart, periodEnd, schedule) {
  const dates = scheduledDates(periodStart, periodEnd, schedule);
  return {
    dates,
    expectedWorkingDays: dates.length,
    expectedWorkingMinutes: dates.reduce((sum, day) => sum + day.minutes, 0),
  };
}
function calculateUnpaidLeave(requests, expected) {
  let equivalentDays = 0;
  let minutes = 0;
  for (const request of requests) {
    const type = request.timeOffType;
    if (!type || type.payrollTreatment !== "UNPAID_DEDUCTION") continue;
    const covered = expected.dates.filter(
      (day) =>
        day.date <= request.endDate &&
        new Date(day.date.getTime() + DAY - 1) >= request.startDate,
    );
    if (type.unit === "DAYS") {
      equivalentDays += covered.length;
      minutes += covered.reduce((sum, day) => sum + day.minutes, 0);
    } else {
      let remaining = Math.max(0, Number(request.duration) * 60);
      for (const day of covered) {
        const amount = Math.min(day.minutes, remaining);
        equivalentDays += amount / day.minutes;
        minutes += amount;
        remaining -= amount;
        if (remaining <= 0) break;
      }
    }
  }
  return {
    unpaidLeaveEquivalentDays: round(
      Math.min(expected.expectedWorkingDays, equivalentDays),
    ),
    unpaidLeaveMinutes: round(minutes),
  };
}
function summarizeAttendance(records) {
  const summary = {
    attendanceRecordCount: records.length,
    attendanceWorkedMinutes: 0,
    presentCount: 0,
    lateCount: 0,
    overtimeCount: 0,
    absentCount: 0,
    missingCheckoutCount: 0,
    manualCorrectionCount: 0,
  };
  const keys = {
    PRESENT: "presentCount",
    LATE: "lateCount",
    OVERTIME: "overtimeCount",
    ABSENT: "absentCount",
    MISSING_CHECKOUT: "missingCheckoutCount",
    OPEN: "missingCheckoutCount",
  };
  for (const record of records) {
    summary.attendanceWorkedMinutes += Number(record.workedMinutes) || 0;
    if (keys[record.status]) summary[keys[record.status]]++;
    if (record.manualEdit) summary.manualCorrectionCount++;
  }
  summary.attendanceWorkedMinutes = round(summary.attendanceWorkedMinutes);
  return summary;
}
function buildWarnings(employee, attendance, expected) {
  const warnings = [];
  const bank = employee.bankDetails;
  if (
    !bank ||
    !bank.accountHolderName ||
    !bank.accountNumber ||
    !bank.bankName ||
    !bank.ifscCode
  )
    warnings.push({
      code: "PAY-012",
      severity: "WARNING",
      message: "Employee bank details are missing or incomplete.",
      details: {},
    });
  const missingAttendanceCount = Math.max(
    0,
    expected.expectedWorkingDays - attendance.attendanceRecordCount,
  );
  if (
    attendance.missingCheckoutCount ||
    attendance.manualCorrectionCount ||
    attendance.absentCount ||
    missingAttendanceCount
  )
    warnings.push({
      code: "PAY-013",
      severity: "WARNING",
      message: "Attendance exception exists for the payroll period.",
      details: {
        missingCheckoutCount: attendance.missingCheckoutCount,
        manualCorrectionCount: attendance.manualCorrectionCount,
        absentCount: attendance.absentCount,
        missingAttendanceCount,
      },
    });
  return warnings;
}
function buildPayrollContext({ contract, expected, leave, attendance }) {
  const wage = Number(contract.wage);
  if (
    contract.wage === null ||
    contract.wage === undefined ||
    !Number.isFinite(wage)
  )
    throw new AppError(
      "CTR-004",
      "Contract wage is required for wage-based payroll.",
      422,
      "BLOCKING",
    );
  if (wage < 0)
    throw new AppError(
      "CTR-005",
      "Contract wage cannot be negative.",
      422,
      "BLOCKING",
    );
  const workedDays = round(
    Math.max(0, expected.expectedWorkingDays - leave.unpaidLeaveEquivalentDays),
  );
  return {
    CONTRACT_WAGE: wage,
    EXPECTED_WORKING_DAYS: expected.expectedWorkingDays,
    EXPECTED_WORKING_MINUTES: expected.expectedWorkingMinutes,
    UNPAID_LEAVE_DAYS: leave.unpaidLeaveEquivalentDays,
    UNPAID_LEAVE_HOURS: round(leave.unpaidLeaveMinutes / 60),
    WORKED_DAYS: workedDays,
    DAILY_RATE: expected.expectedWorkingDays
      ? round(wage / expected.expectedWorkingDays)
      : null,
    ATTENDANCE_WORKED_HOURS: round(attendance.attendanceWorkedMinutes / 60),
    ...attendance,
  };
}
function executeSalaryRules(
  rules,
  context,
  calculateRules = formulas.calculateRules,
) {
  const needsDailyRate = rules.some((rule) =>
    formulas.dependencies(rule).includes("DAILY_RATE"),
  );
  if (needsDailyRate && !context.EXPECTED_WORKING_DAYS)
    throw new AppError(
      "PAY-014",
      "Working Schedule produces zero expected working days for the payroll period.",
      422,
      "BLOCKING",
    );
  const calculated = calculateRules(rules, context, round);
  const byCode = new Map(rules.map((rule) => [rule.code, rule]));
  const salaryLines = calculated.map((value) => {
    const rule = byCode.get(value.code);
    return {
      ruleId: rule._id,
      name: rule.name,
      code: rule.code,
      category: rule.category,
      sequence: rule.sequence,
      calculationType: rule.calculationType,
      calculationSnapshot: {
        fixedAmount: rule.fixedAmount,
        percentage: rule.percentage,
        percentageBase: rule.percentageBase,
        formula: rule.formula,
      },
      amount: round(value.amount),
    };
  });
  const sum = (category) =>
    round(
      salaryLines
        .filter((line) => line.category === category)
        .reduce((total, line) => total + line.amount, 0),
    );
  const gross = salaryLines.filter((line) => line.category === "GROSS");
  const net = salaryLines.filter((line) => line.category === "NET");
  if (gross.length > 1 || net.length > 1)
    throw new AppError(
      "PAY-014",
      "Salary configuration has ambiguous Gross or Net results.",
      422,
      "BLOCKING",
    );
  if (!net.length)
    throw new AppError(
      "PSL-002",
      "Net Salary calculation is missing.",
      422,
      "BLOCKING",
    );
  const basicSalary = sum("BASIC");
  const totalAllowances = sum("ALLOWANCE");
  const totalDeductions = sum("DEDUCTION");
  return {
    salaryLines,
    basicSalary,
    totalAllowances,
    grossSalary: gross.length
      ? gross[0].amount
      : round(basicSalary + totalAllowances),
    totalDeductions,
    netSalary: net[0].amount,
  };
}
module.exports = {
  round,
  calculateExpectedTime,
  calculateUnpaidLeave,
  summarizeAttendance,
  buildWarnings,
  buildPayrollContext,
  executeSalaryRules,
};

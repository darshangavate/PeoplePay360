'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createStore = require('../../fixtures/configurationStore');
const { createAttendanceService, determineStatus } = require('../../../src/modules/attendance/attendance.service');
const { createLeaveService } = require('../../../src/modules/timeOff/leave.service');
const createScheduleAccess = require('../../../src/core/utils/scheduledTime');
const AttendanceModel = require('../../../src/modules/attendance/attendance.model');
const employeeId = 'a'.repeat(24);
const otherId = 'b'.repeat(24);
const actor = { id: 'c'.repeat(24), role: 'EMPLOYEE', status: 'ACTIVE' };
const hr = { id: 'd'.repeat(24), role: 'HR_MANAGER', status: 'ACTIVE' };
const rejectsCode = (work, code) => assert.rejects(work, error => error.code === code);
const employee = id => ({ id, status: 'ACTIVE' });
const employees = {
  getEmployee: async id => employee(id),
  getEmployeeForUser: async () => employee(employeeId),
  lockEmployeeForLeave: async id => employee(id),
  getEmployeeIdsByDepartment: async () => [employeeId],
};
const schedules = {
  getAttendanceContext: async (id, at) => ({ date: at.toISOString().slice(0, 10), start: '2026-09-07T09:00:00Z', end: '2026-09-07T18:00:00Z', breakMinutes: 60 }),
  getWorkingIntervals: async () => [
    { date: '2026-09-04', start: '2026-09-04T09:00:00Z', end: '2026-09-04T12:00:00Z' },
    { date: '2026-09-04', start: '2026-09-04T13:00:00Z', end: '2026-09-04T18:00:00Z' },
    { date: '2026-09-07', start: '2026-09-07T09:00:00Z', end: '2026-09-07T12:00:00Z' },
    { date: '2026-09-07', start: '2026-09-07T13:00:00Z', end: '2026-09-07T18:00:00Z' },
    { date: '2026-09-08', start: '2026-09-08T09:00:00Z', end: '2026-09-08T18:00:00Z' },
  ],
};
function attendanceFixture() {
  const store = createStore();
  const Model = store.model(['employee'], record => record.status === 'OPEN');
  let clock = new Date('2026-09-07T09:00:00Z');
  const service = createAttendanceService({ Model, employees, schedules, now: () => clock });
  return { service, Model, setClock: value => { clock = new Date(value); } };
}
async function leaveFixture({ amount = 3, requiresAllocation = true, transaction } = {}) {
  const store = createStore();
  const Type = store.model(['code']);
  const Allocation = store.model([]);
  const Request = store.model([]);
  const type = await Type.create({ code: 'CL', unit: 'DAYS', active: true, requiresAllocation });
  const service = createLeaveService({ Type, Allocation, Request, employees, schedules, transaction: transaction || store.transaction, now: () => new Date('2026-09-01T00:00:00Z') });
  const allocation = await service.createAllocation({ employeeId, timeOffTypeId: type._id, allocatedAmount: amount, validFrom: '2026-01-01', validUntil: '2026-12-31' }, hr);
  const body = { timeOffTypeId: type._id, startDate: '2026-09-04', endDate: '2026-09-07', reason: 'Personal leave' };
  return { service, Allocation, Request, Type, allocation, body, store };
}

test('Attendance: duplicate open check-in, checkout prerequisites and time validation', async () => {
  const { service, setClock, Model } = attendanceFixture();
  await rejectsCode(() => service.checkOut(actor), 'ATT-001');
  await rejectsCode(() => service.checkIn(actor, { employeeId: otherId }), 'VALIDATION_ERROR');
  const record = await service.checkIn(actor);
  assert.equal(record.employee, employeeId);
  assert.equal(record.status, 'OPEN');
  await rejectsCode(() => service.checkIn(actor), 'ATT-003');
  await rejectsCode(() => service.checkOut(actor), 'ATT-002');
  setClock('2026-09-07T18:00:00Z');
  const closed = await service.checkOut(actor);
  assert.equal(closed.workedMinutes, 540); // Scheduled break is NOT subtracted.
  assert.equal(closed.status, 'OVERTIME');
  await rejectsCode(() => service.checkIn(actor), 'ATT-003');
  assert.equal(Model.rows.size, 1);
  assert.ok(AttendanceModel.schema.indexes().some(([keys, options]) => options.unique && options.partialFilterExpression?.status === 'OPEN' && keys.employee === 1));
  assert.ok(AttendanceModel.schema.indexes().some(([keys, options]) => options.unique && options.name === 'one_attendance_per_employee_per_day' && keys.employee === 1 && keys.date === 1));
});

test('Attendance: check-in is allowed only within the Employee assigned schedule window', async () => {
  const beforeShift = attendanceFixture();
  beforeShift.setClock('2026-09-07T08:59:59Z');
  await assert.rejects(() => beforeShift.service.checkIn(actor), error => (
    error.code === 'VALIDATION_ERROR' &&
    error.statusCode === 422 &&
    error.message === 'Check-in is allowed only during scheduled working hours.'
  ));
  assert.equal(beforeShift.Model.rows.size, 0);

  const afterShift = attendanceFixture();
  afterShift.setClock('2026-09-07T18:00:01Z');
  await assert.rejects(() => afterShift.service.checkIn(actor), error => (
    error.code === 'VALIDATION_ERROR' &&
    error.statusCode === 422 &&
    error.message === 'Check-in is allowed only during scheduled working hours.'
  ));
  assert.equal(afterShift.Model.rows.size, 0);
});

test('Attendance: early checkout requires explicit confirmation', async () => {
  const { service, setClock, Model } = attendanceFixture();
  const record = await service.checkIn(actor);
  setClock('2026-09-07T17:00:00Z');
  await assert.rejects(() => service.checkOut(actor), error => (
    error.code === 'RESOURCE_CONFLICT' &&
    error.statusCode === 409 &&
    error.details.confirmationRequired === true &&
    error.details.scheduledEnd === '2026-09-07T18:00:00.000Z'
  ));
  assert.equal((await service.getAttendance(record._id, actor)).status, 'OPEN');
  const closed = await service.checkOut(actor, { confirmEarlyCheckout: true });
  assert.equal(closed.status, 'PRESENT');
  assert.equal(closed.workedMinutes, 480);
  assert.equal(Model.rows.size, 1);
});

test('Attendance: HR correction recalculates minutes and records audit data; ownership enforced', async () => {
  const { service, setClock } = attendanceFixture();
  const record = await service.checkIn(actor);
  setClock('2026-09-07T18:00:00Z');
  await service.checkOut(actor);
  const body = { checkIn: '2026-09-07T09:30:00Z', checkOut: '2026-09-07T18:30:00Z', correctionReason: 'Confirmed times' };
  await rejectsCode(() => service.correctAttendance(record._id, body, actor), 'ATT-005');
  const changed = await service.correctAttendance(record._id, body, hr);
  assert.equal(changed.workedMinutes, 540);
  assert.equal(changed.status, 'LATE');
  assert.equal(changed.editedBy, hr.id);
  assert.equal(changed.manualEdit, true);
  assert.equal(changed.correctionReason, 'Confirmed times');
  const foreign = await service.createManualAttendance({ employeeId: otherId, checkIn: '2026-09-07T09:00:00Z', checkOut: '2026-09-07T17:00:00Z' }, hr);
  await rejectsCode(() => service.getAttendance(foreign._id, actor), 'AUTH-003');
});

test('Attendance: missing checkout wins; late takes precedence over overtime', async () => {
  const schedule = { start: new Date('2026-09-07T09:00:00Z'), expectedMinutes: 480 };
  assert.equal(determineStatus(schedule.start, null, schedule), 'MISSING_CHECKOUT');
  assert.equal(determineStatus(new Date('2026-09-07T09:30:00Z'), new Date('2026-09-07T19:00:00Z'), schedule), 'LATE');
  assert.equal(determineStatus(schedule.start, new Date('2026-09-07T17:00:00Z'), schedule), 'PRESENT');
  const { service, setClock, Model } = attendanceFixture();
  const record = await service.checkIn(actor);
  // The in-memory adapter supplies the schema's null default explicitly.
  Model.rows.get(record._id).checkOut = null;
  setClock('2026-09-08T01:00:00Z');
  await service.markMissingCheckouts(new Date('2026-09-08T00:00:00Z'));
  assert.equal((await service.getAttendance(record._id, hr)).status, 'MISSING_CHECKOUT');
});

test('Leave duration uses scheduled days, skips weekends, and clips working hours around breaks', async () => {
  const access = createScheduleAccess(schedules);
  assert.equal(await access.duration(employeeId, new Date('2026-09-04T00:00:00Z'), new Date('2026-09-07T23:59:59.999Z'), 'DAYS'), 2);
  assert.equal(await access.duration(employeeId, new Date('2026-09-04T00:00:00Z'), new Date('2026-09-07T23:59:59.999Z'), 'HOURS'), 16);
  assert.equal(await access.duration(employeeId, new Date('2026-09-04T11:00:00Z'), new Date('2026-09-04T14:00:00Z'), 'HOURS'), 2);
  await rejectsCode(() => access.duration(employeeId, new Date('2026-09-05T00:00:00Z'), new Date('2026-09-06T23:59:59.999Z'), 'DAYS'), 'VALIDATION_ERROR');
});

test('Leave allocations start DRAFT; only approved balances are usable; self identity is enforced', async () => {
  const { service, allocation, body } = await leaveFixture();
  assert.equal(allocation.status, 'DRAFT');
  assert.equal(allocation.takenAmount, 0);
  assert.equal(allocation.remainingAmount, allocation.allocatedAmount);
  await rejectsCode(() => service.createRequest(body, actor), 'LEV-002');
  await rejectsCode(() => service.createRequest({ ...body, employeeId: otherId }, actor), 'VALIDATION_ERROR');
  await service.approveAllocation(allocation._id, hr);
  const request = await service.createRequest(body, actor);
  assert.equal(request.employee, employeeId);
  assert.equal(request.duration, 2);
  assert.equal(request.status, 'PENDING');
});

test('Leave overlaps with PENDING and APPROVED requests are blocked', async () => {
  const { service, allocation, body } = await leaveFixture();
  await service.approveAllocation(allocation._id, hr);
  const request = await service.createRequest(body, actor);
  await rejectsCode(() => service.createRequest(body, actor), 'LEV-004');
  await service.approveRequest(request._id, hr);
  await rejectsCode(() => service.createRequest(body, actor), 'LEV-004');
});

test('Leave approval consumes balance exactly once and refuses invalid final-state transitions', async () => {
  const { service, allocation, body } = await leaveFixture();
  await service.approveAllocation(allocation._id, hr);
  const request = await service.createRequest(body, actor);
  await service.approveRequest(request._id, hr);
  await rejectsCode(() => service.approveRequest(request._id, hr), 'RESOURCE_CONFLICT');
  await rejectsCode(() => service.refuseRequest(request._id, {}, hr), 'RESOURCE_CONFLICT');
  const balance = await service.getAllocation(allocation._id, hr);
  assert.equal(balance.takenAmount, 2);
  assert.equal(balance.remainingAmount, 1);
  await rejectsCode(() => service.cancelAllocation(allocation._id, hr), 'RESOURCE_CONFLICT');
  await rejectsCode(() => service.deleteAllocation(allocation._id, hr), 'RESOURCE_CONFLICT');
});

test('Leave insufficient balance is rejected both at request creation and approval', async () => {
  const fixture = await leaveFixture({ amount: 1 });
  await fixture.service.approveAllocation(fixture.allocation._id, hr);
  await rejectsCode(() => fixture.service.createRequest(fixture.body, actor), 'LEV-003');
  const { service, allocation, body } = await leaveFixture({ amount: 2 });
  await service.approveAllocation(allocation._id, hr);
  const first = await service.createRequest(body, actor);
  const second = await service.createRequest({ ...body, startDate: '2026-09-08', endDate: '2026-09-08' }, actor);
  await service.approveRequest(second._id, hr);
  await rejectsCode(() => service.approveRequest(first._id, hr), 'LEV-003');
  assert.equal((await service.getRequest(first._id, hr)).status, 'PENDING');
  assert.equal((await service.getAllocation(allocation._id, hr)).takenAmount, 1);
});

test('Leave refusal never consumes balance and REFUSED is final', async () => {
  const { service, allocation, body } = await leaveFixture();
  await service.approveAllocation(allocation._id, hr);
  const request = await service.createRequest(body, actor);
  const refused = await service.refuseRequest(request._id, { comment: 'Staffing' }, hr);
  assert.equal(refused.status, 'REFUSED');
  assert.equal(refused.decisionComment, 'Staffing');
  assert.equal((await service.getAllocation(allocation._id, hr)).takenAmount, 0);
  await rejectsCode(() => service.approveRequest(request._id, hr), 'RESOURCE_CONFLICT');
  await rejectsCode(() => service.refuseRequest(request._id, {}, hr), 'RESOURCE_CONFLICT');
  // Refused requests no longer block a new request for the same period.
  assert.equal((await service.createRequest(body, actor)).status, 'PENDING');
});

test('Leave approval rolls back balance if the request update fails', async () => {
  const { service, allocation, body, Request } = await leaveFixture();
  await service.approveAllocation(allocation._id, hr);
  const request = await service.createRequest(body, actor);
  Request.findOneAndUpdate = async () => null;
  await rejectsCode(() => service.approveRequest(request._id, hr), 'RESOURCE_CONFLICT');
  assert.equal((await service.getAllocation(allocation._id, hr)).takenAmount, 0);
});

test('Leave without allocation can be approved; expiry and unavailable transactions fail safely', async () => {
  const { service, body, allocation } = await leaveFixture({ requiresAllocation: false });
  const request = await service.createRequest(body, actor);
  assert.equal(request.allocation, null);
  assert.equal((await service.approveRequest(request._id, hr)).status, 'APPROVED');
  assert.equal((await service.getAllocation(allocation._id, hr)).takenAmount, 0);
  const expired = await leaveFixture();
  await expired.service.updateAllocation(expired.allocation._id, { validUntil: '2026-08-31' }, hr);
  await rejectsCode(() => expired.service.approveAllocation(expired.allocation._id, hr), 'LEV-005');
  const unavailable = await leaveFixture({ transaction: async () => { throw Object.assign(new Error('unsupported'), { code: 20 }); } });
  await rejectsCode(() => unavailable.service.createRequest(unavailable.body, actor), 'DEPENDENCY_UNAVAILABLE');
  assert.equal(unavailable.Request.rows.size, 0);
});

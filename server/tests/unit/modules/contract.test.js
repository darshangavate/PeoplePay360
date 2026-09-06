'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createStore = require('../../fixtures/configurationStore');
const Contract = require('../../../src/modules/contracts/contract.model');
const validation = require('../../../src/modules/contracts/contract.validation');
const { createContractService } = require('../../../src/modules/contracts/contract.service');
const createContractRouter = require('../../../src/modules/contracts/contract.routes');
const errorHandler = require('../../../src/core/middleware/errorHandler');
const roles = require('../../../src/core/constants/roles');

const employeeId = 'a'.repeat(24);
const departmentId = 'b'.repeat(24);
const scheduleId = 'c'.repeat(24);
const structureId = 'd'.repeat(24);
const otherStructureId = 'e'.repeat(24);
const missingId = 'f'.repeat(24);
const input = {
  employeeId,
  departmentId,
  jobPosition: 'Software Engineer',
  workingScheduleId: scheduleId,
  salaryStructureId: structureId,
  wage: 40000,
  wageType: 'MONTHLY',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-06-30T00:00:00.000Z'),
};
const rejectsCode = (work, code, status) => assert.rejects(work, error => (
  error.code === code && (status === undefined || error.statusCode === status)
));
const throwsCode = (work, code, status) => assert.throws(work, error => (
  error.code === code && (status === undefined || error.statusCode === status)
));

function fixture({ historicalReference = false, today = new Date('2026-09-01T12:00:00.000Z') } = {}) {
  const store = createStore();
  const Model = store.model([]);
  const exists = (actual, expected, label) => {
    if (actual !== expected) throw Object.assign(new Error(`${label} not found`), { code: 'RESOURCE_NOT_FOUND' });
    return { _id: actual };
  };
  const service = createContractService({
    Model,
    employees: { getEmployee: async id => exists(id, employeeId, 'Employee') },
    departments: { getDepartment: async id => exists(id, departmentId, 'Department') },
    schedules: { getSchedule: async id => exists(id, scheduleId, 'Schedule') },
    salaryConfig: { getStructure: async id => {
      if (![structureId, otherStructureId].includes(id)) throw Object.assign(new Error('Structure not found'), { code: 'RESOURCE_NOT_FOUND' });
      return { _id: id };
    } },
    hasHistoricalPayrollReferences: async () => historicalReference,
    now: () => new Date(today),
  });
  return { Model, service };
}

test('Contract schema uses canonical references, statuses, dates, wage, and indexes', () => {
  assert.equal(Contract.schema.path('employee').options.ref, 'Employee');
  assert.equal(Contract.schema.path('department').options.ref, 'Department');
  assert.equal(Contract.schema.path('workingSchedule').options.ref, 'WorkingSchedule');
  assert.equal(Contract.schema.path('salaryStructure').options.ref, 'SalaryStructure');
  assert.deepEqual(Contract.schema.path('status').enumValues, ['DRAFT', 'RUNNING', 'EXPIRED', 'CANCELLED']);
  assert.deepEqual(Contract.schema.path('wageType').enumValues, ['MONTHLY']);
  assert.ok(Contract.schema.indexes().some(([keys]) => keys.employee === 1 && keys.startDate === 1 && keys.endDate === 1));
});

test('Contract request validation rejects status and malformed request values', () => {
  const apiInput = { ...input, startDate: '2026-01-01', endDate: '2026-06-30' };
  throwsCode(() => validation.validateCreate({ body: { ...apiInput, status: 'RUNNING' } }), 'VALIDATION_ERROR', 400);
  throwsCode(() => validation.validateCreate({ body: { ...apiInput, wageType: 'HOURLY' } }), 'VALIDATION_ERROR', 400);
  throwsCode(() => validation.validateCreate({ body: { ...apiInput, startDate: '01/01/2026' } }), 'VALIDATION_ERROR', 400);
  assert.equal(validation.validateCreate({ body: apiInput }).body.startDate.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(validation.validateCreate({ body: { ...apiInput, jobPosition: 'Payroll Analyst' } }).body.jobPosition, 'Payroll Analyst');
});

test('Create validates all references and always persists Draft', async () => {
  const { service } = fixture();
  const contract = await service.createContract(input);
  assert.equal(contract.status, 'DRAFT');
  assert.equal(contract.employee, employeeId);
  assert.equal(contract.salaryStructure, structureId);
  await rejectsCode(() => service.createContract({ ...input, employeeId: missingId }), 'RESOURCE_NOT_FOUND');
  await rejectsCode(() => service.createContract({ ...input, departmentId: missingId }), 'RESOURCE_NOT_FOUND');
  await rejectsCode(() => service.createContract({ ...input, workingScheduleId: missingId }), 'RESOURCE_NOT_FOUND');
  await rejectsCode(() => service.createContract({ ...input, salaryStructureId: missingId }), 'RESOURCE_NOT_FOUND');
});

test('Contract terms enforce date order and non-negative wage as domain errors', async () => {
  const { service } = fixture();
  await rejectsCode(() => service.createContract({ ...input, endDate: new Date('2025-12-31') }), 'CTR-001', 422);
  await rejectsCode(() => service.createContract({ ...input, wage: -1 }), 'CTR-005', 422);
});

test('Only Draft core terms can be updated and combined terms are validated', async () => {
  const { service } = fixture();
  const draft = await service.createContract(input);
  await rejectsCode(() => service.updateContract(draft._id, { startDate: new Date('2026-07-01') }), 'CTR-001', 422);
  assert.equal((await service.updateContract(draft._id, { wage: 45000 })).wage, 45000);
  await service.startContract(draft._id);
  await rejectsCode(() => service.updateContract(draft._id, { wage: 50000 }), 'RESOURCE_CONFLICT', 409);
});

test('Start blocks inclusive overlap, permits adjacency, and handles open-ended contracts', async () => {
  const { service } = fixture();
  const first = await service.createContract(input);
  await service.startContract(first._id);
  const touching = await service.createContract({
    ...input, startDate: new Date('2026-06-30'), endDate: new Date('2026-07-31'), wage: 50000,
  });
  await rejectsCode(() => service.startContract(touching._id), 'CTR-002', 422);

  const adjacent = await service.createContract({
    ...input, startDate: new Date('2026-07-01'), endDate: new Date('2026-12-31'), wage: 50000,
  });
  assert.equal((await service.startContract(adjacent._id)).status, 'RUNNING');

  const openEnded = await service.createContract({
    ...input, startDate: new Date('2027-01-01'), endDate: null,
  });
  assert.equal((await service.startContract(openEnded._id)).status, 'RUNNING');
  const future = await service.createContract({
    ...input, startDate: new Date('2028-01-01'), endDate: new Date('2028-12-31'),
  });
  await rejectsCode(() => service.startContract(future._id), 'CTR-002');
});

test('Contract lifecycle exposes explicit transitions and preserves non-Draft records', async () => {
  const { service } = fixture();
  const cancellable = await service.createContract(input);
  assert.equal((await service.cancelContract(cancellable._id)).status, 'CANCELLED');
  await rejectsCode(() => service.startContract(cancellable._id), 'RESOURCE_CONFLICT');
  await rejectsCode(() => service.expireContract(cancellable._id), 'RESOURCE_CONFLICT');
  await rejectsCode(() => service.deleteContract(cancellable._id), 'RESOURCE_CONFLICT');

  const running = await service.createContract({
    ...input, startDate: new Date('2026-07-01'), endDate: new Date('2026-08-31'),
  });
  await service.startContract(running._id);
  assert.equal((await service.expireContract(running._id)).status, 'EXPIRED');
  await rejectsCode(() => service.cancelContract(running._id), 'RESOURCE_CONFLICT');
  await rejectsCode(() => service.deleteContract(running._id), 'RESOURCE_CONFLICT');

  const runningToCancel = await service.createContract({
    ...input, startDate: new Date('2026-09-01'), endDate: new Date('2026-12-31'),
  });
  await service.startContract(runningToCancel._id);
  await rejectsCode(() => service.deleteContract(runningToCancel._id), 'RESOURCE_CONFLICT');
  assert.equal((await service.cancelContract(runningToCancel._id)).status, 'CANCELLED');
});

test('Expire rejects future, current-day, and open-ended Running Contracts without changing their terms', async () => {
  const { service } = fixture();
  for (const [startDate, endDate] of [
    [new Date('2026-09-01'), new Date('2026-12-31')],
    [new Date('2026-08-01'), new Date('2026-09-01')],
    [new Date('2027-01-01'), null],
  ]) {
    const contract = await service.createContract({ ...input, startDate, endDate });
    await service.startContract(contract._id);
    await rejectsCode(() => service.expireContract(contract._id), 'RESOURCE_CONFLICT', 409);
    const unchanged = await service.getContract(contract._id);
    assert.equal(unchanged.status, 'RUNNING');
    assert.equal(unchanged.endDate?.toISOString() || null, endDate?.toISOString() || null);
    await service.cancelContract(contract._id);
  }
});

test('Draft deletion respects the historical payroll reference contract', async () => {
  const normal = fixture();
  const draft = await normal.service.createContract(input);
  assert.deepEqual(await normal.service.deleteContract(draft._id), { deleted: true });
  await rejectsCode(() => normal.service.getContract(draft._id), 'RESOURCE_NOT_FOUND');

  const referenced = fixture({ historicalReference: true });
  const protectedDraft = await referenced.service.createContract(input);
  await rejectsCode(() => referenced.service.deleteContract(protectedDraft._id), 'RESOURCE_CONFLICT', 409);
});

test('Resolver selects one Running or historical Expired contract and enforces structure', async () => {
  const { service } = fixture();
  const first = await service.createContract(input);
  await service.startContract(first._id);
  await service.expireContract(first._id);
  const second = await service.createContract({
    ...input, startDate: new Date('2026-07-01'), endDate: new Date('2026-12-31'), wage: 50000,
  });
  await service.startContract(second._id);

  const june = await service.resolveApplicableContract({
    employeeId, periodStart: '2026-06-01', periodEnd: '2026-06-30', salaryStructureId: structureId,
  });
  const september = await service.resolveApplicableContract({
    employeeId, periodStart: '2026-09-01', periodEnd: '2026-09-30', salaryStructureId: structureId,
  });
  assert.equal(june.wage, 40000);
  assert.equal(september.wage, 50000);
  await rejectsCode(() => service.resolveApplicableContract({
    employeeId, periodStart: '2027-01-01', periodEnd: '2027-01-31', salaryStructureId: structureId,
  }), 'CTR-003', 422);
  await rejectsCode(() => service.resolveApplicableContract({
    employeeId, periodStart: '2026-09-01', periodEnd: '2026-09-30', salaryStructureId: otherStructureId,
  }), 'CTR-007', 422);
});

test('Resolver blocks corrupt multiple-applicable data instead of choosing silently', async () => {
  const { Model, service } = fixture();
  await Model.create({ ...input, employee: employeeId, salaryStructure: structureId, status: 'RUNNING' });
  await Model.create({ ...input, employee: employeeId, salaryStructure: structureId, status: 'EXPIRED' });
  await rejectsCode(() => service.resolveApplicableContract({
    employeeId, periodStart: '2026-02-01', periodEnd: '2026-02-28', salaryStructureId: structureId,
  }), 'CTR-002', 422);
});

async function httpFixture(t) {
  const calls = [];
  const service = new Proxy({}, { get(target, method) {
    return async (...args) => {
      calls.push({ method, args });
      return method === 'listContracts'
        ? { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }
        : { id: missingId };
    };
  } });
  const authenticate = (req, res, next) => {
    req.user = { id: missingId, role: req.headers['x-test-role'], status: 'ACTIVE' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/contracts', createContractRouter({ authenticate, service }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const request = async (role, method, path = '', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/contracts${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-role': role },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { calls, request };
}

test('Contract routes expose the API contract and enforce management RBAC', async t => {
  const { calls, request } = await httpFixture(t);
  const apiInput = { ...input, startDate: '2026-01-01', endDate: '2026-06-30' };
  const endpoints = [
    ['GET', '', undefined, 200], ['POST', '', apiInput, 201], ['GET', `/${missingId}`, undefined, 200],
    ['PATCH', `/${missingId}`, { wage: 50000 }, 200], ['POST', `/${missingId}/start`, undefined, 200],
    ['POST', `/${missingId}/cancel`, undefined, 200], ['POST', `/${missingId}/expire`, undefined, 200],
    ['DELETE', `/${missingId}`, undefined, 200],
  ];
  for (const [method, path, body, expected] of endpoints) {
    assert.equal((await request(roles.ADMIN, method, path, body)).status, expected);
    const before = calls.length;
    assert.equal((await request(roles.EMPLOYEE, method, path, body)).status, 403);
    assert.equal(calls.length, before);
  }
  assert.equal((await request(roles.ADMIN, 'POST', '', { ...apiInput, status: 'RUNNING' })).status, 400);
  for (const role of [roles.HR_MANAGER, roles.HR_PAYROLL_USER, roles.HR_PAYROLL_MANAGER]) {
    assert.equal((await request(role, 'GET')).status, 200);
  }
});

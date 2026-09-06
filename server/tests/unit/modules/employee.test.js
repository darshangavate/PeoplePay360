'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createStore = require('../../fixtures/configurationStore');
const Employee = require('../../../src/modules/employees/employee.model');
const User = require('../../../src/modules/users/user.model');
const validation = require('../../../src/modules/employees/employee.validation');
const { createEmployeeService } = require('../../../src/modules/employees/employee.service');
const userService = require('../../../src/modules/users/user.service');
const { comparePassword } = require('../../../src/core/security/password');
const createEmployeeRouter = require('../../../src/modules/employees/employee.routes');
const errorHandler = require('../../../src/core/middleware/errorHandler');
const roles = require('../../../src/core/constants/roles');

const departmentId = 'a'.repeat(24);
const scheduleId = 'b'.repeat(24);
const missingId = 'f'.repeat(24);
const input = {
  firstName: 'Rahul', lastName: 'Sharma', email: 'rahul@company.com', phone: '9999999999',
  departmentId, jobPosition: 'Software Engineer', employeeType: 'FULL_TIME',
  workingScheduleId: scheduleId, joiningDate: new Date('2026-07-01T00:00:00.000Z'),
};
const rejectsCode = (work, code) => assert.rejects(work, error => error.code === code);
const throwsCode = (work, code) => assert.throws(work, error => error.code === code);

function fixture({ failLink = false, failEmail = false } = {}) {
  const store = createStore();
  const Model = store.model(['email']);
  Model.findById = employeeId => Model.findOne({ _id: employeeId });
  const UserModel = store.model(['email']);
  UserModel.findById = id => UserModel.findOne({ _id: id });
  UserModel.findByIdAndUpdate = (id, update) => UserModel.findOneAndUpdate({ _id: id }, update);
  const departments = { getDepartment: async id => {
    if (id !== departmentId) throw Object.assign(new Error('missing'), { code: 'RESOURCE_NOT_FOUND' });
    return { id };
  } };
  const schedules = { getSchedule: async id => {
    if (id !== scheduleId) throw Object.assign(new Error('missing'), { code: 'RESOURCE_NOT_FOUND' });
    return { id };
  } };
  const users = {
    assertEmployeeAccountEmailAvailable: email => userService.assertEmployeeAccountEmailAvailable(email, { Model: UserModel }),
    provisionEmployeeAccount: input => userService.provisionEmployeeAccount(input, { Model: UserModel }),
    linkEmployeeAccount: (accountId, employeeId) => {
      if (failLink) throw new Error('link failed');
      return userService.linkEmployeeAccount(accountId, employeeId, { Model: UserModel });
    },
    assertEmployeeAccountLink: (accountId, employeeId) => userService.assertEmployeeAccountLink(accountId, employeeId, { Model: UserModel }),
    setLinkedEmployeeAccountStatus: (accountId, employeeId, status) => userService.setLinkedEmployeeAccountStatus(accountId, employeeId, status, { Model: UserModel }),
    removeProvisionedEmployeeAccount: accountId => userService.removeProvisionedEmployeeAccount(accountId, { Model: UserModel }),
  };
  const deliveries = [];
  const emails = {
    sendTemporaryPassword: async message => {
      deliveries.push(message);
      if (failEmail) throw new Error('private SMTP failure');
    },
  };
  return {
    Model,
    UserModel,
    users,
    deliveries,
    service: createEmployeeService({ Model, departments, schedules, users, emails }),
  };
}

test('Employee schema declares unique identifiers and relationships', () => {
  assert.equal(Employee.schema.path('department').options.ref, 'Department');
  assert.equal(Employee.schema.path('workingSchedule').options.ref, 'WorkingSchedule');
  assert.equal(Employee.schema.path('manager').options.ref, 'Employee');
  assert.equal(Employee.schema.path('user').options.ref, 'User');
  assert.ok(Employee.schema.indexes().some(([keys, options]) => keys.employeeId === 1 && options.unique));
  assert.ok(Employee.schema.indexes().some(([keys, options]) => keys.email === 1 && options.unique));
  assert.ok(Employee.schema.indexes().some(([keys, options]) => keys.user === 1 && options.unique));
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.employeeId === 1 && options.unique));
});

test('bootstrap Admin is never marked as requiring a password change in API responses', () => {
  const admin = userService.serializeUser({
    _id: missingId,
    uniqueId: 'PP360-U-000001',
    firstName: 'System',
    lastName: 'Admin',
    email: 'admin@peoplepay360.com',
    role: roles.ADMIN,
    accountStatus: 'ACTIVE',
    mustChangePassword: true,
    employeeId: null,
  });

  assert.equal(admin.mustChangePassword, false);
});

test('Employee creates with generated ID, normalized data, and valid relationships', async () => {
  const { service, UserModel, deliveries } = fixture();
  const result = await service.createEmployee({ ...input, bankDetails: {
    accountHolderName: 'Rahul Sharma', accountNumber: '1234', bankName: 'Example Bank', ifscCode: 'exam0001',
  } });
  const { employee, accountProvisioning } = result;
  const user = await UserModel.findById(employee.user);
  assert.match(employee.employeeId, /^PP360-E-[A-F0-9]{8}$/);
  assert.equal(employee.email, input.email);
  assert.equal(String(user._id), String(employee.user));
  assert.equal(String(user.employeeId), String(employee._id));
  assert.equal(user.role, roles.EMPLOYEE);
  assert.equal(user.accountStatus, 'ACTIVE');
  assert.equal(user.mustChangePassword, true);
  assert.notEqual(user.passwordHash, accountProvisioning.temporaryPassword);
  assert.equal(await comparePassword(accountProvisioning.temporaryPassword, user.passwordHash), true);
  assert.equal(accountProvisioning.userId, String(user._id));
  assert.equal(accountProvisioning.email, input.email);
  assert.ok(accountProvisioning.temporaryPassword);
  assert.equal(accountProvisioning.mustChangePassword, true);
  assert.equal(accountProvisioning.emailDelivery, 'SENT');
  assert.deepEqual(deliveries, [{
    to: input.email,
    firstName: input.firstName,
    temporaryPassword: accountProvisioning.temporaryPassword,
  }]);
  assert.equal(employee.department, departmentId);
  assert.equal(employee.workingSchedule, scheduleId);
  assert.equal(employee.employmentStatus, 'ACTIVE');
  assert.equal('temporaryPassword' in employee, false);
  assert.equal('passwordHash' in userService.serializeUser(user), false);
  const laterRead = await service.getEmployee(employee._id);
  assert.equal('temporaryPassword' in laterRead, false);
  assert.equal('accountProvisioning' in laterRead, false);
});

test('Employee creation remains successful when invitation email delivery fails', async () => {
  const { service, Model, UserModel, deliveries } = fixture({ failEmail: true });
  const result = await service.createEmployee(input);
  assert.equal(result.accountProvisioning.emailDelivery, 'FAILED');
  assert.equal(deliveries.length, 1);
  assert.equal(Model.rows.size, 1);
  assert.equal(UserModel.rows.size, 1);
});

test('standalone User creation rejects EMPLOYEE and manual linkage fields', async () => {
  throwsCode(() => validation.validateCreate({ body: { ...input, userId: missingId } }), 'VALIDATION_ERROR');
  const userValidation = require('../../../src/modules/users/user.validation');
  throwsCode(() => userValidation.validateCreateUser({ body: {
    firstName: 'Rahul', lastName: 'Sharma', email: input.email, role: roles.EMPLOYEE,
  } }), 'USR-006');
  await rejectsCode(() => userService.createUser({
    firstName: 'Rahul', lastName: 'Sharma', email: input.email, role: roles.EMPLOYEE,
  }), 'USR-006');
});

test('User linkage rejects internal roles and duplicate Employee links', async () => {
  const { service, UserModel, users } = fixture();
  const { employee } = await service.createEmployee(input);
  const internal = await UserModel.create({
    _id: 'c'.repeat(24), uniqueId: 'PP360-U-INTERNAL', firstName: 'Internal', lastName: 'User',
    email: 'internal@company.com', passwordHash: 'hash', role: roles.ADMIN,
    accountStatus: 'ACTIVE', employeeId: null, mustChangePassword: true,
  });
  await rejectsCode(() => users.linkEmployeeAccount(internal._id, employee._id), 'USR-002');
  const second = await users.provisionEmployeeAccount({
    firstName: 'Second', lastName: 'Employee', email: 'second@company.com',
  });
  await rejectsCode(() => users.linkEmployeeAccount(second.user._id, employee._id), 'RESOURCE_CONFLICT');
});

test('failed reciprocal linkage compensates both newly created records', async () => {
  const { service, Model, UserModel } = fixture({ failLink: true });
  await assert.rejects(() => service.createEmployee(input), /link failed/);
  assert.equal(Model.rows.size, 0);
  assert.equal(UserModel.rows.size, 0);
});

test('Employee onboarding rejects an email already occupied by a User', async () => {
  const { service, Model, UserModel } = fixture();
  await UserModel.create({
    _id: 'e'.repeat(24), uniqueId: 'PP360-U-EXISTING', firstName: 'Existing', lastName: 'User',
    email: input.email, passwordHash: 'hash', role: roles.HR_MANAGER,
    accountStatus: 'ACTIVE', employeeId: null, mustChangePassword: true,
  });
  await rejectsCode(() => service.createEmployee(input), 'USR-001');
  assert.equal(Model.rows.size, 0);
  assert.equal(UserModel.rows.size, 1);
});

test('Employee deactivation synchronizes its linked EMPLOYEE User', async () => {
  const { service, UserModel } = fixture();
  const { employee } = await service.createEmployee(input);
  await service.deactivateEmployee(employee._id);
  assert.equal((await service.getEmployee(employee._id)).employmentStatus, 'INACTIVE');
  assert.equal((await UserModel.findById(employee.user)).accountStatus, 'INACTIVE');
  await service.activateEmployee(employee._id);
  assert.equal((await service.getEmployee(employee._id)).employmentStatus, 'ACTIVE');
  assert.equal((await UserModel.findById(employee.user)).accountStatus, 'ACTIVE');
});

test('password change clears mustChangePassword for a provisioned account', async () => {
  const { UserModel, users } = fixture();
  const account = await users.provisionEmployeeAccount({
    firstName: 'Password', lastName: 'Change', email: 'password@company.com',
  });
  const updated = await userService.replaceOwnPassword(account.user._id, 'new-hash', { Model: UserModel });
  assert.equal(updated.mustChangePassword, false);
  assert.equal(updated.passwordHash, 'new-hash');
});

test('Employee rejects duplicate email and missing department/position', async () => {
  const { service } = fixture();
  await service.createEmployee(input);
  await rejectsCode(() => service.createEmployee({ ...input, firstName: 'Other' }), 'EMP-001');
  throwsCode(() => validation.validateCreate({ body: { ...input, departmentId: undefined } }), 'EMP-003');
  throwsCode(() => validation.validateCreate({ body: { ...input, jobPosition: '' } }), 'EMP-003');
});

test('Employee validates Department, Schedule, and Manager relationships and rejects arbitrary User linkage', async () => {
  const { service } = fixture();
  await rejectsCode(() => service.createEmployee({ ...input, departmentId: missingId }), 'RESOURCE_NOT_FOUND');
  await rejectsCode(() => service.createEmployee({ ...input, workingScheduleId: missingId }), 'RESOURCE_NOT_FOUND');
  await rejectsCode(() => service.createEmployee({ ...input, managerId: missingId }), 'RESOURCE_NOT_FOUND');
  throwsCode(() => validation.validateCreate({ body: { ...input, userId: missingId } }), 'VALIDATION_ERROR');
});

test('Employee cannot become their own manager', async () => {
  const { service } = fixture();
  const { employee } = await service.createEmployee(input);
  await rejectsCode(() => service.updateEmployee(employee._id, { managerId: employee._id }), 'EMP-002');
});

test('Employee list/search/filter, update, and lifecycle preserve records', async () => {
  const { service, Model } = fixture();
  const { employee: manager } = await service.createEmployee({ ...input, jobPosition: 'Manager' });
  const { employee: report } = await service.createEmployee({ ...input, email: 'anita@company.com', firstName: 'Anita', employeeType: 'PART_TIME', managerId: manager._id });
  const updated = await service.updateEmployee(report._id, { phone: '8888888888', jobPosition: 'Senior Engineer' });
  assert.equal(updated.phone, '8888888888');
  assert.equal((await service.listEmployees({ q: 'anita', page: 1, limit: 20 })).meta.total, 1);
  assert.equal((await service.listEmployees({ departmentId, employeeType: 'PART_TIME', managerId: manager._id, employmentStatus: 'ACTIVE', page: 1, limit: 20 })).meta.total, 1);
  await service.deactivateEmployee(report._id);
  assert.equal((await service.listEmployees({ employmentStatus: 'INACTIVE', page: 1, limit: 20 })).meta.total, 1);
  assert.equal(Model.rows.size, 2);
  assert.equal((await service.activateEmployee(report._id)).employmentStatus, 'ACTIVE');
});

test('Employee /me derives linkage from authenticated User ID without a JWT employeeId claim', async () => {
  const { service } = fixture();
  const { employee: own, accountProvisioning } = await service.createEmployee(input);
  const actor = { id: accountProvisioning.userId };
  assert.equal((await service.getOwnEmployee(actor))._id, own._id);
  assert.equal((await service.assertOwnership(own._id, actor))._id, own._id);
  await rejectsCode(() => service.assertOwnership(missingId, actor), 'EMP-005');
  await rejectsCode(() => service.getOwnEmployee({}), 'RESOURCE_NOT_FOUND');
});

async function httpFixture(t) {
  const calls = [];
  const service = new Proxy({}, { get(target, method) {
    return async (...args) => {
      calls.push({ method, args });
      return method === 'listEmployees'
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
  app.use('/api/v1/employees', createEmployeeRouter({ authenticate, service }));
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
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/employees${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-role': role },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { calls, request };
}

test('Employee routes enforce management RBAC and exclusive /me access', async t => {
  const { calls, request } = await httpFixture(t);
  const managers = [roles.HR_MANAGER, roles.HR_PAYROLL_USER, roles.HR_PAYROLL_MANAGER, roles.ADMIN];
  const body = { ...input, joiningDate: '2026-07-01' };
  const endpoints = [
    ['GET', '', undefined, 200], ['POST', '', body, 201], ['GET', `/${missingId}`, undefined, 200],
    ['PATCH', `/${missingId}`, { phone: '8888888888' }, 200],
    ['POST', `/${missingId}/activate`, undefined, 200], ['POST', `/${missingId}/deactivate`, undefined, 200],
  ];
  for (const [method, path, payload, expected] of endpoints) {
    for (const role of managers) assert.equal((await request(role, method, path, payload)).status, expected);
    const before = calls.length;
    const forbidden = await request(roles.EMPLOYEE, method, path, payload);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'AUTH-003');
    assert.equal(calls.length, before);
  }
  assert.equal((await request(roles.EMPLOYEE, 'GET', '/me')).status, 200);
  assert.equal((await request(roles.ADMIN, 'GET', '/me')).status, 403);
  assert.equal((await request(roles.ADMIN, 'PATCH', `/${missingId}`, { employmentStatus: 'INACTIVE' })).status, 400);
});

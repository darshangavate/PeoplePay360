'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createStore = require('../../fixtures/configurationStore');
const { createScheduleService, calculateLineHours, calculateWorkingDays } = require('../../../src/modules/schedules/schedule.service');
const createScheduleRouter = require('../../../src/modules/schedules/schedule.routes');
const validation = require('../../../src/modules/schedules/schedule.validation');
const errorHandler = require('../../../src/core/middleware/errorHandler');
const roles = require('../../../src/core/constants/roles');

const id = 'a'.repeat(24);
const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const line = day => ({ day, isWorkingDay: true, startTime: '09:00', endTime: '18:00', breakMinutes: 60 });
const schedule = { name: 'Standard 40 Hours', workingDays: weekdays.map(line) };
const throwsCode = (work, code) => assert.throws(work, { code });
const rejectsCode = (work, code) => assert.rejects(work, error => error.code === code);

test('Working Schedule calculates 8 daily hours and 40 weekly hours', () => {
  assert.equal(calculateLineHours(line('MONDAY')), 8);
  const calculated = calculateWorkingDays(schedule.workingDays);
  assert.equal(calculated.weeklyHours, 40);
  assert.ok(calculated.workingDays.every(day => day.dailyHours === 8));
});

test('Working Schedule rejects invalid time and break ranges', () => { 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), startTime: '18:00', endTime: '09:00' }), 'SCH-001'); 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), endTime: '09:00' }), 'SCH-001'); 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), breakMinutes: -1 }), 'SCH-002'); 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), breakMinutes: 61 }), 'SCH-007'); 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), startTime: '09:00', endTime: '12:00', breakMinutes: 180 }), 'SCH-003'); 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), startTime: '09:00', endTime: '12:00', breakMinutes: 240 }), 'SCH-003'); 
  throwsCode(() => calculateLineHours({ ...line('MONDAY'), startTime: '09:00', endTime: '13:00', breakMinutes: 1 }), 'SCH-006'); 
});

test('Working Schedule rejects duplicate and ambiguous lines', () => {
  throwsCode(() => validation.validateWorkingDays([line('MONDAY'), line('MONDAY')]), 'SCH-004');
  throwsCode(() => validation.validateWorkingDays([{ day: 'HOLIDAY', isWorkingDay: false }]), 'SCH-004');
  throwsCode(() => validation.validateWorkingDays([{ day: 'SUNDAY', isWorkingDay: false, startTime: '09:00' }]), 'SCH-004');
  const nonWorking = validation.validateWorkingDays([{ day: 'SUNDAY', isWorkingDay: false }]);
  assert.deepEqual(nonWorking[0], { day: 'SUNDAY', isWorkingDay: false, startTime: null, endTime: null, breakMinutes: 0 });
});

test('Working Schedule CRUD, list/search/filter, and deactivate work', async () => {
  const store = createStore();
  const service = createScheduleService({ Model: store.model([]) });
  const standard = await service.createSchedule(schedule);
  const evening = await service.createSchedule({ name: 'Evening .*', workingDays: [line('MONDAY')] });
  assert.equal(standard.weeklyHours, 40);
  assert.equal((await service.getSchedule(standard._id)).name, schedule.name);
  const localMonday = new Date(2026, 8, 7, 9, 30);
  const attendanceContext = await service.getAttendanceContext(standard._id, localMonday);
  assert.equal(attendanceContext.date, '2026-09-07');
  assert.equal(attendanceContext.start.getTime(), new Date(2026, 8, 7, 9, 0).getTime());
  assert.equal(attendanceContext.end.getTime(), new Date(2026, 8, 7, 18, 0).getTime());
  const updated = await service.updateSchedule(standard._id, { name: 'Four Day Week', workingDays: weekdays.slice(0, 4).map(line) });
  assert.equal(updated.weeklyHours, 32);
  await service.deactivateSchedule(evening._id);
  const searched = await service.listSchedules({ q: '.*', page: 1, limit: 20 });
  assert.equal(searched.meta.total, 1);
  assert.equal(searched.data[0].name, 'Evening .*');
  const active = await service.listSchedules({ active: true, page: 1, limit: 20 });
  assert.equal(active.meta.total, 1);
  assert.equal(active.data[0].name, 'Four Day Week');
  await rejectsCode(() => service.getSchedule(id), 'RESOURCE_NOT_FOUND');
});

async function httpFixture(t) {
  const calls = [];
  const service = new Proxy({}, { get(target, method) {
    return async (...args) => {
      calls.push({ method, args });
      return method === 'listSchedules'
        ? { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }
        : { id };
    };
  } });
  const authenticate = (req, res, next) => {
    req.user = { role: req.headers['x-test-role'], status: 'ACTIVE' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/working-schedules', createScheduleRouter({ authenticate, service }));
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
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/working-schedules${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-role': role },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { calls, request };
}

test('Working Schedule routes enforce RBAC and reject authoritative fields', async t => {
  const { calls, request } = await httpFixture(t);
  const permitted = [roles.HR_MANAGER, roles.HR_PAYROLL_USER, roles.HR_PAYROLL_MANAGER, roles.ADMIN];
  const endpoints = [
    ['GET', '', undefined, 200],
    ['POST', '', schedule, 201],
    ['GET', `/${id}`, undefined, 200],
    ['PATCH', `/${id}`, { name: 'Updated' }, 200],
    ['POST', `/${id}/deactivate`, undefined, 200],
  ];
  for (const [method, path, body, expected] of endpoints) {
    for (const role of permitted) assert.equal((await request(role, method, path, body)).status, expected);
    const before = calls.length;
    const forbidden = await request(roles.EMPLOYEE, method, path, body);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.code, 'AUTH-003');
    assert.equal(calls.length, before);
  }
  assert.equal((await request(roles.ADMIN, 'PATCH', `/${id}`, { active: false })).status, 400);
  assert.equal((await request(roles.ADMIN, 'POST', '', { ...schedule, weeklyHours: 1 })).status, 400);
  assert.equal((await request(roles.ADMIN, 'GET', '?active=invalid')).status, 400);
});

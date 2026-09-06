'use strict';

const mongoose = require('mongoose');
const WorkingSchedule = require('./schedule.model');
const AppError = require('../../core/errors/AppError');
const persistenceError = require('../../core/errors/persistenceError');
const paginate = require('../../core/http/pagination');

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toMinutes = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftForDate(schedule, date) {
  const day = schedule.workingDays.find(line => line.day === DAY_NAMES[date.getUTCDay()]);
  if (!day?.isWorkingDay) return null;
  const datePart = date.toISOString().slice(0, 10);
  return {
    date: datePart,
    start: new Date(`${datePart}T${day.startTime}:00.000Z`),
    end: new Date(`${datePart}T${day.endTime}:00.000Z`),
    breakMinutes: day.breakMinutes,
  };
}

function attendanceShiftForDate(schedule, date) {
  const day = schedule.workingDays.find(line => line.day === DAY_NAMES[date.getDay()]);
  if (!day?.isWorkingDay) return null;
  const [startHour, startMinute] = day.startTime.split(':').map(Number);
  const [endHour, endMinute] = day.endTime.split(':').map(Number);
  const start = new Date(date);
  const end = new Date(date);
  start.setHours(startHour, startMinute, 0, 0);
  end.setHours(endHour, endMinute, 0, 0);
  const datePart = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return { date: datePart, start, end, breakMinutes: day.breakMinutes };
}

function calculateLineHours(line) {

  if (!line.isWorkingDay) return 0;

  const shiftMinutes =
    toMinutes(line.endTime) - toMinutes(line.startTime);

  if (shiftMinutes <= 0) {
    throw new AppError(
      'SCH-001',
      'End time must be later than start time.',
      422
    );
  }

  if (line.breakMinutes < 0) {
    throw new AppError(
      'SCH-002',
      'Break cannot be negative.',
      422
    );
  }

  if (line.breakMinutes >= shiftMinutes) {
    throw new AppError(
      'SCH-003',
      'Break must be shorter than the shift.',
      422
    );
  }

  // Maximum break = 60 minutes
  if (line.breakMinutes > 60) {
    throw new AppError(
      'SCH-007',
      'Break time cannot exceed 60 minutes.',
      422
    );
  }

  const workingMinutes =
    shiftMinutes - line.breakMinutes;

  // Minimum actual working time = 4 hours
  if (workingMinutes < 240) {
    throw new AppError(
      'SCH-006',
      'Working hours excluding break must be at least 4 hours.',
      422
    );
  }

  return workingMinutes / 60;
}

function calculateWorkingDays(workingDays) {
  const lines = workingDays.map(line => ({ ...line, dailyHours: calculateLineHours(line) }));
  const weeklyHours = lines.reduce((total, line) => total + line.dailyHours, 0);
  return { workingDays: lines, weeklyHours };
}

function createScheduleService({ Model = WorkingSchedule } = {}) {
  async function getSchedule(id) {
    if (!mongoose.isObjectIdOrHexString(id)) throw new AppError('RESOURCE_NOT_FOUND', 'Working Schedule not found.', 404);
    const schedule = await Model.findById(id);
    if (!schedule) throw new AppError('RESOURCE_NOT_FOUND', 'Working Schedule not found.', 404);
    return schedule;
  }
  async function listSchedules({ q, active, page, limit }) {
    const filter = {};
    if (active !== undefined) filter.active = active;
    if (q) filter.name = new RegExp(escapeRegex(q), 'i');
    return paginate(Model, filter, { page, limit }, { name: 1, _id: 1 });
  }
  async function createSchedule(input) {
    const calculated = calculateWorkingDays(input.workingDays);
    try { return await Model.create({ name: input.name, ...calculated, active: true }); }
    catch (error) { throw persistenceError(error); }
  }
  async function updateSchedule(id, input) {
    const schedule = await getSchedule(id);
    if (input.name !== undefined) schedule.name = input.name;
    if (input.workingDays !== undefined) schedule.set(calculateWorkingDays(input.workingDays));
    try { return await schedule.save(); }
    catch (error) { throw persistenceError(error); }
  }
  async function deactivateSchedule(id) {
    const schedule = await getSchedule(id);
    schedule.active = false;
    try { return await schedule.save(); }
    catch (error) { throw persistenceError(error); }
  }
  async function getAttendanceContext(scheduleId, at) {
    const schedule = await getSchedule(scheduleId);
    const shift = attendanceShiftForDate(schedule, new Date(at));
    if (!shift) throw new AppError('VALIDATION_ERROR', 'No working schedule applies on this date.', 422);
    return shift;
  }
  async function getWorkingIntervals(scheduleId, { startDate, endDate }) {
    const schedule = await getSchedule(scheduleId);
    const intervals = [];
    const first = new Date(`${startDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const last = new Date(`${endDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    for (let cursor = first; cursor <= last; cursor = new Date(cursor.getTime() + DAY_MS)) {
      const shift = shiftForDate(schedule, cursor);
      if (!shift) continue;
      intervals.push({ date: shift.date, start: shift.start, end: new Date(shift.end.getTime() - shift.breakMinutes * 60000) });
    }
    return intervals;
  }
  return { listSchedules, createSchedule, getSchedule, updateSchedule, deactivateSchedule, getAttendanceContext, getWorkingIntervals };
}

module.exports = { createScheduleService, ...createScheduleService(), calculateLineHours, calculateWorkingDays };

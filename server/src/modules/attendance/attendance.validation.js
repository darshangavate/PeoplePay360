'use strict';
const v = require('../../core/http/validation');
const dates = require('../../core/http/dates');
const statuses = ['OPEN', 'PRESENT', 'LATE', 'OVERTIME', 'ABSENT', 'MISSING_CHECKOUT'];
function manualInput(body, partial = false) {
  v.object(body, partial ? ['checkIn', 'checkOut', 'notes', 'correctionReason'] : ['employeeId', 'checkIn', 'checkOut', 'notes']);
  const result = {};
  if (!partial) result.employeeId = v.id(body.employeeId);
  if (!partial || 'checkIn' in body) result.checkIn = dates.timestamp(body.checkIn, 'checkIn');
  if ('checkOut' in body) result.checkOut = dates.timestamp(body.checkOut, 'checkOut');
  if ('notes' in body) result.notes = v.text(body.notes, 'notes', undefined, 2000);
  if (partial) result.correctionReason = v.text(body.correctionReason, 'correctionReason', 'ATT-006', 2000);
  if (result.checkIn && result.checkOut && result.checkOut <= result.checkIn) v.invalid('Check-out must be later than check-in.', 'ATT-002');
  return result;
}
function listQuery(query, own = false) {
  const result = v.query(query, ['status', 'from', 'to', ...(own ? [] : ['employeeId', 'departmentId'])]);
  if (result.status) v.choice(result.status, statuses, 'status');
  for (const key of ['employeeId', 'departmentId']) if (result[key]) v.id(result[key]);
  for (const key of ['from', 'to']) if (result[key]) result[key] = dates.dateOnly(result[key], key);
  if (result.from && result.to) dates.range(result.from, result.to);
  return result;
}
function checkoutInput(body) {
  const input = body ?? {};
  v.object(input, ['confirmEarlyCheckout']);
  return {
    confirmEarlyCheckout: input.confirmEarlyCheckout === undefined
      ? false
      : v.boolean(input.confirmEarlyCheckout, 'confirmEarlyCheckout'),
  };
}
module.exports = { manualInput, listQuery, checkoutInput, id: v.id, empty: body => v.object(body ?? {}, []) };

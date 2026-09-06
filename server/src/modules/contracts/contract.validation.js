'use strict';

const mongoose = require('mongoose');
const AppError = require('../../core/errors/AppError');
const errors = require('../../core/errors/errorCodes');
const {
  CONTRACT_STATUSES,
} = require('./contract.model');

const FIELDS = [
  'employeeId',
  'departmentId',
  'jobPosition',
  'workingScheduleId',
  'salaryStructureId',
  'wage',
  'wageType',
  'startDate',
  'endDate',
];

const fail = (
  field,
  message = errors.VALIDATION_ERROR.message,
) => {
  throw new AppError(
    errors.VALIDATION_ERROR.code,
    message,
    400,
    'ERROR',
    { field },
  );
};

const object = value => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    fail(
      'body',
      'Request body must be an object.',
    );
  }
};

const allowed = (value, fields) => {
  const unknown = Object.keys(value)
    .find(key => !fields.includes(key));

  if (unknown) {
    fail(
      unknown,
      'Unexpected request field.',
    );
  }
};

const id = (value, field) => {
  if (
    typeof value !== 'string' ||
    !mongoose.isObjectIdOrHexString(value)
  ) {
    fail(
      field,
      `${field} must be a valid identifier.`,
    );
  }

  return value;
};

const text = (value, field) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200
  ) {
    fail(
      field,
      `${field} is required and must be at most 200 characters.`,
    );
  }

  return value.trim();
};

const jobPosition = value => {
  return text(
    value,
    'jobPosition',
  );
};

const date = (
  value,
  field,
  nullable = false,
) => {
  if (nullable && value === null) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    fail(
      field,
      `${field} must use YYYY-MM-DD.`,
    );
  }

  const parsed = new Date(
    `${value}T00:00:00.000Z`,
  );

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !==
      value
  ) {
    fail(
      field,
      `${field} is invalid.`,
    );
  }

  return parsed;
};

const wage = value => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    fail(
      'wage',
      'wage must be a finite number.',
    );
  }

  if (value < 0) {
    fail(
      'wage',
      'wage cannot be negative.',
    );
  }

  return value;
};

const wageType = value => {
  if (value !== 'MONTHLY') {
    fail(
      'wageType',
      'wageType must be MONTHLY.',
    );
  }

  return value;
};

const positiveInteger = (
  value,
  fallback,
  field,
  max = Number.MAX_SAFE_INTEGER,
) => {
  if (value === undefined) {
    return fallback;
  }

  if (
    !/^\d+$/.test(String(value)) ||
    Number(value) < 1 ||
    Number(value) > max
  ) {
    fail(
      field,
      `Invalid ${field}.`,
    );
  }

  return Number(value);
};

function validateId({ params }) {
  return {
    params: {
      id: id(params.id, 'id'),
    },
  };
}

function values(body, partial = false) {
  object(body);
  allowed(body, FIELDS);

  if (
    partial &&
    !Object.keys(body).length
  ) {
    fail(
      'body',
      'Provide at least one field.',
    );
  }

  const result = {};

  for (const field of [
    'employeeId',
    'departmentId',
    'workingScheduleId',
    'salaryStructureId',
  ]) {
    if (
      !partial ||
      body[field] !== undefined
    ) {
      result[field] = id(
        body[field],
        field,
      );
    }
  }

  if (
    !partial ||
    body.jobPosition !== undefined
  ) {
    result.jobPosition =
      jobPosition(body.jobPosition);
  }

  if (
    !partial ||
    body.wage !== undefined
  ) {
    result.wage = wage(body.wage);
  }

  if (
    !partial ||
    body.wageType !== undefined
  ) {
    result.wageType =
      wageType(body.wageType);
  }

  if (
    !partial ||
    body.startDate !== undefined
  ) {
    result.startDate = date(
      body.startDate,
      'startDate',
    );
  }

  if (body.endDate !== undefined) {
    result.endDate = date(
      body.endDate,
      'endDate',
      true,
    );
  } else if (!partial) {
    result.endDate = null;
  }

  if (
    result.startDate &&
    result.endDate &&
    result.endDate < result.startDate
  ) {
    throw new AppError(
      errors.CONTRACT_INVALID_DATES.code,
      errors.CONTRACT_INVALID_DATES.message,
      422,
    );
  }

  return result;
}

function validateList({ query }) {
  allowed(query, [
    'employeeId',
    'departmentId',
    'salaryStructureId',
    'status',
    'from',
    'to',
    'page',
    'limit',
  ]);

  const result = {
    page: positiveInteger(
      query.page,
      1,
      'page',
    ),
    limit: positiveInteger(
      query.limit,
      20,
      'limit',
      100,
    ),
  };

  for (const field of [
    'employeeId',
    'departmentId',
    'salaryStructureId',
  ]) {
    if (query[field] !== undefined) {
      result[field] = id(
        query[field],
        field,
      );
    }
  }

  if (query.status !== undefined) {
    if (
      !Object.values(CONTRACT_STATUSES)
        .includes(query.status)
    ) {
      fail(
        'status',
        'Invalid Contract status.',
      );
    }

    result.status = query.status;
  }

  if (query.from !== undefined) {
    result.from = date(
      query.from,
      'from',
    );
  }

  if (query.to !== undefined) {
    result.to = date(
      query.to,
      'to',
    );
  }

  if (
    result.from &&
    result.to &&
    result.from > result.to
  ) {
    throw new AppError(
      errors.CONTRACT_INVALID_DATES.code,
      errors.CONTRACT_INVALID_DATES.message,
      422,
    );
  }

  return {
    query: result,
  };
}

const validateCreate = ({ body }) => ({
  body: values(body),
});

function validateUpdate({ body, params }) {
  validateId({ params });

  return {
    params: {
      id: params.id,
    },
    body: values(body, true),
  };
}

module.exports = {
  validateId,
  validateList,
  validateCreate,
  validateUpdate,
  values,
};

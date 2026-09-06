"use strict";

const mongoose = require("mongoose");
const AppError = require("../../core/errors/AppError");

const EMPLOYEE_TYPES = ["FULL_TIME", "CONTRACT"];

const fail = (message, field, code = "VALIDATION_ERROR", status = 400) => {
  throw new AppError(code, message, status, "ERROR", { field });
};

const allowed = (body, fields) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("Request body must be an object.", "body");
  }

  const key = Object.keys(body).find((k) => !fields.includes(k));

  if (key) {
    fail("Unexpected request field.", key);
  }
};

const id = (value, field) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value)) {
    fail(`${field} must be a valid identifier.`, field);
  }

  return value;
};

const date = (value, field) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${field} must use YYYY-MM-DD.`, field);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(`${field} is invalid.`, field);
  }

  return parsed;
};

const text = (value, field) => {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    fail(`${field} is required and must be at most 200 characters.`, field);
  }

  return value.trim();
};

const scope = (body) => {
  if (
    !body.salaryStructureId ||
    !mongoose.isObjectIdOrHexString(body.salaryStructureId)
  ) {
    fail(
      "A valid Salary Structure is required.",
      "salaryStructureId",
      "PAY-002",
      422,
    );
  }

  const result = {
    salaryStructureId: body.salaryStructureId,
    periodStart: date(body.periodStart, "periodStart"),
    periodEnd: date(body.periodEnd, "periodEnd"),
  };

  if (result.periodStart > result.periodEnd) {
    fail(
      "Payrun period start must be before or equal to period end.",
      "periodStart",
      "PAY-001",
      422,
    );
  }

  return result;
};

function preview({ body }) {
  allowed(body, [
    "salaryStructureId",
    "periodStart",
    "periodEnd",
    "employeeType",
    "departmentId",
  ]);

  const result = scope(body);

  if (body.employeeType !== undefined) {
    const normalized = text(body.employeeType, "employeeType").toUpperCase();

    if (!EMPLOYEE_TYPES.includes(normalized)) {
      fail("Invalid employee type.", "employeeType");
    }

    result.employeeType = normalized;
  }

  if (body.departmentId !== undefined) {
    result.departmentId = id(body.departmentId, "departmentId");
  }

  return {
    body: result,
  };
}

const selection = (value) => {
  if (!Array.isArray(value)) {
    fail("selectedEmployeeIds must be an array.", "selectedEmployeeIds");
  }

  if (!value.length) {
    fail(
      "At least one employee must be selected.",
      "selectedEmployeeIds",
      "PAY-003",
      422,
    );
  }

  const ids = value.map((value) => id(value, "selectedEmployeeIds"));

  if (new Set(ids.map(String)).size !== ids.length) {
    fail(
      "selectedEmployeeIds must not contain duplicates.",
      "selectedEmployeeIds",
    );
  }

  return ids;
};

function create({ body }) {
  allowed(body, [
    "name",
    "salaryStructureId",
    "periodStart",
    "periodEnd",
    "employeeTypeFilter",
    "departmentFilterId",
    "selectedEmployeeIds",
  ]);

  return {
    body: {
      name: text(body.name, "name"),
      ...scope(body),
      selectedEmployeeIds: selection(body.selectedEmployeeIds),
    },
  };
}

function update({ body, params }) {
  id(params.id, "id");

  allowed(body, ["name", "selectedEmployeeIds"]);

  if (!Object.keys(body).length) {
    fail("Provide at least one field.", "body");
  }

  const result = {};

  if (body.name !== undefined) {
    result.name = text(body.name, "name");
  }

  if (body.selectedEmployeeIds !== undefined) {
    result.selectedEmployeeIds = selection(body.selectedEmployeeIds);
  }

  return {
    params: {
      id: params.id,
    },
    body: result,
  };
}

const params = ({ params: value }) => ({
  params: {
    id: id(value.id, "id"),
  },
});

function list({ query }) {
  const fields = ["status", "salaryStructureId", "from", "to", "page", "limit"];

  const key = Object.keys(query).find((key) => !fields.includes(key));

  if (key) {
    fail("Unexpected query field.", key);
  }

  const result = {
    page: Number(query.page || 1),
    limit: Number(query.limit || 20),
  };

  if (
    !Number.isInteger(result.page) ||
    result.page < 1 ||
    !Number.isInteger(result.limit) ||
    result.limit < 1 ||
    result.limit > 100
  ) {
    fail("Invalid pagination.", "page");
  }

  if (query.status) {
    if (!["DRAFT", "COMPUTED", "VALIDATED", "PAID"].includes(query.status)) {
      fail("Invalid Payrun status.", "status");
    }

    result.status = query.status;
  }

  if (query.salaryStructureId) {
    result.salaryStructureId = id(query.salaryStructureId, "salaryStructureId");
  }

  if (query.from) {
    result.from = date(query.from, "from");
  }

  if (query.to) {
    result.to = date(query.to, "to");
  }

  if (result.from && result.to && result.from > result.to) {
    fail(
      "Payrun period start must be before or equal to period end.",
      "from",
      "PAY-001",
      422,
    );
  }

  return {
    query: result,
  };
}

module.exports = {
  preview,
  create,
  update,
  params,
  list,
  selection,
};

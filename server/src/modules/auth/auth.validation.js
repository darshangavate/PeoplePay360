"use strict";

const AppError = require("../../core/errors/AppError");
const errors = require("../../core/errors/errorCodes");
const { PASSWORD_MIN_LENGTH } = require("../../core/security/password");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (definition, field, message = definition.message) => {
  throw new AppError(definition.code, message, definition.statusCode, "ERROR", {
    field,
  });
};

function exactObject(body, keys) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(errors.VALIDATION_ERROR, "body");
  const unknown = Object.keys(body).find((key) => !keys.includes(key));
  if (unknown)
    fail(errors.VALIDATION_ERROR, unknown, "Unexpected request field.");
}

function validateLogin({ body }) {
  exactObject(body, ["email", "password"]);
  if (
    typeof body.email !== "string" ||
    !EMAIL_PATTERN.test(body.email.trim())
  ) {
    fail(errors.VALIDATION_ERROR, "email", "A valid email is required.");
  }
  if (typeof body.password !== "string" || !body.password.length) {
    fail(errors.VALIDATION_ERROR, "password", "Password is required.");
  }
  return {
    body: { email: body.email.trim().toLowerCase(), password: body.password },
  };
}

function validateForgotPassword({ body }) {
  exactObject(body, ["email"]);
  if (
    typeof body.email !== "string" ||
    !EMAIL_PATTERN.test(body.email.trim())
  ) {
    fail(errors.VALIDATION_ERROR, "email", "A valid email is required.");
  }
  return { body: { email: body.email.trim().toLowerCase() } };
}

function validateChangePassword({ body }) {
  exactObject(body, ["currentPassword", "newPassword"]);
  if (
    typeof body.currentPassword !== "string" ||
    !body.currentPassword.length
  ) {
    fail(
      errors.VALIDATION_ERROR,
      "currentPassword",
      "Current password is required.",
    );
  }
  if (
    typeof body.newPassword !== "string" ||
    body.newPassword.length < PASSWORD_MIN_LENGTH
  ) {
    fail(
      errors.USER_INVALID_PASSWORD,
      "newPassword",
      `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  return {
    body: {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    },
  };
}

module.exports = {
  validateLogin,
  validateForgotPassword,
  validateChangePassword,
};

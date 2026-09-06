"use strict";

const { ACCOUNT_STATUSES } = require("../../core/constants/statuses");
const AppError = require("../../core/errors/AppError");
const errors = require("../../core/errors/errorCodes");
const {
  comparePassword,
  hashPassword,
} = require("../../core/security/password");
const { signAccessToken } = require("../../core/security/token");
const userService = require("../users/user.service");

const appError = (definition, overrides = {}) =>
  new AppError(
    definition.code,
    overrides.message || definition.message,
    overrides.statusCode || definition.statusCode,
    "ERROR",
    overrides.details || {},
  );

function assertActive(user) {
  if (user.accountStatus !== ACCOUNT_STATUSES.ACTIVE)
    throw appError(errors.AUTH_INACTIVE);
}

async function login({ email, password }) {
  const user = await userService.findByEmailWithPassword(email);
  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw appError(errors.AUTH_INVALID_CREDENTIALS);
  }
  assertActive(user);
  await userService.updateLastLogin(user._id);
  return {
    token: signAccessToken(user._id),
    user: userService.serializeUser(user),
  };
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await userService.findByIdWithPassword(userId);
  if (!user) throw appError(errors.AUTH_INVALID_TOKEN);
  assertActive(user);
  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw appError(errors.AUTH_INVALID_CREDENTIALS, {
      message: "Invalid current password.",
    });
  }
  if (await comparePassword(newPassword, user.passwordHash)) {
    throw appError(errors.USER_INVALID_PASSWORD, {
      message: "New password must be different from the current password.",
      statusCode: 422,
    });
  }
  const updated = await userService.replaceOwnPassword(
    user._id,
    await hashPassword(newPassword),
  );
  return { changed: true, user: userService.serializeUser(updated) };
}

async function requestPasswordReset({ email }) {
  return userService.resetPasswordByEmail(email);
}

module.exports = { login, changePassword, requestPasswordReset };

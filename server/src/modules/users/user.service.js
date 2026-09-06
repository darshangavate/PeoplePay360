"use strict";

const mongoose = require("mongoose");
const roles = require("../../core/constants/roles");
const { ACCOUNT_STATUSES } = require("../../core/constants/statuses");
const AppError = require("../../core/errors/AppError");
const errors = require("../../core/errors/errorCodes");
const paginate = require("../../core/http/pagination");
const {
  generateTemporaryPassword,
  hashPassword,
} = require("../../core/security/password");
const accountEmailService = require("../notifications/accountEmail.service");
const User = require("./user.model");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeEmail = (email) => email.trim().toLowerCase();
const isCanonicalRole = (role) => Object.values(roles).includes(role);
const appError = (definition, overrides = {}) =>
  new AppError(
    definition.code,
    overrides.message || definition.message,
    overrides.statusCode || definition.statusCode,
    overrides.severity || "ERROR",
    overrides.details || {},
  );

const serializeUser = (user) => ({
  id: String(user._id),
  uniqueId: user.uniqueId,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  role: user.role,
  accountStatus: user.accountStatus,
  mustChangePassword: user.mustChangePassword,
  employeeId: user.employeeId ? String(user.employeeId) : null,
});

function assertValidId(id) {
  if (!mongoose.isObjectIdOrHexString(id))
    throw appError(errors.RESOURCE_NOT_FOUND);
}

async function findByIdOrThrow(id) {
  assertValidId(id);
  const user = await User.findById(id);
  if (!user) throw appError(errors.RESOURCE_NOT_FOUND);
  return user;
}

const createUniqueId = (id) => `PP360-U-${String(id).slice(-8).toUpperCase()}`;
const duplicateEmail = (error) =>
  error && error.code === 11000 && error.keyPattern && error.keyPattern.email;
const duplicateEmployeeLink = (error) =>
  error &&
  error.code === 11000 &&
  error.keyPattern &&
  error.keyPattern.employeeId;
const inSession = (query, session) =>
  session && typeof query.session === "function"
    ? query.session(session)
    : query;
const findByEmailWithPassword = (email) =>
  User.findOne({ email: normalizeEmail(email) }).select("+passwordHash");
const findById = (id) =>
  mongoose.isObjectIdOrHexString(id) ? User.findById(id) : null;
const findByIdWithPassword = (id) =>
  mongoose.isObjectIdOrHexString(id)
    ? User.findById(id).select("+passwordHash")
    : null;
const findAdmin = () => User.findOne({ role: roles.ADMIN });

const createBootstrapAdmin = ({ firstName, lastName, email, passwordHash }) =>
  User.findOneAndUpdate(
    { uniqueId: "PP360-U-000001" },
    {
      $setOnInsert: {
        uniqueId: "PP360-U-000001",
        firstName,
        lastName,
        email: normalizeEmail(email),
        passwordHash,
        role: roles.ADMIN,
        accountStatus: ACCOUNT_STATUSES.ACTIVE,
        mustChangePassword: true,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

const updateLastLogin = (id, date = new Date()) =>
  User.findByIdAndUpdate(id, { $set: { lastLogin: date } }, { new: true });
const replaceOwnPassword = (id, passwordHash, { Model = User } = {}) =>
  Model.findByIdAndUpdate(
    id,
    { $set: { passwordHash, mustChangePassword: false } },
    { new: true, runValidators: true },
  );

async function listUsers({ role, accountStatus, q, page, limit }) {
  const filter = {};
  if (role) filter.role = role;
  if (accountStatus) filter.accountStatus = accountStatus;
  if (q) {
    const search = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { firstName: search },
      { lastName: search },
      { email: search },
      { uniqueId: search },
    ];
  }
  const result = await paginate(
    User,
    filter,
    { page, limit },
    { createdAt: -1 },
  );
  return { data: result.data.map(serializeUser), meta: result.meta };
}

const getUser = async (id) => serializeUser(await findByIdOrThrow(id));

async function createUser(
  { firstName, lastName, email, role },
  { emails = accountEmailService } = {},
) {
  if (!isCanonicalRole(role)) {
    throw appError(errors.USER_INVALID_ROLE);
  }

  if (role === roles.EMPLOYEE) {
    throw appError(errors.USER_EMPLOYEE_REQUIRES_ONBOARDING);
  }

  if (role === roles.ADMIN) {
    throw appError(errors.USER_INVALID_ROLE, {
      message: "Admin role is reserved for the bootstrap administrator.",
    });
  }

  const normalizedEmail = normalizeEmail(email);
  if (await User.exists({ email: normalizedEmail }))
    throw appError(errors.USER_DUPLICATE_EMAIL);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const _id = new mongoose.Types.ObjectId().toHexString();
  try {
    const user = await User.create({
      _id,
      uniqueId: createUniqueId(_id),
      firstName,
      lastName,
      email: normalizedEmail,
      passwordHash,
      role,
      accountStatus: ACCOUNT_STATUSES.ACTIVE,
      employeeId: null,
      mustChangePassword: true,
    });
    let emailDelivery = "SENT";
    try {
      await emails.sendTemporaryPassword({
        to: normalizedEmail,
        firstName,
        temporaryPassword,
      });
    } catch {
      emailDelivery = "FAILED";
    }
    return { user: serializeUser(user), temporaryPassword, emailDelivery };
  } catch (error) {
    if (duplicateEmail(error)) throw appError(errors.USER_DUPLICATE_EMAIL);
    throw error;
  }
}

async function assertEmployeeAccountEmailAvailable(
  email,
  { Model = User, session = null } = {},
) {
  if (
    await inSession(Model.exists({ email: normalizeEmail(email) }), session)
  ) {
    throw appError(errors.USER_DUPLICATE_EMAIL);
  }
}

async function provisionEmployeeAccount(
  { firstName, lastName, email },
  {
    Model = User,
    generatePassword = generateTemporaryPassword,
    hash = hashPassword,
    session = null,
  } = {},
) {
  const normalizedEmail = normalizeEmail(email);
  await assertEmployeeAccountEmailAvailable(normalizedEmail, {
    Model,
    session,
  });
  const temporaryPassword = generatePassword();
  const passwordHash = await hash(temporaryPassword);
  const _id = new mongoose.Types.ObjectId().toHexString();
  try {
    const data = {
      _id,
      uniqueId: createUniqueId(_id),
      firstName,
      lastName,
      email: normalizedEmail,
      passwordHash,
      role: roles.EMPLOYEE,
      accountStatus: ACCOUNT_STATUSES.ACTIVE,
      employeeId: null,
      mustChangePassword: true,
    };
    const user = session
      ? (await Model.create([data], { session }))[0]
      : await Model.create(data);
    return { user, temporaryPassword };
  } catch (error) {
    if (duplicateEmail(error)) throw appError(errors.USER_DUPLICATE_EMAIL);
    throw error;
  }
}

async function assertEmployeeAccountLink(
  userId,
  employeeId,
  { Model = User, session = null } = {},
) {
  const user = await inSession(Model.findById(userId), session);
  if (!user)
    throw appError(errors.RESOURCE_NOT_FOUND, {
      message: "Linked User not found.",
    });
  if (user.role !== roles.EMPLOYEE) {
    throw appError(errors.USER_INVALID_ROLE, {
      message: "An Employee can only be linked to a User with role EMPLOYEE.",
      statusCode: 422,
    });
  }
  if (!user.employeeId || String(user.employeeId) !== String(employeeId)) {
    throw new AppError(
      "RESOURCE_CONFLICT",
      "User and Employee links are not reciprocal.",
      409,
    );
  }
  return user;
}

async function linkEmployeeAccount(
  userId,
  employeeId,
  { Model = User, session = null } = {},
) {
  const user = await inSession(Model.findById(userId), session);
  if (!user)
    throw appError(errors.RESOURCE_NOT_FOUND, {
      message: "Provisioned User not found.",
    });
  if (user.role !== roles.EMPLOYEE) {
    throw appError(errors.USER_INVALID_ROLE, {
      message: "An Employee can only be linked to a User with role EMPLOYEE.",
      statusCode: 422,
    });
  }
  if (user.employeeId && String(user.employeeId) !== String(employeeId)) {
    throw new AppError(
      "RESOURCE_CONFLICT",
      "User is already linked to another Employee.",
      409,
    );
  }
  if (
    await inSession(
      Model.exists({ employeeId, _id: { $ne: user._id } }),
      session,
    )
  ) {
    throw new AppError(
      "RESOURCE_CONFLICT",
      "Employee is already linked to another User.",
      409,
    );
  }
  user.employeeId = employeeId;
  try {
    await user.save(session ? { session } : undefined);
  } catch (error) {
    if (duplicateEmployeeLink(error)) {
      throw new AppError(
        "RESOURCE_CONFLICT",
        "Employee is already linked to another User.",
        409,
      );
    }
    throw error;
  }
  return user;
}

async function setLinkedEmployeeAccountStatus(
  userId,
  employeeId,
  accountStatus,
  { Model = User } = {},
) {
  const user = await assertEmployeeAccountLink(userId, employeeId, { Model });
  user.accountStatus = accountStatus;
  await user.save();
  return serializeUser(user);
}

async function removeProvisionedEmployeeAccount(userId, { Model = User } = {}) {
  await Model.deleteOne({ _id: userId, role: roles.EMPLOYEE });
}

async function updateUser(id, changes) {
  const user = await findByIdOrThrow(id);
  if (changes.email !== undefined) {
    const email = normalizeEmail(changes.email);
    if (await User.exists({ email, _id: { $ne: user._id } }))
      throw appError(errors.USER_DUPLICATE_EMAIL);
    user.email = email;
  }
  for (const field of ["firstName", "lastName"]) {
    if (changes[field] !== undefined) user[field] = changes[field];
  }
  try {
    await user.save();
  } catch (error) {
    if (duplicateEmail(error)) throw appError(errors.USER_DUPLICATE_EMAIL);
    throw error;
  }
  return serializeUser(user);
}

function assertNotSelf(userId, actor) {
  const actorId = String(actor?.id || actor?._id || "");

  if (String(userId) === actorId) {
    throw new AppError(
      "RESOURCE_CONFLICT",
      "You cannot change your own role or account status.",
      409,
    );
  }
}

async function changeRole(id, role, actor) {
  assertNotSelf(id, actor);

  if (!isCanonicalRole(role)) {
    throw appError(errors.USER_INVALID_ROLE);
  }

  if (role === roles.EMPLOYEE) {
    throw appError(errors.USER_EMPLOYEE_REQUIRES_ONBOARDING);
  }

  if (role === roles.ADMIN) {
    throw appError(errors.USER_INVALID_ROLE, {
      message: "Admin role is reserved for the bootstrap administrator.",
    });
  }

  const user = await findByIdOrThrow(id);

  if (user.employeeId) {
    throw new AppError(
      "RESOURCE_CONFLICT",
      "Linked Employee accounts must retain role EMPLOYEE.",
      409,
    );
  }

  user.role = role;
  await user.save();

  return serializeUser(user);
}

async function setAccountStatus(id, accountStatus, actor) {
  assertNotSelf(id, actor);

  const user = await findByIdOrThrow(id);

  user.accountStatus = accountStatus;
  await user.save();

  return serializeUser(user);
}

async function resetPassword(id) {
  const user = await findByIdOrThrow(id);
  const temporaryPassword = generateTemporaryPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.mustChangePassword = true;
  await user.save();
  return { user: serializeUser(user), temporaryPassword };
}

async function resetPasswordByEmail(
  email,
  {
    Model = User,
    emails = accountEmailService,
    generatePassword = generateTemporaryPassword,
    hash = hashPassword,
  } = {},
) {
  const user = await Model.findOne({ email: normalizeEmail(email) });
  if (!user || user.accountStatus !== ACCOUNT_STATUSES.ACTIVE)
    return { requested: true };

  const temporaryPassword = generatePassword();
  const passwordHash = await hash(temporaryPassword);

  try {
    await emails.sendPasswordResetTemporaryPassword({
      to: user.email,
      firstName: user.firstName,
      temporaryPassword,
    });
  } catch (error) {
    console.error("Password reset email delivery failed.", {
      code: error.code,
      message: error.message,
    });
    return { requested: true };
  }

  user.passwordHash = passwordHash;
  user.mustChangePassword = true;
  await user.save();
  return { requested: true };
}

module.exports = {
  assertEmployeeAccountEmailAvailable,
  assertEmployeeAccountLink,
  changeRole,
  createBootstrapAdmin,
  createUser,
  findAdmin,
  findByEmailWithPassword,
  findById,
  findByIdWithPassword,
  getUser,
  linkEmployeeAccount,
  listUsers,
  normalizeEmail,
  provisionEmployeeAccount,
  removeProvisionedEmployeeAccount,
  replaceOwnPassword,
  resetPassword,
  resetPasswordByEmail,
  serializeUser,
  setAccountStatus,
  setLinkedEmployeeAccountStatus,
  updateLastLogin,
  updateUser,
};

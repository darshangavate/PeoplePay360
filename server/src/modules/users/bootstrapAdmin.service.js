'use strict';

const { getBootstrapAdminConfig } = require('../../config/env');
const { hashPassword, PASSWORD_MIN_LENGTH } = require('../../core/security/password');
const userService = require('./user.service');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateConfig(config) {
  const complete = config.email && config.password && config.firstName && config.lastName;
  if (!complete || !EMAIL_PATTERN.test(config.email.trim()) || config.password.length < PASSWORD_MIN_LENGTH) {
    throw new Error('Bootstrap Admin configuration is missing or invalid.');
  }
}

async function provision() {
  const existingAdmin = await userService.findAdmin();
  if (existingAdmin) {
    if (existingAdmin.mustChangePassword) {
      existingAdmin.mustChangePassword = false;
      await existingAdmin.save();
    }
    return { created: false };
  }
  const config = getBootstrapAdminConfig();
  validateConfig(config);
  const passwordHash = await hashPassword(config.password);
  const user = await userService.createBootstrapAdmin({ ...config, passwordHash });
  console.info('Bootstrap Admin created.');
  return { created: true, user: userService.serializeUser(user) };
}

module.exports = { provision };

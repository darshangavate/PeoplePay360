"use strict";

const { Router } = require("express");
const asyncHandler = require("../../core/middleware/asyncHandler");
const authenticate = require("../../core/middleware/authenticate");
const validateRequest = require("../../core/middleware/validateRequest");
const controller = require("./auth.controller");
const validation = require("./auth.validation");

const router = Router();
const apply = (validator) =>
  validateRequest((req) => {
    const validated = validator({
      body: req.body,
      params: req.params,
      query: req.query,
    });
    if (validated.body) req.body = validated.body;
  });

router.post(
  "/login",
  apply(validation.validateLogin),
  asyncHandler(controller.login),
);
router.post(
  "/forgot-password",
  apply(validation.validateForgotPassword),
  asyncHandler(controller.requestPasswordReset),
);
router.get("/me", authenticate, controller.me);
router.post(
  "/change-password",
  authenticate,
  apply(validation.validateChangePassword),
  asyncHandler(controller.changePassword),
);

module.exports = router;

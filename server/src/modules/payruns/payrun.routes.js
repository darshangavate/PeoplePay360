"use strict";
const { Router } = require("express");
const roles = require("../../core/constants/roles");
const authorize = require("../../core/middleware/authorize");
const asyncHandler = require("../../core/middleware/asyncHandler");
const validateRequest = require("../../core/middleware/validateRequest");
const validation = require("./payrun.validation");
const createController = require("./payrun.controller");
module.exports = function createPayrunRouter({
  authenticate,
  service,
  eligibilityService,
} = {}) {
  if (typeof authenticate !== "function")
    throw new TypeError(
      "Payrun routes require shared authenticate middleware.",
    );
  const router = Router();
  const controller = createController({ service, eligibilityService });
  const allowed = [
    roles.HR_PAYROLL_USER,
    roles.HR_PAYROLL_MANAGER,
    roles.ADMIN,
  ];
  const apply = (validator) =>
    validateRequest((req) => {
      const out = validator({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      if (out.body) req.body = out.body;
      if (out.params) req.params = out.params;
      if (out.query) req.validatedQuery = out.query;
    });
  router.use(authenticate, authorize(...allowed));
  router.post(
    "/eligible-employees",
    apply(validation.preview),
    asyncHandler(controller.preview),
  );
  router.post("/", apply(validation.create), asyncHandler(controller.create));
  router.get("/", apply(validation.list), asyncHandler(controller.list));
  router.post(
    "/:id/compute",
    apply(validation.params),
    asyncHandler(controller.compute),
  );
  router.post(
    "/:id/validate",
    apply(validation.params),
    asyncHandler(controller.validate),
  );
  router.post(
    "/:id/mark-paid",
    apply(validation.params),
    asyncHandler(controller.markPaid),
  );
  router.post(
    "/:id/send-payslips",
    apply(validation.params),
    asyncHandler(controller.sendPayslips),
  );
  router.get(
    "/:id/payslips",
    apply(validation.params),
    asyncHandler(controller.payslips),
  );
  router.get("/:id", apply(validation.params), asyncHandler(controller.get));
  router.patch(
    "/:id",
    apply(validation.update),
    asyncHandler(controller.update),
  );
  router.delete(
    "/:id",
    apply(validation.params),
    asyncHandler(controller.remove),
  );
  return router;
};

"use strict";
const response = require("../../core/http/response");
const payruns = require("./payrun.service");
const eligibility = require("./payrollEligibility.service");
module.exports = function createPayrunController({
  service = payruns,
  eligibilityService = eligibility,
} = {}) {
  return {
    preview: async (req, res) =>
      response.resource(
        res,
        await eligibilityService.previewEligibility(req.body),
      ),
    create: async (req, res) =>
      response.resource(
        res,
        await service.createDraft(req.body, req.user),
        201,
      ),
    list: async (req, res) =>
      response.collection(res, await service.listPayruns(req.validatedQuery)),
    get: async (req, res) =>
      response.resource(res, await service.getPayrun(req.params.id)),
    update: async (req, res) =>
      response.resource(
        res,
        await service.updateDraft(req.params.id, req.body),
      ),
    remove: async (req, res) =>
      response.resource(res, await service.deleteDraft(req.params.id)),
    compute: async (req, res) =>
      response.resource(
        res,
        await service.computePayrun(req.params.id, req.user),
      ),
    validate: async (req, res) =>
      response.resource(
        res,
        await service.validatePayrun(req.params.id, req.user),
      ),
    markPaid: async (req, res) =>
      response.resource(
        res,
        await service.markPayrunPaid(req.params.id, req.user),
      ),
    sendPayslips: async (req, res) =>
      response.resource(res, await service.sendPayslips(req.params.id)),
    payslips: async (req, res) =>
      response.collection(res, await service.listPayslips(req.params.id)),
  };
};

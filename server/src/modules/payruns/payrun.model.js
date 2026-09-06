"use strict";

const mongoose = require("mongoose");
const PAYRUN_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  COMPUTED: "COMPUTED",
  VALIDATED: "VALIDATED",
  PAID: "PAID",
});
const warningSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    code: { type: String, required: true },
    severity: { type: String, enum: ["WARNING", "BLOCKING"], required: true },
    message: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    salaryStructure: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalaryStructure",
      required: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    employees: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    ],
    status: {
      type: String,
      enum: Object.values(PAYRUN_STATUSES),
      default: PAYRUN_STATUSES.DRAFT,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    computedAt: Date,
    warnings: { type: [warningSchema], default: [] },
    validatedAt: Date,
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      virtuals: true,
      transform(doc, value) {
        delete value.__v;
        return value;
      },
    },
  },
);
schema.index({ status: 1, periodStart: -1 });
schema.index({ salaryStructure: 1, periodStart: 1, periodEnd: 1 });
const Payrun = mongoose.models.Payrun || mongoose.model("Payrun", schema);
module.exports = Payrun;
module.exports.PAYRUN_STATUSES = PAYRUN_STATUSES;

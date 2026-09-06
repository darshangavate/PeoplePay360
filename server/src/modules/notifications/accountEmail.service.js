"use strict";

const { getMailTransporter } = require("../../config/mail");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function createAccountEmailService({
  getTransporter = getMailTransporter,
  env = process.env,
} = {}) {
  function getLoginUrl() {
    const clientUrl = (env.CLIENT_URL || "http://localhost:5173").replace(
      /\/+$/,
      "",
    );
    return `${clientUrl}/login`;
  }

  async function sendTemporaryPassword({ to, firstName, temporaryPassword }) {
    const loginUrl = getLoginUrl();
    const safeName = escapeHtml(firstName || "User");
    const safeEmail = escapeHtml(to);
    const safePassword = escapeHtml(temporaryPassword);
    const safeLoginUrl = escapeHtml(loginUrl);

    return getTransporter().sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Your PeoplePay360 account is ready",
      text: [
        `Hello ${firstName || "User"},`,
        "",
        "Your PeoplePay360 account has been created.",
        `Email: ${to}`,
        `Temporary password: ${temporaryPassword}`,
        `Sign in: ${loginUrl}`,
        "",
        "You will be required to choose a new password after signing in.",
        "For security, do not share this temporary password.",
      ].join("\n"),
      html: `
        <div style="background:#f4f7fb;padding:32px 16px;font-family:Arial,sans-serif;color:#172033">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dfe5ef;border-radius:12px;overflow:hidden">
            <div style="background:#173b67;padding:24px 28px;color:#ffffff">
              <div style="font-size:22px;font-weight:700">PeoplePay360</div>
              <div style="margin-top:6px;color:#dbeafe">Your account is ready</div>
            </div>
            <div style="padding:28px">
              <p style="margin:0 0 16px">Hello ${safeName},</p>
              <p style="margin:0 0 20px;line-height:1.6">An account has been created for you. Use these temporary credentials to sign in:</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;line-height:1.8">
                <div><strong>Email:</strong> ${safeEmail}</div>
                <div><strong>Temporary password:</strong> <code style="font-size:14px">${safePassword}</code></div>
              </div>
              <div style="margin:24px 0">
                <a href="${safeLoginUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Sign in to PeoplePay360</a>
              </div>
              <p style="margin:0 0 8px;line-height:1.6">You will be required to choose a new password after signing in.</p>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5">For security, do not share this temporary password. If the button does not work, open ${safeLoginUrl}</p>
            </div>
          </div>
        </div>
      `,
    });
  }

  async function sendPasswordResetTemporaryPassword({
    to,
    firstName,
    temporaryPassword,
  }) {
    const loginUrl = getLoginUrl();
    const safeName = escapeHtml(firstName || "User");
    const safeEmail = escapeHtml(to);
    const safePassword = escapeHtml(temporaryPassword);
    const safeLoginUrl = escapeHtml(loginUrl);

    return getTransporter().sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Your PeoplePay360 password has been reset",
      text: [
        `Hello ${firstName || "User"},`,
        "",
        "A password reset was requested for your PeoplePay360 account.",
        `Email: ${to}`,
        `Temporary password: ${temporaryPassword}`,
        `Sign in: ${loginUrl}`,
        "",
        "You will be required to choose a new password after signing in.",
        "If you did not request this reset, contact your administrator immediately.",
      ].join("\n"),
      html: `
        <div style="background:#f4f7fb;padding:32px 16px;font-family:Arial,sans-serif;color:#172033">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dfe5ef;border-radius:12px;overflow:hidden">
            <div style="background:#173b67;padding:24px 28px;color:#ffffff">
              <div style="font-size:22px;font-weight:700">PeoplePay360</div>
              <div style="margin-top:6px;color:#dbeafe">Password reset requested</div>
            </div>
            <div style="padding:28px">
              <p style="margin:0 0 16px">Hello ${safeName},</p>
              <p style="margin:0 0 20px;line-height:1.6">A password reset was requested for your PeoplePay360 account. Use these temporary credentials to sign in:</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;line-height:1.8">
                <div><strong>Email:</strong> ${safeEmail}</div>
                <div><strong>Temporary password:</strong> <code style="font-size:14px">${safePassword}</code></div>
              </div>
              <div style="margin:24px 0">
                <a href="${safeLoginUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Sign in to PeoplePay360</a>
              </div>
              <p style="margin:0 0 8px;line-height:1.6">You will be required to choose a new password after signing in.</p>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5">If you did not request this reset, contact your administrator immediately.</p>
            </div>
          </div>
        </div>
      `,
    });
  }

  return {
    getLoginUrl,
    sendTemporaryPassword,
    sendPasswordResetTemporaryPassword,
  };
}

module.exports = { createAccountEmailService, ...createAccountEmailService() };

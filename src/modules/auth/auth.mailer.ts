import nodemailer from "nodemailer";
import { renderPlatformEmailTemplate } from "../platform-admin/platform-admin.service";
import { env } from "../../config/env";

type SendPasswordResetOtpInput = {
  to: string;
  otp: string;
  expiresInMinutes: number;
  organizationName: string;
};

type SendLoginOtpInput = {
  to: string;
  otp: string;
  expiresInMinutes: number;
  organizationName: string;
};

type SendLoginSmsOtpInput = {
  to: string;
  otp: string;
  expiresInMinutes: number;
};

let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    });
  }
  return transporter;
};

export const sendPasswordResetOtpEmail = async (input: SendPasswordResetOtpInput) => {
  const transport = getTransporter();

  const subject = `${env.APP_NAME} password reset code`;
  const text = [
    `Hello,`,
    "",
    `Use this OTP to reset your password: ${input.otp}`,
    `This code expires in ${input.expiresInMinutes} minutes.`,
    "",
    "If you did not request this, ignore this email."
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 8px;">${env.APP_NAME} password reset</h2>
      <p style="margin-top: 0; color: #555;">Organization: ${input.organizationName}</p>
      <p>Use the code below to reset your password:</p>
      <div style="font-size: 28px; letter-spacing: 6px; font-weight: bold; margin: 16px 0;">${input.otp}</div>
      <p>This code expires in ${input.expiresInMinutes} minutes.</p>
      <p>If you did not request this, ignore this email.</p>
    </div>
  `;

  if (!transport) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP credentials are not configured");
    }

    console.log(`[dev-email] to=${input.to} otp=${input.otp}`);
    return;
  }

  await transport.sendMail({
    from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`,
    to: input.to,
    subject,
    html,
    text
  });
};

export const sendLoginOtpEmail = async (input: SendLoginOtpInput) => {
  const transport = getTransporter();

  const subject = `${env.APP_NAME} login verification code`;
  const text = [
    `Hello,`,
    "",
    `Use this OTP to continue your login: ${input.otp}`,
    `This code expires in ${input.expiresInMinutes} minutes.`,
    "",
    "If this was not you, secure your account immediately."
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="margin-bottom: 8px;">${env.APP_NAME} login verification</h2>
      <p style="margin-top: 0; color: #555;">Organization: ${input.organizationName}</p>
      <p>Use the code below to complete your login:</p>
      <div style="font-size: 28px; letter-spacing: 6px; font-weight: bold; margin: 16px 0;">${input.otp}</div>
      <p>This code expires in ${input.expiresInMinutes} minutes.</p>
      <p>If this was not you, secure your account immediately.</p>
    </div>
  `;

  if (!transport) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP credentials are not configured");
    }

    console.log(`[dev-email] to=${input.to} login-otp=${input.otp}`);
    return;
  }

  await transport.sendMail({
    from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`,
    to: input.to,
    subject,
    html,
    text
  });
};

export const sendLoginSmsOtp = async (input: SendLoginSmsOtpInput) => {
  const message = `${env.APP_NAME} login code: ${input.otp}. Expires in ${input.expiresInMinutes} minutes.`;

  if (!env.SMS_WEBHOOK_URL) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMS webhook is not configured");
    }

    console.log(`[dev-sms] to=${input.to} login-otp=${input.otp}`);
    return;
  }

  const response = await fetch(env.SMS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.SMS_WEBHOOK_BEARER_TOKEN ? { authorization: `Bearer ${env.SMS_WEBHOOK_BEARER_TOKEN}` } : {})
    },
    body: JSON.stringify({
      to: input.to,
      from: env.SMS_FROM,
      message
    })
  });

  if (!response.ok) {
    throw new Error(`SMS delivery failed with status ${response.status}`);
  }
};

export const sendTenantAdminInvitationEmail = async (input: { to: string; organizationName: string; setupUrl: string; expiresAt: Date }) => {
  const transport = getTransporter();
  const subject = `Your ${env.APP_NAME} workspace is ready`;
  const expiry = input.expiresAt.toISOString();
  const text = [`Hello,`, "", `Your ${env.APP_NAME} workspace for ${input.organizationName} is ready.`, `Create your Tenant Admin password using this secure link: ${input.setupUrl}`, `This invitation expires at ${expiry}.`, "", "If you were not expecting this invitation, ignore this email."].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto"><h2>Your ${env.APP_NAME} workspace is ready</h2><p>You have been invited as the Tenant Admin for <strong>${input.organizationName}</strong>.</p><p><a href="${input.setupUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Create your password</a></p><p>This one-time invitation expires at ${expiry}.</p><p>If you were not expecting this invitation, ignore this email.</p></div>`;
  if (!transport) { if (env.NODE_ENV === "production") throw new Error("SMTP credentials are not configured"); console.log(`[dev-email] to=${input.to} tenant-admin-setup=${input.setupUrl}`); return; }
  await transport.sendMail({ from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`, to: input.to, subject, text, html });
};

export const sendSubscriptionRenewalEmail = async (input: { to: string; organizationName: string; planName: string; renewalDate: Date; amount: number; currency: string }) => {
  const transport = getTransporter();
  const date = input.renewalDate.toISOString().slice(0, 10);
  const rendered = await renderPlatformEmailTemplate("PLAN_EXPIRY_REMINDER", {
    tenantName: input.organizationName,
    planName: input.planName,
    expiryDate: date
  });
  const subject = rendered.subject;
  const html = rendered.body;
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!transport) {
    if (env.NODE_ENV === "production") throw new Error("SMTP credentials are not configured");
    console.log(`[dev-email] to=${input.to} subscription-renewal=${date}`);
    return;
  }
  await transport.sendMail({ from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`, to: input.to, subject, text, html });
};

export const sendTenantCheckInEmail = async (input: { to: string; contactName: string; organizationName: string }) => {
  const transport = getTransporter();
  const subject = `Checking in from ${env.APP_NAME}`;
  const text = `Hello ${input.contactName}, we noticed ${input.organizationName} has not been active recently. Is there anything the ${env.APP_NAME} team can help you with?`;
  if (!transport) {
    if (env.NODE_ENV === "production") throw new Error("SMTP credentials are not configured");
    console.log(`[dev-email] to=${input.to} tenant-check-in=${input.organizationName}`);
    return;
  }
  await transport.sendMail({ from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`, to: input.to, subject, text, html: `<p>${text}</p>` });
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export const sendTransactionalNotificationEmail = async (input: { to: string; recipientName: string; subject: string; message: string }) => {
  const transport = getTransporter();
  const text = `Hello ${input.recipientName},\n\n${input.message}`;
  if (!transport) {
    if (env.NODE_ENV === "production") throw new Error("SMTP credentials are not configured");
    console.log(`[dev-email] to=${input.to} notification=${input.subject}`);
    return;
  }
  await transport.sendMail({
    from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`,
    to: input.to,
    subject: input.subject,
    text,
    html: `<p>Hello ${escapeHtml(input.recipientName)},</p><p>${escapeHtml(input.message)}</p>`
  });
};

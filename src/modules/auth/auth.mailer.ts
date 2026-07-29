import nodemailer from "nodemailer";
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

export const sendSubscriptionRenewalEmail = async (input: { to: string; organizationName: string; renewalDate: Date; amount: number; currency: string }) => {
  const transport = getTransporter();
  const date = input.renewalDate.toISOString().slice(0, 10);
  const subject = `${env.APP_NAME} subscription renews in 15 days`;
  const text = `${input.organizationName}'s subscription renews on ${date}. Estimated charge: ${input.currency} ${input.amount.toLocaleString("en-NG")}.`;
  if (!transport) {
    if (env.NODE_ENV === "production") throw new Error("SMTP credentials are not configured");
    console.log(`[dev-email] to=${input.to} subscription-renewal=${date}`);
    return;
  }
  await transport.sendMail({ from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`, to: input.to, subject, text, html: `<p>${text}</p>` });
};

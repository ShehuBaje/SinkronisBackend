import nodemailer from "nodemailer";
import { env } from "../../config/env";

export const sendPlatformInvoiceReminderEmail = async (input: { to: string; tenantName: string; invoiceNumber: string; amount: number; dueDate: Date }) => {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    if (env.NODE_ENV === "production") throw new Error("Notification service unavailable");
    return;
  }
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  const text = `${input.tenantName}, invoice ${input.invoiceNumber} for NGN ${input.amount.toLocaleString("en-NG")} is due on ${input.dueDate.toISOString().slice(0, 10)}.`;
  await transport.sendMail({ from: `"${env.APP_NAME}" <${env.EMAIL_FROM}>`, to: input.to, subject: `${env.APP_NAME} invoice payment reminder`, text, html: `<p>${escapeHtml(text)}</p>` });
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

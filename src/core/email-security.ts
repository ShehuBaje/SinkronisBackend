export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000
} as const;

export const escapeEmailHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);

export const smtpTransportOptions = (config: { host: string; port: number; secure: boolean; user: string; pass: string }) => ({
  host: config.host,
  port: config.port,
  secure: config.secure,
  auth: { user: config.user, pass: config.pass },
  ...SMTP_TIMEOUTS
});

const SAFE_EMAIL_ERROR_CODES = new Set(["EAUTH", "ECONNECTION", "ECONNREFUSED", "ECONNRESET", "EDNS", "EENVELOPE", "EMESSAGE", "ESOCKET", "ETIMEDOUT"]);

export const safeEmailDeliveryError = (error: unknown) => {
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code).toUpperCase() : "";
  const code = SAFE_EMAIL_ERROR_CODES.has(candidate) ? candidate : "EMAIL_DELIVERY_FAILED";
  return { code, message: `Email delivery failed (${code})` };
};

import "./types";
import path from "node:path";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { requestContextMiddleware } from "./core/request-context";
import { openApiSpec } from "./config/swagger";
import { errorMiddleware } from "./middleware/error.middleware";
import { authenticate } from "./middleware/auth.middleware";
import { requireTenant } from "./middleware/tenant.middleware";
import { authRouter } from "./modules/auth/auth.routes";
import { adminRouter } from "./modules/admin";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes";
import { hrisRouter } from "./modules/hris/hris.routes";
import { accountingRouter } from "./modules/accounting/accounting.routes";
import { payrollRouter } from "./modules/payroll/payroll.routes";
import { mediaRouter } from "./modules/media/media.routes";
import { platformAdminRouter } from "./modules/platform-admin";
import { redis } from "./config/redis";
import { internalRouter } from "./modules/internal/internal.routes";
import { restrictImpersonatedSensitiveActions } from "./middleware/impersonation.middleware";
import { requireEffectiveModuleAccess } from "./middleware/module-access.middleware";
import { telemetryRouter } from "./modules/telemetry/telemetry.routes";
import { employeeRouter } from "./modules/employee/employee.routes";
import { enforcePlatformMaintenance } from "./middleware/maintenance.middleware";

export const app = express();

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet());
const configuredCorsOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
// Keep local frontend development explicit rather than weakening production CORS with a wildcard.
const allowedCorsOrigins = new Set([...configuredCorsOrigins, "http://localhost:3000"]);
app.use(cors({
  origin: allowedCorsOrigins.has("*") ? true : (origin, callback) => callback(null, !origin || allowedCorsOrigins.has(origin)),
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(requestContextMiddleware);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
if (env.STORAGE_PROVIDER === "local") {
  app.use(env.UPLOAD_PUBLIC_BASE_PATH, express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)));
}
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    ...(env.RATE_LIMIT_STORE === "redis"
      ? {
          store: new RedisStore({
            sendCommand: async (...args: string[]) => redis.call(args[0], ...args.slice(1)) as never,
            prefix: "sinkronis:rate-limit:"
          })
        }
      : {})
  })
);

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: `${env.APP_NAME} API is running`,
    data: {
      health: "/health",
      documentation: `${env.API_PREFIX}/docs/`,
      apiBasePath: env.API_PREFIX
    }
  });
});

app.get(["/favicon.ico", "/favicon.png"], (_req, res) => {
  res.status(204).end();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get(`${env.API_PREFIX}/docs.json`, (_req, res) => {
  res.json(openApiSpec);
});

const swaggerPath = `${env.API_PREFIX}/docs`;
const swaggerUiVersion = "5.32.6";
const swaggerCdnBase = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${swaggerUiVersion}`;
const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${env.APP_NAME} API Documentation</title>
    <link rel="stylesheet" href="${swaggerCdnBase}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${swaggerCdnBase}/swagger-ui-bundle.js"></script>
    <script src="${swaggerCdnBase}/swagger-ui-standalone-preset.js"></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          url: "${env.API_PREFIX}/docs.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          displayRequestDuration: true,
          persistAuthorization: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: "StandaloneLayout"
        });
      });
    </script>
  </body>
</html>`;
const swaggerContentSecurityPolicy = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"]
  }
});
app.use(swaggerPath, swaggerContentSecurityPolicy);
app.get([swaggerPath, `${swaggerPath}/`], (_req, res) => {
  res.type("html").send(swaggerHtml);
});

app.use(`${env.API_PREFIX}/media`, mediaRouter);
app.use(`${env.API_PREFIX}/internal`, internalRouter);
app.use(`${env.API_PREFIX}/auth`, authRouter);
app.use(`${env.API_PREFIX}/platform-admin`, authenticate, platformAdminRouter);
app.use(env.API_PREFIX, authenticate, enforcePlatformMaintenance);
app.use(`${env.API_PREFIX}/admin`, restrictImpersonatedSensitiveActions, requireTenant, adminRouter);
app.use(`${env.API_PREFIX}/telemetry`, requireTenant, telemetryRouter);
app.use(`${env.API_PREFIX}/employee`, requireTenant, employeeRouter);
app.use(`${env.API_PREFIX}/subscriptions`, restrictImpersonatedSensitiveActions, requireTenant, subscriptionsRouter);
app.use(`${env.API_PREFIX}/hris`, requireTenant, requireEffectiveModuleAccess("hris"), hrisRouter);
app.use(`${env.API_PREFIX}/accounting`, restrictImpersonatedSensitiveActions, requireTenant, requireEffectiveModuleAccess("accounting"), accountingRouter);
app.use(`${env.API_PREFIX}/payroll`, restrictImpersonatedSensitiveActions, requireTenant, requireEffectiveModuleAccess("payroll"), payrollRouter);

app.use(errorMiddleware);

export default app;

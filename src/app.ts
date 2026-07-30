import "./types";
import path from "node:path";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
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

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN, credentials: true }));
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
      documentation: `${env.API_PREFIX}/docs`,
      apiBasePath: env.API_PREFIX
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get(`${env.API_PREFIX}/docs.json`, (_req, res) => {
  res.json(openApiSpec);
});

app.use(`${env.API_PREFIX}/docs`, swaggerUi.serve, swaggerUi.setup(openApiSpec, { explorer: true }));

app.use(`${env.API_PREFIX}/media`, mediaRouter);
app.use(`${env.API_PREFIX}/internal`, internalRouter);
app.use(`${env.API_PREFIX}/auth`, authRouter);
app.use(`${env.API_PREFIX}/admin`, authenticate, requireTenant, adminRouter);
app.use(`${env.API_PREFIX}/platform-admin`, authenticate, platformAdminRouter);
app.use(`${env.API_PREFIX}/subscriptions`, authenticate, requireTenant, subscriptionsRouter);
app.use(`${env.API_PREFIX}/hris`, authenticate, requireTenant, hrisRouter);
app.use(`${env.API_PREFIX}/accounting`, authenticate, requireTenant, accountingRouter);
app.use(`${env.API_PREFIX}/payroll`, authenticate, requireTenant, payrollRouter);

app.use(errorMiddleware);

export default app;

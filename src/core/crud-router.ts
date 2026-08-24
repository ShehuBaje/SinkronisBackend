import { Router } from "express";
import type { Request } from "express";
import type { z } from "zod";
import { z as zod } from "zod";
import { asyncHandler } from "./async-handler";
import { forbidden, notFound } from "./http-error";
import { getPagination, paginationQuery } from "./pagination";
import { prisma } from "./prisma";
import { validate } from "./validate";
import type { PermissionKey } from "../modules/auth/permissions";
import { authorize } from "../middleware/rbac.middleware";

type Delegate = {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  count: (args: Record<string, unknown>) => Promise<number>;
  findFirst: (args: Record<string, unknown>) => Promise<unknown | null>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
};

type CrudOptions = {
  model: keyof typeof prisma;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  permission: PermissionKey;
  searchableFields?: string[];
  include?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc">;
  beforeCreate?: (data: Record<string, unknown>, req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>;
  beforeUpdate?: (data: Record<string, unknown>, req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>;
  beforeDelete?: (context: { req: Request; existing: unknown }) => Promise<void> | void;
  afterCreate?: (context: { req: Request; created: unknown }) => Promise<void> | void;
  afterUpdate?: (context: { req: Request; updated: unknown; previous: unknown }) => Promise<void> | void;
  afterDelete?: (context: { req: Request; id: string; deleted: unknown }) => Promise<void> | void;
};

const idParams = zod.object({ id: zod.string().min(1) });

const getDelegate = (model: keyof typeof prisma): Delegate => prisma[model] as unknown as Delegate;

const tenantWhere = (req: Request, extra: Record<string, unknown> = {}) => {
  if (!req.organizationId) throw forbidden("Tenant context is required");
  return { organizationId: req.organizationId, ...extra };
};

const searchWhere = (fields: string[] | undefined, search: string | undefined) => {
  if (!fields?.length || !search) return {};
  return {
    OR: fields.map((field) => ({
      [field]: { contains: search }
    }))
  };
};

export const createCrudRouter = (options: CrudOptions) => {
  const router = Router();
  const delegate = getDelegate(options.model);
  const readPermission = options.permission;

  router.get(
    "/",
    authorize(readPermission),
    validate({ query: paginationQuery }),
    asyncHandler(async (req, res) => {
      const where = tenantWhere(req, searchWhere(options.searchableFields, req.query.search as string | undefined));
      const pagination = getPagination(req.query as never);
      const [data, total] = await Promise.all([
        delegate.findMany({
          where,
          ...pagination,
          include: options.include,
          orderBy: options.orderBy ?? { createdAt: "desc" }
        }),
        delegate.count({ where })
      ]);

      res.json({
        data,
        meta: {
          page: Number(req.query.page),
          limit: Number(req.query.limit),
          total
        }
      });
    })
  );

  router.get(
    "/:id",
    authorize(readPermission),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const data = await delegate.findFirst({
        where: tenantWhere(req, { id: req.params.id }),
        include: options.include
      });
      if (!data) throw notFound();
      res.json(data);
    })
  );

  router.post(
    "/",
    authorize(options.permission),
    validate({ body: options.createSchema }),
    asyncHandler(async (req, res) => {
      const data = (await options.beforeCreate?.(req.body, req)) ?? req.body;
      const created = await delegate.create({
        data: {
          ...data,
          organizationId: req.organizationId
        }
      });

      await options.afterCreate?.({ req, created });
      res.status(201).json(created);
    })
  );

  router.patch(
    "/:id",
    authorize(options.permission),
    validate({ params: idParams, body: options.updateSchema }),
    asyncHandler(async (req, res) => {
      const existing = await delegate.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
      if (!existing) throw notFound();

      const data = (await options.beforeUpdate?.(req.body, req)) ?? req.body;
      const updated = await delegate.update({
        where: { id: req.params.id },
        data
      });

      await options.afterUpdate?.({ req, updated, previous: existing });
      res.json(updated);
    })
  );

  router.delete(
    "/:id",
    authorize(options.permission),
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const existing = await delegate.findFirst({ where: tenantWhere(req, { id: req.params.id }) });
      if (!existing) throw notFound();

      await options.beforeDelete?.({ req, existing });
      await delegate.delete({ where: { id: req.params.id } });
      await options.afterDelete?.({ req, id: String(req.params.id), deleted: existing });
      res.status(204).send();
    })
  );

  return router;
};

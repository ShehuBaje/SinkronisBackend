import type { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../../core/prisma";
import { getRequestContext } from "../../core/request-context";

type CreateAuditLogInput = {
  organizationId: string;
  actorUserId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const mergeAuditMetadata = (metadata: Prisma.InputJsonValue | undefined) => {
  const context = getRequestContext();
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};

  return {
    ...base,
    ...(context?.ipAddress && !base.ipAddress ? { ipAddress: context.ipAddress } : {}),
    ...(context?.userAgent && !base.userAgent ? { userAgent: context.userAgent } : {})
  } as Prisma.InputJsonValue;
};

const buildAuditHash = (
  input: CreateAuditLogInput & { sequence: number; previousHash: string | null; createdAt: Date; metadata: Prisma.InputJsonValue }
) => {
  const payload = {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    sequence: input.sequence,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    summary: input.summary,
    metadata: input.metadata,
    previousHash: input.previousHash,
    createdAt: input.createdAt.toISOString()
  };

  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
};

export const createAuditLog = async (input: CreateAuditLogInput) => {
  const metadata = mergeAuditMetadata(input.metadata);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const txAny = tx as any;

    await txAny.auditLogChain.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId: input.organizationId },
      update: {}
    });

    const [chain] = await tx.$queryRaw<Array<{ lastHash: string | null; sequence: number }>>`
      SELECT lastHash, sequence
      FROM AuditLogChain
      WHERE organizationId = ${input.organizationId}
      FOR UPDATE
    `;

    const sequence = (chain?.sequence ?? 0) + 1;
    const previousHash = chain?.lastHash ?? null;
    const createdAt = new Date();
    const hash = buildAuditHash({ ...input, metadata, sequence, previousHash, createdAt });

    await txAny.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        sequence,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        summary: input.summary,
        metadata,
        previousHash,
        hash,
        createdAt
      }
    });

    await txAny.auditLogChain.update({
      where: { organizationId: input.organizationId },
      data: { lastHash: hash, sequence }
    });
  });
};

export const extractEntityId = (entity: unknown): string | undefined => {
  if (!entity || typeof entity !== "object") return undefined;
  const maybeId = (entity as { id?: unknown }).id;
  return typeof maybeId === "string" && maybeId.length > 0 ? maybeId : undefined;
};

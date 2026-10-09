import { Prisma } from "@prisma/client";
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

export const stableAuditStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableAuditStringify).join(",")}]`;

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableAuditStringify(entry)}`)
    .join(",")}}`;
};

export const AUDIT_HASH_VERSION_V2 = "V2" as const;

/** Mirrors JSON-column persistence before hashing so a stored row can be replayed exactly. */
export const canonicalizeAuditMetadata = (metadata: Prisma.InputJsonValue | undefined): Prisma.InputJsonObject => {
  const serialized = JSON.stringify(metadata ?? {});
  const parsed = JSON.parse(serialized) as Prisma.InputJsonValue;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Prisma.InputJsonObject : {};
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

export const buildAuditHash = (
  input: CreateAuditLogInput & { sequence: number; previousHash: string | null; createdAt: Date; metadata: Prisma.InputJsonValue; hashVersion?: string | null }
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
    createdAt: input.createdAt.toISOString(),
    ...(input.hashVersion ? { hashVersion: input.hashVersion } : {})
  };

  return crypto.createHash("sha256").update(stableAuditStringify(payload)).digest("hex");
};

export const replayAuditHash = (row: CreateAuditLogInput & { sequence: number; previousHash: string | null; createdAt: Date; metadata: Prisma.InputJsonValue; hashVersion?: string | null }) =>
  buildAuditHash({ ...row, metadata: row.hashVersion === AUDIT_HASH_VERSION_V2 ? canonicalizeAuditMetadata(row.metadata) : row.metadata });

const persistAuditLog = async (input: CreateAuditLogInput, tx: Prisma.TransactionClient) => {
  const metadata = canonicalizeAuditMetadata(mergeAuditMetadata(input.metadata));
  const hashVersion = AUDIT_HASH_VERSION_V2;
  const txAny = tx as any;
  await txAny.auditLogChain.upsert({ where: { organizationId: input.organizationId }, create: { organizationId: input.organizationId }, update: {} });

    const [chain] = await tx.$queryRaw<Array<{ lastHash: string | null; sequence: number }>>`
      SELECT lastHash, sequence
      FROM AuditLogChain
      WHERE organizationId = ${input.organizationId}
      FOR UPDATE
    `;

    const sequence = (chain?.sequence ?? 0) + 1;
    const previousHash = chain?.lastHash ?? null;
    const createdAt = new Date();
    const hash = buildAuditHash({ ...input, metadata, sequence, previousHash, createdAt, hashVersion });

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
        hashVersion,
        createdAt
      }
    });

    await txAny.auditLogChain.update({
      where: { organizationId: input.organizationId },
      data: { lastHash: hash, sequence }
    });
};

export const createAuditLog = async (input: CreateAuditLogInput, tx?: Prisma.TransactionClient) => {
  if (tx) return persistAuditLog(input, tx);
  return prisma.$transaction((transaction) => persistAuditLog(input, transaction), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 60_000 });
};

export const extractEntityId = (entity: unknown): string | undefined => {
  if (!entity || typeof entity !== "object") return undefined;
  const maybeId = (entity as { id?: unknown }).id;
  return typeof maybeId === "string" && maybeId.length > 0 ? maybeId : undefined;
};

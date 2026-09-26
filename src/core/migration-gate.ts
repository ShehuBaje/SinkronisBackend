import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";

export type MigrationGateResult = { current: boolean; required: string[]; applied: string[]; pending: string[] };

export const evaluateMigrationState = (required: string[], applied: string[]): MigrationGateResult => {
  const normalizedRequired = [...new Set(required)].sort();
  const normalizedApplied = [...new Set(applied)].sort();
  const appliedSet = new Set(normalizedApplied);
  const pending = normalizedRequired.filter((migration) => !appliedSet.has(migration));
  return { current: pending.length === 0, required: normalizedRequired, applied: normalizedApplied, pending };
};

export const migrationGateExitCode = (result: MigrationGateResult) => result.current ? 0 : 1;

export const requiredMigrationNames = async (migrationsDir = path.resolve("prisma", "migrations")) => {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
};

export const checkDatabaseMigrations = async (): Promise<MigrationGateResult> => {
  const required = await requiredMigrationNames();
  const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  return evaluateMigrationState(required, rows.map((row) => row.migration_name));
};

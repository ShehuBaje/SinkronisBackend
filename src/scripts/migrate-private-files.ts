import { prisma } from "../core/prisma";
import { migratePrivateFiles, rollbackUnsafeLocalPrivateFileMigrations } from "../core/private-file-migration";

const args = new Set(process.argv.slice(2));
const value = (prefix: string) => [...args].find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const dryRun = args.has("--dry-run");
const batchSize = Number(value("--batch-size") ?? 25);
const organizationId = value("--organization-id");

const operation = args.has("--rollback-unsafe-local") ? rollbackUnsafeLocalPrivateFileMigrations() : migratePrivateFiles({ dryRun, batchSize, organizationId });
operation
  .then((result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if ("failed" in result && result.failed) process.exitCode = 1; })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

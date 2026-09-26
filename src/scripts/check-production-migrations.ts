import { checkDatabaseMigrations, migrationGateExitCode } from "../core/migration-gate";
import { prisma } from "../core/prisma";

const main = async () => {
  const result = await checkDatabaseMigrations();
  if (!result.current) {
    console.error(`Release blocked: ${result.pending.length} required migration(s) are pending: ${result.pending.join(", ")}`);
    process.exitCode = migrationGateExitCode(result);
    return;
  }
  console.log(`Migration gate passed: ${result.required.length} required migration(s) are applied`);
};

void main().catch((error) => {
  console.error("Release blocked: migration status could not be verified", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

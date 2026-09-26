import fs from "node:fs";
import path from "node:path";

const prohibited = ["$queryRaw" + "Unsafe", "$executeRaw" + "Unsafe"];
const allowlist = new Map([
  ["src/scripts/check-financial-settlement-data.ts", "Read-only operator diagnostic builds SQL exclusively from hard-coded checks."],
  ["src/scripts/repair-test-payroll-dashboard-migration.ts", "Test-database-only schema repair uses fixed identifiers and guarded definitions."],
]);

const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : walk(target);
  return entry.isFile() && target.endsWith(".ts") ? [target] : [];
});

export const unsafeRawSqlViolations = (root = process.cwd()) => walk(path.join(root, "src")).flatMap((file) => {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const source = fs.readFileSync(file, "utf8");
  const matches = prohibited.filter((token) => source.includes(token));
  if (!matches.length || allowlist.has(relative)) return [];
  return matches.map((token) => `${relative}: unallowlisted ${token}`);
});

const invokedDirectly = require.main === module;
if (invokedDirectly) {
  const violations = unsafeRawSqlViolations();
  if (violations.length) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Unsafe raw SQL guard passed; ${allowlist.size} documented test/diagnostic allowlist entries.\n`);
  }
}

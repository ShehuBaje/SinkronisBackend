import { prisma } from "../core/prisma";
import { executePayrollWalletIncidentRepair, expectedEvidenceDigest, inspectPayrollWalletIncident, productionIncidentProfile } from "../core/payroll-wallet-incident-repair";

const execute = process.argv.includes("--execute");
const value = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };

const main = async () => {
  if (!execute) {
    const result = await inspectPayrollWalletIncident(prisma);
    console.log(JSON.stringify({ mode: "DRY_RUN", preventiveHotfix: "e6dfe2daf5a4a1ed0c37ddba68ff8fe2256c050e", ...result }));
    return;
  }
  const incidentId = value("--incident-id"); const digest = value("--evidence-digest"); const actor = process.env.REPAIR_ACTOR_USER_ID;
  if (!incidentId || !digest || !actor) throw new Error("Execution requires --incident-id, --evidence-digest and REPAIR_ACTOR_USER_ID");
  const result = await executePayrollWalletIncidentRepair(prisma, actor, incidentId, digest);
  console.log(JSON.stringify({ mode: "EXECUTE", expectedEvidenceDigest: expectedEvidenceDigest(productionIncidentProfile), ...result }));
};

main().catch((error) => { console.error(error instanceof Error ? error.message : "Repair command failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());

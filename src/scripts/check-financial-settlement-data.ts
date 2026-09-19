import "dotenv/config";
import { prisma } from "../core/prisma";

const checks = [
  ["duplicatePaymentRequestRefs", "SELECT COUNT(*) n FROM (SELECT organizationId,disbursementReference FROM PaymentRequest WHERE disbursementReference IS NOT NULL GROUP BY organizationId,disbursementReference HAVING COUNT(*)>1) x"],
  ["historicalPaidRequests", "SELECT COUNT(*) n FROM PaymentRequest WHERE status='PAID'"],
  ["historicalDisbursedRuns", "SELECT COUNT(*) n FROM PayrollRun WHERE status IN ('DISBURSED','PAID')"],
  ["paidPayslips", "SELECT COUNT(*) n FROM Payslip WHERE paymentStatus='PAID'"],
  ["negativeWallets", "SELECT COUNT(*) n FROM WalletAccount WHERE balance<0"],
] as const;

const main = async () => {
  try {
    for (const [name, sql] of checks) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql);
      console.log(`${name}=${rows[0]?.n ?? 0}`);
    }
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const safe = error as { name?: string; code?: string; syscall?: string };
  console.error(`READ_ONLY_CHECK_FAILED:${safe.name ?? "UNKNOWN"}:${safe.code ?? "NO_CODE"}:${safe.syscall ?? "NO_SYSCALL"}`);
  process.exitCode = 1;
});

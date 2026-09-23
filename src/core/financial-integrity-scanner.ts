import crypto from "node:crypto";
/* eslint-disable @typescript-eslint/no-unused-expressions -- compact counter branches remain explicit and side-effect-only */
import { Prisma, type FinancialSettlement, type WalletAccount, type WalletTransaction } from "@prisma/client";
import { prisma } from "./prisma";

export const SCANNER_VERSION = "3D.1";
export type IntegrityCandidate = { category: string; severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"; resourceType: string; resourceId: string; organizationId?: string; walletAccountId?: string; settlementId?: string; currency?: string; expected?: Prisma.Decimal; actual?: Prisma.Decimal; difference?: Prisma.Decimal; details?: Record<string, unknown> };
type WalletShape = Pick<WalletAccount,"id"|"organizationId"|"balance"|"reservedBalance"|"currency"> & { transactions: WalletTransaction[]; settlements: FinancialSettlement[]; organization?: { classification: string } };
const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const digest = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const candidate = (wallet: WalletShape, category: string, severity: IntegrityCandidate["severity"], details: Record<string, unknown> = {}): IntegrityCandidate => ({ category, severity, resourceType: "WALLET_ACCOUNT", resourceId: wallet.id, organizationId: wallet.organizationId, walletAccountId: wallet.id, currency: wallet.currency, details });
const activeReservation = (s: FinancialSettlement) => ["RESERVED","PROVIDER_PROCESSING","UNKNOWN"].includes(s.status) && Boolean(s.reservedAt) && !s.reservationReleasedAt;

export const analyzeWalletIntegrity = (wallet: WalletShape): IntegrityCandidate[] => {
  const findings: IntegrityCandidate[] = [];
  const rows = [...wallet.transactions].sort((a,b) => a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id));
  const correctionRows = rows.filter(r => r.type === "FINANCIAL_INTEGRITY_CORRECTION" && r.direction === "ADJUSTMENT" && r.sourceType === "FINANCIAL_INTEGRITY_REPAIR");
  const economicRows = rows.filter(r => !correctionRows.includes(r));
  const credits = economicRows.filter(r => ["CREDIT","INFLOW"].includes(r.direction)).reduce((s,r)=>s.add(r.amount),d(0));
  const debits = economicRows.filter(r => ["DEBIT","OUTFLOW"].includes(r.direction)).reduce((s,r)=>s.add(r.amount),d(0));
  const expected = credits.sub(debits);
  if (!wallet.balance.equals(expected)) findings.push({ ...candidate(wallet,"WALLET_BALANCE_MISMATCH","CRITICAL"), expected, actual: wallet.balance, difference: wallet.balance.sub(expected) });
  if (wallet.balance.gt(expected)) findings.push({ ...candidate(wallet,"UNLEDGERED_WALLET_VALUE","CRITICAL"), expected, actual: wallet.balance, difference: wallet.balance.sub(expected) });
  const active = wallet.settlements.filter(activeReservation).reduce((s,r)=>s.add(r.amount),d(0));
  if (!wallet.reservedBalance.equals(active)) findings.push({ ...candidate(wallet,"WALLET_RESERVED_BALANCE_MISMATCH","CRITICAL"), expected: active, actual: wallet.reservedBalance, difference: wallet.reservedBalance.sub(active) });
  if (wallet.reservedBalance.gt(wallet.balance)) findings.push(candidate(wallet,"RESERVATION_MISMATCH","CRITICAL",{ reason:"reserved balance exceeds balance" }));
  let gaps=d(0); for(let i=1;i<economicRows.length;i++) if(!economicRows[i].balanceBefore.equals(economicRows[i-1].balanceAfter)) gaps=gaps.add(economicRows[i].balanceBefore.sub(economicRows[i-1].balanceAfter).abs());
  const correctedGap=correctionRows.reduce((s,r)=>s.add(r.amount),d(0));
  if (!gaps.equals(correctedGap)) findings.push({ ...candidate(wallet,"LEDGER_RUNNING_BALANCE_BREAK","HIGH"), expected: correctedGap, actual:gaps, difference:gaps.sub(correctedGap).abs() });
  const identities=new Map<string,number>(); for(const r of rows){const k=r.transferReference?`transfer:${r.transferReference}`:r.sourceType&&r.sourceId?`source:${r.sourceType}:${r.sourceId}:${r.type}:${r.direction}`:`reference:${r.reference}`;identities.set(k,(identities.get(k)??0)+1);} if([...identities.values()].some(v=>v>1)) findings.push(candidate(wallet,"DUPLICATE_FINANCIAL_EVIDENCE","CRITICAL"));
  for(const s of wallet.settlements){
    const ledger=rows.filter(r=>r.sourceType===s.sourceType&&r.sourceId===s.sourceId);
    const debitsFor=ledger.filter(r=>r.direction==="DEBIT");
    if(s.currency!==wallet.currency) findings.push({ ...candidate(wallet,"SETTLEMENT_CURRENCY_MISMATCH","CRITICAL"), settlementId:s.id, resourceType:"FINANCIAL_SETTLEMENT",resourceId:s.id });
    if(s.status==="SUCCEEDED"&&debitsFor.length!==1) findings.push({ ...candidate(wallet,"SETTLEMENT_MARKED_SUCCESS_WITHOUT_REQUIRED_DEBIT","CRITICAL"), settlementId:s.id,resourceType:"FINANCIAL_SETTLEMENT",resourceId:s.id });
    if(s.status==="FAILED"&&Boolean(s.reservedAt)&&!s.reservationReleasedAt) findings.push({ ...candidate(wallet,"ORPHANED_RESERVATION","CRITICAL"),settlementId:s.id,resourceType:"FINANCIAL_SETTLEMENT",resourceId:s.id });
    if(s.method==="PROVIDER"&&["PROVIDER_PROCESSING","UNKNOWN","SUCCEEDED"].includes(s.status)&&!s.providerTransferReference) findings.push({ ...candidate(wallet,"PROVIDER_REFERENCE_MISMATCH","HIGH"),settlementId:s.id,resourceType:"FINANCIAL_SETTLEMENT",resourceId:s.id });
    if(s.status==="REVERSED"&&!s.reversalLedgerId) findings.push({ ...candidate(wallet,"REVERSAL_MISMATCH","CRITICAL"),settlementId:s.id,resourceType:"FINANCIAL_SETTLEMENT",resourceId:s.id });
  }
  if(wallet.organization?.classification!=="TEST_E2E"&&rows.some(r=>r.type==="TEST_E2E_CREDIT")) findings.push(candidate(wallet,"INVALID_TEST_E2E_FINANCIAL_EVIDENCE","CRITICAL"));
  return findings;
};

const persistFinding = async (runId:string, finding:IntegrityCandidate) => {
  const evidenceFingerprint=digest({ category:finding.category,resourceType:finding.resourceType,resourceId:finding.resourceId,expected:finding.expected?.toFixed(2),actual:finding.actual?.toFixed(2),difference:finding.difference?.toFixed(2),details:finding.details });
  const deduplicationKey=digest({ category:finding.category,resourceType:finding.resourceType,resourceId:finding.resourceId,walletAccountId:finding.walletAccountId,settlementId:finding.settlementId });
  const existing=await prisma.financialIntegrityFinding.findUnique({where:{deduplicationKey},select:{id:true}});
  await prisma.financialIntegrityFinding.upsert({where:{deduplicationKey},create:{deduplicationKey,evidenceFingerprint,category:finding.category,severity:finding.severity,status:"OPEN",resourceType:finding.resourceType,resourceId:finding.resourceId,organizationId:finding.organizationId,walletAccountId:finding.walletAccountId,settlementId:finding.settlementId,currency:finding.currency,expectedAmount:finding.expected,actualAmount:finding.actual,differenceAmount:finding.difference,details:finding.details as Prisma.InputJsonValue|undefined,firstScanRunId:runId,lastScanRunId:runId},update:{evidenceFingerprint,severity:finding.severity,status:"OPEN",resolvedAt:null,lastDetectedAt:new Date(),occurrenceCount:{increment:1},lastScanRunId:runId,expectedAmount:finding.expected,actualAmount:finding.actual,differenceAmount:finding.difference,details:finding.details as Prisma.InputJsonValue|undefined}});
  return existing?"existing":"new";
};

export const runFinancialIntegrityScan = async ({trigger="MANUAL",limit=100}:{trigger?:string;limit?:number}={}) => {
  const run=await prisma.financialIntegrityScanRun.create({data:{trigger,scannerVersion:SCANNER_VERSION}}); let objects=0,detected=0,newCount=0,existingCount=0,resolved=0,errors=0;
  const wallets=await prisma.walletAccount.findMany({take:Math.min(Math.max(limit,1),500),orderBy:{id:"asc"},include:{transactions:{orderBy:[{createdAt:"asc"},{id:"asc"}]},settlements:true,organization:{select:{classification:true}}}});
  for(const wallet of wallets){try{objects++; const findings=analyzeWalletIntegrity(wallet); const seen=new Set(findings.map(f=>f.category)); for(const finding of findings){detected++; (await persistFinding(run.id,finding))==="new"?newCount++:existingCount++;} const stale=await prisma.financialIntegrityFinding.findMany({where:{walletAccountId:wallet.id,status:"OPEN",category:{notIn:[...seen]}},select:{id:true}}); if(stale.length){const changed=await prisma.financialIntegrityFinding.updateMany({where:{id:{in:stale.map(x=>x.id)},status:"OPEN"},data:{status:"RESOLVED",resolvedAt:new Date(),lastScanRunId:run.id}});resolved+=changed.count;}}catch{errors++;}}
  // Business-object checks are bounded and tenant-scoped.
  const paidRequests=await prisma.paymentRequest.findMany({take:limit,where:{status:"PAID"},select:{id:true,organizationId:true}}); for(const row of paidRequests){objects++;const settlement=await prisma.financialSettlement.findFirst({where:{organizationId:row.organizationId,sourceType:"PAYMENT_REQUEST",sourceId:row.id,status:"SUCCEEDED"}});if(!settlement){detected++;(await persistFinding(run.id,{category:"ACCOUNTING_PAYMENT_STATE_MISMATCH",severity:"CRITICAL",resourceType:"PAYMENT_REQUEST",resourceId:row.id,organizationId:row.organizationId}))==="new"?newCount++:existingCount++;}}
  const paidSlips=await prisma.payslip.findMany({take:limit,where:{paymentStatus:"PAID"},select:{id:true,organizationId:true}}); for(const row of paidSlips){objects++;const settlement=await prisma.financialSettlement.findFirst({where:{organizationId:row.organizationId,sourceType:"PAYROLL_PAYSLIP",sourceId:row.id,status:"SUCCEEDED"}});if(!settlement){detected++;(await persistFinding(run.id,{category:"PAYROLL_PAYMENT_STATE_MISMATCH",severity:"CRITICAL",resourceType:"PAYSLIP",resourceId:row.id,organizationId:row.organizationId}))==="new"?newCount++:existingCount++;}}
  const attempts=await prisma.walletFundingAttempt.findMany({take:limit,where:{status:"COMPLETED"},select:{id:true,organizationId:true,walletAccountId:true,currency:true,amount:true}});for(const a of attempts){objects++;const count=await prisma.walletTransaction.count({where:{organizationId:a.organizationId,walletAccountId:a.walletAccountId,sourceType:"PAYSTACK_FUNDING",sourceId:a.id,type:"WALLET_FUNDING",direction:"CREDIT"}});if(count!==1){detected++;(await persistFinding(run.id,{category:"FUNDING_LEDGER_MISMATCH",severity:"CRITICAL",resourceType:"WALLET_FUNDING_ATTEMPT",resourceId:a.id,organizationId:a.organizationId,walletAccountId:a.walletAccountId,currency:a.currency,expected:d(a.amount),actual:d(count)}))==="new"?newCount++:existingCount++;}}
  const subscriptions=await prisma.subscriptionPaymentAttempt.findMany({take:limit,where:{status:"COMPLETED"},select:{id:true,organizationId:true,verifiedAt:true,billingHistory:{select:{id:true}}}});for(const a of subscriptions){objects++;if(!a.verifiedAt||!a.billingHistory){detected++;(await persistFinding(run.id,{category:"SUBSCRIPTION_PAYMENT_STATE_MISMATCH",severity:"CRITICAL",resourceType:"SUBSCRIPTION_PAYMENT_ATTEMPT",resourceId:a.id,organizationId:a.organizationId,details:{verified:Boolean(a.verifiedAt),billingApplied:Boolean(a.billingHistory)}}))==="new"?newCount++:existingCount++;}}
  return prisma.financialIntegrityScanRun.update({where:{id:run.id},data:{status:errors?"PARTIAL":"COMPLETED",completedAt:new Date(),objectsScanned:objects,findingsDetected:detected,newFindings:newCount,existingFindings:existingCount,resolvedFindings:resolved,errors}});
};

export const listIntegrityRuns=(page=1,limit=20)=>Promise.all([prisma.financialIntegrityScanRun.findMany({orderBy:{startedAt:"desc"},skip:(page-1)*limit,take:limit}),prisma.financialIntegrityScanRun.count()]);
export const listIntegrityFindings=(query:{page:number;limit:number;organizationId?:string;category?:string;severity?:string;status?:string;resourceType?:string})=>{const {page,limit,...where}=query;const clean=Object.fromEntries(Object.entries(where).filter(([,v])=>v));return Promise.all([prisma.financialIntegrityFinding.findMany({where:clean,orderBy:{lastDetectedAt:"desc"},skip:(page-1)*limit,take:limit}),prisma.financialIntegrityFinding.count({where:clean})]);};

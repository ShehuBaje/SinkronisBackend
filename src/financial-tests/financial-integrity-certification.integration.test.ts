import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../core/prisma.js";
import { financialIntegrityTestHooks, finalizeStaleIntegrityRuns, runFinancialIntegrityScan } from "../core/financial-integrity-scanner.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";
import { financialIntegrityRouter } from "../modules/platform-admin/financial-integrity.routes.js";
import { internalRouter } from "../modules/internal/internal.routes.js";
import { errorMiddleware } from "../middleware/error.middleware.js";
import { env } from "../config/env.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.PAYSTACK_TRANSFERS_ENABLED, "false");
  assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
}
const it = enabled ? test : test.skip;
const PREFIX = "phase3d-cert-";
let sequence = 0;
const uid = (label:string) => `${PREFIX}${label}-${Date.now()}-${sequence++}`;
const trigger = () => `P3D_CERT_${sequence++}`;
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const clean = async () => {
  await prisma.financialIntegrityFinding.deleteMany({ where: { resourceId: { startsWith: PREFIX } } });
  await prisma.financialIntegrityScanRun.deleteMany({ where: { trigger: { startsWith: "P3D_CERT_" } } });
  const organizations = await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  for (const organization of organizations) {
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.walletTransaction.deleteMany({ where: { organizationId: organization.id } });
    await prisma.financialSettlement.deleteMany({ where: { organizationId: organization.id } });
    await prisma.walletAccount.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.deleteMany({ where: { organizationId: organization.id } });
    await prisma.role.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
};

const fixture = async (balance: Prisma.Decimal.Value) => {
  const slug=uid("tenant");
  const organization=await prisma.organization.create({data:{name:slug,slug,currency:"NGN"}});
  const role=await prisma.role.create({data:{organizationId:organization.id,name:"Scanner Certifier",isSystem:true}});
  const user=await prisma.user.create({data:{organizationId:organization.id,roleId:role.id,email:`${slug}@example.test`,passwordHash:"test-only",firstName:"Phase",lastName:"ThreeD"}});
  const wallet=await prisma.walletAccount.create({data:{id:uid("wallet"),organizationId:organization.id,name:"Certification Wallet",purpose:"PRIMARY",currency:"NGN",balance:money(balance)}});
  return {organization,role,user,wallet};
};

if(enabled) before(clean);
if(enabled) after(async()=>{await clean();await prisma.$disconnect();});

it("Phase 3D DB lifecycle deduplicates, updates evidence, resolves, and reopens", async()=>{
  const fx=await fixture(101);
  await runFinancialIntegrityScan({trigger:trigger(),limit:500});
  const where={deduplicationKey:{not:""},walletAccountId:fx.wallet.id,category:"WALLET_BALANCE_MISMATCH"};
  const first=await prisma.financialIntegrityFinding.findFirstOrThrow({where});
  assert.equal(first.status,"OPEN"); assert.equal(first.occurrenceCount,1);
  await new Promise(resolve=>setTimeout(resolve,10));
  await runFinancialIntegrityScan({trigger:trigger(),limit:500});
  const repeated=await prisma.financialIntegrityFinding.findFirstOrThrow({where});
  assert.equal(await prisma.financialIntegrityFinding.count({where}),1);
  assert.equal(repeated.occurrenceCount,2); assert.ok(repeated.lastDetectedAt>first.lastDetectedAt);
  await prisma.walletAccount.update({where:{id:fx.wallet.id},data:{balance:money(102)}});
  await runFinancialIntegrityScan({trigger:trigger(),limit:500});
  const changed=await prisma.financialIntegrityFinding.findFirstOrThrow({where});
  assert.notEqual(changed.evidenceFingerprint,repeated.evidenceFingerprint); assert.equal(changed.occurrenceCount,3);
  await prisma.walletAccount.update({where:{id:fx.wallet.id},data:{balance:money(0)}});
  await runFinancialIntegrityScan({trigger:trigger(),limit:500});
  const resolved=await prisma.financialIntegrityFinding.findFirstOrThrow({where});
  assert.equal(resolved.status,"RESOLVED"); assert.ok(resolved.resolvedAt);
  await prisma.walletAccount.update({where:{id:fx.wallet.id},data:{balance:money(1)}});
  await runFinancialIntegrityScan({trigger:trigger(),limit:500});
  const reopened=await prisma.financialIntegrityFinding.findFirstOrThrow({where});
  assert.equal(reopened.status,"OPEN"); assert.equal(reopened.resolvedAt,null); assert.equal(reopened.occurrenceCount,4);
});

it("Phase 3D DB concurrent persistence converges and stale RUNNING recovery is bounded", async()=>{
  const run=await prisma.financialIntegrityScanRun.create({data:{trigger:trigger(),scannerVersion:"test"}});
  const resourceId=uid("resource");
  const finding={category:"WALLET_BALANCE_MISMATCH",severity:"CRITICAL" as const,resourceType:"WALLET_ACCOUNT",resourceId,expected:money(1),actual:money(2)};
  await Promise.all(Array.from({length:8},()=>financialIntegrityTestHooks.persistFinding(run.id,finding)));
  const rows=await prisma.financialIntegrityFinding.findMany({where:{resourceId}});
  assert.equal(rows.length,1); assert.equal(rows[0].occurrenceCount,8);
  const now=new Date();
  const stale=await prisma.financialIntegrityScanRun.create({data:{trigger:trigger(),scannerVersion:"test",startedAt:new Date(now.getTime()-31*60_000)}});
  const fresh=await prisma.financialIntegrityScanRun.create({data:{trigger:trigger(),scannerVersion:"test",startedAt:new Date(now.getTime()-29*60_000)}});
  await finalizeStaleIntegrityRuns(now);
  assert.equal((await prisma.financialIntegrityScanRun.findUniqueOrThrow({where:{id:stale.id}})).status,"FAILED");
  assert.equal((await prisma.financialIntegrityScanRun.findUniqueOrThrow({where:{id:fresh.id}})).status,"RUNNING");
});

it("Phase 3D partial and failed runs never resolve findings outside a positively scanned scope",async()=>{
  const run=await prisma.financialIntegrityScanRun.create({data:{trigger:trigger(),scannerVersion:"test"}});
  const resourceId=uid("unscanned-resource");
  await financialIntegrityTestHooks.persistFinding(run.id,{category:"WALLET_BALANCE_MISMATCH",severity:"CRITICAL",resourceType:"WALLET_ACCOUNT",resourceId,expected:money(0),actual:money(1)});
  await prisma.financialIntegrityScanRun.update({where:{id:run.id},data:{status:"PARTIAL",completedAt:new Date(),errors:1}});
  const failed=await prisma.financialIntegrityScanRun.create({data:{trigger:trigger(),scannerVersion:"test",status:"FAILED",completedAt:new Date(),errors:1,failureReason:"sanitized test failure"}});
  const finding=await prisma.financialIntegrityFinding.findFirstOrThrow({where:{resourceId}});
  assert.equal(finding.status,"OPEN"); assert.equal(finding.resolvedAt,null);
  assert.equal((await prisma.financialIntegrityScanRun.findUniqueOrThrow({where:{id:failed.id}})).status,"FAILED");
});

it("Phase 3D scans write metadata only and do not mutate economic state", async()=>{
  const fx=await fixture(100);
  const before={wallet:await prisma.walletAccount.findUniqueOrThrow({where:{id:fx.wallet.id}}),transactions:await prisma.walletTransaction.count({where:{organizationId:fx.organization.id}}),settlements:await prisma.financialSettlement.count({where:{organizationId:fx.organization.id}}),payslips:await prisma.payslip.count(),paymentRequests:await prisma.paymentRequest.count(),subscriptions:await prisma.subscriptionPaymentAttempt.count()};
  await runFinancialIntegrityScan({trigger:trigger(),limit:500});
  const after=await prisma.walletAccount.findUniqueOrThrow({where:{id:fx.wallet.id}});
  assert.equal(after.balance.toFixed(2),before.wallet.balance.toFixed(2)); assert.equal(after.reservedBalance.toFixed(2),before.wallet.reservedBalance.toFixed(2));
  assert.equal(await prisma.walletTransaction.count({where:{organizationId:fx.organization.id}}),before.transactions);
  assert.equal(await prisma.financialSettlement.count({where:{organizationId:fx.organization.id}}),before.settlements);
  assert.equal(await prisma.payslip.count(),before.payslips);
  assert.equal(await prisma.paymentRequest.count(),before.paymentRequests);
  assert.equal(await prisma.subscriptionPaymentAttempt.count(),before.subscriptions);
});

const serve=async(app:express.Express,fn:(base:string)=>Promise<void>)=>{const server=app.listen(0,"127.0.0.1");await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});try{const address=server.address();if(!address||typeof address==="string")throw new Error("No test address");await fn(`http://127.0.0.1:${address.port}`);}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
const platformApp=(user?:Record<string,unknown>)=>{const app=express();app.use(express.json());app.use((req,_res,next)=>{if(user)req.user=user as never;next();});app.use("/api/v1/platform-admin/financial-integrity",(req,res,next)=>user?.isPlatformAdmin?next():res.status(403).json({success:false}),financialIntegrityRouter);app.use(errorMiddleware);return app;};

it("Phase 3D HTTP Platform Admin authentication and permissions fail closed",async()=>{
  await serve(platformApp(),async base=>assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/runs`)).status,403));
  const ordinary={id:"u",organizationId:"o",email:"u@example.test",roleId:"r",isPlatformAdmin:false,permissions:[]};
  await serve(platformApp(ordinary),async base=>assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/runs`)).status,403));
  const noPermission={...ordinary,isPlatformAdmin:true};
  await serve(platformApp(noPermission),async base=>{assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/runs`)).status,403);assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/runs`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).status,403);});
  const reader={...noPermission,permissions:["platform:dashboard:view"]};
  await serve(platformApp(reader),async base=>{assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/runs`)).status,200);assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/findings`)).status,200);});
  const trigger={...noPermission,permissions:["platform:dashboard:view","platform:tenants:billing:manage"]};
  const fx=await fixture(0);
  const authorized={...trigger,id:fx.user.id,organizationId:fx.organization.id,roleId:fx.role.id,email:fx.user.email};
  await serve(platformApp(authorized),async base=>assert.equal((await fetch(`${base}/api/v1/platform-admin/financial-integrity/runs`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({limit:1})})).status,201));
});

it("Phase 3D HTTP Cron rejects missing/invalid credentials and accepts the configured bearer",async()=>{
  const previous=env.CRON_SECRET;env.CRON_SECRET=uid("cron-secret-value");
  const app=express();app.use("/api/v1/internal",internalRouter);app.use(errorMiddleware);
  try{await serve(app,async base=>{const url=`${base}/api/v1/internal/cron/financial-integrity`;assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{authorization:"Bearer invalid-test-value"}})).status,401);const accepted=await fetch(url,{headers:{authorization:`Bearer ${env.CRON_SECRET}`}});assert.equal(accepted.status,200);});}finally{env.CRON_SECRET=previous;}
});

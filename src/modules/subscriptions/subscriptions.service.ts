import type { Request } from "express";
import { badRequest, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { billingPlans as sharedBillingPlans, moduleLabels, modulePrices as addOnPrices, type BillingCycle, type BillingModuleKey as ManagedModuleKey, type BillingPlanKey } from "../billing/billing.catalog";
import { getEffectivePlanCatalogue, resolveRecurringPrices } from "../billing/pricing.service";

type SubscriptionPlan = (typeof sharedBillingPlans)[number];

const subscriptionConfigKey = "billing.subscription";
const addOnSubscriptionPrefix = "billing.addons";

const subscriptionPlans = sharedBillingPlans;

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const getPlan = async (planKey: BillingPlanKey, organizationId?: string) => {
  const plan = subscriptionPlans.find((item) => item.key === planKey);
  if (!plan) throw badRequest("Subscription plan not found");
  const effective = (await getEffectivePlanCatalogue()).find((item) => item.key === planKey);
  let monthlyCost = effective?.monthlyPrice ?? plan.monthlyCost;
  if (organizationId) {
    const prices = await resolveRecurringPrices([{ organizationId, planKey, source: "BASE_PLAN", fallbackMonthlyPrice: monthlyCost }]);
    monthlyCost = prices.get(`${organizationId}:${planKey}:BASE_PLAN`) ?? monthlyCost;
  }
  return { ...plan, monthlyCost, yearlyCost: monthlyCost * 12 };
};

const normalizeBillingCycle = (value: unknown): BillingCycle => (value === "YEARLY" ? "YEARLY" : "MONTHLY");

const getSubscriptionConfig = async (organizationId: string, currency: string) => {
  const row = await prisma.systemConfig.findUnique({
    where: {
      organizationId_key: {
        organizationId,
        key: subscriptionConfigKey
      }
    },
    select: { value: true }
  });
  const configured = (row?.value as Record<string, unknown> | undefined) ?? {};
  const rawPlanKey = (typeof configured.planKey === "string" ? configured.planKey : "hris") as BillingPlanKey;
  if (!subscriptionPlans.some((plan) => plan.key === rawPlanKey)) {
    throw badRequest("Stored subscription plan is invalid; run the subscription plan data migration", { errorCode: "INVALID_PLAN_CONFIGURATION" });
  }
  const renewalDate = typeof configured.renewalDate === "string" ? new Date(configured.renewalDate) : addMonths(new Date(), 1);

  return {
    status: typeof configured.status === "string" ? configured.status : "ACTIVE",
    planKey: rawPlanKey,
    billingCycle: normalizeBillingCycle(configured.billingCycle),
    currency: typeof configured.currency === "string" ? configured.currency : currency,
    renewalDate: Number.isNaN(renewalDate.getTime()) ? addMonths(new Date(), 1) : renewalDate,
    cancelAtPeriodEnd: configured.cancelAtPeriodEnd === true
  };
};

const getActiveAddOnModules = async (organizationId: string, plan: SubscriptionPlan) => {
  const rows = await prisma.systemConfig.findMany({
    where: {
      organizationId,
      key: {
        in: (["hris", "accounting", "payroll"] as ManagedModuleKey[]).flatMap((moduleKey) => [
          `module.${moduleKey}.status`,
          `${addOnSubscriptionPrefix}.${moduleKey}.subscription`
        ])
      }
    },
    select: { key: true, value: true }
  });

  const config = new Map(rows.map((row) => [row.key, row.value]));

  return (["hris", "accounting", "payroll"] as ManagedModuleKey[])
    .filter((moduleKey) => !plan.includedModules.includes(moduleKey))
    .filter((moduleKey) => {
      const moduleStatus = config.get(`module.${moduleKey}.status`);
      const addOnState = config.get(`${addOnSubscriptionPrefix}.${moduleKey}.subscription`) as Record<string, unknown> | undefined;
      return moduleStatus === "ACTIVE" || addOnState?.status === "ACTIVE";
    });
};

const calculateSubscriptionBilling = (plan: SubscriptionPlan, activeAddOns: ManagedModuleKey[], effectiveAddOnPrices: Partial<Record<ManagedModuleKey, number>> = {}) => {
  const activeAddOnMonthlyCost = activeAddOns.reduce((sum, moduleKey) => sum + (effectiveAddOnPrices[moduleKey] ?? addOnPrices[moduleKey]), 0);

  return {
    baseMonthlyCost: plan.monthlyCost,
    activeAddOnMonthlyCost,
    totalMonthlyCost: plan.monthlyCost + activeAddOnMonthlyCost
  };
};

const buildCurrentSubscription = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, currency: true }
  });

  if (!organization) throw notFound("Organization not found");

  const subscription = await getSubscriptionConfig(organizationId, organization.currency);
  const plan = await getPlan(subscription.planKey, organizationId);
  const activeAddOns = await getActiveAddOnModules(organizationId, plan);
  const includedModules = [...plan.includedModules, ...activeAddOns].map((moduleKey) => ({
    key: moduleKey,
    name: moduleLabels[moduleKey],
    source: plan.includedModules.includes(moduleKey) ? "plan" : "paid_add_on"
  }));
  const marketAddOnPrices = Object.fromEntries((await getEffectivePlanCatalogue()).map((item) => [item.key, item.monthlyPrice])) as Partial<Record<ManagedModuleKey, number>>;
  const agreedAddOnPriceMap = await resolveRecurringPrices(activeAddOns.map((moduleKey) => ({
    organizationId, planKey: moduleKey, source: "ADD_ON" as const,
    fallbackMonthlyPrice: marketAddOnPrices[moduleKey] ?? addOnPrices[moduleKey]
  })));
  const effectiveAddOnPrices = Object.fromEntries(activeAddOns.map((moduleKey) => [
    moduleKey,
    agreedAddOnPriceMap.get(`${organizationId}:${moduleKey}:ADD_ON`) ?? marketAddOnPrices[moduleKey] ?? addOnPrices[moduleKey]
  ]));
  const billing = calculateSubscriptionBilling(plan, activeAddOns, effectiveAddOnPrices);

  return {
    planName: plan.name,
    planKey: plan.key,
    subscriptionStatus: subscription.status,
    renewalDate: subscription.renewalDate,
    monthlyCost: billing.totalMonthlyCost,
    currency: subscription.currency,
    includedModules,
    packages: plan.features,
    billing,
    cancellation: {
      scheduled: subscription.cancelAtPeriodEnd,
      effectiveDate: subscription.cancelAtPeriodEnd ? subscription.renewalDate : null
    }
  };
};

export const getCurrentSubscription = async (req: Request) => {
  return buildCurrentSubscription(req.organizationId!);
};

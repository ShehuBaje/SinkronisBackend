import type { Request } from "express";
import { badRequest, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { billingPlans as sharedBillingPlans, moduleLabels, type BillingCycle, type BillingPlanKey } from "../billing/billing.catalog";
import { getEffectivePlanCatalogue, resolveRecurringPrices } from "../billing/pricing.service";

const subscriptionConfigKey = "billing.subscription";

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
  const baseMonthlyPrice = monthlyCost;
  return { ...plan, baseMonthlyPrice, monthlyCost, yearlyCost: monthlyCost * 12 };
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

const buildCurrentSubscription = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, currency: true }
  });

  if (!organization) throw notFound("Organization not found");

  const subscription = await getSubscriptionConfig(organizationId, organization.currency);
  const plan = await getPlan(subscription.planKey, organizationId);
  const includedModules = plan.includedModules.map((moduleKey) => ({
    key: moduleKey,
    name: moduleLabels[moduleKey],
    source: "plan"
  }));

  return {
    planName: plan.name,
    planKey: plan.key,
    subscriptionStatus: subscription.status,
    renewalDate: subscription.renewalDate,
    monthlyCost: plan.monthlyCost,
    currency: subscription.currency,
    includedModules,
    packages: plan.features,
    billing: { baseMonthlyCost: plan.baseMonthlyPrice, totalMonthlyCost: plan.monthlyCost },
    cancellation: {
      scheduled: subscription.cancelAtPeriodEnd,
      effectiveDate: subscription.cancelAtPeriodEnd ? subscription.renewalDate : null
    }
  };
};

export const getCurrentSubscription = async (req: Request) => {
  return buildCurrentSubscription(req.organizationId!);
};

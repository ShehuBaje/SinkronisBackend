import { Prisma } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { billingPlans, type BillingPlanKey } from "./billing.catalog";

export const NGN = "NGN" as const;
export const toMinorUnits = (amount: number | string | Prisma.Decimal) => Math.round(Number(amount) * 100);
export const fromMinorUnits = (amount: number) => amount / 100;
export const sumMoney = (amounts: Array<number | string | Prisma.Decimal>) =>
  fromMinorUnits(amounts.reduce<number>((total, amount) => total + toMinorUnits(amount), 0));
export const revenueContributionPercentage = (componentRevenue: number, totalRevenue: number) =>
  totalRevenue === 0 ? 0 : Number(((toMinorUnits(componentRevenue) / toMinorUnits(totalRevenue)) * 100).toFixed(2));

export type RecurringPriceComponent = {
  organizationId: string;
  planKey: string;
  source: "BASE_PLAN" | "ADD_ON";
  fallbackMonthlyPrice: number;
};

export const resolveRecurringPrices = async (components: RecurringPriceComponent[], at = new Date()) => {
  if (!components.length) return new Map<string, number>();
  const planKeys = [...new Set(components.map((component) => component.planKey))];
  const organizationIds = [...new Set(components.map((component) => component.organizationId))];
  const [plans, agreements] = await Promise.all([
    prisma.billingProductPlan.findMany({
      where: { key: { in: planKeys }, status: "ACTIVE" },
      include: { prices: { where: { effectiveAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: { effectiveAt: "desc" } } }
    }),
    prisma.subscriptionPriceAgreement.findMany({
      where: { organizationId: { in: organizationIds }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
      select: { organizationId: true, plan: { select: { key: true } }, source: true, monthlyPrice: true }
    })
  ]);
  const effectivePrice = new Map(plans.map((plan) => [plan.key, plan.prices[0] ? Number(plan.prices[0].monthlyPrice) : undefined]));
  const agreedPrice = new Map(agreements.map((agreement) => [
    `${agreement.organizationId}:${agreement.plan.key}:${agreement.source}`,
    Number(agreement.monthlyPrice)
  ]));
  return new Map(components.map((component) => {
    const key = `${component.organizationId}:${component.planKey}:${component.source}`;
    return [key, agreedPrice.get(key) ?? effectivePrice.get(component.planKey) ?? component.fallbackMonthlyPrice];
  }));
};

export const getFallbackPrice = (key: string) => {
  const plan = billingPlans.find((candidate) => candidate.key === key);
  return plan?.monthlyCost ?? 0;
};

export const getEffectivePlanCatalogue = async (at = new Date()) => {
  const plans = await prisma.billingProductPlan.findMany({
    where: { status: { not: "ARCHIVED" }, key: { in: billingPlans.map((plan) => plan.key) } },
    include: {
      modules: { orderBy: { moduleKey: "asc" } },
      features: { include: { feature: true } },
      prices: { where: { effectiveAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: { effectiveAt: "desc" } }
    },
    orderBy: { createdAt: "asc" }
  });
  const allFeatures = await prisma.billingFeature.findMany({ where: { status: "ACTIVE" } });
  return plans.map((plan) => {
    const moduleKeys = plan.modules.map((module) => module.moduleKey);
    const directFeatures = plan.features.map(({ feature }) => feature);
    const inheritedFeatures = moduleKeys.length > 1
      ? allFeatures.filter((feature) => feature.moduleKey && moduleKeys.includes(feature.moduleKey))
      : [];
    const featureMap = new Map([...inheritedFeatures, ...directFeatures].map((feature) => [feature.id, feature]));
    const fallback = getFallbackPrice(plan.key);
    return {
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      pricingModel: plan.pricingModel,
      rowVersion: plan.rowVersion,
      monthlyPrice: plan.prices[0] ? Number(plan.prices[0].monthlyPrice) : fallback,
      currentPriceVersionId: plan.prices[0]?.id ?? null,
      includedModules: moduleKeys,
      features: [...featureMap.values()].map((feature) => ({
        id: feature.id, name: feature.name, description: feature.description,
        module: feature.moduleKey, status: feature.status
      })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    };
  });
};

export const builtinPlanKey = (value: string): BillingPlanKey | null =>
  billingPlans.some((plan) => plan.key === value) ? value as BillingPlanKey : null;

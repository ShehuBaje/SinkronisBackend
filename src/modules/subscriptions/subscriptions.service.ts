import type { Request } from "express";
import { badRequest, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { createAuditLog } from "../admin/admin.audit";
import { subscriptionSeatsUpdateSchema } from "./subscriptions.validation";
import { billingPlans as sharedBillingPlans, moduleLabels, modulePrices as addOnPrices, type BillingCycle, type BillingModuleKey as ManagedModuleKey, type BillingPlanKey } from "../billing/billing.catalog";
import { getEffectivePlanCatalogue, resolveRecurringPrices } from "../billing/pricing.service";

type SubscriptionPlan = (typeof sharedBillingPlans)[number] & { includedSeats: number | null; maxSeats: number | null; priceLabel?: string };

const seatPricePerMonth = 0;

const subscriptionConfigKey = "billing.subscription";
const addOnSubscriptionPrefix = "billing.addons";

const subscriptionPlans = sharedBillingPlans.map((plan) => ({ ...plan, includedSeats: null, maxSeats: null, priceLabel: undefined }));

const prismaAny = prisma as any;

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
    totalSeats: typeof configured.totalSeats === "number" ? configured.totalSeats : undefined,
    cancelAtPeriodEnd: configured.cancelAtPeriodEnd === true
  };
};

const upsertSubscriptionConfig = async (organizationId: string, value: Record<string, unknown>) => {
  return prisma.systemConfig.upsert({
    where: {
      organizationId_key: {
        organizationId,
        key: subscriptionConfigKey
      }
    },
    create: {
      organizationId,
      key: subscriptionConfigKey,
      value: value as any
    },
    update: {
      value: value as any
    }
  });
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

const getSeatsUsed = async (organizationId: string) => {
  return prisma.user.count({
    where: {
      organizationId,
      isActive: true
    }
  });
};

const calculateSeatBilling = (plan: SubscriptionPlan, totalSeats: number, activeAddOns: ManagedModuleKey[], effectiveAddOnPrices: Partial<Record<ManagedModuleKey, number>> = {}) => {
  const includedSeats = plan.includedSeats ?? totalSeats;
  const extraSeats = Math.max(totalSeats - includedSeats, 0);
  const additionalMonthlySeatCost = extraSeats * seatPricePerMonth;
  const activeAddOnMonthlyCost = activeAddOns.reduce((sum, moduleKey) => sum + (effectiveAddOnPrices[moduleKey] ?? addOnPrices[moduleKey]), 0);
  const newMonthlyCost =
    plan.priceLabel === "Custom" ? null : plan.monthlyCost + additionalMonthlySeatCost + activeAddOnMonthlyCost;

  return {
    baseMonthlyCost: plan.priceLabel === "Custom" ? null : plan.monthlyCost,
    extraSeats,
    seatPricePerMonth,
    additionalMonthlySeatCost,
    activeAddOnMonthlyCost,
    newMonthlyCost
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
  const seatsUsed = await getSeatsUsed(organizationId);
  const totalSeats = subscription.totalSeats ?? Math.max(plan.includedSeats ?? seatsUsed, seatsUsed);
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
  const seatBilling = calculateSeatBilling(plan, totalSeats, activeAddOns, effectiveAddOnPrices);

  return {
    planName: plan.name,
    planKey: plan.key,
    subscriptionStatus: subscription.status,
    renewalDate: subscription.renewalDate,
    monthlyCost: seatBilling.newMonthlyCost,
    currency: subscription.currency,
    seatsUsed,
    totalSeatsAllocated: totalSeats,
    totalSeats,
    maxSeats: plan.maxSeats,
    includedSeatCount: plan.includedSeats,
    remainingSeats: Math.max(totalSeats - seatsUsed, 0),
    includedModules,
    packages: plan.features,
    usageOverview: {
      seatsUsed,
      totalSeats,
      remainingSeats: Math.max(totalSeats - seatsUsed, 0)
    },
    seatBilling,
    cancellation: {
      scheduled: subscription.cancelAtPeriodEnd,
      effectiveDate: subscription.cancelAtPeriodEnd ? subscription.renewalDate : null
    }
  };
};

export const getCurrentSubscription = async (req: Request) => {
  return buildCurrentSubscription(req.organizationId!);
};

export const updateSubscriptionSeats = async (req: Request) => {
  const payload = subscriptionSeatsUpdateSchema.parse(req.body);
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });

  if (!organization) throw notFound("Organization not found");

  const subscription = await getSubscriptionConfig(req.organizationId!, organization.currency);
  const plan = await getPlan(subscription.planKey, req.organizationId!);
  const seatsUsed = await getSeatsUsed(req.organizationId!);

  if (payload.totalSeats < seatsUsed) {
    throw badRequest("totalSeats cannot be less than the number of seats currently used", {
      seatsUsed,
      totalSeats: payload.totalSeats
    });
  }

  if (plan.maxSeats !== null && payload.totalSeats > plan.maxSeats) {
    throw badRequest("totalSeats exceeds the maximum seat allocation for the current plan", {
      maxSeats: plan.maxSeats,
      totalSeats: payload.totalSeats
    });
  }

  const currentConfig = {
    status: subscription.status,
    planKey: subscription.planKey,
    billingCycle: subscription.billingCycle,
    currency: subscription.currency,
    renewalDate: subscription.renewalDate.toISOString(),
    totalSeats: payload.totalSeats,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
  };

  await upsertSubscriptionConfig(req.organizationId!, currentConfig);

  await createAuditLog({
    organizationId: req.organizationId!,
    actorUserId: req.user?.id,
    action: "SUBSCRIPTION_SEATS_UPDATED",
    resource: "BILLING_SUBSCRIPTION",
    summary: `Updated subscription seats to ${payload.totalSeats}`,
    metadata: {
      previousTotalSeats: subscription.totalSeats ?? plan.includedSeats,
      totalSeats: payload.totalSeats,
      seatsUsed
    }
  });

  return {
    message: "Subscription seats updated",
    subscription: await buildCurrentSubscription(req.organizationId!)
  };
};

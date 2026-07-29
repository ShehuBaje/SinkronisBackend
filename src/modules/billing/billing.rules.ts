export type SubscriptionLifecycleStatus = "ACTIVE" | "PENDING" | "EXPIRED" | "CANCELLED" | "TRIALING" | "PAST_DUE";

export const deriveSubscriptionStatus = (input: { status: SubscriptionLifecycleStatus; now: Date; renewalDate: Date; cancelAtPeriodEnd: boolean; paymentVerifiedAt?: Date | null }) => {
  if (input.cancelAtPeriodEnd && input.now >= input.renewalDate) return "CANCELLED" as const;
  if (input.status === "PENDING" && input.paymentVerifiedAt && input.paymentVerifiedAt <= input.now) return "ACTIVE" as const;
  if (input.status === "ACTIVE" && input.now >= input.renewalDate) return "EXPIRED" as const;
  return input.status;
};

export const isRenewalReminderDue = (renewalDate: Date, asOf: Date) => {
  const reminder = new Date(renewalDate); reminder.setDate(reminder.getDate() - 15);
  return reminder.toISOString().slice(0, 10) === asOf.toISOString().slice(0, 10);
};

export const passesLuhn = (value: string) => {
  const digits = value.replace(/\s/g, ""); if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0; let double = false;
  for (let index = digits.length - 1; index >= 0; index--) { let digit = Number(digits[index]); if (double) { digit *= 2; if (digit > 9) digit -= 9; } sum += digit; double = !double; }
  return sum % 10 === 0;
};

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sendTransactionalNotificationEmail } from "../modules/auth/auth.mailer";

export interface DeliverUserNotificationInput {
  organizationId: string;
  recipientUserId: string;
  moduleKey: "hris" | "payroll" | "accounting";
  categoryKey: string;
  eventKey: string;
  type: string;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Persists one deduplicated recipient notification and attempts enabled delivery
 * channels. Tenant preferences default to enabled, matching the settings UI.
 * Delivery failure is recorded and deliberately does not undo the domain action.
 */
export const deliverUserNotification = async (input: DeliverUserNotificationInput) => {
  const [recipient, category, channels] = await Promise.all([
    prisma.user.findFirst({
      where: { id: input.recipientUserId, organizationId: input.organizationId, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true }
    }),
    prisma.notificationCategory.findFirst({
      where: { moduleKey: input.moduleKey, key: input.categoryKey, isActive: true },
      select: { id: true }
    }),
    prisma.notificationChannel.findMany({
      where: { key: { in: ["IN_APP", "EMAIL"] }, isActive: true },
      select: { id: true, key: true }
    })
  ]);
  if (!recipient || !category) return { status: "SKIPPED" as const, reason: !recipient ? "RECIPIENT_UNAVAILABLE" : "CATEGORY_UNAVAILABLE" };

  const preferences = await prisma.tenantNotificationPreference.findMany({
    where: { organizationId: input.organizationId, categoryId: category.id, channelId: { in: channels.map((channel) => channel.id) } },
    select: { channelId: true, enabled: true }
  });
  const preferenceByChannel = new Map(preferences.map((preference) => [preference.channelId, preference.enabled]));
  const enabled = (key: string) => {
    const channel = channels.find((item) => item.key === key);
    return Boolean(channel) && (preferenceByChannel.get(channel!.id) ?? true);
  };
  const inAppEnabled = enabled("IN_APP");
  const emailEnabled = enabled("EMAIL");

  let notification;
  try {
    notification = await prisma.userNotification.create({
      data: {
        organizationId: input.organizationId,
        recipientUserId: recipient.id,
        categoryId: category.id,
        eventKey: input.eventKey,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata,
        inAppStatus: inAppEnabled ? "DELIVERED" : "DISABLED",
        emailStatus: emailEnabled ? "PENDING" : "DISABLED",
        deliveredAt: inAppEnabled ? new Date() : null
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.userNotification.findUnique({
        where: { organizationId_recipientUserId_eventKey: { organizationId: input.organizationId, recipientUserId: recipient.id, eventKey: input.eventKey } }
      });
      return { status: "DUPLICATE" as const, notification: existing };
    }
    throw error;
  }

  if (!emailEnabled) return { status: inAppEnabled ? "DELIVERED" as const : "DISABLED" as const, notification };
  try {
    await sendTransactionalNotificationEmail({ to: recipient.email, recipientName: `${recipient.firstName} ${recipient.lastName}`.trim(), subject: input.title, message: input.message });
    notification = await prisma.userNotification.update({ where: { id: notification.id }, data: { emailStatus: "SENT", deliveredAt: notification.deliveredAt ?? new Date() } });
    return { status: "DELIVERED" as const, notification };
  } catch {
    notification = await prisma.userNotification.update({ where: { id: notification.id }, data: { emailStatus: "FAILED", emailError: "Notification email delivery failed" } });
    return { status: inAppEnabled ? "PARTIAL" as const : "FAILED" as const, notification };
  }
};

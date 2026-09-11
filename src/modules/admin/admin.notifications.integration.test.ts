import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { app } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../core/prisma";

const enabled = process.env.RUN_ADMIN_NOTIFICATIONS_HTTP_INTEGRATION === "true";

test("authenticated Tenant Admin notifications and announcements HTTP lifecycle", { skip: !enabled, timeout: 240_000 }, async () => {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `Notifications E2E ${suffix}`, slug: `notifications-e2e-${suffix}` } });
  let announcementId: string | undefined;
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    const [ownerRole, viewerRole] = await Promise.all([
      prisma.role.create({ data: { organizationId: organization.id, name: "Owner", isSystem: true } }),
      prisma.role.create({ data: { organizationId: organization.id, name: `No Access ${suffix}` } })
    ]);
    const [owner, secondOwner, unauthorized] = await Promise.all([
      prisma.user.create({ data: { organizationId: organization.id, roleId: ownerRole.id, email: `owner-${suffix}@example.test`, passwordHash: "integration-test-only", firstName: "Ada", lastName: "Owner" } }),
      prisma.user.create({ data: { organizationId: organization.id, roleId: ownerRole.id, email: `owner-two-${suffix}@example.test`, passwordHash: "integration-test-only", firstName: "Chidi", lastName: "Owner" } }),
      prisma.user.create({ data: { organizationId: organization.id, roleId: viewerRole.id, email: `viewer-${suffix}@example.test`, passwordHash: "integration-test-only", firstName: "No", lastName: "Access" } })
    ]);
    await prisma.systemConfig.create({ data: { organizationId: organization.id, key: "billing.subscription", value: { status: "ACTIVE", planKey: "hris" } } });
    const announcement = await prisma.platformAnnouncement.create({ data: { title: `Feature verification ${suffix}`, summary: "A concise persisted announcement summary.", description: "Complete persisted announcement content for the Tenant Admin integration test.", type: "FEATURE", contentFormat: "MARKDOWN", isPublished: true, publishedAt: new Date(Date.now() - 60_000), learnMoreUrl: "https://example.test/features" } });
    announcementId = announcement.id;

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}${env.API_PREFIX}/admin/notifications-alerts`;
    const token = (userId: string) => jwt.sign({ organizationId: organization.id }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: "10m" });
    const request = async (path: string, userId = owner.id, init: RequestInit = {}) => {
      const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token(userId)}`, "content-type": "application/json", ...init.headers } });
      return { response, body: await response.json() };
    };

    const overview = await request("/overview");
    assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
    assert.equal(overview.body.data.unreadAnnouncementCount, 1);

    const inApp = await request("/preferences/IN_APP");
    const email = await request("/preferences/EMAIL");
    assert.equal(inApp.response.status, 200, JSON.stringify(inApp.body));
    assert.equal(email.response.status, 200, JSON.stringify(email.body));
    assert.equal(inApp.body.data.channel.key, "IN_APP");
    assert.equal(email.body.data.channel.key, "EMAIL");
    const hris = inApp.body.data.modules.find((module: any) => module.moduleKey === "hris");
    const payroll = inApp.body.data.modules.find((module: any) => module.moduleKey === "payroll");
    assert.equal(hris.entitled, true); assert.equal(hris.toggleAll, true);
    assert.equal(payroll.entitled, false); assert.equal(payroll.controlsEnabled, false); assert.equal(payroll.toggleAll, false);
    assert.equal(typeof hris.entitled, "boolean"); assert.equal(typeof hris.notifications[0].enabled, "boolean");

    const invalidChannel = await request("/preferences/SMS");
    assert.equal(invalidChannel.response.status, 400, JSON.stringify(invalidChannel.body));
    const categoryId = hris.notifications[0].notificationId;
    const changed = await request(`/preferences/IN_APP/modules/hris/categories/${categoryId}`, owner.id, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.data.modules.find((module: any) => module.moduleKey === "hris").moduleStatus, "PARTIAL");
    const emailAfter = await request("/preferences/EMAIL");
    assert.equal(emailAfter.body.data.modules.find((module: any) => module.moduleKey === "hris").notifications.find((item: any) => item.notificationId === categoryId).enabled, true);

    const list = await request("/announcements");
    assert.equal(list.response.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.metadata.unreadCount, 1);
    assert.equal(list.body.data[0].readStatus, "UNREAD");
    const detail = await request(`/announcements/${announcement.id}`);
    assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.data.announcementId, announcement.id);
    assert.equal((await request("/announcements/missing-announcement")).response.status, 404);
    assert.equal((await request(`/announcements/${announcement.id}/read`, owner.id, { method: "POST" })).response.status, 200);
    assert.equal((await request(`/announcements/${announcement.id}`, secondOwner.id)).body.data.readStatus, "UNREAD");
    const readList = await request("/announcements?readStatus=READ");
    assert.equal(readList.body.metadata.unreadCount, 0); assert.equal(readList.body.data[0].readStatus, "READ");
    const markAll = await request("/announcements/read-all", secondOwner.id, { method: "POST" });
    assert.equal(markAll.response.status, 200); assert.equal(markAll.body.data.markedRead, 1);
    assert.equal((await request("/overview", unauthorized.id)).response.status, 403);
    assert.equal(await prisma.tenantNotificationPreference.count({ where: { organizationId: organization.id } }), 1);
  } finally {
    if (announcementId) await prisma.platformAnnouncement.delete({ where: { id: announcementId } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.role.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  }
});

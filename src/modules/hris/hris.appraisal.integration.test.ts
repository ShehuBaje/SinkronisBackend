import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { getEmployeeInbox } from "../employee/employee.service";
import { acknowledgeAppraisal, approveAppraisalHR, confirmEmployeeAppraisalGoals, createAppraisalCycle, createAppraisalGoal, createAppraisalTemplate, getAppraisalDetail, getManagerReview, listAppraisals, openAppraisalSelfAssessment, saveManagerReview, saveSelfAssessment, scoreAppraisalGoal } from "./hris.service";
import { managerReviewSchema } from "./hris.validation";

const enabled = process.env.RUN_APPRAISAL_DB_INTEGRATION === "true";
const permissions = {
  employee: [] as AuthUser["permissions"],
  manager: ["hris:appraisals:view", "hris:appraisals:update"] as AuthUser["permissions"],
  hr: ["hris:appraisals:view", "hris:appraisals:update", "admin:staff:update"] as AuthUser["permissions"]
};

test("database-backed appraisal lifecycle preserves tenancy, authorization, workflow, audit, notifications, inbox, and history", { skip: !enabled, timeout: 240_000 }, async () => {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `Appraisal E2E ${suffix}`, slug: `appraisal-e2e-${suffix}` } });
  try {
    const [emailChannel, notificationCategories] = await Promise.all([
      prisma.notificationChannel.findFirst({ where: { key: "EMAIL", isActive: true }, select: { id: true } }),
      prisma.notificationCategory.findMany({ where: { moduleKey: "hris", key: { in: ["record-updates", "approvals-requests"] }, isActive: true }, select: { id: true } })
    ]);
    if (emailChannel && notificationCategories.length) {
      await prisma.tenantNotificationPreference.createMany({
        data: notificationCategories.map((category) => ({ organizationId: organization.id, channelId: emailChannel.id, categoryId: category.id, enabled: false })),
        skipDuplicates: true
      });
    }
    const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Appraisal E2E Role ${suffix}` } });
    const department = await prisma.department.create({ data: { organizationId: organization.id, name: `Engineering ${suffix}` } });
    const managerEmployee = await prisma.employee.create({ data: { organizationId: organization.id, departmentId: department.id, employeeNo: `MGR-${suffix}`, firstName: "Chidi", lastName: "Eze", email: `manager-${suffix}@example.test`, jobTitle: "Engineering Manager", lifecycleStatus: "CONFIRMED" } });
    const employee = await prisma.employee.create({ data: { organizationId: organization.id, departmentId: department.id, managerId: managerEmployee.id, employeeNo: `EMP-${suffix}`, firstName: "Ada", lastName: "Okafor", email: `employee-${suffix}@example.test`, jobTitle: "Software Engineer", lifecycleStatus: "CONFIRMED" } });
    const outsiderEmployee = await prisma.employee.create({ data: { organizationId: organization.id, departmentId: department.id, employeeNo: `OUT-${suffix}`, firstName: "Other", lastName: "Manager", email: `outsider-${suffix}@example.test`, jobTitle: "Manager", lifecycleStatus: "CONFIRMED" } });
    const [managerUser, employeeUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, employeeId: managerEmployee.id, email: managerEmployee.email, passwordHash: "integration-test-only", firstName: managerEmployee.firstName, lastName: managerEmployee.lastName } }),
      prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, employeeId: employee.id, email: employee.email, passwordHash: "integration-test-only", firstName: employee.firstName, lastName: employee.lastName } }),
      prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, employeeId: outsiderEmployee.id, email: outsiderEmployee.email, passwordHash: "integration-test-only", firstName: outsiderEmployee.firstName, lastName: outsiderEmployee.lastName } })
    ]);
    const actor = (user: typeof managerUser, granted: AuthUser["permissions"]): AuthUser => ({ id: user.id, organizationId: organization.id, email: user.email, roleId: role.id, isPlatformAdmin: false, permissions: granted });
    const manager = actor(managerUser, permissions.manager); const hr = actor(managerUser, permissions.hr); const worker = actor(employeeUser, permissions.employee); const outsider = actor(outsiderUser, permissions.manager);

    const template = await createAppraisalTemplate(organization.id, { name: `Standard Review ${suffix}`, sections: [{ section: "KRA", weight: 80, objectives: [{ title: "Delivery", weight: 80, keyResults: [{ description: "Reduce processing time", kpiWeight: 80, target: 100 }] }] }, { section: "BEHAVIOURAL", weight: 20, objectives: [{ title: "Collaboration", weight: 20, keyResults: [{ description: "Peer satisfaction", kpiWeight: 20, target: 100 }] }] }], reflectionQuestions: [{ id: "achievements", question: "What were your key achievements?", required: true }, { id: "optional-development", question: "Any development requests?", required: false }], managerReviewQuestions: [{ id: "strengths", question: "What are the employee's strengths?", required: true }], quarterScoring: false, signOffTypes: ["EMPLOYEE", "MANAGER", "HR"], isDefault: true }, manager);
    const cycle = await createAppraisalCycle(organization.id, { cycleName: `Annual Review ${suffix}`, templateId: template.id, periodFrom: "2099-01-01", periodTo: "2099-12-31", submissionDeadline: "2100-01-15", launchMode: "LAUNCH_AS_ACTIVE" }, manager);
    const appraisal = await prisma.employeeAppraisal.findFirstOrThrow({ where: { organizationId: organization.id, cycleId: cycle.id, employeeId: employee.id } });

    const overview = await listAppraisals(organization.id, { page: 1, limit: 20, search: "Ada", departmentId: department.id, cycleId: cycle.id }, manager);
    assert.equal(overview.pagination.total, 1); assert.equal(overview.appraisals[0].appraisalId, appraisal.id);
    await assert.rejects(() => getAppraisalDetail("cross-tenant-id", appraisal.id, manager), /not found/i);

    const goal = await createAppraisalGoal(organization.id, appraisal.id, { goalTitle: "Improve delivery quality", description: "Reduce production defects", successCriteria: "Maintain less than two percent defects", targetDate: "2099-12-15" }, manager);
    await assert.rejects(() => createAppraisalGoal(organization.id, appraisal.id, { goalTitle: "Improve delivery quality", description: "Duplicate", successCriteria: "Duplicate", targetDate: "2099-12-15" }, manager), /already exists/i);
    await openAppraisalSelfAssessment(organization.id, appraisal.id, manager);
    const confirmed = await confirmEmployeeAppraisalGoals(organization.id, appraisal.id, worker); assert.equal(confirmed.stage, "SELF_ASSESSMENT");
    const confirmedAgain = await confirmEmployeeAppraisalGoals(organization.id, appraisal.id, worker); assert.equal(confirmedAgain.stage, "SELF_ASSESSMENT");
    assert.equal((await prisma.appraisalGoal.findUniqueOrThrow({ where: { id: goal.id } })).status, "LOCKED");

    const skeleton = [{ section: "KRA", totalWeight: 80, objectives: [{ title: "Delivery", weight: 80, keyResults: [{ keyResult: "Reduce processing time", kpiWeight: 80, target: 100, comment: "Draft one" }] }] }, { section: "BEHAVIOURAL", totalWeight: 20, objectives: [{ title: "Collaboration", weight: 20, keyResults: [{ keyResult: "Peer satisfaction", kpiWeight: 20, target: 100 }] }] }];
    await saveSelfAssessment(organization.id, appraisal.id, { sections: skeleton, reflections: [], submit: false }, worker);
    await saveSelfAssessment(organization.id, appraisal.id, { sections: skeleton, reflections: [{ questionId: "achievements", response: "Improved release quality" }], submit: false }, worker);
    assert.equal(await prisma.appraisalSelfAssessment.count({ where: { organizationId: organization.id, appraisalId: appraisal.id } }), 1);
    await assert.rejects(() => saveSelfAssessment(organization.id, appraisal.id, { sections: skeleton, reflections: [{ questionId: "achievements", response: "Incomplete" }], submit: true }, worker), /requires an achieved value/i);
    const completedSections = [{ ...skeleton[0], objectives: [{ ...skeleton[0].objectives[0], keyResults: [{ ...skeleton[0].objectives[0].keyResults[0], achieved: 110 }] }] }, { ...skeleton[1], objectives: [{ ...skeleton[1].objectives[0], keyResults: [{ ...skeleton[1].objectives[0].keyResults[0], achieved: 90 }] }] }];
    await saveSelfAssessment(organization.id, appraisal.id, { sections: completedSections, reflections: [{ questionId: "achievements", response: "Improved release quality" }], submit: true }, worker);
    await assert.rejects(() => saveSelfAssessment(organization.id, appraisal.id, { sections: completedSections, reflections: [{ questionId: "achievements", response: "Again" }], submit: true }, worker), /not editable/i);
    await assert.rejects(() => getManagerReview(organization.id, appraisal.id, outsider), /not permitted/i);
    assert.equal((await getManagerReview(organization.id, appraisal.id, manager)).stage, "MANAGER_REVIEW");
    assert.equal(managerReviewSchema.safeParse({ goalRatings: [{ goalId: goal.id, rating: 6 }], responses: [], overallFeedback: "Invalid", recommendation: "ON_TRACK", submit: true }).success, false);
    await scoreAppraisalGoal(organization.id, appraisal.id, goal.id, { rating: 4, comment: "Strong result" }, manager);
    await saveManagerReview(organization.id, appraisal.id, { goalRatings: [{ goalId: goal.id, rating: 4, comment: "Strong result" }], responses: [{ questionId: "strengths", response: "Ownership and delivery" }], overallFeedback: "Strong performance throughout the cycle", recommendation: "EXCEEDS_EXPECTATION", submit: true }, manager);
    await approveAppraisalHR(organization.id, appraisal.id, { decision: "APPROVED", hrNotes: "Evidence reviewed" }, hr);
    const released = await getAppraisalDetail(organization.id, appraisal.id, worker); assert.equal(released.stage, "ACKNOWLEDGMENT"); assert.ok(released.managerReview);
    const acknowledged = await acknowledgeAppraisal(organization.id, appraisal.id, { response: "I acknowledge this appraisal" }, worker); assert.equal(acknowledged.stage, "COMPLETED");
    const acknowledgedAgain = await acknowledgeAppraisal(organization.id, appraisal.id, { response: "Duplicate" }, worker); assert.equal(acknowledgedAgain.stage, "COMPLETED");
    await assert.rejects(() => createAppraisalGoal(organization.id, appraisal.id, { goalTitle: "Late goal", description: "Must fail", successCriteria: "Must fail", targetDate: "2099-12-15" }, manager), /locked/i);

    const inbox = await getEmployeeInbox(organization.id, worker, { status: "all", page: 1, limit: 20 });
    assert.equal(inbox.items.filter((item) => item.category === "APPRAISAL").every((item) => item.status === "DONE"), true);
    const auditActions = await prisma.auditLog.findMany({ where: { organizationId: organization.id, resource: { in: ["APPRAISAL", "APPRAISAL_CYCLE", "APPRAISAL_TEMPLATE"] } }, select: { action: true } });
    for (const action of ["HRIS_APPRAISAL_GOAL_PROPOSED", "HRIS_APPRAISAL_GOALS_CONFIRMED", "HRIS_APPRAISAL_SELF_ASSESSMENT_SUBMITTED", "HRIS_APPRAISAL_MANAGER_REVIEW_SUBMITTED", "HRIS_APPRAISAL_HR_APPROVED", "HRIS_APPRAISAL_ACKNOWLEDGED"]) assert.ok(auditActions.some((row) => row.action === action), action);
    const notificationTypes = await prisma.userNotification.findMany({ where: { organizationId: organization.id }, select: { type: true } });
    if (await prisma.notificationCategory.count({ where: { moduleKey: "hris", key: { in: ["record-updates", "approvals-requests"] }, isActive: true } })) assert.ok(notificationTypes.length > 0, "appraisal notifications should persist when categories are configured");
  } finally {
    await prisma.appraisalCycle.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.appraisalTemplate.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.appraisalSetting.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.userNotification.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.employee.updateMany({ where: { organizationId: organization.id }, data: { managerId: null } }).catch(() => undefined);
    await prisma.employee.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.department.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.role.deleteMany({ where: { organizationId: organization.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
  }
});

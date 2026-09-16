import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPORT_QUEUE_NAME,
  LIFECYCLE_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  PAYROLL_QUEUE_NAME,
  SCHEDULED_JOBS,
  scheduledQueueNameForJob
} from "./index";

test("scheduled business jobs route to their canonical worker queues", () => {
  assert.equal(scheduledQueueNameForJob(SCHEDULED_JOBS.accountingExports.jobName), EXPORT_QUEUE_NAME);
  assert.equal(scheduledQueueNameForJob(SCHEDULED_JOBS.organizationPrivacy.jobName), EXPORT_QUEUE_NAME);
  assert.equal(scheduledQueueNameForJob(SCHEDULED_JOBS.subscriptionLifecycle.jobName), LIFECYCLE_QUEUE_NAME);
  assert.equal(scheduledQueueNameForJob(SCHEDULED_JOBS.subscriptionRenewalReminders.jobName), NOTIFICATION_QUEUE_NAME);
  assert.equal(scheduledQueueNameForJob(SCHEDULED_JOBS.payrollRecovery.jobName), PAYROLL_QUEUE_NAME);
});

test("unknown scheduled job names are rejected with an actionable error", () => {
  assert.throws(() => scheduledQueueNameForJob("unknown-job"), /Unsupported scheduled job: unknown-job/);
});

test("scheduler identities are deterministic and unique across restarts", () => {
  const definitions = Object.values(SCHEDULED_JOBS);
  assert.equal(new Set(definitions.map((definition) => definition.schedulerId)).size, definitions.length);
  assert.equal(new Set(definitions.map((definition) => `${definition.queueName}:${definition.jobName}`)).size, definitions.length);
});

import type { z } from "zod";
import type { clockInSchema, clockOutParamsSchema } from "./hris.validation";

export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutParams = z.infer<typeof clockOutParamsSchema>;

export type HRISTrend = "UP" | "DOWN" | "UNCHANGED";

export interface HRISAttendanceMetric {
  count: number;
  previousDayCount: number;
  difference: number;
  trend: HRISTrend;
}

export interface HRISDashboardAttendanceCounts {
  onTime: number;
  lateClockIn: number;
  earlyClockIn: number;
  absent: number;
  noClockIn: number;
  noClockOut: number;
}

export interface LeaveDecisionInput {
  leaveRequestId: string;
  organizationId: string;
  actorUserId: string;
  decision: "APPROVED" | "REJECTED";
  reason?: string;
}

export type AppraisalWorkflowStage = "GOAL_SETTING" | "SELF_ASSESSMENT" | "MANAGER_REVIEW" | "HR_APPROVAL" | "ACKNOWLEDGMENT" | "COMPLETED";
export type AppraisalCycleStatus = "DRAFT" | "ACTIVE" | "COMPLETED";
export type AppraisalReviewFrequency = "MONTHLY" | "QUARTERLY" | "BI_ANNUAL" | "ANNUAL";
export type AppraisalRating = "OUTSTANDING" | "ABOVE_EXPECTATION" | "MEETS_EXPECTATION" | "BELOW_EXPECTATION" | "POOR_PERFORMANCE";
export type AppraisalSignOffType = "EMPLOYEE" | "MANAGER" | "HR";
export type ConductRecordType = "QUERY" | "SUSPENSION";
export type ConductStatus = "IN_PROGRESS" | "RESOLVED" | "DISMISSED" | "ACTIVE" | "COMPLETED" | "CANCELLED";

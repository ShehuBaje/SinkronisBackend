import { z } from "zod";
import {
  appraisalCreateSchema,
  appraisalUpdateSchema,
  conductCreateSchema,
  conductUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  leaveCreateSchema,
  leaveUpdateSchema
} from "../common.schemas";

export const clockInSchema = z.object({
  employeeId: z.string().min(1),
  note: z.string().optional()
});

export const clockOutParamsSchema = z.object({ id: z.string().min(1) });
export const leaveDecisionParamsSchema = z.object({ id: z.string().trim().min(1).max(191) }).strict();
export const rejectLeaveSchema = z.object({ reason: z.string().trim().min(3).max(1000).optional() }).strict();
export const tenantLeaveCreateSchema = leaveCreateSchema.omit({ status: true }).extend({
  status: z.enum(["DRAFT", "PENDING"]).optional()
});
export const tenantLeaveUpdateSchema = leaveUpdateSchema.omit({ status: true, reviewedBy: true, reviewedAt: true }).extend({
  status: z.enum(["DRAFT", "PENDING", "CANCELLED"]).optional()
});

export const attendanceCreateSchema = z.object({
  employeeId: z.string().min(1),
  clockInAt: z.coerce.date(),
  clockOutAt: z.coerce.date().optional(),
  source: z.enum(["WEB", "MOBILE", "ADMIN"]).optional(),
  note: z.string().optional()
});

export const attendanceUpdateSchema = z.object({
  clockInAt: z.coerce.date().optional(),
  clockOutAt: z.coerce.date().optional(),
  source: z.enum(["WEB", "MOBILE", "ADMIN"]).optional(),
  note: z.string().optional()
});

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
};
const id = z.string().trim().min(1).max(191);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

export const employeeParamsSchema = z.object({ employeeId: id }).strict();
export const employeeListQuerySchema = z.object({
  ...pageFields, search: z.string().trim().min(1).max(100).optional(), departmentId: id.optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED", "CONFIRMED", "PROBATION", "EXITED"]).optional(),
  sortBy: z.enum(["name", "employeeId", "joinedDate", "status", "department"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc")
}).strict();
export const lifecycleQuerySchema = employeeListQuerySchema.extend({ status: z.enum(["PROBATION", "CONFIRMED", "EXITED"]) });
export const employeeHistoryQuerySchema = z.object({ ...pageFields }).strict();
export const employeeDocumentParamsSchema = z.object({ employeeId: id, documentId: id }).strict();
export const updateEmployeeStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED", "CONFIRMED", "PROBATION", "EXITED"]), effectiveDate: dateOnly
}).strict();
export const employeeManagementSchema = z.object({
  employeeId: z.string().trim().min(1).max(50).optional(), employeeNo: z.string().trim().min(1).max(50).optional(),
  firstName: z.string().trim().min(1).max(100).optional(), lastName: z.string().trim().min(1).max(100).optional(),
  fullName: z.string().trim().min(2).max(201).optional(), email: z.string().trim().email().optional(), personalEmail: z.string().trim().email().optional(),
  phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).optional(), departmentId: id.optional(), teamId: id.optional(),
  managerId: id.optional(),
  position: z.string().trim().min(1).max(150).optional(), role: z.string().trim().min(1).max(150).optional(),
  joinedDate: z.coerce.date().optional(), dateJoined: z.coerce.date().optional(), dateOfBirth: z.coerce.date().max(new Date(), "Date of birth cannot be in the future").optional(), gender: z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).optional(), workMode: z.enum(["ONSITE", "REMOTE", "HYBRID"]).optional(),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER"]).optional(), address: z.string().trim().max(1000).optional(),
  city: z.string().trim().max(100).optional(), state: z.string().trim().max(100).optional(), nationality: z.string().trim().max(100).optional(),
  monthlySalary: z.coerce.number().finite().min(0).optional(), earnings: z.coerce.number().finite().min(0).optional(), bankName: z.string().trim().max(150).optional(), bankCode: z.string().trim().max(20).optional(),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/).optional(), accountName: z.string().trim().min(2).max(150).optional(), accountType: z.enum(["SAVINGS", "CURRENT"]).optional(), taxId: z.string().trim().max(100).optional(), pensionId: z.string().trim().max(100).optional(),
  lifecycleStatus: z.enum(["PROBATION", "CONFIRMED", "EXITED"]).optional(), operationalStatus: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(), employeeStatus: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(),
  profileImageUrl: z.string().url().optional(), nextOfKinName: z.string().trim().max(201).optional(), nextOfKinFirstName: z.string().trim().max(100).optional(), nextOfKinLastName: z.string().trim().max(100).optional(), nextOfKinPhone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).optional(), nextOfKinContact: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).optional(),
  nextOfKinAddress: z.string().trim().max(1000).optional(), nextOfKinRelationship: z.string().trim().max(100).optional(),
  guarantorFirstName: z.string().trim().max(100).optional(), guarantorLastName: z.string().trim().max(100).optional(), guarantorRelationship: z.string().trim().max(100).optional(),
  guarantorPhone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).optional(), guarantorAddress: z.string().trim().max(1000).optional()
  ,documentType: z.enum(["IDENTIFICATION", "CERTIFICATE", "CONTRACT", "TAX_DOCUMENT", "PENSION_DOCUMENT", "OTHER"]).optional()
}).strict();
export const createManagedEmployeeSchema = employeeManagementSchema
  .refine((v) => Boolean(v.employeeId ?? v.employeeNo) && Boolean(v.firstName || v.fullName) && Boolean(v.lastName || v.fullName) && Boolean(v.email ?? v.personalEmail), "Employee ID, name, and personal email are required")
  .refine((v) => !v.email || !v.personalEmail || v.email.toLowerCase() === v.personalEmail.toLowerCase(), { message: "email and personalEmail must match when both are provided", path: ["personalEmail"] })
  .refine((v) => !v.joinedDate || !v.dateJoined || v.joinedDate.getTime() === v.dateJoined.getTime(), { message: "joinedDate and dateJoined must match when both are provided", path: ["dateJoined"] })
  .refine((v) => v.monthlySalary === undefined || v.earnings === undefined || v.monthlySalary === v.earnings, { message: "monthlySalary and earnings must match when both are provided", path: ["earnings"] });
export const updateManagedEmployeeSchema = employeeManagementSchema.refine((v) => Object.keys(v).length > 0, "At least one field is required");
export const bankUpdateRequestParamsSchema = z.object({ requestId: id }).strict();
export const bankUpdateRequestsQuerySchema = z.object({ ...pageFields, status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]).default("PENDING") }).strict();
export const rejectBankUpdateRequestSchema = z.object({ reviewNote: z.string().trim().min(3).max(2000) }).strict();
export const approveBankUpdateRequestSchema = z.object({ reviewNote: z.string().trim().max(2000).optional() }).strict();

export const attendanceDateQuerySchema = z.object({ date: dateOnly.optional() }).strict();
export const attendanceLogsQuerySchema = z.object({
  ...pageFields, search: z.string().trim().min(1).max(100).optional(), departmentId: id.optional(),
  status: z.enum(["ALL", "ABSENT", "EARLY_DEPARTURE", "ON_LEAVE", "LATE", "NO_CLOCK_OUT", "OVERTIME", "ON_TIME"]).default("ALL"),
  date: dateOnly.optional(), from: dateOnly.optional(), to: dateOnly.optional()
}).strict().refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from must not be later than to" });
export const attendanceParamsSchema = z.object({ attendanceId: id }).strict();
export const attendanceOverrideSchema = z.object({ clockIn: timeOnly.optional(), clockOut: timeOnly.optional(), status: z.enum(["ABSENT", "EARLY_DEPARTURE", "ON_LEAVE", "LATE", "NO_CLOCK_OUT", "OVERTIME", "ON_TIME"]).optional(), reason: z.string().trim().min(3).max(1000) }).strict();
export const createAttendanceDisputeSchema = z.object({ issueType: z.enum(["MISSING_CLOCK_IN", "MISSING_CLOCK_OUT", "SYSTEM_ERROR", "WRONG_STATUS", "OTHER"]), description: z.string().trim().min(10).max(2000), claimedClockIn: timeOnly.optional(), claimedClockOut: timeOnly.optional() }).strict();
export const disputeParamsSchema = z.object({ disputeId: id }).strict();
export const disputeListQuerySchema = z.object({ ...pageFields, status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED"]).default("ALL") }).strict();
export const resolveAttendanceDisputeSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), resolutionNote: z.string().trim().min(3).max(2000) }).strict();
export const monthlyAttendanceQuerySchema = z.object({ ...pageFields, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), departmentId: id.optional(), search: z.string().trim().min(1).max(100).optional() }).strict();

export const leaveListQuerySchema = z.object({ ...pageFields, status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED"]).default("ALL") }).strict();
export const applyLeaveSchema = z.object({ employeeId: id.optional(), leaveType: z.string().trim().min(2).max(100).transform((value) => value.toUpperCase()), fromDate: dateOnly, toDate: dateOnly, reason: z.string().trim().min(3).max(2000) }).strict().refine((value) => value.fromDate <= value.toDate, { message: "toDate must not precede fromDate", path: ["toDate"] });
export const leaveParamsSchema = z.object({ leaveId: id }).strict();
export const leaveApproveSchema = z.object({ comment: z.string().trim().min(3).max(2000).optional() }).strict();
export const leaveRejectSchema = z.object({ reason: z.string().trim().min(3).max(2000).optional() }).strict();

const appraisalStages = ["GOAL_SETTING", "SELF_ASSESSMENT", "MANAGER_REVIEW", "HR_APPROVAL", "ACKNOWLEDGMENT", "COMPLETED"] as const;
export const appraisalParamsSchema = z.object({ appraisalId: id }).strict();
export const appraisalGoalParamsSchema = z.object({ appraisalId: id, goalId: id }).strict();
export const appraisalListQuerySchema = z.object({ ...pageFields, cycleId: id.optional(), quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(), year: z.coerce.number().int().min(2000).max(2200).optional(), status: z.enum(appraisalStages).optional(), departmentId: id.optional(), search: z.string().trim().min(1).max(100).optional() }).strict();
export const createAppraisalGoalSchema = z.object({ title: z.string().trim().min(3).max(200).optional(), goalTitle: z.string().trim().min(3).max(200).optional(), description: z.string().trim().min(3).max(5000), successCriteria: z.string().trim().min(3).max(5000), targetDate: dateOnly }).strict().refine((value) => Boolean(value.title || value.goalTitle), { message: "title is required", path: ["title"] }).transform((value) => ({ ...value, goalTitle: value.title ?? value.goalTitle! }));
export const scoreAppraisalGoalSchema = z.object({ title: z.string().trim().min(3).max(200).optional(), description: z.string().trim().min(3).max(5000).optional(), successCriteria: z.string().trim().min(3).max(5000).optional(), targetDate: dateOnly.optional(), status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(), rating: z.number().int().min(1).max(5).optional(), comment: z.string().trim().max(3000).optional() }).strict().refine((value) => Object.keys(value).length > 0, "At least one goal update is required");
const quarterAchievementSchema = z.object({ Q1: z.number().finite().nullable().optional(), Q2: z.number().finite().nullable().optional(), Q3: z.number().finite().nullable().optional(), Q4: z.number().finite().nullable().optional() }).strict();
const keyResultSchema = z.object({ keyResult: z.string().trim().min(1).max(500), kpiWeight: z.number().min(0).max(100), target: z.number().finite(), initiatives: z.string().trim().max(5000).optional(), achieved: z.union([z.number().finite(), quarterAchievementSchema]), resultPercentage: z.number().min(0).max(500).optional(), comment: z.string().trim().max(5000).optional() }).strict();
const objectiveSchema = z.object({ title: z.string().trim().min(1).max(300), weight: z.number().min(0).max(100), keyResults: z.array(keyResultSchema).min(1).max(50) }).strict();
const assessmentSectionSchema = z.object({ section: z.enum(["KRA", "BEHAVIOURAL"]), totalWeight: z.number().min(0).max(100), objectives: z.array(objectiveSchema).min(1).max(100) }).strict();
const reflectionSchema = z.object({ questionId: z.string().trim().min(1).max(191), response: z.string().trim().min(1).max(10000) }).strict();
export const submitSelfAssessmentSchema = z.object({ sections: z.array(assessmentSectionSchema).min(1).max(2), reflections: z.array(reflectionSchema).max(100).default([]), submit: z.boolean().default(true) }).strict();
export const managerReviewSchema = z.object({ goalRatings: z.array(z.object({ goalId: id, rating: z.number().int().min(1).max(5), comment: z.string().trim().max(3000).optional() }).strict()).max(100).default([]), responses: z.array(reflectionSchema).max(100).default([]), overallFeedback: z.string().trim().min(3).max(10000), recommendation: z.enum(["ON_TRACK", "NEEDS_IMPROVEMENT", "EXCEEDS_EXPECTATION"]), submit: z.boolean().default(true) }).strict();
export const hrApprovalSchema = z.object({ decision: z.enum(["APPROVED", "RETURNED_FOR_REVIEW"]), hrNotes: z.string().trim().max(10000).optional() }).strict();
export const acknowledgeAppraisalSchema = z.object({ response: z.string().trim().max(5000).optional() }).strict();

const templateKeyResultSchema = z.object({ id: z.string().trim().min(1).max(191).optional(), description: z.string().trim().min(1).max(500), kpiWeight: z.number().positive().max(100), target: z.number().finite(), initiatives: z.string().trim().max(5000).optional() }).strict();
const templateObjectiveSchema = z.object({ id: z.string().trim().min(1).max(191).optional(), title: z.string().trim().min(1).max(300), weight: z.number().positive().max(100), keyResults: z.array(templateKeyResultSchema).min(1).max(50) }).strict();
const templateSectionSchema = z.object({ section: z.enum(["KRA", "BEHAVIOURAL"]), weight: z.number().positive().max(100), objectives: z.array(templateObjectiveSchema).min(1).max(100) }).strict();
const templateQuestionSchema = z.object({ id: z.string().trim().min(1).max(191), question: z.string().trim().min(3).max(1000) }).strict();
const appraisalTemplateObjectSchema = z.object({ name: z.string().trim().min(3).max(200), description: z.string().trim().max(5000).optional(), sections: z.array(templateSectionSchema).length(2), reflectionQuestions: z.array(templateQuestionSchema).max(50).default([]), managerReviewQuestions: z.array(templateQuestionSchema).max(50).default([]), quarterScoring: z.boolean().default(true), signOffTypes: z.array(z.enum(["EMPLOYEE", "MANAGER", "HR"])).min(1).default(["EMPLOYEE", "MANAGER", "HR"]), isDefault: z.boolean().default(false) }).strict();
const validateTemplateSections = (value: { sections?: Array<{ section: string }>; signOffTypes?: string[] }, context: z.RefinementCtx) => { if (value.sections && new Set(value.sections.map((section) => section.section)).size !== 2) context.addIssue({ code: z.ZodIssueCode.custom, message: "Template requires one KRA and one BEHAVIOURAL section", path: ["sections"] }); if (value.signOffTypes && new Set(value.signOffTypes).size !== value.signOffTypes.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate sign-off types are not allowed", path: ["signOffTypes"] }); };
export const appraisalTemplateBodySchema = appraisalTemplateObjectSchema.superRefine(validateTemplateSections);
export const appraisalTemplateUpdateSchema = appraisalTemplateObjectSchema.partial().strict().superRefine(validateTemplateSections).refine((value) => Object.keys(value).length > 0, "At least one template field is required");
export const appraisalTemplateParamsSchema = z.object({ templateId: id }).strict();
export const appraisalTemplatesQuerySchema = z.object({ ...pageFields, includeArchived: z.coerce.boolean().default(false) }).strict();
export const appraisalCycleParamsSchema = z.object({ cycleId: id }).strict();
export const appraisalCyclesQuerySchema = z.object({ ...pageFields, status: z.enum(["ALL", "DRAFT", "ACTIVE", "COMPLETED"]).default("ALL") }).strict();
export const createAppraisalCycleSchema = z.object({ cycleName: z.string().trim().min(3).max(200), templateId: id, periodFrom: dateOnly, periodTo: dateOnly, submissionDeadline: dateOnly, description: z.string().trim().max(5000).optional(), launchMode: z.enum(["SAVE_AS_DRAFT", "LAUNCH_AS_ACTIVE"]) }).strict().superRefine((value, context) => { if (value.periodFrom > value.periodTo) context.addIssue({ code: z.ZodIssueCode.custom, message: "periodFrom must not be later than periodTo", path: ["periodTo"] }); if (value.submissionDeadline < value.periodTo) context.addIssue({ code: z.ZodIssueCode.custom, message: "submissionDeadline must not precede periodTo", path: ["submissionDeadline"] }); });
export const launchAppraisalCycleSchema = z.object({}).strict();
export const deleteAppraisalCycleSchema = z.object({ confirmation: z.literal("DELETE APPRAISAL CYCLE") }).strict();
export const appraisalSettingsSchema = z.object({ defaultReviewFrequency: z.enum(["MONTHLY", "QUARTERLY", "BI_ANNUAL", "ANNUAL"]) }).strict();
export const appraisalSignOffSchema = z.object({ signOffType: z.enum(["EMPLOYEE", "MANAGER", "HR"]) }).strict();

const conductCategories = ["PERFORMANCE_RELATED", "INSUBORDINATION", "ATTENDANCE", "GROSS_MISCONDUCT"] as const;
export const conductListQuerySchema = z.object({ ...pageFields, type: z.enum(["ALL", "QUERY", "SUSPENSION"]).default("ALL"), employeeId: id.optional(), departmentId: id.optional(), status: z.enum(["IN_PROGRESS", "RESOLVED", "DISMISSED", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(), date: dateOnly.optional() }).strict();
export const conductParamsSchema = z.object({ conductId: id }).strict();
export const createConductQuerySchema = z.object({ employeeId: id, queryType: z.enum(conductCategories), status: z.enum(["IN_PROGRESS", "RESOLVED", "DISMISSED"]).default("IN_PROGRESS"), notes: z.string().trim().min(3).max(10000) }).strict();
export const createSuspensionSchema = z.object({ employeeId: id, queryType: z.enum(conductCategories), status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).default("ACTIVE"), durationValue: z.number().int().positive().max(3650), durationUnit: z.enum(["DAY", "WEEK", "MONTH"]), startDate: dateOnly.optional(), notes: z.string().trim().min(3).max(10000) }).strict();
export const updateConductStatusSchema = z.object({ status: z.enum(["IN_PROGRESS", "RESOLVED", "DISMISSED", "ACTIVE", "COMPLETED", "CANCELLED"]), note: z.string().trim().max(5000).optional() }).strict();

export {
  appraisalCreateSchema,
  appraisalUpdateSchema,
  conductCreateSchema,
  conductUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  leaveCreateSchema,
  leaveUpdateSchema
};

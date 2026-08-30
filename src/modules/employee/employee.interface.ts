export type EmployeeDashboardAttendanceStatus = "NOT_CLOCKED_IN" | "CLOCKED_IN" | "CLOCKED_OUT" | "ON_LEAVE" | "NON_WORKING_DAY";
export type EmployeeActionItemStatus = "ACTION_REQUIRED" | "APPROVED" | "REJECTED" | "UPCOMING" | "INFORMATIONAL";

export interface EmployeeDashboardAttendance {
  status: EmployeeDashboardAttendanceStatus;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  workedMinutes: number;
  canClockIn: boolean;
  canClockOut: boolean;
  shift: { id: string | null; name: string; startTime: string; endTime: string };
}

export interface EmployeeActionItem {
  id: string;
  type: string;
  title: string;
  description: string;
  status: EmployeeActionItemStatus;
  dueDate: Date | null;
  sourceModule: "HRIS" | "PAYROLL";
  sourceRecordId: string | null;
  actionRequired: boolean;
  createdAt: Date;
}

export interface EmployeeDashboard {
  currentDate: string;
  timeZone: string;
  employee: {
    id: string; employeeId: string; firstName: string; fullName: string;
    role: { id: null; name: string } | null;
    department: { id: string; name: string } | null;
    branch: { id: string; name: string } | null;
  };
  attendanceToday: EmployeeDashboardAttendance;
  summary: {
    annualLeaveRemaining: { leaveType: string; remainingDays: number; usedDays: number; totalDays: number };
    nextPayday: { date: string; period: string } | null;
    attendanceThisMonth: { presentDays: number; expectedWorkingDays: number; attendanceRate: number };
  };
  actionItems: EmployeeActionItem[];
  recentPayslip: { id: string; period: string; grossPay: number; totalDeductions: number; netPay: number; currency: string; status: "APPROVED" | "PAID"; availableForDownload: boolean } | null;
}

export interface UpdateEmployeePersonalDetailsInput { phoneNumber?: string | null; personalEmail?: string; address?: string | null; maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | null; nationality?: string | null }
export interface BankUpdateRequestInput { bankCode: string; bankName: string; accountNumber: string; accountName: string; accountType: "SAVINGS" | "CURRENT"; reason?: string }
export interface EmployeeDocumentMetadata { id: string; documentType: string; documentName: string; originalFileName: string; dateAdded: Date; downloadAvailable: boolean }
export type EmployeeAttendanceClockState = "NOT_CLOCKED_IN" | "CLOCKED_IN" | "CLOCKED_OUT";
export type EmployeeAttendanceDayType = "WORKING_DAY" | "WEEKEND" | "ON_LEAVE" | "FUTURE";
export interface EmployeeAttendanceDisputeInput { issueType: "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT" | "SYSTEM_ERROR" | "WRONG_STATUS" | "OTHER"; description: string; claimedClockIn?: string; claimedClockOut?: string }
export interface EmployeeLeaveRequestInput { leaveTypeId: string; startDate: string; endDate: string; reason: string; relieverEmployeeId?: string }
export interface PayslipComponent { code: string; name: string; amount: number }
export type EmployeeAppraisalStage = "GOAL_SETTING" | "SELF_ASSESSMENT" | "MANAGER_REVIEW" | "HR_APPROVAL" | "ACKNOWLEDGMENT" | "COMPLETED";
export type EmployeeAppraisalWorkflowStatus = "PENDING" | "ACTIVE" | "COMPLETED";
export interface EmployeeAppraisalActions { canEditGoals: boolean; canConfirmGoals: boolean; canBeginSelfAssessment: boolean; canSaveDraft: boolean; canSubmitSelfAssessment: boolean; canAcknowledge: boolean }
export interface EmployeeAppraisalHistoryItem { id: string; cycleName: string; periodStart: Date; periodEnd: Date; finalScore: number | null; rating: { level: number | null; label: string } | null; completedAt: Date }

export type EmployeeInboxStatus = "PENDING" | "DONE";
export type EmployeeInboxCategory = "APPRAISAL" | "LEAVE" | "ATTENDANCE" | "PAYROLL" | "PROFILE" | "SYSTEM";
export interface EmployeeInboxItem {
  id: string;
  category: EmployeeInboxCategory;
  type: string;
  title: string;
  description: string;
  status: EmployeeInboxStatus;
  requiresAction: boolean;
  dueDate: Date | null;
  eventDate: Date;
  readAt: Date | null;
  source: { entityType: string; entityId: string };
  navigation: { target: "MY_APPRAISAL" | "MY_LEAVE" | "MY_ATTENDANCE" | "MY_PAYSLIPS" | "MY_PROFILE" | "MY_INBOX"; resourceId: string; action: string; available: boolean };
  createdAt: Date;
  completedAt: Date | null;
}

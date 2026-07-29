import { prisma } from "../../core/prisma";

type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

type DashboardSystemAlert = {
  id: string;
  key: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  status: AlertStatus;
  createdAt: Date;
  updatedAt: Date;
};

type SystemAlertDelegate = {
  upsert: (args: Record<string, unknown>) => Promise<unknown>;
  updateMany: (args: Record<string, unknown>) => Promise<unknown>;
  findMany: (args: Record<string, unknown>) => Promise<DashboardSystemAlert[]>;
};

const systemAlertDelegate = (prisma as unknown as { systemAlert: SystemAlertDelegate }).systemAlert;

type ModuleStatus = {
  key: "admin" | "hris" | "accounting" | "payroll";
  name: string;
  enabled: boolean;
};

type SyncSystemAlertsInput = {
  organizationId: string;
  actorUserId?: string;
  activeUsers: number;
  totalUsers: number;
  pendingInvitations: number;
  activeModules: ModuleStatus[];
};

type AlertRule = {
  key: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  active: boolean;
};

const openAlert = async (
  organizationId: string,
  rule: Omit<AlertRule, "active">
): Promise<void> => {
  await systemAlertDelegate.upsert({
    where: {
      organizationId_key: {
        organizationId,
        key: rule.key
      }
    },
    update: {
      title: rule.title,
      message: rule.message,
      severity: rule.severity,
      status: "OPEN" satisfies AlertStatus,
      isActive: true,
      resolvedAt: null
    },
    create: {
      organizationId,
      key: rule.key,
      title: rule.title,
      message: rule.message,
      severity: rule.severity,
      status: "OPEN",
      isActive: true
    }
  });
};

const resolveAlert = async (organizationId: string, key: string): Promise<void> => {
  await systemAlertDelegate.updateMany({
    where: {
      organizationId,
      key,
      isActive: true
    },
    data: {
      status: "RESOLVED",
      isActive: false,
      resolvedAt: new Date()
    }
  });
};

export const deriveActiveModules = (
  permissions: string[],
  configRows: Array<{ key: string; value: unknown }>
): ModuleStatus[] => {
  const configMap = new Map<string, unknown>(configRows.map((row) => [row.key, row.value]));

  const extractEnabledFromConfig = (moduleKey: string): boolean | undefined => {
    const rawValue = configMap.get(`module.${moduleKey}.enabled`);

    if (typeof rawValue === "boolean") return rawValue;
    if (rawValue && typeof rawValue === "object") {
      const enabled = (rawValue as { enabled?: unknown }).enabled;
      if (typeof enabled === "boolean") return enabled;
    }

    return undefined;
  };

  const hasPermissionPrefix = (prefix: string) => permissions.some((permission) => permission.startsWith(prefix));

  const modules: ModuleStatus[] = [
    { key: "admin", name: "Administration", enabled: hasPermissionPrefix("admin:") },
    { key: "hris", name: "HRIS", enabled: hasPermissionPrefix("hris:") },
    { key: "accounting", name: "Accounting", enabled: hasPermissionPrefix("accounting:") },
    { key: "payroll", name: "Payroll", enabled: hasPermissionPrefix("payroll:") }
  ];

  return modules.map((module) => {
    const configured = extractEnabledFromConfig(module.key);
    return {
      ...module,
      enabled: configured ?? module.enabled
    };
  });
};

export const syncSystemAlerts = async (input: SyncSystemAlertsInput) => {
  const inactiveModules = input.activeModules.filter((module) => !module.enabled).map((module) => module.name);

  const rules: AlertRule[] = [
    {
      key: "NO_ACTIVE_USERS",
      title: "No active users",
      message: "There are no active users in this tenant.",
      severity: "CRITICAL",
      active: input.activeUsers === 0 && input.totalUsers > 0
    },
    {
      key: "PENDING_INVITATIONS_HIGH",
      title: "High pending invitations",
      message: `There are ${input.pendingInvitations} pending invitations awaiting action.`,
      severity: "WARNING",
      active: input.pendingInvitations >= 5
    },
    {
      key: "MODULES_DISABLED",
      title: "Some modules are disabled",
      message:
        inactiveModules.length > 0
          ? `Disabled modules: ${inactiveModules.join(", ")}.`
          : "All modules are currently enabled.",
      severity: "INFO",
      active: inactiveModules.length > 0
    }
  ];

  await Promise.all(
    rules.map((rule) =>
      rule.active
        ? openAlert(input.organizationId, {
            key: rule.key,
            title: rule.title,
            message: rule.message,
            severity: rule.severity
          })
        : resolveAlert(input.organizationId, rule.key)
    )
  );

  const openAlerts = await systemAlertDelegate.findMany({
    where: {
      organizationId: input.organizationId,
      isActive: true
    },
    orderBy: [{ severity: "desc" }, { updatedAt: "desc" }],
    take: 10
  });

  return openAlerts;
};

export type { DashboardSystemAlert };

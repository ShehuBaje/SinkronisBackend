import path from "node:path";
import swaggerJSDoc from "swagger-jsdoc";
import { env } from "./env";

const authBase = `${env.API_PREFIX}/auth`;
const adminBase = `${env.API_PREFIX}/admin`;
const platformAdminBase = `${env.API_PREFIX}/platform-admin`;
const subscriptionsBase = `${env.API_PREFIX}/subscriptions`;
const hrisBase = `${env.API_PREFIX}/hris`;

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Sinkronis Backend API",
      version: "1.0.0",
      description: "API documentation for Sinkronis Backend"
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}`,
        description: "Local"
      }
    ],
    tags: [
      { name: "Health" },
      { name: "Auth" },
      { name: "Admin" },
      { name: "My Plan" },
      { name: "Notifications & Alerts" },
      { name: "General Settings" },
      { name: "Platform Dashboard" },
      { name: "Platform Tenants" },
      { name: "Platform Pricing & Plans" },
      { name: "Platform Billing & Revenue" },
      { name: "Platform User Management" },
      { name: "Platform Module Management" },
      { name: "Platform Analytics" },
      { name: "Telemetry" },
      { name: "Subscriptions" },
      { name: "Media" },
      { name: "HRIS Dashboard" },
      { name: "HRIS Employees" },
      { name: "HRIS Attendance" },
      { name: "HRIS Leave" },
      { name: "HRIS Appraisals" },
      { name: "HRIS Conduct" }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        RegisterOrganizationBody: {
          type: "object",
          required: ["organization", "admin"],
          example: {
            organization: {
              name: "Acme Logistics",
              slug: "acme-logistics",
              profileImageUrl: "https://cdn.example.com/acme-logo.png",
              email: "hello@acme.com",
              phone: "+2348012345678",
              industry: "Logistics",
              address: "12 Marina, Lagos",
              taxId: "TIN-12345",
              cacNumber: "RC-123456",
              country: "NG",
              currency: "NGN"
            },
            admin: {
              firstName: "Owner",
              lastName: "Admin",
              email: "owner@acme.com",
              password: "Password123!"
            }
          },
          properties: {
            organization: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 2 },
                slug: { type: "string" },
                profileImageUrl: { type: "string", format: "uri" },
                email: { type: "string", format: "email" },
                phone: {
                  type: "string",
                  pattern: "^\\+[1-9]\\d{7,14}$",
                  example: "+2348012345678",
                  description: "Phone number in E.164 format"
                },
                industry: { type: "string" },
                address: { type: "string" },
                taxId: { type: "string" },
                cacNumber: { type: "string" },
                country: { type: "string" },
                currency: { type: "string", default: "NGN" }
              }
            },
            admin: {
              type: "object",
              required: ["email", "password"],
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 8 }
              }
            }
          }
        },
        LoginBody: {
          type: "object",
          required: ["email", "password"],
          example: {
            organizationSlug: "acme-logistics",
            email: "owner@acme.com",
            password: "Password123!",
            twoFactorMethod: "EMAIL_OTP"
          },
          properties: {
            organizationSlug: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            twoFactorMethod: { type: "string", enum: ["AUTHENTICATOR_APP", "SMS_OTP", "EMAIL_OTP"] }
          }
        },
        ForgotPasswordBody: {
          type: "object",
          required: ["email"],
          example: {
            email: "owner@acme.com",
            organizationSlug: "acme-logistics"
          },
          properties: {
            email: { type: "string", format: "email" },
            organizationSlug: { type: "string" }
          }
        },
        VerifyOtpBody: {
          type: "object",
          required: ["email", "otp"],
          example: {
            email: "owner@acme.com",
            otp: "123456",
            organizationSlug: "acme-logistics"
          },
          properties: {
            email: { type: "string", format: "email" },
            otp: { type: "string", pattern: "^\\d{6}$" },
            organizationSlug: { type: "string" }
          }
        },
        VerifyLoginTwoFactorBody: {
          type: "object",
          required: ["challengeToken", "otp"],
          properties: {
            challengeToken: { type: "string" },
            otp: { type: "string", pattern: "^\\d{6}$" }
          }
        },
        BeginAuthenticatorSetupBody: {
          type: "object",
          properties: {
            accountName: { type: "string", example: "owner@acme.com" }
          }
        },
        EnableAuthenticatorBody: {
          type: "object",
          required: ["setupToken", "otp"],
          properties: {
            setupToken: { type: "string" },
            otp: { type: "string", pattern: "^\\d{6}$" }
          }
        },
        DisableAuthenticatorBody: {
          type: "object",
          required: ["otp"],
          properties: {
            otp: { type: "string", pattern: "^\\d{6}$" }
          }
        },
        UpdatePreferredTwoFactorMethodBody: {
          type: "object",
          required: ["method"],
          properties: {
            method: { type: "string", enum: ["AUTHENTICATOR_APP", "SMS_OTP", "EMAIL_OTP"] },
            phoneNumber: { type: "string", example: "+2348012345678" }
          }
        },
        ResetPasswordBody: {
          type: "object",
          required: ["resetToken", "password", "confirmPassword"],
          example: {
            resetToken: "paste-reset-token-here",
            password: "NewPassword123!",
            confirmPassword: "NewPassword123!"
          },
          properties: {
            resetToken: { type: "string" },
            password: { type: "string", minLength: 8 },
            confirmPassword: { type: "string", minLength: 8 }
          }
        },
        MediaUploadResponse: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            path: { type: "string", example: "/uploads/1749570652400-uuid.png" },
            size: { type: "number", example: 102400 },
            mimeType: { type: "string", example: "image/png" }
          }
        },
        OrganizationUpdateBody: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            phone: {
              type: "string",
              pattern: "^\\+[1-9]\\d{7,14}$",
              example: "+2348012345678",
              description: "Phone number in E.164 format"
            },
            industry: { type: "string" },
            address: { type: "string" },
            registrationAddress: { type: "string" },
            country: { type: "string" },
            currency: { type: "string", minLength: 3, maxLength: 3 },
            taxId: { type: "string" },
            cacNumber: { type: "string" },
            website: { type: "string", format: "uri" },
            fiscalYearStart: { type: "string", pattern: "^\\d{2}-\\d{2}$", example: "01-01" },
            companySize: { type: "string", example: "5 - 10" }
          }
        },
        DepartmentBody: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2 },
            description: { type: "string" },
            headEmployeeId: { type: "string" }
          }
        },
        BranchBody: {
          type: "object",
          required: ["name", "address"],
          properties: {
            name: { type: "string", minLength: 2 },
            address: { type: "string", minLength: 3 },
            phone: {
              type: "string",
              pattern: "^\\+[1-9]\\d{7,14}$",
              example: "+2348012345678",
              description: "Phone number in E.164 format"
            }
          }
        },
        WorkScheduleBody: {
          type: "object",
          required: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
            "workStartTime",
            "workEndTime",
            "breakDurationMinutes"
          ],
          properties: {
            monday: { type: "boolean" },
            tuesday: { type: "boolean" },
            wednesday: { type: "boolean" },
            thursday: { type: "boolean" },
            friday: { type: "boolean" },
            saturday: { type: "boolean" },
            sunday: { type: "boolean" },
            workStartTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", example: "09:00" },
            workEndTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", example: "17:00" },
            breakDurationMinutes: { type: "integer", minimum: 0, maximum: 600, example: 60 }
          }
        },
        ModuleStatus: {
          type: "string",
          enum: ["ACTIVE", "INACTIVE", "COMING_SOON"]
        },
        ModuleStatusUpdateBody: {
          type: "object",
          required: ["status"],
          properties: {
            status: { $ref: "#/components/schemas/ModuleStatus" }
          }
        },
        AdminModuleCard: {
          type: "object",
          properties: {
            key: { type: "string", enum: ["hris", "accounting", "payroll"] },
            name: { type: "string" },
            status: { $ref: "#/components/schemas/ModuleStatus" },
            description: { type: "string" },
            tabs: {
              type: "array",
              items: { type: "string" }
            },
            activeUsers: { type: "integer", minimum: 0 },
            action: {
              type: "object",
              properties: {
                label: { type: "string", example: "Open Module" },
                kind: { type: "string", enum: ["OPEN_MODULE", "ENABLE_MODULE", "COMING_SOON"] },
                canOpen: { type: "boolean" }
              }
            },
            openPath: { type: "string", example: "/hris" },
            canLaunch: { type: "boolean" },
            isEnabled: { type: "boolean" }
          }
        },
        AdminModuleSectionResponse: {
          type: "object",
          properties: {
            analytics: {
              type: "object",
              properties: {
                totalModules: { type: "integer", minimum: 0 },
                activeModules: { type: "integer", minimum: 0 },
                comingSoonModules: { type: "integer", minimum: 0 },
                inactiveModules: { type: "integer", minimum: 0 }
              }
            },
            modules: {
              type: "array",
              items: { $ref: "#/components/schemas/AdminModuleCard" }
            }
          }
        },
        PermissionKey: {
          type: "string",
          pattern: "^[a-z]+:[a-z-]+:[a-z-]+$",
          example: "admin:roles:view"
        },
        RoleTemplateKey: {
          type: "string",
          enum: ["SYSTEM_ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"]
        },
        RoleCreateBody: {
          type: "object",
          required: ["name"],
          description:
            "Provide one permission source: permissionKeys, templateKey, or cloneFromRoleId. If none is provided, role is created with no permissions. Full unrestricted access across all modules/actions is reserved for the Owner system role.",
          properties: {
            name: { type: "string", minLength: 2 },
            description: { type: "string", nullable: true },
            permissionKeys: {
              type: "array",
              items: { $ref: "#/components/schemas/PermissionKey" },
              default: []
            },
            templateKey: { $ref: "#/components/schemas/RoleTemplateKey" },
            cloneFromRoleId: { type: "string" }
          }
        },
        RoleUpdateBody: {
          type: "object",
          description:
            "Updates role metadata and/or permission keys. Full unrestricted access across all modules/actions is reserved for the Owner system role.",
          properties: {
            name: { type: "string", minLength: 2 },
            description: { type: "string", nullable: true },
            permissionKeys: {
              type: "array",
              items: { $ref: "#/components/schemas/PermissionKey" }
            }
          }
        },
        RoleCloneBody: {
          type: "object",
          description:
            "Clone name/description overrides only. Cloning a role with unrestricted full-access permissions into a non-system role is not allowed.",
          properties: {
            name: { type: "string", minLength: 2 },
            description: { type: "string", nullable: true }
          }
        },
        RoleResponse: {
          type: "object",
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            isSystem: { type: "boolean" },
            canModify: { type: "boolean" },
            canDelete: { type: "boolean" },
            lockedReason: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            permissions: {
              type: "array",
              items: { $ref: "#/components/schemas/PermissionKey" }
            },
            permissionGroups: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  module: { type: "string" },
                  label: { type: "string" },
                  permissions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { $ref: "#/components/schemas/PermissionKey" },
                        resource: { type: "string" },
                        action: { type: "string" },
                        label: { type: "string" },
                        description: { type: "string" }
                      }
                    }
                  },
                  actions: {
                    type: "object",
                    additionalProperties: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          key: { $ref: "#/components/schemas/PermissionKey" },
                          resource: { type: "string" },
                          action: { type: "string" },
                          label: { type: "string" },
                          description: { type: "string" }
                        }
                      }
                    }
                  },
                  resources: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        resource: { type: "string" },
                        label: { type: "string" },
                        permissions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              key: { $ref: "#/components/schemas/PermissionKey" },
                              action: { type: "string" },
                              label: { type: "string" },
                              description: { type: "string" }
                            }
                          }
                        },
                        actions: {
                          type: "object",
                          additionalProperties: {
                            type: "object",
                            properties: {
                              action: { type: "string" },
                              key: { $ref: "#/components/schemas/PermissionKey" },
                              label: { type: "string" },
                              description: { type: "string" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        RoleTemplate: {
          type: "object",
          properties: {
            key: { $ref: "#/components/schemas/RoleTemplateKey" },
            name: { type: "string" },
            description: { type: "string" },
            permissionKeys: {
              type: "array",
              items: { $ref: "#/components/schemas/PermissionKey" }
            },
            permissionCount: { type: "integer", minimum: 0 },
            modules: {
              type: "array",
              items: { type: "string", enum: ["HRIS", "ACCOUNTING", "PAYROLL"] }
            }
          }
        },
        RolePermissionCatalogPermission: {
          type: "object",
          properties: {
            key: { $ref: "#/components/schemas/PermissionKey" },
            resource: { type: "string" },
            action: { type: "string" },
            label: { type: "string" },
            description: { type: "string" }
          }
        },
        RolePermissionCatalogResource: {
          type: "object",
          properties: {
            resource: { type: "string" },
            label: { type: "string" },
            permissions: {
              type: "array",
              items: { $ref: "#/components/schemas/RolePermissionCatalogPermission" }
            },
            actions: {
              type: "object",
              additionalProperties: { $ref: "#/components/schemas/RolePermissionCatalogPermission" }
            }
          }
        },
        RolePermissionCatalogModule: {
          type: "object",
          properties: {
            module: { type: "string" },
            label: { type: "string" },
            permissions: {
              type: "array",
              items: { $ref: "#/components/schemas/RolePermissionCatalogPermission" }
            },
            actions: {
              type: "object",
              additionalProperties: {
                type: "array",
                items: { $ref: "#/components/schemas/RolePermissionCatalogPermission" }
              }
            },
            resources: {
              type: "array",
              items: { $ref: "#/components/schemas/RolePermissionCatalogResource" }
            }
          }
        },
        UserAccessUpdateBody: {
          type: "object",
          description: "Update a managed user role and/or active state",
          properties: {
            roleId: { type: "string" },
            isActive: { type: "boolean" }
          }
        },
        InviteUserBody: {
          type: "object",
          required: ["email", "roleId", "moduleAccess"],
          properties: {
            email: { type: "string", format: "email" },
            roleId: { type: "string" },
            moduleAccess: {
              type: "array",
              minItems: 1,
              items: {
                type: "string",
                enum: ["HRIS", "ACCOUNTING", "PAYROLL"]
              }
            }
          }
        },
        UserGroupCreateBody: {
          type: "object",
          required: ["name", "type"],
          properties: {
            name: { type: "string", minLength: 2 },
            type: { type: "string", enum: ["DEPARTMENT", "FUNCTION", "department", "function"] },
            description: { type: "string" }
          }
        },
        UserGroupUpdateBody: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2 },
            description: { type: "string" }
          }
        },
        UserGroupUpdateResponse: {
          type: "object",
          required: ["id", "name", "type", "memberCount", "updatedAt", "message"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["DEPARTMENT", "FUNCTION"] },
            description: { type: "string", nullable: true },
            memberCount: { type: "integer", minimum: 0 },
            updatedAt: { type: "string", format: "date-time" },
            message: { type: "string", example: "Sales Team updated successfully" }
          }
        },
        UserGroupDeleteResponse: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", example: "User group deleted successfully" }
          }
        },
        ResendInvitationResponse: {
          type: "object",
          required: ["id", "email", "message", "lastSentAt"],
          properties: {
            id: { type: "string" },
            email: { type: "string", format: "email" },
            message: { type: "string", example: "Invitation resent successfully" },
            lastSentAt: { type: "string", format: "date-time" }
          }
        },
        SecurityPasswordPolicyBody: {
          type: "object",
          required: [
            "minPasswordLength",
            "passwordExpiryDays",
            "lockoutMaxAttempts",
            "requireUppercase",
            "requireLowercase",
            "requireNumber",
            "requireSpecialCharacter"
          ],
          properties: {
            minPasswordLength: { type: "integer", minimum: 8, maximum: 32, default: 8 },
            passwordExpiryDays: { type: "integer", minimum: 1, maximum: 365, default: 90 },
            lockoutMaxAttempts: { type: "integer", minimum: 3, maximum: 20, default: 5 },
            requireUppercase: { type: "boolean", default: true },
            requireLowercase: { type: "boolean", default: true },
            requireNumber: { type: "boolean", default: true },
            requireSpecialCharacter: { type: "boolean", default: true }
          }
        },
        SecurityTwoFactorBody: {
          type: "object",
          required: [
            "twoFactorEnabled",
            "enforceTwoFactorForAllUsers",
            "allowAuthenticatorApp",
            "allowSmsOtp",
            "allowEmailOtp"
          ],
          properties: {
            twoFactorEnabled: { type: "boolean", default: false },
            enforceTwoFactorForAllUsers: { type: "boolean", default: false },
            allowAuthenticatorApp: { type: "boolean", default: true },
            allowSmsOtp: { type: "boolean", default: false },
            allowEmailOtp: { type: "boolean", default: true }
          }
        },
        SecurityRevokeSessionBody: {
          type: "object",
          properties: {
            reason: { type: "string", minLength: 2, maxLength: 120 }
          }
        },
        SecurityRevokeSessionsBulkBody: {
          type: "object",
          required: ["sessionIds"],
          properties: {
            sessionIds: {
              type: "array",
              minItems: 1,
              items: { type: "string" }
            },
            reason: { type: "string", minLength: 2, maxLength: 120 }
          }
        },
        SecurityIpAllowlistToggleBody: {
          type: "object",
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" }
          }
        },
        SecurityIpAllowlistEntryBody: {
          type: "object",
          required: ["value"],
          properties: {
            value: { type: "string", example: "197.210.1.0/24" },
            label: { type: "string", example: "Lagos HQ" }
          }
        },
        SecurityPolicyResponse: {
          type: "object",
          properties: {
            minPasswordLength: { type: "integer" },
            passwordExpiryDays: { type: "integer" },
            lockoutMaxAttempts: { type: "integer" },
            requireUppercase: { type: "boolean" },
            requireLowercase: { type: "boolean" },
            requireNumber: { type: "boolean" },
            requireSpecialCharacter: { type: "boolean" },
            twoFactorEnabled: { type: "boolean" },
            enforceTwoFactorForAllUsers: { type: "boolean" },
            allowAuthenticatorApp: { type: "boolean" },
            allowSmsOtp: { type: "boolean" },
            allowEmailOtp: { type: "boolean" },
            ipAllowlistEnabled: { type: "boolean" }
          }
        },
        MyPlanGenericResponse: {
          type: "object",
          required: ["success", "message", "data"],
          properties: { success: { type: "boolean", example: true }, message: { type: "string" }, data: { type: "object", additionalProperties: true }, metadata: { type: "object", additionalProperties: true }, pagination: { $ref: "#/components/schemas/MyPlanPagination" } }
        },
        NotificationToggleBody: {
          type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean", example: false } }
        },
        NotificationCategoryPreference: {
          type: "object", required: ["notificationId", "categoryKey", "categoryName", "description", "enabled"],
          properties: { notificationId: { type: "string", example: "hris-reminders" }, categoryKey: { type: "string", example: "reminders" }, categoryName: { type: "string", example: "Reminders" }, description: { type: "string" }, enabled: { type: "boolean", example: true } }
        },
        NotificationModulePreference: {
          type: "object", required: ["moduleKey", "moduleName", "moduleStatus", "toggleAll", "notifications"],
          properties: { moduleKey: { type: "string", enum: ["hris", "payroll", "accounting"] }, moduleName: { type: "string", example: "HRIS" }, moduleStatus: { type: "string", enum: ["ENABLED", "PARTIAL", "DISABLED"] }, toggleAll: { type: "boolean" }, notifications: { type: "array", items: { $ref: "#/components/schemas/NotificationCategoryPreference" } } }
        },
        NotificationPreferenceData: {
          type: "object", required: ["channel", "modules"], properties: { channel: { type: "object", required: ["id", "key", "name"], properties: { id: { type: "string" }, key: { type: "string", enum: ["IN_APP", "EMAIL"] }, name: { type: "string" }, description: { type: "string", nullable: true } } }, modules: { type: "array", items: { $ref: "#/components/schemas/NotificationModulePreference" } } }
        },
        NotificationPreferenceResponse: {
          type: "object", required: ["success", "message", "data"], properties: { success: { type: "boolean", example: true }, message: { type: "string" }, data: { $ref: "#/components/schemas/NotificationPreferenceData" } }
        },
        PlatformAnnouncement: {
          type: "object", required: ["announcementId", "title", "summary", "fullDescription", "announcementType", "createdDate", "publishedDate", "readStatus"],
          properties: { announcementId: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, fullDescription: { type: "string" }, announcementType: { type: "string", enum: ["FEATURE", "MAINTENANCE", "SECURITY", "UPDATE"] }, contentFormat: { type: "string", enum: ["MARKDOWN", "HTML", "TEXT"] }, createdDate: { type: "string", format: "date-time" }, publishedDate: { type: "string", format: "date-time" }, readStatus: { type: "string", enum: ["READ", "UNREAD"] }, readAt: { type: "string", format: "date-time", nullable: true }, learnMoreUrl: { type: "string", format: "uri", nullable: true }, contentReference: { type: "string", nullable: true }, expiryDate: { type: "string", format: "date-time", nullable: true } }
        },
        PlatformAnnouncementListResponse: {
          type: "object", required: ["success", "message", "data", "metadata", "pagination"], properties: { success: { type: "boolean", example: true }, message: { type: "string" }, data: { type: "array", items: { $ref: "#/components/schemas/PlatformAnnouncement" } }, metadata: { type: "object", properties: { unreadCount: { type: "integer" }, filters: { type: "object" } } }, pagination: { $ref: "#/components/schemas/MyPlanPagination" } }
        },
        MyPlanPagination: {
          type: "object", required: ["page", "limit", "total", "totalPages"],
          properties: { page: { type: "integer", example: 1 }, limit: { type: "integer", example: 25 }, total: { type: "integer", example: 12 }, totalPages: { type: "integer", example: 1 } }
        },
        MyPlanErrorResponse: {
          type: "object", required: ["success", "message", "data", "errorCode"],
          properties: { success: { type: "boolean", example: false }, message: { type: "string", example: "Validation failed" }, data: { nullable: true, example: null }, errorCode: { type: "string", example: "VALIDATION_ERROR" }, validationErrors: { type: "array", nullable: true, items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" }, code: { type: "string" } } } } }
        },
        MyPlanModule: {
          type: "object", required: ["key", "name", "status", "monthlyCost", "billingFrequency"],
          properties: { key: { type: "string", enum: ["hris", "payroll", "accounting"] }, name: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "INACTIVE", "CANCELLED"] }, monthlyCost: { type: "number", example: 10000 }, monthlyPrice: { type: "number", example: 10000 }, billingFrequency: { type: "string", example: "MONTHLY" }, activationDate: { type: "string", format: "date-time", nullable: true }, includedInPlan: { type: "boolean" } }
        },
        MyPlanChangePreview: {
          type: "object", required: ["currentPlan", "currentMonthlyCost", "selectedPlan", "selectedMonthlyCost", "totalMonthlyCostAfterChange", "effectiveDate", "billingImpact", "proratedCharges", "currency"],
          properties: { currentPlan: { type: "object", properties: { key: { type: "string" }, name: { type: "string" } } }, currentMonthlyCost: { type: "number", example: 80000 }, selectedPlan: { type: "object", properties: { key: { type: "string", example: "all-in-one" }, name: { type: "string", example: "All-in-One Suite" } } }, selectedMonthlyCost: { type: "number", example: 150000 }, totalMonthlyCostAfterChange: { type: "number", example: 150000 }, effectiveDate: { type: "string", format: "date-time" }, billingImpact: { type: "number", example: 70000 }, proratedCharges: { type: "number", example: 0 }, currency: { type: "string", example: "NGN" } }
        },
        MyPlanOverviewData: {
          type: "object", required: ["subscription", "analytics", "activeModules", "costBreakdown"],
          properties: { subscription: { type: "object", properties: { status: { type: "string", enum: ["ACTIVE", "PENDING", "EXPIRED", "CANCELLED"] }, planKey: { type: "string", enum: ["hris", "payroll", "accounting", "all-in-one"] }, planName: { type: "string" }, renewalDate: { type: "string", format: "date-time" }, automaticRenewal: { type: "boolean" } } }, analytics: { type: "object", properties: { currentPlan: { type: "string" }, subscriptionStatus: { type: "string" }, monthlyCost: { type: "number" }, numberOfEmployees: { type: "integer" }, numberOfActiveModules: { type: "integer" } } }, activeModules: { type: "array", items: { $ref: "#/components/schemas/MyPlanModule" } }, costBreakdown: { type: "object", properties: { basePlanCost: { type: "number", example: 80000 }, activeModuleTotal: { type: "number", example: 10000 }, grandMonthlyTotal: { type: "number", example: 90000 } } } }
        },
        MyPlanOverviewResponse: {
          allOf: [{ $ref: "#/components/schemas/MyPlanGenericResponse" }, { type: "object", properties: { data: { $ref: "#/components/schemas/MyPlanOverviewData" } } }]
        },
        MyPlanPlan: {
          type: "object", required: ["key", "name", "monthlyCost", "yearlyCost", "includedModules", "features"],
          properties: { key: { type: "string", enum: ["hris", "payroll", "accounting", "all-in-one"] }, name: { type: "string" }, monthlyCost: { type: "number" }, yearlyCost: { type: "number" }, includedModules: { type: "array", items: { type: "string", enum: ["hris", "payroll", "accounting"] } }, description: { type: "string" }, features: { type: "array", items: { type: "string" } }, isCurrent: { type: "boolean" }, canUpgrade: { type: "boolean" }, canDowngrade: { type: "boolean" }, canAdd: { type: "boolean" } }
        },
        MyPlanPlansResponse: {
          allOf: [{ $ref: "#/components/schemas/MyPlanGenericResponse" }, { type: "object", properties: { data: { type: "object", required: ["currentPlanKey", "currency", "plans"], properties: { currentPlanKey: { type: "string" }, currency: { type: "string" }, plans: { type: "array", items: { $ref: "#/components/schemas/MyPlanPlan" } } } } } }]
        },
        MyPlanPreviewResponse: {
          allOf: [{ $ref: "#/components/schemas/MyPlanGenericResponse" }, { type: "object", properties: { data: { type: "object", properties: { confirmationRequired: { type: "boolean" }, preview: { $ref: "#/components/schemas/MyPlanChangePreview" }, scheduledChange: { type: "object", nullable: true }, billingRecord: { type: "object", nullable: true } } } } }]
        },
        MyPlanBillingAnalyticsResponse: {
          allOf: [{ $ref: "#/components/schemas/MyPlanGenericResponse" }, { type: "object", properties: { data: { type: "object", required: ["currency", "totalPaidYearly", "monthlyPaid", "annualEstimate", "activeMonthlySubscription"], properties: { currency: { type: "string", example: "NGN" }, totalPaidYearly: { type: "number" }, monthlyPaid: { type: "number" }, annualEstimate: { type: "number" }, activeMonthlySubscription: { type: "number" } } } } }]
        },
        MyPlanRenewalProcessingResponse: {
          allOf: [{ $ref: "#/components/schemas/MyPlanGenericResponse" }, { type: "object", properties: { data: { type: "object", required: ["leadDays", "created", "sent", "failed"], properties: { processedAt: { type: "string", format: "date-time" }, leadDays: { type: "integer", example: 15 }, created: { type: "integer" }, sent: { type: "integer" }, failed: { type: "integer" }, duplicateNotificationsPrevented: { type: "boolean" } } } } }]
        },
        MyPlanBillingHistoryItem: {
          type: "object", required: ["invoiceId", "date", "description", "amountPaid", "paymentStatus", "invoiceNumber", "downloadUrl"],
          properties: { invoiceId: { type: "string" }, date: { type: "string", format: "date-time" }, description: { type: "string", example: "Payroll module subscription" }, amountPaid: { type: "number", example: 10000 }, currency: { type: "string", example: "NGN" }, paymentStatus: { type: "string", example: "paid" }, invoiceNumber: { type: "string", example: "INV-20260720120000-A1B2C3" }, downloadUrl: { type: "string" }, pricingComponents: { type: "object", additionalProperties: true, nullable: true } }
        },
        MyPlanChangeBody: {
          type: "object",
          required: ["planKey"],
          properties: {
            planKey: { type: "string", enum: ["hris", "payroll", "accounting", "all-in-one"], example: "all-in-one" },
            billingCycle: { type: "string", enum: ["MONTHLY", "YEARLY"] },
            confirm: { type: "boolean", default: false, description: "False returns a pricing preview; true applies the change." },
            paymentReference: { type: "string", description: "Verified provider payment reference; optional when a default tokenized card exists." },
            automaticRenewal: { type: "boolean", default: true }
          }
        },
        MyPlanCancelSubscriptionBody: {
          type: "object",
          description:
            "Use confirmationText='cancel' or confirmCancel=true to schedule cancellation. Use keepPlan=true to clear any pending cancellation and keep the subscription active.",
          properties: {
            confirmationText: { type: "string", example: "cancel" },
            confirmCancel: { type: "boolean", example: true },
            keepPlan: { type: "boolean", example: false }
          }
        },
        MyPlanAddonUpdateBody: {
          type: "object",
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" },
            confirm: { type: "boolean", default: false, description: "Required to complete a module purchase after preview." },
            paymentReference: { type: "string" },
            automaticRenewal: { type: "boolean", default: true }
          }
        },
        MyPlanPaymentMethodBody: {
          type: "object",
          description: "Selects an organization-owned tokenized card as the default payment method.",
          required: ["paymentCardId"],
          properties: {
            paymentCardId: { type: "string", example: "clx_card_id" }
          }
        },
        MyPlanAddCardBody: {
          type: "object",
          required: ["cardNumber", "cardHolderName", "expiryDate", "cvv"],
          description: "Raw card number and CVV are validated and tokenized; they are not stored.",
          properties: {
            cardNumber: { type: "string", example: "4111111111111111" },
            cardHolderName: { type: "string", example: "Acme Finance" },
            expiryDate: { type: "string", example: "12/28" },
            cvv: { type: "string", example: "123" },
            makeDefault: { type: "boolean", default: true }
          }
        },
        MyPlanCancelCardCreationBody: {
          type: "object",
          properties: {
            reason: { type: "string", example: "User closed add card modal" }
          }
        },
        MyPlanBillingAddressBody: {
          type: "object",
          required: ["companyName", "billingEmail", "address", "country", "state"],
          properties: {
            companyName: { type: "string", example: "Acme Logistics" },
            billingEmail: { type: "string", format: "email", example: "billing@acme.com" },
            address: { type: "string", example: "12 Marina, Lagos" },
            country: { type: "string", minLength: 2, maxLength: 2, example: "NG" },
            state: { type: "string", example: "Lagos" }
          }
        },
        PlatformDashboardAnalytics: {
          type: "object",
          required: ["currency", "totalTenants", "activeTenants", "totalUsers", "platformMrr", "averageModulesPerTenant"],
          properties: {
            currency: { type: "string", enum: ["NGN"] },
            totalTenants: { type: "integer", example: 124 },
            activeTenants: { type: "integer", example: 108 },
            totalUsers: { type: "integer", example: 4821 },
            platformMrr: { type: "number", example: 14850000 },
            averageModulesPerTenant: { type: "number", example: 2.35 }
          }
        },
        PlatformRevenueTrend: {
          type: "object",
          properties: {
            currency: { type: "string", enum: ["NGN"] },
            months: { type: "array", minItems: 6, maxItems: 6, items: { type: "object", properties: { month: { type: "string", example: "July" }, year: { type: "integer", example: 2026 }, monthlyRevenue: { type: "number", example: 2450000 } } } }
          }
        },
        PlatformModuleAdoption: {
          type: "object",
          properties: {
            denominator: { type: "string", enum: ["ACTIVE_TENANTS"] },
            totalActiveTenants: { type: "integer" },
            modules: { type: "array", items: { type: "object", properties: { moduleId: { type: "string", enum: ["hris", "payroll", "accounting", "all-in-one"] }, moduleName: { type: "string" }, tenantCount: { type: "integer" }, percentageAdoption: { type: "number" } } } }
          }
        },
        PlatformActivity: {
          type: "object",
          properties: {
            activityId: { type: "string" }, eventType: { type: "string" }, description: { type: "string" },
            organization: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
            initiatedBy: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string", format: "email" } } },
            timestamp: { type: "string", format: "date-time" }, severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] }
          }
        },
        PlatformTenantHealth: {
          type: "object",
          properties: {
            organizationId: { type: "string" }, organizationName: { type: "string" },
            currentPlan: { type: "object", properties: { key: { type: "string" }, name: { type: "string" } } },
            userCount: { type: "integer" },
            activeModules: { type: "array", items: { type: "object", properties: { key: { type: "string" }, name: { type: "string" } } } },
            lastActiveDate: { type: "string", format: "date-time", nullable: true },
            monthlyRecurringRevenue: { type: "number" }, currency: { type: "string", enum: ["NGN"] },
            subscriptionStatus: { type: "string", enum: ["ACTIVE", "TRIAL", "PENDING", "EXPIRED", "SUSPENDED", "CANCELLED"] },
            registrationDate: { type: "string", format: "date-time" }
          }
        },
        PlatformTenantRow: {
          type: "object",
          required: ["organizationId", "organizationName", "activeModules", "totalUsers", "monthlyRecurringRevenue", "currency", "subscriptionStatus", "actions"],
          properties: {
            organizationId: { type: "string" }, organizationName: { type: "string" },
            companyEmail: { type: "string", format: "email", nullable: true }, industry: { type: "string", nullable: true },
            currentPlan: { type: "object", properties: { key: { type: "string", enum: ["hris", "payroll", "accounting", "all-in-one"] }, name: { type: "string" } } },
            activeModules: { type: "array", items: { type: "object", properties: { id: { type: "string" }, key: { type: "string" }, name: { type: "string" } } } },
            totalUsers: { type: "integer" }, monthlyRecurringRevenue: { type: "number" }, currency: { type: "string", enum: ["NGN"] },
            subscriptionStatus: { type: "string", enum: ["ACTIVE", "TRIAL", "PENDING", "SUSPENDED", "CANCELLED", "EXPIRED"] },
            lastActiveAt: { type: "string", format: "date-time", nullable: true }, createdAt: { type: "string", format: "date-time" },
            actions: { type: "array", items: { type: "object", properties: { key: { type: "string", enum: ["VIEW", "SUSPEND"] }, method: { type: "string" }, href: { type: "string" }, enabled: { type: "boolean" } } } }
          }
        },
        PlatformTenantSummary: {
          type: "object",
          properties: {
            organization: { type: "object", properties: { organizationId: { type: "string" }, organizationName: { type: "string" }, companyEmail: { type: "string", format: "email", nullable: true }, industry: { type: "string", nullable: true }, currentPlan: { type: "object" }, subscriptionStatus: { type: "string" } } },
            summary: { type: "object", properties: { totalUsers: { type: "integer" }, activeUsers: { type: "integer" }, activeModules: { type: "array", items: { type: "object" } }, monthlyRecurringRevenue: { type: "number" }, currency: { type: "string", enum: ["NGN"] }, lastLoginDate: { type: "string", format: "date-time", nullable: true }, daysSinceLastLogin: { type: "integer", nullable: true } } }
          }
        },
        SuspendPlatformTenantBody: {
          type: "object",
          properties: { reason: { type: "string", minLength: 3, maxLength: 1000, example: "Terms-of-service violation pending review" } }
        },
        CreatePlatformTenantBody: {
          type: "object", required: ["companyName", "adminEmail", "subscriptionPlan", "country"], additionalProperties: false,
          properties: {
            companyName: { type: "string", minLength: 2, maxLength: 150, example: "Acme Nigeria Limited" },
            adminEmail: { type: "string", format: "email", example: "admin@acme.example" },
            subscriptionPlan: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE"], example: "ALL_IN_ONE" },
            country: { type: "string", minLength: 2, maxLength: 2, example: "NG", description: "ISO 3166-1 alpha-2 country code." },
            industry: { type: "string", maxLength: 100, example: "Technology" }
          }
        },
        PlatformTenantUser: {
          type: "object", properties: {
            userId: { type: "string" }, fullName: { type: "string", nullable: true }, email: { type: "string", format: "email" },
            role: { type: "string" }, lastActive: { type: "string", format: "date-time", nullable: true },
            accountStatus: { type: "string", enum: ["ACTIVE", "INACTIVE", "SUSPENDED", "INVITED"] }
          }
        },
        PlatformTenantModule: {
          type: "object", properties: {
            moduleId: { type: "string", enum: ["hris", "payroll", "accounting"] }, moduleName: { type: "string" },
            status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }, includedInPlan: { type: "boolean" }
          }
        },
        PlatformTenantInvoice: {
          type: "object", properties: {
            invoiceId: { type: "string" }, billingPeriod: { type: "string" }, amount: { type: "number" },
            paymentStatus: { type: "string", enum: ["PAID", "PENDING", "FAILED", "CANCELLED", "REFUNDED"] },
            invoiceDate: { type: "string", format: "date-time" }, invoiceNumber: { type: "string" },
            downloadUrl: { type: "string", nullable: true }
          }
        },
        PlatformTenantActivityEntry: {
          type: "object", properties: {
            activityId: { type: "string" }, eventType: { type: "string" }, description: { type: "string" },
            performedBy: { type: "object", nullable: true }, timestamp: { type: "string", format: "date-time" },
            ipAddress: { type: "string", nullable: true }
          }
        },
        PlatformSupportTicket: {
          type: "object", required: ["ticketId", "tenant", "subject", "priority", "status", "assignedTo", "updatedAt"], properties: {
            ticketId: { type: "string", example: "TKT-2026-7A6B5C4D3E" },
            tenant: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string" } } },
            subject: { type: "string" }, priority: { type: "string", enum: ["MEDIUM", "HIGH", "CRITICAL"] },
            status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED"] },
            assignedTo: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" } } },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        HRISTrend: { type: "string", enum: ["UP", "DOWN", "UNCHANGED"] },
        EmployeeOverview: { type: "object", required: ["totalEmployees", "activeEmployees", "activeEmployeePercentage", "employeesOnLeave", "pendingLeaveApprovals"], properties: {
          totalEmployees: { type: "integer", minimum: 0 }, activeEmployees: { type: "integer", minimum: 0 },
          activeEmployeePercentage: { type: "number", minimum: 0, maximum: 100 },
          employeesOnLeave: { type: "integer", minimum: 0 }, pendingLeaveApprovals: { type: "integer", minimum: 0 }
        } },
        NewHireAnalytics: { type: "object", required: ["currentMonth", "previousMonth", "difference", "trend"], properties: {
          currentMonth: { type: "integer", minimum: 0 }, previousMonth: { type: "integer", minimum: 0 },
          difference: { type: "integer" }, trend: { $ref: "#/components/schemas/HRISTrend" }
        } },
        AttendanceMetric: { type: "object", required: ["count", "previousDayCount", "difference", "trend"], properties: {
          count: { type: "integer", minimum: 0 }, previousDayCount: { type: "integer", minimum: 0 },
          difference: { type: "integer" }, trend: { $ref: "#/components/schemas/HRISTrend" }
        } },
        AttendanceOverview: { type: "object", required: ["onTime", "lateClockIn", "earlyClockIn", "absent", "noClockIn", "noClockOut"], properties: {
          onTime: { $ref: "#/components/schemas/AttendanceMetric" }, lateClockIn: { $ref: "#/components/schemas/AttendanceMetric" },
          earlyClockIn: { $ref: "#/components/schemas/AttendanceMetric" }, absent: { $ref: "#/components/schemas/AttendanceMetric" },
          noClockIn: { $ref: "#/components/schemas/AttendanceMetric" }, noClockOut: { $ref: "#/components/schemas/AttendanceMetric" }
        } },
        RecentHRISActivity: { type: "object", required: ["id", "type", "description", "createdAt"], properties: {
          id: { type: "string" }, type: { type: "string" }, employeeId: { type: "string", nullable: true },
          employeeName: { type: "string", nullable: true }, description: { type: "string" }, createdAt: { type: "string", format: "date-time" }
        } },
        PendingLeaveRequest: { type: "object", required: ["id", "employee", "type", "days", "from", "to", "status"], properties: {
          id: { type: "string" }, employee: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
          department: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" } } },
          type: { type: "string" }, days: { type: "integer", minimum: 1 }, from: { type: "string", format: "date" },
          to: { type: "string", format: "date" }, status: { type: "string", enum: ["PENDING"] }
        } },
        DepartmentHeadcount: { type: "object", required: ["departmentId", "departmentName", "headcount"], properties: {
          departmentId: { type: "string" }, departmentName: { type: "string" }, headcount: { type: "integer", minimum: 0 }
        } },
        HRISDashboardResponse: { type: "object", required: ["success", "message", "data"], properties: {
          success: { type: "boolean", example: true }, message: { type: "string", example: "HRIS dashboard retrieved successfully" },
          data: { type: "object", required: ["currentDate", "timeZone", "employeeOverview", "newHires", "attendanceOverview", "recentActivity", "pendingLeaveRequests", "headcountByDepartment"], properties: {
            currentDate: { type: "string", format: "date" }, timeZone: { type: "string", example: "Africa/Lagos" },
            employeeOverview: { $ref: "#/components/schemas/EmployeeOverview" }, newHires: { $ref: "#/components/schemas/NewHireAnalytics" },
            attendanceOverview: { $ref: "#/components/schemas/AttendanceOverview" },
            attendanceClassification: { type: "object", description: "Reports the persisted schedule thresholds and unavailable telemetry. onTime includes early arrivals; noClockIn and holiday exclusion are NOT_TRACKED by the current schema." },
            recentActivity: { type: "array", items: { $ref: "#/components/schemas/RecentHRISActivity" } },
            pendingLeaveRequests: { type: "array", items: { $ref: "#/components/schemas/PendingLeaveRequest" } },
            headcountByDepartment: { type: "array", items: { $ref: "#/components/schemas/DepartmentHeadcount" } }
          } }
        } },
        EmployeeStatus: { type: "string", enum: ["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED", "CONFIRMED", "PROBATION", "EXITED"] },
        EmployeeListItem: { type: "object", properties: { id: { type: "string" }, employeeId: { type: "string" }, name: { type: "string" }, role: { type: "string", nullable: true }, department: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" } } }, status: { $ref: "#/components/schemas/EmployeeStatus" }, operationalStatus: { type: "string", enum: ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"] }, lifecycleStatus: { type: "string", enum: ["PROBATION", "CONFIRMED", "EXITED"] }, joinedDate: { type: "string", format: "date-time", nullable: true }, phoneNumber: { type: "string", nullable: true }, profileImage: { type: "string", nullable: true } } },
        EmployeeProfile: { type: "object", description: "Tenant-scoped profile. Bank, salary, next-of-kin, and guarantor values are permission-filtered. Leave balances and employee-linked appraisal history explicitly report unavailable when the current domain does not persist them.", properties: { header: { $ref: "#/components/schemas/EmployeeListItem" }, personalInformation: { type: "object" }, bankDetails: { type: "object", nullable: true }, attendanceOverview: { type: "object" }, leaveOverview: { type: "object" }, payrollOverview: { type: "object" }, nextOfKin: { type: "object", nullable: true }, guarantor: { type: "object", nullable: true }, documents: { type: "array", items: { $ref: "#/components/schemas/EmployeeDocument" } } } },
        EmployeeDocument: { type: "object", properties: { id: { type: "string" }, type: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" }, size: { type: "integer" }, uploadedAt: { type: "string", format: "date-time" } } },
        CreateEmployeeRequest: { type: "object", required: ["employeeId", "firstName", "lastName", "email"], additionalProperties: false, properties: { employeeId: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, email: { type: "string", format: "email" }, phoneNumber: { type: "string" }, departmentId: { type: "string" }, position: { type: "string" }, joinedDate: { type: "string", format: "date-time" }, lifecycleStatus: { type: "string", enum: ["PROBATION", "CONFIRMED", "EXITED"] }, operationalStatus: { type: "string", enum: ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"] }, workMode: { type: "string", enum: ["ONSITE", "REMOTE", "HYBRID"] }, monthlySalary: { type: "number", minimum: 0 } } },
        UpdateEmployeeRequest: { allOf: [{ $ref: "#/components/schemas/CreateEmployeeRequest" }], minProperties: 1 },
        UpdateEmployeeStatusRequest: { type: "object", required: ["status", "effectiveDate"], additionalProperties: false, properties: { status: { $ref: "#/components/schemas/EmployeeStatus" }, effectiveDate: { type: "string", format: "date" } } },
        AttendanceStatus: { type: "string", enum: ["ABSENT", "EARLY_DEPARTURE", "ON_LEAVE", "LATE", "NO_CLOCK_OUT", "OVERTIME", "ON_TIME"] },
        AttendanceRecord: { type: "object", properties: { id: { type: "string" }, employeeId: { type: "string" }, name: { type: "string" }, department: { type: "string", nullable: true }, shift: { type: "string" }, date: { type: "string", format: "date" }, clockIn: { type: "string", format: "date-time" }, clockOut: { type: "string", format: "date-time", nullable: true }, hours: { type: "number" }, overtime: { type: "number" }, status: { $ref: "#/components/schemas/AttendanceStatus" }, flags: { type: "array", items: { $ref: "#/components/schemas/AttendanceStatus" } } } },
        AttendanceAnalytics: { type: "object", properties: { onTime: { type: "integer" }, late: { type: "integer" }, absent: { type: "integer" }, onLeave: { type: "integer" }, noClockOut: { type: "integer" }, overtime: { type: "integer" }, totalHoursWorked: { type: "number" }, totalOvertimeHours: { type: "number" }, attendanceRate: { type: "number" }, shiftsActive: { type: "integer" }, pendingDisputes: { type: "integer" } } },
        AttendanceIssueType: { type: "string", enum: ["MISSING_CLOCK_IN", "MISSING_CLOCK_OUT", "SYSTEM_ERROR", "WRONG_STATUS", "OTHER"] },
        AttendanceDisputeStatus: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
        AttendanceDispute: { type: "object", properties: { disputeId: { type: "string", example: "DSP-M1ABC-12AB34" }, status: { $ref: "#/components/schemas/AttendanceDisputeStatus" }, issueType: { $ref: "#/components/schemas/AttendanceIssueType" }, description: { type: "string" }, claimedClockIn: { type: "string", format: "date-time", nullable: true }, claimedClockOut: { type: "string", format: "date-time", nullable: true } } },
        ManualAttendanceOverrideRequest: { type: "object", required: ["reason"], additionalProperties: false, properties: { clockIn: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, clockOut: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, status: { $ref: "#/components/schemas/AttendanceStatus" }, reason: { type: "string", minLength: 3, maxLength: 1000 } } },
        LeaveStatus: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
        LeaveOverview: { type: "object", required: ["pending", "approved", "rejected"], properties: { pending: { type: "integer", minimum: 0 }, approved: { type: "integer", minimum: 0 }, rejected: { type: "integer", minimum: 0 } } },
        LeaveRequest: { type: "object", properties: { id: { type: "string" }, employee: { type: "object", properties: { id: { type: "string" }, employeeId: { type: "string" }, name: { type: "string" } } }, department: { type: "object", nullable: true }, leaveType: { type: "string", example: "ANNUAL_LEAVE" }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, days: { type: "number" }, status: { $ref: "#/components/schemas/LeaveStatus" } } },
        ApplyLeaveRequest: { type: "object", required: ["leaveType", "fromDate", "toDate", "reason"], additionalProperties: false, properties: { employeeId: { type: "string", description: "Accepted only from an authorized approver creating leave for another employee." }, leaveType: { type: "string" }, fromDate: { type: "string", format: "date" }, toDate: { type: "string", format: "date" }, reason: { type: "string", minLength: 3, maxLength: 2000 } } },
        AppraisalWorkflowStage: { type: "string", enum: ["GOAL_SETTING", "SELF_ASSESSMENT", "MANAGER_REVIEW", "HR_APPROVAL", "ACKNOWLEDGMENT", "COMPLETED"] },
        PerformanceRating: { type: "string", enum: ["OUTSTANDING", "ABOVE_EXPECTATION", "MEETS_EXPECTATION", "BELOW_EXPECTATION", "POOR_PERFORMANCE"] },
        RatingScale: { type: "array", description: "5 Outstanding >120%; 4 Above Expectation >100%-120%; 3 Meets Expectation 80%-100%; 2 Below Expectation 60%-79%; 1 Poor Performance below 60%.", items: { type: "object", properties: { value: { type: "integer", minimum: 1, maximum: 5 }, key: { $ref: "#/components/schemas/PerformanceRating" } } } },
        AppraisalOverview: { type: "object", properties: { analytics: { type: "object", properties: { totalEmployees: { type: "integer" }, completed: { type: "integer" }, inProgress: { type: "integer" }, pendingHR: { type: "integer" } } }, activeCycle: { allOf: [{ $ref: "#/components/schemas/AppraisalCycle" }], nullable: true } } },
        AppraisalCycle: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string", nullable: true }, status: { type: "string", enum: ["DRAFT", "ACTIVE", "COMPLETED"] }, periodFrom: { type: "string", format: "date-time" }, periodTo: { type: "string", format: "date-time" }, submissionDeadline: { type: "string", format: "date-time" }, template: { type: "object", nullable: true }, progress: { type: "object" }, workflow: { type: "object" } } },
        AppraisalListItem: { type: "object", properties: { appraisalId: { type: "string" }, employee: { type: "object" }, department: { type: "object", nullable: true }, manager: { type: "object", nullable: true }, status: { $ref: "#/components/schemas/AppraisalWorkflowStage" }, score: { type: "number", nullable: true }, rating: { $ref: "#/components/schemas/PerformanceRating" } } },
        AppraisalGoal: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, successCriteria: { type: "string" }, targetDate: { type: "string", format: "date-time" }, status: { type: "string", enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "LOCKED"] }, employeeRating: { type: "integer", minimum: 1, maximum: 5, nullable: true }, managerRating: { type: "integer", minimum: 1, maximum: 5, nullable: true } } },
        AppraisalKRA: { type: "object", description: "Structured numeric KRA or behavioural section. Section weights total 100; objective weights equal section weight; KPI weights equal objective weight. resultPercentage is recalculated server-side.", properties: { section: { type: "string", enum: ["KRA", "BEHAVIOURAL"] }, totalWeight: { type: "number" }, objectives: { type: "array", items: { type: "object" } } } },
        SelfAssessment: { type: "object", properties: { status: { type: "string", enum: ["IN_PROGRESS", "SUBMITTED"] }, sections: { type: "array", items: { $ref: "#/components/schemas/AppraisalKRA" } }, reflections: { type: "array", items: { type: "object", properties: { questionId: { type: "string" }, response: { type: "string" } } } }, submittedAt: { type: "string", format: "date-time", nullable: true } } },
        ManagerReview: { type: "object", properties: { status: { type: "string", enum: ["IN_PROGRESS", "SUBMITTED"] }, goalRatings: { type: "array", items: { type: "object" } }, responses: { type: "array", items: { type: "object" } }, overallFeedback: { type: "string" }, recommendation: { type: "string", enum: ["ON_TRACK", "NEEDS_IMPROVEMENT", "EXCEEDS_EXPECTATION"] }, submittedAt: { type: "string", format: "date-time", nullable: true } } },
        HRApproval: { type: "object", properties: { decision: { type: "string", enum: ["APPROVED", "RETURNED_FOR_REVIEW"] }, hrNotes: { type: "string", description: "Internal; omitted from employee/manager detail responses." } } },
        EmployeeAcknowledgment: { type: "object", additionalProperties: false, properties: { response: { type: "string", maxLength: 5000 } } },
        AppraisalKeyResult: { type: "object", required: ["description", "kpiWeight", "target"], properties: { id: { type: "string" }, description: { type: "string" }, kpiWeight: { type: "number" }, target: { type: "number" }, initiatives: { type: "string" } } },
        AppraisalObjective: { type: "object", required: ["title", "weight", "keyResults"], properties: { id: { type: "string" }, title: { type: "string" }, weight: { type: "number" }, keyResults: { type: "array", items: { $ref: "#/components/schemas/AppraisalKeyResult" } } } },
        AppraisalTemplateSection: { type: "object", required: ["section", "weight", "objectives"], properties: { section: { type: "string", enum: ["KRA", "BEHAVIOURAL"] }, weight: { type: "number" }, objectives: { type: "array", items: { $ref: "#/components/schemas/AppraisalObjective" } } } },
        AppraisalTemplate: { type: "object", required: ["name", "sections"], description: "Section, objective and KPI weights are validated; section totals must equal exactly 100.", properties: { id: { type: "string", readOnly: true }, name: { type: "string" }, description: { type: "string" }, isDefault: { type: "boolean" }, version: { type: "integer", readOnly: true }, sections: { type: "array", minItems: 2, maxItems: 2, items: { $ref: "#/components/schemas/AppraisalTemplateSection" } }, reflectionQuestions: { type: "array", items: { type: "object" } }, managerReviewQuestions: { type: "array", items: { type: "object" } }, quarterScoring: { type: "boolean" }, signOffTypes: { type: "array", items: { type: "string", enum: ["EMPLOYEE", "MANAGER", "HR"] } } } },
        AppraisalSignOff: { type: "object", properties: { appraisalId: { type: "string" }, signatoryUserId: { type: "string" }, signatoryRole: { type: "string" }, signOffType: { type: "string", enum: ["EMPLOYEE", "MANAGER", "HR"] }, signedAt: { type: "string", format: "date-time" } } },
        ConductOverview: { type: "object", properties: { totalQueries: { type: "integer" }, activeSuspensions: { type: "integer" }, inProgress: { type: "integer" } } },
        ConductRecord: { type: "object", properties: { id: { type: "string" }, type: { type: "string", enum: ["QUERY", "SUSPENSION"] }, employee: { type: "object" }, department: { type: "object", nullable: true }, queryType: { type: "string", enum: ["PERFORMANCE_RELATED", "INSUBORDINATION", "ATTENDANCE", "GROSS_MISCONDUCT"] }, status: { type: "string", enum: ["IN_PROGRESS", "RESOLVED", "DISMISSED", "ACTIVE", "COMPLETED", "CANCELLED"] }, date: { type: "string", format: "date-time" }, notes: { type: "string" }, duration: { type: "object", nullable: true } } },
        AppraisalDetail: { type: "object", properties: { appraisalId: { type: "string" }, employee: { type: "object" }, cycle: { type: "string" }, template: { type: "string" }, status: { $ref: "#/components/schemas/AppraisalWorkflowStage" }, finalScore: { type: "number", nullable: true }, rating: { $ref: "#/components/schemas/PerformanceRating" }, workflow: { type: "object" }, goals: { type: "array", items: { $ref: "#/components/schemas/AppraisalGoal" } }, selfAssessment: { $ref: "#/components/schemas/SelfAssessment" }, managerReview: { $ref: "#/components/schemas/ManagerReview" }, hrApproval: { type: "object", nullable: true } } },
        PlatformSupportTicketDetail: {
          allOf: [{ $ref: "#/components/schemas/PlatformSupportTicket" }, { type: "object", properties: {
            openedAt: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" },
            description: { type: "string", nullable: true }, resolutionNotes: { type: "string", nullable: true },
            resolvedAt: { type: "string", format: "date-time", nullable: true },
            resolvedBy: { type: "object", nullable: true, properties: { id: { type: "string" }, name: { type: "string" } } }
          } }]
        },
        CreateSupportTicketRequest: {
          type: "object", required: ["tenantId", "subject", "priority", "description"], additionalProperties: false,
          properties: { tenantId: { type: "string" }, subject: { type: "string", minLength: 3, maxLength: 200 }, priority: { type: "string", enum: ["MEDIUM", "HIGH", "CRITICAL"] }, description: { type: "string", minLength: 10, maxLength: 10000 } }
        },
        AssignTicketRequest: { type: "object", required: ["assignedToId"], additionalProperties: false, properties: { assignedToId: { type: "string" } } },
        UpdateResolutionNotesRequest: { type: "object", required: ["resolutionNotes"], additionalProperties: false, properties: { resolutionNotes: { type: "string", minLength: 1, maxLength: 10000 } } },
        UpdateTicketStatusRequest: { type: "object", required: ["status"], additionalProperties: false, properties: { status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED"] } } },
        PlatformConfiguration: { type: "object", required: ["defaultCurrency", "vatRate", "defaultTimezone", "supportEmail"], properties: {
          defaultCurrency: { type: "string", enum: ["NGN", "USD", "GBP"], default: "NGN" }, vatRate: { type: "number", minimum: 0, maximum: 100, default: 7.5 },
          defaultTimezone: { type: "string", example: "Africa/Lagos", description: "Validated IANA timezone." }, supportEmail: { type: "string", format: "email", default: "support@sinkronis.ng" },
          updatedAt: { type: "string", format: "date-time", nullable: true }, updatedBy: { type: "object", nullable: true }
        } },
        UpdatePlatformConfigurationRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: {
          defaultCurrency: { type: "string", enum: ["NGN", "USD", "GBP"] }, vatRate: { type: "number", minimum: 0, maximum: 100 },
          defaultTimezone: { type: "string", example: "Africa/Lagos" }, supportEmail: { type: "string", format: "email" }
        } },
        PasswordPolicy: { type: "object", required: ["minimumLength", "passwordExpiryDays", "accountLockoutAttempts", "requireUppercase", "requireLowercase", "requireNumber", "requireSpecialCharacter"], properties: {
          minimumLength: { type: "integer", minimum: 8, maximum: 128, default: 8 }, passwordExpiryDays: { type: "integer", minimum: 1, maximum: 3650, nullable: true, default: 90, description: "Null means passwords do not expire." },
          accountLockoutAttempts: { type: "integer", minimum: 3, maximum: 20, default: 5 }, requireUppercase: { type: "boolean", default: true },
          requireLowercase: { type: "boolean", default: true }, requireNumber: { type: "boolean", default: true }, requireSpecialCharacter: { type: "boolean", default: false },
          updatedAt: { type: "string", format: "date-time", nullable: true }, updatedBy: { type: "object", nullable: true }
        } },
        UpdatePasswordPolicyRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: {
          minimumLength: { type: "integer", minimum: 8, maximum: 128 }, passwordExpiryDays: { type: "integer", minimum: 1, maximum: 3650, nullable: true },
          accountLockoutAttempts: { type: "integer", minimum: 3, maximum: 20 }, requireUppercase: { type: "boolean" }, requireLowercase: { type: "boolean" },
          requireNumber: { type: "boolean" }, requireSpecialCharacter: { type: "boolean" }
        } },
        FeatureFlag: { type: "object", required: ["key", "name", "description", "enabled"], properties: {
          key: { type: "string", enum: ["BETA_ANALYTICS_DASHBOARD", "NEW_INVOICE_EDITOR", "BULK_USER_IMPORT", "AI_POWERED_INSIGHTS", "MULTI_CURRENCY_SUPPORT"] },
          name: { type: "string" }, description: { type: "string" }, enabled: { type: "boolean" }, updatedAt: { type: "string", format: "date-time", nullable: true }, updatedBy: { type: "object", nullable: true }
        } },
        UpdateFeatureFlagRequest: { type: "object", required: ["enabled"], additionalProperties: false, properties: { enabled: { type: "boolean" } } },
        EmailTemplate: { type: "object", required: ["key", "name", "subject", "body", "availableVariables"], properties: {
          key: { type: "string", enum: ["ONBOARDING_WELCOME", "INVOICE_GENERATED", "PLAN_EXPIRY_REMINDER"] }, name: { type: "string" }, subject: { type: "string" }, body: { type: "string" },
          availableVariables: { type: "array", items: { type: "string" } }, updatedAt: { type: "string", format: "date-time", nullable: true }, updatedBy: { type: "object", nullable: true }
        } },
        UpdateEmailTemplateRequest: { type: "object", required: ["subject", "body"], additionalProperties: false, properties: {
          subject: { type: "string", minLength: 1, maxLength: 200 }, body: { type: "string", minLength: 1, maxLength: 50000, description: "Supports only the template's documented {{variable}} placeholders; script, javascript URLs, and inline event handlers are rejected." }
        } },
        MaintenanceMode: { type: "object", required: ["enabled", "message"], properties: {
          enabled: { type: "boolean", default: false }, message: { type: "string" }, enabledAt: { type: "string", format: "date-time", nullable: true },
          enabledById: { type: "string", nullable: true }, updatedAt: { type: "string", format: "date-time", nullable: true }, updatedBy: { type: "object", nullable: true }
        } },
        UpdateMaintenanceModeRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: {
          enabled: { type: "boolean" }, message: { type: "string", minLength: 10, maxLength: 1000 }
        } },
        PlatformPricingFeature: {
          type: "object", properties: {
            id: { type: "string" }, name: { type: "string" }, description: { type: "string", nullable: true },
            module: { type: "string", enum: ["hris", "payroll", "accounting"], nullable: true },
            status: { type: "string", enum: ["ACTIVE", "INACTIVE"] }
          }
        },
        PlatformPricingCard: {
          type: "object", properties: {
            id: { type: "string" }, key: { type: "string" }, name: { type: "string" }, description: { type: "string" },
            activeTenantCount: { type: "integer" }, monthlyPrice: { type: "number", format: "double", description: "Whole Nigerian Naira; persisted as DECIMAL(14,2)." },
            monthlyRevenue: { type: "number", format: "double" }, currency: { type: "string", enum: ["NGN"] },
            pricingModel: { type: "string", enum: ["FLAT_MONTHLY"] }, status: { type: "string" },
            totalEmployees: { type: "integer" }, revenueContributionPercentage: { type: "number" },
            features: { type: "array", items: { $ref: "#/components/schemas/PlatformPricingFeature" } },
            updatedAt: { type: "string", format: "date-time" }, rowVersion: { type: "integer" }
          }
        },
        PlatformPriceUpdateBody: {
          type: "object", required: ["monthlyPrice", "reason", "effectiveAt"], additionalProperties: false,
          properties: {
            monthlyPrice: { type: "number", minimum: 0, maximum: 1000000000, multipleOf: 0.01, example: 90000 },
            reason: { type: "string", minLength: 3, maxLength: 1000, example: "Annual pricing review" },
            effectiveAt: { type: "string", format: "date-time", example: "2026-08-01T00:00:00.000Z" },
            expectedVersion: { type: "integer", minimum: 1, description: "Optional optimistic-lock version from the pricing card." }
          }
        },
        PlatformPlanCreateBody: {
          type: "object", required: ["name", "monthlyPrice", "description", "features"], additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 2, maxLength: 120, example: "Enterprise" },
            monthlyPrice: { type: "number", minimum: 0, multipleOf: 0.01, example: 250000 },
            description: { type: "string", minLength: 3, maxLength: 2000 },
            features: {
              type: "array", minItems: 1, items: {
                oneOf: [
                  { type: "object", required: ["featureId"], additionalProperties: false, properties: { featureId: { type: "string" } } },
                  { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string" }, description: { type: "string" }, module: { type: "string", enum: ["hris", "payroll", "accounting"] } } }
                ]
              }
            }
          }
        },
        GeneralLocaleSettings: {
          type: "object", required: ["timeZone", "language", "dateFormat", "currency"],
          properties: {
            timeZone: { type: "string", example: "Africa/Lagos", description: "Supported IANA timezone identifier." },
            language: { type: "string", enum: ["en", "fr", "ar"], example: "en" },
            dateFormat: { type: "string", enum: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY"] },
            currency: { type: "string", enum: ["NGN", "USD", "GBP", "EUR"] }
          }
        },
        GeneralBrandingSettings: {
          type: "object", required: ["logoUrl", "fileName", "uploadTimestamp", "accentColor", "linkText", "logoMetadata"],
          properties: {
            logoUrl: { type: "string", nullable: true }, fileName: { type: "string", nullable: true }, uploadTimestamp: { type: "string", format: "date-time", nullable: true },
            accentColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", example: "#2563EB" }, linkText: { type: "string", maxLength: 80, nullable: true },
            logoMetadata: { type: "object", properties: { mimeType: { type: "string", nullable: true }, size: { type: "integer", nullable: true }, width: { type: "integer", nullable: true }, height: { type: "integer", nullable: true } } }
          }
        },
        GeneralSettingsResponse: {
          type: "object", required: ["success", "message", "data"], properties: { success: { type: "boolean", example: true }, message: { type: "string" }, data: { type: "object" }, metadata: { type: "object", nullable: true } }
        },
        OrganizationExportResponse: {
          allOf: [{ $ref: "#/components/schemas/GeneralSettingsResponse" }, { type: "object", properties: { data: { type: "object", properties: { exportId: { type: "string" }, exportDate: { type: "string", format: "date-time" }, requestedBy: { type: "string" }, exportStatus: { type: "string", enum: ["PENDING_PLATFORM_FULFILLMENT"] }, deliveryEmail: { type: "string", format: "email" }, deliveryDueAt: { type: "string", format: "date-time" }, deliveryMethod: { type: "string", enum: ["OFFICIAL_TENANT_ADMIN_EMAIL"] }, fileSize: { type: "integer", nullable: true }, downloadUrl: { type: "string", nullable: true }, fileReference: { type: "string", nullable: true } } } } }]
        },
        OrganizationDeletionRequestBody: {
          type: "object", required: ["confirmationPhrase", "password"], properties: { confirmationPhrase: { type: "string", enum: ["DELETE ORGANIZATION"] }, password: { type: "string", format: "password", minLength: 8 }, reason: { type: "string", minLength: 3, maxLength: 1000 } }
        },
        AuditLogResponse: {
          type: "object",
          properties: {
            section: { type: "string", example: "audit-log" },
            records: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  sequence: { type: "integer", nullable: true, example: 128 },
                  timestamp: { type: "string", format: "date-time" },
                  user: {
                    type: "object",
                    properties: {
                      id: { type: "string", nullable: true },
                      name: { type: "string", example: "Owner Admin" },
                      email: { type: "string", nullable: true, example: "owner@example.com" }
                    }
                  },
                  action: { type: "string", example: "BILLING_PAYMENT_CARD_ADDED" },
                  module: { type: "string", example: "PAYMENT_CARD" },
                  details: { type: "string", example: "Added Visa card ending in 1111" },
                  ipAddress: { type: "string", nullable: true, example: "127.0.0.1" },
                  resourceId: { type: "string", nullable: true },
                  tamperEvidence: {
                    type: "object",
                    properties: {
                      hash: { type: "string", nullable: true, example: "b1946ac92492d2347c6235b4d2611184" },
                      previousHash: { type: "string", nullable: true },
                      algorithm: { type: "string", example: "sha256" }
                    }
                  }
                }
              }
            },
            filters: { type: "object", additionalProperties: true },
            resetAction: { type: "object", additionalProperties: true },
            pagination: {
              type: "object",
              properties: {
                currentPage: { type: "integer", example: 1 },
                pageSize: { type: "integer", example: 25 },
                totalRecords: { type: "integer", example: 42 },
                totalPages: { type: "integer", example: 2 },
                hasNextPage: { type: "boolean", example: true },
                hasPreviousPage: { type: "boolean", example: false }
              }
            },
            sorting: { type: "object", additionalProperties: true },
            readOnly: { type: "boolean", example: true }
          }
        },
        CurrentSubscription: {
          type: "object",
          required: ["planName", "planKey", "subscriptionStatus", "renewalDate", "monthlyCost", "currency", "includedModules", "packages", "billing", "cancellation"],
          properties: {
            planName: { type: "string" },
            planKey: { type: "string", enum: ["hris", "payroll", "accounting", "all-in-one"] },
            subscriptionStatus: { type: "string" },
            renewalDate: { type: "string", format: "date-time" },
            monthlyCost: { type: "number", description: "Configured base module/plan price plus active paid module add-ons. It is not seat based." },
            currency: { type: "string", enum: ["NGN"] },
            includedModules: { type: "array", items: { type: "object", properties: { key: { type: "string", enum: ["hris", "payroll", "accounting"] }, name: { type: "string" }, source: { type: "string", enum: ["plan", "paid_add_on"] } } } },
            packages: { type: "array", items: { type: "string" } },
            billing: { type: "object", properties: { baseMonthlyCost: { type: "number" }, activeAddOnMonthlyCost: { type: "number" }, totalMonthlyCost: { type: "number" } } },
            cancellation: { type: "object", properties: { scheduled: { type: "boolean" }, effectiveDate: { type: "string", format: "date-time", nullable: true } } }
          }
        },
      }
    },
    paths: {
      [`${adminBase}/system-alerts`]: { get: {
        tags: ["Admin"], summary: "List tenant system alerts", description: "Requires admin:organization:view.", security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Tenant system alerts" }, "401": { description: "Authentication required" }, "403": { description: "Permission required" } }
      } },
      [`${adminBase}/system-alerts/{id}/acknowledge`]: { patch: {
        tags: ["Admin"], summary: "Acknowledge a tenant system alert", description: "Requires admin:organization:update.", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Alert acknowledged" }, "401": { description: "Authentication required" }, "403": { description: "Permission required" }, "404": { description: "Tenant-owned alert not found" } }
      } },
      [`${hrisBase}/dashboard`]: { get: {
        tags: ["HRIS Dashboard"], summary: "Get the authenticated tenant's consolidated HRIS dashboard",
        description: "Requires hris:employees:view, hris:attendance:view, and hris:leave:view. Every query is scoped from the authenticated tenant context. Dates use the tenant IANA timezone, defaulting to Africa/Lagos. Employees with TERMINATED status are excluded. New hires compare equivalent month-to-date periods. Attendance uses persisted work start/end and grace-period settings. Early arrivals are included in onTime and also reported as earlyClockIn. Holiday exclusion remains NOT_TRACKED; noClockIn is zero because clockInAt is required by the Attendance model.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Tenant-scoped HRIS dashboard", content: { "application/json": { schema: { $ref: "#/components/schemas/HRISDashboardResponse" } } } },
          "401": { description: "Authentication required" }, "403": { description: "Missing HRIS permissions or module access" },
          "500": { description: "Unexpected server error" }
        }
      } },
      [`${hrisBase}/leave-requests/{id}/approve`]: { patch: {
        tags: ["HRIS Leave"], summary: "Approve a pending tenant leave request",
        description: "Requires hris:leave:approve. The resource is resolved using both the path ID and authenticated tenant ID. The pending-state update is atomic and audited.",
        security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Leave request approved" }, "400": { description: "Invalid identifier" }, "401": { description: "Authentication required" }, "403": { description: "Approval permission required" }, "404": { description: "Tenant-owned leave request not found" }, "409": { description: "Already reviewed or concurrent decision" }, "500": { description: "Unexpected server error" } }
      } },
      [`${hrisBase}/leave-requests/{id}/reject`]: { patch: {
        tags: ["HRIS Leave"], summary: "Reject a pending tenant leave request",
        description: "Requires hris:leave:approve. The optional reason is recorded in the audit metadata and never accepted as tenant authority.",
        security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { reason: { type: "string", minLength: 3, maxLength: 1000 } } } } } },
        responses: { "200": { description: "Leave request rejected" }, "400": { description: "Invalid identifier or reason" }, "401": { description: "Authentication required" }, "403": { description: "Approval permission required" }, "404": { description: "Tenant-owned leave request not found" }, "409": { description: "Already reviewed or concurrent decision" }, "500": { description: "Unexpected server error" } }
      } },
      [`${hrisBase}/leaves/overview`]: { get: { tags: ["HRIS Leave"], summary: "Get tenant leave analytics", description: "Counts authenticated-tenant pending, approved, and rejected requests.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Leave overview", content: { "application/json": { schema: { $ref: "#/components/schemas/LeaveOverview" } } } }, "401": { description: "Authentication required" }, "403": { description: "hris:leave:view required" } } } },
      [`${hrisBase}/leaves`]: {
        get: { tags: ["HRIS Leave"], summary: "List tenant leave requests", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "PENDING", "APPROVED", "REJECTED"] } }], responses: { "200": { description: "Paginated leave requests" }, "400": { description: "Invalid status/pagination" } } },
        post: { tags: ["HRIS Leave"], summary: "Apply for leave", description: "Employee identity is derived from authentication unless an hris:leave:approve holder supplies a tenant-owned employeeId. Scheduled workdays are counted centrally; overlapping requests and insufficient persisted balances are rejected.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApplyLeaveRequest" } } } }, responses: { "201": { description: "Pending request created" }, "400": { description: "Invalid dates/type or no workdays" }, "403": { description: "No linked employee" }, "409": { description: "Overlap or insufficient balance" } } }
      },
      [`${hrisBase}/leaves/{leaveId}/approve`]: { patch: { tags: ["HRIS Leave"], summary: "Approve a pending leave request", description: "Atomic tenant-scoped transition. Updates a persisted balance when present, marks currently-active leave employee ON_LEAVE, and audits the decision.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "leaveId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Leave approved" }, "404": { description: "Tenant-owned leave not found" }, "409": { description: "Already/concurrently reviewed" } } } },
      [`${hrisBase}/leaves/{leaveId}/reject`]: { patch: { tags: ["HRIS Leave"], summary: "Reject a pending leave request", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "leaveId", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { reason: { type: "string", minLength: 3, maxLength: 2000 } } } } } }, responses: { "200": { description: "Leave rejected and audited" }, "404": { description: "Not found" }, "409": { description: "Already/concurrently reviewed" } } } },
      [`${hrisBase}/appraisals/overview`]: { get: { tags: ["HRIS Appraisals"], summary: "Get active-cycle workflow analytics", security: [{ bearerAuth: [] }], responses: { "200": { description: "Total, completed, in-progress, pending-HR, and stage counts" } } } },
      [`${hrisBase}/appraisals/cycles/active`]: { get: { tags: ["HRIS Appraisals"], summary: "Get the active appraisal cycle", security: [{ bearerAuth: [] }], responses: { "200": { description: "Cycle, template, acknowledgment percentage, and workflow counts" }, "404": { description: "No OPEN cycle" } } } },
      [`${hrisBase}/appraisals/reviews`]: { get: { tags: ["HRIS Appraisals"], summary: "List appraisal reviews", description: "Tenant-scoped database pagination with cycle, stage, department, and employee search filters.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated reviews" }, "400": { description: "Invalid filter" }, "403": { description: "Appraisal permission required" } } } },
      [`${hrisBase}/appraisals/settings`]: { get: { tags: ["HRIS Appraisals"], summary: "Get tenant appraisal settings", security: [{ bearerAuth: [] }], responses: { "200": { description: "Default review frequency" } } }, patch: { tags: ["HRIS Appraisals"], summary: "Update tenant appraisal settings", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["defaultReviewFrequency"], properties: { defaultReviewFrequency: { type: "string", enum: ["MONTHLY", "QUARTERLY", "BI_ANNUAL", "ANNUAL"] } } } } } }, responses: { "200": { description: "Settings updated and audited" } } } },
      [`${hrisBase}/appraisals/templates`]: { get: { tags: ["HRIS Appraisals"], summary: "List active appraisal templates", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated template summaries" } } }, post: { tags: ["HRIS Appraisals"], summary: "Create an appraisal template", description: "Nested section/objective/KPI weights must total 100. A tenant can have one default template.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AppraisalTemplate" } } } }, responses: { "201": { description: "Template created" }, "400": { description: "Invalid weight structure" }, "409": { description: "Duplicate template name" } } } },
      [`${hrisBase}/appraisals/templates/{templateId}`]: { get: { tags: ["HRIS Appraisals"], summary: "Get template detail/preview data", security: [{ bearerAuth: [] }], responses: { "200": { description: "Complete immutable preview structure" }, "404": { description: "Tenant-owned template not found" } } }, patch: { tags: ["HRIS Appraisals"], summary: "Edit a future-use template", description: "Launched reviews retain their snapshot and are not changed.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Template version incremented" }, "400": { description: "Invalid weights" } } }, delete: { tags: ["HRIS Appraisals"], summary: "Archive a template", description: "Removes it from future selection without deleting historical cycles or appraisals.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Template archived" }, "404": { description: "Not found" } } } },
      [`${hrisBase}/appraisals/cycles`]: { get: { tags: ["HRIS Appraisals"], summary: "List appraisal cycles", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated cycle progress" } } }, post: { tags: ["HRIS Appraisals"], summary: "Create or launch an appraisal cycle", description: "Launch snapshots the template and atomically enrolls eligible employees with their current managers.", security: [{ bearerAuth: [] }], responses: { "201": { description: "Cycle created" }, "404": { description: "Template not found" }, "409": { description: "Overlapping active cycle" } } } },
      [`${hrisBase}/appraisals/cycles/{cycleId}/launch`]: { post: { tags: ["HRIS Appraisals"], summary: "Launch a draft cycle", security: [{ bearerAuth: [] }], responses: { "200": { description: "Cycle activated and employees enrolled" }, "409": { description: "Not draft or overlapping cycle" } } } },
      [`${hrisBase}/appraisals/cycles/{cycleId}/complete`]: { post: { tags: ["HRIS Appraisals"], summary: "Complete an active cycle", description: "Allowed only when every enrolled appraisal is completed/acknowledged.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Cycle completed" }, "409": { description: "Incomplete appraisals remain" } } } },
      [`${hrisBase}/appraisals/cycles/{cycleId}/reviews`]: { get: { tags: ["HRIS Appraisals"], summary: "List reviews for one tenant cycle", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated reviews" }, "404": { description: "Cycle not found" } } } },
      [`${hrisBase}/appraisals/cycles/{cycleId}`]: { delete: { tags: ["HRIS Appraisals"], summary: "Permanently delete a cycle and associated appraisals", description: "Destructive and irreversible. Body confirmation must equal DELETE APPRAISAL CYCLE.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["confirmation"], properties: { confirmation: { type: "string", enum: ["DELETE APPRAISAL CYCLE"] } } } } } }, responses: { "200": { description: "Cycle and reviews deleted; action audited" }, "400": { description: "Confirmation missing" }, "404": { description: "Cycle not found" } } } },
      [`${hrisBase}/appraisals`]: { get: { tags: ["HRIS Appraisals"], summary: "List tenant employee appraisals", description: "Supports cycle, quarter, year, workflow stage, tenant-owned department, search, and pagination.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated employee appraisals" }, "400": { description: "Invalid filter" } } } },
      [`${hrisBase}/appraisals/{appraisalId}`]: { get: { tags: ["HRIS Appraisals"], summary: "Get appraisal detail and workflow progression", description: "Employee, assigned manager, and HR access are enforced. HR internal notes are returned only to HR/appraisal administrators.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "appraisalId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Role-filtered appraisal detail" }, "403": { description: "Not employee/manager/HR" }, "404": { description: "Tenant-owned appraisal not found" } } } },
      [`${hrisBase}/appraisals/{appraisalId}/goals`]: { post: { tags: ["HRIS Appraisals"], summary: "Propose an appraisal goal", description: "Assigned manager or appraisal administrator only; GOAL_SETTING stage only; target date must fall in the cycle.", security: [{ bearerAuth: [] }], responses: { "201": { description: "Goal created" }, "409": { description: "Goal setting locked" } } } },
      [`${hrisBase}/appraisals/{appraisalId}/goals/complete`]: { post: { tags: ["HRIS Appraisals"], summary: "Finish goal setting and open self-assessment", description: "Manager-only state transition. Requires at least one goal and notifies the employee.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Self-assessment opened" }, "409": { description: "Wrong stage or no goals" } } } },
      [`${hrisBase}/appraisals/{appraisalId}/goals/{goalId}`]: { patch: { tags: ["HRIS Appraisals"], summary: "Rate/comment on an appraisal goal", description: "Employee ratings are accepted only before self-assessment submission; manager ratings only during MANAGER_REVIEW. Ratings are 1-5.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Goal score updated" }, "403": { description: "Not assigned participant" }, "409": { description: "Stage locked" } } } },
      [`${hrisBase}/appraisals/{appraisalId}/self-assessment`]: {
        get: { tags: ["HRIS Appraisals"], summary: "Get self-assessment, configurable questions, and goals", security: [{ bearerAuth: [] }], responses: { "200": { description: "Self-assessment view" } } },
        post: { tags: ["HRIS Appraisals"], summary: "Save or submit self-assessment", description: "Validates section/objective/KPI totals, recalculates weighted results, validates template question IDs, locks goals on submission, and transitions to MANAGER_REVIEW.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Assessment saved/submitted" }, "400": { description: "Invalid weights/question" }, "409": { description: "Stage locked" } } }
      },
      [`${hrisBase}/appraisals/{appraisalId}/manager-review`]: {
        get: { tags: ["HRIS Appraisals"], summary: "Get assigned manager review view", security: [{ bearerAuth: [] }], responses: { "200": { description: "Read-only employee submission plus manager fields" } } },
        post: { tags: ["HRIS Appraisals"], summary: "Save or submit manager review", description: "Assigned manager or HR only. Submission transitions to HR_APPROVAL and is audited.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Review saved/submitted" }, "409": { description: "Self-assessment not submitted or wrong stage" } } }
      },
      [`${hrisBase}/appraisals/{appraisalId}/hr-approval`]: {
        get: { tags: ["HRIS Appraisals"], summary: "Get HR approval view including internal notes", security: [{ bearerAuth: [] }], responses: { "200": { description: "HR-only approval view" }, "403": { description: "HR permission required" } } },
        post: { tags: ["HRIS Appraisals"], summary: "Approve or return an appraisal", description: "APPROVED transitions to ACKNOWLEDGMENT. RETURNED_FOR_REVIEW transitions to MANAGER_REVIEW. Internal HR notes are not exposed to employee/manager views.", security: [{ bearerAuth: [] }], responses: { "200": { description: "HR decision recorded" }, "409": { description: "Manager review not submitted/wrong stage" } } }
      },
      [`${hrisBase}/appraisals/{appraisalId}/acknowledge`]: { post: { tags: ["HRIS Appraisals"], summary: "Acknowledge the approved appraisal", description: "Employee only. Idempotently marks the appraisal COMPLETED and audits acknowledgment.", security: [{ bearerAuth: [] }], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeAcknowledgment" } } } }, responses: { "200": { description: "Appraisal completed" }, "409": { description: "HR approval not complete" } } } },
      [`${hrisBase}/appraisals/{appraisalId}/sign-off`]: { post: { tags: ["HRIS Appraisals"], summary: "Record an authenticated appraisal sign-off", description: "Employee, assigned manager, or HR may sign only their own role at an allowed workflow stage. Identity and timestamp are server-derived.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["signOffType"], properties: { signOffType: { type: "string", enum: ["EMPLOYEE", "MANAGER", "HR"] } } } } } }, responses: { "200": { description: "Sign-off recorded idempotently" }, "403": { description: "Role/stage not permitted" } } } },
      [`${hrisBase}/conduct/overview`]: { get: { tags: ["HRIS Conduct"], summary: "Get tenant conduct analytics", security: [{ bearerAuth: [] }], responses: { "200": { description: "Query, active suspension, and in-progress counts", content: { "application/json": { schema: { $ref: "#/components/schemas/ConductOverview" } } } }, "403": { description: "Conduct management permission required" } } } },
      [`${hrisBase}/conduct`]: { get: { tags: ["HRIS Conduct"], summary: "List tenant conduct records", description: "Supports type, employee, department, status, date, and pagination filters.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated conduct records" }, "400": { description: "Invalid filter" } } } },
      [`${hrisBase}/conduct/queries`]: { post: { tags: ["HRIS Conduct"], summary: "Issue an employee conduct query", security: [{ bearerAuth: [] }], responses: { "201": { description: "Query created, audited, and employee notified" }, "404": { description: "Tenant employee not found" } } } },
      [`${hrisBase}/conduct/suspensions`]: { post: { tags: ["HRIS Conduct"], summary: "Create an employee suspension", description: "ACTIVE suspensions atomically preserve and change operational employee status to SUSPENDED.", security: [{ bearerAuth: [] }], responses: { "201": { description: "Suspension created" }, "409": { description: "Active suspension already exists" } } } },
      [`${hrisBase}/conduct/{conductId}`]: { get: { tags: ["HRIS Conduct"], summary: "Get tenant conduct detail", security: [{ bearerAuth: [] }], responses: { "200": { description: "Conduct detail" }, "404": { description: "Tenant-owned record not found" } } } },
      [`${hrisBase}/conduct/{conductId}/status`]: { patch: { tags: ["HRIS Conduct"], summary: "Transition conduct status", description: "Query and suspension state machines are validated. Ending the final active suspension restores the preserved previous employee status.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Status updated, audited, and employee notified" }, "409": { description: "Invalid transition" } } } },
      [`${hrisBase}/employees`]: {
        get: { tags: ["HRIS Employees"], summary: "List authenticated tenant employees", description: "Requires hris:employees:view. Supports database pagination, trimmed partial search over employee number/name/email/phone, tenant-owned department filtering, normalized operational/lifecycle status filtering, and allowlisted sorting.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "search", schema: { type: "string", maxLength: 100 } }, { in: "query", name: "departmentId", schema: { type: "string" } }, { in: "query", name: "status", schema: { $ref: "#/components/schemas/EmployeeStatus" } }, { in: "query", name: "sortBy", schema: { type: "string", enum: ["name", "employeeId", "joinedDate", "status", "department"] } }, { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"] } }], responses: { "200": { description: "Paginated employee list" }, "400": { description: "Invalid filter" }, "401": { description: "Authentication required" }, "403": { description: "Permission required" } } },
        post: { tags: ["HRIS Employees"], summary: "Create a tenant employee", description: "Requires hris:employees:create. Employee number/email are unique per tenant and department/team references are tenant validated.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateEmployeeRequest" } } } }, responses: { "201": { description: "Employee created" }, "400": { description: "Validation error" }, "403": { description: "Permission required" }, "409": { description: "Duplicate employee" } } }
      },
      [`${hrisBase}/employees/lifecycle`]: { get: { tags: ["HRIS Employees"], summary: "List employees by lifecycle status", description: "Thin reuse of employee listing; status is required and limited to PROBATION, CONFIRMED, or EXITED.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "status", required: true, schema: { type: "string", enum: ["PROBATION", "CONFIRMED", "EXITED"] } }], responses: { "200": { description: "Paginated lifecycle employee list" }, "400": { description: "Invalid lifecycle status" } } } },
      [`${hrisBase}/employees/invite`]: { post: {
        tags: ["HRIS Employees"], summary: "Invite an employee to the authenticated tenant",
        description: "Requires hris:employees:create. Reuses the tenant invitation flow; tenant identity and role assignment are server controlled.", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["email", "roleId", "moduleAccess"], properties: { email: { type: "string", format: "email" }, roleId: { type: "string" }, moduleAccess: { type: "array", minItems: 1, items: { type: "string", enum: ["HRIS", "ACCOUNTING", "PAYROLL"] } } } } } } },
        responses: { "201": { description: "Employee invitation created and sent" }, "400": { description: "Validation error" }, "403": { description: "Permission required" }, "409": { description: "Existing user or pending invitation" } }
      } },
      [`${hrisBase}/employees/{employeeId}`]: {
        get: { tags: ["HRIS Employees"], summary: "Get a tenant employee profile", description: "Sensitive bank, salary, next-of-kin, and guarantor fields are permission filtered. Missing leave-balance and employee-appraisal persistence is reported, not fabricated.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Employee profile", content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeProfile" } } } }, "404": { description: "Tenant-owned employee not found" } } },
        patch: { tags: ["HRIS Employees"], summary: "Partially update a tenant employee", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateEmployeeRequest" } } } }, responses: { "200": { description: "Employee updated and audited" }, "400": { description: "Validation error" }, "404": { description: "Employee/department/team not found" } } }
      },
      [`${hrisBase}/employees/{employeeId}/status`]: { patch: { tags: ["HRIS Employees"], summary: "Change operational or lifecycle status", description: "Requires hris:employees:update. Stores previous/new state, effective date, actor, and audit record. EXITED/INACTIVE revokes linked account access.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "employeeId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateEmployeeStatusRequest" } } } }, responses: { "200": { description: "Status updated" }, "409": { description: "Invalid or concurrent transition" } } } },
      [`${hrisBase}/employees/import`]: { post: {
        tags: ["HRIS Employees"], summary: "Bulk-import employees from CSV",
        description: "Requires hris:employees:create. multipart/form-data field `file`, CSV MIME only, maximum 20 MB and 5,000 rows. PNG/JPEG/PDF are not parsed as structured employee data.", security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } }
        },
        responses: { "201": { description: "Atomic import completed" }, "400": { description: "Invalid CSV/file" }, "409": { description: "Duplicate/invalid employee records" } }
      } },
      [`${hrisBase}/employees/import/template`]: { get: { tags: ["HRIS Employees"], summary: "Download the employee CSV template", security: [{ bearerAuth: [] }], responses: { "200": { description: "CSV template", content: { "text/csv": { schema: { type: "string", format: "binary" } } } } } } },
      [`${hrisBase}/employees/{employeeId}/attendance`]: { get: { tags: ["HRIS Employees"], summary: "Get employee attendance history", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated tenant-scoped records" }, "404": { description: "Employee not found" } } } },
      [`${hrisBase}/employees/{employeeId}/leave-history`]: { get: { tags: ["HRIS Employees"], summary: "Get existing employee leave history", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated leave history" } } } },
      [`${hrisBase}/employees/{employeeId}/payroll-history`]: { get: { tags: ["HRIS Employees"], summary: "Get permission-protected employee payroll history", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated payroll history" }, "403": { description: "Sensitive-data permission required" } } } },
      [`${hrisBase}/employees/{employeeId}/appraisals`]: { get: { tags: ["HRIS Employees"], summary: "Get supported employee appraisal history", description: "Returns NOT_AVAILABLE until appraisal cycles are linked to employees.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Appraisal availability" } } } },
      [`${hrisBase}/employees/{employeeId}/conduct`]: { get: { tags: ["HRIS Employees"], summary: "Get existing employee conduct records", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated conduct records" } } } },
      [`${hrisBase}/employees/{employeeId}/activity`]: { get: { tags: ["HRIS Employees"], summary: "Get audited employee activity", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated activity" } } } },
      [`${hrisBase}/attendance`]: { get: { tags: ["HRIS Attendance"], summary: "Get daily attendance main-page data", description: "Uses tenant timezone and persisted work schedule/grace/overtime settings.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "date", schema: { type: "string", format: "date" } }], responses: { "200": { description: "Daily analytics and attendance preview" } } } },
      [`${hrisBase}/attendance/clock-in`]: { post: {
        tags: ["HRIS Attendance"], summary: "Clock in the authenticated tenant employee", description: "Requires hris:attendance:create and creates the current tenant-local attendance entry.", security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["employeeId"], properties: { employeeId: { type: "string" }, note: { type: "string" } } } } } },
        responses: { "201": { description: "Clock-in recorded" }, "400": { description: "Invalid request" }, "403": { description: "Permission or linked employee required" }, "409": { description: "Already clocked in" } }
      } },
      [`${hrisBase}/attendance/{id}/clock-out`]: { post: {
        tags: ["HRIS Attendance"], summary: "Clock out of a tenant attendance record", description: "Requires hris:attendance:update. The attendance record is tenant scoped.", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Clock-out recorded" }, "403": { description: "Permission required" }, "404": { description: "Tenant-owned attendance not found" }, "409": { description: "Already clocked out" } }
      } },
      [`${hrisBase}/attendance/daily`]: { get: { tags: ["HRIS Attendance"], summary: "Get daily attendance report", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "date", schema: { type: "string", format: "date" } }], responses: { "200": { description: "Daily report" } } } },
      [`${hrisBase}/attendance/me/today`]: { get: { tags: ["HRIS Attendance"], summary: "Get authenticated employee attendance today", security: [{ bearerAuth: [] }], responses: { "200": { description: "Tenant-local clock, shift, and attendance" }, "404": { description: "User has no linked employee" } } } },
      [`${hrisBase}/attendance/logs`]: { get: { tags: ["HRIS Attendance"], summary: "Search, filter, and paginate attendance logs", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated attendance" }, "400": { description: "Invalid filter" } } } },
      [`${hrisBase}/attendance/overview`]: { get: { tags: ["HRIS Attendance"], summary: "Get filtered attendance overview", security: [{ bearerAuth: [] }], responses: { "200": { description: "Attendance overview" } } } },
      [`${hrisBase}/attendance/export`]: { get: { tags: ["HRIS Attendance"], summary: "Export filtered tenant attendance CSV", description: "Neutralizes spreadsheet-formula prefixes.", security: [{ bearerAuth: [] }], responses: { "200": { description: "CSV download", content: { "text/csv": { schema: { type: "string", format: "binary" } } } } } } },
      [`${hrisBase}/attendance/departments/summary`]: { get: { tags: ["HRIS Attendance"], summary: "Get department attendance summary", security: [{ bearerAuth: [] }], responses: { "200": { description: "Department aggregates" } } } },
      [`${hrisBase}/attendance/monthly`]: { get: { tags: ["HRIS Attendance"], summary: "Get paginated monthly attendance", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "month", required: true, schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" } }], responses: { "200": { description: "Monthly records with availability metadata" } } } },
      [`${hrisBase}/attendance/{attendanceId}/override`]: { patch: { tags: ["HRIS Attendance"], summary: "Manually override attendance", description: "Requires hris:attendance:update. Reason is mandatory; previous/new values and actor are written to the tamper-evident audit log.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "attendanceId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ManualAttendanceOverrideRequest" } } } }, responses: { "200": { description: "Attendance overridden" }, "404": { description: "Tenant-owned attendance not found" } } } },
      [`${hrisBase}/attendance/{attendanceId}/disputes`]: { post: {
        tags: ["HRIS Attendance"], summary: "Raise an attendance dispute", description: "Employees may dispute only their linked attendance unless they have attendance-management permission. One pending dispute per attendance record.", security: [{ bearerAuth: [] }],
        parameters: [{ in: "path", name: "attendanceId", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["issueType", "description"], properties: { issueType: { $ref: "#/components/schemas/AttendanceIssueType" }, description: { type: "string" }, claimedClockIn: { type: "string", example: "07:45" }, claimedClockOut: { type: "string", example: "16:00" } } } } } },
        responses: { "201": { description: "Dispute created" }, "409": { description: "Pending dispute exists" } }
      } },
      [`${hrisBase}/attendance/disputes`]: { get: { tags: ["HRIS Attendance"], summary: "List tenant attendance disputes", security: [{ bearerAuth: [] }], responses: { "200": { description: "Paginated disputes" } } } },
      [`${hrisBase}/attendance/disputes/{disputeId}`]: {
        get: { tags: ["HRIS Attendance"], summary: "Get a tenant attendance dispute", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "disputeId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Dispute detail" }, "404": { description: "Not found" } } },
        patch: {
          tags: ["HRIS Attendance"], summary: "Approve or reject an attendance dispute", description: "Requires hris:attendance:update. Approval reuses the audited attendance override path; duplicate resolution is rejected atomically.", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "disputeId", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["status", "resolutionNote"], properties: { status: { type: "string", enum: ["APPROVED", "REJECTED"] }, resolutionNote: { type: "string" } } } } } },
          responses: { "200": { description: "Dispute resolved" }, "409": { description: "Already/concurrently resolved" } }
        }
      },
      [`${platformAdminBase}/analytics`]: { get: { tags: ["Platform Analytics"], summary: "Get the complete platform analytics dashboard", description: "Requires platform:analytics:read. from/to use YYYY-MM-DD UTC boundaries; to is inclusive. Defaults to the current month plus the preceding eleven months and permits at most 60 months. MRR uses paid recurring BillingHistory amounts with annual charges divided by 12. Historical module state is returned as NOT_TRACKED where no trustworthy entitlement history exists.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "from", schema: { type: "string", format: "date" } }, { in: "query", name: "to", schema: { type: "string", format: "date" } }], responses: { "200": { description: "New tenants, MRR growth, module usage availability, churn by plan, top activity, at-risk tenants, range, and telemetry metadata" }, "400": { description: "Invalid or excessive date range" }, "403": { description: "Platform Administrator permission required" } } } },
      [`${platformAdminBase}/analytics/at-risk/{tenantId}/check-in`]: { post: { tags: ["Platform Analytics"], summary: "Send an audited check-in to an at-risk tenant", description: "Requires platform:analytics:check-in. Resolves the active tenant owner/contact internally, verifies at least three days without activity, rate limits requests, and enforces one attempt per tenant per UTC day.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Check-in delivered" }, "404": { description: "Active tenant not found" }, "409": { description: "Tenant not at risk, missing contact, or cooldown active" }, "503": { description: "Email delivery failed" } } } },
      [`${platformAdminBase}/support/tickets`]: {
        get: { tags: ["Platform Support"], summary: "View platform support tickets", description: "Requires platform:support:read. Search is a trimmed, partial match over the stored ID, human ticket ID, tenant name, and subject. Search and status filters combine with database pagination.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, { in: "query", name: "search", schema: { type: "string", minLength: 2, maxLength: 100 } }, { in: "query", name: "status", schema: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED"] } }], responses: { "200": { description: "Paginated support tickets", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/PlatformSupportTicket" } } } } } } }, "400": { description: "Invalid search, status, or pagination" }, "401": { description: "Authentication required" }, "403": { description: "Platform support read permission required" } } },
        post: { tags: ["Platform Support"], summary: "Create a tenant support ticket", description: "Requires platform:support:manage. The server generates a collision-safe TKT-YYYY identifier and defaults the ticket to OPEN.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateSupportTicketRequest" }, example: { tenantId: "tenant-id", subject: "Payroll run fails on PAYE calculation", priority: "HIGH", description: "PAYE deductions are not computing correctly for employees on the N500k+ band." } } } }, responses: { "201": { description: "Ticket created", content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformSupportTicketDetail" } } } }, "400": { description: "Validation error" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" }, "404": { description: "Tenant not found" } } }
      },
      [`${platformAdminBase}/support/tickets/{ticketId}`]: { get: { tags: ["Platform Support"], summary: "View a support ticket", description: "Accepts the human ticket ID (for example TKT-2026-7A6B5C4D3E) or internal identifier. Requires platform:support:read.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Full ticket detail", content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformSupportTicketDetail" } } } }, "401": { description: "Authentication required" }, "403": { description: "Read permission required" }, "404": { description: "Ticket not found" } } } },
      [`${platformAdminBase}/support/tickets/{ticketId}/assign`]: { patch: { tags: ["Platform Support"], summary: "Assign or reassign a support ticket", description: "Requires platform:support:manage. The assignee must be an active Platform Admin.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AssignTicketRequest" } } } }, responses: { "200": { description: "Ticket assigned" }, "400": { description: "Invalid assignee" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" }, "404": { description: "Ticket not found" } } } },
      [`${platformAdminBase}/support/tickets/{ticketId}/resolution-notes`]: { patch: { tags: ["Platform Support"], summary: "Update ticket resolution notes", description: "Requires platform:support:manage. Notes can be edited while OPEN or IN_PROGRESS and do not resolve the ticket.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateResolutionNotesRequest" } } } }, responses: { "200": { description: "Notes updated" }, "400": { description: "Empty or oversized notes" }, "409": { description: "Ticket is already resolved" }, "404": { description: "Ticket not found" } } } },
      [`${platformAdminBase}/support/tickets/{ticketId}/status`]: { patch: { tags: ["Platform Support"], summary: "Update ticket status", description: "Allows OPEN to IN_PROGRESS/RESOLVED and IN_PROGRESS to RESOLVED. Same-state requests are idempotent; reopening is not supported.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTicketStatusRequest" } } } }, responses: { "200": { description: "Status updated" }, "400": { description: "Invalid status" }, "404": { description: "Ticket not found" }, "409": { description: "Invalid or concurrent transition" } } } },
      [`${platformAdminBase}/support/tickets/{ticketId}/resolve`]: { patch: { tags: ["Platform Support"], summary: "Mark a support ticket resolved", description: "Requires platform:support:manage. Sets resolvedAt and resolvedBy, preserves notes, and is idempotent when already resolved.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "ticketId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Ticket resolved" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" }, "404": { description: "Ticket not found" }, "409": { description: "Concurrent transition" } } } },
      [`${platformAdminBase}/settings`]: { get: { tags: ["Platform Settings"], summary: "Get consolidated platform settings", description: "Requires platform:settings:read. Returns configuration, the effective global password policy, feature flags, email templates, and maintenance state.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Consolidated settings" }, "401": { description: "Authentication required" }, "403": { description: "Platform settings read permission required" } } } },
      [`${platformAdminBase}/settings/configuration`]: {
        get: { tags: ["Platform Settings"], summary: "Get global platform configuration", security: [{ bearerAuth: [] }], responses: { "200": { description: "Platform configuration", content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformConfiguration" } } } }, "401": { description: "Authentication required" }, "403": { description: "Read permission required" } } },
        patch: { tags: ["Platform Settings"], summary: "Update global platform configuration", description: "Requires platform:settings:manage. Accepts one or more fields. Currency is restricted to NGN, USD, or GBP; timezone must be a valid IANA identifier.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdatePlatformConfigurationRequest" } } } }, responses: { "200": { description: "Configuration updated" }, "400": { description: "Unsupported currency, invalid VAT, timezone, email, or empty update" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" } } }
      },
      [`${platformAdminBase}/settings/password-policy`]: {
        get: { tags: ["Platform Settings"], summary: "Get global password policy", description: "The policy is enforced during registration, password reset, login lockout, and password-expiry checks.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Global password policy", content: { "application/json": { schema: { $ref: "#/components/schemas/PasswordPolicy" } } } }, "403": { description: "Read permission required" } } },
        patch: { tags: ["Platform Settings"], summary: "Update global password policy", description: "Requires platform:settings:manage. passwordExpiryDays=null means never expire. Tenant-specific 2FA and IP allowlist controls remain separate.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdatePasswordPolicyRequest" } } } }, responses: { "200": { description: "Policy updated" }, "400": { description: "Invalid or empty policy update" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" } } }
      },
      [`${platformAdminBase}/settings/feature-flags`]: { get: { tags: ["Platform Settings"], summary: "List global feature flags", description: "Requires platform:settings:read. Disabled is the default when a flag has not been persisted.", security: [{ bearerAuth: [] }], responses: { "200": { description: "All supported feature flags", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/FeatureFlag" } } } } }, "403": { description: "Read permission required" } } } },
      [`${platformAdminBase}/settings/feature-flags/{key}`]: { patch: { tags: ["Platform Settings"], summary: "Enable or disable a global feature flag", description: "Requires platform:settings:manage. The setting applies globally. Other modules can use the centralized isPlatformFeatureEnabled helper.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "key", required: true, schema: { type: "string", enum: ["BETA_ANALYTICS_DASHBOARD", "NEW_INVOICE_EDITOR", "BULK_USER_IMPORT", "AI_POWERED_INSIGHTS", "MULTI_CURRENCY_SUPPORT"] } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateFeatureFlagRequest" } } } }, responses: { "200": { description: "Feature flag updated" }, "400": { description: "Invalid key or body" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" }, "404": { description: "Feature flag not found" } } } },
      [`${platformAdminBase}/settings/email-templates`]: { get: { tags: ["Platform Settings"], summary: "List platform email templates", security: [{ bearerAuth: [] }], responses: { "200": { description: "All supported templates", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/EmailTemplate" } } } } }, "403": { description: "Read permission required" } } } },
      [`${platformAdminBase}/settings/email-templates/{key}`]: {
        get: { tags: ["Platform Settings"], summary: "Get a platform email template", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "key", required: true, schema: { type: "string", enum: ["ONBOARDING_WELCOME", "INVOICE_GENERATED", "PLAN_EXPIRY_REMINDER"] } }], responses: { "200": { description: "Email template", content: { "application/json": { schema: { $ref: "#/components/schemas/EmailTemplate" } } } }, "400": { description: "Invalid template key" }, "404": { description: "Template not found" } } },
        patch: { tags: ["Platform Settings"], summary: "Update a platform email template", description: "Requires platform:settings:manage. Placeholders use {{variable}} syntax and must belong to the template's availableVariables list. Rendered values are HTML escaped.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "key", required: true, schema: { type: "string", enum: ["ONBOARDING_WELCOME", "INVOICE_GENERATED", "PLAN_EXPIRY_REMINDER"] } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateEmailTemplateRequest" } } } }, responses: { "200": { description: "Template updated" }, "400": { description: "Blank content, unsafe HTML, malformed placeholder, or unsupported variable" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" }, "404": { description: "Template not found" } } }
      },
      [`${platformAdminBase}/settings/maintenance`]: {
        get: { tags: ["Platform Settings"], summary: "Get global maintenance state", security: [{ bearerAuth: [] }], responses: { "200": { description: "Maintenance state", content: { "application/json": { schema: { $ref: "#/components/schemas/MaintenanceMode" } } } }, "403": { description: "Read permission required" } } },
        patch: { tags: ["Platform Settings"], summary: "Update global maintenance mode", description: "Requires platform:settings:manage. During maintenance, authenticated tenant API requests receive HTTP 503 with MAINTENANCE_MODE. Health, docs, auth, internal/media recovery routes, and Platform Admin APIs remain accessible.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateMaintenanceModeRequest" } } } }, responses: { "200": { description: "Maintenance state updated" }, "400": { description: "Invalid or empty update" }, "401": { description: "Authentication required" }, "403": { description: "Manage permission required" }, "503": { description: "Tenant APIs return maintenance response while enabled", content: { "application/json": { example: { success: false, code: "MAINTENANCE_MODE", errorCode: "MAINTENANCE_MODE", message: "Sinkronis is currently undergoing scheduled maintenance.", data: null } } } } } }
      },
      [`${env.API_PREFIX}/telemetry/page-view`]: { post: { tags: ["Telemetry"], summary: "Record an authenticated tenant frontend page view", description: "Tenant-only instrumentation. Atomically increments a UTC daily aggregate and updates last activity; raw paths are validated but not retained. Frontends should call this once per client-side route view.", security: [{ bearerAuth: [] }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { path: { type: "string", maxLength: 500 } } } } } }, responses: { "201": { description: "Page view recorded" }, "400": { description: "Invalid path" }, "403": { description: "Platform Administrator telemetry rejected" } } } },
      [`${platformAdminBase}/modules`]: { get: { tags: ["Platform Module Management"], summary: "Get consolidated module adoption and paginated tenant configurations", description: "Requires platform:modules:read. usage is the cumulative active user-module assignments across enabled modules, not a unique-user count.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "search", schema: { type: "string", minLength: 2, maxLength: 100 } }, { in: "query", name: "tenantId", schema: { type: "string" } }, { in: "query", name: "tenantStatus", schema: { type: "string", enum: ["ALL", "ACTIVE", "SUSPENDED"] } }, { in: "query", name: "module", schema: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING"] } }, { in: "query", name: "enabled", schema: { type: "boolean" } }, { in: "query", name: "plan", schema: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE"] } }, { in: "query", name: "sortBy", schema: { type: "string", enum: ["tenantName", "tenantStatus", "usage", "hrisUsers", "payrollUsers", "accountingUsers", "lastUpdatedAt", "createdAt"] } }, { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"] } }], responses: { "200": { description: "Analytics, tenant rows, filters, and pagination" }, "400": { description: "Invalid filters" }, "403": { description: "Platform Administrator permission required" } } } },
      [`${platformAdminBase}/modules/analytics`]: { get: { tags: ["Platform Module Management"], summary: "Get HRIS, Payroll, and Accounting tenant/user adoption", description: "Counts only active non-deleted tenants with active subscriptions and enabled modules. User counts additionally require an active, unlocked user and matching role permission.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Per-module tenantCount and activeUserCount" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/modules/tenants`]: { get: { tags: ["Platform Module Management"], summary: "List tenant module configurations", description: "Database-level filtering, aggregate sorting, and pagination. ALL_IN_ONE is treated only as a plan filter.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Tenant configurations with enabled/disabled modules, per-module counts, cumulative usage, actor, timestamp, and version" }, "400": { description: "Invalid query" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/modules/tenants/{tenantId}`]: { get: { tags: ["Platform Module Management"], summary: "Get one tenant module configuration", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Tenant module configuration" }, "404": { description: "Tenant not found" }, "403": { description: "Forbidden" } } }, patch: { tags: ["Platform Module Management"], summary: "Atomically update multiple tenant modules", description: "Requires platform:modules:manage. Validates all entries, rolls back on failure, supports optimistic expectedVersion, applies immediately, preserves data, and audits changed modules only.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["modules", "reason"], properties: { modules: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", required: ["module", "enabled"], properties: { module: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING"] }, enabled: { type: "boolean" } } } }, reason: { type: "string", minLength: 3, maxLength: 1000 }, expectedVersion: { type: "integer", minimum: 1 } } } } } }, responses: { "200": { description: "Previous/current states and refreshed configuration" }, "400": { description: "Invalid or duplicate modules" }, "404": { description: "Active tenant not found" }, "409": { description: "Plan restriction, dependency, inactive subscription, or concurrent version conflict" } } } },
      [`${platformAdminBase}/modules/tenants/{tenantId}/{module}/enable`]: { patch: { tags: ["Platform Module Management"], summary: "Idempotently enable one module", description: "Immediately updates the authoritative entitlement and add-on state. Re-enabling restores access to preserved data.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "path", name: "module", required: true, schema: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING"] } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } } } }, responses: { "200": { description: "Current module state" }, "404": { description: "Tenant not found" }, "409": { description: "Subscription restriction" } } } },
      [`${platformAdminBase}/modules/tenants/{tenantId}/{module}/disable`]: { patch: { tags: ["Platform Module Management"], summary: "Idempotently disable one module", description: "New backend requests are denied immediately. Data is retained; no read-only access or exports are granted through module APIs while disabled. Processing payroll, pending finance work, draft/sent invoices, pending leave, and open appraisals block disablement.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "path", name: "module", required: true, schema: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING"] } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } } } }, responses: { "200": { description: "Current module state" }, "404": { description: "Tenant not found" }, "409": { description: "Included plan module or active dependency" } } } },
      [`${platformAdminBase}/users`]: { get: { tags: ["Platform User Management"], summary: "List and analyze users across all non-deleted tenants", description: "Requires platform:users:read. Search is trimmed, partial, case-insensitive under the configured MySQL collation, and tokenized for full-name matching. ACTIVE means login-eligible; rows may additionally report LOCKED or SUSPENDED.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "search", schema: { type: "string", minLength: 2, maxLength: 100 } }, { in: "query", name: "tenantId", schema: { type: "string" } }, { in: "query", name: "roleId", schema: { type: "string" } }, { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "ACTIVE", "INACTIVE"] } }, { in: "query", name: "sortBy", schema: { type: "string", enum: ["name", "email", "tenantName", "role", "lastActive", "status", "createdAt"] } }, { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"] } }], responses: { "200": { description: "Analytics, privacy-limited user rows, effective module access, applied filters, and pagination" }, "400": { description: "Invalid query or mismatched tenant/role" }, "403": { description: "Platform Administrator or permission required" }, "404": { description: "Tenant or role not found" } } } },
      [`${platformAdminBase}/users/analytics`]: { get: { tags: ["Platform User Management"], summary: "Get platform-wide user analytics", description: "Total excludes users belonging to archived/deleted tenants. Active users are enabled, unlocked users in active tenants. Inactive includes disabled, locked, and tenant-suspended users.", security: [{ bearerAuth: [] }], responses: { "200": { description: "totalUsers, activeUsers, and inactiveUsers" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/users/filter-options`]: { get: { tags: ["Platform User Management"], summary: "Get tenant, dynamic role, and supported status filter options", security: [{ bearerAuth: [] }], responses: { "200": { description: "Alphabetical non-deleted tenants, roles with identifiers, and statuses" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/users/{userId}/deactivate`]: { patch: { tags: ["Platform User Management"], summary: "Atomically deactivate a user and revoke sessions", description: "Requires platform:users:deactivate. Self-deactivation and removal of the last active Platform Administrator are blocked. The operation also revokes active impersonation sessions.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "userId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated inactive state and revoked-session count" }, "403": { description: "Forbidden" }, "404": { description: "User not found" }, "409": { description: "Already inactive, self-deactivation, protected last admin, or concurrent state change" } } } },
      [`${platformAdminBase}/users/{userId}/reset-password`]: { post: { tags: ["Platform User Management"], summary: "Initiate the existing secure OTP password-reset flow", description: "Requires platform:users:reset-password. Uses an atomic five-minute cooldown, invalidates older OTPs, returns no OTP/token/password, revokes active sessions after successful delivery, and is rate limited.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "userId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Reset instructions delivered" }, "403": { description: "Forbidden" }, "404": { description: "User not found" }, "409": { description: "Ineligible account or cooldown active" }, "503": { description: "Email delivery failed" } } } },
      [`${platformAdminBase}/users/{userId}/impersonate`]: { post: { tags: ["Platform User Management"], summary: "Start a privileged and audited short-lived user impersonation", description: "Requires platform:users:impersonate. Platform Administrator targets, nested/concurrent sessions, and ineligible users are blocked. The dedicated access token expires after 15 minutes and sensitive mutations are restricted.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "userId", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string", minLength: 3, maxLength: 500 } } } } } }, responses: { "200": { description: "Dedicated impersonation session, access token, expiry, identities, and banner text" }, "400": { description: "Invalid reason" }, "403": { description: "Forbidden" }, "404": { description: "User not found" }, "409": { description: "Protected/ineligible target or active impersonation exists" } } } },
      [`${platformAdminBase}/impersonation/stop`]: { post: { tags: ["Platform User Management"], summary: "Stop the current impersonation and restore the original Platform Administrator", description: "Validates and atomically ends the dedicated impersonation session, then returns a fresh short-lived Platform Administrator access token.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Impersonation ended and administrator token restored" }, "403": { description: "No valid active impersonation session" } } } },
      [`${platformAdminBase}/billing`]: { get: { tags: ["Platform Billing & Revenue"], summary: "Get consolidated billing analytics, revenue by plan, and paginated invoices", description: "Platform Administrator only. Monetary values are NGN decimal amounts.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Consolidated billing response" }, "400": { description: "Invalid filter or pagination" }, "403": { description: "Platform Administrator access required" } } } },
      [`${platformAdminBase}/billing/analytics`]: { get: { tags: ["Platform Billing & Revenue"], summary: "Get MRR, ARR, overdue amount, and churn rate", description: "MRR is active recurring monthly revenue; ARR is MRR × 12; overdue is the sum of OVERDUE invoices; churn is period cancellations/expiries divided by active subscriptions at period start.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "year", schema: { type: "integer" } }, { in: "query", name: "month", schema: { type: "integer", minimum: 1, maximum: 12 } }, { in: "query", name: "startDate", schema: { type: "string", format: "date" } }, { in: "query", name: "endDate", schema: { type: "string", format: "date" } }], responses: { "200": { description: "Analytics with documented formulas" }, "400": { description: "Invalid date range" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/billing/revenue-by-plan`]: { get: { tags: ["Platform Billing & Revenue"], summary: "Get monthly paid revenue grouped by subscription plan", description: "Returns zero-filled months suitable for stacked charts. Plans: HRIS, PAYROLL, ACCOUNTING, ALL_IN_ONE.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Monthly stacked-chart dataset" }, "400": { description: "Invalid filters" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/billing/invoices`]: {
        get: { tags: ["Platform Billing & Revenue"], summary: "Search, filter, sort, and paginate all platform invoices", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "search", schema: { type: "string" } }, { in: "query", name: "status", schema: { type: "string", enum: ["PAID", "OVERDUE", "DRAFT"] } }, { in: "query", name: "billingPeriod", schema: { type: "string", pattern: "^\\d{4}-\\d{2}$" } }, { in: "query", name: "sortBy", schema: { type: "string", enum: ["dueDate", "amount", "createdAt", "tenantName"] } }], responses: { "200": { description: "Invoices plus page, limit, total, totalPages, hasNextPage, and hasPreviousPage" }, "400": { description: "Invalid query" }, "403": { description: "Forbidden" } } },
        post: { tags: ["Platform Billing & Revenue"], summary: "Generate a tenant platform invoice", description: "Server generates invoice number, derives plan, defaults status to DRAFT, and rejects duplicate tenant/billing periods.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tenantId", "billingPeriod", "amount"], properties: { tenantId: { type: "string" }, billingPeriod: { type: "string", example: "2026-07" }, amount: { type: "number", exclusiveMinimum: true, maximum: 1000000000 }, currency: { type: "string", enum: ["NGN"] }, dueDate: { type: "string", format: "date" } } } } } }, responses: { "201": { description: "Complete created invoice" }, "400": { description: "Validation or eligibility failure" }, "404": { description: "Tenant not found" }, "409": { description: "Duplicate invoice" }, "403": { description: "Forbidden" } } }
      },
      [`${platformAdminBase}/billing/invoices/{invoiceId}/reminder`]: { post: { tags: ["Platform Billing & Revenue"], summary: "Send a payment reminder for a DRAFT or OVERDUE invoice", description: "A 24-hour per-invoice cooldown applies and every attempt is recorded.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "invoiceId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Reminder delivered" }, "404": { description: "Invoice or tenant not found" }, "409": { description: "Paid invoice or cooldown active" }, "503": { description: "Notification delivery failed" } } } },
      [`${platformAdminBase}/billing/invoices/{invoiceId}/download`]: { get: { tags: ["Platform Billing & Revenue"], summary: "Download a sanitized server-generated invoice PDF", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "invoiceId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Invoice PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } }, "404": { description: "Invoice not found" }, "403": { description: "Forbidden" } } } },
      [`${platformAdminBase}/billing/invoices/export`]: { get: { tags: ["Platform Billing & Revenue"], summary: "Export all or filtered invoice records as CSV", description: "Streams cursor-paginated 500-row batches using the listing filters and sort allowlist; dangerous spreadsheet formula prefixes are neutralized.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Streamed UTF-8 CSV export", content: { "text/csv": { schema: { type: "string", format: "binary" } } } }, "400": { description: "Invalid filter" }, "403": { description: "Forbidden" }, "500": { description: "Export failure before streaming begins" } } } },
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          responses: {
            "200": {
              description: "Service status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      [`${authBase}/register`]: {
        post: {
          tags: ["Auth"],
          summary: "Register organization and owner",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegisterOrganizationBody" }
              }
            }
          },
          responses: {
            "201": { description: "Created" },
            "400": { description: "Validation error" }
          }
        }
      },
      [`${authBase}/login`]: {
        post: {
          tags: ["Auth"],
          summary: "Login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginBody" }
              }
            }
          },
          responses: {
            "200": { description: "Authenticated" },
            "401": { description: "Invalid credentials" }
          }
        }
      },
      [`${authBase}/login/2fa/verify`]: {
        post: {
          tags: ["Auth"],
          summary: "Verify login 2FA challenge",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerifyLoginTwoFactorBody" }
              }
            }
          },
          responses: {
            "200": { description: "Authenticated" },
            "400": { description: "Invalid or expired challenge/OTP" }
          }
        }
      },
      [`${authBase}/2fa/status`]: {
        get: {
          tags: ["Auth"],
          summary: "Get current user 2FA status",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "2FA status payload" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      [`${authBase}/2fa/authenticator/setup`]: {
        post: {
          tags: ["Auth"],
          summary: "Begin authenticator app setup",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BeginAuthenticatorSetupBody" }
              }
            }
          },
          responses: {
            "200": { description: "Setup token and otpauth URI" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      [`${authBase}/2fa/authenticator/enable`]: {
        post: {
          tags: ["Auth"],
          summary: "Enable authenticator app method",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EnableAuthenticatorBody" }
              }
            }
          },
          responses: {
            "200": { description: "Authenticator enabled" },
            "400": { description: "Invalid setup token or OTP" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      [`${authBase}/2fa/authenticator/disable`]: {
        post: {
          tags: ["Auth"],
          summary: "Disable authenticator app method",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DisableAuthenticatorBody" }
              }
            }
          },
          responses: {
            "200": { description: "Authenticator disabled" },
            "400": { description: "Invalid OTP" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      [`${authBase}/2fa/preferred-method`]: {
        put: {
          tags: ["Auth"],
          summary: "Update preferred 2FA method for current user",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdatePreferredTwoFactorMethodBody" }
              }
            }
          },
          responses: {
            "200": { description: "Preferred method updated" },
            "400": { description: "Method unavailable for account" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      [`${authBase}/forgot-password`]: {
        post: {
          tags: ["Auth"],
          summary: "Request password reset OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ForgotPasswordBody" }
              }
            }
          },
          responses: {
            "200": { description: "OTP sent" },
            "400": { description: "Invalid request" }
          }
        }
      },
      [`${authBase}/forgot-password/resend-otp`]: {
        post: {
          tags: ["Auth"],
          summary: "Resend password reset OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ForgotPasswordBody" }
              }
            }
          },
          responses: {
            "200": { description: "OTP resent" },
            "400": { description: "Invalid request" }
          }
        }
      },
      [`${authBase}/forgot-password/verify-otp`]: {
        post: {
          tags: ["Auth"],
          summary: "Verify password reset OTP",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerifyOtpBody" }
              }
            }
          },
          responses: {
            "200": { description: "OTP verified" },
            "400": { description: "Invalid OTP" }
          }
        }
      },
      [`${authBase}/reset-password`]: {
        post: {
          tags: ["Auth"],
          summary: "Reset account password",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ResetPasswordBody" }
              }
            }
          },
          responses: {
            "200": { description: "Password reset successful" },
            "400": { description: "Invalid token or payload" }
          }
        }
      },
      [`${env.API_PREFIX}/media/upload`]: {
        post: {
          tags: ["Media"],
          summary: "Upload a profile image",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Uploaded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MediaUploadResponse" }
                }
              }
            },
            "400": { description: "Invalid file" }
          }
        }
      },
      [`${adminBase}/dashboard`]: {
        get: {
          tags: ["Admin"],
          summary: "Get tenant admin dashboard data",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Dashboard payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/modules`]: {
        get: {
          tags: ["Admin"],
          summary: "Get admin modules section payload",
          description:
            "Returns module analytics summary and module cards including status, tabs, active-user counts, and launch action metadata.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Module section payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AdminModuleSectionResponse" }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/modules/{moduleKey}/status`]: {
        patch: {
          tags: ["Admin"],
          summary: "Update tenant module status",
          description:
            "Changes a module status (ACTIVE, INACTIVE, COMING_SOON) and updates module enabled config for compatibility.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "moduleKey",
              required: true,
              schema: { type: "string", enum: ["hris", "accounting", "payroll"] }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ModuleStatusUpdateBody" }
              }
            }
          },
          responses: {
            "200": { description: "Module status updated" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Module not found" }
          }
        }
      },
      [`${platformAdminBase}/dashboard`]: {
        get: {
          tags: ["Platform Dashboard"], summary: "Get the complete Platform Dashboard",
          description: "The only active Platform Dashboard data endpoint. Returns analytics, the last six revenue months, module adoption, recent activity controlled by activityLimit, and searchable/filterable/sortable paginated tenant health from one shared tenant snapshot.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 }, description: "Tenant Health page only." },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 }, description: "Tenant Health page size only." },
            { in: "query", name: "activityLimit", schema: { type: "integer", minimum: 1, maximum: 100, default: 10 } },
            { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
            { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "TRIAL", "TRIALING", "PENDING", "EXPIRED", "SUSPENDED", "CANCELLED"] } },
            { in: "query", name: "plan", schema: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE", "hris", "payroll", "accounting", "all-in-one"] } },
            { in: "query", name: "module", schema: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING", "hris", "payroll", "accounting"] } },
            { in: "query", name: "registeredFrom", schema: { type: "string", format: "date-time" } },
            { in: "query", name: "registeredTo", schema: { type: "string", format: "date-time" } },
            { in: "query", name: "revenueMin", schema: { type: "number", minimum: 0 } },
            { in: "query", name: "revenueMax", schema: { type: "number", minimum: 0 } },
            { in: "query", name: "sortBy", schema: { type: "string", enum: ["organizationName", "registrationDate", "lastActiveAt", "lastActiveDate", "monthlyRecurringRevenue", "mrr", "userCount", "subscriptionStatus"], default: "organizationName" } },
            { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"], default: "asc" } }
          ],
          responses: {
            "200": {
              description: "Complete dashboard retrieved",
              content: {
                "application/json": {
                  schema: {
                    type: "object", required: ["success", "message", "data"],
                    properties: {
                      success: { type: "boolean", example: true }, message: { type: "string", example: "Platform dashboard retrieved" },
                      data: {
                        type: "object", required: ["analytics", "revenueTrend", "moduleAdoption", "recentActivity", "tenantHealth"],
                        properties: {
                          analytics: { $ref: "#/components/schemas/PlatformDashboardAnalytics" },
                          revenueTrend: { $ref: "#/components/schemas/PlatformRevenueTrend" },
                          moduleAdoption: { $ref: "#/components/schemas/PlatformModuleAdoption" },
                          recentActivity: { type: "array", items: { $ref: "#/components/schemas/PlatformActivity" } },
                          tenantHealth: {
                            type: "object",
                            properties: {
                              records: { type: "array", items: { $ref: "#/components/schemas/PlatformTenantHealth" } },
                              pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } },
                              metadata: { type: "object" }
                            }
                          },
                          metadata: { type: "object", properties: { generatedAt: { type: "string", format: "date-time" }, currency: { type: "string", enum: ["NGN"] }, activityLimit: { type: "integer" } } }
                        }
                      }
                    }
                  },
                  example: {
                    success: true, message: "Platform dashboard retrieved",
                    data: {
                      analytics: { currency: "NGN", totalTenants: 24, activeTenants: 18, totalUsers: 540, platformMrr: 2450000, averageModulesPerTenant: 2.3 },
                      revenueTrend: { currency: "NGN", months: [{ month: "February", year: 2026, monthlyRevenue: 1900000 }] },
                      moduleAdoption: { denominator: "ACTIVE_TENANTS", totalActiveTenants: 18, modules: [{ moduleId: "hris", moduleName: "HRIS", tenantCount: 15, percentageAdoption: 83.33 }] },
                      recentActivity: [],
                      tenantHealth: { records: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }, metadata: { currency: "NGN" } },
                      metadata: { generatedAt: "2026-07-27T12:00:00.000Z", currency: "NGN", activityLimit: 10 }
                    }
                  }
                }
              }
            },
            "400": { description: "Invalid query parameters", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } },
            "401": { description: "Authentication required" },
            "403": { description: "Platform Admin identity and platform:dashboard:view permission required" },
            "500": { description: "Unexpected dashboard aggregation failure" }
          }
        }
      },
      [`${platformAdminBase}/pricing`]: {
        get: {
          tags: ["Platform Pricing & Plans"], summary: "Get consolidated Pricing and Plans page",
          description: "Requires platform:pricing:view. Returns confirmed current MRR, module/plan pricing cards, and paginated subscription distribution. Active All-in-One revenue is classified only under All-in-One, while adoption may still include its modules. Amounts are whole Nigerian Naira at the API boundary and DECIMAL(14,2) in storage.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
            { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
            { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "ACTIVE", "INACTIVE", "ARCHIVED"] } },
            { in: "query", name: "pricingModel", schema: { type: "string", enum: ["ALL", "FLAT_MONTHLY"] } },
            { in: "query", name: "sortBy", schema: { type: "string", enum: ["name", "activeTenantCount", "monthlyRevenue", "basePrice", "totalEmployees"] } },
            { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"] } }
          ],
          responses: {
            "200": { description: "Pricing overview, cards, distribution, and all plans", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { type: "object", required: ["overview", "modules", "subscriptionDistribution", "plans"], properties: { overview: { type: "object" }, modules: { type: "array", items: { $ref: "#/components/schemas/PlatformPricingCard" } }, subscriptionDistribution: { type: "object", properties: { items: { type: "array" }, summary: { type: "object" }, pagination: { type: "object" } } }, plans: { type: "array", items: { type: "object" } } } } } }, example: { success: true, message: "Pricing and plans retrieved successfully", data: { overview: { totalRevenue: 3200000, moduleRevenue: { hris: 1600000, accounting: 800000, payroll: 200000 }, allInOneRevenue: 600000, totalActiveTenants: 30, totalActiveSubscriptions: 34, currency: "NGN" }, modules: [], subscriptionDistribution: { items: [], summary: { totalActiveTenants: 30, totalEmployees: 450, totalMonthlyRevenue: 3200000, currency: "NGN" }, pagination: { page: 1, limit: 20, total: 4, totalPages: 1, hasNextPage: false, hasPreviousPage: false } }, plans: [] } } } } },
            "400": { description: "Invalid query", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } },
            "401": { description: "Authentication required" }, "403": { description: "Platform Admin pricing-view permission required" }, "500": { description: "Internal server error" }
          }
        }
      },
      [`${platformAdminBase}/pricing/modules/{moduleId}/price`]: {
        patch: {
          tags: ["Platform Pricing & Plans"], summary: "Create an effective-dated price version",
          description: "Requires platform:pricing:manage. Preserves immutable price history and completed invoices. Existing subscriptions retain their agreed price until renewal; new subscriptions use the effective price. Serializable transaction and optional expectedVersion prevent lost concurrent updates.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "moduleId", required: true, schema: { type: "string" }, description: "Product plan ID or key, including all-in-one." }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformPriceUpdateBody" } } } },
          responses: { "200": { description: "Price version created" }, "400": { description: "Invalid amount, date, duplicate price, or optimistic-lock conflict" }, "401": { description: "Unauthorized" }, "403": { description: "Pricing-management permission required" }, "404": { description: "Module or plan not found" }, "409": { description: "Concurrent price update conflict" } }
        }
      },
      [`${platformAdminBase}/pricing/plans`]: {
        post: {
          tags: ["Platform Pricing & Plans"], summary: "Create subscription plan",
          description: "Requires platform:pricing:manage. Creates the normalized plan, initial DECIMAL price version, and validated feature relationships atomically. Existing subscriptions are unchanged.",
          security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformPlanCreateBody" } } } },
          responses: { "201": { description: "Plan created" }, "400": { description: "Invalid or duplicate feature request" }, "403": { description: "Pricing-management permission required" }, "409": { description: "Normalized plan name already exists" } }
        }
      },
      [`${platformAdminBase}/tenants`]: {
        post: {
          tags: ["Platform Tenants"], summary: "Create a tenant",
          description: "Creates the organization, Tenant Admin, default settings, modular subscription and module entitlements atomically. Sends the existing password-setup OTP and records a platform audit event.",
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreatePlatformTenantBody" } } } },
          responses: {
            "201": { description: "Tenant created" }, "400": { description: "Invalid plan, country, or request" },
            "401": { description: "Authentication required" }, "403": { description: "platform:tenants:create permission required" },
            "409": { description: "Company name or Admin email already exists" }
          }
        },
        get: {
          tags: ["Platform Tenants"], summary: "List all managed tenants",
          description: "Returns a Platform Admin-only tenant table with active module badges, active user totals, base-plan NGN MRR, dynamically derived subscription status, last authenticated activity, and View/Suspend actions. All-in-One tenants match every included module filter.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
            { in: "query", name: "search", description: "Case-insensitive partial match on organization name, company email, or industry.", schema: { type: "string", maxLength: 100 } },
            { in: "query", name: "plan", schema: { type: "string", enum: ["ALL", "HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE"] } },
            { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "ACTIVE", "SUSPENDED", "TRIAL", "PENDING", "CANCELLED", "EXPIRED"] } },
            { in: "query", name: "module", schema: { type: "string", enum: ["ALL", "HRIS", "PAYROLL", "ACCOUNTING"] } },
            { in: "query", name: "sortBy", schema: { type: "string", enum: ["organizationName", "createdAt", "createdDate", "lastActiveAt", "lastActive", "mrr", "monthlyRecurringRevenue", "totalUsers", "numberOfUsers"], default: "organizationName" } },
            { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"], default: "asc" } }
          ],
          responses: {
            "200": { description: "Paginated tenants", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { type: "array", items: { $ref: "#/components/schemas/PlatformTenantRow" } }, metadata: { type: "object" }, pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" }, hasPreviousPage: { type: "boolean" }, hasNextPage: { type: "boolean" } } } } } } } },
            "400": { description: "Invalid search, filter, sorting, or pagination" }, "401": { description: "Authentication required" }, "403": { description: "Platform Admin access required" }, "500": { description: "Internal server error" }
          }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}`]: {
        get: {
          tags: ["Platform Tenants"], summary: "View complete tenant details",
          description: "Returns organization identity, modular subscription, dynamically derived status, MRR, country, timestamps, active modules and available management actions.",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Tenant summary", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { $ref: "#/components/schemas/PlatformTenantSummary" } } } } } }, "401": { description: "Authentication required" }, "403": { description: "Platform Admin access required" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/overview`]: {
        get: {
          tags: ["Platform Tenants"], summary: "Get tenant overview",
          description: "Returns user analytics, active modules, subscription and only company-profile fields available in the current model.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Tenant overview" }, "401": { description: "Authentication required" }, "403": { description: "Platform Admin access required" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/users`]: {
        get: {
          tags: ["Platform Tenants"], summary: "List tenant users",
          description: "Returns both total user count and a paginated user table.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "tenantId", required: true, schema: { type: "string" } },
            { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
            { in: "query", name: "search", schema: { type: "string", maxLength: 100 } },
            { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "ACTIVE", "INACTIVE", "SUSPENDED", "INVITED"] } }
          ],
          responses: { "200": { description: "Tenant users", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { type: "object", properties: { totalUsers: { type: "integer" }, users: { type: "array", items: { $ref: "#/components/schemas/PlatformTenantUser" } } } }, pagination: { type: "object" } } } } } }, "400": { description: "Invalid query" }, "403": { description: "Forbidden" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/users/{userId}/deactivate`]: {
        patch: {
          tags: ["Platform Tenants"], summary: "Deactivate a tenant user", description: "Disables login, revokes sessions, preserves user data and records an audit event.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "path", name: "userId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "User deactivated" }, "400": { description: "User already inactive" }, "403": { description: "Management permission required" }, "404": { description: "Tenant user not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/users/{userId}/reset-password`]: {
        post: {
          tags: ["Platform Tenants"], summary: "Trigger tenant user password reset", description: "Uses the existing reset-token/email flow and never returns password material.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "path", name: "userId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Password reset initiated" }, "403": { description: "Management permission required" }, "404": { description: "Tenant user not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/modules`]: {
        get: {
          tags: ["Platform Tenants"], summary: "List tenant modules", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Module entitlements", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { type: "object", properties: { modules: { type: "array", items: { $ref: "#/components/schemas/PlatformTenantModule" } } } } } } } } }, "403": { description: "Forbidden" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/modules/{moduleId}`]: {
        patch: {
          tags: ["Platform Tenants"], summary: "Enable or disable tenant module",
          description: "Updates access immediately. Plan-included modules cannot be disabled; module data is preserved.",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "path", name: "moduleId", required: true, schema: { type: "string", enum: ["hris", "payroll", "accounting"] } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["enabled"], additionalProperties: false, properties: { enabled: { type: "boolean" } } }, example: { enabled: true } } } },
          responses: { "200": { description: "Module updated" }, "400": { description: "Invalid or plan-protected module transition" }, "403": { description: "Module management permission required" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/billing`]: {
        get: {
          tags: ["Platform Tenants"], summary: "Get tenant subscription and invoices", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "PAID", "PENDING", "FAILED", "CANCELLED", "REFUNDED"] } }],
          responses: { "200": { description: "Current subscription and paginated invoice history" }, "400": { description: "Invalid query" }, "403": { description: "Forbidden" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/subscription/override`]: {
        patch: {
          tags: ["Platform Tenants"], summary: "Override tenant subscription plan",
          description: "Validates modular plans, updates module entitlements, preserves billing history, notifies the tenant and records an audit event.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["plan"], additionalProperties: false, properties: { plan: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE"] }, effectiveDate: { type: "string", format: "date-time" }, reason: { type: "string", minLength: 3, maxLength: 1000 } } }, example: { plan: "ALL_IN_ONE", reason: "Subscription adjustment" } } } },
          responses: { "200": { description: "Plan override applied with previous/new cost and billing impact" }, "400": { description: "Invalid plan or request" }, "403": { description: "Billing management permission required" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/activity`]: {
        get: {
          tags: ["Platform Tenants"], summary: "Get tenant activity log", description: "Returns merged tenant audit and authentication activity newest first.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }],
          responses: { "200": { description: "Paginated activity entries" }, "400": { description: "Invalid pagination" }, "403": { description: "Forbidden" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/support-tickets`]: {
        get: {
          tags: ["Platform Tenants"], summary: "Get tenant support tickets", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }, { in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } }, { in: "query", name: "search", description: "Partial ticket number or subject.", schema: { type: "string" } }, { in: "query", name: "status", schema: { type: "string", enum: ["ALL", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"] } }, { in: "query", name: "priority", schema: { type: "string", enum: ["ALL", "HIGH", "MEDIUM", "LOW"] } }, { in: "query", name: "sortOrder", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } }],
          responses: { "200": { description: "Paginated support tickets" }, "400": { description: "Invalid filters" }, "403": { description: "Forbidden" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/impersonate`]: {
        post: {
          tags: ["Platform Tenants"], summary: "Impersonate Tenant Admin",
          description: "Creates an audited, persisted, short-lived scoped session without exposing Tenant Admin credentials.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Impersonation access token and expiry" }, "400": { description: "Tenant is suspended or has no active Admin" }, "403": { description: "Impersonation permission required" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${platformAdminBase}/impersonation/exit`]: {
        post: {
          tags: ["Platform Tenants"], summary: "Exit tenant impersonation",
          description: "Ends the persisted impersonation session and issues a fresh access token for the original Platform Admin without re-authentication.",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Platform Admin session restored" }, "400": { description: "Token is not an impersonation session" }, "401": { description: "Authentication or impersonation session invalid" } }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/suspend`]: {
        patch: {
          tags: ["Platform Tenants"], summary: "Suspend a tenant immediately",
          description: "Changes the organization to SUSPENDED without deleting data, stores the optional reason and Platform Admin actor, revokes every active tenant session, blocks existing access tokens, and creates an immutable tenant audit event.",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/SuspendPlatformTenantBody" }, example: { reason: "Terms-of-service violation pending review" } } } },
          responses: {
            "200": { description: "Tenant suspended", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { type: "object", properties: { organizationId: { type: "string" }, organizationName: { type: "string" }, status: { type: "string", enum: ["SUSPENDED"] }, suspensionReason: { type: "string", nullable: true }, suspendedAt: { type: "string", format: "date-time" }, suspendedByUserId: { type: "string" }, invalidatedSessions: { type: "integer" } } } } } } } },
            "400": { description: "Invalid reason or tenant already suspended" }, "401": { description: "Authentication required" }, "403": { description: "Platform Admin suspend permission required" }, "404": { description: "Tenant not found" }, "500": { description: "Internal server error" }
          }
        }
      },
      [`${platformAdminBase}/tenants/{tenantId}/activate`]: {
        patch: {
          tags: ["Platform Tenants"], summary: "Reactivate a suspended tenant",
          description: "Restores authentication access while preserving the existing subscription and records the Platform Admin action.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Tenant activated" }, "400": { description: "Tenant is not suspended" }, "403": { description: "Tenant management permission required" }, "404": { description: "Tenant not found" } }
        }
      },
      [`${adminBase}/general-settings/overview`]: {
        get: { tags: ["General Settings"], summary: "Get General Settings overview", description: "Returns the tenant's locale, branding, and Data & Privacy action references.", security: [{ bearerAuth: [] }], responses: { "200": { description: "Overview retrieved", content: { "application/json": { schema: { $ref: "#/components/schemas/GeneralSettingsResponse" } } } }, "401": { description: "Authentication required" }, "403": { description: "Tenant Admin permission required" } } }
      },
      [`${adminBase}/general-settings/locale`]: {
        get: { tags: ["General Settings"], summary: "Get Locale & Region settings", security: [{ bearerAuth: [] }], responses: { "200": { description: "Settings retrieved", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { $ref: "#/components/schemas/GeneralLocaleSettings" } } } } } }, "403": { description: "Forbidden" } } },
        put: { tags: ["General Settings"], summary: "Save Locale & Region settings", description: "Validates all values and atomically synchronizes the organization's currency and regional settings. Requires admin:settings:update.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/GeneralLocaleSettings" }, example: { timeZone: "Africa/Lagos", language: "en", dateFormat: "DD/MM/YYYY", currency: "NGN" } } } }, responses: { "200": { description: "Settings updated" }, "400": { description: "Unsupported timezone, language, date format, or currency", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/general-settings/locale/options`]: {
        get: { tags: ["General Settings"], summary: "Search supported locale options", description: "Returns supported IANA timezones plus configured languages, date formats, and ISO currencies.", security: [{ bearerAuth: [] }], parameters: [{ in: "query", name: "search", schema: { type: "string" }, example: "Africa" }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } }], responses: { "200": { description: "Options retrieved" }, "400": { description: "Invalid query" }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/general-settings/branding`]: {
        get: { tags: ["General Settings"], summary: "Get organization branding", security: [{ bearerAuth: [] }], responses: { "200": { description: "Branding retrieved", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { $ref: "#/components/schemas/GeneralBrandingSettings" } } } } } }, "403": { description: "Forbidden" } } },
        patch: { tags: ["General Settings"], summary: "Atomically update accent color and/or link text", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", minProperties: 1, properties: { accentColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", example: "#0F766E" }, linkText: { type: "string", maxLength: 80, nullable: true, example: "Powered by Acme" } } } } } }, responses: { "200": { description: "Branding updated" }, "400": { description: "Invalid color or link text" }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/general-settings/branding/logo`]: {
        post: { tags: ["General Settings"], summary: "Upload or replace organization logo", description: "Accepts a genuine PNG or safe SVG up to 2 MB. A 200 x 200 pixel minimum is recommended and reported in the response.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["logo"], properties: { logo: { type: "string", format: "binary", description: "PNG or SVG; maximum 2 MB." } } } } } }, responses: { "200": { description: "Logo stored and previous managed logo removed" }, "400": { description: "Missing, oversized, unsupported, malformed, or unsafe image" }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/general-settings/data-privacy/exports`]: {
        post: { tags: ["General Settings"], summary: "Request organization data export", description: "Creates a tenant-isolated platform fulfilment request for CSV and JSON exports of employees, invoices, expenses/payment requests, attendance, and organization settings. The platform administrator must deliver the archive to the requesting official Tenant Admin email within 24 hours. Duplicate pending requests are rejected. Requires admin:settings:export.", security: [{ bearerAuth: [] }], responses: { "201": { description: "Export request accepted with its delivery deadline", content: { "application/json": { schema: { $ref: "#/components/schemas/OrganizationExportResponse" } } } }, "400": { description: "A request is already pending" }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/general-settings/data-privacy/exports/{exportId}/download`]: {
        get: { tags: ["General Settings"], summary: "Download a fulfilled owned organization export", description: "Available only after the future platform-admin fulfilment process has prepared the tenant-owned archive; primary delivery is to the official Tenant Admin email.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "exportId", required: true, schema: { type: "string" } }], responses: { "200": { description: "ZIP archive", content: { "application/zip": { schema: { type: "string", format: "binary" } } } }, "403": { description: "Forbidden" }, "404": { description: "Export is pending, does not belong to tenant, or file is unavailable" } } }
      },
      [`${adminBase}/general-settings/data-privacy/deletion-request`]: {
        post: { tags: ["General Settings"], summary: "Request permanent organization deletion", description: "Re-authenticates the Tenant Admin and submits a single pending request for future platform-admin approval. This endpoint does not immediately delete tenant data. Requires admin:settings:delete-request.", security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/OrganizationDeletionRequestBody" }, example: { confirmationPhrase: "DELETE ORGANIZATION", password: "current-password", reason: "Closing this workspace" } } } }, responses: { "201": { description: "Request submitted with PENDING_PLATFORM_APPROVAL status" }, "400": { description: "Invalid phrase, password, or duplicate pending request", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/notifications-alerts/overview`]: {
        get: {
          tags: ["Notifications & Alerts"], summary: "Get Tenant Admin notifications and alerts overview",
          description: "Returns independently configured In-App and Email preferences plus the five newest platform announcements.", security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Overview retrieved" }, "401": { description: "Authentication required" }, "403": { description: "Tenant Admin permissions required" } }
        }
      },
      [`${adminBase}/notifications-alerts/preferences/{channelKey}`]: {
        get: {
          tags: ["Notifications & Alerts"], summary: "Get preferences for one notification channel", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "channelKey", required: true, schema: { type: "string", enum: ["IN_APP", "EMAIL"] }, example: "IN_APP" }],
          responses: { "200": { description: "Preferences grouped by module", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferenceResponse" } } } }, "400": { description: "Invalid channel" }, "403": { description: "Forbidden" }, "404": { description: "Channel not found" } }
        }
      },
      [`${adminBase}/notifications-alerts/preferences/{channelKey}/modules/{moduleKey}`]: {
        patch: {
          tags: ["Notifications & Alerts"], summary: "Enable or disable every category in a module atomically",
          description: "Only the selected channel is changed; preferences in other channels are unaffected.", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "channelKey", required: true, schema: { type: "string", enum: ["IN_APP", "EMAIL"] } }, { in: "path", name: "moduleKey", required: true, schema: { type: "string", enum: ["hris", "payroll", "accounting"] } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationToggleBody" }, example: { enabled: false } } } },
          responses: { "200": { description: "Module preferences updated", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferenceResponse" } } } }, "400": { description: "Validation or duplicate operation", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } }, "403": { description: "Forbidden" }, "404": { description: "Module or channel not found" } }
        }
      },
      [`${adminBase}/notifications-alerts/preferences/{channelKey}/modules/{moduleKey}/categories/{categoryId}`]: {
        patch: {
          tags: ["Notifications & Alerts"], summary: "Enable or disable one notification category", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "channelKey", required: true, schema: { type: "string", enum: ["IN_APP", "EMAIL"] } }, { in: "path", name: "moduleKey", required: true, schema: { type: "string", enum: ["hris", "payroll", "accounting"] } }, { in: "path", name: "categoryId", required: true, schema: { type: "string" }, example: "hris-reminders" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationToggleBody" } } } },
          responses: { "200": { description: "Category preference updated", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferenceResponse" } } } }, "400": { description: "Validation or duplicate operation" }, "403": { description: "Forbidden" }, "404": { description: "Category not found in module" } }
        }
      },
      [`${adminBase}/notifications-alerts/announcements`]: {
        get: {
          tags: ["Notifications & Alerts"], summary: "List published platform announcements", security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "type", schema: { type: "string", enum: ["FEATURE", "MAINTENANCE", "SECURITY", "UPDATE"] } },
            { in: "query", name: "readStatus", schema: { type: "string", enum: ["ALL", "READ", "UNREAD"], default: "ALL" } },
            { in: "query", name: "sort", schema: { type: "string", enum: ["NEWEST", "OLDEST"], default: "NEWEST" } },
            { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }
          ],
          responses: { "200": { description: "Newest-first by default with per-user read state", content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformAnnouncementListResponse" } } } }, "400": { description: "Invalid filter" }, "403": { description: "Forbidden" } }
        }
      },
      [`${adminBase}/notifications-alerts/announcements/read-all`]: {
        post: { tags: ["Notifications & Alerts"], summary: "Mark every visible announcement as read for the current Tenant Admin", security: [{ bearerAuth: [] }], responses: { "200": { description: "Read statuses created; repeated calls return markedRead=0" }, "403": { description: "Forbidden" } } }
      },
      [`${adminBase}/notifications-alerts/announcements/{announcementId}`]: {
        get: {
          tags: ["Notifications & Alerts"], summary: "Get a published announcement", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "announcementId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Complete announcement", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { $ref: "#/components/schemas/PlatformAnnouncement" } } } } } }, "403": { description: "Forbidden" }, "404": { description: "Announcement missing, unpublished, or expired" } }
        }
      },
      [`${adminBase}/notifications-alerts/announcements/{announcementId}/learn-more`]: {
        get: { tags: ["Notifications & Alerts"], summary: "Get full Learn More content", description: "Returns content and format plus optional external URL/content reference for future rendering modes.", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "announcementId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Full content" }, "404": { description: "Announcement not found" } } }
      },
      [`${adminBase}/notifications-alerts/announcements/{announcementId}/read`]: {
        post: { tags: ["Notifications & Alerts"], summary: "Mark one announcement as read for the current Tenant Admin", security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "announcementId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Read status created" }, "400": { description: "Already read", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } }, "404": { description: "Announcement not found" } } }
      },
      [`${adminBase}/my-plan/overview`]: {
        get: {
          tags: ["My Plan"],
          summary: "Get My Plan overview",
          description: "Returns dynamic subscription status, employee/module analytics, renewal date, server-calculated monthly totals, active-module pricing and quick actions.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "My Plan overview", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanOverviewResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/plans`]: {
        get: {
          tags: ["My Plan"],
          summary: "List the HRIS, Payroll, Accounting and All-in-One offerings",
          description: "Prices are NGN 80,000, NGN 10,000, NGN 80,000 and NGN 150,000 per month respectively. Feature lists and eligibility are calculated server-side.",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Plans and upgrade payload", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanPlansResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/subscriptions`]: {
        post: {
          tags: ["My Plan"], summary: "Preview or confirm an initial modular plan purchase",
          description: "Supports HRIS, Payroll, Accounting, or All-in-One. confirm=false returns pricing without mutation; confirm=true creates the subscription and billing record.",
          security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanChangeBody" } } } },
          responses: { "200": { description: "Purchase preview" }, "201": { description: "Subscription purchased" }, "400": { description: "Validation, duplicate purchase, or payment error", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } } }
        }
      },
      [`${adminBase}/my-plan/subscription/plan`]: {
        patch: {
          tags: ["My Plan"],
          summary: "Preview or confirm an upgrade to All-in-One",
          description: "confirm=false returns Review Plan Change without mutation. confirm=true validates eligibility and payment before applying. Individual modules must be purchased via module-add-ons.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanChangeBody" } } }
          },
          responses: {
            "200": { description: "Plan preview or confirmed scheduled change", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanPreviewResponse" } } } },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/subscription/cancel`]: {
        post: {
          tags: ["My Plan"],
          summary: "Schedule subscription cancellation or keep plan",
          description:
            "Schedules cancellation at the current billing period end when confirmed. Passing keepPlan=true keeps the plan active and clears any pending cancellation.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanCancelSubscriptionBody" } } }
          },
          responses: {
            "200": { description: "Cancellation processed or plan kept", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "400": { description: "Missing or invalid cancellation confirmation" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/subscription/plan-change/{changeId}`]: {
        delete: {
          tags: ["My Plan"], summary: "Cancel a pending plan change", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "changeId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Scheduled change cancelled" }, "404": { description: "Owned pending change not found" } }
        }
      },
      [`${adminBase}/my-plan/module-add-ons`]: {
        get: {
          tags: ["My Plan"],
          summary: "Get active and eligible available modules",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Module add-ons payload", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/module-add-ons/{moduleKey}`]: {
        patch: {
          tags: ["My Plan"],
          summary: "Preview/confirm a module purchase or cancel an add-on",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "moduleKey", required: true, schema: { type: "string", enum: ["hris", "accounting", "payroll"] } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanAddonUpdateBody" } } }
          },
          responses: {
            "200": { description: "Add-on updated", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "400": { description: "Validation or business rule error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Module not found" }
          }
        }
      },
      [`${adminBase}/my-plan/payment-method`]: {
        get: {
          tags: ["My Plan"],
          summary: "Get payment method and billing address metadata",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Payment method payload", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        patch: {
          tags: ["My Plan"],
          summary: "Update default payment method metadata",
          description:
            "Updates safe card metadata only and returns the full payment-method page payload, including billing address metadata. Use POST /payment-method/cards for raw card entry and tokenization.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanPaymentMethodBody" } } }
          },
          responses: {
            "200": { description: "Payment method updated", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/payment-method/location-options`]: {
        get: {
          tags: ["My Plan"],
          summary: "Get country and state dropdown options",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "query", name: "country", schema: { type: "string", minLength: 2, maxLength: 2, example: "NG" } }],
          responses: {
            "200": { description: "Location options", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/payment-method/cards`]: {
        get: {
          tags: ["My Plan"], summary: "List organization-owned payment cards", security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Safe card metadata" }, "401": { description: "Unauthorized" }, "403": { description: "Forbidden" } }
        },
        post: {
          tags: ["My Plan"],
          summary: "Add a new payment card",
          description: "Validates raw card details, tokenizes them, and stores only safe card metadata.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanAddCardBody" } } }
          },
          responses: {
            "201": {
              description:
                "Card saved. Returns safe card metadata and the current payment method payload, including billingEmail fallback when no billing address email is saved.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } }
            },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/payment-method/cards/{cardId}`]: {
        patch: {
          tags: ["My Plan"], summary: "Edit an owned payment card or make it default", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "cardId", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { cardHolderName: { type: "string" }, expMonth: { type: "integer", minimum: 1, maximum: 12 }, expYear: { type: "integer" }, makeDefault: { type: "boolean" } } } } } },
          responses: { "200": { description: "Card updated" }, "404": { description: "Owned card not found", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanErrorResponse" } } } } }
        },
        delete: {
          tags: ["My Plan"], summary: "Remove an owned payment card", security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "cardId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Card removed" }, "400": { description: "Only payment method cannot be removed" }, "404": { description: "Owned card not found" } }
        }
      },
      [`${adminBase}/my-plan/payment-method/cards/cancel`]: {
        post: {
          tags: ["My Plan"],
          summary: "Cancel add-card flow",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanCancelCardCreationBody" } } }
          },
          responses: {
            "200": {
              description:
                "Card creation cancelled. Returns the current payment method payload, including billingEmail fallback when no billing address email is saved.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/payment-method/billing-address`]: {
        patch: {
          tags: ["My Plan"],
          summary: "Save billing address",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanBillingAddressBody" } } }
          },
          responses: {
            "200": { description: "Billing address saved", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/billing-history`]: {
        get: {
          tags: ["My Plan"],
          summary: "Get billing history",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "year", schema: { type: "integer", example: 2026 } },
            { in: "query", name: "status", schema: { type: "string", enum: ["paid", "pending", "failed", "cancelled"] } }
          ],
          responses: {
            "200": { description: "Billing history", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/MyPlanGenericResponse" }, { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/MyPlanBillingHistoryItem" } }, pagination: { $ref: "#/components/schemas/MyPlanPagination" } } }] } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/billing-analytics`]: {
        get: {
          tags: ["My Plan"],
          summary: "Get billing analytics",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "query", name: "year", schema: { type: "integer", example: 2026 } }],
          responses: {
            "200": { description: "Billing analytics", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanBillingAnalyticsResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/my-plan/invoices/{invoiceId}/download`]: {
        get: {
          tags: ["My Plan"], summary: "Download an owned invoice as PDF",
          description: "Returns 404 when the invoice does not exist or belongs to another organization.",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "invoiceId", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Invoice PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } },
            "401": { description: "Unauthorized" }, "403": { description: "Forbidden" }, "404": { description: "Invoice not found" }
          }
        }
      },
      [`${adminBase}/my-plan/renewal-notifications/process`]: {
        post: {
          tags: ["My Plan"], summary: "Process due 15-day renewal reminders",
          description: "Idempotently persists reusable EMAIL, IN_APP or PUSH notification delivery records. Also runs daily through the notification worker.",
          security: [{ bearerAuth: [] }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: {
            asOf: { type: "string", format: "date-time" }, channels: { type: "array", items: { type: "string", enum: ["EMAIL", "IN_APP", "PUSH"] } }
          } } } } },
          responses: { "200": { description: "Tenant-scoped delivery result with created, sent and failed counts", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanRenewalProcessingResponse" } } } }, "401": { description: "Unauthorized" }, "403": { description: "Forbidden" } }
        }
      },
      [`${subscriptionsBase}/current`]: {
        get: {
          tags: ["Subscriptions"],
          summary: "Get current subscription details",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Current module-based subscription; no seat allocation or seat billing fields are returned", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, data: { $ref: "#/components/schemas/CurrentSubscription" } } } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/organization`]: {
        get: {
          tags: ["Admin"],
          summary: "Get organization company profile",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Organization profile" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        patch: {
          tags: ["Admin"],
          summary: "Update organization company profile",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrganizationUpdateBody" }
              }
            }
          },
          responses: {
            "200": { description: "Profile updated" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/policy`]: {
        get: {
          tags: ["Admin"],
          summary: "Get tenant security policy",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Security policy",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SecurityPolicyResponse" }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/password-policy`]: {
        put: {
          tags: ["Admin"],
          summary: "Update password policy",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SecurityPasswordPolicyBody" }
              }
            }
          },
          responses: {
            "200": { description: "Password policy updated" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/two-factor`]: {
        put: {
          tags: ["Admin"],
          summary: "Update two-factor policy",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SecurityTwoFactorBody" }
              }
            }
          },
          responses: {
            "200": { description: "Two-factor policy updated" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/sessions`]: {
        get: {
          tags: ["Admin"],
          summary: "List active sessions",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "userId", schema: { type: "string" } },
            { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "REVOKED", "ALL"] } }
          ],
          responses: {
            "200": { description: "Sessions payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/sessions/{id}/revoke`]: {
        post: {
          tags: ["Admin"],
          summary: "Revoke a session",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SecurityRevokeSessionBody" }
              }
            }
          },
          responses: {
            "200": { description: "Session revoked" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" }
          }
        }
      },
      [`${adminBase}/security/sessions/revoke-bulk`]: {
        post: {
          tags: ["Admin"],
          summary: "Revoke multiple sessions",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SecurityRevokeSessionsBulkBody" }
              }
            }
          },
          responses: {
            "200": { description: "Sessions revoked" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/ip-allowlist`]: {
        get: {
          tags: ["Admin"],
          summary: "Get IP allowlist",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "IP allowlist payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        post: {
          tags: ["Admin"],
          summary: "Add IP allowlist entry",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SecurityIpAllowlistEntryBody" }
              }
            }
          },
          responses: {
            "201": { description: "Entry created" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/ip-allowlist/toggle`]: {
        put: {
          tags: ["Admin"],
          summary: "Toggle IP allowlist enforcement",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SecurityIpAllowlistToggleBody" }
              }
            }
          },
          responses: {
            "200": { description: "Toggle updated" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/security/ip-allowlist/{id}`]: {
        delete: {
          tags: ["Admin"],
          summary: "Remove IP allowlist entry",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Entry removed" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" }
          }
        }
      },
      [`${adminBase}/security/login-activity`]: {
        get: {
          tags: ["Admin"],
          summary: "List login activity",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "status", schema: { type: "string", enum: ["SUCCESS", "FAILED", "BLOCKED"] } },
            { in: "query", name: "userId", schema: { type: "string" } },
            { in: "query", name: "from", schema: { type: "string", format: "date-time" } },
            { in: "query", name: "to", schema: { type: "string", format: "date-time" } }
          ],
          responses: {
            "200": { description: "Login activity payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/audit-log`]: {
        get: {
          tags: ["Admin"],
          summary: "List tenant audit logs",
          description:
            "Returns a read-only, newest-first, paginated audit trail. Supports search by user name, user email, or details; filters by user, action, module, and day/month/year date period. New audit records are tamper-evident through a per-tenant SHA-256 hash chain.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1, minimum: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, minimum: 1, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string", example: "billing" } },
            { in: "query", name: "userId", description: "Use ALL or omit for all users.", schema: { type: "string" } },
            { in: "query", name: "action", description: "Use ALL or omit for all actions.", schema: { type: "string", example: "BILLING_PAYMENT_CARD_ADDED" } },
            { in: "query", name: "module", description: "Use ALL or omit for all modules.", schema: { type: "string", example: "PAYMENT_CARD" } },
            { in: "query", name: "dateFilter", schema: { type: "string", enum: ["day", "month", "year"] } },
            {
              in: "query",
              name: "date",
              description: "Use YYYY-MM-DD for day, YYYY-MM for month, and YYYY for year.",
              schema: { type: "string", example: "2026-07" }
            }
          ],
          responses: {
            "200": {
              description: "Audit log payload",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AuditLogResponse" } } }
            },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/organization/work-schedule`]: {
        get: {
          tags: ["Admin"],
          summary: "Get default work schedule",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Work schedule with summary" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        put: {
          tags: ["Admin"],
          summary: "Save default work schedule",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WorkScheduleBody" }
              }
            }
          },
          responses: {
            "200": { description: "Work schedule saved" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/departments/table`]: {
        get: {
          tags: ["Admin"],
          summary: "List formatted departments table rows",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Departments table" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/departments`]: {
        get: {
          tags: ["Admin"],
          summary: "List departments",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Departments list" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        post: {
          tags: ["Admin"],
          summary: "Create department",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DepartmentBody" }
              }
            }
          },
          responses: {
            "201": { description: "Department created" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/departments/{id}`]: {
        get: {
          tags: ["Admin"],
          summary: "Get department by id",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Department" },
            "404": { description: "Not found" }
          }
        },
        patch: {
          tags: ["Admin"],
          summary: "Update department",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DepartmentBody" }
              }
            }
          },
          responses: {
            "200": { description: "Department updated" },
            "400": { description: "Validation error" },
            "404": { description: "Not found" }
          }
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete department",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "Deleted" },
            "404": { description: "Not found" }
          }
        }
      },
      [`${adminBase}/branches/table`]: {
        get: {
          tags: ["Admin"],
          summary: "List formatted branches table rows",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Branches table" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/branches`]: {
        get: {
          tags: ["Admin"],
          summary: "List branches",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Branches list" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        post: {
          tags: ["Admin"],
          summary: "Create branch",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BranchBody" }
              }
            }
          },
          responses: {
            "201": { description: "Branch created" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/branches/{id}`]: {
        get: {
          tags: ["Admin"],
          summary: "Get branch by id",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Branch" },
            "404": { description: "Not found" }
          }
        },
        patch: {
          tags: ["Admin"],
          summary: "Update branch",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BranchBody" }
              }
            }
          },
          responses: {
            "200": { description: "Branch updated" },
            "400": { description: "Validation error" },
            "404": { description: "Not found" }
          }
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete branch",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "Deleted" },
            "404": { description: "Not found" }
          }
        }
      },
      [`${adminBase}/roles`]: {
        get: {
          tags: ["Admin"],
          summary: "List roles",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Roles list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/RoleResponse" }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        post: {
          tags: ["Admin"],
          summary: "Create role",
          description: "Creates a non-system role. Owner-level unrestricted full access is not allowed for non-system roles.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RoleCreateBody" }
              }
            }
          },
          responses: {
            "201": {
              description: "Role created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RoleResponse" }
                }
              }
            },
            "400": {
              description: "Validation or business rule error",
              content: {
                "application/json": {
                  examples: {
                    unrestrictedAccessNotAllowed: {
                      summary: "Owner-only unrestricted full access rule",
                      value: {
                        message: "Only the Owner system role can have unrestricted access across all modules and actions"
                      }
                    }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/roles/templates`]: {
        get: {
          tags: ["Admin"],
          summary: "List role templates",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Role templates",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/RoleTemplate" }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/roles/permission-catalog`]: {
        get: {
          tags: ["Admin"],
          summary: "Get role permission catalog grouped by module, resource, and action",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Permission catalog",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/RolePermissionCatalogModule" }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/roles/{id}`]: {
        get: {
          tags: ["Admin"],
          summary: "Get role by id",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Role",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RoleResponse" }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" }
          }
        },
        patch: {
          tags: ["Admin"],
          summary: "Update role",
          description: "Updates a mutable role. Assigning unrestricted full-access permissions is reserved for the Owner system role.",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RoleUpdateBody" }
              }
            }
          },
          responses: {
            "200": {
              description: "Role updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RoleResponse" }
                }
              }
            },
            "400": {
              description: "Validation or business rule error",
              content: {
                "application/json": {
                  examples: {
                    unrestrictedAccessNotAllowed: {
                      summary: "Owner-only unrestricted full access rule",
                      value: {
                        message: "Only the Owner system role can have unrestricted access across all modules and actions"
                      }
                    }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" }
          }
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete role",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "Deleted" },
            "400": { description: "Role cannot be deleted in current state" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" }
          }
        }
      },
      [`${adminBase}/roles/{id}/clone`]: {
        post: {
          tags: ["Admin"],
          summary: "Clone role",
          description:
            "Creates a new non-system role by copying source role permissions. Cloning unrestricted full-access permissions is reserved for the Owner system role.",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RoleCloneBody" }
              }
            }
          },
          responses: {
            "201": {
              description: "Role cloned",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RoleResponse" }
                }
              }
            },
            "400": {
              description: "Validation or business rule error",
              content: {
                "application/json": {
                  examples: {
                    unrestrictedAccessNotAllowed: {
                      summary: "Owner-only unrestricted full access rule",
                      value: {
                        message: "Only the Owner system role can have unrestricted access across all modules and actions"
                      }
                    }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" }
          }
        }
      },
      [`${adminBase}/users/analytics`]: {
        get: {
          tags: ["Admin"],
          summary: "Get user management analytics",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "query", name: "module", schema: { type: "string", enum: ["HRIS", "ACCOUNTING", "PAYROLL"] } }],
          responses: {
            "200": { description: "Analytics payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/users`]: {
        get: {
          tags: ["Admin"],
          summary: "List users for management table",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } },
            { in: "query", name: "role", schema: { type: "string" } },
            { in: "query", name: "status", schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
            { in: "query", name: "module", schema: { type: "string", enum: ["HRIS", "ACCOUNTING", "PAYROLL"] } }
          ],
          responses: {
            "200": { description: "Users table payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/users/{id}`]: {
        patch: {
          tags: ["Admin"],
          summary: "Edit managed user role/status",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserAccessUpdateBody" }
              }
            }
          },
          responses: {
            "200": { description: "User updated" },
            "400": { description: "Validation error" },
            "404": { description: "User not found" }
          }
        },
        delete: {
          tags: ["Admin"],
          summary: "Remove managed user",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "User removed" },
            "404": { description: "User not found" }
          }
        }
      },
      [`${adminBase}/users/invitations`]: {
        get: {
          tags: ["Admin"],
          summary: "List pending invitations",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } },
            { in: "query", name: "status", schema: { type: "string", enum: ["PENDING", "EXPIRED"] } }
          ],
          responses: {
            "200": { description: "Invitations payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        post: {
          tags: ["Admin"],
          summary: "Invite user to workspace",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InviteUserBody" }
              }
            }
          },
          responses: {
            "201": { description: "Invitation created" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/users/invitations/{id}/resend`]: {
        post: {
          tags: ["Admin"],
          summary: "Resend invitation",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Invitation resent",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ResendInvitationResponse" }
                }
              }
            },
            "404": { description: "Invitation not found" }
          }
        }
      },
      [`${adminBase}/users/groups`]: {
        get: {
          tags: ["Admin"],
          summary: "List user groups",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", schema: { type: "integer", default: 1 } },
            { in: "query", name: "limit", schema: { type: "integer", default: 25, maximum: 100 } },
            { in: "query", name: "search", schema: { type: "string" } },
            { in: "query", name: "type", schema: { type: "string", enum: ["DEPARTMENT", "FUNCTION", "department", "function"] } }
          ],
          responses: {
            "200": { description: "Groups payload" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        },
        post: {
          tags: ["Admin"],
          summary: "Create user group",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserGroupCreateBody" }
              }
            }
          },
          responses: {
            "201": { description: "Group created" },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${adminBase}/users/groups/{id}`]: {
        patch: {
          tags: ["Admin"],
          summary: "Update user group",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UserGroupUpdateBody" }
              }
            }
          },
          responses: {
            "200": {
              description: "Group updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UserGroupUpdateResponse" }
                }
              }
            },
            "400": { description: "Validation error" },
            "404": { description: "Group not found" }
          }
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete user group",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Group deleted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UserGroupDeleteResponse" }
                }
              }
            },
            "404": { description: "Group not found" }
          }
        }
      }
    }
  },
  apis: [
    path.resolve(process.cwd(), "src/**/*.ts"),
    path.resolve(process.cwd(), "dist/**/*.js")
  ]
};

export const openApiSpec = swaggerJSDoc(options);

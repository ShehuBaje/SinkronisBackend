import path from "node:path";
import swaggerJSDoc from "swagger-jsdoc";
import { env } from "./env";

const authBase = `${env.API_PREFIX}/auth`;
const adminBase = `${env.API_PREFIX}/admin`;
const platformAdminBase = `${env.API_PREFIX}/platform-admin`;
const mediaBase = `${env.API_PREFIX}/media`;
const subscriptionsBase = `${env.API_PREFIX}/subscriptions`;

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
      { name: "Subscriptions" },
      { name: "Media" }
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
            summary: { type: "object", properties: { totalUsers: { type: "integer" }, activeUsers: { type: "integer" }, seatAllocation: { type: "integer", nullable: true }, seatsUsed: { type: "integer" }, activeModules: { type: "array", items: { type: "object" } }, monthlyRecurringRevenue: { type: "number" }, currency: { type: "string", enum: ["NGN"] }, lastLoginDate: { type: "string", format: "date-time", nullable: true }, daysSinceLastLogin: { type: "integer", nullable: true } } }
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
            industry: { type: "string", maxLength: 100, example: "Technology" },
            seatAllocation: { type: "integer", minimum: 1, maximum: 1000000, example: 100 }
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
          type: "object", properties: {
            ticketId: { type: "string" }, ticketNumber: { type: "string" }, subject: { type: "string" },
            priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"] },
            assignedTo: { type: "object", nullable: true }, updatedAt: { type: "string", format: "date-time" }
          }
        },
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
        SubscriptionSeatsUpdateBody: {
          type: "object",
          required: ["totalSeats"],
          properties: {
            totalSeats: { type: "integer", minimum: 1, example: 15 }
          }
        }
      }
    },
    paths: {
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
          description: "Validates modular plans, updates entitlements and optional seat allocation, preserves billing history, notifies the tenant and records an audit event.",
          security: [{ bearerAuth: [] }], parameters: [{ in: "path", name: "tenantId", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["plan"], additionalProperties: false, properties: { plan: { type: "string", enum: ["HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE"] }, seatAllocation: { type: "integer", minimum: 1 }, effectiveDate: { type: "string", format: "date-time" }, reason: { type: "string", minLength: 3, maxLength: 1000 } } }, example: { plan: "ALL_IN_ONE", seatAllocation: 250, reason: "Enterprise account adjustment" } } } },
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
            "200": { description: "Current subscription", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" }
          }
        }
      },
      [`${subscriptionsBase}/current/seats`]: {
        patch: {
          tags: ["Subscriptions"],
          summary: "Update subscription seat allocation",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/SubscriptionSeatsUpdateBody" } } }
          },
          responses: {
            "200": { description: "Seats updated", content: { "application/json": { schema: { $ref: "#/components/schemas/MyPlanGenericResponse" } } } },
            "400": { description: "Validation or seat allocation error" },
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

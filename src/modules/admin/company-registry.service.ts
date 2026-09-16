export type CompanyVerificationResult = {
  verified: boolean;
  registrationNumber: string;
  registeredName?: string;
  registryStatus?: string;
  entityType?: string;
  provider: string;
  reference?: string;
};

export interface CompanyRegistryProvider {
  verifyRegistration(registrationNumber: string): Promise<CompanyVerificationResult>;
}

export type CompanyRegistryProviderReadiness = {
  provider: CompanyRegistryProvider | null;
  selected: "NONE" | "CAC";
  reason: "NOT_SELECTED" | "MISSING_CONFIGURATION" | "READY";
  missing: string[];
};

export type CacVasProviderConfiguration = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

type CacResponse = {
  statusCode?: unknown;
  status?: unknown;
  message?: unknown;
  error?: unknown;
  success?: unknown;
  data?: unknown;
};

type CacCompanyData = {
  rc_number: string;
  entity_name: string;
  entity_type?: string;
};

export class CompanyRegistryUnavailableError extends Error {
  constructor(
    public readonly reasonCode: string,
    public readonly retryable: boolean,
    public readonly externalStatusCode?: number,
  ) {
    super("Company registry provider is unavailable");
    this.name = "CompanyRegistryUnavailableError";
  }
}

export const normalizeRegistrationNumber = (value: string) => value.trim().toUpperCase().replace(/[\s-]+/g, "");

export const normalizeCompanyName = (value: string) => value
  .toUpperCase()
  .replace(/&/g, " AND ")
  .replace(/\bLTD\b/g, "LIMITED")
  .replace(/\bPLC\b/g, "PUBLIC LIMITED COMPANY")
  .replace(/[^A-Z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export const companyNamesMatch = (submitted: string, registered: string) => normalizeCompanyName(submitted) === normalizeCompanyName(registered);

const providerRcNumber = (value: string) => {
  const normalized = normalizeRegistrationNumber(value);
  return normalized.startsWith("RC") ? normalized.slice(2) : normalized;
};

const isCompanyData = (value: unknown): value is CacCompanyData => {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.rc_number === "string" && data.rc_number.trim().length > 0
    && typeof data.entity_name === "string" && data.entity_name.trim().length > 0
    && (data.entity_type === undefined || typeof data.entity_type === "string");
};

const responseReason = (status: number) => {
  if (status === 401) return "CAC_AUTHENTICATION_FAILED";
  if (status === 403) return "CAC_AUTHORIZATION_FAILED";
  if (status === 408) return "CAC_TIMEOUT";
  if (status === 429) return "CAC_RATE_LIMITED";
  if (status >= 500) return "CAC_PROVIDER_UNAVAILABLE";
  return "CAC_REQUEST_REJECTED";
};

export const createCacVasProvider = (
  configuration: CacVasProviderConfiguration,
  fetchImpl: typeof fetch = fetch,
): CompanyRegistryProvider => ({
  async verifyRegistration(registrationNumber) {
    let response: Response;
    try {
      response = await fetchImpl(`${configuration.baseUrl.replace(/\/$/, "")}/api/vas/validation/company/rc`, {
        method: "POST",
        headers: { X_API_KEY: configuration.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ rc_number: providerRcNumber(registrationNumber) }),
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });
    } catch {
      throw new CompanyRegistryUnavailableError("CAC_NETWORK_OR_TIMEOUT", true);
    }

    const payload = await response.json().catch(() => null) as CacResponse | null;
    if (response.status === 404) {
      return { verified: false, registrationNumber, provider: "CAC" };
    }
    if (response.status === 400) {
      return { verified: false, registrationNumber, provider: "CAC" };
    }
    if (!response.ok) {
      throw new CompanyRegistryUnavailableError(responseReason(response.status), response.status === 408 || response.status === 429 || response.status >= 500, response.status);
    }
    if (!payload || payload.statusCode !== 200 || !isCompanyData(payload.data)) {
      throw new CompanyRegistryUnavailableError("CAC_MALFORMED_RESPONSE", true, response.status);
    }

    const returnedRegistration = normalizeRegistrationNumber(payload.data.rc_number);
    if (providerRcNumber(returnedRegistration) !== providerRcNumber(registrationNumber)) {
      throw new CompanyRegistryUnavailableError("CAC_REGISTRATION_NUMBER_MISMATCH", false, response.status);
    }
    return {
      verified: true,
      registrationNumber: normalizeRegistrationNumber(registrationNumber),
      registeredName: payload.data.entity_name.trim(),
      entityType: payload.data.entity_type?.trim(),
      provider: "CAC",
      reference: returnedRegistration,
    };
  },
});

export const getCompanyRegistryProvider = (): CompanyRegistryProviderReadiness => {
  const selected = String(process.env.COMPANY_REGISTRY_PROVIDER ?? "NONE").toUpperCase() === "CAC" ? "CAC" : "NONE";
  if (selected === "NONE") return { provider: null, selected, reason: "NOT_SELECTED", missing: [] };
  const missing = [!process.env.CAC_API_BASE_URL?.trim() && "CAC_API_BASE_URL", !process.env.CAC_API_KEY?.trim() && "CAC_API_KEY"].filter(Boolean) as string[];
  if (missing.length) return { provider: null, selected, reason: "MISSING_CONFIGURATION", missing };
  const timeout = Number(process.env.CAC_API_TIMEOUT_MS ?? 5000);
  return {
    provider: createCacVasProvider({
      baseUrl: process.env.CAC_API_BASE_URL!,
      apiKey: process.env.CAC_API_KEY!,
      timeoutMs: Number.isInteger(timeout) && timeout >= 100 && timeout <= 30000 ? timeout : 5000,
    }),
    selected,
    reason: "READY",
    missing: [],
  };
};

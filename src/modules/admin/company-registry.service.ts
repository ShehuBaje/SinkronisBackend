export type CompanyVerificationResult = {
  verified: boolean;
  registrationNumber: string;
  registeredName?: string;
  registryStatus?: string;
  provider: string;
  reference?: string;
};

export interface CompanyRegistryProvider {
  verifyRegistration(registrationNumber: string): Promise<CompanyVerificationResult>;
}

export type CompanyRegistryProviderReadiness = {
  provider: CompanyRegistryProvider | null;
  selected: "NONE" | "CAC";
  reason: "NOT_SELECTED" | "MISSING_CONFIGURATION" | "CAC_CONTRACT_NOT_CONFIRMED";
  missing: string[];
};

export type CacVasProviderConfiguration = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  // These contract details are intentionally required before an HTTP adapter can be enabled.
  companyByRcPath: string;
  method: "GET" | "POST";
  registrationNumberField: string;
};

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

// Official public documentation confirms X_API_KEY, but the account-facing exact
// RC lookup URL/method/payload contract is not sufficiently published to implement safely.
export const getCompanyRegistryProvider = (): CompanyRegistryProviderReadiness => {
  const selected = String(process.env.COMPANY_REGISTRY_PROVIDER ?? "NONE").toUpperCase() === "CAC" ? "CAC" : "NONE";
  if (selected === "NONE") return { provider: null, selected, reason: "NOT_SELECTED", missing: [] };
  const missing = [!process.env.CAC_API_BASE_URL && "CAC_API_BASE_URL", !process.env.CAC_API_KEY && "CAC_API_KEY"].filter(Boolean) as string[];
  if (missing.length) return { provider: null, selected, reason: "MISSING_CONFIGURATION", missing };
  return { provider: null, selected, reason: "CAC_CONTRACT_NOT_CONFIRMED", missing: ["companyByRcPath", "method", "registrationNumberField", "responseSchema"] };
};

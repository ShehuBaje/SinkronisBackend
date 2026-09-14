import { isIP } from "node:net";

export type RequestMetadata = { headers?: Record<string, unknown>; ip?: string | null };
export type ResolvedLocation = { city: string | null; state: string | null; country: string | null; timezone: string | null; provider: string | null };
export interface IpGeolocationProvider { readonly name: string; lookup(ip: string): Promise<Omit<ResolvedLocation, "provider"> | null>; }

const normalizeIp = (value?: string | null) => {
  if (!value) return null;
  let candidate = value.trim().replace(/^"|"$/g, "").replace(/^::ffff:/, "");
  if (/^\[[^\]]+\]:\d+$/.test(candidate)) candidate = candidate.slice(1, candidate.lastIndexOf("]"));
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  return isIP(candidate) ? candidate : null;
};

export const extractClientIp = (meta?: RequestMetadata) => {
  // req.ip is the single source of truth. Express derives it from the socket and,
  // only when trust proxy is configured, the trusted X-Forwarded-For chain.
  const developmentOverride = process.env.NODE_ENV !== "production" ? normalizeIp(process.env.DEV_CLIENT_IP_OVERRIDE) : null;
  return developmentOverride ?? normalizeIp(meta?.ip);
};

export const isPublicIp = (ip: string | null) => {
  if (!ip || !isIP(ip)) return false;
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168 || (b === 0 && c === 2)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113) || a >= 224);
  }
  const normalized = ip.toLowerCase();
  return !(normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8"));
};

const countryName = (code: string | null) => {
  if (!code) return null;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code; } catch { return code; }
};

export class IpInfoGeolocationProvider implements IpGeolocationProvider {
  readonly name = "IPINFO";
  constructor(private readonly token: string, private readonly timeoutMs = 1500, private readonly fetcher: typeof fetch = fetch) {}
  async lookup(ip: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`https://api.ipinfo.io/lookup/${encodeURIComponent(ip)}/geo?token=${encodeURIComponent(this.token)}`, { signal: controller.signal });
      if (!response.ok) return null;
      const geo = await response.json() as Record<string, unknown>;
      return { city: typeof geo.city === "string" ? geo.city : null, state: typeof geo.region === "string" ? geo.region : null,
        country: typeof geo.country === "string" ? geo.country : countryName(typeof geo.country_code === "string" ? geo.country_code : null),
        timezone: typeof geo.timezone === "string" ? geo.timezone : null };
    } catch { return null; } finally { clearTimeout(timeout); }
  }
}

export const configuredIpGeolocationProvider = (): IpGeolocationProvider | null =>
  String(process.env.IP_GEOLOCATION_PROVIDER ?? "NONE").toUpperCase() === "IPINFO" && process.env.IPINFO_TOKEN
    ? new IpInfoGeolocationProvider(process.env.IPINFO_TOKEN, Number(process.env.IP_GEOLOCATION_TIMEOUT_MS ?? 1500)) : null;

export const resolveRequestLocation = async (meta?: RequestMetadata, provider: IpGeolocationProvider | null = configuredIpGeolocationProvider()): Promise<ResolvedLocation> => {
  const ip = extractClientIp(meta);
  if (ip && !isPublicIp(ip)) return { city: null, state: null, country: "Local / Private Network", timezone: null, provider: "LOCAL" };
  if (!ip || !provider) return { city: null, state: null, country: null, timezone: null, provider: null };
  try {
    const location = await provider.lookup(ip);
    return location ? { ...location, provider: provider.name } : { city: null, state: null, country: null, timezone: null, provider: null };
  } catch { return { city: null, state: null, country: null, timezone: null, provider: null }; }
};

export const formatLocation = (location: { city?: string | null; state?: string | null; country?: string | null }) => {
  const parts = [location.city, location.country].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : location.state || location.country || "Unknown";
};

import crypto from "node:crypto";
import { conflict } from "./http-error";

const INCIDENT_WALLET_FINGERPRINT = "fcefcb648dfd";
export const INCIDENT_WALLET_MUTATIONS_PAUSED = true;

const fingerprint = (organizationId: string, walletAccountId: string) =>
  crypto.createHash("sha256").update(`${organizationId}:${walletAccountId}`).digest("hex").slice(0, 12);

export const assertIncidentWalletFingerprintMutationAllowed = (walletFingerprint: string) => {
  if (INCIDENT_WALLET_MUTATIONS_PAUSED && walletFingerprint === INCIDENT_WALLET_FINGERPRINT) {
    throw conflict("This wallet is temporarily unavailable for financial maintenance", { errorCode: "WALLET_FINANCIAL_MAINTENANCE" });
  }
};

export const assertIncidentWalletMutationAllowed = (organizationId: string, walletAccountId: string) =>
  assertIncidentWalletFingerprintMutationAllowed(fingerprint(organizationId, walletAccountId));

import { env } from "../config/env";
import { serviceUnavailable } from "./http-error";

export interface SettlementProvider {
  resolveAccount(input: { accountNumber: string; bankCode: string }): Promise<{ accountName: string; accountNumber: string; bankId?: number }>;
  createRecipient(input: { accountNumber: string; bankCode: string; accountName: string; currency: string }): Promise<{ recipientReference: string; providerRecipientId?: string }>;
  initiateTransfer(input: { recipientReference: string; amountMinor: number; currency: string; reference: string; reason: string }): Promise<ProviderTransferResult>;
  verifyTransfer(reference: string): Promise<ProviderTransferResult>;
  getBalance(): Promise<Array<{ currency: string; balanceMinor: number }>>;
}

export type ProviderTransferState = "NON_CONCLUSIVE" | "SUCCESS" | "FAILURE" | "REVERSAL";
export type ProviderTransferResult = { reference: string; transferCode?: string; recipientReference?: string; providerStatus: string; state: ProviderTransferState; amountMinor: number; currency: string };

export const assertProviderTransfersEnabled = () => {
  if (!env.PAYSTACK_TRANSFERS_ENABLED) throw serviceUnavailable("Provider settlement is not enabled", { available: false, reasonCode: "PROVIDER_SETTLEMENT_DISABLED", retryable: false, availableActions: ["RECORD_MANUAL_SETTLEMENT", "CONTACT_PLATFORM_SUPPORT"], nextAction: "RECORD_MANUAL_SETTLEMENT" });
};

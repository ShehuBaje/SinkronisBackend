import { PaystackProviderError, paystackRequest } from "./paystack";
import type { ProviderTransferResult, SettlementProvider } from "./settlement-provider";

type TransferData = { reference?: unknown; transfer_code?: unknown; status?: unknown; amount?: unknown; currency?: unknown; recipient?: unknown };
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
const recipientCode = (value: unknown) => typeof value === "string" ? value : value && typeof value === "object" ? text((value as Record<string, unknown>).recipient_code) : undefined;

export const mapPaystackTransferStatus = (status: string) => {
  const normalized = status.toLowerCase();
  if (["pending", "otp", "received"].includes(normalized)) return "NON_CONCLUSIVE" as const;
  if (normalized === "success") return "SUCCESS" as const;
  if (normalized === "reversed") return "REVERSAL" as const;
  if (["failed", "abandoned", "blocked", "rejected"].includes(normalized)) return "FAILURE" as const;
  throw new PaystackProviderError("Paystack returned an unsupported transfer status", undefined, true);
};

const transferResult = (data: TransferData): ProviderTransferResult => {
  const reference = text(data.reference);
  const providerStatus = text(data.status);
  const amountMinor = integer(data.amount);
  const currency = text(data.currency)?.toUpperCase();
  if (!reference || !providerStatus || amountMinor === undefined || !currency) throw new PaystackProviderError("Paystack returned malformed transfer data", undefined, true);
  return { reference, transferCode: text(data.transfer_code), recipientReference: recipientCode(data.recipient), providerStatus: providerStatus.toLowerCase(), state: mapPaystackTransferStatus(providerStatus), amountMinor, currency };
};

export class PaystackTransferProvider implements SettlementProvider {
  async resolveAccount(input: { accountNumber: string; bankCode: string }) {
    const data = await paystackRequest<Record<string, unknown>>(`/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`);
    const accountName = text(data.account_name);
    const accountNumber = text(data.account_number);
    if (!accountName || !accountNumber) throw new PaystackProviderError("Paystack returned malformed account resolution data");
    return { accountName, accountNumber, ...(integer(data.bank_id) !== undefined ? { bankId: integer(data.bank_id) } : {}) };
  }

  async createRecipient(input: { accountNumber: string; bankCode: string; accountName: string; currency: string }) {
    const data = await paystackRequest<Record<string, unknown>>("/transferrecipient", { method: "POST", body: JSON.stringify({ type: "nuban", name: input.accountName, account_number: input.accountNumber, bank_code: input.bankCode, currency: input.currency }) });
    const recipientReference = text(data.recipient_code);
    if (!recipientReference) throw new PaystackProviderError("Paystack returned malformed recipient data");
    const id = data.id;
    return { recipientReference, ...(typeof id === "number" || typeof id === "string" ? { providerRecipientId: String(id) } : {}) };
  }

  async initiateTransfer(input: { recipientReference: string; amountMinor: number; currency: string; reference: string; reason: string }) {
    const result = transferResult(await paystackRequest<TransferData>("/transfer", { method: "POST", body: JSON.stringify({ source: "balance", amount: input.amountMinor, recipient: input.recipientReference, reference: input.reference, reason: input.reason, currency: input.currency }) }));
    // Paystack's initiation response may say `success` while its message says the
    // transfer was queued. Initiation acceptance is never settlement evidence.
    return result.state === "SUCCESS" ? { ...result, state: "NON_CONCLUSIVE" as const } : result;
  }

  async verifyTransfer(reference: string) {
    return transferResult(await paystackRequest<TransferData>(`/transfer/verify/${encodeURIComponent(reference)}`));
  }

  async getBalance() {
    const rows = await paystackRequest<Array<Record<string, unknown>>>("/balance");
    return rows.map((row) => ({ currency: text(row.currency)?.toUpperCase() ?? "", balanceMinor: integer(row.balance) ?? 0 })).filter((row) => row.currency);
  }
}

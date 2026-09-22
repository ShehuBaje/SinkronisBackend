import { Prisma, type WalletAccount } from "@prisma/client";
import { conflict, notFound } from "./http-error";

type Db = Prisma.TransactionClient;

export const normalizeFinancialCurrency = (currency: string) => currency.trim().toUpperCase();

export const assertFinancialCurrency = (expected: string, actual: string) => {
  const normalizedExpected = normalizeFinancialCurrency(expected);
  const normalizedActual = normalizeFinancialCurrency(actual);
  if (!normalizedExpected || normalizedExpected !== normalizedActual) {
    throw conflict("Financial operation currency does not match wallet currency", { errorCode: "CURRENCY_MISMATCH" });
  }
  return normalizedExpected;
};

export const spendableBalance = (wallet: Pick<WalletAccount, "balance" | "reservedBalance">) => wallet.balance.sub(wallet.reservedBalance);

const positiveAmount = (amount: Prisma.Decimal) => {
  if (!amount.isPositive()) throw conflict("Financial operation amount must be positive");
};

export const financialWallet = async (tx: Db, organizationId: string, walletAccountId: string, currency: string) => {
  const wallet = await tx.walletAccount.findFirst({ where: { id: walletAccountId, organizationId } });
  if (!wallet) throw notFound("Wallet not found");
  assertFinancialCurrency(currency, wallet.currency);
  return wallet;
};

export const reserveWalletBalance = async (tx: Db, input: { organizationId: string; walletAccountId: string; amount: Prisma.Decimal; currency: string }) => {
  positiveAmount(input.amount);
  const currency = normalizeFinancialCurrency(input.currency);
  await financialWallet(tx, input.organizationId, input.walletAccountId, currency);
  const changed = await tx.$executeRaw`UPDATE WalletAccount SET reservedBalance = reservedBalance + ${input.amount} WHERE id = ${input.walletAccountId} AND organizationId = ${input.organizationId} AND UPPER(currency) = ${currency} AND balance - reservedBalance >= ${input.amount}`;
  if (changed !== 1) throw conflict("Insufficient spendable wallet balance", { errorCode: "INSUFFICIENT_SPENDABLE_BALANCE" });
};

export const debitUnreservedWallet = async (tx: Db, input: { organizationId: string; walletAccountId: string; amount: Prisma.Decimal; currency: string }) => {
  positiveAmount(input.amount);
  const currency = normalizeFinancialCurrency(input.currency);
  await financialWallet(tx, input.organizationId, input.walletAccountId, currency);
  const changed = await tx.$executeRaw`UPDATE WalletAccount SET balance = balance - ${input.amount} WHERE id = ${input.walletAccountId} AND organizationId = ${input.organizationId} AND UPPER(currency) = ${currency} AND balance - reservedBalance >= ${input.amount}`;
  if (changed !== 1) throw conflict("Insufficient spendable wallet balance", { errorCode: "INSUFFICIENT_SPENDABLE_BALANCE" });
  const after = await financialWallet(tx, input.organizationId, input.walletAccountId, currency);
  return { wallet: after, balanceBefore: after.balance.add(input.amount), balanceAfter: after.balance };
};

export const consumeWalletReservation = async (tx: Db, input: { organizationId: string; walletAccountId: string; amount: Prisma.Decimal; currency: string }) => {
  positiveAmount(input.amount);
  const currency = normalizeFinancialCurrency(input.currency);
  await financialWallet(tx, input.organizationId, input.walletAccountId, currency);
  const changed = await tx.$executeRaw`UPDATE WalletAccount SET balance = balance - ${input.amount}, reservedBalance = reservedBalance - ${input.amount} WHERE id = ${input.walletAccountId} AND organizationId = ${input.organizationId} AND UPPER(currency) = ${currency} AND balance >= ${input.amount} AND reservedBalance >= ${input.amount}`;
  if (changed !== 1) throw conflict("Wallet reservation could not be finalized");
  const after = await financialWallet(tx, input.organizationId, input.walletAccountId, currency);
  return { wallet: after, balanceBefore: after.balance.add(input.amount), balanceAfter: after.balance };
};

export const releaseWalletReservation = async (tx: Db, input: { organizationId: string; walletAccountId: string; amount: Prisma.Decimal; currency: string }) => {
  positiveAmount(input.amount);
  const currency = normalizeFinancialCurrency(input.currency);
  await financialWallet(tx, input.organizationId, input.walletAccountId, currency);
  const changed = await tx.$executeRaw`UPDATE WalletAccount SET reservedBalance = reservedBalance - ${input.amount} WHERE id = ${input.walletAccountId} AND organizationId = ${input.organizationId} AND UPPER(currency) = ${currency} AND reservedBalance >= ${input.amount}`;
  if (changed !== 1) throw conflict("Wallet reservation could not be released");
};

import { prisma } from '../../lib/prisma';
import type { Transaction } from '@prisma/client';
import type {
  CreateTransactionInput,
  FinanceSummaryByCurrency,
  FinanceSummary,
  TransactionResponse,
  UpdateTransactionInput,
} from '@tcg/api-types';

function serializeTransaction(transaction: Transaction): TransactionResponse {
  if (
    transaction.type !== 'purchase' &&
    transaction.type !== 'sale' &&
    transaction.type !== 'trade'
  ) {
    throw new Error(`Unsupported transaction type: ${transaction.type}`);
  }
  return {
    id: transaction.id,
    type: transaction.type,
    collectionEntryId: transaction.collectionEntryId ?? undefined,
    cardId: transaction.cardId ?? undefined,
    externalId: transaction.externalId ?? undefined,
    cardName: transaction.cardName ?? undefined,
    tcg: transaction.tcg ?? undefined,
    quantity: transaction.quantity,
    amount: Number(transaction.amount),
    currency: transaction.currency,
    platform: transaction.platform ?? undefined,
    sourceUrl: transaction.sourceUrl ?? undefined,
    notes: transaction.notes ?? undefined,
    date: transaction.date.toISOString(),
  };
}

export async function getUserTransactions(
  userId: string,
  limit = 100,
  collectionEntryId?: string,
) {
  const txns = await prisma.transaction.findMany({
    where: { userId, collectionEntryId },
    orderBy: { date: 'desc' },
    take: limit,
  });
  return txns.map(serializeTransaction);
}

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type: input.type,
      collectionEntryId: input.collectionEntryId,
      cardId: input.cardId,
      externalId: input.externalId,
      tcg: input.tcg,
      cardName: input.cardName,
      quantity: input.quantity ?? 1,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      platform: input.platform,
      sourceUrl: input.sourceUrl,
      notes: input.notes,
      date: input.date ? new Date(input.date) : new Date(),
    },
  });
  return serializeTransaction(transaction);
}

export async function updateTransaction(
  userId: string,
  transactionId: string,
  input: UpdateTransactionInput,
) {
  const existing = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
  });
  if (!existing) {
    const error = new Error('Transaction not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  const transaction = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      collectionEntryId: input.collectionEntryId,
      cardId: input.cardId,
      externalId: input.externalId,
      tcg: input.tcg,
      cardName: input.cardName,
      quantity: input.quantity,
      amount: input.amount,
      currency: input.currency,
      platform: input.platform,
      sourceUrl: input.sourceUrl,
      notes: input.notes,
      date: input.date ? new Date(input.date) : undefined,
    },
  });
  return serializeTransaction(transaction);
}

export async function deleteTransaction(userId: string, transactionId: string) {
  const existing = await prisma.transaction.findFirst({ where: { id: transactionId, userId } });
  if (!existing) {
    const error = new Error('Transaction not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.transaction.delete({ where: { id: transactionId } });
}

export async function getFinanceSummary(userId: string): Promise<FinanceSummary> {
  const txns = await prisma.transaction.findMany({ where: { userId } });
  let totalSpent = 0;
  let totalEarned = 0;

  for (const t of txns) {
    const amount = t.amount ? parseFloat(t.amount.toString()) : 0;
    if (t.type === 'purchase') totalSpent += amount;
    else if (t.type === 'sale') totalEarned += amount;
  }

  return {
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalEarned: Math.round(totalEarned * 100) / 100,
    profitLoss: Math.round((totalEarned - totalSpent) * 100) / 100,
    transactionCount: txns.length,
  };
}

export async function getFinanceSummaryByCurrency(
  userId: string,
): Promise<FinanceSummaryByCurrency> {
  const txns = await prisma.transaction.findMany({ where: { userId } });
  const byCurrency = new Map<string, { totalSpent: number; totalEarned: number }>();
  for (const transaction of txns) {
    const currency = transaction.currency.trim().toUpperCase();
    const totals = byCurrency.get(currency) ?? {
      totalSpent: 0,
      totalEarned: 0,
    };
    const amount = Number(transaction.amount);
    if (transaction.type === 'purchase') totals.totalSpent += amount;
    else if (transaction.type === 'sale') totals.totalEarned += amount;
    byCurrency.set(currency, totals);
  }
  return {
    byCurrency: [...byCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, totals]) => ({
        currency,
        totalSpent: Math.round(totals.totalSpent * 100) / 100,
        totalEarned: Math.round(totals.totalEarned * 100) / 100,
        profitLoss: Math.round((totals.totalEarned - totals.totalSpent) * 100) / 100,
      })),
    transactionCount: txns.length,
  };
}

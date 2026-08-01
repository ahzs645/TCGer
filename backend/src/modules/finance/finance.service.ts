import { prisma } from '../../lib/prisma';
import type { Transaction } from '@prisma/client';
import type {
  CreateTransactionInput,
  FinanceSummary,
  TransactionResponse
} from '@tcg/api-types';

function serializeTransaction(transaction: Transaction): TransactionResponse {
  return {
    id: transaction.id,
    type: transaction.type,
    cardName: transaction.cardName ?? undefined,
    tcg: transaction.tcg ?? undefined,
    quantity: transaction.quantity,
    amount: Number(transaction.amount),
    currency: transaction.currency,
    platform: transaction.platform ?? undefined,
    notes: transaction.notes ?? undefined,
    date: transaction.date.toISOString()
  };
}

export async function getUserTransactions(userId: string, limit = 100) {
  const txns = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: limit
  });
  return txns.map(serializeTransaction);
}

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type: input.type,
      cardId: input.cardId,
      externalId: input.externalId,
      tcg: input.tcg,
      cardName: input.cardName,
      quantity: input.quantity ?? 1,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      platform: input.platform,
      notes: input.notes,
      date: input.date ? new Date(input.date) : new Date()
    }
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
    transactionCount: txns.length
  };
}

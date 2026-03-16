import { prisma } from '../../lib/prisma';
import type { CreateTradeInput } from '@tcg/api-types';
import { sendNotification } from '../notifications/notification.service';

export async function getUserTrades(userId: string) {
  const trades = await prisma.trade.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    include: { cards: true, sender: { select: { id: true, username: true, email: true } }, receiver: { select: { id: true, username: true, email: true } } },
    orderBy: { updatedAt: 'desc' }
  });
  return trades.map(formatTrade);
}

export async function getTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, OR: [{ senderId: userId }, { receiverId: userId }] },
    include: { cards: true, sender: { select: { id: true, username: true, email: true } }, receiver: { select: { id: true, username: true, email: true } } }
  });
  if (!trade) {
    const error = new Error('Trade not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return formatTrade(trade);
}

export async function createTrade(userId: string, input: CreateTradeInput) {
  const trade = await prisma.trade.create({
    data: {
      senderId: userId,
      receiverId: input.receiverId,
      message: input.message,
      cards: {
        create: [
          ...input.senderCards.map(c => ({ side: 'sender', externalId: c.externalId, tcg: c.tcg, name: c.name, quantity: c.quantity ?? 1, imageUrl: c.imageUrl, estimatedValue: c.estimatedValue })),
          ...(input.receiverCards || []).map(c => ({ side: 'receiver', externalId: c.externalId, tcg: c.tcg, name: c.name, quantity: c.quantity ?? 1, imageUrl: c.imageUrl, estimatedValue: c.estimatedValue }))
        ]
      }
    },
    include: { cards: true }
  });

  // Notify receiver
  await sendNotification(input.receiverId, 'trade_request', 'New Trade Request', `You have a new trade request`, { tradeId: trade.id });

  return formatTrade(trade);
}

export async function updateTradeStatus(userId: string, tradeId: string, status: 'accepted' | 'declined' | 'cancelled') {
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, OR: [{ senderId: userId }, { receiverId: userId }] }
  });
  if (!trade) {
    const error = new Error('Trade not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  if (trade.status !== 'pending') {
    const error = new Error(`Trade is already ${trade.status}`) as Error & { status: number };
    error.status = 400;
    throw error;
  }

  const updated = await prisma.trade.update({
    where: { id: tradeId },
    data: { status },
    include: { cards: true }
  });

  // Notify the other party
  const notifyUserId = userId === trade.senderId ? trade.receiverId : trade.senderId;
  await sendNotification(notifyUserId, 'trade_request', `Trade ${status}`, `Your trade has been ${status}`, { tradeId });

  return formatTrade(updated);
}

export async function deleteTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, senderId: userId } });
  if (!trade) {
    const error = new Error('Trade not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.trade.delete({ where: { id: tradeId } });
}

export async function findTradeMatches(userId: string) {
  // Get user's wishlist cards
  const userWishlists = await prisma.wishlistCard.findMany({
    where: { wishlist: { userId } },
    select: { externalId: true, tcg: true, name: true }
  });
  // Get user's collection cards
  const userCollection = await prisma.collection.findMany({
    where: { userId },
    include: { card: { include: { tcgGame: true } } }
  });

  const wantSet = new Set(userWishlists.map(w => `${w.tcg}:${w.externalId}`));
  const haveSet = new Set(userCollection.map(c => `${c.card.tcgGame.code}:${c.card.externalId}`));

  // Find other users with matching cards (simplified — limit to avoid heavy queries)
  const otherWishlistCards = await prisma.wishlistCard.findMany({
    where: { wishlist: { userId: { not: userId } } },
    include: { wishlist: { include: { user: { select: { id: true, username: true } } } } },
    take: 500
  });

  const matchMap = new Map<string, { userId: string; username?: string; theyHave: any[]; youHave: any[] }>();

  for (const wc of otherWishlistCards) {
    const otherUserId = wc.wishlist.userId;
    const key = `${wc.tcg}:${wc.externalId}`;

    // If we have what they want
    if (haveSet.has(key)) {
      if (!matchMap.has(otherUserId)) {
        matchMap.set(otherUserId, { userId: otherUserId, username: wc.wishlist.user.username || undefined, theyHave: [], youHave: [] });
      }
      matchMap.get(otherUserId)!.youHave.push({ externalId: wc.externalId, tcg: wc.tcg, name: wc.name });
    }
  }

  const matches = Array.from(matchMap.values())
    .filter(m => m.youHave.length > 0)
    .map(m => ({ ...m, matchScore: m.theyHave.length + m.youHave.length }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 20);

  return matches;
}

function formatTrade(trade: any) {
  return {
    id: trade.id,
    senderId: trade.senderId,
    receiverId: trade.receiverId,
    status: trade.status,
    message: trade.message,
    cards: (trade.cards || []).map((c: any) => ({
      id: c.id,
      side: c.side,
      externalId: c.externalId,
      tcg: c.tcg,
      name: c.name,
      quantity: c.quantity,
      imageUrl: c.imageUrl,
      estimatedValue: c.estimatedValue ? parseFloat(c.estimatedValue.toString()) : undefined
    })),
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString()
  };
}

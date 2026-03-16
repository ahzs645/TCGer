import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { prisma } from '../../lib/prisma';

export const publicRouter = Router();

// Public collection view (no auth required)
publicRouter.get('/collections/:shareToken', asyncHandler(async (req, res) => {
  const { shareToken } = req.params;

  const binder = await prisma.binder.findUnique({
    where: { shareToken },
    include: {
      collections: {
        include: {
          card: { include: { tcgGame: true } },
          tags: { include: { tag: true } }
        }
      },
      user: { select: { username: true } }
    }
  });

  if (!binder || !binder.isPublic) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Collection not found or is private' });
    return;
  }

  res.json({
    name: binder.name,
    description: binder.description,
    owner: binder.user.username || 'Anonymous',
    cardCount: binder.collections.reduce((s, c) => s + c.quantity, 0),
    cards: binder.collections.map(c => ({
      name: c.card.name,
      tcg: c.card.tcgGame.code,
      setName: c.card.setName,
      rarity: c.card.rarity,
      imageUrl: c.card.imageUrl,
      quantity: c.quantity,
      condition: c.condition
    }))
  });
}));

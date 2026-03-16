import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createDeckSchema, updateDeckSchema, addDeckCardSchema, updateDeckCardSchema, importDeckSchema } from '@tcg/api-types';
import * as decksService from '../../modules/decks/decks.service';
import { validateDeck } from '../../modules/decks/validation';
import { parseImportSource } from '../../modules/decks/import';

export const decksRouter = Router();

decksRouter.use(requireAuth);

// List all user decks
decksRouter.get('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const decks = await decksService.getUserDecks(userId);
  res.json(decks);
}));

// Create deck
decksRouter.post('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createDeckSchema.parse(req.body);
  const deck = await decksService.createDeck(userId, input);
  res.status(201).json(deck);
}));

// Import deck
decksRouter.post('/import', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = importDeckSchema.parse(req.body);
  const { cards, name } = await parseImportSource(input);

  const deck = await decksService.createDeck(userId, {
    name: name || input.name || 'Imported Deck',
    tcg: input.tcg || 'magic',
    format: input.format
  });

  let importedCount = 0;
  const skippedCards: string[] = [];

  for (const card of cards) {
    try {
      await decksService.addCardToDeck(userId, deck.id, {
        externalId: card.name.toLowerCase().replace(/\s+/g, '-'),
        tcg: input.tcg || 'magic',
        name: card.name,
        quantity: card.quantity,
        isSideboard: card.isSideboard,
        setCode: card.setCode
      });
      importedCount++;
    } catch {
      skippedCards.push(card.name);
    }
  }

  res.status(201).json({
    deck: await decksService.getDeck(userId, deck.id),
    importedCount,
    skippedCount: skippedCards.length,
    skippedCards
  });
}));

// Get single deck
decksRouter.get('/:deckId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const deck = await decksService.getDeck(userId, req.params.deckId);
  res.json(deck);
}));

// Update deck
decksRouter.patch('/:deckId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = updateDeckSchema.parse(req.body);
  const deck = await decksService.updateDeck(userId, req.params.deckId, input);
  res.json(deck);
}));

// Delete deck
decksRouter.delete('/:deckId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await decksService.deleteDeck(userId, req.params.deckId);
  res.status(204).send();
}));

// Get deck analysis
decksRouter.get('/:deckId/analysis', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const analysis = await decksService.analyzeDeck(userId, req.params.deckId);
  res.json(analysis);
}));

// Validate deck
decksRouter.post('/:deckId/validate', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const deck = await decksService.getDeck(userId, req.params.deckId);
  const format = req.body?.format || deck.format;
  const result = validateDeck(deck.tcg, deck.cards, format);
  res.json(result);
}));

// Add card to deck
decksRouter.post('/:deckId/cards', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = addDeckCardSchema.parse(req.body);
  const card = await decksService.addCardToDeck(userId, req.params.deckId, input);
  res.status(201).json(card);
}));

// Update card in deck
decksRouter.patch('/:deckId/cards/:cardId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = updateDeckCardSchema.parse(req.body);
  const card = await decksService.updateDeckCard(userId, req.params.deckId, req.params.cardId, input);
  res.json(card);
}));

// Remove card from deck
decksRouter.delete('/:deckId/cards/:cardId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await decksService.removeDeckCard(userId, req.params.deckId, req.params.cardId);
  res.status(204).send();
}));

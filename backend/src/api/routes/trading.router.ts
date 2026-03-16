import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createTradeSchema } from '@tcg/api-types';
import * as tradingService from '../../modules/trading/trading.service';

export const tradingRouter = Router();

tradingRouter.use(requireAuth);

tradingRouter.get('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const trades = await tradingService.getUserTrades(userId);
  res.json(trades);
}));

tradingRouter.post('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createTradeSchema.parse(req.body);
  const trade = await tradingService.createTrade(userId, input);
  res.status(201).json(trade);
}));

tradingRouter.get('/matches', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const matches = await tradingService.findTradeMatches(userId);
  res.json(matches);
}));

tradingRouter.get('/:tradeId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const trade = await tradingService.getTrade(userId, req.params.tradeId);
  res.json(trade);
}));

tradingRouter.patch('/:tradeId/accept', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const trade = await tradingService.updateTradeStatus(userId, req.params.tradeId, 'accepted');
  res.json(trade);
}));

tradingRouter.patch('/:tradeId/decline', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const trade = await tradingService.updateTradeStatus(userId, req.params.tradeId, 'declined');
  res.json(trade);
}));

tradingRouter.delete('/:tradeId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await tradingService.deleteTrade(userId, req.params.tradeId);
  res.status(204).send();
}));

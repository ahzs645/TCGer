import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createTransactionSchema } from '@tcg/api-types';
import * as financeService from '../../modules/finance/finance.service';

export const financeRouter = Router();

financeRouter.use(requireAuth);

financeRouter.get('/transactions', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const txns = await financeService.getUserTransactions(userId);
  res.json(txns);
}));

financeRouter.post('/transactions', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createTransactionSchema.parse(req.body);
  const txn = await financeService.createTransaction(userId, input);
  res.status(201).json(txn);
}));

financeRouter.delete('/transactions/:transactionId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await financeService.deleteTransaction(userId, req.params.transactionId);
  res.status(204).send();
}));

financeRouter.get('/summary', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const summary = await financeService.getFinanceSummary(userId);
  res.json(summary);
}));

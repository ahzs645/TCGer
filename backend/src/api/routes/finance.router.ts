import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createTransactionSchema, updateTransactionSchema } from '@tcg/api-types';
import * as financeService from '../../modules/finance/finance.service';

export const financeRouter = Router();

financeRouter.use(requireAuth);

financeRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const collectionEntryId =
      typeof req.query.collectionEntryId === 'string'
        ? req.query.collectionEntryId
        : undefined;
    const txns = await financeService.getUserTransactions(
      userId,
      collectionEntryId ? 10 : 100,
      collectionEntryId,
    );
    res.json(txns);
  }),
);

financeRouter.patch(
  '/transactions/:transactionId',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const input = updateTransactionSchema.parse(req.body);
    const txn = await financeService.updateTransaction(
      userId,
      req.params.transactionId,
      input,
    );
    res.json(txn);
  }),
);

financeRouter.post(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const input = createTransactionSchema.parse(req.body);
    const txn = await financeService.createTransaction(userId, input);
    res.status(201).json(txn);
  }),
);

financeRouter.delete(
  '/transactions/:transactionId',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    await financeService.deleteTransaction(userId, req.params.transactionId);
    res.status(204).send();
  }),
);

financeRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const summary = await financeService.getFinanceSummary(userId);
    res.json(summary);
  }),
);

financeRouter.get(
  '/summary/by-currency',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const summary = await financeService.getFinanceSummaryByCurrency(userId);
    res.json(summary);
  }),
);

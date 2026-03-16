import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createNotificationChannelSchema } from '@tcg/api-types';
import * as notificationService from '../../modules/notifications/notification.service';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// Get all notifications
notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const notifications = await notificationService.getUserNotifications(userId);
  res.json(notifications);
}));

// Mark notification as read
notificationsRouter.patch('/:notificationId/read', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const { notificationId } = req.params;
  const result = await notificationService.markNotificationRead(userId, notificationId, true);
  res.json(result);
}));

// Mark all as read
notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await notificationService.markAllRead(userId);
  res.json({ success: true });
}));

// Get notification channels
notificationsRouter.get('/channels', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const channels = await notificationService.getUserChannels(userId);
  res.json(channels);
}));

// Create notification channel
notificationsRouter.post('/channels', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createNotificationChannelSchema.parse(req.body);
  const channel = await notificationService.createChannel(userId, input);
  res.status(201).json(channel);
}));

// Delete notification channel
notificationsRouter.delete('/channels/:channelId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await notificationService.deleteChannel(userId, req.params.channelId);
  res.status(204).send();
}));

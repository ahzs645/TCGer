import { prisma } from '../../lib/prisma';
import type { CreateNotificationChannelInput } from '@tcg/api-types';
import { sendEmail } from './channels/email.channel';
import { sendDiscord } from './channels/discord.channel';
import { sendTelegram } from './channels/telegram.channel';

// ---------------------------------------------------------------------------
// Notification Channels CRUD
// ---------------------------------------------------------------------------

export async function getUserChannels(userId: string) {
  return prisma.notificationChannel.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
}

export async function createChannel(userId: string, input: CreateNotificationChannelInput) {
  return prisma.notificationChannel.create({
    data: { userId, type: input.type, config: input.config, enabled: input.enabled ?? true }
  });
}

export async function deleteChannel(userId: string, channelId: string) {
  const channel = await prisma.notificationChannel.findFirst({ where: { id: channelId, userId } });
  if (!channel) {
    const error = new Error('Notification channel not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.notificationChannel.delete({ where: { id: channelId } });
}

// ---------------------------------------------------------------------------
// Notifications CRUD
// ---------------------------------------------------------------------------

export async function getUserNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

export async function markNotificationRead(userId: string, notificationId: string, read: boolean) {
  const notification = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
  if (!notification) {
    const error = new Error('Notification not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return prisma.notification.update({ where: { id: notificationId }, data: { read } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}

// ---------------------------------------------------------------------------
// Send notification (creates DB record + dispatches to channels)
// ---------------------------------------------------------------------------

export async function sendNotification(userId: string, type: string, title: string, body: string, data?: Record<string, unknown>) {
  // Create in-app notification
  await prisma.notification.create({
    data: { userId, type, title, body, data: data ?? undefined }
  });

  // Dispatch to active channels
  const channels = await prisma.notificationChannel.findMany({
    where: { userId, enabled: true }
  });

  for (const channel of channels) {
    const config = channel.config as Record<string, string>;
    try {
      switch (channel.type) {
        case 'email':
          await sendEmail(config.email, title, body);
          break;
        case 'discord':
          await sendDiscord(config.webhookUrl, title, body);
          break;
        case 'telegram':
          await sendTelegram(config.chatId, config.botToken, title, body);
          break;
      }
    } catch (err) {
      console.error(`[notify] Failed to send via ${channel.type}:`, err);
    }
  }
}

import { prisma } from '../../lib/prisma';
import type { CreateAutomationInput, UpdateAutomationInput } from '@tcg/api-types';

export async function getUserAutomations(userId: string) {
  const automations = await prisma.automation.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
  return automations.map(a => ({
    id: a.id,
    name: a.name,
    trigger: a.trigger,
    action: a.action,
    config: a.config as Record<string, unknown>,
    enabled: a.enabled,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString()
  }));
}

export async function createAutomation(userId: string, input: CreateAutomationInput) {
  return prisma.automation.create({
    data: {
      userId,
      name: input.name,
      trigger: input.trigger,
      action: input.action,
      config: input.config,
      enabled: input.enabled ?? true
    }
  });
}

export async function updateAutomation(userId: string, automationId: string, input: UpdateAutomationInput) {
  const existing = await prisma.automation.findFirst({ where: { id: automationId, userId } });
  if (!existing) {
    const error = new Error('Automation not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  return prisma.automation.update({
    where: { id: automationId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.trigger !== undefined && { trigger: input.trigger }),
      ...(input.action !== undefined && { action: input.action }),
      ...(input.config !== undefined && { config: input.config }),
      ...(input.enabled !== undefined && { enabled: input.enabled })
    }
  });
}

export async function deleteAutomation(userId: string, automationId: string) {
  const existing = await prisma.automation.findFirst({ where: { id: automationId, userId } });
  if (!existing) {
    const error = new Error('Automation not found') as Error & { status: number };
    error.status = 404;
    throw error;
  }
  await prisma.automation.delete({ where: { id: automationId } });
}

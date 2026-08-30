import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

type ReaderCtx = QueryCtx | MutationCtx;

const notificationValidator = v.object({
  id: v.id("notifications"),
  type: v.string(),
  title: v.string(),
  body: v.string(),
  read: v.boolean(),
  data: v.optional(v.record(v.string(), v.any())),
  createdAt: v.string(),
});

const channelValidator = v.object({
  id: v.id("notificationChannels"),
  type: v.string(),
  config: v.record(v.string(), v.string()),
  enabled: v.boolean(),
  createdAt: v.string(),
});

async function viewer(ctx: ReaderCtx, subject: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Viewer not provisioned",
    });
  }
  return user;
}

function response(row: Doc<"notifications">) {
  return {
    id: row._id,
    type: row.type,
    title: row.title,
    body: row.body,
    read: row.read,
    data: row.data,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function safeChannelConfig(row: Doc<"notificationChannels">): Record<string, string> {
  if (row.type === "discord") {
    return { webhookUrl: row.config.webhookUrl ? "configured" : "" };
  }
  return {
    chatId: row.config.chatId ?? "",
    botToken: row.config.botToken ? "configured" : "",
  };
}

export async function insertNotification(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) {
  const now = Date.now();
  return await ctx.db.insert("notifications", {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    read: false,
    data: input.data,
    deliveryStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });
}

export const list = internalQuery({
  args: { subject: v.string() },
  returns: v.array(notificationValidator),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_and_created_at", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
    return rows.map(response);
  },
});

export const markRead = internalMutation({
  args: {
    subject: v.string(),
    notificationId: v.id("notifications"),
    read: v.boolean(),
  },
  returns: notificationValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const row = await ctx.db.get(args.notificationId);
    if (!row || row.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Notification not found" });
    }
    await ctx.db.patch(row._id, { read: args.read, updatedAt: Date.now() });
    return response((await ctx.db.get(row._id))!);
  },
});

export const markAllRead = internalMutation({
  args: { subject: v.string() },
  returns: v.object({ success: v.boolean(), updated: v.number() }),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_read_and_created_at", (q) =>
        q.eq("userId", user._id).eq("read", false),
      )
      .take(500);
    const now = Date.now();
    for (const row of rows) await ctx.db.patch(row._id, { read: true, updatedAt: now });
    return { success: true, updated: rows.length };
  },
});

export const listChannels = internalQuery({
  args: { subject: v.string() },
  returns: v.array(channelValidator),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const rows = await ctx.db
      .query("notificationChannels")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(20);
    return rows.map((row) => ({
      id: row._id,
      type: row.type,
      config: safeChannelConfig(row),
      enabled: row.enabled,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  },
});

function validateChannel(
  type: "discord" | "telegram",
  config: Record<string, string>,
): Record<string, string> {
  if (type === "discord") {
    let url: URL;
    try {
      url = new URL(config.webhookUrl ?? "");
    } catch {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Discord webhook URL is invalid" });
    }
    if (
      url.protocol !== "https:" ||
      !["discord.com", "discordapp.com"].includes(url.hostname) ||
      !url.pathname.startsWith("/api/webhooks/")
    ) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Discord webhook must use the official Discord webhook endpoint" });
    }
    return { webhookUrl: url.toString() };
  }
  const chatId = config.chatId?.trim();
  const botToken = config.botToken?.trim();
  if (!chatId || !botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Telegram chat ID and bot token are required" });
  }
  return { chatId, botToken };
}

export const createChannel = internalMutation({
  args: {
    subject: v.string(),
    type: v.union(v.literal("discord"), v.literal("telegram")),
    config: v.record(v.string(), v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: channelValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const now = Date.now();
    const id = await ctx.db.insert("notificationChannels", {
      userId: user._id,
      type: args.type,
      config: validateChannel(args.type, args.config),
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
    const row = (await ctx.db.get(id))!;
    return {
      id,
      type: row.type,
      config: safeChannelConfig(row),
      enabled: row.enabled,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  },
});

export const deleteChannel = internalMutation({
  args: { subject: v.string(), channelId: v.id("notificationChannels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const row = await ctx.db.get(args.channelId);
    if (!row || row.userId !== user._id) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Notification channel not found" });
    }
    await ctx.db.delete(row._id);
    return null;
  },
});

export const deliveryPayload = internalQuery({
  args: { notificationId: v.id("notifications") },
  returns: v.union(
    v.object({
      notificationId: v.id("notifications"),
      title: v.string(),
      body: v.string(),
      channels: v.array(v.object({
        type: v.union(v.literal("discord"), v.literal("telegram")),
        config: v.record(v.string(), v.string()),
      })),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) return null;
    const channels = await ctx.db
      .query("notificationChannels")
      .withIndex("by_user_and_enabled", (q) =>
        q.eq("userId", row.userId).eq("enabled", true),
      )
      .take(20);
    return {
      notificationId: row._id,
      title: row.title,
      body: row.body,
      channels: channels.map((channel) => ({
        type: channel.type,
        config: channel.config,
      })),
    };
  },
});

export const recordDelivery = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    status: v.union(
      v.literal("delivered"),
      v.literal("partial"),
      v.literal("failed"),
      v.literal("in_app_only"),
    ),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (row) {
      await ctx.db.patch(row._id, {
        deliveryStatus: args.status,
        deliveryError: args.error,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const dispatchNotification = internalAction({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.notifications.deliveryPayload, args);
    if (!payload) return null;
    if (payload.channels.length === 0) {
      await ctx.runMutation(internal.notifications.recordDelivery, {
        notificationId: args.notificationId,
        status: "in_app_only",
      });
      return null;
    }
    let delivered = 0;
    const errors: string[] = [];
    for (const channel of payload.channels) {
      try {
        const response = channel.type === "discord"
          ? await fetch(channel.config.webhookUrl!, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: `**${payload.title}**\n${payload.body}` }),
            })
          : await fetch(`https://api.telegram.org/bot${channel.config.botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: channel.config.chatId, text: `${payload.title}\n${payload.body}` }),
            });
        if (!response.ok) throw new Error(`${channel.type} returned ${response.status}`);
        delivered += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${channel.type} delivery failed`);
      }
    }
    await ctx.runMutation(internal.notifications.recordDelivery, {
      notificationId: args.notificationId,
      status: delivered === payload.channels.length ? "delivered" : delivered > 0 ? "partial" : "failed",
      error: errors.length ? errors.join("; ").slice(0, 500) : undefined,
    });
    return null;
  },
});

import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";

const fallbackSecret = "tcger-convex-dev-local-secret-2026-not-default";

// NODE_ENV is unreliable inside Convex (push analysis always reports
// "production"), so dev-vs-deployed is derived from the deployment URL:
// only localhost deployments may fall back to the baked-in dev secret.
const isLocalDeployment = (): boolean => {
  const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_SITE_URL ?? "";
  if (!url) {
    return true;
  }
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
};

const getBetterAuthSecret = (): string => {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (!isLocalDeployment()) {
    throw new Error(
      "BETTER_AUTH_SECRET is required on non-local Convex deployments",
    );
  }
  return fallbackSecret;
};

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
};

const parseOriginsEnv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const isNonEmptyString = (value: string | undefined): value is string =>
  Boolean(value);

export const authComponent = createClient<DataModel>(components.betterAuth, {
  verbose: false,
});

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL;
  const trustedOrigins = Array.from(
    new Set(
      [
        siteUrl,
        ...parseOriginsEnv(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
      ].filter(isNonEmptyString),
    ),
  );
  const useSecureCookies =
    parseBooleanEnv(process.env.BETTER_AUTH_USE_SECURE_COOKIES) ??
    siteUrl?.startsWith("https://") ??
    false;

  return {
    appName: "TCGer",
    baseURL: siteUrl,
    basePath: "/api/auth",
    secret: getBetterAuthSecret(),
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      useSecureCookies,
      disableOriginCheck:
        process.env.BETTER_AUTH_DISABLE_ORIGIN_CHECK === "true",
      disableCSRFCheck: process.env.BETTER_AUTH_DISABLE_ORIGIN_CHECK === "true",
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 50,
      }),
      convex({
        authConfig,
      }),
    ],
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          if (!("runMutation" in ctx)) {
            throw new Error(
              "Account deletion requires a Convex mutation context",
            );
          }
          await ctx.runMutation(internal.accountDeletion.request, {
            authSubject: user.id,
          });
        },
      },
      additionalFields: {
        isAdmin: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        showCardNumbers: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
        showPricing: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
        enabledYugioh: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
        enabledMagic: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
        enabledPokemon: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
        enabledOnepiece: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        enabledLorcana: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        enabledDragonball: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        defaultGame: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
  } satisfies BetterAuthOptions;
};

export const options = createAuthOptions({} as GenericCtx<DataModel>);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

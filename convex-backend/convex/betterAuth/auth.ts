import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";

const fallbackSecret = "tcger-convex-dev-local-secret-2026-not-default";

export const authComponent = createClient<DataModel>(components.betterAuth, {
  verbose: false
});

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    appName: "TCGer",
    baseURL: process.env.SITE_URL,
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET ?? fallbackSecret,
    trustedOrigins: process.env.SITE_URL ? [process.env.SITE_URL] : undefined,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true
    },
    advanced: {
      disableOriginCheck: process.env.BETTER_AUTH_DISABLE_ORIGIN_CHECK === "true",
      disableCSRFCheck: process.env.BETTER_AUTH_DISABLE_ORIGIN_CHECK === "true"
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 50
      }),
      convex({
        authConfig
      })
    ],
    user: {
      additionalFields: {
        isAdmin: {
          type: "boolean",
          defaultValue: false,
          input: false
        },
        showCardNumbers: {
          type: "boolean",
          defaultValue: true,
          input: false
        },
        showPricing: {
          type: "boolean",
          defaultValue: true,
          input: false
        },
        enabledYugioh: {
          type: "boolean",
          defaultValue: true,
          input: false
        },
        enabledMagic: {
          type: "boolean",
          defaultValue: true,
          input: false
        },
        enabledPokemon: {
          type: "boolean",
          defaultValue: true,
          input: false
        },
        defaultGame: {
          type: "string",
          required: false,
          input: false
        }
      }
    }
  }) satisfies BetterAuthOptions;

export const options = createAuthOptions({} as GenericCtx<DataModel>);

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));

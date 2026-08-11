/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as analytics from "../analytics.js";
import type * as analyticsHttp from "../analyticsHttp.js";
import type * as binders from "../binders.js";
import type * as bridge from "../bridge.js";
import type * as collections from "../collections.js";
import type * as crons from "../crons.js";
import type * as decks from "../decks.js";
import type * as decksHttp from "../decksHttp.js";
import type * as finance from "../finance.js";
import type * as financeHttp from "../financeHttp.js";
import type * as guides from "../guides.js";
import type * as http from "../http.js";
import type * as lib_auditValidators from "../lib/auditValidators.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cardMetadata from "../lib/cardMetadata.js";
import type * as lib_collectionAudit from "../lib/collectionAudit.js";
import type * as lib_collectionImport from "../lib/collectionImport.js";
import type * as lib_domain from "../lib/domain.js";
import type * as lib_httpBridge from "../lib/httpBridge.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_validators from "../lib/validators.js";
import type * as sealed from "../sealed.js";
import type * as sealedHttp from "../sealedHttp.js";
import type * as tags from "../tags.js";
import type * as trades from "../trades.js";
import type * as tradesHttp from "../tradesHttp.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  analytics: typeof analytics;
  analyticsHttp: typeof analyticsHttp;
  binders: typeof binders;
  bridge: typeof bridge;
  collections: typeof collections;
  crons: typeof crons;
  decks: typeof decks;
  decksHttp: typeof decksHttp;
  finance: typeof finance;
  financeHttp: typeof financeHttp;
  guides: typeof guides;
  http: typeof http;
  "lib/auditValidators": typeof lib_auditValidators;
  "lib/auth": typeof lib_auth;
  "lib/cardMetadata": typeof lib_cardMetadata;
  "lib/collectionAudit": typeof lib_collectionAudit;
  "lib/collectionImport": typeof lib_collectionImport;
  "lib/domain": typeof lib_domain;
  "lib/httpBridge": typeof lib_httpBridge;
  "lib/library": typeof lib_library;
  "lib/validators": typeof lib_validators;
  sealed: typeof sealed;
  sealedHttp: typeof sealedHttp;
  tags: typeof tags;
  trades: typeof trades;
  tradesHttp: typeof tradesHttp;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};

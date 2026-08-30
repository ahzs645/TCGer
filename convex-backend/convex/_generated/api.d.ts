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
import type * as alertsAutomations from "../alertsAutomations.js";
import type * as alertsAutomationsHttp from "../alertsAutomationsHttp.js";
import type * as analytics from "../analytics.js";
import type * as analyticsHttp from "../analyticsHttp.js";
import type * as banlistSync from "../banlistSync.js";
import type * as banlists from "../banlists.js";
import type * as banlistsHttp from "../banlistsHttp.js";
import type * as binders from "../binders.js";
import type * as bridge from "../bridge.js";
import type * as catalogCorrections from "../catalogCorrections.js";
import type * as catalogCorrectionsHttp from "../catalogCorrectionsHttp.js";
import type * as collectionOperations from "../collectionOperations.js";
import type * as collections from "../collections.js";
import type * as crons from "../crons.js";
import type * as deckCheckouts from "../deckCheckouts.js";
import type * as decks from "../decks.js";
import type * as decksHttp from "../decksHttp.js";
import type * as domainHttp from "../domainHttp.js";
import type * as finance from "../finance.js";
import type * as financeHttp from "../financeHttp.js";
import type * as guides from "../guides.js";
import type * as http from "../http.js";
import type * as lib_auditValidators from "../lib/auditValidators.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cardMetadata from "../lib/cardMetadata.js";
import type * as lib_collectionAudit from "../lib/collectionAudit.js";
import type * as lib_collectionImport from "../lib/collectionImport.js";
import type * as lib_copyLabels from "../lib/copyLabels.js";
import type * as lib_domain from "../lib/domain.js";
import type * as lib_httpBridge from "../lib/httpBridge.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_sharing from "../lib/sharing.js";
import type * as lib_storageAudit from "../lib/storageAudit.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_yugiohBanlist from "../lib/yugiohBanlist.js";
import type * as notifications from "../notifications.js";
import type * as notificationsHttp from "../notificationsHttp.js";
import type * as onlineCodes from "../onlineCodes.js";
import type * as onlineCodesHttp from "../onlineCodesHttp.js";
import type * as pricingHistory from "../pricingHistory.js";
import type * as pricingHistoryHttp from "../pricingHistoryHttp.js";
import type * as providerCache from "../providerCache.js";
import type * as providerCacheHttp from "../providerCacheHttp.js";
import type * as scanSessions from "../scanSessions.js";
import type * as scanSessionsHttp from "../scanSessionsHttp.js";
import type * as sealed from "../sealed.js";
import type * as sealedHttp from "../sealedHttp.js";
import type * as storage from "../storage.js";
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
  alertsAutomations: typeof alertsAutomations;
  alertsAutomationsHttp: typeof alertsAutomationsHttp;
  analytics: typeof analytics;
  analyticsHttp: typeof analyticsHttp;
  banlistSync: typeof banlistSync;
  banlists: typeof banlists;
  banlistsHttp: typeof banlistsHttp;
  binders: typeof binders;
  bridge: typeof bridge;
  catalogCorrections: typeof catalogCorrections;
  catalogCorrectionsHttp: typeof catalogCorrectionsHttp;
  collectionOperations: typeof collectionOperations;
  collections: typeof collections;
  crons: typeof crons;
  deckCheckouts: typeof deckCheckouts;
  decks: typeof decks;
  decksHttp: typeof decksHttp;
  domainHttp: typeof domainHttp;
  finance: typeof finance;
  financeHttp: typeof financeHttp;
  guides: typeof guides;
  http: typeof http;
  "lib/auditValidators": typeof lib_auditValidators;
  "lib/auth": typeof lib_auth;
  "lib/cardMetadata": typeof lib_cardMetadata;
  "lib/collectionAudit": typeof lib_collectionAudit;
  "lib/collectionImport": typeof lib_collectionImport;
  "lib/copyLabels": typeof lib_copyLabels;
  "lib/domain": typeof lib_domain;
  "lib/httpBridge": typeof lib_httpBridge;
  "lib/library": typeof lib_library;
  "lib/sharing": typeof lib_sharing;
  "lib/storageAudit": typeof lib_storageAudit;
  "lib/validators": typeof lib_validators;
  "lib/yugiohBanlist": typeof lib_yugiohBanlist;
  notifications: typeof notifications;
  notificationsHttp: typeof notificationsHttp;
  onlineCodes: typeof onlineCodes;
  onlineCodesHttp: typeof onlineCodesHttp;
  pricingHistory: typeof pricingHistory;
  pricingHistoryHttp: typeof pricingHistoryHttp;
  providerCache: typeof providerCache;
  providerCacheHttp: typeof providerCacheHttp;
  scanSessions: typeof scanSessions;
  scanSessionsHttp: typeof scanSessionsHttp;
  sealed: typeof sealed;
  sealedHttp: typeof sealedHttp;
  storage: typeof storage;
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

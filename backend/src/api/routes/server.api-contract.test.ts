import express from "express";
import type { Server } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import contracts from "../../../../mobile-parity/api-contracts/interactions.json";
import { assertResponse } from "../../../../tools/api-contracts/match.mjs";

vi.mock("../../config/env", () => ({ env: { SINGLE_USER_MODE: false, BACKEND_MODE: "convex", TCGER_BRIDGE_SECRET: "contract-bridge-secret", CONVEX_HTTP_ORIGIN: "https://auth.contract.test" } }));
vi.mock("../../modules/collections/collections.service", () => ({ getUserBinders: vi.fn(), createBinder: vi.fn(), updateBinder: vi.fn(), deleteBinder: vi.fn(), addCardToBinder: vi.fn(), updateCardInBinder: vi.fn(), removeCardFromBinder: vi.fn() }));
vi.mock("../../modules/collections/export.service", () => ({}));
vi.mock("../../modules/collections/import.service", () => ({}));
vi.mock("../../modules/collections/collection-audit.service", () => ({}));
vi.mock("../../modules/collections/bulk-add.service", () => ({}));
vi.mock("../../modules/collections/binder-pages.service", () => ({}));
vi.mock("../../modules/pricing/collection-price-enrichment", () => ({ enrichCollectionCardPrice: vi.fn(async input => input) }));
vi.mock("../../modules/sealed/sealed.service", () => ({ createSealedOpening: vi.fn() }));
vi.mock("../../utils/upload", () => ({ uploadImages: { single: () => (_req: unknown, _res: unknown, next: () => void) => next(), array: () => (_req: unknown, _res: unknown, next: () => void) => next() } }));
vi.mock("../../modules/cards/cards.service", () => ({ searchAllCards: vi.fn() }));
vi.mock("../../modules/adapters/adapter-registry", () => ({ adapterRegistry: {} }));
import { getUserBinders, createBinder, updateBinder, deleteBinder, addCardToBinder, updateCardInBinder, removeCardFromBinder } from "../../modules/collections/collections.service";
import { searchAllCards } from "../../modules/cards/cards.service";
import { createSealedOpening } from "../../modules/sealed/sealed.service";
import { sealedRouter } from "./sealed.router";
import { collectionsRouter } from "./collections.router";
import { backupsRouter } from "./backups.router";
import { cardsRouter } from "./cards.router";
import { errorHandler } from "../middleware/error-handler";

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
});

for (const interaction of contracts.interactions as any[]) {
  test(`[api:${interaction.id}] express provider`, async () => {
    // Services are isolated here; Convex tests below verify real persistence.
    vi.mocked(getUserBinders).mockResolvedValue(interaction.response.body as never);
    vi.mocked(createBinder).mockImplementation(async (_user, input) => ({
      id: "generated-binder", ...input, cards: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }) as never);
    vi.mocked(searchAllCards).mockResolvedValue((interaction.state === "search-results" ? interaction.response.body.cards : []) as never);

    vi.mocked(updateBinder).mockImplementation(async (_user, id, input) => {
      if (interaction.state === "foreign") throw new Error("Binder not found");
      return { ...contracts.interactions.find(item => item.id === "collections.create.success")!.response.body, ...input, id } as never;
    });
    vi.mocked(deleteBinder).mockImplementation(async () => { if (interaction.state === "foreign") throw new Error("Binder not found"); });
    vi.mocked(addCardToBinder).mockImplementation(async () => {
      if (interaction.state === "foreign") throw new Error("Binder not found");
      return interaction.response.body as never;
    });
    vi.mocked(updateCardInBinder).mockImplementation(async () => {
      if (interaction.state === "foreign-copy") throw new Error("Collection entry not found");
      return interaction.response.body as never;
    });
    vi.mocked(removeCardFromBinder).mockImplementation(async () => {
      if (interaction.state === "foreign-copy") throw new Error("Collection entry not found");
    });
    vi.mocked(createSealedOpening).mockImplementation(async () => {
      if (interaction.response.status === 404 || interaction.response.status === 409) {
        throw Object.assign(new Error(interaction.response.body.message), { status: interaction.response.status });
      }
      return interaction.response.body as never;
    });
    const transport = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string | URL, options?: RequestInit) => {
      if (String(url).startsWith("https://auth.contract.test/")) {
        if (new URL(url).pathname === "/backups") {
          expect(options?.method).toBe("POST");
          expect(new Headers(options?.headers).get("x-tcger-user-id")).toBe("contract-user");
          expect(new Headers(options?.headers).get("x-tcger-bridge-key")).toBe("contract-bridge-secret");
          expect(JSON.parse(options!.body as string)).toEqual(interaction.request.body);
          return Response.json(interaction.response.body, {status: interaction.response.status});
        }
        expect(new URL(url).pathname).toBe("/api/auth/get-session");
        const valid = new Headers(options?.headers).get("authorization") === "Bearer contract-token";
        return Response.json(valid ? { user: { id: "contract-user", email: "contract@example.test" } } : {});
      }
      return transport(url, options);
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).log = { error: vi.fn(), warn: vi.fn() }; next(); });
    app.use("/backups", backupsRouter);
    app.use("/collections", collectionsRouter);
    app.use("/cards", cardsRouter);
    app.use("/sealed", sealedRouter);
    app.use(errorHandler);
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
    const address = server!.address() as { port: number };
    const url = new URL(interaction.request.path, `http://127.0.0.1:${address.port}`);
    for (const [key, value] of Object.entries(interaction.request.query ?? {})) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method: interaction.request.method,
      headers: { ...interaction.request.headers, "Content-Type": "application/json" },
      body: interaction.request.body === undefined ? undefined : JSON.stringify(interaction.request.body),
    });
    expect(response.status).toBe(interaction.response.status);
    if (response.status !== 204) expect(response.headers.get("content-type")).toContain("application/json");
    assertResponse(response.status === 204 ? null : await response.json(), interaction.response.body, interaction.response.matchers);
    if (interaction.response.status === 401 || interaction.response.status === 400) {
      expect(getUserBinders).not.toHaveBeenCalled();
      expect(createBinder).not.toHaveBeenCalled();
      expect(searchAllCards).not.toHaveBeenCalled();
      expect(addCardToBinder).not.toHaveBeenCalled();
      expect(updateCardInBinder).not.toHaveBeenCalled();
      expect(removeCardFromBinder).not.toHaveBeenCalled();
      expect(createSealedOpening).not.toHaveBeenCalled();
    } else if (interaction.operation === "createBinder") {
      expect(createBinder).toHaveBeenCalledWith("contract-user", expect.objectContaining(interaction.request.body));
    } else if (interaction.operation === "listBinders") {
      expect(getUserBinders).toHaveBeenCalledWith("contract-user");
    } else if (interaction.operation === "updateBinder") {
      expect(updateBinder).toHaveBeenCalledWith("contract-user", "contract-binder", interaction.request.body);
    } else if (interaction.operation === "deleteBinder") {
      expect(deleteBinder).toHaveBeenCalledWith("contract-user", "contract-binder", "move_to_unsorted");
    } else if (interaction.operation === "addCopy") {
      expect(addCardToBinder).toHaveBeenCalledWith("contract-user", "contract-binder", interaction.request.body);
    } else if (interaction.operation === "updateCopy") {
      expect(updateCardInBinder).toHaveBeenCalledWith("contract-user", "contract-binder", "contract-copy", interaction.request.body);
    } else if (interaction.operation === "removeCopy") {
      expect(removeCardFromBinder).toHaveBeenCalledWith("contract-user", "contract-binder", "contract-copy");
    } else if (interaction.operation === "openSealed") {
      expect(createSealedOpening).toHaveBeenCalledWith("contract-user", "contract-inventory", interaction.request.body);
    } else if (interaction.operation === "searchCards") {
      expect(searchAllCards).toHaveBeenCalledWith({ ...interaction.request.query, limit: 1000 });
    }
  });
}

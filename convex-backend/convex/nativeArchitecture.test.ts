import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

describe("convex native architecture", () => {
  test("provisions an authenticated viewer with a default library binder", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({
      subject: "user_avery",
      email: "avery@example.com",
      name: "Avery"
    });

    const viewer = await asAvery.mutation(api.users.ensureCurrent, {
      username: "avery"
    });
    const binders = await asAvery.query(api.binders.list);

    expect(viewer.authSubject).toBe("user_avery");
    expect(viewer.username).toBe("avery");
    expect(viewer).toMatchObject({
      enabledOnepiece: false,
      enabledLorcana: false,
      enabledDragonball: false
    });
    expect(binders).toHaveLength(1);
    expect(binders[0]).toMatchObject({
      kind: "library",
      name: "Library"
    });
  });

  test("normalizes missing new-game fields on pre-port native users", async () => {
    const t = createTestConvex();
    await t.run(async (ctx) => {
      const timestamp = Date.now();
      const userId = await ctx.db.insert("users", {
        authSubject: "legacy_user",
        email: "legacy@example.com",
        name: "Legacy User",
        isAdmin: false,
        showCardNumbers: true,
        showPricing: true,
        enabledYugioh: true,
        enabledMagic: true,
        enabledPokemon: true,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await ctx.db.insert("binders", {
        userId,
        kind: "library",
        name: "Library",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });

    const viewer = await t
      .withIdentity({ subject: "legacy_user", name: "Legacy User" })
      .query(api.users.me);

    expect(viewer).toMatchObject({
      enabledOnepiece: false,
      enabledLorcana: false,
      enabledDragonball: false
    });
  });

  test("creates a native binder and isolates data per user", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });
    const asJordan = t.withIdentity({ subject: "user_jordan", name: "Jordan" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    await asJordan.mutation(api.users.ensureCurrent, {});
    await asAvery.mutation(api.binders.create, {
      name: "Trade Binder",
      colorHex: "22c55e",
      containerType: "binder",
      imageUrl: "https://example.com/trade-binder.jpg",
      associatedTcg: "yugioh",
      associatedSetCode: "LOB",
      associatedSetName: "Legend of Blue Eyes White Dragon"
    });

    const averyBinders = await asAvery.query(api.binders.list);
    const jordanBinders = await asJordan.query(api.binders.list);

    expect(averyBinders.map((binder) => binder.name)).toEqual(["Library", "Trade Binder"]);
    expect(jordanBinders.map((binder) => binder.name)).toEqual(["Library"]);
    expect(averyBinders[1]).toMatchObject({
      containerType: "binder",
      imageUrl: "https://example.com/trade-binder.jpg",
      associatedTcg: "yugioh",
      associatedSetCode: "LOB"
    });
  });

  test("adds cards to a binder with native tags and returns hydrated entries", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Commander Staples",
      colorHex: "2563eb"
    });

    const entry = await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      quantity: 2,
      card: {
        tcg: "magic",
        externalId: "smothering-tithe",
        name: "Smothering Tithe",
        setCode: "RNA",
        setName: "Ravnica Allegiance",
        rarity: "Rare",
        imageUrl: "https://example.com/tithe.jpg"
      },
      newTags: [
        { label: "For Trade", colorHex: "4caf50" },
        { label: "Staple", colorHex: "f59e0b" }
      ]
    });

    const detail = await asAvery.query(api.binders.get, { binderId: binder.id });

    expect(entry.card.name).toBe("Smothering Tithe");
    expect(entry.quantity).toBe(1);
    expect(entry.tags.map((tag) => tag.label).sort()).toEqual(["For Trade", "Staple"]);
    expect(detail.entryCount).toBe(2);
    expect(detail.entries[0].card.externalId).toBe("smothering-tithe");
  });

  test("keeps exact printings separate while sharing a base card identity", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Yu-Gi-Oh Printings"
    });

    const first = await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      card: {
        tcg: "yugioh",
        externalId: "46986414:lob-001:na",
        baseExternalId: "46986414",
        printingKey: "yugioh|46986414|lob-001|ultra-rare|001|na",
        artworkId: "46986414",
        collectorNumber: "LOB-001",
        name: "Dark Magician",
        setCode: "LOB-001",
        rarity: "Ultra Rare"
      }
    });
    const second = await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      card: {
        tcg: "yugioh",
        externalId: "46986414:sd6-en003:na",
        baseExternalId: "46986414",
        printingKey: "yugioh|46986414|sd6-en003|common|003|na",
        artworkId: "46986414",
        collectorNumber: "SD6-EN003",
        name: "Dark Magician",
        setCode: "SD6-EN003",
        rarity: "Common"
      }
    });

    expect(first.card).toMatchObject({
      baseExternalId: "46986414",
      collectorNumber: "LOB-001",
      printingKey: "yugioh|46986414|lob-001|ultra-rare|001|na"
    });
    expect(second.card).toMatchObject({
      baseExternalId: "46986414",
      collectorNumber: "SD6-EN003",
      printingKey: "yugioh|46986414|sd6-en003|common|003|na"
    });
    expect(second.card.id).not.toBe(first.card.id);

    const persisted = await t.run(async (ctx) => {
      const identities = await ctx.db
        .query("cardIdentities")
        .withIndex("by_tcg_external", (q) =>
          q.eq("tcg", "yugioh").eq("externalId", "46986414")
        )
        .take(2);
      const printings = await ctx.db
        .query("cards")
        .withIndex("by_tcg_base_external", (q) =>
          q.eq("tcg", "yugioh").eq("baseExternalId", "46986414")
        )
        .take(3);
      return {
        identityCount: identities.length,
        identityIds: printings.map((printing) => printing.identityId)
      };
    });

    expect(persisted.identityCount).toBe(1);
    expect(persisted.identityIds).toHaveLength(2);
    expect(new Set(persisted.identityIds).size).toBe(1);
  });

  test("updates and moves entries between binders", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    const tradeBinder = await asAvery.mutation(api.binders.create, {
      name: "Trade Binder",
      colorHex: "22c55e"
    });
    const pcBinder = await asAvery.mutation(api.binders.create, {
      name: "Personal Collection",
      colorHex: "ef4444"
    });

    const created = await asAvery.mutation(api.collections.addToBinder, {
      binderId: tradeBinder.id,
      card: {
        tcg: "pokemon",
        externalId: "sv1-001",
        name: "Bulbasaur",
        setCode: "SV1"
      }
    });

    const updated = await asAvery.mutation(api.collections.update, {
      entryId: created.id,
      binderId: pcBinder.id,
      quantity: 3,
      notes: "Moved into PC"
    });

    const tradeDetail = await asAvery.query(api.binders.get, { binderId: tradeBinder.id });
    const pcDetail = await asAvery.query(api.binders.get, { binderId: pcBinder.id });

    expect(updated.quantity).toBe(3);
    expect(updated.notes).toBe("Moved into PC");
    expect(updated.binderId).toBe(pcBinder.id);
    expect(tradeDetail.entryCount).toBe(0);
    expect(pcDetail.entryCount).toBe(1);
  });

  test("preserves rich catalog metadata and collectible variants", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });

    await asAvery.mutation(api.users.ensureCurrent, {});
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Pokemon Variants"
    });

    const entry = await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      card: {
        tcg: "pokemon",
        externalId: "base1-4",
        baseExternalId: "charizard",
        printingKey: "pokemon:base1:4:en",
        artworkId: "base1-charizard",
        name: "Charizard",
        setCode: "base1",
        setName: "Base Set",
        rarity: "Rare Holo",
        collectorNumber: "4/102",
        releasedAt: "1999-01-09",
        setSymbolUrl: "https://example.com/base1-symbol.png",
        setLogoUrl: "https://example.com/base1-logo.png",
        regulationMark: "A",
        language: "English",
        supertype: "Pokémon",
        formatLegality: { standard: false, expanded: false },
        dexEntries: [{ number: 6, name: "Charizard" }],
        region: "International",
        pokemonPrint: {
          finishes: ["cosmos-holofoil", "normal"],
          category: "Pokémon",
          language: "English",
          dexEntries: [{ number: 6, name: "Charizard" }]
        },
        attributes: { hp: "120", types: ["Fire"] },
        provenance: {
          source: "pokemon-tcg-api",
          sourceId: "base1-4",
          fetchedAt: "2026-07-23T00:00:00.000Z",
          schemaVersion: "1"
        },
        legalityPeriods: [
          {
            format: "Standard",
            rotation: "Base-Neo",
            validFrom: "1999-01-09",
            validTo: "2003-06-30",
            legal: true
          }
        ],
        evolution: {
          evolvesFrom: "Charmeleon",
          evolvesTo: []
        },
        functionalIdentity: {
          key: "charizard|120|fire-spin",
          normalizedRules: "fire spin"
        }
      },
      isFoil: true,
      finishCode: "cosmos-holofoil",
      finishLabel: "Cosmos Holofoil",
      edition: "1st Edition",
      stamp: "Edition 1",
      isSealedPromo: false,
      isOversized: false,
      isPeelOff: false
    });

    expect(entry.card).toMatchObject({
      collectorNumber: "4/102",
      baseExternalId: "charizard",
      printingKey: "pokemon:base1:4:en",
      artworkId: "base1-charizard",
      regulationMark: "A",
      language: "English",
      supertype: "Pokémon",
      region: "International",
      provenance: {
        source: "pokemon-tcg-api",
        sourceId: "base1-4"
      },
      evolution: {
        evolvesFrom: "Charmeleon"
      },
      functionalIdentity: {
        key: "charizard|120|fire-spin"
      }
    });
    expect(entry.card.pokemonPrint?.finishes).toEqual(["cosmos-holofoil", "normal"]);
    expect(entry).toMatchObject({
      isFoil: true,
      finishCode: "cosmos-holofoil",
      finishLabel: "Cosmos Holofoil",
      edition: "1st Edition",
      stamp: "Edition 1",
      isSealedPromo: false,
      isOversized: false,
      isPeelOff: false
    });

    const updated = await asAvery.mutation(api.collections.update, {
      entryId: entry.id,
      finishLabel: null,
      edition: null,
      stamp: "Wizards"
    });

    expect(updated.finishLabel).toBeUndefined();
    expect(updated.edition).toBeUndefined();
    expect(updated.stamp).toBe("Wizards");
  });

  test(
    "serves a native health endpoint through Convex HTTP actions",
    async () => {
      const t = createTestConvex();
      const response = await t.fetch("/health");
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        status: "ok",
        backend: "convex-native"
      });
    },
    15_000
  );

  test("rejects forged bridge identities before provisioning a viewer or admin", async () => {
    const t = createTestConvex();
    const forgedHeaders = {
      Authorization: "Bearer forged-token",
      "x-tcger-user-id": "forged_admin",
      "x-tcger-user-email": "forged@example.com"
    };

    const profileResponse = await t.fetch("/users/me", { headers: forgedHeaders });
    const setupResponse = await t.fetch("/setup/setup", {
      method: "POST",
      headers: forgedHeaders
    });
    const setupRequiredResponse = await t.fetch("/setup/setup-required", {
      headers: { "x-tcger-bridge-key": TEST_BRIDGE_SECRET }
    });

    expect(profileResponse.status).toBe(401);
    expect(setupResponse.status).toBe(401);
    expect(await setupRequiredResponse.json()).toEqual({ setupRequired: true });
  });

  test("mirrors collection REST routes over Convex HTTP actions", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
      "x-tcger-user-id": "user_avery",
      "x-tcger-user-email": "avery@example.com",
      "x-tcger-username": "avery"
    };

    const createBinderResponse = await t.fetch("/collections", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "HTTP Binder",
        colorHex: "22c55e",
        containerType: "storage-box",
        imageUrl: "https://example.com/http-binder.jpg",
        associatedTcg: "magic",
        associatedSetCode: "CMM"
      })
    });
    const createdBinder = await createBinderResponse.json();

    expect(createBinderResponse.status).toBe(201);
    expect(createdBinder.name).toBe("HTTP Binder");
    expect(createdBinder).toMatchObject({
      containerType: "storage-box",
      imageUrl: "https://example.com/http-binder.jpg",
      associatedTcg: "magic",
      associatedSetCode: "CMM"
    });
    expect(Array.isArray(createdBinder.cards)).toBe(true);

    const createTagResponse = await t.fetch("/collections/tags", {
      method: "POST",
      headers,
      body: JSON.stringify({
        label: "For Trade"
      })
    });
    const tag = await createTagResponse.json();

    const addCardResponse = await t.fetch(`/collections/${createdBinder.id}/cards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quantity: 1,
        newTags: [{ label: "Staple" }],
        cardData: {
          tcg: "magic",
          externalId: "sol-ring",
          name: "Sol Ring",
          setCode: "CMM",
          setName: "Commander Masters",
          collectorNumber: "396",
          releasedAt: "2023-08-04",
          setSymbolUrl: "https://example.com/cmm.svg",
          attributes: { oracleId: "sol-ring-oracle" },
          provenance: {
            source: "scryfall",
            sourceId: "sol-ring"
          },
          functionalIdentity: {
            key: "sol-ring-oracle",
            normalizedRules: "{T}: Add {C}{C}."
          }
        },
        isFoil: true,
        finishCode: "etched",
        finishLabel: "Etched Foil",
        edition: "Borderless",
        stamp: "Promo Pack",
        isSealedPromo: true,
        isOversized: false,
        isPeelOff: false
      })
    });
    const addedCard = await addCardResponse.json();

    const listResponse = await t.fetch("/collections", {
      headers
    });
    const binders = await listResponse.json();

    expect(createTagResponse.status).toBe(201);
    expect(tag.label).toBe("For Trade");
    expect(addCardResponse.status).toBe(201);
    expect(addedCard.name).toBe("Sol Ring");
    expect(addedCard.collectorNumber).toBe("396");
    expect(addedCard.provenance).toEqual({
      source: "scryfall",
      sourceId: "sol-ring"
    });
    expect(addedCard.copies[0]).toMatchObject({
      isFoil: true,
      finishCode: "etched",
      finishLabel: "Etched Foil",
      edition: "Borderless",
      stamp: "Promo Pack",
      isSealedPromo: true,
      isOversized: false,
      isPeelOff: false
    });
    expect(addedCard.copies[0].id).toBeTruthy();
    expect(binders[0].id).toBe("__library__");
    expect(binders[1].cards[0].copies[0].id).toBe(addedCard.copies[0].id);

    const updateCardResponse = await t.fetch(`/collections/${createdBinder.id}/cards/${addedCard.copies[0].id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        quantity: 2,
        notes: "Promoted to foil slot",
        finishCode: "galaxy",
        finishLabel: "Galaxy Foil",
        stamp: null,
        cardOverride: {
          cardId: "sol-ring-borderless",
          cardData: {
            tcg: "magic",
            externalId: "sol-ring-borderless",
            name: "Sol Ring",
            setCode: "SPG",
            setName: "Special Guests",
            rarity: "Mythic",
            collectorNumber: "38",
            provenance: {
              source: "scryfall",
              sourceId: "sol-ring-borderless"
            },
            legalityPeriods: [
              {
                format: "Commander",
                legal: true
              }
            ]
          }
        }
      })
    });
    const updatedCard = await updateCardResponse.json();

    expect(updateCardResponse.status).toBe(200);
    expect(updatedCard.externalId).toBe("sol-ring-borderless");
    expect(updatedCard.collectorNumber).toBe("38");
    expect(updatedCard.provenance.sourceId).toBe("sol-ring-borderless");
    expect(updatedCard.quantity).toBe(2);
    expect(updatedCard.copies).toHaveLength(2);
    expect(updatedCard.copies[0]).toMatchObject({
      finishCode: "galaxy",
      finishLabel: "Galaxy Foil"
    });
    expect(updatedCard.copies[0].stamp).toBeUndefined();
    expect(updatedCard.copies[1].finishCode).toBe("galaxy");

    const imageForm = new FormData();
    imageForm.append("images", new Blob(["test-image"], { type: "image/jpeg" }), "proof.jpg");
    const uploadImageResponse = await t.fetch(
      `/collections/${createdBinder.id}/cards/${updatedCard.copies[0].id}/images`,
      {
        method: "POST",
        headers: {
          Authorization: headers.Authorization,
          "x-tcger-bridge-key": headers["x-tcger-bridge-key"],
          "x-tcger-user-id": headers["x-tcger-user-id"],
          "x-tcger-user-email": headers["x-tcger-user-email"],
          "x-tcger-username": headers["x-tcger-username"]
        },
        body: imageForm
      }
    );
    const uploadedImages = await uploadImageResponse.json();

    expect(uploadImageResponse.status).toBe(201);
    expect(uploadedImages.imageUrls).toHaveLength(1);

    const exportJsonResponse = await t.fetch("/collections/export?format=json", {
      headers
    });
    const exportJson = await exportJsonResponse.json();

    expect(exportJsonResponse.status).toBe(200);
    expect(exportJson).toHaveLength(2);
    expect(exportJson[0].externalId).toBe("sol-ring-borderless");
    expect(exportJson[0]).toMatchObject({
      collectorNumber: "38",
      finishCode: "galaxy",
      finishLabel: "Galaxy Foil",
      provenance: {
        source: "scryfall",
        sourceId: "sol-ring-borderless"
      }
    });

    const exportCsvResponse = await t.fetch("/collections/export?format=csv", {
      headers
    });
    const exportCsv = await exportCsvResponse.text();

    expect(exportCsvResponse.status).toBe(200);
    expect(exportCsv).toContain("sol-ring-borderless");

    const removeImageResponse = await t.fetch(
      `/collections/${createdBinder.id}/cards/${updatedCard.copies[0].id}/images/0`,
      {
        method: "DELETE",
        headers
      }
    );

    expect(removeImageResponse.status).toBe(204);

    const binderDetailResponse = await t.fetch(`/collections/${createdBinder.id}`, {
      headers
    });
    const binderDetail = await binderDetailResponse.json();

    expect(binderDetailResponse.status).toBe(200);
    expect(binderDetail.cards[0].copies).toHaveLength(2);
    expect(binderDetail.cards[0].copies[0].imageUrls ?? []).toHaveLength(0);
  });

  test("mirrors wishlist REST routes over Convex HTTP actions", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
      "x-tcger-user-id": "user_avery",
      "x-tcger-user-email": "avery@example.com",
      "x-tcger-username": "avery"
    };

    const addOwnedCardResponse = await t.fetch("/collections/cards", {
      method: "POST",
      headers,
      body: JSON.stringify({
        quantity: 1,
        cardData: {
          tcg: "magic",
          externalId: "sol-ring",
          name: "Sol Ring",
          setCode: "CMM",
          setName: "Commander Masters"
        }
      })
    });
    expect(addOwnedCardResponse.status).toBe(201);

    const createWishlistResponse = await t.fetch("/wishlists", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Commander Wants",
        colorHex: "f59e0b"
      })
    });
    const createdWishlist = await createWishlistResponse.json();

    expect(createWishlistResponse.status).toBe(201);
    expect(createdWishlist).toMatchObject({
      name: "Commander Wants",
      totalCards: 0
    });

    const addWishlistCardResponse = await t.fetch(`/wishlists/${createdWishlist.id}/cards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        externalId: "sol-ring",
        tcg: "magic",
        name: "Sol Ring",
        setCode: "CMM",
        setName: "Commander Masters",
        baseExternalId: "sol-ring",
        printingKey: "magic:cmm:396:en",
        collectorNumber: "396",
        releasedAt: "2023-08-04",
        setSymbolUrl: "https://example.com/cmm.svg",
        provenance: {
          source: "scryfall",
          sourceId: "sol-ring"
        },
        functionalIdentity: {
          key: "sol-ring"
        }
      })
    });
    const wishlistCard = await addWishlistCardResponse.json();

    expect(addWishlistCardResponse.status).toBe(201);
    expect(wishlistCard).toMatchObject({
      externalId: "sol-ring",
      baseExternalId: "sol-ring",
      printingKey: "magic:cmm:396:en",
      collectorNumber: "396",
      releasedAt: "2023-08-04",
      provenance: {
        source: "scryfall",
        sourceId: "sol-ring"
      },
      owned: true,
      ownedQuantity: 1
    });

    const batchAddResponse = await t.fetch(`/wishlists/${createdWishlist.id}/cards/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        cards: [
          {
            externalId: "arcane-signet",
            tcg: "magic",
            name: "Arcane Signet",
            setCode: "CMM",
            setName: "Commander Masters"
          },
          {
            externalId: "sol-ring",
            tcg: "magic",
            name: "Sol Ring"
          }
        ]
      })
    });
    const updatedWishlist = await batchAddResponse.json();

    expect(batchAddResponse.status).toBe(201);
    expect(updatedWishlist).toMatchObject({
      totalCards: 2,
      ownedCards: 1,
      completionPercent: 50
    });

    const updateWishlistResponse = await t.fetch(`/wishlists/${createdWishlist.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        name: "Commander Staples"
      })
    });
    const renamedWishlist = await updateWishlistResponse.json();

    expect(updateWishlistResponse.status).toBe(200);
    expect(renamedWishlist.name).toBe("Commander Staples");

    const listWishlistsResponse = await t.fetch("/wishlists", { headers });
    const wishlists = await listWishlistsResponse.json();

    expect(listWishlistsResponse.status).toBe(200);
    expect(wishlists[0]).toMatchObject({
      name: "Commander Staples",
      totalCards: 2
    });
    expect(
      wishlists[0].cards.find((card: { externalId: string }) => card.externalId === "sol-ring")
    ).toMatchObject({
      printingKey: "magic:cmm:396:en",
      collectorNumber: "396",
      provenance: {
        source: "scryfall",
        sourceId: "sol-ring"
      }
    });

    const removeCardResponse = await t.fetch(
      `/wishlists/${createdWishlist.id}/cards/${wishlistCard.id}`,
      {
        method: "DELETE",
        headers
      }
    );

    expect(removeCardResponse.status).toBe(204);

    const createRuleResponse = await t.fetch(`/wishlists/${createdWishlist.id}/rules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "name",
        tcg: "magic",
        query: "Sol Ring",
        includeAllPrintings: true,
        autoSync: true
      })
    });
    const createdRule = await createRuleResponse.json();

    expect(createRuleResponse.status).toBe(201);
    expect(createdRule).toMatchObject({
      type: "name",
      tcg: "magic",
      query: "Sol Ring",
      includeAllPrintings: true,
      autoSync: true
    });

    // Re-posting the same rule refreshes it instead of creating a duplicate.
    const duplicateRuleResponse = await t.fetch(`/wishlists/${createdWishlist.id}/rules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "name",
        tcg: "magic",
        query: "Sol Ring",
        includeAllPrintings: false,
        autoSync: true
      })
    });
    const duplicateRule = await duplicateRuleResponse.json();

    expect(duplicateRule.id).toBe(createdRule.id);
    expect(duplicateRule.includeAllPrintings).toBe(false);

    const syncedAt = "2026-07-26T12:00:00.000Z";
    const patchRuleResponse = await t.fetch(
      `/wishlists/${createdWishlist.id}/rules/${createdRule.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ lastSyncedAt: syncedAt, lastMatchCount: 7 })
      }
    );
    const patchedRule = await patchRuleResponse.json();

    expect(patchRuleResponse.status).toBe(200);
    expect(patchedRule).toMatchObject({ lastSyncedAt: syncedAt, lastMatchCount: 7 });

    const wishlistWithRules = await (
      await t.fetch(`/wishlists/${createdWishlist.id}`, { headers })
    ).json();
    expect(wishlistWithRules.rules).toHaveLength(1);
    expect(wishlistWithRules.rules[0].id).toBe(createdRule.id);

    const removeRuleResponse = await t.fetch(
      `/wishlists/${createdWishlist.id}/rules/${createdRule.id}`,
      {
        method: "DELETE",
        headers
      }
    );

    expect(removeRuleResponse.status).toBe(204);
    expect(
      (await (await t.fetch(`/wishlists/${createdWishlist.id}`, { headers })).json()).rules
    ).toEqual([]);

    const deleteWishlistResponse = await t.fetch(`/wishlists/${createdWishlist.id}`, {
      method: "DELETE",
      headers
    });

    expect(deleteWishlistResponse.status).toBe(204);
  });

  test("mirrors setup, settings, and user REST routes over Convex HTTP actions", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
      "x-tcger-user-id": "user_admin",
      "x-tcger-user-email": "admin@example.com",
      "x-tcger-username": "admin"
    };

    const setupRequiredResponse = await t.fetch("/setup/setup-required", { headers });
    expect(await setupRequiredResponse.json()).toEqual({ setupRequired: true });

    const setupResponse = await t.fetch("/setup/setup", {
      method: "POST",
      headers
    });
    expect(setupResponse.status).toBe(200);

    const profileResponse = await t.fetch("/users/me", { headers });
    const profile = await profileResponse.json();

    expect(profileResponse.status).toBe(200);
    expect(profile).toMatchObject({
      id: "user_admin",
      email: "admin@example.com",
      username: "admin",
      isAdmin: true
    });

    for (const [field, defaultGame] of [
      ["enabledOnepiece", "onepiece"],
      ["enabledLorcana", "lorcana"],
      ["enabledDragonball", "dragonball"]
    ] as const) {
      const preferencesUpdateResponse = await t.fetch("/users/me/preferences", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          showPricing: false,
          [field]: true,
          defaultGame
        })
      });
      expect(preferencesUpdateResponse.status).toBe(200);
      expect(await preferencesUpdateResponse.json()).toMatchObject({
        showPricing: false,
        [field]: true,
        defaultGame
      });
    }

    const invalidDefaultResponse = await t.fetch("/users/me/preferences", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ defaultGame: "unsupported-game" })
    });
    expect(invalidDefaultResponse.status).toBe(400);

    const settingsUpdateResponse = await t.fetch("/settings", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        publicCollections: true,
        appName: "Convex TCGer",
        scrydexApiKey: "secret-key"
      })
    });
    const adminSettings = await settingsUpdateResponse.json();

    expect(settingsUpdateResponse.status).toBe(200);
    expect(adminSettings).toMatchObject({
      appName: "Convex TCGer",
      publicCollections: true,
      scrydexApiKey: "secret-key"
    });

    const publicSettingsResponse = await t.fetch("/settings", {
      headers: { "x-tcger-bridge-key": TEST_BRIDGE_SECRET }
    });
    const publicSettings = await publicSettingsResponse.json();

    expect(publicSettingsResponse.status).toBe(200);
    expect(publicSettings).toMatchObject({
      appName: "Convex TCGer",
      publicCollections: true
    });
    expect(publicSettings).not.toHaveProperty("scrydexApiKey");

    const profileUpdateResponse = await t.fetch("/users/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        email: "owner@example.com",
        username: "owner"
      })
    });
    expect(profileUpdateResponse.status).toBe(200);

    const refreshedHeaders = {
      ...headers,
      "x-tcger-user-email": "owner@example.com",
      "x-tcger-username": "owner"
    };

    const refreshedProfileResponse = await t.fetch("/users/me", {
      headers: refreshedHeaders
    });
    const refreshedProfile = await refreshedProfileResponse.json();

    expect(refreshedProfileResponse.status).toBe(200);
    expect(refreshedProfile).toMatchObject({
      email: "owner@example.com",
      username: "owner",
      isAdmin: true
    });

    const sourceDefaultsResponse = await t.fetch("/settings/source-defaults", {
      headers: refreshedHeaders
    });
    expect(sourceDefaultsResponse.status).toBe(200);
    expect(await sourceDefaultsResponse.json()).toHaveProperty("scryfall");
  });
});

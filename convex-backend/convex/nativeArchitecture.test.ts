import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { createTestConvex } from "./test.setup";

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
    expect(binders).toHaveLength(1);
    expect(binders[0]).toMatchObject({
      kind: "library",
      name: "Library"
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
      colorHex: "22c55e"
    });

    const averyBinders = await asAvery.query(api.binders.list);
    const jordanBinders = await asJordan.query(api.binders.list);

    expect(averyBinders.map((binder) => binder.name)).toEqual(["Library", "Trade Binder"]);
    expect(jordanBinders.map((binder) => binder.name)).toEqual(["Library"]);
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
    expect(entry.quantity).toBe(2);
    expect(entry.tags.map((tag) => tag.label).sort()).toEqual(["For Trade", "Staple"]);
    expect(detail.entryCount).toBe(1);
    expect(detail.entries[0].card.externalId).toBe("smothering-tithe");
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

  test("serves a native health endpoint through Convex HTTP actions", async () => {
    const t = createTestConvex();
    const response = await t.fetch("/health");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "ok",
      backend: "convex-native"
    });
  });

  test("mirrors collection REST routes over Convex HTTP actions", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-user-id": "user_avery",
      "x-tcger-user-email": "avery@example.com",
      "x-tcger-username": "avery"
    };

    const createBinderResponse = await t.fetch("/collections", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "HTTP Binder",
        colorHex: "22c55e"
      })
    });
    const createdBinder = await createBinderResponse.json();

    expect(createBinderResponse.status).toBe(201);
    expect(createdBinder.name).toBe("HTTP Binder");
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
          setName: "Commander Masters"
        }
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
    expect(addedCard.copies[0].id).toBeTruthy();
    expect(binders[0].id).toBe("__library__");
    expect(binders[1].cards[0].copies[0].id).toBe(addedCard.copies[0].id);

    const updateCardResponse = await t.fetch(`/collections/${createdBinder.id}/cards/${addedCard.copies[0].id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        quantity: 2,
        notes: "Promoted to foil slot",
        cardOverride: {
          cardId: "sol-ring-borderless",
          cardData: {
            tcg: "magic",
            externalId: "sol-ring-borderless",
            name: "Sol Ring",
            setCode: "SPG",
            setName: "Special Guests",
            rarity: "Mythic"
          }
        }
      })
    });
    const updatedCard = await updateCardResponse.json();

    expect(updateCardResponse.status).toBe(200);
    expect(updatedCard.externalId).toBe("sol-ring-borderless");
    expect(updatedCard.quantity).toBe(2);
    expect(updatedCard.copies).toHaveLength(2);

    const imageForm = new FormData();
    imageForm.append("images", new Blob(["test-image"], { type: "image/jpeg" }), "proof.jpg");
    const uploadImageResponse = await t.fetch(
      `/collections/${createdBinder.id}/cards/${updatedCard.copies[0].id}/images`,
      {
        method: "POST",
        headers: {
          Authorization: headers.Authorization,
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
        setName: "Commander Masters"
      })
    });
    const wishlistCard = await addWishlistCardResponse.json();

    expect(addWishlistCardResponse.status).toBe(201);
    expect(wishlistCard).toMatchObject({
      externalId: "sol-ring",
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

    const removeCardResponse = await t.fetch(
      `/wishlists/${createdWishlist.id}/cards/${wishlistCard.id}`,
      {
        method: "DELETE",
        headers
      }
    );

    expect(removeCardResponse.status).toBe(204);

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
      "x-tcger-user-id": "user_admin",
      "x-tcger-user-email": "admin@example.com",
      "x-tcger-username": "admin"
    };

    const setupRequiredResponse = await t.fetch("/setup/setup-required");
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

    const preferencesUpdateResponse = await t.fetch("/users/me/preferences", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        showPricing: false,
        defaultGame: "magic"
      })
    });
    expect(preferencesUpdateResponse.status).toBe(200);
    expect(await preferencesUpdateResponse.json()).toMatchObject({
      showPricing: false,
      defaultGame: "magic"
    });

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

    const publicSettingsResponse = await t.fetch("/settings");
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

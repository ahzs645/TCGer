import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { useAuthStore, type AuthUser } from "./auth";
import { useModuleStore } from "./preferences";

const user: AuthUser = {
  id: "auth-update-test",
  email: "auth-update@example.test",
  username: "test",
  isAdmin: false,
  showCardNumbers: true,
  showPricing: true,
  enabledYugioh: true,
  enabledMagic: true,
  enabledPokemon: true,
  enabledOnepiece: false,
  enabledLorcana: false,
  enabledDragonball: false,
};

beforeEach(() => {
  // Node has no browser storage; this suite checks live store behavior.
  mock.method(console, "warn", () => undefined);
  useAuthStore.getState().clearAuth();
  useAuthStore.getState().setAuth(user, "test-session");
});

afterEach(() => mock.restoreAll());

test("repeated unchanged auth synchronization preserves snapshots without notifying UI subscribers", () => {
  const auth = useAuthStore.getState();
  const modules = useModuleStore.getState();
  let authUpdates = 0;
  let moduleUpdates = 0;
  const stopAuth = useAuthStore.subscribe(() => authUpdates++);
  const stopModules = useModuleStore.subscribe(() => moduleUpdates++);
  try {
    for (let i = 0; i < 10; i++) {
      useAuthStore.getState().setAuth({ ...user }, "test-session");
    }
    assert.equal(authUpdates, 0);
    assert.equal(moduleUpdates, 0);
    assert.equal(useAuthStore.getState(), auth);
    assert.equal(useModuleStore.getState(), modules);
  } finally {
    stopAuth();
    stopModules();
  }
});

test("credential rotation still publishes the new session even when the user is unchanged", () => {
  useAuthStore.getState().setAuth({ ...user }, "rotated-test-session");
  assert.equal(useAuthStore.getState().token, "rotated-test-session");
});

test("changed account preferences publish their new values while preserving unrelated game settings", () => {
  const previousGames = useModuleStore.getState().enabledGames;
  useAuthStore
    .getState()
    .updateStoredPreferences({ enabledPokemon: false, showPricing: false });
  assert.equal(useAuthStore.getState().user?.enabledPokemon, false);
  assert.equal(useModuleStore.getState().enabledGames.pokemon, false);
  assert.equal(useModuleStore.getState().showPricing, false);
  assert.equal(
    useModuleStore.getState().enabledGames.magic,
    previousGames.magic,
  );
  const afterChange = useModuleStore.getState();
  useModuleStore.getState().setGameEnabled("pokemon", false);
  useModuleStore.getState().setShowPricing(false);
  assert.equal(useModuleStore.getState(), afterChange);
});

test("logout clears authentication and restores default display preferences", () => {
  useAuthStore
    .getState()
    .updateStoredPreferences({ showPricing: false, enabledPokemon: false });
  useAuthStore.getState().clearAuth();
  assert.equal(useAuthStore.getState().user, null);
  assert.equal(useAuthStore.getState().token, null);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useModuleStore.getState().showPricing, true);
  assert.equal(useModuleStore.getState().enabledGames.pokemon, true);
});

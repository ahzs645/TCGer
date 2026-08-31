"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Globe,
  Key,
  Loader2,
  Moon,
  PackagePlus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Store,
  User as UserIcon,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAdminSettings,
  getSourceDefaults,
  testSource,
  updateSettings,
  type AdminAppSettings,
  type SourceDefaults,
  type SourceKey,
  type TestSourceResult,
} from "@/lib/api/settings";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/lib/api/user-preferences";
import { isDemoMode } from "@/lib/demo-mode";
import { getPriceSources } from "@/lib/api/pricing";
import type { PriceSourceOption } from "@tcg/api-types";
import { requestCatalogPrompt } from "@/lib/catalog/use-catalog";
import {
  DEMO_TRANSACTIONS_STORAGE_KEY,
  SMART_FOLDER_STORAGE_KEY_PREFIX,
} from "@/lib/storage/keys";
import { gamePresentation } from "@/lib/games";
import {
  readScannerOcrEnabled,
  subscribeScannerOcrEnabled,
  writeScannerOcrEnabled,
} from "@/lib/scan/scanner-options";
import { ENABLED_PREFERENCE_KEY, GAME_LABELS } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useDemoStore } from "@/stores/demo-store";
import { useModuleStore, type ManageableGame } from "@/stores/preferences";
import { useTheme } from "next-themes";
import { GameStorePanel } from "./catalog-management-panel";
import { InstallGamePackagePanel } from "./community-game-libraries-panel";
import { CatalogMaintenancePanel } from "./catalog-maintenance-panel";

import { useShallow } from "zustand/react/shallow";
interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GameLibrarySettingsPage = "root" | "store" | "install-url";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

export function AccountSettingsDialog({
  open,
  onOpenChange,
}: AccountSettingsDialogProps) {
  const {
    enabledGames,
    toggleGame,
    showCardNumbers,
    setShowCardNumbers,
    showPricing,
    setShowPricing,
    priceSource,
    hydratePriceSource,
    setPriceSource,
  } = useModuleStore(
    useShallow((state) => ({
      enabledGames: state.enabledGames,
      toggleGame: state.toggleGame,
      showCardNumbers: state.showCardNumbers,
      setShowCardNumbers: state.setShowCardNumbers,
      showPricing: state.showPricing,
      setShowPricing: state.setShowPricing,
      priceSource: state.priceSource,
      hydratePriceSource: state.hydratePriceSource,
      setPriceSource: state.setPriceSource,
    })),
  );

  const { theme, setTheme } = useTheme();

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const updateStoredPreferences = useAuthStore(
    (state) => state.updateStoredPreferences,
  );
  const resetDemo = useDemoStore((state) => state.resetDemo);
  const [confirm, confirmDialog] = useConfirm();
  const [appSettings, setAppSettings] = useState<AdminAppSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [sourceDefaults, setSourceDefaults] = useState<SourceDefaults | null>(
    null,
  );
  const [priceSources, setPriceSources] = useState<PriceSourceOption[]>([]);
  const [testResults, setTestResults] = useState<
    Record<string, TestSourceResult | "loading">
  >({});
  const [updatingPreference, setUpdatingPreference] = useState<
    "showCardNumbers" | "showPricing" | null
  >(null);
  const [updatingGame, setUpdatingGame] = useState<ManageableGame | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [demoResetMessage, setDemoResetMessage] = useState<string | null>(null);
  const [gameLibraryPage, setGameLibraryPage] =
    useState<GameLibrarySettingsPage>("root");
  const scannerOcrEnabled = useSyncExternalStore(
    subscribeScannerOcrEnabled,
    readScannerOcrEnabled,
    () => true,
  );

  const activeCount = useMemo(
    () => Object.values(enabledGames).filter(Boolean).length,
    [enabledGames],
  );
  const isAdmin = user?.isAdmin ?? false;

  const loadAdminSettings = useCallback(async () => {
    if (!isAdmin || !token) return;
    setLoadingSettings(true);
    setSettingsError(null);
    try {
      const [settings, defaults] = await Promise.all([
        getAdminSettings(token),
        getSourceDefaults(token),
      ]);
      setAppSettings(settings);
      setSourceDefaults(defaults);
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed to load admin settings.",
      );
    } finally {
      setLoadingSettings(false);
    }
  }, [isAdmin, token]);

  const loadPreferences = useCallback(async () => {
    if (!token) return;
    setLoadingPreferences(true);
    setPreferencesError(null);
    try {
      const preferences = await getUserPreferences(token);
      updateStoredPreferences(preferences);
    } catch (error) {
      setPreferencesError(
        error instanceof Error ? error.message : "Failed to load preferences.",
      );
    } finally {
      setLoadingPreferences(false);
    }
  }, [token, updateStoredPreferences]);

  const loadPriceSources = useCallback(async () => {
    if (!token) return;
    try {
      const catalog = await getPriceSources(token);
      setPriceSources(catalog.sources);
      if (!catalog.sources.some((source) => source.id === priceSource)) {
        setPriceSource(catalog.defaultSource);
      }
    } catch (error) {
      setPreferencesError(
        error instanceof Error
          ? error.message
          : "Failed to load price sources.",
      );
    }
  }, [priceSource, setPriceSource, token]);

  useEffect(() => {
    if (!open) return;
    hydratePriceSource();
    void loadAdminSettings();
    void loadPreferences();
    void loadPriceSources();
  }, [
    hydratePriceSource,
    loadAdminSettings,
    loadPreferences,
    loadPriceSources,
    open,
  ]);

  const handleSettingChange = async (
    key: string,
    value: boolean | string | null,
  ) => {
    if (!token || !appSettings) return;

    const updatedSettings = { ...appSettings, [key]: value };
    setAppSettings(updatedSettings);
    setSaveError(null);

    try {
      await updateSettings({ [key]: value } as never, token);
    } catch (error) {
      setAppSettings(appSettings);
      setSaveError(
        error instanceof Error ? error.message : "Failed to update settings.",
      );
    }
  };

  const handleTestSource = async (source: SourceKey) => {
    if (!token) return;
    setTestResults((prev) => ({ ...prev, [source]: "loading" }));
    try {
      const result = await testSource(source, token);
      setTestResults((prev) => ({ ...prev, [source]: result }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [source]: { ok: false, latencyMs: 0, error: "Request failed" },
      }));
    }
  };

  const handleTestAll = async () => {
    if (!token) return;
    const sources: SourceKey[] = ["scryfall", "yugioh", "pokemon", "tcgdex"];
    sources.forEach((s) =>
      setTestResults((prev) => ({ ...prev, [s]: "loading" })),
    );
    await Promise.allSettled(sources.map((s) => handleTestSource(s)));
  };

  const handlePreferenceToggle = async (
    preference: "showCardNumbers" | "showPricing",
    value: boolean,
  ) => {
    if (!token) return;

    const previousValue =
      preference === "showCardNumbers" ? showCardNumbers : showPricing;
    if (previousValue === value) return;

    setUpdatingPreference(preference);
    setSaveError(null);

    if (preference === "showCardNumbers") {
      setShowCardNumbers(value);
    } else {
      setShowPricing(value);
    }

    try {
      await updateUserPreferences({ [preference]: value }, token);
      updateStoredPreferences({ [preference]: value });
    } catch (error) {
      if (preference === "showCardNumbers") {
        setShowCardNumbers(previousValue);
      } else {
        setShowPricing(previousValue);
      }
      setSaveError(
        error instanceof Error ? error.message : "Failed to save preference.",
      );
    } finally {
      setUpdatingPreference(null);
    }
  };

  const handleGameToggle = async (game: ManageableGame) => {
    const previousValue = enabledGames[game];
    const newValue = !previousValue;

    if (!token) {
      toggleGame(game);
      if (newValue && isDemoMode()) requestCatalogPrompt(game);
      return;
    }

    setUpdatingGame(game);
    setSaveError(null);
    toggleGame(game);

    const preferencePayload = {
      [ENABLED_PREFERENCE_KEY[game]]: newValue,
    };

    try {
      await updateUserPreferences(preferencePayload, token);
      updateStoredPreferences(preferencePayload);
      if (newValue && isDemoMode()) requestCatalogPrompt(game);
    } catch (error) {
      toggleGame(game);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Failed to update game modules.",
      );
    } finally {
      setUpdatingGame(null);
    }
  };

  const handleResetDemo = async () => {
    const confirmed = await confirm({
      title: "Reset all demo data?",
      description:
        "This removes your demo collection changes, smart folders, transactions, decks, trades, and preferences, then restores the sample fixtures.",
      confirmLabel: "Reset demo data",
      destructive: true,
    });
    if (!confirmed) return;

    setResettingDemo(true);
    setDemoResetMessage(null);
    try {
      resetDemo();
      localStorage.removeItem(DEMO_TRANSACTIONS_STORAGE_KEY);
      localStorage.removeItem(
        `${SMART_FOLDER_STORAGE_KEY_PREFIX}${user?.id ?? "demo-user-001"}`,
      );
      setDemoResetMessage("Demo data restored. Reloading the sample app…");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      setDemoResetMessage(
        error instanceof Error ? error.message : "Failed to reset demo data.",
      );
      setResettingDemo(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setGameLibraryPage("root");
          onOpenChange(nextOpen);
        }}
        data-oid="he1m9xo"
      >
        <DialogContent
          className="max-w-3xl sm:max-w-4xl max-h-[85vh] overflow-y-auto"
          data-oid="md5o42-"
        >
          <DialogHeader data-oid="g8vq-to">
            <DialogTitle data-oid="o4pwzt0">
              {gameLibraryPage === "store"
                ? "Game Store"
                : gameLibraryPage === "install-url"
                  ? "Install from URL"
                  : "Account & Preferences"}
            </DialogTitle>
            <DialogDescription data-oid="itfte52">
              {gameLibraryPage === "root"
                ? "Configure your profile, notifications, and which TCG modules are active."
                : "Manage downloadable game packages without leaving settings."}
            </DialogDescription>
          </DialogHeader>

          {gameLibraryPage === "root" ? (
            <>
              {(preferencesError || saveError || settingsError) && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <p>{saveError ?? preferencesError ?? settingsError}</p>
                  {!saveError && (preferencesError || settingsError) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (preferencesError) void loadPreferences();
                        if (settingsError) void loadAdminSettings();
                      }}
                    >
                      Try again
                    </Button>
                  )}
                </div>
              )}

              <section className="space-y-4" data-oid="q24fta7">
                <div
                  className="flex items-start justify-between rounded-lg border bg-muted/40 p-4"
                  data-oid="tj1e7-0"
                >
                  <div data-oid="boxwtbv">
                    <h3
                      className="flex items-center gap-2 text-sm font-semibold"
                      data-oid="bsbgx:7"
                    >
                      <UserIcon className="h-4 w-4" data-oid="i-shaju" />{" "}
                      Account Details
                    </h3>
                    <p
                      className="mt-1 text-sm text-muted-foreground"
                      data-oid="-g9vyf6"
                    >
                      Manage how you appear across web and mobile clients.
                    </p>
                  </div>
                  <div
                    className="text-right text-sm text-muted-foreground"
                    data-oid="2gzn_9r"
                  >
                    <p
                      className="font-medium text-foreground"
                      data-oid="kuaqydj"
                    >
                      {user?.username || "User"}
                    </p>
                    <p data-oid="mc8d-y9">{user?.email}</p>
                  </div>
                </div>

                <div className="grid gap-4" data-oid="kdvyjyg">
                  <PreferenceCard
                    title="Appearance"
                    description={
                      theme === "system"
                        ? "Following your device setting."
                        : `Always ${theme === "dark" ? "dark" : "light"}.`
                    }
                    icon={<Moon className="h-4 w-4" data-oid=".jeuphl" />}
                    action={
                      <div
                        className="flex items-center gap-1"
                        role="group"
                        aria-label="Colour theme"
                      >
                        {THEME_OPTIONS.map((option) => (
                          <Button
                            key={option.value}
                            size="sm"
                            variant={
                              theme === option.value ? "secondary" : "ghost"
                            }
                            aria-pressed={theme === option.value}
                            onClick={() => setTheme(option.value)}
                            className="px-2.5"
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    }
                    data-oid="jnse5ex"
                  />

                  {/* The notifications card sat here with a dead "Configure" button;
                there is no notifications feature to configure, so it is gone
                rather than faked. Card-number and pricing toggles already have
                real controls in the Display preferences section below. */}
                </div>
              </section>

              <Separator data-oid="ijdm9wi" />

              <section className="space-y-4" data-oid="-gg3d2v">
                <div
                  className="flex items-center justify-between"
                  data-oid="qv_q2p0"
                >
                  <div data-oid="_ac96b6">
                    <h3 className="text-sm font-semibold" data-oid="g76snc5">
                      TCG Modules
                    </h3>
                    <p
                      className="text-sm text-muted-foreground"
                      data-oid="a1rhplz"
                    >
                      Toggle which adapters are active in your dashboards and
                      search. ({activeCount}/6 enabled)
                    </p>
                  </div>
                  <ShieldCheck
                    className="h-5 w-5 text-muted-foreground"
                    data-oid="0hrgrht"
                  />
                </div>

                <div className="grid gap-3" data-oid="s:rre0n">
                  {(
                    Object.entries(enabledGames) as Array<
                      [ManageableGame, boolean]
                    >
                  ).map(([game, enabled]) => {
                    const { icon } = gamePresentation(game);
                    return (
                      <div
                        key={game}
                        className="flex items-center justify-between rounded-lg border bg-background p-3"
                        data-oid="b-4_i5t"
                      >
                        <div
                          className="flex items-center gap-3"
                          data-oid="4imfp9c"
                        >
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-md bg-muted"
                            data-oid="0qhu8yu"
                          >
                            {icon ? (
                              <Image
                                src={icon}
                                alt={GAME_LABELS[game]}
                                width={16}
                                height={16}
                                className="dark:invert"
                                data-oid="swmrv_o"
                              />
                            ) : null}
                          </span>
                          <div data-oid="eva596k">
                            <p
                              className="text-sm font-medium"
                              data-oid="8g2aev:"
                            >
                              {GAME_LABELS[game]}
                            </p>
                            <p
                              className="text-xs text-muted-foreground"
                              data-oid="9ohefc8"
                            >
                              Include {GAME_LABELS[game]} in global search and
                              analytics.
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={enabled}
                          disabled={updatingGame === game}
                          onCheckedChange={() => handleGameToggle(game)}
                          aria-label={`Toggle ${GAME_LABELS[game]}`}
                          data-oid="3ja.f.:"
                        />
                      </div>
                    );
                  })}
                </div>
              </section>

              <Separator data-oid="9u8__q_" />

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Game Libraries</h3>
                  <p className="text-sm text-muted-foreground">
                    Download official packages or connect another
                    publisher&apos;s manifest.
                  </p>
                </div>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border bg-background p-4 text-left hover:bg-muted/40"
                  onClick={() => setGameLibraryPage("store")}
                >
                  <Store className="h-5 w-5 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      Game Store
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Official packages from the published catalog manifest.
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border bg-background p-4 text-left hover:bg-muted/40"
                  onClick={() => setGameLibraryPage("install-url")}
                >
                  <PackagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      Install from URL
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Connect a compatible package from another publisher.
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </section>

              <Separator />

              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Scanner Recognition</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure browser-side recognition on this device.
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                  <div>
                    <p className="text-sm font-medium">
                      Use OCR for Difficult Scans
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Read collector numbers when visual candidates are too
                      similar.
                    </p>
                  </div>
                  <Switch
                    checked={scannerOcrEnabled}
                    onCheckedChange={(enabled) => {
                      writeScannerOcrEnabled(enabled);
                    }}
                    aria-label="Toggle scanner OCR"
                  />
                </div>
              </section>

              <Separator />

              <section className="space-y-4" data-oid="inksgtk">
                <div data-oid="jheeyaf">
                  <h3 className="text-sm font-semibold" data-oid="43ls4ah">
                    Display Preferences
                  </h3>
                  <p
                    className="text-sm text-muted-foreground"
                    data-oid="::vyc4."
                  >
                    Customize how cards are displayed in search results.
                  </p>
                </div>

                <div
                  className="flex items-center justify-between rounded-lg border bg-background p-3"
                  data-oid="_nde-_j"
                >
                  <div data-oid="mqc1v7h">
                    <p className="text-sm font-medium" data-oid="5etesal">
                      Show Card Numbers
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      data-oid="g1y_8b-"
                    >
                      Display set codes (e.g., STAX-EN020, xy7) with card names.
                    </p>
                  </div>
                  <Switch
                    checked={showCardNumbers}
                    disabled={
                      !token ||
                      loadingPreferences ||
                      updatingPreference === "showCardNumbers"
                    }
                    onCheckedChange={(checked) =>
                      handlePreferenceToggle("showCardNumbers", checked)
                    }
                    aria-label="Toggle card numbers"
                    data-oid=":f_2sq5"
                  />
                </div>

                <div
                  className="flex items-center justify-between rounded-lg border bg-background p-3"
                  data-oid="hy7dq92"
                >
                  <div data-oid="vhsbvmg">
                    <p className="text-sm font-medium" data-oid="wtg9az6">
                      Show Pricing
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      data-oid="y.g-0.j"
                    >
                      Toggle pricing summaries and estimated values across the
                      dashboard and collection views.
                    </p>
                  </div>
                  <Switch
                    checked={showPricing}
                    disabled={
                      !token ||
                      loadingPreferences ||
                      updatingPreference === "showPricing"
                    }
                    onCheckedChange={(checked) =>
                      handlePreferenceToggle("showPricing", checked)
                    }
                    aria-label="Toggle pricing display"
                    data-oid="n.-r0nc"
                  />
                </div>

                {showPricing && priceSources.length > 0 && (
                  <div className="space-y-3 rounded-lg border bg-background p-3">
                    <div>
                      <p className="text-sm font-medium">Price Source</p>
                      <p className="text-xs text-muted-foreground">
                        Server-backed choices appear only when this server has
                        the required provider configured.
                      </p>
                    </div>
                    <Select
                      value={priceSource}
                      onValueChange={(value) =>
                        setPriceSource(
                          value as (typeof priceSources)[number]["id"],
                        )
                      }
                    >
                      <SelectTrigger aria-label="Price source">
                        <SelectValue placeholder="Choose a price source" />
                      </SelectTrigger>
                      <SelectContent>
                        {priceSources.map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {priceSources.find((source) => source.id === priceSource)
                        ?.description ?? "Uses the best compatible source."}
                    </p>
                  </div>
                )}
              </section>

              {isAdmin && (
                <>
                  <Separator data-oid="w20d534" />
                  <section className="space-y-4" data-oid="uui_o62">
                    <div data-oid="5-0won3">
                      <h3
                        className="flex items-center gap-2 text-sm font-semibold"
                        data-oid="yb__g42"
                      >
                        <Globe className="h-4 w-4" data-oid="0je_pt0" />
                        Admin Settings
                      </h3>
                      <p
                        className="text-sm text-muted-foreground"
                        data-oid="zhvcb6d"
                      >
                        Control public access and authentication requirements.
                      </p>
                    </div>

                    {loadingSettings ? (
                      <div
                        className="flex justify-center p-4"
                        role="status"
                        aria-label="Loading admin settings"
                        data-oid="7174euq"
                      >
                        <div
                          className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
                          aria-hidden="true"
                          data-oid="z4.pbhj"
                        />
                      </div>
                    ) : appSettings ? (
                      <>
                        <div
                          className="flex items-center justify-between rounded-lg border bg-background p-3"
                          data-oid="h1spui5"
                        >
                          <div data-oid="xom22hq">
                            <p
                              className="text-sm font-medium"
                              data-oid="50xgqoi"
                            >
                              Public Dashboard
                            </p>
                            <p
                              className="text-xs text-muted-foreground"
                              data-oid="0uq-80t"
                            >
                              Allow dashboard to be viewed without
                              authentication.
                            </p>
                          </div>
                          <Switch
                            checked={appSettings.publicDashboard}
                            onCheckedChange={(checked) =>
                              handleSettingChange("publicDashboard", checked)
                            }
                            aria-label="Toggle public dashboard"
                            data-oid="ph-s45p"
                          />
                        </div>

                        <div
                          className="flex items-center justify-between rounded-lg border bg-background p-3"
                          data-oid="8gmu-ar"
                        >
                          <div data-oid="9ahaicq">
                            <p
                              className="text-sm font-medium"
                              data-oid="nff_g9b"
                            >
                              Public Collections
                            </p>
                            <p
                              className="text-xs text-muted-foreground"
                              data-oid="pprcr76"
                            >
                              Allow collections to be viewed without
                              authentication.
                            </p>
                          </div>
                          <Switch
                            checked={appSettings.publicCollections}
                            onCheckedChange={(checked) =>
                              handleSettingChange("publicCollections", checked)
                            }
                            aria-label="Toggle public collections"
                            data-oid="6fpajhe"
                          />
                        </div>

                        <div
                          className="flex items-center justify-between rounded-lg border bg-background p-3"
                          data-oid="v.zuye9"
                        >
                          <div data-oid="rwks9y9">
                            <p
                              className="text-sm font-medium"
                              data-oid="ce4jkqm"
                            >
                              Require Authentication
                            </p>
                            <p
                              className="text-xs text-muted-foreground"
                              data-oid="mf.r3gl"
                            >
                              Require login for all features. When disabled,
                              search remains authenticated-only.
                            </p>
                          </div>
                          <Switch
                            checked={appSettings.requireAuth}
                            onCheckedChange={(checked) =>
                              handleSettingChange("requireAuth", checked)
                            }
                            aria-label="Toggle require authentication"
                            data-oid="bqbhg85"
                          />
                        </div>
                      </>
                    ) : null}
                  </section>

                  <Separator data-oid="-zfch3i" />

                  <section className="space-y-4" data-oid=":82_.e:">
                    <div
                      className="flex items-center justify-between"
                      data-oid="w.18vbl"
                    >
                      <div data-oid="x.3-7ml">
                        <h3
                          className="flex items-center gap-2 text-sm font-semibold"
                          data-oid="n_2h4w-"
                        >
                          <Activity className="h-4 w-4" data-oid="as1yhr0" />
                          Data Sources
                        </h3>
                        <p
                          className="text-sm text-muted-foreground"
                          data-oid="e0qt6j_"
                        >
                          External APIs that power card search and pricing. Test
                          connectivity or override URLs.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestAll}
                        disabled={loadingSettings}
                        data-oid="paqr3ru"
                      >
                        Test All
                      </Button>
                    </div>

                    {loadingSettings ? (
                      <div
                        className="flex justify-center p-4"
                        role="status"
                        aria-label="Loading source settings"
                        data-oid="yw-aik9"
                      >
                        <div
                          className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
                          aria-hidden="true"
                          data-oid="6xv_fno"
                        />
                      </div>
                    ) : sourceDefaults ? (
                      <div className="space-y-3" data-oid="9c-ywnl">
                        {(
                          Object.entries(sourceDefaults).filter(([key]) =>
                            isSourceKey(key),
                          ) as Array<
                            [SourceKey, { url: string; label: string }]
                          >
                        ).map(([key, source]) => {
                          const result = testResults[key];
                          const overrideKey =
                            key === "scryfall"
                              ? "scryfallApiBaseUrl"
                              : key === "yugioh"
                                ? "ygoApiBaseUrl"
                                : key === "pokemon"
                                  ? "scrydexApiBaseUrl"
                                  : "tcgdexApiBaseUrl";
                          const overrideUrl = appSettings?.[
                            overrideKey as keyof AdminAppSettings
                          ] as string | null;
                          const activeUrl = overrideUrl || source.url;
                          const local = isLocalCache(activeUrl);
                          const note = local
                            ? SOURCE_NOTES[key].local
                            : SOURCE_NOTES[key].remote;
                          const authType =
                            local && key === "pokemon"
                              ? ("none" as const)
                              : SOURCE_AUTH[key];

                          return (
                            <DataSourceCard
                              key={key}
                              sourceKey={key}
                              label={source.label}
                              defaultUrl={source.url}
                              activeUrl={activeUrl}
                              overrideUrl={overrideUrl}
                              testResult={result}
                              onTest={() => handleTestSource(key)}
                              onOverride={(url) =>
                                handleSettingChange(overrideKey, url || null)
                              }
                              authType={authType}
                              note={note}
                              scrydexApiKey={
                                key === "pokemon"
                                  ? appSettings?.scrydexApiKey
                                  : undefined
                              }
                              scrydexTeamId={
                                key === "pokemon"
                                  ? appSettings?.scrydexTeamId
                                  : undefined
                              }
                              onScrydexKeyChange={
                                key === "pokemon"
                                  ? (v) =>
                                      handleSettingChange(
                                        "scrydexApiKey",
                                        v || null,
                                      )
                                  : undefined
                              }
                              onScrydexTeamIdChange={
                                key === "pokemon"
                                  ? (v) =>
                                      handleSettingChange(
                                        "scrydexTeamId",
                                        v || null,
                                      )
                                  : undefined
                              }
                              data-oid="__:ic:q"
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </section>

                  {token && !isDemoMode() && (
                    <>
                      <Separator />
                      <CatalogMaintenancePanel token={token} />
                    </>
                  )}
                </>
              )}

              {isDemoMode() && (
                <>
                  <Separator />
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                      <div>
                        <h3 className="text-sm font-semibold">Demo Data</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Restore every demo feature to its original sample
                          data.
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => void handleResetDemo()}
                        disabled={resettingDemo}
                      >
                        {resettingDemo ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        {resettingDemo ? "Resetting…" : "Reset demo data"}
                      </Button>
                    </div>
                    {demoResetMessage && (
                      <p
                        className="text-sm text-muted-foreground"
                        role="status"
                      >
                        {demoResetMessage}
                      </p>
                    )}
                  </section>
                </>
              )}
            </>
          ) : (
            <section className="space-y-5">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2"
                onClick={() => setGameLibraryPage("root")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to settings
              </Button>
              {gameLibraryPage === "store" ? (
                <GameStorePanel />
              ) : (
                <InstallGamePackagePanel />
              )}
            </section>
          )}

          <DialogFooter
            className="justify-between sm:justify-between"
            data-oid="mbyehjf"
          >
            <p className="text-xs text-muted-foreground" data-oid="-m2s9bd">
              Changes sync automatically. Mobile apps will respect the same
              module preferences.
            </p>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              data-oid="5m6bpcp"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}

function isLocalCache(url: string) {
  return /localhost|:\d{4}|-bulk|-cache/i.test(url);
}

function isSourceKey(value: string): value is SourceKey {
  return Object.prototype.hasOwnProperty.call(SOURCE_NOTES, value);
}

const SOURCE_NOTES: Record<SourceKey, { remote: string; local: string }> = {
  scryfall: {
    remote: "Free, no key needed. Rate limit: ~10 req/s.",
    local: "Local Scryfall bulk cache. No rate limits.",
  },
  yugioh: {
    remote: "Free, no key needed. Rate limit: 20 req/s.",
    local: "Local YGO cache. No rate limits.",
  },
  pokemon: {
    remote: "Requires Scrydex API key and team ID.",
    local: "Local Pokémon cache. Requires bulk profile running.",
  },
  tcgdex: {
    remote: "Free, no key needed. Used for variant enrichment.",
    local: "Local TCGdex cache. Used for variant enrichment.",
  },
};

const SOURCE_AUTH: Record<SourceKey, "none" | "api-key"> = {
  scryfall: "none",
  yugioh: "none",
  pokemon: "api-key",
  tcgdex: "none",
};

interface PreferenceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  action: React.ReactNode;
}

function DataSourceCard({
  label,
  defaultUrl,
  activeUrl,
  overrideUrl,
  testResult,
  onTest,
  onOverride,
  authType,
  note,
  scrydexApiKey,
  scrydexTeamId,
  onScrydexKeyChange,
  onScrydexTeamIdChange,
}: {
  sourceKey: SourceKey;
  label: string;
  defaultUrl: string;
  activeUrl: string;
  overrideUrl: string | null;
  testResult: TestSourceResult | "loading" | undefined;
  onTest: () => void;
  onOverride: (url: string) => void;
  authType: "none" | "api-key";
  note: string;
  scrydexApiKey?: string | null;
  scrydexTeamId?: string | null;
  onScrydexKeyChange?: (value: string) => void;
  onScrydexTeamIdChange?: (value: string) => void;
}) {
  const [showOverride, setShowOverride] = useState(false);
  const [urlDraft, setUrlDraft] = useState(overrideUrl ?? "");
  const [keyDraft, setKeyDraft] = useState("");
  const [teamIdDraft, setTeamIdDraft] = useState("");

  const isLoading = testResult === "loading";
  const result = testResult && testResult !== "loading" ? testResult : null;
  const needsKey = authType === "api-key";

  return (
    <div
      className="rounded-lg border bg-background p-3 space-y-2"
      data-oid="r2j.t9g"
    >
      <div className="flex items-center justify-between" data-oid="s-8ro80">
        <div className="flex items-center gap-2 min-w-0" data-oid="m4.1qth">
          {result ? (
            result.ok ? (
              <CheckCircle2
                className="h-4 w-4 text-green-500 shrink-0"
                data-oid="5g4b044"
              />
            ) : (
              <XCircle
                className="h-4 w-4 text-red-500 shrink-0"
                data-oid="_l-jc2c"
              />
            )
          ) : isLoading ? (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground shrink-0"
              data-oid="2xbhzj8"
            />
          ) : (
            <div
              className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0"
              data-oid="14geb:1"
            />
          )}
          <div className="min-w-0" data-oid="gvs6-zl">
            <div className="flex items-center gap-2" data-oid="70m6dxm">
              <p className="text-sm font-medium" data-oid="parut1y">
                {label}
              </p>
              {needsKey && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${scrydexApiKey ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}`}
                  data-oid="at54v63"
                >
                  {scrydexApiKey ? "Key set" : "Key required"}
                </span>
              )}
            </div>
            <p
              className="text-xs font-mono text-muted-foreground truncate max-w-[300px]"
              data-oid="g5zq7bn"
            >
              {activeUrl}
              {overrideUrl ? (
                <span
                  className="ml-1 text-yellow-600 dark:text-yellow-400"
                  data-oid="ujgyq8a"
                >
                  (override)
                </span>
              ) : /localhost|:\d{4}|-bulk|-cache/i.test(activeUrl) ? (
                <span
                  className="ml-1 text-blue-600 dark:text-blue-400"
                  data-oid="_2oyhgh"
                >
                  (local cache)
                </span>
              ) : null}
            </p>
            <p
              className="text-[11px] text-muted-foreground/70 mt-0.5"
              data-oid="s6i5m_4"
            >
              {note}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0" data-oid="cegaomo">
          {result && (
            <span
              className={`text-xs tabular-nums ${result.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
              role="status"
              aria-live="polite"
              data-oid="bha5d5."
            >
              {result.ok ? `${result.latencyMs}ms` : result.error || "Failed"}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onTest}
            disabled={isLoading}
            data-oid="_s35qz3"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" data-oid="041oibm" />
            ) : (
              "Test"
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowOverride(!showOverride)}
            aria-label={`${showOverride ? "Hide" : "Show"} settings for ${label}`}
            aria-expanded={showOverride}
            data-oid=".v0njo-"
          >
            {needsKey ? (
              <Key className="h-3 w-3" data-oid="pdqge8v" />
            ) : (
              <Settings2 className="h-3 w-3" data-oid="cknwu.v" />
            )}
          </Button>
        </div>
      </div>

      {showOverride && (
        <div className="space-y-2 pt-2 border-t" data-oid="w:p07uv">
          <p className="text-[11px] text-muted-foreground" data-oid="efqjud.">
            Override the base URL (leave empty to use the default).
          </p>
          <div className="flex items-center gap-2" data-oid="kgidhwj">
            <Input
              aria-label={`${label} base URL override`}
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder={defaultUrl}
              className="text-xs font-mono"
              autoComplete="off"
              data-oid="5zovkh3"
            />

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onOverride(urlDraft);
                setShowOverride(false);
              }}
              data-oid="-p-.d6y"
            >
              Save
            </Button>
            {overrideUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onOverride("");
                  setUrlDraft("");
                  setShowOverride(false);
                }}
                data-oid="htza7kk"
              >
                Reset
              </Button>
            )}
          </div>
          {onScrydexKeyChange && (
            <>
              <p
                className="text-[11px] text-muted-foreground mt-2"
                data-oid="x71tmfw"
              >
                Scrydex credentials (required for Pokemon card data):
              </p>
              <div className="flex items-center gap-2" data-oid="1r.pgk3">
                <Input
                  aria-label="Scrydex API key"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={
                    scrydexApiKey
                      ? `••••••••${scrydexApiKey.slice(-4)}`
                      : "Scrydex API Key"
                  }
                  className="text-xs font-mono"
                  type="password"
                  autoComplete="off"
                  data-oid="ulu:7s-"
                />

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onScrydexKeyChange(keyDraft);
                    setKeyDraft("");
                  }}
                  data-oid="uplwcbd"
                >
                  Set
                </Button>
              </div>
            </>
          )}
          {onScrydexTeamIdChange && (
            <div className="flex items-center gap-2" data-oid=":1qu:rp">
              <Input
                aria-label="Scrydex team ID"
                value={teamIdDraft}
                onChange={(e) => setTeamIdDraft(e.target.value)}
                placeholder={
                  scrydexTeamId
                    ? `••••••••${scrydexTeamId.slice(-4)}`
                    : "Scrydex Team ID"
                }
                className="text-xs font-mono"
                type="password"
                autoComplete="off"
                data-oid="55nxt9t"
              />

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onScrydexTeamIdChange(teamIdDraft);
                  setTeamIdDraft("");
                }}
                data-oid="_yjfmgs"
              >
                Set
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreferenceCard({
  title,
  description,
  icon,
  action,
}: PreferenceCardProps) {
  return (
    <div
      className="flex flex-col justify-between rounded-lg border bg-background p-4"
      data-oid="73cihfi"
    >
      <div data-oid="hg8sztj">
        <h3
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
          data-oid="4ym:93e"
        >
          {icon}
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground" data-oid="cir58mq">
          {description}
        </p>
      </div>
      <div className="mt-4 self-start" data-oid="x30t96d">
        {action}
      </div>
    </div>
  );
}

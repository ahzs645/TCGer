'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Activity, Bell, CheckCircle2, Globe, Key, Loader2, Moon, Settings2, ShieldCheck, User as UserIcon, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { getAdminSettings, getSourceDefaults, testSource, updateSettings, type AdminAppSettings, type SourceDefaults, type SourceKey, type TestSourceResult } from '@/lib/api/settings';
import { getUserPreferences, updateUserPreferences } from '@/lib/api/user-preferences';
import { GAME_LABELS } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useModuleStore, type ManageableGame } from '@/stores/preferences';

const iconPaths = {
  yugioh: '/icons/Yugioh.svg',
  magic: '/icons/MTG.svg',
  pokemon: '/icons/Pokemon.svg'
};

interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSettingsDialog({ open, onOpenChange }: AccountSettingsDialogProps) {
  const {
    enabledGames,
    toggleGame,
    showCardNumbers,
    setShowCardNumbers,
    showPricing,
    setShowPricing
  } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    toggleGame: state.toggleGame,
    showCardNumbers: state.showCardNumbers,
    setShowCardNumbers: state.setShowCardNumbers,
    showPricing: state.showPricing,
    setShowPricing: state.setShowPricing
  }));

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const updateStoredPreferences = useAuthStore((state) => state.updateStoredPreferences);
  const [appSettings, setAppSettings] = useState<AdminAppSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [sourceDefaults, setSourceDefaults] = useState<SourceDefaults | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestSourceResult | 'loading'>>({});
  const [updatingPreference, setUpdatingPreference] = useState<'showCardNumbers' | 'showPricing' | null>(null);
  const [updatingGame, setUpdatingGame] = useState<ManageableGame | null>(null);

  const activeCount = useMemo(() => Object.values(enabledGames).filter(Boolean).length, [enabledGames]);
  const isAdmin = user?.isAdmin ?? false;

  useEffect(() => {
    if (open && isAdmin && token) {
      setLoadingSettings(true);
      Promise.all([
        getAdminSettings(token).then(setAppSettings),
        getSourceDefaults(token).then(setSourceDefaults)
      ])
        .catch((error) => console.error('Failed to load settings:', error))
        .finally(() => setLoadingSettings(false));
    }
  }, [open, isAdmin]);

  useEffect(() => {
    if (!open || !token) {
      return;
    }

    setLoadingPreferences(true);
    getUserPreferences(token)
      .then((preferences) => {
        updateStoredPreferences(preferences);
      })
      .catch((error) => console.error('Failed to load user preferences:', error))
      .finally(() => setLoadingPreferences(false));
  }, [open, token, updateStoredPreferences]);

  const handleSettingChange = async (key: string, value: boolean | string | null) => {
    if (!token || !appSettings) return;

    const updatedSettings = { ...appSettings, [key]: value };
    setAppSettings(updatedSettings);

    try {
      await updateSettings({ [key]: value } as never, token);
    } catch (error) {
      console.error('Failed to update settings:', error);
      setAppSettings(appSettings);
    }
  };

  const handleTestSource = async (source: SourceKey) => {
    if (!token) return;
    setTestResults((prev) => ({ ...prev, [source]: 'loading' }));
    try {
      const result = await testSource(source, token);
      setTestResults((prev) => ({ ...prev, [source]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [source]: { ok: false, latencyMs: 0, error: 'Request failed' } }));
    }
  };

  const handleTestAll = async () => {
    if (!token) return;
    const sources: SourceKey[] = ['scryfall', 'yugioh', 'pokemon', 'tcgdex'];
    sources.forEach((s) => setTestResults((prev) => ({ ...prev, [s]: 'loading' })));
    await Promise.allSettled(sources.map((s) => handleTestSource(s)));
  };

  const handlePreferenceToggle = async (preference: 'showCardNumbers' | 'showPricing', value: boolean) => {
    if (!token) return;

    const previousValue = preference === 'showCardNumbers' ? showCardNumbers : showPricing;
    if (previousValue === value) return;

    setUpdatingPreference(preference);

    if (preference === 'showCardNumbers') {
      setShowCardNumbers(value);
    } else {
      setShowPricing(value);
    }

    try {
      await updateUserPreferences({ [preference]: value }, token);
      updateStoredPreferences({ [preference]: value });
    } catch (error) {
      console.error('Failed to update user preference:', error);
      if (preference === 'showCardNumbers') {
        setShowCardNumbers(previousValue);
      } else {
        setShowPricing(previousValue);
      }
    } finally {
      setUpdatingPreference(null);
    }
  };

  const handleGameToggle = async (game: ManageableGame) => {
    if (!token) {
      toggleGame(game);
      return;
    }

    const previousValue = enabledGames[game];
    const newValue = !previousValue;

    setUpdatingGame(game);
    toggleGame(game);

    const preferencePayload =
      game === 'yugioh'
        ? { enabledYugioh: newValue }
        : game === 'magic'
          ? { enabledMagic: newValue }
          : { enabledPokemon: newValue };

    try {
      await updateUserPreferences(preferencePayload, token);
      updateStoredPreferences(preferencePayload);
    } catch (error) {
      console.error('Failed to update enabled game:', error);
      toggleGame(game);
    } finally {
      setUpdatingGame(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account & Preferences</DialogTitle>
          <DialogDescription>Configure your profile, notifications, and which TCG modules are active.</DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          <div className="flex items-start justify-between rounded-lg border bg-muted/40 p-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <UserIcon className="h-4 w-4" /> Account Details
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage how you appear across web and mobile clients.
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{user?.username || 'User'}</p>
              <p>{user?.email}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <PreferenceCard
              title="Dark mode"
              description="Sync theme across devices (coming soon)."
              icon={<Moon className="h-4 w-4" />}
              action={<Button size="sm" variant="outline" disabled>System default</Button>}
            />
            <PreferenceCard
              title="Notifications"
              description="Enable price alerts and collection digests."
              icon={<Bell className="h-4 w-4" />}
              action={<Button size="sm" variant="outline">Configure</Button>}
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">TCG Modules</h3>
              <p className="text-sm text-muted-foreground">
                Toggle which adapters are active in your dashboards and search. ({activeCount}/3 enabled)
              </p>
            </div>
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          </div>

          <div className="grid gap-3">
            {(Object.entries(enabledGames) as Array<[ManageableGame, boolean]>).map(([game, enabled]) => {
              const iconPath = iconPaths[game];
              return (
                <div key={game} className="flex items-center justify-between rounded-lg border bg-background p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                      <Image src={iconPath} alt={GAME_LABELS[game]} width={16} height={16} className="dark:invert" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{GAME_LABELS[game]}</p>
                      <p className="text-xs text-muted-foreground">Include {GAME_LABELS[game]} in global search and analytics.</p>
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={updatingGame === game}
                    onCheckedChange={() => handleGameToggle(game)}
                    aria-label={`Toggle ${GAME_LABELS[game]}`}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Display Preferences</h3>
            <p className="text-sm text-muted-foreground">Customize how cards are displayed in search results.</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-background p-3">
            <div>
              <p className="text-sm font-medium">Show Card Numbers</p>
              <p className="text-xs text-muted-foreground">Display set codes (e.g., STAX-EN020, xy7) with card names.</p>
            </div>
            <Switch
              checked={showCardNumbers}
              disabled={!token || loadingPreferences || updatingPreference === 'showCardNumbers'}
              onCheckedChange={(checked) => handlePreferenceToggle('showCardNumbers', checked)}
              aria-label="Toggle card numbers"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-background p-3">
            <div>
              <p className="text-sm font-medium">Show Pricing</p>
              <p className="text-xs text-muted-foreground">
                Toggle pricing summaries and estimated values across the dashboard and collection views.
              </p>
            </div>
            <Switch
              checked={showPricing}
              disabled={!token || loadingPreferences || updatingPreference === 'showPricing'}
              onCheckedChange={(checked) => handlePreferenceToggle('showPricing', checked)}
              aria-label="Toggle pricing display"
            />
          </div>
        </section>

        {isAdmin && (
          <>
            <Separator />
            <section className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Globe className="h-4 w-4" />
                  Admin Settings
                </h3>
                <p className="text-sm text-muted-foreground">
                  Control public access and authentication requirements.
                </p>
              </div>

              {loadingSettings ? (
                <div className="flex justify-center p-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : appSettings ? (
                <>
                  <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                    <div>
                      <p className="text-sm font-medium">Public Dashboard</p>
                      <p className="text-xs text-muted-foreground">
                        Allow dashboard to be viewed without authentication.
                      </p>
                    </div>
                    <Switch
                      checked={appSettings.publicDashboard}
                      onCheckedChange={(checked) => handleSettingChange('publicDashboard', checked)}
                      aria-label="Toggle public dashboard"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                    <div>
                      <p className="text-sm font-medium">Public Collections</p>
                      <p className="text-xs text-muted-foreground">
                        Allow collections to be viewed without authentication.
                      </p>
                    </div>
                    <Switch
                      checked={appSettings.publicCollections}
                      onCheckedChange={(checked) => handleSettingChange('publicCollections', checked)}
                      aria-label="Toggle public collections"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                    <div>
                      <p className="text-sm font-medium">Require Authentication</p>
                      <p className="text-xs text-muted-foreground">
                        Require login for all features. When disabled, search remains authenticated-only.
                      </p>
                    </div>
                    <Switch
                      checked={appSettings.requireAuth}
                      onCheckedChange={(checked) => handleSettingChange('requireAuth', checked)}
                      aria-label="Toggle require authentication"
                    />
                  </div>
                </>
              ) : null}
            </section>

            <Separator />

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Activity className="h-4 w-4" />
                    Data Sources
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    External APIs that power card search and pricing. Test connectivity or override URLs.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleTestAll} disabled={loadingSettings}>
                  Test All
                </Button>
              </div>

              {loadingSettings ? (
                <div className="flex justify-center p-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : sourceDefaults ? (
                <div className="space-y-3">
                  {(Object.entries(sourceDefaults) as Array<[SourceKey, { url: string; label: string }]>).map(([key, source]) => {
                    const result = testResults[key];
                    const overrideKey = key === 'scryfall' ? 'scryfallApiBaseUrl'
                      : key === 'yugioh' ? 'ygoApiBaseUrl'
                      : key === 'pokemon' ? 'scrydexApiBaseUrl'
                      : 'tcgdexApiBaseUrl';
                    const overrideUrl = appSettings?.[overrideKey as keyof AdminAppSettings] as string | null;
                    const activeUrl = overrideUrl || source.url;
                    const local = isLocalCache(activeUrl);
                    const note = local ? SOURCE_NOTES[key].local : SOURCE_NOTES[key].remote;
                    const authType = local && key === 'pokemon' ? 'none' as const : SOURCE_AUTH[key];

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
                        onOverride={(url) => handleSettingChange(overrideKey, url || null)}
                        authType={authType}
                        note={note}
                        scrydexApiKey={key === 'pokemon' ? appSettings?.scrydexApiKey : undefined}
                        scrydexTeamId={key === 'pokemon' ? appSettings?.scrydexTeamId : undefined}
                        onScrydexKeyChange={key === 'pokemon' ? (v) => handleSettingChange('scrydexApiKey', v || null) : undefined}
                        onScrydexTeamIdChange={key === 'pokemon' ? (v) => handleSettingChange('scrydexTeamId', v || null) : undefined}
                      />
                    );
                  })}
                </div>
              ) : null}
            </section>
          </>
        )}

        <DialogFooter className="justify-between sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Changes sync automatically. Mobile apps will respect the same module preferences.
          </p>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isLocalCache(url: string) {
  return /localhost|:\d{4}|-bulk|-cache/i.test(url);
}

const SOURCE_NOTES: Record<SourceKey, { remote: string; local: string }> = {
  scryfall: { remote: 'Free, no key needed. Rate limit: ~10 req/s.', local: 'Local Scryfall bulk cache. No rate limits.' },
  yugioh: { remote: 'Free, no key needed. Rate limit: 20 req/s.', local: 'Local YGO cache. No rate limits.' },
  pokemon: { remote: 'Requires Scrydex API key and team ID.', local: 'Local Pokémon cache. Requires bulk profile running.' },
  tcgdex: { remote: 'Free, no key needed. Used for variant enrichment.', local: 'Local TCGdex cache. Used for variant enrichment.' },
};

const SOURCE_AUTH: Record<SourceKey, 'none' | 'api-key'> = {
  scryfall: 'none',
  yugioh: 'none',
  pokemon: 'api-key',
  tcgdex: 'none',
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
  testResult: TestSourceResult | 'loading' | undefined;
  onTest: () => void;
  onOverride: (url: string) => void;
  authType: 'none' | 'api-key';
  note: string;
  scrydexApiKey?: string | null;
  scrydexTeamId?: string | null;
  onScrydexKeyChange?: (value: string) => void;
  onScrydexTeamIdChange?: (value: string) => void;
}) {
  const [showOverride, setShowOverride] = useState(false);
  const [urlDraft, setUrlDraft] = useState(overrideUrl ?? '');
  const [keyDraft, setKeyDraft] = useState('');
  const [teamIdDraft, setTeamIdDraft] = useState('');

  const isLoading = testResult === 'loading';
  const result = testResult && testResult !== 'loading' ? testResult : null;
  const needsKey = authType === 'api-key';

  return (
    <div className="rounded-lg border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {result ? (
            result.ok ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
            )
          ) : isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          ) : (
            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{label}</p>
              {needsKey && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${scrydexApiKey ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                  {scrydexApiKey ? 'Key set' : 'Key required'}
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-muted-foreground truncate max-w-[300px]">
              {activeUrl}
              {overrideUrl ? (
                <span className="ml-1 text-yellow-600 dark:text-yellow-400">(override)</span>
              ) : /localhost|:\d{4}|-bulk|-cache/i.test(activeUrl) ? (
                <span className="ml-1 text-blue-600 dark:text-blue-400">(local cache)</span>
              ) : null}
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{note}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {result && (
            <span className={`text-xs tabular-nums ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {result.ok ? `${result.latencyMs}ms` : result.error || 'Failed'}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={onTest} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowOverride(!showOverride)}>
            {needsKey ? <Key className="h-3 w-3" /> : <Settings2 className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {showOverride && (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-[11px] text-muted-foreground">Override the base URL (leave empty to use the default).</p>
          <div className="flex items-center gap-2">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder={defaultUrl}
              className="text-xs font-mono"
              autoComplete="off"
            />
            <Button size="sm" variant="outline" onClick={() => { onOverride(urlDraft); setShowOverride(false); }}>
              Save
            </Button>
            {overrideUrl && (
              <Button size="sm" variant="ghost" onClick={() => { onOverride(''); setUrlDraft(''); setShowOverride(false); }}>
                Reset
              </Button>
            )}
          </div>
          {onScrydexKeyChange && (
            <>
              <p className="text-[11px] text-muted-foreground mt-2">Scrydex credentials (required for Pokemon card data):</p>
              <div className="flex items-center gap-2">
                <Input
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={scrydexApiKey ? `••••••••${scrydexApiKey.slice(-4)}` : 'Scrydex API Key'}
                  className="text-xs font-mono"
                  type="password"
                  autoComplete="off"
                />
                <Button size="sm" variant="outline" onClick={() => { onScrydexKeyChange(keyDraft); setKeyDraft(''); }}>
                  Set
                </Button>
              </div>
            </>
          )}
          {onScrydexTeamIdChange && (
            <div className="flex items-center gap-2">
              <Input
                value={teamIdDraft}
                onChange={(e) => setTeamIdDraft(e.target.value)}
                placeholder={scrydexTeamId ? `••••••••${scrydexTeamId.slice(-4)}` : 'Scrydex Team ID'}
                className="text-xs font-mono"
                type="password"
                autoComplete="off"
              />
              <Button size="sm" variant="outline" onClick={() => { onScrydexTeamIdChange(teamIdDraft); setTeamIdDraft(''); }}>
                Set
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreferenceCard({ title, description, icon, action }: PreferenceCardProps) {
  return (
    <div className="flex flex-col justify-between rounded-lg border bg-background p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mt-4 self-start">{action}</div>
    </div>
  );
}

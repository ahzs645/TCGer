'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Bell, Globe, Key, Moon, ShieldCheck, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { getAdminSettings, updateSettings, type AdminAppSettings } from '@/lib/api/settings';
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
  const [updatingPreference, setUpdatingPreference] = useState<'showCardNumbers' | 'showPricing' | null>(null);
  const [updatingGame, setUpdatingGame] = useState<ManageableGame | null>(null);

  const activeCount = useMemo(() => Object.values(enabledGames).filter(Boolean).length, [enabledGames]);
  const isAdmin = user?.isAdmin ?? false;

  useEffect(() => {
    if (open && isAdmin && token) {
      setLoadingSettings(true);
      getAdminSettings(token)
        .then(setAppSettings)
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
                      <Image src={iconPath} alt={GAME_LABELS[game]} width={16} height={16} className="h-4 w-4 dark:invert" />
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
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Key className="h-4 w-4" />
                  API Configuration
                </h3>
                <p className="text-sm text-muted-foreground">
                  Configure external API keys and service URLs. Leave blank to use environment defaults.
                </p>
              </div>

              {loadingSettings ? (
                <div className="flex justify-center p-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : appSettings ? (
                <div className="space-y-3">
                  <ApiKeyField
                    label="Pokémon TCG API Key"
                    description="Required for Pokémon card data from pokemontcg.io"
                    value={appSettings.pokemonTcgApiKey}
                    onSave={(v) => handleSettingChange('pokemonTcgApiKey', v || null)}
                    isSecret
                  />
                  <ApiKeyField
                    label="Scryfall API Base URL"
                    description="Override for local Scryfall bulk cache (e.g. http://scryfall-bulk:4010)"
                    value={appSettings.scryfallApiBaseUrl}
                    onSave={(v) => handleSettingChange('scryfallApiBaseUrl', v || null)}
                  />
                  <ApiKeyField
                    label="Yu-Gi-Oh API Base URL"
                    description="Override for local YGO cache (e.g. http://ygo-cache:4020)"
                    value={appSettings.ygoApiBaseUrl}
                    onSave={(v) => handleSettingChange('ygoApiBaseUrl', v || null)}
                  />
                  <ApiKeyField
                    label="Pokémon API Base URL"
                    description="Override for Pokémon card search (e.g. http://tcgdex-cache:4040)"
                    value={appSettings.pokemonApiBaseUrl}
                    onSave={(v) => handleSettingChange('pokemonApiBaseUrl', v || null)}
                  />
                  <ApiKeyField
                    label="TCGdex API Base URL"
                    description="Override for TCGdex variant enrichment"
                    value={appSettings.tcgdexApiBaseUrl}
                    onSave={(v) => handleSettingChange('tcgdexApiBaseUrl', v || null)}
                  />
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

interface PreferenceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  action: React.ReactNode;
}

function ApiKeyField({ label, description, value, onSave, isSecret }: {
  label: string;
  description: string;
  value: string | null;
  onSave: (value: string) => void;
  isSecret?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
  };

  const displayValue = value
    ? isSecret
      ? `${'•'.repeat(Math.min(value.length, 20))}${value.slice(-4)}`
      : value
    : '';

  return (
    <div className="rounded-lg border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => { setDraft(value ?? ''); setEditing(true); }}>
            {value ? 'Edit' : 'Set'}
          </Button>
        )}
      </div>
      {!editing && value && (
        <p className="text-xs font-mono text-muted-foreground">{displayValue}</p>
      )}
      {editing && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isSecret ? 'Enter API key…' : 'Enter URL…'}
            className="text-sm font-mono"
            type={isSecret ? 'password' : 'text'}
            autoComplete="off"
          />
          <Button size="sm" onClick={handleSave}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
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

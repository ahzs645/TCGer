'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { Bell, Moon, ShieldCheck, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { GAME_LABELS } from '@/lib/utils';
import { useModuleStore } from '@/stores/preferences';

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
  const { enabledGames, toggleGame, showCardNumbers, setShowCardNumbers, showPricing, setShowPricing } =
    useModuleStore((state) => ({
      enabledGames: state.enabledGames,
      toggleGame: state.toggleGame,
      showCardNumbers: state.showCardNumbers,
      setShowCardNumbers: state.setShowCardNumbers,
      showPricing: state.showPricing,
      setShowPricing: state.setShowPricing
    }));

  const activeCount = useMemo(() => Object.values(enabledGames).filter(Boolean).length, [enabledGames]);

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
              <p className="font-medium text-foreground">Ash Player</p>
              <p>ash.player@example.com</p>
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
            {(Object.entries(enabledGames) as Array<[keyof typeof enabledGames, boolean]>).map(([game, enabled]) => {
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
                    onCheckedChange={() => toggleGame(game)}
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
              onCheckedChange={setShowCardNumbers}
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
              onCheckedChange={setShowPricing}
              aria-label="Toggle pricing display"
            />
          </div>
        </section>

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

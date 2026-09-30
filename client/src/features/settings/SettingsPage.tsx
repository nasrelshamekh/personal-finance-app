import { Link } from 'react-router-dom';
import { Check, Monitor, Moon, Sun, Wallet } from 'lucide-react';
import { THEME_MODES, type ThemeMode, type ThemePreset } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { reportFailure } from '@/lib/action-feedback';
import { useTheme } from '@/hooks/useTheme';
import { PRESETS } from '@/providers/theme-context';
import { PageHeader } from '@/components/shared/PageHeader';
import { Label } from '@/components/ui/label';
import { CategoryManager } from '@/features/categories/CategoryManager';
import { DataSection } from './DataSection';
import { RatesSection } from './RatesSection';
import { useUpdateSettings } from './queries';

const MODE_META: Record<ThemeMode, { label: string; icon: typeof Sun; hint: string }> = {
  light: { label: 'Light', icon: Sun, hint: 'Always light' },
  dark: { label: 'Dark', icon: Moon, hint: 'Always dark' },
  system: { label: 'System', icon: Monitor, hint: 'Follow the OS' },
};

/**
 * A live swatch. The preset's own variables are applied to this element, so what you see
 * is the actual palette rather than a hand-copied approximation — and it previews in the
 * mode you are currently in.
 */
function PresetSwatch({
  preset,
  name,
  description,
  isActive,
  isDark,
  onSelect,
}: {
  preset: ThemePreset;
  name: string;
  description: string;
  isActive: boolean;
  isDark: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border p-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive ? 'border-foreground/40 bg-accent/40' : 'border-border hover:bg-accent/30',
      )}
    >
      <div
        data-theme={preset}
        className={cn('flex items-center gap-1.5 rounded-md p-2', isDark && 'dark')}
        style={{ background: 'var(--background)' }}
      >
        <span className="size-6 rounded" style={{ background: 'var(--primary)' }} />
        <span className="size-6 rounded" style={{ background: 'var(--chart-2)' }} />
        <span className="size-6 rounded" style={{ background: 'var(--chart-3)' }} />
        <span className="size-6 rounded" style={{ background: 'var(--chart-4)' }} />
        <span className="size-6 rounded" style={{ background: 'var(--accent)' }} />
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        </div>
        {isActive && <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />}
      </div>
    </button>
  );
}

export function SettingsPage() {
  const { mode, setMode, preset, setPreset, resolvedMode } = useTheme();
  const updateSettings = useUpdateSettings();

  /**
   * The theme applies from localStorage and syncs to the Setting row afterwards (SPEC §11).
   *
   * The sync failing is not cosmetic even though the theme has already changed: the stored
   * row is what a backup carries, so a silent failure here means a restore months later
   * quietly brings back a theme you had moved on from. Hence it reports.
   */
  function chooseMode(next: ThemeMode) {
    setMode(next);
    updateSettings.mutate(
      { themeMode: next },
      { onError: reportFailure('The theme is applied, but could not be saved.') },
    );
  }

  function choosePreset(next: ThemePreset) {
    setPreset(next);
    updateSettings.mutate(
      { themePreset: next },
      { onError: reportFailure('The preset is applied, but could not be saved.') },
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="How the app looks and where its numbers come from."
      />

      <div className="space-y-10">
        <section aria-labelledby="appearance-heading">
          <h3
            id="appearance-heading"
            className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            Appearance
          </h3>

          <div className="mt-4 space-y-6">
            <div>
              <p className="text-sm font-medium text-foreground">Mode</p>
              <div className="mt-2 inline-flex rounded-lg border border-border p-1">
                {THEME_MODES.map((option) => {
                  const { label, icon: Icon, hint } = MODE_META[option];
                  const isActive = mode === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => chooseMode(option)}
                      aria-pressed={isActive}
                      title={hint}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </div>
              {mode === 'system' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Currently {resolvedMode}, following your system.
                </p>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-foreground">Preset</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Presets change the accent only. Income and expense colours never move.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PRESETS.map((meta) => (
                  <PresetSwatch
                    key={meta.id}
                    preset={meta.id}
                    name={meta.name}
                    description={meta.description}
                    isActive={preset === meta.id}
                    isDark={resolvedMode === 'dark'}
                    onSelect={() => choosePreset(meta.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="categories-heading">
          <h3
            id="categories-heading"
            className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            Categories
          </h3>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            One level of nesting: Groceries can sit under Food, but nothing sits under Groceries. A
            category with history is archived rather than deleted, so past months keep reading the
            way they did.
          </p>
          <div className="mt-4">
            <CategoryManager />
          </div>
        </section>

        <section aria-labelledby="accounts-heading">
          <h3
            id="accounts-heading"
            className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            Accounts
          </h3>
          <div className="mt-4 glass rounded-lg p-4">
            <p className="max-w-prose text-xs text-muted-foreground">
              Accounts are managed on their own screen, where their balances are visible — which is
              the context you need to decide anything about them.
            </p>
            <Link
              to="/accounts"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Wallet className="size-3.5" aria-hidden />
              Manage accounts
            </Link>
          </div>
        </section>

        <section aria-labelledby="rates-heading">
          <h3
            id="rates-heading"
            className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            Exchange rates
          </h3>
          <div className="mt-4">
            <RatesSection />
          </div>
        </section>

        <section aria-labelledby="data-heading">
          <h3
            id="data-heading"
            className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            Data
          </h3>

          <div className="mt-4 space-y-4">
            <div className="glass rounded-lg p-4">
              <Label htmlFor="base-currency">Base currency</Label>
              <input
                id="base-currency"
                value="EGP — fixed in this version"
                disabled
                readOnly
                className="mt-2 w-full max-w-xs rounded-md border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground"
              />
              <p className="mt-2 max-w-prose text-xs text-muted-foreground">
                Every stored figure is denominated in Egyptian pounds. The setting is here so you
                know where it will live, and does nothing until it genuinely works.
              </p>
            </div>

            <DataSection />
          </div>
        </section>
      </div>
    </>
  );
}

import { Monitor, Moon, Sun } from 'lucide-react';
import { THEME_MODES, type ThemeMode } from '@ledger/shared';
import { cn } from '@/lib/cn';
import { useTheme } from '@/hooks/useTheme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const MODE_META: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'System', icon: Monitor },
};

/** Mode only. The preset lives in Settings, where the swatches can show real colour. */
export function ThemeModeToggle() {
  const { mode, setMode, resolvedMode } = useTheme();

  // Shows what is on screen, not what is configured: with `system` selected, a moon here
  // would be a lie about the current state.
  const VisibleIcon = resolvedMode === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'rounded-md p-2 text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-label={`Theme: ${MODE_META[mode].label}. Change theme`}
      >
        <VisibleIcon className="size-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-36">
        {THEME_MODES.map((option) => {
          const { label, icon: Icon } = MODE_META[option];
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => setMode(option)}
              className={cn('gap-2', mode === option && 'font-medium')}
            >
              <Icon className="size-4" aria-hidden />
              {label}
              {mode === option && <span className="ml-auto text-xs text-muted-foreground">•</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

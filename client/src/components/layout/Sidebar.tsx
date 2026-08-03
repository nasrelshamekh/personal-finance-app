import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV_ITEMS } from './navigation';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Persistent left sidebar (SPEC §10), collapsible to icons. Desktop only — below `md`
 * the bottom bar takes over, so this is hidden rather than reflowed.
 */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-card/30 md:flex',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-[68px]' : 'w-56',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-border',
          collapsed ? 'justify-center px-2' : 'justify-between px-4',
        )}
      >
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight text-foreground">Ledger EG</span>
        )}
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'rounded-md p-1.5 text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {/* Screen readers get the label even when it is visually collapsed. */}
                  {collapsed && <span className="sr-only">{item.label}</span>}
                  {isActive && <span className="sr-only">(current page)</span>}
                </>
              )}
            </NavLink>
          );

          return collapsed ? (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>
    </aside>
  );
}

import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV_ITEMS } from './navigation';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/** The same rule `NavLink`'s own `end` prop applies: only `/` needs an exact match. */
function isCurrent(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Persistent left sidebar (SPEC §10), collapsible to icons. Desktop only — below `md`
 * the bottom bar takes over, so this is hidden rather than reflowed.
 */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { pathname } = useLocation();

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
          /*
           * `isActive` is worked out here rather than taken from `NavLink`'s render props,
           * because when collapsed this link becomes a `TooltipTrigger asChild` — and
           * Radix's `Slot` merges `className` by *joining strings*. Handed a function it
           * stringified the source, so the class attribute became
           * `({ isActive }) => cn(\n  "flex items-center …` and the browser kept whichever
           * tokens inside it happened to be valid class names. `items-center` survived,
           * `"flex` did not. Collapsing the sidebar silently threw the layout away, which
           * is what made the icons look off-centre.
           */
          const active = isCurrent(pathname, item.to);

          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={cn(
                'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed && 'justify-center gap-0 px-0',
                active
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {/* Screen readers get the label even when it is visually collapsed. */}
              {collapsed && <span className="sr-only">{item.label}</span>}
              {active && <span className="sr-only">(current page)</span>}
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

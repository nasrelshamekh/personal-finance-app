import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** What to do next — never just "nothing here" (SPEC §10 quality floor). */
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-accent/60 p-3">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

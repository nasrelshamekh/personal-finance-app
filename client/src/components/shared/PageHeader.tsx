import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** Small letter-spaced label, big title — the type scale from SPEC §10. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description !== undefined && (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

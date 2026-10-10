import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow = 'Nivaas workspace', title, description, actions }: PageHeaderProps) {
  return (
    <header className="motion-item flex flex-col gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
        <h2 className="mt-2 font-headline text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

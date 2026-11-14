import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow = 'Nivaas workspace', title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header motion-item flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-6xl">
        <p className="sr-only">{eyebrow}</p>
        <h1 className="font-headline text-3xl font-bold tracking-[-0.035em] sm:text-[2.6rem] sm:leading-[1.08]">{title}</h1>
        <p className="mt-2 max-w-3xl text-[0.95rem] leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2 pb-1">{actions}</div> : null}
    </header>
  );
}

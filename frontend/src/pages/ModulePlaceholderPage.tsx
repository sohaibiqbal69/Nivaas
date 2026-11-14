import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMotion } from '@/hooks/usePageMotion';

type ModulePlaceholderPageProps = {
  title: string;
  description: string;
};

export function ModulePlaceholderPage({ title, description }: ModulePlaceholderPageProps) {
  const pageRef = usePageMotion<HTMLDivElement>();
  return (
    <div ref={pageRef} className="page-placeholder space-y-8">
      <PageHeader eyebrow="Nivaas application area" title={title} description={description} />
      <section className="max-w-2xl border-l-2 border-secondary/45 pl-5">
        <p className="record-status text-muted-foreground">Not available in this MVP</p>
        <h2 className="mt-2 font-headline text-xl font-bold">This area is not connected yet</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">This page does not load records. Use the connected areas in navigation for workflows currently available in Nivaas.</p>
        <Link to="/dashboard" className="mt-4 inline-flex min-h-11 items-center font-semibold text-info">Return to Dashboard →</Link>
      </section>
    </div>
  );
}

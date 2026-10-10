import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMotion } from '@/hooks/usePageMotion';

export function DashboardPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  return (
    <div ref={pageRef} className="space-y-10">
      <PageHeader
        eyebrow="Overview / society governance"
        title="Clarity for collective decisions."
        description="Nivaas brings society records, governance requirements, and integrity proofs into one accountable workspace."
        actions={<Badge variant="info">Live data connection pending</Badge>}
      />

      <section aria-labelledby="activity-heading" className="max-w-5xl">
        <div className="motion-item mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">Workspace pulse</p>
            <h2 id="activity-heading" className="mt-1 font-headline text-xl font-bold">Governance and society activity</h2>
          </div>
          <span className="hidden text-right text-xs text-muted-foreground sm:block">No records loaded</span>
        </div>
        <div className="mt-5 grid gap-x-12 md:grid-cols-2">
          {[
            ['Current governance activity', 'Meeting and voting activity will appear here when those services are connected.'],
            ['Active projects', 'Project information and progress will appear here when available.'],
            ['Upcoming meetings', 'Meeting dates and details will appear here once meeting services are connected.'],
            ['Notice Board', 'Society notices will be listed here when the notice service is available.'],
          ].map(([title, description], index) => (
            <Card key={title} className={`motion-item rounded-none border-x-0 border-b-0 ${index === 0 ? 'border-t-2 border-t-secondary/70' : 'border-t'}`}>
              <CardHeader className="px-0 pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
              <CardContent className="px-0"><p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p></CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="integrity-heading" className="motion-item max-w-5xl border-t border-border/70 pt-6">
        <div className="grid gap-2 sm:grid-cols-[minmax(12rem,0.7fr)_1.3fr] sm:gap-8">
          <h2 id="integrity-heading" className="font-headline text-lg font-bold">Integrity and verification</h2>
          <div>
            <p className="text-sm leading-6 text-muted-foreground">Blockchain serves as an integrity and proof layer for selected references. It does not replace Nivaas application records or establish the truth of an underlying event.</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Proof status will be shown when the verification service is connected; there are no proof records to display yet.</p>
            <Link to="/blockchain" className="mt-3 inline-flex min-h-11 items-center rounded-sm font-semibold text-info underline decoration-info/40 underline-offset-4 hover:decoration-info focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Blockchain verification</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

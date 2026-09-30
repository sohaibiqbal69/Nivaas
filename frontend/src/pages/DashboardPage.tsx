import { Link } from 'react-router-dom';

export function DashboardPage() {
  return (
    <div className="space-y-10">
      <section aria-labelledby="workspace-heading" className="max-w-4xl border-b border-border/70 pb-7">
        <h2 id="workspace-heading" className="font-headline text-2xl font-bold tracking-tight sm:text-3xl">Society governance</h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">Nivaas is a digital governance and transparency platform for housing societies. This workspace will bring society activity and records into view as its services become available.</p>
        <p className="mt-4 text-sm leading-6 text-foreground">No society services are connected yet. The sections below are empty and do not reflect live society records.</p>
      </section>

      <section aria-labelledby="activity-heading" className="max-w-5xl">
        <h2 id="activity-heading" className="font-headline text-xl font-bold">Governance and society activity</h2>
        <div className="mt-5 grid gap-x-12 md:grid-cols-2">
          <section aria-labelledby="governance-activity-heading" className="border-t-2 border-secondary/70 py-5">
            <h3 id="governance-activity-heading" className="font-headline text-lg font-semibold">Current governance activity</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Meeting and voting activity will be presented here when the corresponding Nivaas services are connected.</p>
          </section>
          <section aria-labelledby="projects-heading" className="border-t border-border py-5">
            <h3 id="projects-heading" className="font-headline text-lg font-semibold">Active projects</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Project information and progress will appear here when available. No project records are being loaded.</p>
          </section>
          <section aria-labelledby="meetings-heading" className="border-t border-border py-5">
            <h3 id="meetings-heading" className="font-headline text-lg font-semibold">Upcoming meetings</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Meeting dates and details will appear here once meeting services are connected.</p>
          </section>
          <section aria-labelledby="notices-heading" className="border-t border-border py-5">
            <h3 id="notices-heading" className="font-headline text-lg font-semibold">Notice Board</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Society notices will be listed here when the notice service is available.</p>
          </section>
        </div>
      </section>

      <section aria-labelledby="integrity-heading" className="max-w-5xl border-t border-border/70 pt-6">
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

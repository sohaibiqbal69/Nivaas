import { CircleDashed } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { usePageMotion } from '@/hooks/usePageMotion';

type ModulePlaceholderPageProps = {
  title: string;
  description: string;
};

export function ModulePlaceholderPage({ title, description }: ModulePlaceholderPageProps) {
  const pageRef = usePageMotion<HTMLDivElement>();
  return (
    <div ref={pageRef} className="max-w-3xl space-y-6">
      <PageHeader eyebrow="Nivaas application area" title={title} description={description} />
      <Card>
        <CardHeader>
          <Badge variant="neutral" className="w-fit"><CircleDashed aria-hidden="true" size={14} />Not connected</Badge>
          <CardTitle className="pt-2 text-base">This section is not populated yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">The application shell does not have a backend connection. No records, decisions, or activity are being shown here.</p>
          <Link to="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-sm font-semibold text-info underline decoration-info/40 underline-offset-4 hover:decoration-info focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Return to Dashboard</Link>
        </CardContent>
      </Card>
    </div>
  );
}

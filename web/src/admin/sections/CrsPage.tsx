import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, DataTable, PageHeader, Stat, type Column, type Tone } from '../../components/ui/kit';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Icons } from '../../components/layout/icons';
import * as adminApi from '../../api/admin.api';
import type { CrsEvent } from '../../api/admin.api';

const STATUS_TONE: Record<CrsEvent['status'], Tone> = { SENT: 'green', PENDING: 'amber', FAILED: 'red' };
const fmt = (d: string) => new Date(d).toLocaleString('en-IN');

export function CrsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['crs-status'], queryFn: adminApi.getCrsStatus });
  const { data: recon } = useQuery({ queryKey: ['reconciliation'], queryFn: adminApi.getReconciliation });

  const flush = useMutation({
    mutationFn: adminApi.flushCrs,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crs-status'] });
      qc.invalidateQueries({ queryKey: ['reconciliation'] });
    },
  });

  const events = data?.events ?? [];
  const counts = data?.counts ?? { pending: 0, sent: 0, failed: 0, total: 0 };

  const columns: Column<CrsEvent>[] = [
    { header: 'Event', className: 'font-medium text-slate-800', render: (e) => e.eventType.replace(/_/g, ' ') },
    { header: 'Correlation', className: 'font-mono text-xs text-slate-500', render: (e) => e.correlationId.slice(0, 8) },
    { header: 'Attempts', align: 'right', render: (e) => e.attempts },
    { header: 'Status', render: (e) => <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge> },
    { header: 'Last error', render: (e) => <span className="text-xs text-red-500">{e.lastError ?? '—'}</span> },
    { header: 'Created', render: (e) => <span className="text-slate-500">{fmt(e.createdAt)}</span> },
  ];

  return (
    <AppShell>
      <PageHeader
        title="CRS Synchronization"
        subtitle="CRS/CRS event outbox — booking obligations, payments, refunds and chargebacks posted to the CRS."
        actions={
          <Button variant="primary" disabled={flush.isPending} onClick={() => flush.mutate()}>
            {flush.isPending ? 'Flushing…' : 'Flush now'}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total events" value={counts.total} tone="blue" />
        <Stat label="Sent" value={counts.sent} tone="green" />
        <Stat label="Pending" value={counts.pending} tone="amber" />
        <Stat label="Failed" value={counts.failed} tone="red" />
      </div>

      {recon && (
        <div className={`mb-3 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${recon.clean ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <Icons.sync className="h-4 w-4" />
          {recon.clean
            ? 'Reconciliation clean — portal, CRS and CRS are in agreement.'
            : `Drift detected — ${recon.pendingCrsEvents} pending, ${recon.failedCrsEvents} failed CRS events, ${recon.invoiceLedgerMismatches} ledger mismatches. Flush and investigate.`}
        </div>
      )}

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={6} cols={6} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={columns} rows={events} rowKey={(e) => e.id} empty="No CRS events yet." />
      )}
    </AppShell>
  );
}

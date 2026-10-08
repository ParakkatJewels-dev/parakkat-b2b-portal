import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, DataTable, Modal, PageHeader, SearchInput, Select, Stat, Toolbar, type Column } from '../../components/ui/kit';
import { CountUp } from '../../components/ui/CountUp';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as bookingApi from '../../api/booking.api';
import { CATEGORY_TONE, STATE_TONE, bookingCategory, money, stateLabel, type Category } from '../../shared/bookingView';

export function AdminBookingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['bookings', 'admin'], queryFn: () => bookingApi.listAllBookings() });
  const bookings = useMemo(() => data?.items ?? [], [data]);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [selected, setSelected] = useState<bookingApi.AdminBookingRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['bookings', 'admin'] }); qc.invalidateQueries({ queryKey: ['rebook-queue'] }); };
  const noShow = useMutation({ mutationFn: (id: string) => bookingApi.adminNoShow(id), onSuccess: () => { invalidate(); setSelected(null); }, onError: (e) => setError(extractError(e)) });
  const resortCancel = useMutation({ mutationFn: (v: { id: string; reason: string }) => bookingApi.adminResortCancel(v.id, v.reason), onSuccess: () => { invalidate(); setSelected(null); }, onError: (e) => setError(extractError(e)) });
  const acting = noShow.isPending || resortCancel.isPending;

  // v3 §5.2 — commit-failure / rebook queue.
  const { data: rebook } = useQuery({ queryKey: ['rebook-queue'], queryFn: () => bookingApi.listRebookQueue() });
  const rebookItems = rebook?.items ?? [];
  const retry = useMutation({ mutationFn: (id: string) => bookingApi.retryRebook(id), onSuccess: invalidate, onError: (e) => setError(extractError(e)) });
  const runQueue = useMutation({ mutationFn: () => bookingApi.runRebookQueue(), onSuccess: invalidate, onError: (e) => setError(extractError(e)) });
  const rebookBusy = retry.isPending || runQueue.isPending;
  const isActive = (b: bookingApi.AdminBookingRow) => b.state !== 'CANCELLED' && b.state !== 'EXPIRED';

  const withCat = useMemo(() => bookings.map((b) => ({ b, cat: bookingCategory(b) })), [bookings]);
  const count = (c: Category) => withCat.filter((x) => x.cat === c).length;

  const rows = useMemo(
    () =>
      withCat
        .filter((x) => cat === 'all' || x.cat === cat)
        .filter((x) => [x.b.id, x.b.resortName, x.b.roomTypeName, x.b.agencyName].some((f) => f.toLowerCase().includes(q.toLowerCase())))
        .map((x) => x.b),
    [withCat, cat, q],
  );

  const columns: Column<bookingApi.AdminBookingRow>[] = [
    { header: 'Booking ID', className: 'font-mono text-xs font-medium text-slate-700', render: (b) => b.id.slice(0, 8) },
    { header: 'Agency', className: 'font-medium text-slate-800', render: (b) => b.agencyName },
    {
      header: 'Resort / Room',
      render: (b) => (
        <div>
          <div className="text-slate-700">{b.resortName}</div>
          <div className="text-xs text-slate-400">{b.roomTypeName}</div>
        </div>
      ),
    },
    { header: 'Stay', render: (b) => <span className="text-slate-500">{b.checkIn.slice(0, 10)} → {b.checkOut.slice(0, 10)}</span> },
    { header: 'Amount', align: 'right', className: 'font-medium text-slate-800', render: (b) => money(b.agencyPrice) },
    { header: 'Status', render: (b) => <Badge tone={STATE_TONE[b.state]}>{stateLabel(b.state)}</Badge> },
    { header: 'Actions', align: 'right', render: (b) => <Button variant="ghost" onClick={() => setSelected(b)}>View</Button> },
  ];

  return (
    <AppShell>
      <PageHeader title="Booking Management" subtitle="Every booking across all agencies — search, filter and inspect." />

      {rebookItems.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-amber-800">Rebook queue · {rebookItems.length}</h2>
              <p className="text-xs text-amber-700">Bookings the resort system rejected after the portal accepted/collected payment. Funds are held until each commits or is cancelled.</p>
            </div>
            <Button variant="secondary" disabled={rebookBusy} onClick={() => runQueue.mutate()}>
              {runQueue.isPending ? 'Running…' : 'Run queue'}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-amber-700/70">
                  <th className="py-1 pr-3">Booking</th>
                  <th className="py-1 pr-3">Agency</th>
                  <th className="py-1 pr-3">Resort / Room</th>
                  <th className="py-1 pr-3">Mode</th>
                  <th className="py-1 pr-3 text-right">Amount</th>
                  <th className="py-1 pr-3 text-center">Tries</th>
                  <th className="py-1 pr-3">State</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {rebookItems.map((r) => (
                  <tr key={r.id} className="border-t border-amber-200/60">
                    <td className="py-1.5 pr-3 font-mono text-xs text-slate-600">{r.bookingId.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3 text-slate-700">{r.agencyName}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{r.resortName} · <span className="text-slate-400">{r.roomTypeName}</span></td>
                    <td className="py-1.5 pr-3 text-slate-500">{r.paymentMode}</td>
                    <td className="py-1.5 pr-3 text-right font-medium text-slate-800">{money(r.agencyPrice)}</td>
                    <td className="py-1.5 pr-3 text-center text-slate-500">{r.attempts}</td>
                    <td className="py-1.5 pr-3"><Badge tone={r.status === 'ABANDONED' ? 'red' : 'amber'}>{r.status === 'ABANDONED' ? 'Abandoned' : 'Pending'}</Badge></td>
                    <td className="py-1.5 text-right">
                      <Button variant="secondary" disabled={rebookBusy} onClick={() => retry.mutate(r.bookingId)}>Retry</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rebookItems.some((r) => r.lastError) && (
            <p className="mt-2 truncate text-xs text-amber-700/80">Last error: {rebookItems.find((r) => r.lastError)?.lastError}</p>
          )}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={<CountUp to={bookings.length} />} tone="blue" />
        <Stat label="Upcoming" value={<CountUp to={count('Upcoming')} />} tone="blue" />
        <Stat label="Pending" value={<CountUp to={count('Pending')} />} tone="amber" />
        <Stat label="Cancelled" value={<CountUp to={count('Cancelled')} />} tone="red" />
      </div>

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search by ID, agency, resort…" />
        <Select
          value={cat}
          onChange={setCat}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'Upcoming', label: 'Upcoming' },
            { value: 'Pending', label: 'Pending' },
            { value: 'Completed', label: 'Completed' },
            { value: 'Cancelled', label: 'Cancelled' },
          ]}
        />
      </Toolbar>

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={8} cols={7} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(b) => b.id} empty="No bookings match your filters." />
      )}

      {selected && (
        <Modal
          title={`Booking ${selected.id.slice(0, 8)}`}
          onClose={() => setSelected(null)}
          wide
          footer={
            isActive(selected) ? (
              <>
                <Button variant="secondary" disabled={acting} onClick={() => { setError(null); noShow.mutate(selected.id); }}>Record No-show</Button>
                <Button variant="danger" disabled={acting} onClick={() => { const reason = prompt('Reason for resort-initiated cancellation (full refund):'); if (reason) { setError(null); resortCancel.mutate({ id: selected.id, reason }); } }}>Resort Cancel</Button>
              </>
            ) : undefined
          }
        >
          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Detail label="Agency" value={selected.agencyName} />
            <Detail label="Amount" value={money(selected.agencyPrice)} />
            <Detail label="Resort" value={selected.resortName} />
            <Detail label="Room type" value={selected.roomTypeName} />
            <Detail label="Check-in" value={selected.checkIn.slice(0, 10)} />
            <Detail label="Check-out" value={selected.checkOut.slice(0, 10)} />
            <Detail label="Guests" value={selected.guests} />
            <Detail label="Nights" value={selected.nights} />
            <Detail label="Payment mode" value={selected.paymentMode} />
            <Detail label="Status" value={<Badge tone={STATE_TONE[selected.state]}>{stateLabel(selected.state)}</Badge>} />
            <Detail label="Category" value={<Badge tone={CATEGORY_TONE[bookingCategory(selected)]}>{bookingCategory(selected)}</Badge>} />
            {selected.leadGuestName && <Detail label="Lead guest" value={selected.leadGuestName} />}
            {selected.guestIdLast4 && <Detail label="Guest ID" value={`${selected.guestIdType ?? 'ID'} ••••${selected.guestIdLast4}`} />}
            {selected.crsBookingRef && <Detail label="CRS ref" value={selected.crsBookingRef} />}
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  );
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Something went wrong';
}

import { useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../components/layout/AppShell';
import { Badge, Button, DataTable, Modal, PageHeader, SearchInput, Stat, Tabs, type Column } from '../components/ui/kit';
import { CountUp } from '../components/ui/CountUp';
import { SkeletonRows } from '../components/ui/Skeleton';
import * as bookingApi from '../api/booking.api';
import * as documentsApi from '../api/documents.api';
import type { Booking } from '../types/booking';
import { CATEGORY_TONE, STATE_TONE, bookingCategory, canCancel, canPay, money, stateLabel, type Category } from './bookingView';

const TABS: (Category | 'All')[] = ['All', 'Upcoming', 'Pending', 'Completed', 'Cancelled'];
const lift = 'transition duration-200 hover:-translate-y-0.5 hover:shadow-md';

/** Real-data booking management, shared by the agent and agency portals
 *  (the list is agency-scoped on the backend, so both see their agency's bookings). */
export function BookingsManager({ title, subtitle }: { title: string; subtitle: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['bookings'], queryFn: bookingApi.listBookings });
  const bookings = useMemo(() => data?.items ?? [], [data]);

  const [tab, setTab] = useState<Category | 'All'>('All');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => ['bookings', 'balance', 'invoices', 'agency-summary', 'agent-summary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const cancelM = useMutation({
    mutationFn: (id: string) => bookingApi.cancelBooking(id),
    onSuccess: (b) => { invalidate(); setSelected((s) => (s && s.id === b.id ? b : s)); },
    onError: (e) => setError(extractError(e)),
  });
  const payM = useMutation({
    mutationFn: (id: string) => bookingApi.payBooking(id),
    onSuccess: (b) => { invalidate(); setSelected((s) => (s && s.id === b.id ? b : s)); },
    onError: (e) => setError(extractError(e)),
  });
  const busy = cancelM.isPending || payM.isPending;

  const withCat = useMemo(() => bookings.map((b) => ({ b, cat: bookingCategory(b) })), [bookings]);
  const count = (c: Category) => withCat.filter((x) => x.cat === c).length;

  const rows = useMemo(
    () =>
      withCat
        .filter((x) => tab === 'All' || x.cat === tab)
        .filter((x) => [x.b.id, x.b.resortName, x.b.roomTypeName].some((f) => f.toLowerCase().includes(q.toLowerCase())))
        .map((x) => x.b),
    [withCat, tab, q],
  );

  const columns: Column<Booking>[] = [
    {
      header: 'Booking ID',
      className: 'font-mono text-xs font-medium text-slate-700',
      render: (b) => (
        <div className="flex items-center gap-1.5">
          <span>{b.id.slice(0, 8)}</span>
          {b.groupId && <Badge tone="violet">group</Badge>}
        </div>
      ),
    },
    {
      header: 'Resort / Room',
      render: (b) => (
        <div>
          <div className="font-medium text-slate-800">{b.resortName}</div>
          <div className="text-xs text-slate-400">{b.roomTypeName}</div>
        </div>
      ),
    },
    { header: 'Stay', render: (b) => <span className="text-slate-500">{b.checkIn.slice(0, 10)} → {b.checkOut.slice(0, 10)}</span> },
    { header: 'Guests', align: 'center', render: (b) => b.guests },
    { header: 'Amount', align: 'right', className: 'font-medium text-slate-800', render: (b) => money(b.agencyPrice) },
    { header: 'Status', render: (b) => <Badge tone={STATE_TONE[b.state]}>{stateLabel(b.state)}</Badge> },
    {
      header: 'Actions',
      align: 'right',
      render: (b) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={() => { setSelected(b); setError(null); }}>View</Button>
          {canPay(b) && <Button variant="secondary" disabled={busy} onClick={() => { setError(null); payM.mutate(b.id); }}>Pay</Button>}
          {canCancel(b) && <Button variant="danger" disabled={busy} onClick={() => { setError(null); cancelM.mutate(b.id); }}>Cancel</Button>}
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader title={title} subtitle={subtitle} actions={<Link to="/book"><Button variant="primary">+ New Booking</Button></Link>} />

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Upcoming" value={<CountUp to={count('Upcoming')} />} tone="blue" className={lift} />
        <Stat label="Pending" value={<CountUp to={count('Pending')} />} tone="amber" className={lift} />
        <Stat label="Completed" value={<CountUp to={count('Completed')} />} tone="green" className={lift} />
        <Stat label="Cancelled" value={<CountUp to={count('Cancelled')} />} tone="red" className={lift} />
      </div>

      <Tabs tabs={TABS.map((t) => ({ key: t, label: t }))} active={tab} onChange={(k) => setTab(k as Category | 'All')} />

      <div className="mb-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search by ID, resort, room…" />
      </div>

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={6} cols={7} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(b) => b.id} empty="No bookings in this view." />
      )}

      {selected && (
        <Modal
          title={`Booking ${selected.id.slice(0, 8)}`}
          onClose={() => setSelected(null)}
          wide
          footer={
            <>
              {canPay(selected) && <Button variant="secondary" disabled={busy} onClick={() => { setError(null); payM.mutate(selected.id); }}>Pay {money(selected.agencyPrice)}</Button>}
              {canCancel(selected) && <Button variant="danger" disabled={busy} onClick={() => { setError(null); cancelM.mutate(selected.id); }}>Cancel booking</Button>}
              {/* B2B resale layer — customer documents at the SELL price (agency-branded). */}
              {selected.state !== 'CANCELLED' && selected.state !== 'EXPIRED' && (
                <Button variant="secondary" onClick={() => { setError(null); documentsApi.downloadCustomerQuote(selected.id, selected.id.slice(0, 8)).catch((e) => setError(extractError(e))); }}>Customer Quote</Button>
              )}
              {['CONFIRMED', 'COMMITTED', 'PAID', 'CONFIRMED_ON_CREDIT'].includes(selected.state) && (
                <Button variant="secondary" onClick={() => { setError(null); documentsApi.downloadCustomerInvoice(selected.id, selected.id.slice(0, 8)).catch((e) => setError(extractError(e))); }}>Customer Invoice</Button>
              )}
              <Button variant="secondary" onClick={() => { setError(null); documentsApi.downloadVoucher(selected.id, selected.id.slice(0, 8), 'agent').catch((e) => setError(extractError(e))); }}>Agent Voucher</Button>
              <Button variant="primary" onClick={() => { setError(null); documentsApi.downloadVoucher(selected.id, selected.id.slice(0, 8), 'guest').catch((e) => setError(extractError(e))); }}>Guest Voucher</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Detail label="Resort" value={selected.resortName} />
            <Detail label="Room type" value={selected.roomTypeName} />
            <Detail label="Check-in" value={selected.checkIn.slice(0, 10)} />
            <Detail label="Check-out" value={selected.checkOut.slice(0, 10)} />
            <Detail label="Guests" value={selected.guests} />
            <Detail label="Nights" value={selected.nights} />
            <Detail label="Amount (you pay)" value={money(selected.agencyPrice)} />
            <Detail label="Payment mode" value={selected.paymentMode} />
            {selected.sellPrice != null && (
              <Detail label={`Customer price (+${Number(selected.resaleMarkupPct ?? 0)}%)`} value={money(selected.sellPrice)} />
            )}
            {selected.sellPrice != null && (
              <Detail label="Your profit" value={money(Number(selected.sellPrice) - Number(selected.agencyPrice))} />
            )}
            <Detail label="Status" value={<Badge tone={STATE_TONE[selected.state]}>{stateLabel(selected.state)}</Badge>} />
            <Detail label="Category" value={<Badge tone={CATEGORY_TONE[bookingCategory(selected)]}>{bookingCategory(selected)}</Badge>} />
            {selected.leadGuestName && <Detail label="Lead guest" value={selected.leadGuestName} />}
            {selected.guestIdLast4 && <Detail label="Guest ID" value={`${selected.guestIdType ?? 'ID'} ••••${selected.guestIdLast4}`} />}
            {selected.specialRequests && <Detail label="Special requests" value={selected.specialRequests} />}
            {selected.crsBookingRef && <Detail label="CRS ref" value={selected.crsBookingRef} />}
            {selected.holdExpiresAt && <Detail label="Hold expires" value={new Date(selected.holdExpiresAt).toLocaleString()} />}
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

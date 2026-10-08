import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, DataTable, Field, Input, PageHeader, Select, Tabs, inr, type Column } from '../../components/ui/kit';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as pricingApi from '../../api/pricing.api';
import type { AxisRatesRoom, RatePlan } from '../../api/pricing.api';
import * as adminApi from '../../api/admin.api';
import type { TierPreset } from '../../types/admin';
import { Link } from 'react-router-dom';

const PLANS: RatePlan[] = ['EP', 'CP', 'MAP', 'AP'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
function addDays(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function PricingPage() {
  const [tab, setTab] = useState('rates');
  const [resortId, setResortId] = useState<string | undefined>(undefined);
  const [checkIn, setCheckIn] = useState(todayStr());
  const [checkOut, setCheckOut] = useState(addDays(todayStr(), 2));

  const { data, isLoading } = useQuery({
    queryKey: ['axis-rates', resortId, checkIn, checkOut],
    queryFn: () => pricingApi.getAxisRates({ resortId, checkIn, checkOut }),
    enabled: checkOut > checkIn,
  });
  const { data: tiers } = useQuery({ queryKey: ['tiers'], queryFn: adminApi.listTiers });

  const resorts = data?.resorts ?? [];
  const rooms = data?.rooms ?? [];
  const effResort = data?.resortId ?? resortId ?? '';
  const nights = data?.rooms?.[0]?.plans?.[0]?.nights ?? 0;

  const cols: Column<AxisRatesRoom>[] = [
    {
      header: 'Room type',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800">{r.roomTypeName}</div>
          <div className="text-xs text-slate-400">{r.roomTypeId} · {r.availableCount} available</div>
        </div>
      ),
    },
    {
      header: 'Occupancy',
      render: (r) => (
        <span className="text-slate-500">
          base {r.occupancy.baseOccupancy} · max {r.occupancy.maxOccupancy} ({r.occupancy.maxAdults}A/{r.occupancy.maxChildren}C)
        </span>
      ),
    },
    {
      header: 'Net rate / night (avg)',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {PLANS.map((p) => {
            const pr = r.plans.find((x) => x.plan === p);
            return pr ? <Badge key={p} tone="blue">{p} {inr(pr.avgNightlyRate)}</Badge> : null;
          })}
        </div>
      ),
    },
    { header: 'Day use', align: 'right', render: (r) => (r.dayUseRate != null ? inr(r.dayUseRate) : <span className="text-slate-300">—</span>) },
    {
      header: 'Restrictions',
      render: (r) => {
        const none = !r.restrictions.closedToArrival && !r.restrictions.closedToDeparture && !r.restrictions.stopSell && r.restrictions.minNights <= 1;
        return (
          <div className="flex flex-wrap gap-1">
            {r.restrictions.minNights > 1 && <Badge tone="amber">min {r.restrictions.minNights}n</Badge>}
            {r.restrictions.closedToArrival && <Badge tone="red">CTA</Badge>}
            {r.restrictions.closedToDeparture && <Badge tone="red">CTD</Badge>}
            {r.restrictions.stopSell && <Badge tone="red">Stop-sell</Badge>}
            {none && <span className="text-xs text-slate-400">None</span>}
          </div>
        );
      },
    },
  ];

  const tierRows = tiers ? Object.entries(tiers).map(([tier, p]) => ({ tier, ...(p as TierPreset) })) : [];
  const markupCols: Column<{ tier: string } & TierPreset>[] = [
    { header: 'Tier', className: 'font-medium text-slate-800', render: (m) => m.tier },
    { header: 'Markup', align: 'right', className: 'font-medium text-slate-800', render: (m) => `${m.markupPct}%` },
    { header: 'Payment mode', render: (m) => <Badge tone={m.paymentMode === 'CREDIT' ? 'green' : 'slate'}>{m.paymentMode}</Badge> },
    { header: 'Credit limit', align: 'right', render: (m) => inr(Number(m.creditLimit)) },
    { header: 'Payment terms', render: (m) => m.paymentTerms },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Pricing (CRS)"
        subtitle="Rate plans, occupancy and restrictions are sourced from CRS. Rates shown are NET (pre-markup); the portal applies each agency's markup at booking."
      />
      <Tabs
        tabs={[
          { key: 'rates', label: 'Rates & Availability', count: rooms.length },
          { key: 'markups', label: 'Tier Markups', count: tierRows.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'rates' && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label="Resort">
              <Select value={effResort} onChange={(v) => setResortId(v)} options={resorts.map((r) => ({ value: r.id, label: r.name }))} />
            </Field>
            <Field label="Check-in"><Input type="date" min={todayStr()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Field>
            <Field label="Check-out"><Input type="date" min={addDays(checkIn, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Field>
            {nights > 0 && <span className="pb-2 text-xs text-slate-400">{nights} night{nights === 1 ? '' : 's'}</span>}
          </div>
          {isLoading ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm"><tbody><SkeletonRows rows={5} cols={5} /></tbody></table>
            </div>
          ) : (
            <DataTable columns={cols} rows={rooms} rowKey={(r) => r.roomTypeId} empty="No rooms for this resort / date range." />
          )}
          <p className="mt-3 text-xs text-slate-400">
            Read-only. Rate plans, per-date rates and restrictions (min-stay, CTA/CTD, stop-sell) come from CRS and cannot be edited here.
          </p>
        </>
      )}

      {tab === 'markups' && (
        <>
          <DataTable columns={markupCols} rows={tierRows} rowKey={(m) => m.tier} empty="No tiers configured." />
          <p className="mt-3 text-xs text-slate-400">
            Tier defaults are the portal markup applied to CRS net rates. Set a per-agency override (“personal bias”) on the{' '}
            <Link to="/admin/agencies" className="text-blue-600 hover:underline">agency</Link> detail page. Edit tier defaults in{' '}
            <Link to="/admin/settings" className="text-blue-600 hover:underline">Settings</Link>.
          </p>
        </>
      )}
    </AppShell>
  );
}

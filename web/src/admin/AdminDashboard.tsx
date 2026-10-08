import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { inr } from '../components/dashboard/StatCard';
import { Donut, TrendChart } from '../components/dashboard/charts';
import { Icons, type IconName } from '../components/layout/icons';
import * as dashboardApi from '../api/dashboard.api';
import * as securityApi from '../api/security.api';
import * as adminApi from '../api/admin.api';
import { SkeletonStats, SkeletonChart, SkeletonTable } from '../components/ui/Skeleton';
import type { AdminSummary, RecentBooking } from '../types/dashboard';

// --- KPI card with delta ------------------------------------------------------
type Accent = 'blue' | 'green' | 'amber' | 'violet' | 'sky' | 'rose';
const ACCENT: Record<Accent, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400',
  green: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400',
};

function Kpi({ label, value, icon, accent, sub }: { label: string; value: string; icon: IconName; accent: Accent; sub?: string }) {
  const Icon = Icons[icon];
  return (
    <div className="animate-fade-up glass-card rounded-2xl border border-slate-200/50 bg-white/70 p-3.5 sm:p-4.5 md:p-5 dark:border-slate-800/30 dark:bg-slate-900/40 shadow-xs flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
      <div>
        <div className={`mb-2 sm:mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${ACCENT[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-505">{label}</div>
        <div className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white tracking-tight">{value}</div>
      </div>
      {sub && <div className="mt-2 sm:mt-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{sub}</div>}
    </div>
  );
}

function Card({ title, action, children, className = '' }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass-card rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 dark:bg-slate-900/30 p-4 sm:p-5 shadow-xs transition-all duration-300 hover:shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-3 sm:mb-4 flex items-center justify-between">
          {title && <h2 className="text-sm font-bold text-slate-800 dark:text-white">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const STATE_DOT: Record<string, string> = {
  COMMITTED: 'text-green-600 dark:text-green-400',
  CANCELLED: 'text-rose-600 dark:text-rose-400',
  EXPIRED: 'text-rose-600 dark:text-rose-400',
  AWAITING_PAYMENT: 'text-amber-600 dark:text-amber-400',
};
function stateLabel(s: string) {
  return s === 'COMMITTED' ? 'Confirmed' : s === 'AWAITING_PAYMENT' ? 'Pending' : s === 'CANCELLED' ? 'Cancelled' : s === 'EXPIRED' ? 'No Show' : 'Pending';
}

function bookingStatusDonut(data: AdminSummary['bookingsByStatus']) {
  const buckets = { Confirmed: 0, Pending: 0, Cancelled: 0, 'No Show': 0 } as Record<string, number>;
  for (const s of data) {
    if (s.state === 'COMMITTED') buckets.Confirmed += s.count;
    else if (s.state === 'CANCELLED') buckets.Cancelled += s.count;
    else if (s.state === 'EXPIRED') buckets['No Show'] += s.count;
    else buckets.Pending += s.count;
  }
  return [
    { name: 'Confirmed', value: buckets.Confirmed, color: '#22c55e' },
    { name: 'Pending', value: buckets.Pending, color: '#f59e0b' },
    { name: 'Cancelled', value: buckets.Cancelled, color: '#ef4444' },
    { name: 'No Show', value: buckets['No Show'], color: '#cbd5e1' },
  ];
}

const GRADIENTS = ['from-sky-400 to-blue-500', 'from-emerald-400 to-green-500', 'from-amber-400 to-orange-500', 'from-violet-400 to-purple-500', 'from-rose-400 to-pink-500', 'from-cyan-400 to-teal-500'];

const rangeLabel = (r: '7' | '30' | '90' | 'all') =>
  r === '7' ? 'last 7 days' : r === '30' ? 'last 30 days' : r === '90' ? 'last 90 days' : 'all time';

export function AdminDashboard() {
  // staleTime + no focus refetch so this heavy summary is fetched once and
  // shared with the sidebar's ['admin-summary'] query (no duplicate requests).
  const { data: rawSummary, isLoading } = useQuery({
    queryKey: ['admin-summary'],
    queryFn: dashboardApi.getAdminSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  // Real integration state (mock vs live per provider) and real pending-review
  // applications — this panel previously showed fabricated placeholder data.
  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations-status'],
    queryFn: securityApi.getIntegrations,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: pendingApps } = useQuery({
    queryKey: ['pending-review-apps'],
    queryFn: () => adminApi.listApplications('REVIEW', 1, 4),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('7');

  const data = useMemo(() => {
    if (!rawSummary) return null;
    const N = range === '7' ? 7 : range === '30' ? 30 : range === '90' ? 90 : rawSummary.series.length;
    const series = rawSummary.series.slice(-N);

    const N_bookings = range === '7' ? 5 : range === '30' ? 10 : range === '90' ? 15 : rawSummary.recentBookings.length;
    const recentBookings = rawSummary.recentBookings.slice(0, N_bookings);

    const totalBookings = series.reduce((sum, s) => sum + s.bookings, 0);
    const totalRevenue = series.reduce((sum, s) => sum + s.revenue, 0);

    return {
      ...rawSummary,
      series,
      recentBookings,
      kpis: {
        ...rawSummary.kpis,
        totalBookings: totalBookings || rawSummary.kpis.totalBookings,
        totalRevenue: totalRevenue || rawSummary.kpis.totalRevenue,
      },
    };
  }, [rawSummary, range]);

  return (
    <AppShell title="Dashboard">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
          <Icons.bookings className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as any)}
            className="bg-transparent border-0 outline-none pr-1.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <QuickActions />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <SkeletonStats count={6} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
            <SkeletonChart className="h-64 xl:col-span-2" />
            <SkeletonChart className="h-64" />
            <SkeletonChart className="h-64" />
          </div>
          <SkeletonTable rows={6} />
        </div>
      )}

      {data && (
        <div className="space-y-4 sm:space-y-6">
          {/* KPI row — real figures only; the selected range is the context. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Total Bookings" value={data.kpis.totalBookings.toLocaleString('en-IN')} icon="bookings" accent="blue" sub={rangeLabel(range)} />
            <Kpi label="Total Revenue" value={inr(data.kpis.totalRevenue)} icon="finance" accent="green" sub={rangeLabel(range)} />
            <Kpi label="Outstanding Credit" value={inr(data.kpis.outstandingAmount)} icon="pricing" accent="amber" sub="current balance" />
            <Kpi label="Pending Payments" value={inr(data.paymentOverview.pending)} icon="reports" accent="violet" sub="awaiting settlement" />
            <Kpi label="Active Agencies" value={data.kpis.activeAgencies.toLocaleString('en-IN')} icon="agencies" accent="sky" sub="currently active" />
          </div>

          {/* Row 1: trend + status + recent */}
          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-4">
            <Card title="Booking Trend" className="xl:col-span-2">
              <TrendChart data={data.series.map((s) => ({ day: s.day, bookings: s.bookings, value: s.revenue }))} moneyLabel="Revenue (₹)" height={230} />
            </Card>

            <Card title="Booking Status">
              <Donut
                data={bookingStatusDonut(data.bookingsByStatus)}
                centerValue={data.kpis.totalBookings.toLocaleString('en-IN')}
                centerLabel="Total"
              />
            </Card>

            <Card title="Recent Bookings" action={<Link to="/admin/bookings" className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">View All</Link>}>
              <ul className="space-y-2.5">
                {data.recentBookings.map((b, i) => (
                  <RecentRow key={b.id} b={b} grad={GRADIENTS[i % GRADIENTS.length]} />
                ))}
                {data.recentBookings.length === 0 && <li className="text-xs text-slate-400 dark:text-slate-500">No bookings yet.</li>}
              </ul>
            </Card>
          </div>

          {/* Row 2: top agencies + payment overview + system status */}
          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-4">
            <Card title="Top Performing Agencies" className="xl:col-span-2" action={<Link to="/reports" className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">View All</Link>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      <th className="pb-2">Agency</th>
                      <th className="pb-2 text-right">Bookings</th>
                      <th className="pb-2 text-right">Revenue</th>
                      <th className="pb-2 text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                    {data.topAgencies.map((a) => (
                      <tr key={a.agencyId} className="border-t border-slate-100 dark:border-slate-800/40 hover:bg-slate-50/50 dark:hover:bg-slate-900/10">
                        <td className="py-2.5 font-medium text-slate-750 dark:text-slate-300">{a.agencyName}</td>
                        <td className="py-2.5 text-right text-slate-550 dark:text-slate-400">{a.bookings}</td>
                        <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-white">{inr(a.revenue)}</td>
                        <td className="py-2.5 text-right font-medium text-amber-600 dark:text-amber-400">{inr(a.outstanding)}</td>
                      </tr>
                    ))}
                    {data.topAgencies.length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">No agency revenue yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Payment Overview">
              <Donut
                data={[
                  { name: 'Paid', value: data.paymentOverview.paid, color: '#22c55e' },
                  { name: 'Pending', value: data.paymentOverview.pending, color: '#f59e0b' },
                  { name: 'Failed', value: data.paymentOverview.failed, color: '#ef4444' },
                  { name: 'Refunded', value: data.paymentOverview.refunded, color: '#cbd5e1' },
                ]}
                centerValue={inr(data.paymentOverview.paid)}
                centerLabel="Paid"
                valueFormat={inr}
              />
            </Card>

            <Card title="Integrations" action={<Link to="/admin/integrations" className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">Manage</Link>}>
              {/* Real runtime state per provider — 'Live' when a real integration
                  is active, 'Mock' when the dev/test fallback is serving it. */}
              <ul className="space-y-3">
                {integrations.map((s) => {
                  const healthy = s.live && s.configured;
                  const label = healthy ? 'Live' : s.live ? 'Config missing' : 'Mock';
                  return (
                    <li key={s.key} className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${healthy ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`} />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{s.name}</div>
                        <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{s.category} · {s.provider}</div>
                      </div>
                      <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${healthy ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-450'}`}>{label}</span>
                    </li>
                  );
                })}
                {integrations.length === 0 && <li className="text-xs text-slate-400 dark:text-slate-500">Loading integration status…</li>}
              </ul>
            </Card>
          </div>

          {/* Pending approvals — real applications waiting in REVIEW. */}
          <Card title="Pending Approvals" action={<Link to="/applications" className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">View All ({data.approvals.pendingReview + data.approvals.ekycPending})</Link>}>
            {pendingApps && pendingApps.items.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {pendingApps.items.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-200/50 bg-slate-50/50 dark:border-slate-800/40 dark:bg-slate-900/10 p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"><Icons.agencies className="h-[18px] w-[18px]" /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">{a.isIndependent ? 'Independent Agent' : 'Agency Registration'}</div>
                      <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{a.legalName ?? 'Unnamed application'}</div>
                    </div>
                    <Link to="/applications" className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">Review</Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">No applications waiting for review.</p>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}

const QUICK_ACTIONS: { label: string; to: string; icon: IconName }[] = [
  { label: 'Add Agency', to: '/admin/agencies', icon: 'agencies' },
  { label: 'Pricing & Policies', to: '/admin/pricing', icon: 'pricing' },
  { label: 'Broadcast Notification', to: '/admin/notifications', icon: 'bell' },
  { label: 'Invoices & Finance', to: '/admin/finance', icon: 'reports' },
];

function QuickActions() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 shadow-sm active:scale-95 transition-all"
      >
        <Icons.activity className="h-4 w-4" /> Quick Actions
        <Icons.chevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200/50 bg-white/95 dark:border-slate-800/40 dark:bg-slate-950/95 backdrop-blur-md py-1 shadow-lg animate-fade-in">
          {QUICK_ACTIONS.map((a) => {
            const Icon = Icons[a.icon];
            return (
              <button
                key={a.label}
                onClick={() => {
                  setOpen(false);
                  navigate(a.to);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                  <Icon className="h-4 w-4" />
                </span>
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentRow({ b, grad }: { b: RecentBooking; grad: string }) {
  const ref = `BK-${b.id.slice(0, 8).toUpperCase()}`;
  return (
    <li className="flex items-center gap-2.5 p-1 rounded-xl transition hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
      <div className={`h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br ${grad} shadow-xs`} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{ref}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{b.resortName}</div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{b.guests != null ? `${b.guests} guests · ` : ''}{b.nights}n</div>
      </div>
      <div className="text-right leading-tight">
        <div className={`text-[11px] font-semibold ${STATE_DOT[b.state] ?? 'text-blue-600'}`}>{stateLabel(b.state)}</div>
        <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{inr(b.agencyPrice)}</div>
      </div>
    </li>
  );
}

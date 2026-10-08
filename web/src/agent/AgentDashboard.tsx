import { useQuery } from '@tanstack/react-query';
import { Link } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { Badge, PageHeader, inr, type Tone } from '../components/ui/kit';
import { CountUp } from '../components/ui/CountUp';
import { StatusDonut, TrendChart } from '../components/dashboard/charts';
import { SkeletonStats, SkeletonChart, SkeletonTable } from '../components/ui/Skeleton';
import * as dashboardApi from '../api/dashboard.api';
import type { BookingState } from '../types/booking';
import { Icons } from '../components/layout/icons';

const QUICK_ACTIONS = [
  { label: 'New Booking', to: '/book', primary: true },
  { label: 'Search Resorts', to: '/book' },
  { label: 'View My Bookings', to: '/agent/bookings' },
];

const STATE_TONE: Record<string, Tone> = {
  DRAFT: 'slate',
  AWAITING_PAYMENT: 'amber',
  CONFIRMED_ON_CREDIT: 'blue',
  PAID: 'blue',
  CONFIRMED: 'green',
  COMMITTED: 'green',
  COMMIT_FAILED: 'red',
  CANCELLED: 'red',
  EXPIRED: 'slate',
};

const KPI_ICONS: Record<string, keyof typeof Icons> = {
  'My Bookings': 'bookings',
  "Today's Bookings": 'activity',
  'Upcoming Check-ins': 'resorts',
  'Confirmed': 'shield',
  'Pending': 'sync',
  'Cancelled': 'support',
  'Booking Value': 'finance',
};

const KPI_COLORS: Record<string, { bg: string; text: string; iconBg: string }> = {
  'My Bookings': { bg: 'bg-blue-50/50 dark:bg-blue-950/20', text: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-900/40' },
  "Today's Bookings": { bg: 'bg-sky-50/50 dark:bg-sky-950/20', text: 'text-sky-600 dark:text-sky-400', iconBg: 'bg-sky-100 dark:bg-sky-900/40' },
  'Upcoming Check-ins': { bg: 'bg-violet-50/50 dark:bg-violet-950/20', text: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-900/40' },
  'Confirmed': { bg: 'bg-green-50/50 dark:bg-green-950/20', text: 'text-green-600 dark:text-green-400', iconBg: 'bg-green-100 dark:bg-green-900/40' },
  'Pending': { bg: 'bg-amber-50/50 dark:bg-amber-950/20', text: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-900/40' },
  'Cancelled': { bg: 'bg-red-50/50 dark:bg-red-950/20', text: 'text-red-600 dark:text-red-400', iconBg: 'bg-red-100 dark:bg-red-900/40' },
  'Booking Value': { bg: 'bg-emerald-50/50 dark:bg-emerald-950/20', text: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-900/40' },
};

const lift = 'transition-all duration-300 hover:-translate-y-1 hover:shadow-lg';

export function AgentDashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['agent-summary'],
    queryFn: dashboardApi.getAgentSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const countOf = (states: BookingState[]) =>
    (data?.bookingsByStatus ?? []).filter((s) => states.includes(s.state)).reduce((n, s) => n + s.count, 0);

  const kpis: { label: string; to: number; tone: Tone; fmt?: (n: number) => string; hint?: string }[] = data
    ? [
        { label: 'My Bookings', to: data.kpis.totalBookings, tone: 'blue' },
        { label: "Today's Bookings", to: data.kpis.todayBookings, tone: 'sky' },
        { label: 'Upcoming Check-ins', to: data.kpis.upcomingCheckIns, tone: 'violet' },
        { label: 'Confirmed', to: countOf(['CONFIRMED_ON_CREDIT', 'PAID', 'CONFIRMED', 'COMMITTED']), tone: 'green' },
        { label: 'Pending', to: countOf(['DRAFT', 'AWAITING_PAYMENT']), tone: 'amber' },
        { label: 'Cancelled', to: countOf(['CANCELLED', 'EXPIRED']), tone: 'red' },
        { label: 'Booking Value', to: data.kpis.totalSpend, tone: 'green', fmt: inr, hint: 'My bookings value' },
      ]
    : [];

  return (
    <AppShell>
      <PageHeader title="My Overview" subtitle="Your bookings, activity and quick actions at a glance." />

      {isLoading && (
        <div className="space-y-4">
          <SkeletonStats count={4} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SkeletonChart className="h-60 lg:col-span-2" />
            <SkeletonChart className="h-60" />
          </div>
          <SkeletonTable rows={5} cols={3} />
        </div>
      )}
      {isError && <p className="text-sm text-red-600">Failed to load your overview.</p>}

      {data && (
        <>
          {/* LARGE SCREENS LAYOUT (OLD UI STYLE) */}
          <div className="hidden xl:flex flex-col gap-6">
            
            {/* Welcome Banner Card (Spacious layout) */}
            <div className="animate-fade-up bg-gradient-to-r from-blue-600 to-indigo-700 dark:from-slate-800 dark:to-indigo-950 rounded-3xl p-6 text-white shadow-md relative overflow-hidden">
              <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute left-1/3 bottom-0 translate-y-12 w-48 h-48 bg-blue-500/20 rounded-full blur-2xl pointer-events-none" />
              
              <div className="relative z-10">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Welcome Back!</h1>
                <p className="mt-1.5 text-blue-100 max-w-xl text-sm sm:text-base">
                  Easily search resorts, complete bookings instantly, and manage your clients' stays from one place.
                </p>
                
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {QUICK_ACTIONS.map((a) => (
                    <Link
                      key={a.label}
                      to={a.to}
                      className={`rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-all shadow-sm active:scale-95 ${
                        a.primary
                          ? 'bg-white text-blue-700 hover:bg-blue-50 hover:shadow-md'
                          : 'bg-white/15 text-white hover:bg-white/25 border border-white/20'
                      }`}
                    >
                      {a.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* KPI grid with spacious cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {kpis.map((k, i) => {
                const colors = KPI_COLORS[k.label] || { bg: 'bg-slate-50/50 dark:bg-slate-900/50', text: 'text-slate-600', iconBg: 'bg-slate-100' };
                const IconName = KPI_ICONS[k.label];
                const Icon = IconName ? Icons[IconName] : null;
                return (
                  <div
                    key={k.label}
                    className={`animate-fade-up glass-card rounded-2xl p-5 border border-slate-200/50 dark:border-slate-800/30 flex items-center justify-between ${colors.bg} ${lift}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{k.label}</span>
                      <div className="mt-1 text-2xl font-extrabold text-slate-800 dark:text-white truncate">
                        <CountUp to={k.to} format={k.fmt} />
                      </div>
                      {k.hint && <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500 truncate">{k.hint}</div>}
                    </div>
                    {Icon && (
                      <div className={`p-3 rounded-xl ml-3 shrink-0 ${colors.iconBg} ${colors.text}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className={`animate-fade-up rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 lg:col-span-2 shadow-sm ${lift}`} style={{ animationDelay: '120ms' }}>
                <div className="border-b border-slate-100 dark:border-slate-800/50 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <Icons.reports className="h-4 w-4 text-blue-500" />
                    Booking trend · last 7 days
                  </h2>
                </div>
                <div className="p-5">
                  <TrendChart data={data.series.map((s) => ({ day: s.day, bookings: s.bookings, value: s.spend }))} moneyLabel="Booking value (₹)" height={240} />
                </div>
              </div>
              <div className={`animate-fade-up rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 shadow-sm ${lift}`} style={{ animationDelay: '180ms' }}>
                <div className="border-b border-slate-100 dark:border-slate-800/50 px-5 py-4">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <Icons.reports className="h-4 w-4 text-blue-500" />
                    Bookings by status
                  </h2>
                </div>
                <div className="p-5">
                  <StatusDonut data={data.bookingsByStatus} />
                </div>
              </div>
            </div>

            {/* Timeline-style Recent Bookings (Full width) */}
            <div className={`animate-fade-up rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 shadow-sm overflow-hidden ${lift}`} style={{ animationDelay: '220ms' }}>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 px-5 py-4">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Icons.bookings className="h-4 w-4 text-blue-500" />
                  Recent bookings
                </h2>
                <Link to="/agent/bookings" className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition">View all →</Link>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {data.recentBookings.map((b) => (
                  <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 text-sm transition hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800/50 text-blue-500 shrink-0">
                        <Icons.resorts className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{b.resortName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{b.roomTypeName}</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium">{b.checkIn.slice(0, 10)}</span>
                          <span className="text-slate-300">→</span>
                          <span className="font-medium">{b.checkOut.slice(0, 10)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-4 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t border-slate-100 dark:border-slate-800/30 sm:border-0">
                      <div className="text-left sm:text-right">
                        <div className="font-bold text-slate-800 dark:text-white text-base">{inr(b.agencyPrice)}</div>
                        <div className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">Agency Price</div>
                      </div>
                      <Badge tone={STATE_TONE[b.state] ?? 'slate'}>{b.state.replace(/_/g, ' ')}</Badge>
                    </div>
                  </div>
                ))}
                {data.recentBookings.length === 0 && (
                  <div className="px-5 py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                    <Icons.bookings className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                    No bookings yet.
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* MOBILE & TABLET VIEWPORTS (COMPACT LAYOUT) */}
          <div className="xl:hidden grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
            {/* LEFT COLUMN: Welcome Banner, KPIs, Trend Chart */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Compact Welcome Banner */}
              <div className="animate-fade-up bg-gradient-to-r from-blue-600 to-indigo-700 dark:from-slate-800 dark:to-indigo-950 rounded-2xl p-5 text-white shadow-xs relative overflow-hidden">
                <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute left-1/3 bottom-0 translate-y-12 w-48 h-48 bg-blue-500/20 rounded-full blur-2xl pointer-events-none" />
                
                <div className="relative z-10">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Welcome Back!</h1>
                  <p className="mt-1 text-blue-100 text-xs sm:text-sm max-w-xl">
                    Search resorts, secure instant bookings, and track client stays seamlessly.
                  </p>
                  
                  <div className="mt-4 flex flex-wrap gap-2">
                    {QUICK_ACTIONS.map((a) => (
                      <Link
                        key={a.label}
                        to={a.to}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all shadow-xs active:scale-95 ${
                          a.primary
                            ? 'bg-white text-blue-700 hover:bg-blue-50 hover:shadow-sm'
                            : 'bg-white/15 text-white hover:bg-white/25 border border-white/20'
                        }`}
                      >
                        {a.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* Compact KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {kpis.map((k, i) => {
                  const colors = KPI_COLORS[k.label] || { bg: 'bg-slate-50/50 dark:bg-slate-900/50', text: 'text-slate-600', iconBg: 'bg-slate-100' };
                  const IconName = KPI_ICONS[k.label];
                  const Icon = IconName ? Icons[IconName] : null;
                  const isSpend = k.label === 'Booking Value';
                  
                  return (
                    <div
                      key={k.label}
                      className={`animate-fade-up glass-card rounded-xl p-4 border border-slate-200/50 dark:border-slate-800/30 flex items-center justify-between ${colors.bg} ${lift} ${isSpend ? 'col-span-2 sm:col-span-1' : ''}`}
                      style={{ animationDelay: `${i * 35}ms` }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{k.label}</span>
                        <div className="mt-0.5 text-xl font-extrabold text-slate-800 dark:text-white truncate">
                          <CountUp to={k.to} format={k.fmt} />
                        </div>
                        {k.hint && <div className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500 truncate">{k.hint}</div>}
                      </div>
                      {Icon && (
                        <div className={`p-2.5 rounded-lg ml-2 shrink-0 ${colors.iconBg} ${colors.text}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Trend Chart Card */}
              <div className={`animate-fade-up rounded-xl border border-slate-200/50 bg-white dark:border-slate-800/40 shadow-sm ${lift}`} style={{ animationDelay: '100ms' }}>
                <div className="border-b border-slate-100 dark:border-slate-800/50 px-4 py-3">
                  <h2 className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                    <Icons.reports className="h-4 w-4 text-blue-500" />
                    Booking trend · last 7 days
                  </h2>
                </div>
                <div className="p-4">
                  <TrendChart data={data.series.map((s) => ({ day: s.day, bookings: s.bookings, value: s.spend }))} moneyLabel="Booking value (₹)" height={200} />
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: Status Donut, Recent Bookings */}
            <div className="space-y-6">
              
              {/* Status Donut Card */}
              <div className={`animate-fade-up rounded-xl border border-slate-200/50 bg-white dark:border-slate-800/40 shadow-sm ${lift}`} style={{ animationDelay: '150ms' }}>
                <div className="border-b border-slate-100 dark:border-slate-800/50 px-4 py-3">
                  <h2 className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                    <Icons.reports className="h-4 w-4 text-blue-500" />
                    Bookings by status
                  </h2>
                </div>
                <div className="p-4">
                  <StatusDonut data={data.bookingsByStatus} />
                </div>
              </div>

              {/* Recent Bookings Feed Card */}
              <div className={`animate-fade-up rounded-xl border border-slate-200/50 bg-white dark:border-slate-800/40 shadow-sm overflow-hidden ${lift}`} style={{ animationDelay: '200ms' }}>
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 px-4 py-3">
                  <h2 className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                    <Icons.bookings className="h-4 w-4 text-blue-500" />
                    Recent bookings
                  </h2>
                  <Link to="/agent/bookings" className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition">View all →</Link>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {data.recentBookings.map((b) => (
                    <div key={b.id} className="flex flex-col p-4 text-xs transition hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <div className="flex items-start gap-2.5">
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800/50 text-blue-500 shrink-0">
                          <Icons.resorts className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">{b.resortName}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{b.roomTypeName}</div>
                        </div>
                      </div>
                      
                      <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800/30">
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                          {b.checkIn.slice(5, 10)} to {b.checkOut.slice(5, 10)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-800 dark:text-white">{inr(b.agencyPrice)}</span>
                          <Badge tone={STATE_TONE[b.state] ?? 'slate'}>{b.state.replace(/_/g, ' ')}</Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.recentBookings.length === 0 && (
                    <div className="p-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      <Icons.bookings className="h-6 w-6 mx-auto text-slate-300 dark:text-slate-700 mb-1.5" />
                      No bookings yet.
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { StatCard, inr } from '../components/dashboard/StatCard';
import { StatusDonut, TrendChart } from '../components/dashboard/charts';
import { Icons } from '../components/layout/icons';
import * as dashboardApi from '../api/dashboard.api';
import { SkeletonStats, SkeletonChart, SkeletonTable } from '../components/ui/Skeleton';

const QUICK_ACTIONS = [
  { label: 'New Booking', to: '/book', primary: true },
  { label: 'Add Agent', to: '/agency/agents' },
  { label: 'Make Payment', to: '/agency/payments' },
  { label: 'Download Invoice', to: '/agency/payments' },
];

export function AgencyDashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['agency-summary'],
    queryFn: dashboardApi.getAgencySummary,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <AppShell title="Dashboard">
      {isLoading && (
        <div className="space-y-6">
          <SkeletonStats count={4} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SkeletonChart className="h-64 lg:col-span-2" />
            <SkeletonChart className="h-64" />
          </div>
          <SkeletonTable rows={5} cols={4} />
        </div>
      )}
      {isError && <p className="text-sm text-red-600">Failed to load dashboard.</p>}

      {data && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  a.primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {a.label}
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            <StatCard label="Total Bookings" value={data.kpis.totalBookings.toLocaleString('en-IN')} icon={<Icons.bookings />} accent="blue" />
            <StatCard label="Today's Bookings" value={String(data.kpis.todayBookings)} icon={<Icons.bookings />} accent="sky" />
            <StatCard label="Upcoming Check-ins" value={String(data.kpis.upcomingCheckIns)} icon={<Icons.resorts />} accent="violet" />
            <StatCard label="Booking Value" value={inr(data.kpis.totalSpend)} icon={<Icons.finance />} accent="green" />
            <StatCard label="Outstanding" value={inr(data.kpis.outstanding)} icon={<Icons.reports />} accent="amber" />
            <StatCard label="Available Credit" value={inr(data.kpis.available)} icon={<Icons.agencies />} accent="green" hint={`of ${inr(data.kpis.creditLimit)} limit`} />
            <StatCard label="Active Agents" value={String(data.kpis.activeAgents)} icon={<Icons.agents />} accent="sky" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Bookings &amp; Spend (last 7 days)</h2>
              <TrendChart data={data.series.map((s) => ({ day: s.day, bookings: s.bookings, value: s.spend }))} moneyLabel="Spend (₹)" />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Bookings by Status</h2>
              <StatusDonut data={data.bookingsByStatus} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Recent Bookings</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pb-2">Resort / Room</th>
                  <th className="pb-2">Dates</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBookings.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <div className="text-slate-700">{b.resortName}</div>
                      <div className="text-xs text-slate-400">{b.roomTypeName}</div>
                    </td>
                    <td className="py-2 text-slate-500">{b.checkIn.slice(0, 10)} → {b.checkOut.slice(0, 10)}</td>
                    <td className="py-2 text-slate-600">{b.state}</td>
                    <td className="py-2 text-right font-medium text-slate-900">{inr(b.agencyPrice)}</td>
                  </tr>
                ))}
                {data.recentBookings.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No bookings yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { SkeletonTable } from '../components/ui/Skeleton';
import { Badge, inr, type Tone } from '../components/ui/kit';
import { Icons } from '../components/layout/icons';
import * as bookingApi from '../api/booking.api';
import type { Booking, BookingState } from '../types/booking';

const STATE_TONE: Record<BookingState, Tone> = {
  DRAFT: 'slate',
  AWAITING_PAYMENT: 'amber',
  CONFIRMED_ON_CREDIT: 'blue',
  PAID: 'blue',
  CONFIRMED: 'blue',
  COMMITTED: 'green',
  COMMIT_FAILED: 'red',
  CANCELLED: 'red',
  EXPIRED: 'slate',
};

type TabFilter = 'ALL' | 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export function BookingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabFilter>('ALL');
  
  const { data, isLoading } = useQuery({ queryKey: ['bookings'], queryFn: bookingApi.listBookings });

  const refreshAll = () => {
    ['bookings', 'balance', 'invoices', 'agency-summary', 'agent-summary'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k] }),
    );
  };
  const payMutation = useMutation({ mutationFn: bookingApi.payBooking, onSuccess: refreshAll });
  const cancelMutation = useMutation({ mutationFn: bookingApi.cancelBooking, onSuccess: refreshAll });

  const busy = payMutation.isPending || cancelMutation.isPending;

  // Filter logic
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((b: Booking) => {
      if (activeTab === 'ALL') return true;
      if (activeTab === 'PENDING') return ['DRAFT', 'AWAITING_PAYMENT', 'COMMIT_FAILED'].includes(b.state);
      if (activeTab === 'CONFIRMED') return ['CONFIRMED_ON_CREDIT', 'PAID', 'CONFIRMED', 'COMMITTED'].includes(b.state);
      if (activeTab === 'CANCELLED') return ['CANCELLED', 'EXPIRED'].includes(b.state);
      return true;
    });
  }, [data?.items, activeTab]);

  // Tab count utilities
  const counts = useMemo(() => {
    if (!data?.items) return { ALL: 0, PENDING: 0, CONFIRMED: 0, CANCELLED: 0 };
    return data.items.reduce(
      (acc, b: Booking) => {
        acc.ALL += 1;
        if (['DRAFT', 'AWAITING_PAYMENT', 'COMMIT_FAILED'].includes(b.state)) acc.PENDING += 1;
        else if (['CONFIRMED_ON_CREDIT', 'PAID', 'CONFIRMED', 'COMMITTED'].includes(b.state)) acc.CONFIRMED += 1;
        else if (['CANCELLED', 'EXPIRED'].includes(b.state)) acc.CANCELLED += 1;
        return acc;
      },
      { ALL: 0, PENDING: 0, CONFIRMED: 0, CANCELLED: 0 }
    );
  }, [data?.items]);

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All Bookings', count: counts.ALL },
    { key: 'PENDING', label: 'Pending', count: counts.PENDING },
    { key: 'CONFIRMED', label: 'Confirmed', count: counts.CONFIRMED },
    { key: 'CANCELLED', label: 'Cancelled', count: counts.CANCELLED },
  ];

  return (
    <AppShell>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">My Bookings</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage, track statuses and settle pending bookings.</p>
        </div>
        <Link to="/book" className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm transition-all text-center">
          + New Booking
        </Link>
      </div>

      {/* Categories Tabs Filter */}
      <div className="mb-6 flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 pb-px scrollbar-none">
        <div className="flex gap-2 min-w-max">
          {tabs.map((tab) => {
            const on = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold transition-all -mb-px ${
                  on
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-bold'
                    : 'border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  on ? 'bg-blue-105 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && <SkeletonTable rows={6} cols={5} />}

      {data && (
        <>
          {/* MOBILE VIEWPORTS: Render responsive card list */}
          <div className="lg:hidden space-y-4 pb-20">
            {filteredItems.map((b: Booking) => (
              <div key={b.id} className="rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 p-4 space-y-3.5 shadow-sm transition hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 dark:text-white leading-snug truncate">{b.resortName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{b.roomTypeName}</div>
                  </div>
                  <Badge tone={STATE_TONE[b.state] ?? 'slate'}>{b.state.replace(/_/g, ' ')}</Badge>
                </div>

                <div className="border-t border-b border-slate-100 dark:border-slate-800/40 py-2.5 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Stay Dates</span>
                    <div className="font-medium text-slate-700 dark:text-slate-300 mt-0.5">
                      {b.checkIn.slice(0, 10)} <span className="text-slate-400 font-normal">→</span> {b.checkOut.slice(0, 10)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{b.nights} night{b.nights === 1 ? '' : 's'}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Total Price</span>
                    <div className="font-extrabold text-slate-800 dark:text-white text-sm mt-0.5">{inr(Number(b.agencyPrice))}</div>
                  </div>
                </div>

                {/* Actions row */}
                {(b.state === 'AWAITING_PAYMENT' || ['COMMITTED', 'AWAITING_PAYMENT', 'CONFIRMED_ON_CREDIT'].includes(b.state)) && (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    {b.state === 'AWAITING_PAYMENT' && (
                      <button
                        onClick={() => payMutation.mutate(b.id)}
                        disabled={busy}
                        className="rounded-xl bg-blue-600 hover:bg-blue-700 font-bold text-xs text-white px-4 py-2 shadow-sm transition-all disabled:opacity-40"
                      >
                        {payMutation.isPending ? 'Paying...' : 'Pay Now'}
                      </button>
                    )}
                    {['COMMITTED', 'AWAITING_PAYMENT', 'CONFIRMED_ON_CREDIT'].includes(b.state) && (
                      <button
                        onClick={() => cancelMutation.mutate(b.id)}
                        disabled={busy}
                        className="rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold text-xs text-slate-750 dark:text-slate-300 px-3.5 py-2 transition-all disabled:opacity-40"
                      >
                        Cancel stay
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {filteredItems.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-12 text-center text-sm text-slate-455 dark:text-slate-500">
                <Icons.bookings className="h-8 w-8 mx-auto text-slate-305 mb-2" />
                No bookings found for this filter.
              </div>
            )}
          </div>

          {/* DESKTOP VIEWPORTS: Render clean table */}
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 shadow-sm">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/60 text-left text-xs uppercase font-bold text-slate-450 tracking-wider">
                  <th className="px-5 py-3.5">Resort / Room</th>
                  <th className="px-5 py-3.5">Stay Dates</th>
                  <th className="px-5 py-3.5">Agency Price</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                {filteredItems.map((b: Booking) => (
                  <tr key={b.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{b.resortName}</div>
                      <div className="text-xs text-slate-450 dark:text-slate-450 mt-0.5">{b.roomTypeName}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-700 dark:text-slate-350">
                        {b.checkIn} <span className="text-slate-300 font-normal">→</span> {b.checkOut}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{b.nights} night(s)</div>
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-800 dark:text-white">{inr(Number(b.agencyPrice))}</td>
                    <td className="px-5 py-4">
                      <Badge tone={STATE_TONE[b.state] ?? 'slate'}>
                        {b.state.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {b.state === 'AWAITING_PAYMENT' && (
                          <button
                            onClick={() => payMutation.mutate(b.id)}
                            disabled={busy}
                            className="rounded-xl bg-blue-600 hover:bg-blue-700 font-bold text-xs text-white px-3.5 py-1.5 shadow-sm transition-all disabled:opacity-40"
                          >
                            {payMutation.isPending ? 'Paying...' : 'Pay'}
                          </button>
                        )}
                        {['COMMITTED', 'AWAITING_PAYMENT', 'CONFIRMED_ON_CREDIT'].includes(b.state) && (
                          <button
                            onClick={() => cancelMutation.mutate(b.id)}
                            disabled={busy}
                            className="rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold text-xs text-slate-700 dark:text-slate-300 px-3 py-1.5 transition-all disabled:opacity-40"
                          >
                            Cancel Stay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center text-slate-400 dark:text-slate-500">
                      <Icons.bookings className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                      No bookings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}

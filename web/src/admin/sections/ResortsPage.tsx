import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, DataTable, PageHeader, Tabs, inr, type Column } from '../../components/ui/kit';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Icons } from '../../components/layout/icons';
import * as pricingApi from '../../api/pricing.api';
import type { CatalogResort } from '../../api/pricing.api';

type FlatRoom = { resortName: string } & CatalogResort['rooms'][number];

export function ResortsPage() {
  const [tab, setTab] = useState('resorts');
  const { data, isLoading } = useQuery({ queryKey: ['admin-catalog'], queryFn: pricingApi.getAdminCatalog });
  const resorts = data?.resorts ?? [];
  const rooms = useMemo<FlatRoom[]>(
    () => (data?.resorts ?? []).flatMap((r) => r.rooms.map((rm) => ({ resortName: r.name, ...rm }))),
    [data],
  );

  const roomCols: Column<FlatRoom>[] = [
    { header: 'Room type', className: 'font-medium text-slate-800', render: (r) => r.roomTypeName },
    { header: 'Resort', render: (r) => r.resortName },
    { header: 'Max occupancy', align: 'center', render: (r) => r.maxOccupancy },
    { header: 'Base rate / night', align: 'right', className: 'font-medium text-slate-800', render: (r) => inr(r.baseRatePerNight) },
    { header: 'Day-use rate', align: 'right', render: (r) => (r.dayUseRate != null ? inr(r.dayUseRate) : <span className="text-slate-300">—</span>) },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Resort Management"
        subtitle="Resorts and room inventory — sourced from CRS (read-only)."
      />
      <Tabs
        tabs={[
          { key: 'resorts', label: 'Resorts', count: resorts.length },
          { key: 'rooms', label: 'Room Types', count: rooms.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'resorts' ? (
        isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {resorts.map((r) => (
              <div key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex h-28 items-center justify-center bg-gradient-to-br from-sky-100 to-blue-100 text-blue-500">
                  <Icons.resorts className="h-10 w-10" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-800">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.location}</div>
                    </div>
                    <Badge tone="sky">CRS</Badge>
                  </div>
                  <div className="mt-3 text-xs text-slate-500">{r.roomCount} room type{r.roomCount === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
            {resorts.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
                No resorts returned from CRS.
              </div>
            )}
          </div>
        )
      ) : isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={6} cols={5} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={roomCols} rows={rooms} rowKey={(r) => `${r.resortName}:${r.roomTypeId}`} empty="No room types." />
      )}

      <p className="mt-3 text-xs text-slate-400">
        Resorts, room types and inventory are managed in CRS and shown here read-only. Portal-side rates (net + markup) are in{' '}
        <a href="/admin/pricing" className="text-blue-600 hover:underline">Pricing</a>.
      </p>
    </AppShell>
  );
}

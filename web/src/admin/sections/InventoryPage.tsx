import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, type Column } from '../../components/ui/kit';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as inventoryApi from '../../api/inventory.api';
import type { Allotment, ChannelPolicy } from '../../api/inventory.api';
import * as adminApi from '../../api/admin.api';

export function InventoryPage() {
  const [tab, setTab] = useState('policies');
  return (
    <AppShell>
      <PageHeader title="Channel Inventory" subtitle="Control what the B2B channel can book — stop-sell, allocation caps and per-agency allotments." />
      <Tabs
        tabs={[
          { key: 'policies', label: 'Stop-sell / Caps' },
          { key: 'allotments', label: 'Allotments' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'policies' ? <Policies /> : <Allotments />}
    </AppShell>
  );
}

function Policies() {
  const qc = useQueryClient();
  const { data: policies = [], isLoading } = useQuery({ queryKey: ['channel-policies'], queryFn: inventoryApi.listPolicies });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({ mutationFn: inventoryApi.deletePolicy, onSuccess: () => qc.invalidateQueries({ queryKey: ['channel-policies'] }), onError: (e) => setError(extractError(e)) });

  const cols: Column<ChannelPolicy>[] = [
    { header: 'Resort', className: 'font-mono text-xs text-slate-700', render: (p) => p.resortId },
    { header: 'Room type', render: (p) => p.roomTypeId ?? <span className="text-slate-400">All</span> },
    { header: 'Kind', render: (p) => <Badge tone={p.kind === 'STOP_SELL' ? 'red' : 'amber'}>{p.kind === 'STOP_SELL' ? 'Stop-sell' : 'Cap'}</Badge> },
    { header: 'Dates', render: (p) => <span className="text-slate-500">{p.startDate.slice(0, 10)} → {p.endDate.slice(0, 10)}</span> },
    { header: 'Cap/day', align: 'right', render: (p) => (p.capPerDay ?? '—') },
    { header: 'Note', render: (p) => <span className="text-slate-400">{p.note ?? '—'}</span> },
    { header: 'Actions', align: 'right', render: (p) => <Button variant="ghost" onClick={() => { if (confirm('Delete this policy?')) del.mutate(p.id); }}>Delete</Button> },
  ];

  return (
    <>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => { setError(null); setCreating(true); }}>+ Add Policy</Button></div>
      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><tbody><SkeletonRows rows={4} cols={7} /></tbody></table></div>
      ) : (
        <DataTable columns={cols} rows={policies} rowKey={(p) => p.id} empty="No stop-sell or cap policies. B2B sees full CRS availability." />
      )}
      {creating && <PolicyModal onClose={() => setCreating(false)} />}
    </>
  );
}

function PolicyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ resortId: string; roomTypeId: string; kind: 'STOP_SELL' | 'CAP'; startDate: string; endDate: string; capPerDay: string; note: string }>({
    resortId: '', roomTypeId: '', kind: 'STOP_SELL', startDate: '', endDate: '', capPerDay: '', note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => inventoryApi.createPolicy({
      resortId: form.resortId,
      roomTypeId: form.roomTypeId || undefined,
      kind: form.kind,
      startDate: form.startDate,
      endDate: form.endDate,
      capPerDay: form.kind === 'CAP' ? Number(form.capPerDay) : undefined,
      note: form.note || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['channel-policies'] }); onClose(); },
    onError: (e) => setError(extractError(e)),
  });
  const valid = form.resortId && form.startDate && form.endDate && (form.kind !== 'CAP' || form.capPerDay !== '');
  return (
    <Modal
      title="Add channel policy"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={create.isPending || !valid} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Add policy'}</Button></>}
    >
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Resort ID"><Input value={form.resortId} onChange={(e) => setForm({ ...form, resortId: e.target.value })} placeholder="resort-goa" /></Field>
          <Field label="Room type ID (blank = all)"><Input value={form.roomTypeId} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })} placeholder="goa-deluxe" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind"><Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v as 'STOP_SELL' | 'CAP' })} options={[{ value: 'STOP_SELL', label: 'Stop-sell (blackout)' }, { value: 'CAP', label: 'Cap (rooms/day)' }]} /></Field>
          {form.kind === 'CAP' && <Field label="Cap per day"><Input type="number" min={0} value={form.capPerDay} onChange={(e) => setForm({ ...form, capPerDay: e.target.value })} /></Field>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label="End date"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
        </div>
        <Field label="Note (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Peak dates reserved for direct/OTA" /></Field>
      </div>
    </Modal>
  );
}

function Allotments() {
  const qc = useQueryClient();
  const { data: allotments = [], isLoading } = useQuery({ queryKey: ['allotments'], queryFn: inventoryApi.listAllotments });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({ mutationFn: inventoryApi.deleteAllotment, onSuccess: () => qc.invalidateQueries({ queryKey: ['allotments'] }), onError: (e) => setError(extractError(e)) });

  const cols: Column<Allotment>[] = [
    { header: 'Agency', className: 'font-medium text-slate-800', render: (a) => a.agency?.legalName ?? a.agencyId.slice(0, 8) },
    { header: 'Resort / Room', render: (a) => <span className="font-mono text-xs text-slate-600">{a.resortId} · {a.roomTypeId}</span> },
    { header: 'Dates', render: (a) => <span className="text-slate-500">{a.startDate.slice(0, 10)} → {a.endDate.slice(0, 10)}</span> },
    { header: 'Rooms', align: 'right', render: (a) => a.rooms },
    { header: 'Release', render: (a) => (a.releaseDate ? a.releaseDate.slice(0, 10) : '—') },
    { header: 'Actions', align: 'right', render: (a) => <Button variant="ghost" onClick={() => { if (confirm('Delete this allotment?')) del.mutate(a.id); }}>Delete</Button> },
  ];

  return (
    <>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => { setError(null); setCreating(true); }}>+ Add Allotment</Button></div>
      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><tbody><SkeletonRows rows={4} cols={6} /></tbody></table></div>
      ) : (
        <DataTable columns={cols} rows={allotments} rowKey={(a) => a.id} empty="No allotments. Reserve a block of rooms for a specific agency." />
      )}
      {creating && <AllotmentModal onClose={() => setCreating(false)} />}
    </>
  );
}

function AllotmentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: agencies } = useQuery({ queryKey: ['agencies'], queryFn: adminApi.listAgencies });
  const [form, setForm] = useState({ agencyId: '', resortId: '', roomTypeId: '', startDate: '', endDate: '', rooms: '', releaseDate: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const active = (agencies?.items ?? []).filter((a) => a.status === 'ACTIVE');
  const create = useMutation({
    mutationFn: () => inventoryApi.createAllotment({
      agencyId: form.agencyId, resortId: form.resortId, roomTypeId: form.roomTypeId,
      startDate: form.startDate, endDate: form.endDate, rooms: Number(form.rooms),
      releaseDate: form.releaseDate || undefined, note: form.note || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['allotments'] }); onClose(); },
    onError: (e) => setError(extractError(e)),
  });
  const valid = form.agencyId && form.resortId && form.roomTypeId && form.startDate && form.endDate && form.rooms;
  return (
    <Modal
      title="Add allotment"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={create.isPending || !valid} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Add allotment'}</Button></>}
    >
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        <Field label="Agency"><Select value={form.agencyId} onChange={(v) => setForm({ ...form, agencyId: v })} options={[{ value: '', label: 'Select agency…' }, ...active.map((a) => ({ value: a.id, label: a.legalName }))]} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Resort ID"><Input value={form.resortId} onChange={(e) => setForm({ ...form, resortId: e.target.value })} placeholder="resort-goa" /></Field>
          <Field label="Room type ID"><Input value={form.roomTypeId} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })} placeholder="goa-deluxe" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start date"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label="End date"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
          <Field label="Rooms"><Input type="number" min={1} value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Release date (optional)"><Input type="date" value={form.releaseDate} onChange={(e) => setForm({ ...form, releaseDate: e.target.value })} /></Field>
          <Field label="Note (optional)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Something went wrong';
}

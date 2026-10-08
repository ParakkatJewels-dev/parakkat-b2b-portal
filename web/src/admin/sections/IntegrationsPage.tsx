import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, PageHeader, SearchInput, Stat, Toolbar, type Tone } from '../../components/ui/kit';
import { SkeletonCardGrid, SkeletonRows } from '../../components/ui/Skeleton';
import { Icons, type IconName } from '../../components/layout/icons';
import * as securityApi from '../../api/security.api';
import type { Integration } from '../../api/security.api';

const CATEGORY_ORDER = ['Payments', 'Messaging', 'Verification', 'Inventory', 'Finance'];
const CATEGORY_ICON: Record<string, IconName> = {
  Payments: 'finance',
  Messaging: 'bell',
  Verification: 'shield',
  Inventory: 'sync',
  Finance: 'reports',
};

function sortCategories(a: string, b: string) {
  const ai = CATEGORY_ORDER.indexOf(a);
  const bi = CATEGORY_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

function integrationStatus(i: Integration): { label: string; tone: Tone; dot: string; description: string } {
  if (i.live && i.configured) {
    return {
      label: 'Live',
      tone: 'green',
      dot: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.45)]',
      description: 'Production provider is active',
    };
  }
  if (i.live && !i.configured) {
    return {
      label: 'Needs secrets',
      tone: 'red',
      dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.35)]',
      description: 'Live mode is missing credentials',
    };
  }
  if (i.configured) {
    return {
      label: 'Sandbox',
      tone: 'amber',
      dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]',
      description: 'Configured for mock or test mode',
    };
  }
  return {
    label: 'Disabled',
    tone: 'slate',
    dot: 'bg-slate-300',
    description: 'Provider is not enabled',
  };
}

function providerLabel(provider: string) {
  return provider.replace(/_/g, ' ');
}

export function IntegrationsPage() {
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');

  const integrationsQ = useQuery({
    queryKey: ['security', 'integrations'],
    queryFn: securityApi.getIntegrations,
  });

  const integrations = integrationsQ.data ?? [];
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(integrations.map((i) => i.category))).sort(sortCategories)],
    [integrations],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return integrations.filter((i) => {
      const inCategory = category === 'All' || i.category === category;
      const matches =
        !q ||
        [i.name, i.provider, i.category, integrationStatus(i).label]
          .some((value) => value.toLowerCase().includes(q));
      return inCategory && matches;
    });
  }, [integrations, category, query]);

  const liveCount = integrations.filter((i) => i.live && i.configured).length;
  const sandboxCount = integrations.filter((i) => !i.live && i.configured).length;
  const attentionCount = integrations.filter((i) => i.live && !i.configured).length;
  const disabledCount = integrations.filter((i) => !i.configured).length;

  return (
    <AppShell>
      <PageHeader
        title="Integrations"
        subtitle="Runtime health across payments, messaging, verification, inventory and finance providers."
        actions={
          <Button variant="primary" disabled={integrationsQ.isFetching} onClick={() => integrationsQ.refetch()}>
            <Icons.sync className={`h-4 w-4 ${integrationsQ.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Live providers" value={liveCount} tone="green" hint="Production mode and credentialed" />
        <Stat label="Sandbox / mock" value={sandboxCount} tone="amber" hint="Configured away from live mode" />
        <Stat label="Needs attention" value={attentionCount} tone={attentionCount > 0 ? 'red' : 'slate'} hint="Live providers missing secrets" />
        <Stat label="Disabled" value={disabledCount} tone="slate" hint="Providers not enabled" />
      </div>

      {attentionCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <Icons.lock className="h-4 w-4 shrink-0" />
          {attentionCount} live integration{attentionCount === 1 ? '' : 's'} missing required credentials.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search provider, category or status..." />
            <div className="flex flex-1 flex-wrap justify-start gap-1 md:justify-end">
              {categories.map((cat) => {
                const active = category === cat;
                const count = cat === 'All' ? integrations.length : integrations.filter((i) => i.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {cat}
                    <span className={`rounded-full px-1.5 text-[11px] ${active ? 'bg-blue-100' : 'bg-slate-100'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </Toolbar>
        </div>

        <div className="p-4">
          {integrationsQ.isLoading ? (
            <SkeletonCardGrid count={6} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((i) => (
                <IntegrationCard key={i.key} integration={i} />
              ))}
              {filtered.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">
                  No integrations match this view.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Runtime Matrix</h2>
            <p className="text-xs text-slate-400">Read-only status from deployment configuration</p>
          </div>
          <Badge tone={attentionCount > 0 ? 'red' : 'green'}>{attentionCount > 0 ? 'Action needed' : 'Ready'}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Credentials</th>
              </tr>
            </thead>
            <tbody>
              {integrationsQ.isLoading ? (
                <SkeletonRows rows={5} cols={5} />
              ) : (
                filtered.map((i) => <IntegrationRow key={i.key} integration={i} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const status = integrationStatus(integration);
  const Icon = Icons[CATEGORY_ICON[integration.category] ?? 'integrations'];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-200 hover:bg-slate-50/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-900">{integration.name}</div>
            <div className="mt-0.5 text-xs text-slate-400">{integration.category}</div>
          </div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Metric label="Provider" value={providerLabel(integration.provider)} />
        <Metric label="Mode" value={integration.live ? 'Live' : 'Test'} />
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
        <span>{status.description}</span>
      </div>
    </div>
  );
}

function IntegrationRow({ integration }: { integration: Integration }) {
  const status = integrationStatus(integration);

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
      <td className="px-4 py-3 font-medium text-slate-800">{integration.name}</td>
      <td className="px-4 py-3 text-slate-500">{integration.category}</td>
      <td className="px-4 py-3 capitalize text-slate-600">{providerLabel(integration.provider)}</td>
      <td className="px-4 py-3">
        <Badge tone={status.tone}>{status.label}</Badge>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${integration.configured ? 'text-green-700' : 'text-red-600'}`}>
          <span className={`h-2 w-2 rounded-full ${integration.configured ? 'bg-green-500' : 'bg-red-500'}`} />
          {integration.configured ? 'Configured' : 'Missing'}
        </span>
      </td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate font-medium capitalize text-slate-700">{value}</div>
    </div>
  );
}

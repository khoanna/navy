'use client';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { VaultOverviewCard } from './VaultOverviewCard';
import { StrategyPanel } from './StrategyPanel';
import { DecisionsTable } from './DecisionsTable';
import { HarvestsTable } from './HarvestsTable';
import { ADMIN_NAV } from '@/ui/nav';
import { useAsync } from '@/lib/useAsync';
import { NavyApiError } from '@/lib/navyApi';
import { detailOf } from '@/lib/httpError';
import { colors, space } from '@/ui/theme';
import { ErrorState } from '@/ui/ErrorState';
import { SkeletonList } from '@/ui/SkeletonList';
import type { AdapterAllocation } from './StrategyPanel';

interface StrategyData {
  totalAssets: string;
  allocations: Array<{ adapter: string; name: string; assets: string; percentage: number }>;
}

interface DecisionsData {
  data: Array<{
    decisionHash: string;
    policyVersion: string;
    timestamp: string;
    actionDecision: { action: string; amount: string; targetAdapter: string | null; reason: string };
    reserveBase: string;
  }>;
}

interface HarvestsData {
  harvests: Array<{
    id: string;
    adapter: string;
    protocol: string;
    harvestedAt: string;
    grossBase: string;
    netBase: string;
  }>;
}

interface ApyData {
  adapters: Array<{ address: string; name: string; apyBps: number; tvlBase: string }>;
  aggregateApyBps: number;
  blockNumber: number;
}

export default function VaultAdminPage() {
  const router = useRouter();

  const { data: strategy, loading: strategyLoading, error: strategyError, staleError: strategyStale, retry: retryStrategy } =
    useAsync<StrategyData>(async () => {
      const res = await fetch('/api/admin/vault/strategy');
      if (res.status === 401 || res.status === 403) { router.replace('/admin/login'); throw new NavyApiError('unauthorized', 401); }
      if (!res.ok) throw new NavyApiError('strategy failed', res.status, await detailOf(res));
      return res.json();
    });

  const { data: apyData, loading: apyLoading, error: apyError, staleError: apyStale, retry: retryApy } =
    useAsync<ApyData>(async () => {
      const res = await fetch('/api/admin/vault/apy');
      if (!res.ok) throw new NavyApiError('apy failed', res.status, await detailOf(res));
      return res.json();
    });

  const { data: decisions, loading: decisionsLoading, error: decisionsError, staleError: decisionsStale, retry: retryDecisions } =
    useAsync<DecisionsData>(async () => {
      const res = await fetch('/api/admin/vault/decisions?limit=10');
      if (res.status === 401 || res.status === 403) { router.replace('/admin/login'); throw new NavyApiError('unauthorized', 401); }
      if (!res.ok) throw new NavyApiError('decisions failed', res.status, await detailOf(res));
      return res.json();
    });

  const { data: harvests, loading: harvestsLoading, error: harvestsError, staleError: harvestsStale, retry: retryHarvests } =
    useAsync<HarvestsData>(async () => {
      const res = await fetch('/api/admin/vault/harvests?limit=10');
      if (res.status === 401 || res.status === 403) { router.replace('/admin/login'); throw new NavyApiError('unauthorized', 401); }
      if (!res.ok) throw new NavyApiError('harvests failed', res.status, await detailOf(res));
      return res.json();
    });

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/admin/login'); };

  // Determine last harvest time from the harvests list
  const lastHarvestAt = harvests?.harvests?.[0]?.harvestedAt ?? null;

  // Merge APY data into strategy allocations
  const mergedAllocations: AdapterAllocation[] = (strategy?.allocations ?? []).map((a) => {
    const apyEntry = apyData?.adapters.find((ad) => ad.address.toLowerCase() === a.adapter.toLowerCase());
    return { ...a, apyBps: apyEntry?.apyBps };
  });

  const anyLoading = strategyLoading || apyLoading || decisionsLoading || harvestsLoading;
  const anyError = strategyError || apyError || decisionsError || harvestsError;

  const retry = () => {
    retryStrategy();
    retryApy();
    retryDecisions();
    retryHarvests();
  };

  return (
    <AppShell items={ADMIN_NAV} identity={{ title: 'Admin', subtitle: 'Platform' }} onLogout={logout}>
      <TopBar eyebrow="Admin" title="Vault" />
      {anyLoading && !strategy && !apyData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
          <SkeletonList rows={1} height={132} />
          <SkeletonList rows={1} height={200} />
          <SkeletonList rows={4} height={48} />
        </div>
      ) : anyError && !strategy ? (
        <ErrorState error={anyError} onRetry={retry} />
      ) : (
        <>
          {(strategyStale || apyStale || decisionsStale || harvestsStale) && (
            <button onClick={retry} style={{ marginBottom: space.lg, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <span style={{ color: colors.warning, fontSize: 12 }}>Couldn&apos;t refresh · Retry</span>
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.xl }}>
            <VaultOverviewCard
              data={{
                tvl: strategy?.totalAssets ?? '0',
                aggregateApy: apyData?.aggregateApyBps ?? 0,
                lastHarvestAt,
              }}
            />
            <StrategyPanel allocations={mergedAllocations} loading={strategyLoading} />
            <DecisionsTable
              decisions={decisions?.data ?? []}
              loading={decisionsLoading}
            />
            <HarvestsTable
              harvests={harvests?.harvests ?? []}
              loading={harvestsLoading}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}

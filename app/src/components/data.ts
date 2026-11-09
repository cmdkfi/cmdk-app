// React Query hooks over the adapters. Every key includes the adapter kind so live and sandbox data
// never share a cache entry (PRD §8a "never mix"). Failed reads surface as errors, never as values.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import type { Address } from 'viem'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import type { ActivityWindow, WalletFunding } from '../adapters/types.ts'
import { discoverActiveVault } from '../flow/active-vault.ts'
import { confirmedActivity, loadActivity, saveActivity } from '../flow/caches.ts'
import type { Discovery } from '../flow/entry.ts'

/** When this page load started: data older than this came from the persisted cache (PRD §9 4). */
export const SESSION_START = Date.now()

export function useAppConfig() {
  const { protocol, kind } = useAdapters()
  return useQuery({ queryKey: ['config', kind], queryFn: () => protocol.loadConfig(), staleTime: Infinity, retry: 1 })
}

/** Static deployment data (market params, decimals, Executor feeds), once per session (PRD §9 2). */
export function useDeploymentStatic(enabled = true) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['static', kind], enabled: enabled && !!app, queryFn: () => protocol.readStatic(app!), staleTime: Infinity, retry: 1 })
}

/** Live market read for S1/S2; refreshed every 30 s while the tab is visible; static data from the session query. */
export function useMarketQuote() {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  const statics = useDeploymentStatic().data
  return useQuery({ queryKey: ['quote', kind], enabled: !!app && !!statics, queryFn: () => protocol.readMarketQuote(app!, statics!), refetchInterval: 30_000, retry: false })
}

/** Vault discovery + D4 for the connected owner (FR-4). */
export function useDiscovery(owner: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig()
  const query = useQuery({
    queryKey: ['discovery', kind, owner?.toLowerCase() ?? null],
    enabled: !!owner && !!app.data,
    queryFn: () => discoverActiveVault(protocol, app.data!, owner!, kind),
    staleTime: Infinity,
    retry: false,
  })
  let entry: Discovery
  if (!owner) entry = { kind: 'not-checked' }
  else if (app.isError || query.isError) entry = { kind: 'failed' }
  else if (query.data) entry = { kind: 'found', status: query.data.status }
  else entry = { kind: 'checking' }
  return { entry, result: query.data, retry: () => { void (app.isError ? app.refetch() : query.refetch()) } }
}

export function useAccountKind(address: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['account-kind', kind, address?.toLowerCase() ?? null], enabled: !!address && !!app, queryFn: () => protocol.readAccountKind(app!, address!), staleTime: Infinity, retry: 1 })
}

/** Wallet ETH/WETH and wallet-transaction costs; re-read every 10 s until `funded` holds (S3a, FR-17). */
export function useWalletFunding(owner: Address | undefined, amount: bigint | null, funded: (data: WalletFunding) => boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({
    queryKey: ['funding', kind, owner?.toLowerCase() ?? null, amount?.toString() ?? null],
    enabled: !!owner && !!app && amount !== null,
    queryFn: () => protocol.readWalletFunding(app!, owner!, amount!),
    refetchInterval: query => (query.state.data && funded(query.state.data) ? false : 10_000),
    retry: false,
  })
}

export function useRelayerReadiness(enabled: boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['relayer', kind], enabled: enabled && !!app, queryFn: () => protocol.relayerReadiness(app!), refetchInterval: 30_000, retry: false })
}

/**
 * S5 position snapshot, every 30 s while the tab is visible; on failure React Query keeps the last snapshot (FR-9).
 * The key carries kind, owner and vault: the live one is persisted (main.tsx, flow/caches.ts `persistable`) and shown
 * on return as "refreshing" until a live read lands; it never decides an action.
 */
export function usePosition(vaultId: string | undefined, owner: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  const statics = useDeploymentStatic(!!vaultId).data
  return useQuery({ queryKey: ['position', kind, owner?.toLowerCase() ?? null, vaultId ?? null], enabled: !!app && !!vaultId && !!owner && !!statics, queryFn: () => protocol.readPosition(app!, statics!, vaultId!), refetchInterval: 30_000, retry: false })
}

/** Agent card facts, every 30 s while visible. */
export function useAgent(vaultId: string | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['agent', kind, vaultId ?? null], enabled: !!app && !!vaultId, queryFn: () => protocol.readAgent(app!, vaultId!), refetchInterval: 30_000, retry: false })
}

/**
 * Recent actions in 10,000-block windows; "Load earlier" fetches the next window down (PRD S5, R9). Live mode keeps
 * the confirmed part (≥ 2 confirmations) per position address (PRD §9 3): it is shown at once on return, and only the
 * blocks after it up to the head are fetched before the list is merged.
 */
export function useActivity(positionAddress: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  const cached = useMemo(() => (positionAddress ? loadActivity(kind, positionAddress) : null), [kind, positionAddress])
  const query = useInfiniteQuery({
    queryKey: ['activity', kind, positionAddress?.toLowerCase() ?? null],
    enabled: !!app && !!positionAddress,
    initialPageParam: null as bigint | null,
    queryFn: async ({ pageParam }): Promise<ActivityWindow> => {
      if (pageParam !== null || !cached) return protocol.readActivity(app!, positionAddress!, pageParam)
      // newest blocks only: from the cached range's end + 1 to the head, window by window
      const top = await protocol.readActivity(app!, positionAddress!, null, cached.to + 1n)
      let items = top.items, lowest = top.from
      while (lowest > cached.to + 1n) {
        const w = await protocol.readActivity(app!, positionAddress!, lowest - 1n, cached.to + 1n)
        items = [...items, ...w.items]; lowest = w.from
      }
      return { from: cached.from, to: top.to, head: top.head, items: [...items, ...cached.items], reachedStart: cached.reachedStart }
    },
    getNextPageParam: last => (last.reachedStart ? undefined : last.from - 1n),
    retry: false,
  })
  const pages = query.data?.pages
  useEffect(() => {
    if (!pages?.length || !positionAddress) return
    const keep = confirmedActivity(pages, pages[0].head)
    if (keep) saveActivity(kind, positionAddress, keep)
  }, [pages, kind, positionAddress])
  return { ...query, cached }
}

/**
 * S6 close plan (debt now and 10 min ahead, the relayer's 1% headroom, idle and wallet USDC): read when S5 shows and
 * again on Close position (the review sheet waits for that read); not part of the 30 s refresh (PRD §9 1).
 */
export function useClosePlan(vaultId: string | undefined, owner: Address | undefined, enabled: boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['close-plan', kind, vaultId ?? null, owner?.toLowerCase() ?? null], enabled: enabled && !!app && !!vaultId && !!owner, queryFn: () => protocol.readClosePlan(app!, vaultId!, owner!), retry: false })
}


/** PRD §6 verification facts for one vault: live reads, never persisted; S4 re-checks every 30 s, S5 on open and on request. */
export function useVerification(vaultId: string | undefined, poll: boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['verification', kind, vaultId ?? null], enabled: !!app && !!vaultId, queryFn: () => protocol.readVerification(app!, vaultId!), refetchInterval: poll ? 30_000 : false, staleTime: 0, retry: false })
}

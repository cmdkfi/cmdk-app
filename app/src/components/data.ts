// React Query hooks over the adapters. Every key includes the adapter kind so live and sandbox data
// never share a cache entry (PRD §8a "never mix"). Failed reads surface as errors, never as values.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
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
 * Recent actions in 10,000-block windows; "Load earlier" fetches the next window down (PRD S5, R9). The newest window
 * ends at `toBlock`, the block of the position read, and is extended whenever the position is read again, so the
 * list and the position name the same block (Phase 7b). Only the blocks after the confirmed part (≥ 2 confirmations)
 * are read again; older windows are not re-read. Live mode keeps the confirmed part per position address (PRD §9 3):
 * it is shown at once on return, and only the blocks after it are fetched before the list is merged.
 */
export function useActivity(positionAddress: Address | undefined, toBlock: bigint | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['activity', kind, positionAddress?.toLowerCase() ?? null], [kind, positionAddress])
  const cached = useMemo(() => (positionAddress ? loadActivity(kind, positionAddress) : null), [kind, positionAddress])
  const target = useRef(toBlock)
  target.current = toBlock
  const query = useInfiniteQuery({
    queryKey,
    enabled: !!app && !!positionAddress && toBlock !== undefined,
    initialPageParam: null as bigint | null,
    queryFn: async ({ pageParam }): Promise<ActivityWindow> => {
      const previous = queryClient.getQueryData<InfiniteData<ActivityWindow, bigint | null>>(queryKey)
      if (pageParam !== null) {
        // an older window lies far below the head and is fixed: a refresh reuses it instead of reading it again
        const index = previous?.pageParams.findIndex(p => p === pageParam) ?? -1
        if (previous && index > 0) return previous.pages[index]
        return protocol.readActivity(app!, positionAddress!, pageParam)
      }
      const to = target.current!
      // the confirmed part of what is already shown (this session's newest window, else the saved list)
      const shown = previous?.pages[0]
      const base = shown ? confirmedActivity([shown], shown.head) : cached
      if (!base) return protocol.readActivity(app!, positionAddress!, to)
      if (base.to >= to) return { ...base, head: to, to: base.to }
      // newest blocks only: from the confirmed end + 1 to the position's block, window by window
      const top = await protocol.readActivity(app!, positionAddress!, to, base.to + 1n)
      let items = top.items, lowest = top.from
      while (lowest > base.to + 1n) {
        const w = await protocol.readActivity(app!, positionAddress!, lowest - 1n, base.to + 1n)
        items = [...items, ...w.items]; lowest = w.from
      }
      return { from: base.from, to: top.to, head: top.head, items: [...items, ...base.items], reachedStart: base.reachedStart }
    },
    getNextPageParam: last => (last.reachedStart ? undefined : last.from - 1n),
    retry: false,
  })
  const pages = query.data?.pages
  const top = pages?.[0]?.to
  const { refetch, isFetching } = query
  // a new position read: extend the newest window to its block
  useEffect(() => {
    if (toBlock !== undefined && top !== undefined && toBlock > top && !isFetching) void refetch({ cancelRefetch: false })
  }, [toBlock, top, isFetching, refetch])
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
export function useClosePlan(vaultId: string | undefined, owner: Address | undefined, enabled: boolean, poll = false) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['close-plan', kind, vaultId ?? null, owner?.toLowerCase() ?? null], enabled: enabled && !!app && !!vaultId && !!owner, queryFn: () => protocol.readClosePlan(app!, vaultId!, owner!), refetchInterval: poll ? 10_000 : false, retry: false })
}


/** PRD §6 verification facts for one vault: live reads, never persisted; S4 re-checks every 30 s, S5 on open and on request. */
export function useVerification(vaultId: string | undefined, poll: boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['verification', kind, vaultId ?? null], enabled: !!app && !!vaultId, queryFn: () => protocol.readVerification(app!, vaultId!), refetchInterval: poll ? 30_000 : false, staleTime: 0, retry: false })
}

/** Sandbox only (PRD §8a.1): the market crash of the open position; disabled on the live adapter, which has no `crash`. */
export function useCrash(vaultId: string | undefined) {
  const { kind, protocol } = useAdapters()
  return useQuery({ queryKey: ['crash', kind, vaultId ?? null], enabled: !!protocol.crash && !!vaultId, queryFn: () => protocol.crash!.read(), retry: false })
}

/** Runs the crash or advances it one stage, then re-reads everything the stage changed (hero, track, agent, actions, close plan). */
export function useCrashStep() {
  const { kind, protocol } = useAdapters()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (step: 'run' | 'next') => (step === 'run' ? protocol.crash!.run() : protocol.crash!.next()),
    onSettled: () => Promise.all(['crash', 'position', 'agent', 'activity', 'close-plan'].map(key => queryClient.invalidateQueries({ queryKey: [key, kind] }))),
  })
}

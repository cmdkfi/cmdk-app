// React Query hooks over the adapters. Every key includes the adapter kind so live and sandbox data
// never share a cache entry (PRD §8a "never mix"). Failed reads surface as errors, never as values.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useAdapters } from '../adapters/AdapterProvider.tsx'
import type { WalletFunding } from '../adapters/types.ts'
import { discoverActiveVault } from '../flow/active-vault.ts'
import type { Discovery } from '../flow/entry.ts'

export function useAppConfig() {
  const { protocol, kind } = useAdapters()
  return useQuery({ queryKey: ['config', kind], queryFn: () => protocol.loadConfig(), staleTime: Infinity, retry: 1 })
}

/** Live market read for S1/S2; refreshed every 30 s while the tab is visible. */
export function useMarketQuote() {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['quote', kind], enabled: !!app, queryFn: () => protocol.readMarketQuote(app!), refetchInterval: 30_000, retry: false })
}

/** Vault discovery + D4 for the connected owner (FR-4). */
export function useDiscovery(owner: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig()
  const query = useQuery({
    queryKey: ['discovery', kind, owner?.toLowerCase() ?? null],
    enabled: !!owner && !!app.data,
    queryFn: () => discoverActiveVault(protocol, app.data!, owner!),
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

/** S5 position snapshot, every 30 s while the tab is visible; on failure React Query keeps the last snapshot (FR-9). */
export function usePosition(vaultId: string | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['position', kind, vaultId ?? null], enabled: !!app && !!vaultId, queryFn: () => protocol.readPosition(app!, vaultId!), refetchInterval: 30_000, retry: false })
}

/** Agent card facts, every 30 s while visible. */
export function useAgent(vaultId: string | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['agent', kind, vaultId ?? null], enabled: !!app && !!vaultId, queryFn: () => protocol.readAgent(app!, vaultId!), refetchInterval: 30_000, retry: false })
}

/** Recent actions in 10,000-block windows; "Load earlier" fetches the next window down (PRD S5, R9). */
export function useActivity(positionAddress: Address | undefined) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useInfiniteQuery({
    queryKey: ['activity', kind, positionAddress?.toLowerCase() ?? null],
    enabled: !!app && !!positionAddress,
    initialPageParam: null as bigint | null,
    queryFn: ({ pageParam }) => protocol.readActivity(app!, positionAddress!, pageParam),
    getNextPageParam: last => (last.reachedStart ? undefined : last.from - 1n),
    retry: false,
  })
}

/** S6 close plan (debt now and 10 min ahead, the relayer's 1% headroom, idle and wallet USDC); every 30 s while shown. */
export function useClosePlan(vaultId: string | undefined, owner: Address | undefined, enabled: boolean) {
  const { protocol, kind } = useAdapters()
  const app = useAppConfig().data
  return useQuery({ queryKey: ['close-plan', kind, vaultId ?? null, owner?.toLowerCase() ?? null], enabled: enabled && !!app && !!vaultId && !!owner, queryFn: () => protocol.readClosePlan(app!, vaultId!, owner!), refetchInterval: 30_000, retry: false })
}


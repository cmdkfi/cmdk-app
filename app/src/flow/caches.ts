// Browser caches of the performance pass (PRD §9 "Reads and caching" 3-5). Rules for every cache: live mode only (the
// sandbox never persists); keys include the mode and the owner or position address; each value carries its block;
// cached data only paints the screen and never decides an action (the chains read live before every prompt).
import type { ActivityItem } from '../adapters/types.ts'
import { parseBig, stringifyBig } from './json.ts'
import type { StorageMode } from './session.ts'

function local(): Storage | null {
  try { return window.localStorage } catch { return null }
}
function read<T>(key: string): T | null {
  try { const text = local()?.getItem(key); return text ? parseBig<T>(text) : null } catch { return null }
}
function write(key: string, value: unknown | null) {
  try { if (value === null) local()?.removeItem(key); else local()?.setItem(key, stringifyBig(value)) } catch { /* storage unavailable */ }
}

// ---- 5. the owned vault per owner (verified with one get_state before use) ----------------------------------------
export const vaultHintKey = (factory: string, owner: string) => `cmdk.live.vault.v1.${factory}:${owner.toLowerCase()}`
export const loadVaultHint = (mode: StorageMode, factory: string, owner: string) => (mode === 'live' ? read<string>(vaultHintKey(factory, owner)) : null)
export function saveVaultHint(mode: StorageMode, factory: string, owner: string, vault: string | null) {
  if (mode === 'live') write(vaultHintKey(factory, owner), vault)
}

// ---- 4. the persisted query cache: only live position snapshots keyed by owner and vault --------------------------
export const QUERY_CACHE_KEY = 'cmdk.live.queries.v1'
/** ['position', 'live', owner, vault] only; anything else (sandbox, discovery, plans, agent) is never persisted. */
export function persistable(queryKey: readonly unknown[]): boolean {
  const [name, kind, owner, vault] = queryKey
  return name === 'position' && kind === 'live' && typeof owner === 'string' && /^0x[0-9a-f]{40}$/.test(owner) && typeof vault === 'string' && vault.length > 0
}

// ---- 3. recent actions per position address --------------------------------------------------------------------
export type ActivityCache = { version: 1; from: bigint; to: bigint; reachedStart: boolean; items: ActivityItem[] }
export const activityKey = (positionAddress: string) => `cmdk.live.activity.v1.${positionAddress.toLowerCase()}`

export function loadActivity(mode: StorageMode, positionAddress: string): ActivityCache | null {
  if (mode !== 'live') return null
  const c = read<ActivityCache>(activityKey(positionAddress))
  return c && c.version === 1 && typeof c.from === 'bigint' && typeof c.to === 'bigint' && Array.isArray(c.items) ? c : null
}
export function saveActivity(mode: StorageMode, positionAddress: string, cache: ActivityCache | null) {
  if (mode === 'live') write(activityKey(positionAddress), cache)
}

/**
 * The part of a contiguous run of windows (newest first) that may be kept: blocks with at least two confirmations at
 * `head` (confirmations = head − block + 1 ≥ 2, the receipt rule of FR-5), so the cache never holds a log a reorg
 * could still remove. Null when nothing is confirmed yet.
 */
export function confirmedActivity(pages: { from: bigint; to: bigint; reachedStart: boolean; items: ActivityItem[] }[], head: bigint): ActivityCache | null {
  if (pages.length === 0) return null
  const from = pages[pages.length - 1].from
  const to = pages[0].to < head - 1n ? pages[0].to : head - 1n
  if (to < from) return null
  return { version: 1, from, to, reachedStart: pages[pages.length - 1].reachedStart, items: pages.flatMap(p => p.items).filter(i => i.blockNumber <= to) }
}

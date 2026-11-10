// Owner messages: what the owner's wallet signs (ERC-191) and the vault verifies (cmdkfi/app 47fd4fb).
import { recoverMessageAddress } from 'viem'
import { allowancePresent } from '../base/math.ts'
import { MEASUREMENT_KEYS, type Measurement } from '../near/vault.ts'

/** vault/src/owner.rs l.9-14. */
export const PROTOCOL = 'cmdk-vault/1'
export const NETWORK = 'testnet'
export const MAX_EXPIRY_AHEAD_SECS = 3600
/** scripts/p2_owner.py l.33 (`--ttl` default 600). */
export const DEFAULT_TTL_SECS = 600

export type OwnerMethod = 'setup' | 'open' | 'withdraw' | 'close' | 'revoke_agent'
type Hex = `0x${string}`

const VAULT = /^v[1-9][0-9]*\.[a-z0-9._-]+$/

/**
 * The exact JSON text the owner signs: fields in the order of vault/src/owner.rs l.21-31 (`OwnerMessage`), no
 * whitespace, as scripts/p2_owner.py l.38-39 builds it with `json.dumps(..., separators=(',', ':'))`.
 */
export function ownerMessage(m: { vault: string; method: OwnerMethod; args: Record<string, unknown>; nonce: number; expiry: number }): string {
  if (!VAULT.test(m.vault)) throw new Error('Owner messages are only for factory vaults (v<n>.<factory>).')
  if (!Number.isSafeInteger(m.nonce) || m.nonce < 1) throw new Error('The nonce must be a positive integer.')
  if (!Number.isSafeInteger(m.expiry) || m.expiry < 1) throw new Error('The expiry must be a unix time in seconds.')
  return JSON.stringify({ protocol: PROTOCOL, network: NETWORK, vault: m.vault, method: m.method, args: m.args, nonce: m.nonce, expiry: m.expiry })
}

/** A percentage with at most one decimal as a WAD decimal string (Executor.sol Corridor fields are WAD, l.22-32). */
export function wad(percent: number): string {
  const tenths = Math.round(percent * 10)
  if (!Number.isFinite(percent) || Math.abs(percent * 10 - tenths) > 1e-9 || tenths < 0) throw new Error('Use a percentage with at most one decimal.')
  return (BigInt(tenths) * 10n ** 15n).toString()
}

export type CorridorRules = { floor: number; target: number; act: number; budget: number; migrate: boolean; exit: boolean }
export type CorridorArgs = { target: string; act: string; floor: string; sell_budget: string; migrate_allowed: boolean; exit_allowed: boolean }

/** Corridor JSON in the field order of vault/src/lib.rs l.147-155 (`Corridor`). */
export function corridorArgs(r: CorridorRules): CorridorArgs {
  return { target: wad(r.target), act: wad(r.act), floor: wad(r.floor), sell_budget: wad(r.budget), migrate_allowed: r.migrate, exit_allowed: r.exit }
}

/** executor/src/CorridorMath.sol l.77-83 `corridorValid` (TARGET_TOLERANCE = 0.001e18, l.15). */
export function corridorValid(c: CorridorArgs, lltv: bigint): boolean {
  const [floor, target, act, budget] = [c.floor, c.target, c.act, c.sell_budget].map(BigInt)
  return floor < target && target + 10n ** 15n < act && act < lltv && budget <= 10n ** 18n
}

/** Base facts of one vault market, as setup needs them. */
export type SetupFact = { market: Hex; executor: Hex; authorized: boolean; loanAllowance: bigint; collateralAllowance: bigint; corridorSet: boolean; lltv: bigint }

/**
 * Setup is complete when, for every market, Morpho authorization is present, both allowances are above zero
 * (scripts/relayer.py l.478-483 refuses only a zero allowance), the corridor is set on Base (the relayer's
 * `vault_view` note: "corridor.set on Base is the source of truth"), and the vault approved the published measurement.
 */
export function setupComplete(facts: SetupFact[], measurementApproved: boolean): boolean {
  return measurementApproved && facts.length > 0 && facts.every(f => f.authorized && allowancePresent(f.loanAllowance) && allowancePresent(f.collateralAllowance) && f.corridorSet)
}

export type SetupArgs = {
  markets: { market: Hex; approve: boolean; authorize: boolean; corridor: CorridorArgs | null }[]
  measurement: Measurement | null
}

/**
 * `setup` args (vault/src/lib.rs l.131-145 `SetupArgs`/`SetupMarket`, arm l.284-320). `approve` is always true:
 * a repeated approve is allowed (relayer.py l.466) and the vault emits it once per message. `authorize` must match
 * Base per executor (relayer.py l.468-477): true on the first market of an executor Morpho has not authorized,
 * false everywhere else. A corridor is sent only where Base has none, and must be valid for that market's LLTV.
 */
export function setupArgs(facts: SetupFact[], rules: CorridorRules, measurement: Measurement, measurementApproved: boolean): SetupArgs {
  if (facts.length === 0) throw new Error('Setup needs the vault markets.')
  const authorizing = new Set<string>()
  const markets = facts.map(f => {
    const executor = f.executor.toLowerCase()
    const authorize = !f.authorized && !authorizing.has(executor)
    if (authorize) authorizing.add(executor)
    let corridor: CorridorArgs | null = null
    if (!f.corridorSet) {
      corridor = corridorArgs(rules)
      if (!corridorValid(corridor, f.lltv)) throw new Error(`The corridor is not valid for market ${f.market} (its liquidation LTV is ${f.lltv}).`)
    }
    return { market: f.market, approve: true, authorize, corridor }
  })
  const ordered = Object.fromEntries(MEASUREMENT_KEYS.map(key => [key, measurement[key]])) as Measurement
  return { markets, measurement: measurementApproved ? null : ordered }
}

/** vault/src/lib.rs l.168-173 `OpenArgs`; amounts are U128 decimal strings. */
export function openArgs(market: Hex, collateralIn: bigint, targetLtv: bigint) {
  return { market, collateral_in: collateralIn.toString(), target_ltv: targetLtv.toString() }
}

/** vault/src/lib.rs l.187-193 `WithdrawArgs`; the vault refuses a zero amount or destination (l.360-369). */
export function withdrawArgs(token: Hex, amount: bigint, destination: Hex) {
  if (amount <= 0n) throw new Error('A withdrawal needs an amount above zero.')
  return { token, amount: amount.toString(), destination }
}

/** vault/src/lib.rs l.126-129 `MarketArg`, used by `close` (l.356-359). */
export function closeArgs(market: Hex) {
  return { market }
}

/**
 * vault/src/lib.rs l.419-424 `revoke_agent` (`NoArgs`): deletes the agent's key and clears the approved measurement in one
 * NEAR transaction, no Base transaction; scripts/relayer.py OWNER_ARGS lists it with no fields. Signed as `args: {}`.
 */
export function revokeAgentArgs(): Record<string, never> {
  return {}
}

/** Expiry for a message signed now, from chain time (owner.rs l.14: at most 3600 s ahead). */
export function expiryFor(chainNowSecs: number, ttl = DEFAULT_TTL_SECS): number {
  if (!(ttl > 0 && ttl <= MAX_EXPIRY_AHEAD_SECS)) throw new Error('The message lifetime must be 1–3600 seconds.')
  return chainNowSecs + ttl
}

/** owner.rs l.73: the nonce must be above the vault's last owner nonce. */
export function nonceAccepted(nonce: number, ownerNonce: number): boolean {
  return nonce > ownerNonce
}

/** owner.rs l.77-80: refused when chain time is past the expiry; valid at the expiry itself. */
export function messageExpired(expiry: number, chainNowSecs: number): boolean {
  return chainNowSecs > expiry
}

const HALF_ORDER = BigInt('0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0')

/**
 * ERC-191 signer of an owner message (owner.rs l.36-50): 65 bytes r‖s‖v with v = 27/28 or 0/1; the NEAR host
 * rejects a high s (malleability flag), so this does too.
 */
export async function recoverOwner(message: string, signature: string): Promise<Hex> {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('The signature must be 65 bytes.')
  const v = parseInt(signature.slice(130, 132), 16)
  if (![0, 1, 27, 28].includes(v)) throw new Error('The signature has an invalid recovery byte.')
  if (BigInt(`0x${signature.slice(66, 130)}`) > HALF_ORDER) throw new Error('The signature has a high-s value.')
  const normalized = (v < 27 ? `${signature.slice(0, 130)}${(v + 27).toString(16)}` : signature) as Hex
  return recoverMessageAddress({ message, signature: normalized })
}

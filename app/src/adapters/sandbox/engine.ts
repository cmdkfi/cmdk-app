// The sandbox's simulated protocol (PRD §8a, Phase 6b): one in-memory state behind both sandbox adapters, advanced by
// the clock when it is read (no timers), kept in sessionStorage only so a reload stays in the sandbox and closing the tab
// discards it. It never touches the network, wagmi, viem or protocol/ (src/import-boundary.test.mjs).
//
// Stages take 2 s each (PRD §8a "1–3 s") and the agent registers 5 s after setup. The price never moves on a timer: it
// moves only when the user runs the market crash (PRD §8a.1, Phase 11), three stages each advanced by the user. After
// each price move the simulated agent's protective reduce runs if LTV is past the act line, with the protocol's own math:
// CorridorMath.repayToLtv (executor/src/CorridorMath.sol l.39-46) to the target, with no budget clamp and not counted
// against the discretionary sell budget, as Executor.reduce's protective branch does (Executor.sol l.261-266, l.296).
// Beside it the engine calculates what Morpho Blue would have done to the same loan without the agent (withoutAgent).
import type { CrashStage, CrashStart } from '../types.ts'
import { parseBig, stringifyBig } from '../../flow/json.ts'

type Hex = `0x${string}`

export const WAD = 10n ** 18n
const ORACLE_SCALE = 10n ** 36n
const YEAR = 31_536_000n
export const STAGE_MS = 2_000
export const REGISTER_MS = 5_000
const BLOCK_MS = 2_000
const FIRST_BLOCK = 30_000_000n
/** $3,210 per ETH in the oracle's scale (loan 6 decimals, collateral 18): value = collateral × price / 1e36. */
export const START_PRICE = 3210n * 10n ** 24n
export const RATE_APR_WAD = 5n * 10n ** 16n
const OWNER_CALL_GAS = 10n ** 13n
const WALLET_TX_GAS = 2n * 10n ** 13n
export const FLOAT_WEI = 5n * 10n ** 15n
// v2: the market crash replaced the timed drop (Phase 11); a v1 state from an earlier tab is discarded
export const STORAGE_KEY = 'cmdk.sandbox.engine.v2'
/** The simulated market's liquidation LTV (the live market's 86%, PRD §1). */
export const LLTV = 86n * 10n ** 16n
/** The crash's price path as a share of the price when the run starts (PRD §8a.1): −30%, −45%, back to the start. */
export const CRASH_PATH = [70n, 55n, 100n] as const

// Morpho Blue constants, from the source (morpho-org/morpho-blue 430bd61, src/libraries/ConstantsLib.sol l.11, l.14)
export const LIQUIDATION_CURSOR = 3n * 10n ** 17n
export const MAX_LIQUIDATION_INCENTIVE_FACTOR = 115n * 10n ** 16n

export const SANDBOX_OWNER = '0x5a4d5a4d5a4d5a4d5a4d5a4d5a4d5a4d5a4d0001' as Hex
export const SANDBOX_POSITION = '0x5a4d5a4d5a4d5a4d5a4d5a4d5a4d5a4d5a4d0b5e' as Hex

export type Corridor = { target: bigint; act: bigint; floor: bigint; budget: bigint }

export type SimEvent = { name: string; actor: 'you' | 'agent' | 'transfer'; at: number; hash: Hex; logIndex: number; args: Record<string, unknown>; token?: 'weth' | 'usdc' }

export type SimVault = {
  createdAt: number
  ownerNonce: number
  approved: boolean
  setupAt: number | null
  idle: { eth: bigint; weth: bigint; usdc: bigint }
  collateral: bigint
  /** Debt is principal accrued at RATE_APR_WAD simple interest since `debtSince` (ms). */
  principal: bigint
  debtSince: number
  openedAt: number | null
  /** USDC borrowed by the open (the Opened event's `borrowed`). */
  borrowed: bigint
  /** The market crash of this position (PRD §8a.1): null until it is run; reset by every open (once per position). */
  crash: SimCrash | null
}

export type SimCrash = {
  status: 'running' | 'done'
  start: CrashStart
  /** The same loan without the agent: Morpho alone acts on it (withoutAgent). */
  without: { collateral: bigint; debt: bigint; liquidated: boolean }
  stages: CrashStage[]
}

type Job = { kind: 'create' | 'owner'; createdAt: number; doneAt: number; applied: boolean; method?: string; args?: Record<string, string>; nonce?: number; receipts: Hex[]; failed?: string }

export type State = {
  v: 2
  startedAt: number
  counter: number
  price: bigint
  wallet: { eth: bigint; weth: bigint; usdc: bigint }
  vault: SimVault | null
  jobs: Record<string, Job>
  txs: Record<string, { sentAt: number }>
  events: SimEvent[]
}

/** CorridorMath.repayToLtv (executor/src/CorridorMath.sol l.39-46): repay that brings debt/value to t. */
export function repayToLtv(debt: bigint, collValue: bigint, t: bigint): bigint {
  if (t >= WAD) return 0n
  const dw = debt * WAD, tv = t * collValue
  if (dw <= tv) return 0n
  const x = (dw - tv) / (WAD - t)
  return x > debt ? debt : x
}
export const valueOf = (collateral: bigint, price: bigint) => collateral * price / ORACLE_SCALE
export const ltvOf = (debt: bigint, value: bigint) => (value === 0n ? (debt > 0n ? null : 0n) : debt * WAD / value)

const wMulDown = (x: bigint, y: bigint) => x * y / WAD
const wDivDown = (x: bigint, y: bigint) => x * WAD / y

/** Morpho.sol liquidate l.365-369: min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD.wDivDown(WAD − LIQUIDATION_CURSOR.wMulDown(WAD − lltv))). */
export function liquidationIncentiveFactor(lltv: bigint): bigint {
  const factor = wDivDown(WAD, WAD - wMulDown(LIQUIDATION_CURSOR, WAD - lltv))
  return factor < MAX_LIQUIDATION_INCENTIVE_FACTOR ? factor : MAX_LIQUIDATION_INCENTIVE_FACTOR
}

/** Morpho.sol _isHealthy l.527-539: collateral.mulDivDown(price, ORACLE_PRICE_SCALE).wMulDown(lltv) ≥ borrowed. */
export function isHealthy(collateral: bigint, debt: bigint, price: bigint, lltv: bigint): boolean {
  return wMulDown(collateral * price / ORACLE_SCALE, lltv) >= debt
}

/**
 * What Morpho Blue would do to a loan with no agent at `price` (PRD §8a.1 "without the agent", a calculation): nothing
 * while it is healthy; once it is not, a liquidator repays the whole debt and seizes
 * debt.wMulDown(LIF).mulDivDown(ORACLE_PRICE_SCALE, price) of collateral (Morpho.sol liquidate l.377-379, the
 * repaid-amount branch), capped at the collateral. The rest of the collateral stays the borrower's; a debt the
 * collateral cannot cover would be Morpho's bad debt (l.390-396), so the borrower owes nothing either way.
 */
export function withoutAgent(collateral: bigint, debt: bigint, price: bigint, lltv: bigint): { collateral: bigint; debt: bigint; liquidation: { repaid: bigint; seized: bigint; ltvBefore: bigint | null } | null } {
  if (debt === 0n || isHealthy(collateral, debt, price, lltv)) return { collateral, debt, liquidation: null }
  const wanted = wMulDown(debt, liquidationIncentiveFactor(lltv)) * ORACLE_SCALE / price
  const seized = wanted > collateral ? collateral : wanted
  return { collateral: collateral - seized, debt: 0n, liquidation: { repaid: debt, seized, ltvBefore: ltvOf(debt, valueOf(collateral, price)) } }
}

function fresh(now: number): State {
  return { v: 2, startedAt: now, counter: 0, price: START_PRICE, wallet: { eth: 10n * WAD, weth: 0n, usdc: 5_000n * 10n ** 6n }, vault: null, jobs: {}, txs: {}, events: [] }
}

function storage(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

export class SandboxEngine {
  private s: State
  private disposed = false
  readonly corridor: Corridor
  private readonly clock: () => number

  constructor(corridor: Corridor, clock: () => number = () => Date.now(), load = true) {
    this.corridor = corridor
    this.clock = clock
    let restored: State | null = null
    if (load) try { const text = storage()?.getItem(STORAGE_KEY); restored = text ? parseBig<State>(text) : null } catch { restored = null }
    this.s = restored && restored.v === 2 ? restored : fresh(this.clock())
  }

  dispose() { this.disposed = true }
  private save() {
    if (this.disposed) return
    try { storage()?.setItem(STORAGE_KEY, stringifyBig(this.s)) } catch { /* sessionStorage unavailable: memory only */ }
  }

  now() { return this.clock() }
  blockAt(ms: number): bigint { return FIRST_BLOCK + BigInt(Math.max(0, Math.floor((ms - this.s.startedAt) / BLOCK_MS))) }
  firstBlock() { return FIRST_BLOCK }
  timeOfBlock(block: bigint): number { return this.s.startedAt + Number(block - FIRST_BLOCK) * BLOCK_MS }
  private hash(): Hex { this.s.counter++; return `0x5a4d${this.s.counter.toString(16).padStart(60, '0')}` as Hex }
  private id(): string { this.s.counter++; return `5a4d${this.s.counter.toString(16).padStart(12, '0')}` }

  debt(at = this.now()): bigint {
    const v = this.s.vault
    if (!v || v.principal === 0n) return 0n
    const elapsed = BigInt(Math.max(0, Math.floor((at - v.debtSince) / 1000)))
    return v.principal + v.principal * RATE_APR_WAD * elapsed / (YEAR * WAD)
  }

  /** Applies every relayer stage whose time has come, in time order, then persists. Nothing else moves on time. */
  advance(): State {
    const now = this.now()
    let changed = false
    for (;;) {
      const next = this.nextDue(now)
      if (!next) break
      next()
      changed = true
    }
    if (changed) this.save()
    return this.s
  }

  private nextDue(now: number): (() => void) | null {
    const due: { at: number; run: () => void }[] = []
    for (const [id, job] of Object.entries(this.s.jobs)) if (!job.applied && job.doneAt <= now) due.push({ at: job.doneAt, run: () => this.applyJob(id) })
    due.sort((a, b) => a.at - b.at)
    return due[0]?.run ?? null
  }

  /** The agent registers its key REGISTER_MS after the setup job (derived, PRD §8a "~5 s"). */
  registeredAt(): number | null {
    const v = this.s.vault
    return v?.approved && v.setupAt !== null && v.setupAt + REGISTER_MS <= this.now() ? v.setupAt + REGISTER_MS : null
  }

  private event(e: Omit<SimEvent, 'hash' | 'logIndex'> & { hash?: Hex }) {
    const hash = e.hash ?? this.hash()
    this.s.events.push({ ...e, hash, logIndex: this.s.events.filter(x => x.hash === hash).length })
    return hash
  }

  private applyJob(id: string) {
    const job = this.s.jobs[id]
    job.applied = true
    const at = job.doneAt
    if (job.kind === 'create') {
      this.s.vault = { createdAt: at, ownerNonce: 0, approved: false, setupAt: null, idle: { eth: FLOAT_WEI, weth: 0n, usdc: 0n }, collateral: 0n, principal: 0n, debtSince: at, openedAt: null, borrowed: 0n, crash: null }
      return
    }
    const v = this.s.vault!
    const args = job.args ?? {}
    v.ownerNonce = job.nonce!
    v.idle.eth -= OWNER_CALL_GAS
    const receipt = this.hash()
    job.receipts = [receipt]
    switch (job.method) {
      case 'setup': {
        v.approved = true; v.setupAt = at
        // the live setup sets the corridor on both markets, each in its own Base transaction (vault/src/lib.rs
        // l.289-320, PRD fact 3), so recent actions show one row per market
        const backup = this.hash()
        job.receipts = [receipt, backup]
        this.event({ name: 'CorridorSet', actor: 'you', at, hash: receipt, args: { market: 'live' } })
        this.event({ name: 'CorridorSet', actor: 'you', at, hash: backup, args: { market: 'backup' } })
        break
      }
      case 'open': {
        const collateralIn = BigInt(args.collateral_in), target = BigInt(args.target_ltv)
        v.idle.weth -= collateralIn; v.collateral += collateralIn
        const borrowed = valueOf(v.collateral, this.s.price) * target / WAD
        v.principal = borrowed; v.debtSince = at; v.idle.usdc += borrowed; v.openedAt = at; v.borrowed = borrowed; v.crash = null
        this.event({ name: 'Opened', actor: 'you', at, hash: receipt, args: { market: 'live', collateralIn, borrowed, ltv: target } })
        break
      }
      case 'withdraw': {
        const token = args.token === 'weth' ? 'weth' : 'usdc', amount = BigInt(args.amount)
        v.idle[token] -= amount; this.s.wallet[token] += amount
        this.event({ name: 'Transfer', actor: 'transfer', at, hash: receipt, token, args: { from: SANDBOX_POSITION, to: SANDBOX_OWNER, value: amount } })
        break
      }
      case 'close': {
        const debt = this.debt(at)
        v.idle.usdc -= debt; v.principal = 0n; v.debtSince = at
        const out = v.collateral
        v.idle.weth += out; v.collateral = 0n; v.openedAt = null
        this.event({ name: 'Closed', actor: 'you', at, hash: receipt, args: { market: 'live', repaid: debt, collateralOut: out } })
        break
      }
    }
  }

  /**
   * Executor.reduce, protective branch (Executor.sol l.261-266): past the act line, repay to the target with collateral
   * sold at the oracle price; null when LTV is at or below the act line.
   */
  private protect(at: number): CrashStage['with']['reduce'] {
    const v = this.s.vault!
    const debt = this.debt(at), value = valueOf(v.collateral, this.s.price)
    const before = ltvOf(debt, value)
    if (before === null || before <= this.corridor.act) return null
    const repaid = repayToLtv(debt, value, this.corridor.target)
    const sold = repaid * ORACLE_SCALE / this.s.price
    v.collateral -= sold; v.principal = debt - repaid; v.debtSince = at
    const after = ltvOf(v.principal, valueOf(v.collateral, this.s.price)) ?? 0n
    this.event({ name: 'Reduced', actor: 'agent', at, args: { market: 'live', repaid, collateralSold: sold, ltvBefore: before, ltvAfter: after, protective: true } })
    return { repaid, sold, ltvBefore: before }
  }

  /** One crash stage (PRD §8a.1): move the price, let the agent act, and calculate the same loan without the agent. */
  private crashStage(at: number) {
    const v = this.s.vault!, c = v.crash!
    const index = (c.stages.length + 1) as 1 | 2 | 3
    const price = c.start.price * CRASH_PATH[index - 1] / 100n
    this.s.price = price
    const reduce = this.protect(at)
    const debt = this.debt(at), value = valueOf(v.collateral, price)
    const liquidatedEarlier = c.without.liquidated
    const w = withoutAgent(c.without.collateral, c.without.debt, price, LLTV)
    c.without = { collateral: w.collateral, debt: w.debt, liquidated: liquidatedEarlier || w.liquidation !== null }
    const withoutValue = valueOf(w.collateral, price)
    c.stages.push({
      index, price,
      without: { collateral: w.collateral, debt: w.debt, value: withoutValue, ltv: ltvOf(w.debt, withoutValue), liquidation: w.liquidation, liquidatedEarlier },
      with: { collateral: v.collateral, debt, value, ltv: ltvOf(debt, value), reduce },
    })
  }

  // ---- operations the adapters expose -------------------------------------------------------------------------------

  state(): State { return this.advance() }

  /** Run the market crash (PRD §8a.1): once per open position; the first stage happens at once. */
  crashRun() {
    this.advance()
    const v = this.s.vault
    if (!v || v.openedAt === null || v.collateral === 0n) throw new Error('No open simulated position.')
    if (v.crash) throw new Error('The market crash has already run for this position.')
    const now = this.now(), price = this.s.price, debt = this.debt(now), value = valueOf(v.collateral, price)
    v.crash = { status: 'running', start: { price, collateral: v.collateral, debt, value, ltv: ltvOf(debt, value), borrowed: v.borrowed }, without: { collateral: v.collateral, debt, liquidated: false }, stages: [] }
    this.crashStage(now)
    this.save()
  }

  /** The next crash stage, advanced by the user; after the third, Done finishes the run. */
  crashNext() {
    this.advance()
    const c = this.s.vault?.crash
    if (!c || c.status === 'done') throw new Error('No market crash is running.')
    if (c.stages.length === CRASH_PATH.length) c.status = 'done'
    else this.crashStage(this.now())
    this.save()
  }
  price(): bigint { this.advance(); return this.s.price }

  createVault(): string {
    this.advance()
    const id = this.id(), now = this.now()
    this.s.jobs[id] = { kind: 'create', createdAt: now, doneAt: now + STAGE_MS, applied: false, receipts: [] }
    this.save()
    return id
  }

  /** The vault's owner_nonce rule (vault/src/owner.rs): the signed nonce must be owner_nonce + 1. */
  ownerCall(method: string, args: Record<string, string>, nonce: number): string {
    this.advance()
    const v = this.s.vault
    if (!v) throw new Error('No simulated vault.')
    if (nonce !== v.ownerNonce + 1) throw new Error(`nonce ${nonce} is not owner_nonce + 1 (${v.ownerNonce + 1})`)
    const pending = Object.values(this.s.jobs).some(j => j.kind === 'owner' && !j.applied)
    if (pending) throw new Error('Another owner call is still running.')
    const id = this.id(), now = this.now()
    this.s.jobs[id] = { kind: 'owner', createdAt: now, doneAt: now + STAGE_MS, applied: false, method, args, nonce, receipts: [] }
    this.save()
    return id
  }

  job(id: string): Job | null { this.advance(); return this.s.jobs[id] ?? null }

  /** Wallet transactions (wrap, WETH/USDC transfer to the position address, gas top-up), applied at once; receipts confirm by time. */
  walletTx(intent: { kind: 'wrap'; amount: bigint } | { kind: 'transfer'; token: 'weth' | 'usdc'; amount: bigint } | { kind: 'topUp'; amount: bigint }): Hex {
    this.advance()
    const w = this.s.wallet, v = this.s.vault, now = this.now()
    w.eth -= WALLET_TX_GAS
    const hash = this.hash()
    if (intent.kind === 'wrap') { w.eth -= intent.amount; w.weth += intent.amount }
    else if (intent.kind === 'topUp') { w.eth -= intent.amount; if (v) v.idle.eth += intent.amount }
    else {
      w[intent.token] -= intent.amount
      if (v) v.idle[intent.token] += intent.amount
      this.event({ name: 'Transfer', actor: 'transfer', at: now, hash, token: intent.token, args: { from: SANDBOX_OWNER, to: SANDBOX_POSITION, value: intent.amount } })
    }
    this.s.txs[hash] = { sentAt: now }
    this.save()
    return hash
  }

  /** Two confirmations a second after a wallet transaction; owner-call receipts are confirmed when their job is done. */
  receipt(hash: string): { status: 'success' | 'pending'; confirmations: number } {
    this.advance()
    const tx = this.s.txs[hash]
    if (tx) return { status: 'success', confirmations: 1 + Math.floor((this.now() - tx.sentAt) / 1000) }
    const job = Object.values(this.s.jobs).find(j => j.receipts.includes(hash as Hex))
    return job ? { status: 'success', confirmations: 2 + Math.floor((this.now() - job.doneAt) / BLOCK_MS) } : { status: 'pending', confirmations: 0 }
  }
}

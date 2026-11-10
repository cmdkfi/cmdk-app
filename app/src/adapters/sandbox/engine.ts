// The sandbox's simulated protocol (PRD §8a, Phase 6b): one in-memory state behind both sandbox adapters, advanced by
// the clock when it is read (no timers), kept in sessionStorage only so a reload stays in the sandbox and closing the tab
// discards it. It never touches the network, wagmi, viem or protocol/ (src/import-boundary.test.mjs).
//
// Stages take 2 s each (PRD §8a "1–3 s"), the agent registers 5 s after setup, a scripted −30% price move happens 20 s
// after open and the simulated agent's protective reduce follows 5 s later. The reduce uses the protocol's own math:
// CorridorMath.repayToLtv (executor/src/CorridorMath.sol l.39-46) to the target, with no budget clamp and not counted
// against the discretionary sell budget, as Executor.reduce's protective branch does (Executor.sol l.261-266, l.296).
import { parseBig, stringifyBig } from '../../flow/json.ts'

type Hex = `0x${string}`

export const WAD = 10n ** 18n
const ORACLE_SCALE = 10n ** 36n
const YEAR = 31_536_000n
export const STAGE_MS = 2_000
export const REGISTER_MS = 5_000
export const DROP_AFTER_OPEN_MS = 20_000
export const REDUCE_AFTER_DROP_MS = 5_000
const BLOCK_MS = 2_000
const FIRST_BLOCK = 30_000_000n
/** $3,210 per ETH in the oracle's scale (loan 6 decimals, collateral 18): value = collateral × price / 1e36. */
export const START_PRICE = 3210n * 10n ** 24n
export const RATE_APR_WAD = 5n * 10n ** 16n
const OWNER_CALL_GAS = 10n ** 13n
const WALLET_TX_GAS = 2n * 10n ** 13n
export const FLOAT_WEI = 5n * 10n ** 15n
export const STORAGE_KEY = 'cmdk.sandbox.engine.v1'

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
  dropAt: number | null
  reducedAt: number | null
}

type Job = { kind: 'create' | 'owner'; createdAt: number; doneAt: number; applied: boolean; method?: string; args?: Record<string, string>; nonce?: number; receipts: Hex[]; failed?: string }

export type State = {
  v: 1
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

function fresh(now: number): State {
  return { v: 1, startedAt: now, counter: 0, price: START_PRICE, wallet: { eth: 10n * WAD, weth: 0n, usdc: 5_000n * 10n ** 6n }, vault: null, jobs: {}, txs: {}, events: [] }
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
    this.s = restored && restored.v === 1 ? restored : fresh(this.clock())
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

  /** Applies every stage and scripted event whose time has come, in time order, then persists. */
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
    const v = this.s.vault
    const due: { at: number; run: () => void }[] = []
    for (const [id, job] of Object.entries(this.s.jobs)) if (!job.applied && job.doneAt <= now) due.push({ at: job.doneAt, run: () => this.applyJob(id) })
    if (v && v.openedAt !== null && v.dropAt === null && v.collateral > 0n && v.openedAt + DROP_AFTER_OPEN_MS <= now) due.push({ at: v.openedAt + DROP_AFTER_OPEN_MS, run: () => this.drop(v.openedAt! + DROP_AFTER_OPEN_MS) })
    if (v && v.dropAt !== null && v.reducedAt === null && v.dropAt + REDUCE_AFTER_DROP_MS <= now) due.push({ at: v.dropAt + REDUCE_AFTER_DROP_MS, run: () => this.reduce(v.dropAt! + REDUCE_AFTER_DROP_MS) })
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
      this.s.vault = { createdAt: at, ownerNonce: 0, approved: false, setupAt: null, idle: { eth: FLOAT_WEI, weth: 0n, usdc: 0n }, collateral: 0n, principal: 0n, debtSince: at, openedAt: null, dropAt: null, reducedAt: null }
      return
    }
    const v = this.s.vault!
    const args = job.args ?? {}
    v.ownerNonce = job.nonce!
    v.idle.eth -= OWNER_CALL_GAS
    const receipt = this.hash()
    job.receipts = [receipt]
    switch (job.method) {
      case 'setup':
        v.approved = true; v.setupAt = at
        this.event({ name: 'CorridorSet', actor: 'you', at, hash: receipt, args: { market: 'live' } })
        break
      case 'open': {
        const collateralIn = BigInt(args.collateral_in), target = BigInt(args.target_ltv)
        v.idle.weth -= collateralIn; v.collateral += collateralIn
        const borrowed = valueOf(v.collateral, this.s.price) * target / WAD
        v.principal = borrowed; v.debtSince = at; v.idle.usdc += borrowed; v.openedAt = at; v.dropAt = null; v.reducedAt = null
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

  private drop(at: number) {
    this.s.price = this.s.price * 70n / 100n
    this.s.vault!.dropAt = at
  }

  /** Executor.reduce, protective branch (Executor.sol l.261-266): repay to the target, sold collateral at the oracle price. */
  private reduce(at: number) {
    const v = this.s.vault!
    v.reducedAt = at
    const debt = this.debt(at), value = valueOf(v.collateral, this.s.price)
    const before = ltvOf(debt, value)
    if (before === null || before <= this.corridor.act) return
    const repaid = repayToLtv(debt, value, this.corridor.target)
    const sold = repaid * ORACLE_SCALE / this.s.price
    v.collateral -= sold; v.principal = debt - repaid; v.debtSince = at
    const after = ltvOf(v.principal, valueOf(v.collateral, this.s.price)) ?? 0n
    this.event({ name: 'Reduced', actor: 'agent', at, args: { market: 'live', repaid, collateralSold: sold, ltvBefore: before, ltvAfter: after, protective: true } })
  }

  // ---- operations the adapters expose -------------------------------------------------------------------------------

  state(): State { return this.advance() }
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

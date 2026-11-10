// Sandbox adapters (PRD §8a, Phase 6b): the same interfaces as the live ones, over one simulated engine (engine.ts).
// A simulated wallet that is connected from the start and answers every prompt at once, and a simulated protocol.
// This module never imports wagmi, viem, the live adapters or protocol/*, and never contacts a network host.
import type { Hex } from 'viem'
import { ProtocolError, type Adapters, type AgentFacts, type ProtocolAdapter, type VaultView, type WalletAdapter, type WalletOption, type WalletState } from '../types.ts'
import { SANDBOX_VAULT, SIM, sandboxConfig } from './config.ts'
import { liquidationIncentiveFactor, LLTV, ltvOf, RATE_APR_WAD, SANDBOX_OWNER, SANDBOX_POSITION, SandboxEngine, STAGE_MS, valueOf, WAD } from './engine.ts'

const NO_WALLETS: WalletOption[] = []
const CONNECTED: WalletState = { status: 'connected', address: SANDBOX_OWNER, chainId: 84532, walletName: 'Sandbox wallet' }
const pct = (n: number) => BigInt(n) * 10n ** 16n
const toHex = (text: string) => `0x${[...new TextEncoder().encode(text)].map(b => b.toString(16).padStart(2, '0')).join('')}` as Hex
const fromHex = (hex: string) => new TextDecoder().decode(new Uint8Array((hex.slice(2).match(/../g) ?? []).map(b => parseInt(b, 16))))

export function createSandboxWallet(engine: SandboxEngine): WalletAdapter {
  return {
    kind: 'sandbox',
    getState: () => CONNECTED,
    subscribe: () => () => undefined,
    getWallets: () => NO_WALLETS,
    subscribeWallets: () => () => undefined,
    connect: async () => undefined,
    disconnect: async () => undefined,
    switchToBaseSepolia: async () => undefined,
    // A simulated signature: the sandbox protocol accepts it as the owner's (checkOwnerSignature)
    signMessage: async () => `0x${'5a'.repeat(65)}` as Hex,
    // the sandbox protocol's walletTx encodes the intent as the calldata; amounts travel as decimal strings
    sendTransaction: async tx => { const intent = JSON.parse(fromHex(tx.data ?? '0x')); return engine.walletTx({ ...intent, amount: BigInt(intent.amount) }) },
    waitForTransaction: () => Promise.reject(new Error('The sandbox has no transaction receipts of this kind.')),
    watchAsset: async () => false,
    dispose: () => engine.dispose(),
  }
}

export function createSandboxProtocol(engine: SandboxEngine): ProtocolAdapter {
  const app = sandboxConfig()
  const c = app.guided.corridor
  const block = () => engine.blockAt(engine.now())
  const vault = () => engine.state().vault

  const vaultView = (): VaultView => {
    const v = vault()
    if (!v) throw new ProtocolError('unavailable', 'No simulated vault yet.')
    const debt = engine.debt()
    return {
      accountId: SANDBOX_VAULT, number: 10, owner: SANDBOX_OWNER, baseAddress: SANDBOX_POSITION, ownerNonce: v.ownerNonce,
      agentPublicKey: engine.registeredAt() ? 'ed25519:sandbox' : null, setupComplete: v.approved, measurementApproved: v.approved, policyMatches: true,
      idle: { ...v.idle },
      markets: [{ id: SIM.live, collateral: v.collateral, borrowShares: v.principal, debt }, { id: SIM.backup, collateral: 0n, borrowShares: 0n, debt: 0n }],
      setup: null,
    }
  }

  return {
    kind: 'sandbox',
    loadConfig: async () => app,
    readStatic: async () => ({ kind: 'deployment-static', data: null }),
    readMarketQuote: async () => ({ blockNumber: block(), lltv: LLTV, loanDecimals: 6, collateralDecimals: 18, price: engine.price(), liquidity: 1_000_000n * 10n ** 6n, borrowApr: Number(RATE_APR_WAD) / 1e18 }),
    estimateDeposit: (_app, quote, amountWei) => {
      if (quote.price === null || amountWei <= 0n) return { value: null, target: null, borrow: null, limited: false, resultingLtv: null, liquidityKnown: true, maxAmountAtTarget: null }
      const value = valueOf(amountWei, quote.price), target = value * pct(c.target) / WAD
      return { value, target, borrow: target, limited: false, resultingLtv: null, liquidityKnown: true, maxAmountAtTarget: null }
    },
    readWalletFunding: async () => { const w = engine.state().wallet; return { blockNumber: block(), eth: w.eth, weth: w.weth, wrapCost: 2n * 10n ** 13n, transferCost: 2n * 10n ** 13n } },
    readAccountKind: async () => 'plain',
    readUsdcAsset: async () => ({ address: SIM.usdc, symbol: 'USDC', decimals: 6 }),
    configMatchesPublished: async () => true,
    discoverPosition: async () => {
      const v = vault()
      if (!v) return null
      return { vault: { accountId: SANDBOX_VAULT, number: 10, baseAddress: SANDBOX_POSITION }, markets: [{ collateral: v.collateral, debt: engine.debt() }], idle: { ...v.idle }, setupComplete: v.approved }
    },
    relayerReadiness: async () => ({ kind: 'ready', message: 'Simulated relayer.' }),
    readVault: async () => vaultView(),
    readNearTime: async () => Math.floor(engine.now() / 1000),
    readWalletTokens: async () => ({ ...engine.state().wallet }),
    readOpenPlan: async (_app, _v, collateralIn) => ({ feedsFresh: true, collateralIn, value: valueOf(collateralIn, engine.price()), lendable: 1_000_000n * 10n ** 6n, loanDecimals: 6, targetLtv: pct(c.target), belowTarget: false }),
    readReceipts: async (_app, hashes) => hashes.map(hash => ({ hash, ...engine.receipt(hash) })),
    createVault: async () => engine.createVault(),
    ownerCall: async (_app, _vaultId, message) => {
      const m = JSON.parse(message) as { method: string; args: Record<string, string>; nonce: number }
      try { return engine.ownerCall(m.method, m.args, m.nonce) } catch (error) { throw new ProtocolError('refused', error instanceof Error ? error.message : String(error)) }
    },
    readJob: async (_app, id) => {
      const job = engine.job(id)
      if (!job) throw new ProtocolError('lost', 'The simulated relayer no longer knows this job.')
      const done = job.applied
      const stage = done ? 'done' : engine.now() - job.createdAt < STAGE_MS / 2 ? 'accepted' : job.kind === 'create' ? 'vault_created' : 'base_sent'
      return { ok: true, stage, vault: job.kind === 'create' && done ? SANDBOX_VAULT : undefined, baseAddress: job.kind === 'create' && done ? SANDBOX_POSITION : undefined, receipts: job.receipts.map(hash => ({ hash, status: 1 })) }
    },
    composeOwnerMessage: (_app, v, intent, nonce, expiry) => {
      const args = intent.method === 'open' ? { market: SIM.live, collateral_in: intent.collateralIn.toString(), target_ltv: intent.targetLtv.toString() }
        : intent.method === 'withdraw' ? { token: intent.token, amount: intent.amount.toString(), destination: intent.destination }
          : intent.method === 'close' ? { market: intent.market }
            : { markets: 'live, backup', measurement: 'simulated' }
      return JSON.stringify({ protocol: 'cmdk-vault/1', network: 'sandbox (simulated)', vault: v.accountId, method: intent.method, args, nonce, expiry })
    },
    checkOwnerSignature: async () => true,
    walletTx: (_app, intent) => ({ to: intent.kind === 'wrap' ? SIM.weth : intent.kind === 'topUp' ? SANDBOX_POSITION : intent.token === 'usdc' ? SIM.usdc : SIM.weth, data: toHex(JSON.stringify(intent, (_k, value) => (typeof value === 'bigint' ? value.toString() : value))), value: intent.kind === 'wrap' || intent.kind === 'topUp' ? intent.amount : 0n }),
    fundsShortfall: () => null,
    readPosition: async () => {
      const v = vault()
      if (!v) throw new ProtocolError('unavailable', 'No simulated vault yet.')
      const price = engine.price(), debt = engine.debt(), value = valueOf(v.collateral, price), now = engine.now()
      const corridor = { target: pct(c.target), act: pct(c.act), floor: pct(c.floor), sellBudget: pct(c.budget), migrateAllowed: c.migrate, set: v.approved }
      const feeds = [{ address: SIM.feed, description: 'ETH / USD', maxAge: 1200, updatedAt: BigInt(Math.floor(now / 1000) - 10) }]
      const market = (id: `0x${string}`, collateral: bigint, d: bigint, val: bigint) => ({ id, executor: SIM.executor, collateral, debt: d, value: val, ltv: ltvOf(d, val), lltv: LLTV, corridor, closedForAgent: false, collateralToken: SIM.weth, loanDecimals: 6, collateralDecimals: 18, feeds })
      // protective sales are not counted in the discretionary window (Executor.sol l.296), so the budget stays whole
      const remaining = v.collateral * pct(c.budget) / WAD
      return {
        blockNumber: block(), blockTime: BigInt(Math.floor(now / 1000)),
        vault: { accountId: SANDBOX_VAULT, number: 10, owner: SANDBOX_OWNER, baseAddress: SANDBOX_POSITION },
        morpho: SIM.morpho,
        markets: [market(SIM.live, v.collateral, debt, value), market(SIM.backup, 0n, 0n, 0n)],
        idle: { ...v.idle },
        sellBudgets: [{ executor: SIM.executor, token: SIM.weth, activeCollateral: v.collateral, sold: 0n, budgetWad: pct(c.budget), remaining }],
      }
    },
    readAgent: async (): Promise<AgentFacts> => {
      const v = vault(), registered = engine.registeredAt(), now = Math.floor(engine.now() / 1000)
      return {
        approval: { ok: true, matches: v?.approved ? true : null },
        keyLimited: registered !== null,
        vaultAgent: registered !== null ? { public_key: 'ed25519:sandbox', expires_at: Math.floor(registered / 1000) + 7 * 86_400 } : null,
        list: { ok: true, row: registered !== null ? { registration: 'registered', agent_status: 'active', expires_at: Math.floor(registered / 1000) + 7 * 86_400, last_tick_unix: now - 2 } : v?.approved ? { registration: 'registering' } : null },
      }
    },
    readActivity: async (_app, _address, toBlock, fromBlock) => {
      const s = engine.state(), head = block(), to = toBlock ?? head
      const from = fromBlock !== undefined && fromBlock > engine.firstBlock() ? fromBlock : engine.firstBlock()
      const items = s.events.map(e => ({ e, block: engine.blockAt(e.at) })).filter(({ block: b }) => b >= from && b <= to)
        .sort((a, b) => b.e.at - a.e.at || b.e.logIndex - a.e.logIndex)
        .map(({ e, block: b }) => ({ name: e.name, actor: e.actor, blockNumber: b, time: BigInt(Math.floor(e.at / 1000)), transactionHash: e.hash, logIndex: e.logIndex, args: { ...e.args, market: e.args.market === 'live' ? SIM.live : e.args.market === 'backup' ? SIM.backup : e.args.market }, token: e.token === 'weth' ? SIM.weth : e.token === 'usdc' ? SIM.usdc : undefined }))
      return { from, to, head, items, reachedStart: from === engine.firstBlock() }
    },
    readClosePlan: async () => {
      const v = vault()
      if (!v) throw new ProtocolError('unavailable', 'No simulated vault yet.')
      const now = engine.now(), debtNow = engine.debt(now), debtAhead = engine.debt(now + app.guided.messageExpirySecs * 1000)
      const holds = v.collateral > 0n || debtNow > 0n
      return {
        blockNumber: block(), blockTime: BigInt(Math.floor(now / 1000)),
        markets: holds ? [{ id: SIM.live, borrowShares: v.principal, collateral: v.collateral, debtNow, debtAhead }] : [],
        debtNow, debtAhead, needNow: debtNow + debtNow / 100n, needAhead: debtAhead + debtAhead / 100n,
        collateral: v.collateral, idle: { ...v.idle }, walletUsdc: engine.state().wallet.usdc,
      }
    },
    // The panel shows "Simulated (not checked)" in the sandbox and never asks for facts (VerificationPanel.tsx).
    readVerification: async () => { throw new ProtocolError('unavailable', 'Verification is not run in the sandbox.') },
    crash: {
      read: async () => {
        const v = vault()
        if (!v || (!v.crash && (v.openedAt === null || v.collateral === 0n))) return null
        const run = v.crash
        return { status: run ? run.status : 'ready', start: run ? run.start : null, stages: run ? run.stages : [], lltv: LLTV, act: pct(c.act), liquidationIncentive: liquidationIncentiveFactor(LLTV) }
      },
      run: async () => engine.crashRun(),
      next: async () => engine.crashNext(),
      resetPrice: async () => engine.resetPrice(),
    },
  }
}

export function createSandboxAdapters(): Adapters {
  const engine = new SandboxEngine({ target: pct(sandboxConfig().guided.corridor.target), act: pct(sandboxConfig().guided.corridor.act), floor: pct(sandboxConfig().guided.corridor.floor), budget: pct(sandboxConfig().guided.corridor.budget) })
  return { kind: 'sandbox', wallet: createSandboxWallet(engine), protocol: createSandboxProtocol(engine) }
}


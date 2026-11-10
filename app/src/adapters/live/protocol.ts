// Live ProtocolAdapter: the only consumer of protocol/. It wires config values into the protocol functions and
// maps their results to the adapter types; protocol logic itself stays in protocol/.
import type { Address, Hex } from 'viem'
import { accountKind } from '../../flow/account.ts'
import { parseConfig, type LoadedConfig } from '../../flow/config.ts'
import { borrowApr, collateralValue, debtAt, depositEstimate, lendable, openTargetLtv, repayNeed } from '../../protocol/base/math.ts'
import { baseClient, feedsFresh, readBlockTimes, readCode, readHead, readMarket, readMarketStatic, readPositionSnapshot, readReceipts, readTokenBalances, readTokenInfo, readVaultSnapshot, readWalletFunding, type MarketStatic } from '../../protocol/base/reads.ts'
import { MAX_WINDOW, readActivity } from '../../protocol/base/activity.ts'
import { agentKeyLimited, agentRow, codeMatchesFactory, composeHashMatches, fetchPublishedManifest, measurementMatches, sha256Hex } from '../../protocol/evidence/verify.ts'
import { finalBlockTime, viewAccessKeyList, viewAccount, type NearRpc } from '../../protocol/near/rpc.ts'
import { discoverWithHint, getFactoryConfig, getState, policyMatches, type VaultState } from '../../protocol/near/vault.ts'
import { closeArgs, openArgs, ownerMessage, recoverOwner, setupArgs, setupComplete, wad, withdrawArgs, type SetupFact } from '../../protocol/owner/message.ts'
import { agentEvidence, agentIndex, agentVaults, assessHealth, createVault, fundsShortfall, health, job, ownerCall, RelayerError } from '../../protocol/relayer/client.ts'
import { sendEth, transferToken, wrapEth } from '../../protocol/wallet/tx.ts'
import { ProtocolError, type DeploymentStatic, type Fetched, type ProtocolAdapter } from '../types.ts'

const relayer = ({ config }: LoadedConfig) => ({ primary: config.relayerUrl, fallback: config.relayerUrlFallback })
/** NEAR reads: the fallback is asked only after a retryable failure of the primary (protocol/near/rpc.ts). */
const nearRpc = (config: LoadedConfig['config']) => ({ primary: config.nearRpcUrl, fallback: config.nearRpcUrlFallback })
/** The published policy: what the app creates vaults with, and what a vault must hold to be adopted or set up. */
const publishedPolicy = ({ createVault: cv }: LoadedConfig['config']) => ({ cooldown_secs: cv.cooldownSecs, markets: cv.markets.map(m => ({ id: m.id, loan_token: m.loan_token, collateral_token: m.collateral_token, executor: m.executor, slice_max: m.slice_max })) })

/** Relayer failures in the terms S4 acts on (RELAYER.md l.59-69). */
function mapped(error: unknown): never {
  if (error instanceof RelayerError) {
    if (error.status === 429) throw new ProtocolError('rate-limited', error.message, error.retryAfter)
    if (error.refused) throw new ProtocolError('refused', error.message)
    if (error.status === 404) throw new ProtocolError('lost', error.message)
    if (error.uncertain) throw new ProtocolError('uncertain', error.message)
  }
  throw new ProtocolError('unavailable', error instanceof Error ? error.message : String(error))
}

const staticsOf = (s: DeploymentStatic) => s.data as MarketStatic[]

/** Settle one verification check on its own, stamped with the time it finished; a failure is kept as its message. */
const settle = <T>(p: Promise<T>): Promise<Fetched<T>> => p.then(
  value => ({ ok: true as const, at: Date.now(), value }),
  error => ({ ok: false as const, at: Date.now(), error: error instanceof Error ? error.message : String(error) }),
)

/** How long one NEAR get_state answer is shared between the S5 position and agent reads (PRD §9 6). */
const SHARED_STATE_MS = 5_000

export function createLiveProtocol(): ProtocolAdapter {
  // S5 only: the position and agent queries of one refresh share one get_state; failures are not kept. The onboarding,
  // close and re-approve chains call getState directly and always read live; their answer replaces the shared one.
  const shared = new Map<string, { at: number; state: Promise<VaultState> }>()
  const sharedState = (rpcUrl: NearRpc, vaultId: string) => {
    const hit = shared.get(vaultId)
    if (hit && Date.now() - hit.at < SHARED_STATE_MS) return hit.state
    const state = getState(rpcUrl, vaultId)
    shared.set(vaultId, { at: Date.now(), state })
    state.catch(() => { if (shared.get(vaultId)?.state === state) shared.delete(vaultId) })
    return state
  }
  return {
    kind: 'live',
    async loadConfig() {
      const response = await fetch('/config.json', { cache: 'no-store' })
      if (!response.ok) throw new Error('The app configuration could not be loaded.')
      return parseConfig(await response.json())
    },
    async readStatic({ config, guided }) {
      const client = baseClient(config.baseRpcUrl)
      const data = await Promise.all(config.createVault.markets.map(m => readMarketStatic(client, { morpho: guided.base.morpho, executor: m.executor, id: m.id })))
      return { kind: 'deployment-static', data }
    },
    async readMarketQuote({ config, guided }, statics) {
      const known = staticsOf(statics).find(s => s.id.toLowerCase() === guided.liveMarket.id.toLowerCase())
      const m = await readMarket(baseClient(config.baseRpcUrl), { morpho: guided.base.morpho, executor: guided.liveMarket.executor, id: guided.liveMarket.id }, undefined, known)
      return {
        blockNumber: m.blockNumber, lltv: m.params.lltv, loanDecimals: m.loanDecimals, collateralDecimals: m.collateralDecimals,
        price: m.price, liquidity: m.liquidity, borrowApr: m.borrowRate === null ? null : borrowApr(m.borrowRate),
      }
    },
    estimateDeposit: ({ guided }, quote, amountWei) => depositEstimate(amountWei, quote.price, quote.liquidity, BigInt(wad(guided.corridor.target))),
    readWalletFunding({ config, guided }, owner, amountWei) {
      return readWalletFunding(baseClient(config.baseRpcUrl), { owner, weth: guided.base.weth, gasPriceOracle: guided.base.gasPriceOracle, gasLimit: guided.walletTxGasLimit, amount: amountWei })
    },
    readUsdcAsset: ({ config, guided }) => readTokenInfo(baseClient(config.baseRpcUrl), guided.base.usdc),
    configMatchesPublished: async ({ config, guided }) => measurementMatches(config.agent.measurement, (await fetchPublishedManifest(guided.help.manifest)).measurement),
    async readAccountKind({ config }, address) {
      return accountKind(await readCode(baseClient(config.baseRpcUrl), address))
    },
    async discoverPosition({ config, guided }, owner, hint) {
      const found = await discoverWithHint(nearRpc(config), config.near.factory, owner, guided.firstVaultNumber, publishedPolicy(config), hint ?? null)
      if (!found) return null
      // the get_state discovery just read is the one S5's position and agent reads share next (PRD §9 6)
      shared.set(found.accountId, { at: Date.now(), state: Promise.resolve(found.state) })
      const snapshot = await readVaultSnapshot(baseClient(config.baseRpcUrl), found.state, { weth: guided.base.weth, usdc: guided.base.usdc })
      return {
        vault: { accountId: found.accountId, number: found.number, baseAddress: found.state.base_address },
        markets: snapshot.markets.map(m => ({ collateral: m.collateral, debt: m.debt })),
        idle: snapshot.idle,
        setupComplete: setupComplete(snapshot.setup, measurementMatches(found.state.approved, config.agent.measurement)),
      }
    },
    async relayerReadiness({ config }) {
      const h = await health({ primary: config.relayerUrl, fallback: config.relayerUrlFallback })
      return assessHealth(h, { chainId: config.baseChainId, nearNetwork: config.nearNetwork, factory: config.near.factory })
    },

    async readVault({ config, guided }, vaultId) {
      const state = await getState(nearRpc(config), vaultId)
      // a chain's live read is the newest answer: S5's shared one is replaced, so the card re-read after a chain step
      // (Phase 7c re-approval) shows the new state instead of a copy from before it
      shared.set(vaultId, { at: Date.now(), state: Promise.resolve(state) })
      const snapshot = await readVaultSnapshot(baseClient(config.baseRpcUrl), state, { weth: guided.base.weth, usdc: guided.base.usdc })
      const measurementApproved = measurementMatches(state.approved, config.agent.measurement)
      return {
        accountId: vaultId, number: Number(/^v(\d+)\./.exec(vaultId)?.[1] ?? 0), owner: state.owner, baseAddress: state.base_address,
        ownerNonce: state.owner_nonce, agentPublicKey: state.agent?.public_key ?? null,
        setupComplete: setupComplete(snapshot.setup, measurementApproved), measurementApproved, policyMatches: policyMatches(state, publishedPolicy(config)),
        idle: snapshot.idle, markets: snapshot.markets.map(m => ({ id: m.id, collateral: m.collateral, borrowShares: m.borrowShares, debt: m.debt })), setup: snapshot.setup,
      }
    },
    readNearTime: ({ config }) => finalBlockTime(nearRpc(config)),
    async readWalletTokens({ config, guided }, owner) {
      const b = await readTokenBalances(baseClient(config.baseRpcUrl), owner, { weth: guided.base.weth, usdc: guided.base.usdc })
      return { eth: b.eth, weth: b.weth, usdc: b.usdc }
    },
    async readOpenPlan({ config, guided }, vault, collateralIn) {
      const m = await readMarket(baseClient(config.baseRpcUrl), { morpho: guided.base.morpho, executor: guided.liveMarket.executor, id: guided.liveMarket.id })
      const live = vault.markets.find(x => x.id.toLowerCase() === guided.liveMarket.id.toLowerCase())
      const target = BigInt(wad(guided.corridor.target))
      const base = { feedsFresh: feedsFresh(m), collateralIn, loanDecimals: m.loanDecimals }
      if (m.price === null || m.liquidity === null) return { ...base, value: null, lendable: null, targetLtv: target, belowTarget: false }
      const value = collateralValue((live?.collateral ?? 0n) + collateralIn, m.price)
      const plan = openTargetLtv(value, live?.debt ?? 0n, m.liquidity, target)
      return { ...base, value, lendable: lendable(m.liquidity), targetLtv: plan.targetLtv, belowTarget: plan.belowTarget }
    },
    readReceipts: ({ config }, hashes) => readReceipts(baseClient(config.baseRpcUrl), hashes),
    async createVault(app, owner) {
      try { return await createVault(relayer(app), { owner, policy: publishedPolicy(app.config), depositNear: app.config.createVault.depositNear }) } catch (error) { return mapped(error) }
    },
    async ownerCall(app, vaultId, message, signature) {
      try { return await ownerCall(relayer(app), { vault: vaultId, message, signature }) } catch (error) { return mapped(error) }
    },
    async readJob(app, id) {
      try {
        const j = await job(relayer(app), id)
        return { ok: j.ok, stage: j.stage, vault: j.vault, baseAddress: j.base_address as Address | undefined, nearTx: j.near_tx, receipts: (j.receipts ?? []) as { hash: Hex; status: number }[], error: j.error, httpStatus: j.http_status }
      } catch (error) { return mapped(error) }
    },
    composeOwnerMessage({ config, guided }, vault, intent, nonce, expiry) {
      const args = intent.method === 'setup'
        ? setupArgs(vault.setup as SetupFact[], guided.corridor, config.agent.measurement, vault.measurementApproved)
        : intent.method === 'open'
          ? openArgs(guided.liveMarket.id, intent.collateralIn, intent.targetLtv)
          : intent.method === 'close'
            ? closeArgs(intent.market)
            : withdrawArgs(intent.token === 'weth' ? guided.base.weth : guided.base.usdc, intent.amount, intent.destination)
      return ownerMessage({ vault: vault.accountId, method: intent.method, args, nonce, expiry })
    },
    async checkOwnerSignature(message, signature, owner) {
      try { return (await recoverOwner(message, signature)).toLowerCase() === owner.toLowerCase() } catch { return false }
    },
    walletTx({ guided }, intent) {
      if (intent.kind === 'wrap') return wrapEth(guided.base.weth, intent.amount)
      if (intent.kind === 'transfer') return transferToken(intent.token === 'weth' ? guided.base.weth : guided.base.usdc, intent.to, intent.amount)
      return sendEth(intent.to, intent.amount)
    },
    fundsShortfall: error => fundsShortfall(error),

    async readPosition({ config, guided }, statics, vaultId) {
      const state = await sharedState(nearRpc(config), vaultId)
      const s = await readPositionSnapshot(baseClient(config.baseRpcUrl), state, { weth: guided.base.weth, usdc: guided.base.usdc }, staticsOf(statics))
      return {
        blockNumber: s.blockNumber, blockTime: s.blockTime, morpho: state.morpho,
        vault: { accountId: vaultId, number: Number(/^v(\d+)\./.exec(vaultId)?.[1] ?? 0), owner: state.owner, baseAddress: state.base_address },
        markets: s.markets.map(m => ({ id: m.id, executor: m.executor, collateral: m.collateral, debt: m.debt, value: m.value, ltv: m.ltv, lltv: m.lltv, corridor: { target: m.corridor.target, act: m.corridor.act, floor: m.corridor.floor, sellBudget: m.corridor.sellBudget, migrateAllowed: m.corridor.migrateAllowed, set: m.corridor.set }, closedForAgent: m.closedForAgent, collateralToken: m.collateralToken, loanDecimals: m.loanDecimals, collateralDecimals: m.collateralDecimals,
          feeds: m.feeds.map(f => ({ address: f.feed, description: guided.base.feeds.find(x => x.address.toLowerCase() === f.feed.toLowerCase())?.description ?? null, maxAge: f.maxAge, updatedAt: f.updatedAt })) })),
        idle: s.idle,
        sellBudgets: s.sellBudgets,
      }
    },
    async readAgent(app, vaultId) {
      // the chain reads decide; the agent's list is settled on its own (Phase 7b: it lagged the chain on 9 Nov)
      const failed = (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) })
      const [state, keys, list, manifest] = await Promise.all([
        sharedState(nearRpc(app.config), vaultId), viewAccessKeyList(nearRpc(app.config), vaultId),
        agentVaults(relayer(app)).then(rows => ({ ok: true as const, rows }), failed),
        fetchPublishedManifest(app.guided.help.manifest).then(m => ({ ok: true as const, measurement: m.measurement }), failed),
      ])
      const row = list.ok ? agentRow(list.rows, vaultId) : null
      return {
        approval: manifest.ok ? { ok: true, matches: state.approved ? measurementMatches(state.approved, manifest.measurement) : null } : { ok: false, error: manifest.error },
        keyLimited: agentKeyLimited(keys, vaultId, state.agent?.public_key),
        vaultAgent: state.agent,
        list: list.ok ? { ok: true, row: row ? { registration: row.registration, agent_status: row.agent_status, expires_at: row.expires_at, last_tick_unix: row.last_tick_unix } : null } : { ok: false, error: list.error },
      }
    },
    async readActivity({ config, guided }, positionAddress, toBlock, fromBlock) {
      const client = baseClient(config.baseRpcUrl)
      const start = BigInt(guided.base.executorDeployBlock)
      const to = toBlock ?? await readHead(client)
      const head = toBlock === null ? to : null
      if (to < start) return { from: start, to, head: head ?? to, items: [], reachedStart: true }
      const lowest = [start, to - MAX_WINDOW + 1n, fromBlock ?? start].reduce((a, b) => (a > b ? a : b))
      // nothing new since `fromBlock` (a cached range already reaches the head): no request
      if (lowest > to) return { from: lowest, to, head: head ?? to, items: [], reachedStart: false }
      const executors = [...new Set(config.createVault.markets.map(m => m.executor.toLowerCase()))] as Hex[]
      const events = await readActivity(client, { executors, positionAddress, tokens: [guided.base.weth, guided.base.usdc] }, lowest, to)
      const times = await readBlockTimes(client, events.map(e => e.blockNumber)).catch(() => new Map<bigint, bigint>())
      return { from: lowest, to, head: head ?? to, items: events.map(e => ({ ...e, time: times.get(e.blockNumber) ?? null })), reachedStart: lowest === start }
    },
    async readClosePlan({ config, guided }, vaultId, owner) {
      const client = baseClient(config.baseRpcUrl)
      const state = await getState(nearRpc(config), vaultId)
      const [s, wallet] = await Promise.all([
        readVaultSnapshot(client, state, { weth: guided.base.weth, usdc: guided.base.usdc }),
        readTokenBalances(client, owner, { weth: guided.base.weth, usdc: guided.base.usdc }),
      ])
      const ahead = s.blockTime + BigInt(guided.messageExpirySecs)
      const markets = s.markets.filter(m => m.borrowShares > 0n || m.collateral > 0n).map(m => {
        // Without the IRM rate the amount to repay ahead is unknown; nothing is estimated in its place.
        if (m.borrowShares > 0n && m.borrowRate === null) throw new Error('The borrow rate could not be read, so the amount to repay is unknown.')
        return { id: m.id, borrowShares: m.borrowShares, collateral: m.collateral, debtNow: m.debt, debtAhead: m.borrowShares > 0n ? debtAt(m.borrowShares, m.totals, m.borrowRate!, ahead) : 0n }
      })
      const sum = (f: (m: (typeof markets)[number]) => bigint) => markets.reduce((total, m) => total + f(m), 0n)
      return {
        blockNumber: s.blockNumber, blockTime: s.blockTime, markets,
        debtNow: sum(m => m.debtNow), debtAhead: sum(m => m.debtAhead),
        needNow: sum(m => repayNeed(m.debtNow)), needAhead: sum(m => repayNeed(m.debtAhead)),
        collateral: sum(m => m.collateral), idle: s.idle, walletUsdc: wallet.usdc,
      }
    },

    async readVerification(app, vaultId) {
      const rpc = nearRpc(app.config), urls = relayer(app)
      // Live reads only, each started once and shared by the rows that need it; nothing is cached for the panel.
      const state = getState(rpc, vaultId)
      const manifest = fetchPublishedManifest(app.guided.help.manifest)
      const compose = agentEvidence(urls, 'app-compose.json')
      const index = agentIndex(urls)
      const [measurement, composeRow, registration, keys, code] = await Promise.all([
        settle(Promise.all([state, manifest]).then(([s, m]) => ({ matches: s.approved ? measurementMatches(s.approved, m.measurement) : null, sourceCommit: m.sourceCommit, version: m.version }))),
        settle(Promise.all([state, compose, index]).then(async ([s, bytes, idx]) => {
          const sha256 = await sha256Hex(bytes)
          const entry = idx.files.find(f => f.name === 'app-compose.json')
          return { sha256, matchesApproved: s.approved ? await composeHashMatches(bytes, s.approved.compose_hash) : null, matchesIndex: entry ? entry.sha256.toLowerCase() === sha256 : null }
        })),
        settle(agentVaults(urls).then(rows => {
          const row = agentRow(rows, vaultId)
          return row ? { registration: row.registration ?? '', agentStatus: row.agent_status ?? null, expiresAt: typeof row.expires_at === 'number' ? row.expires_at : null, registrationTx: row.registration_tx ?? null } : null
        })),
        settle(Promise.all([state, viewAccessKeyList(rpc, vaultId)]).then(([s, list]) => ({ limited: s.agent ? agentKeyLimited(list, vaultId, s.agent.public_key) : null, count: list.length }))),
        settle(Promise.all([viewAccount(rpc, vaultId), getFactoryConfig(rpc, app.config.near.factory)]).then(([account, factory]) => ({ matches: codeMatchesFactory(account, factory.code_hash) }))),
      ])
      return { vaultId, measurement, compose: composeRow, registration, keys, code }
    },
  }
}
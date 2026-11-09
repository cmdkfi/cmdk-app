// Live ProtocolAdapter: the only consumer of protocol/. It wires config values into the protocol functions and
// maps their results to the adapter types; protocol logic itself stays in protocol/.
import type { Address, Hex } from 'viem'
import { accountKind } from '../../flow/account.ts'
import { parseConfig, type LoadedConfig } from '../../flow/config.ts'
import { borrowApr, collateralValue, debtAt, depositEstimate, lendable, openTargetLtv, repayNeed } from '../../protocol/base/math.ts'
import { baseClient, feedsFresh, readBlockTimes, readCode, readHead, readMarket, readReceipts, readTokenBalances, readVaultSnapshot, readWalletFunding } from '../../protocol/base/reads.ts'
import { MAX_WINDOW, readActivity } from '../../protocol/base/activity.ts'
import { agentKeyLimited, agentRegistered, agentRow, measurementMatches } from '../../protocol/evidence/verify.ts'
import { finalBlockTime, viewAccessKeyList } from '../../protocol/near/rpc.ts'
import { discover, getState } from '../../protocol/near/vault.ts'
import { closeArgs, openArgs, ownerMessage, recoverOwner, setupArgs, setupComplete, wad, withdrawArgs, type SetupFact } from '../../protocol/owner/message.ts'
import { agentVaults, assessHealth, createVault, fundsShortfall, health, job, ownerCall, RelayerError } from '../../protocol/relayer/client.ts'
import { sendEth, transferToken, wrapEth } from '../../protocol/wallet/tx.ts'
import { ProtocolError, type ProtocolAdapter } from '../types.ts'

const relayer = ({ config }: LoadedConfig) => ({ primary: config.relayerUrl, fallback: config.relayerUrlFallback })

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

export function createLiveProtocol(): ProtocolAdapter {
  return {
    kind: 'live',
    async loadConfig() {
      const response = await fetch('/config.json', { cache: 'no-store' })
      if (!response.ok) throw new Error('The app configuration could not be loaded.')
      return parseConfig(await response.json())
    },
    async readMarketQuote({ config, guided }) {
      const m = await readMarket(baseClient(config.baseRpcUrl), { morpho: guided.base.morpho, executor: guided.liveMarket.executor, id: guided.liveMarket.id })
      return {
        blockNumber: m.blockNumber, lltv: m.params.lltv, loanDecimals: m.loanDecimals, collateralDecimals: m.collateralDecimals,
        price: m.price, liquidity: m.liquidity, borrowApr: m.borrowRate === null ? null : borrowApr(m.borrowRate),
      }
    },
    estimateDeposit: ({ guided }, quote, amountWei) => depositEstimate(amountWei, quote.price, quote.liquidity, BigInt(wad(guided.corridor.target))),
    readWalletFunding({ config, guided }, owner, amountWei) {
      return readWalletFunding(baseClient(config.baseRpcUrl), { owner, weth: guided.base.weth, gasPriceOracle: guided.base.gasPriceOracle, gasLimit: guided.walletTxGasLimit, amount: amountWei })
    },
    async readAccountKind({ config }, address) {
      return accountKind(await readCode(baseClient(config.baseRpcUrl), address))
    },
    async discoverPosition({ config, guided }, owner) {
      const found = await discover(config.nearRpcUrl, config.near.factory, owner, guided.firstVaultNumber)
      if (!found) return null
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
      const state = await getState(config.nearRpcUrl, vaultId)
      const snapshot = await readVaultSnapshot(baseClient(config.baseRpcUrl), state, { weth: guided.base.weth, usdc: guided.base.usdc })
      const measurementApproved = measurementMatches(state.approved, config.agent.measurement)
      return {
        accountId: vaultId, number: Number(/^v(\d+)\./.exec(vaultId)?.[1] ?? 0), owner: state.owner, baseAddress: state.base_address,
        ownerNonce: state.owner_nonce, agentPublicKey: state.agent?.public_key ?? null,
        setupComplete: setupComplete(snapshot.setup, measurementApproved), measurementApproved,
        idle: snapshot.idle, markets: snapshot.markets.map(m => ({ id: m.id, collateral: m.collateral, borrowShares: m.borrowShares, debt: m.debt })), setup: snapshot.setup,
      }
    },
    readNearTime: ({ config }) => finalBlockTime(config.nearRpcUrl),
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
      const cv = app.config.createVault
      const policy = { cooldown_secs: cv.cooldownSecs, markets: cv.markets.map(m => ({ id: m.id, loan_token: m.loan_token, collateral_token: m.collateral_token, executor: m.executor, slice_max: m.slice_max })) }
      try { return await createVault(relayer(app), { owner, policy, depositNear: cv.depositNear }) } catch (error) { return mapped(error) }
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
    async readAgentRegistration(app, vaultId) {
      try {
        const [state, rows, keys] = await Promise.all([getState(app.config.nearRpcUrl, vaultId), agentVaults(relayer(app)), viewAccessKeyList(app.config.nearRpcUrl, vaultId)])
        const ok = agentRegistered(agentRow(rows, vaultId), Date.now() / 1000) && agentKeyLimited(keys, vaultId, state.agent?.public_key)
        return { state: ok ? 'registered' : 'registering' }
      } catch {
        return { state: 'unavailable' }
      }
    },

    async readPosition({ config, guided }, vaultId) {
      const state = await getState(config.nearRpcUrl, vaultId)
      const s = await readVaultSnapshot(baseClient(config.baseRpcUrl), state, { weth: guided.base.weth, usdc: guided.base.usdc })
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
      const [state, rows, keys] = await Promise.all([getState(app.config.nearRpcUrl, vaultId), agentVaults(relayer(app)), viewAccessKeyList(app.config.nearRpcUrl, vaultId)])
      const row = agentRow(rows, vaultId)
      return {
        row: row ? { registration: row.registration, agent_status: row.agent_status, expires_at: row.expires_at, last_tick_unix: row.last_tick_unix } : null,
        keyLimited: agentKeyLimited(keys, vaultId, state.agent?.public_key),
        vaultAgent: state.agent,
      }
    },
    async readActivity({ config, guided }, positionAddress, toBlock) {
      const client = baseClient(config.baseRpcUrl)
      const start = BigInt(guided.base.executorDeployBlock)
      const to = toBlock ?? await readHead(client)
      if (to < start) return { from: start, to, items: [], reachedStart: true }
      const from = to - MAX_WINDOW + 1n > start ? to - MAX_WINDOW + 1n : start
      const executors = [...new Set(config.createVault.markets.map(m => m.executor.toLowerCase()))] as Hex[]
      const events = []
      for (const executor of executors) events.push(...await readActivity(client, { executor, positionAddress, tokens: [guided.base.weth, guided.base.usdc] }, from, to))
      const times = await readBlockTimes(client, events.map(e => e.blockNumber)).catch(() => new Map<bigint, bigint>())
      const items = events
        .filter((e, i, all) => all.findIndex(x => x.transactionHash === e.transactionHash && x.logIndex === e.logIndex) === i)
        .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : b.blockNumber > a.blockNumber ? 1 : -1))
        .map(e => ({ ...e, time: times.get(e.blockNumber) ?? null }))
      return { from, to, items, reachedStart: from === start }
    },

    async readClosePlan({ config, guided }, vaultId, owner) {
      const client = baseClient(config.baseRpcUrl)
      const state = await getState(config.nearRpcUrl, vaultId)
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
  }
}
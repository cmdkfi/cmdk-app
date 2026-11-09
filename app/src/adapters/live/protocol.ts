// Live ProtocolAdapter: the only consumer of protocol/. It wires config values into the protocol functions and
// maps their results to the adapter types; protocol logic itself stays in protocol/.
import { accountKind } from '../../flow/account.ts'
import { parseConfig } from '../../flow/config.ts'
import { borrowApr, depositEstimate } from '../../protocol/base/math.ts'
import { baseClient, readCode, readMarket, readVaultSnapshot, readWalletFunding } from '../../protocol/base/reads.ts'
import { discover } from '../../protocol/near/vault.ts'
import { measurementMatches } from '../../protocol/evidence/verify.ts'
import { setupComplete, wad } from '../../protocol/owner/message.ts'
import { assessHealth, health } from '../../protocol/relayer/client.ts'
import type { ProtocolAdapter } from '../types.ts'

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
  }
}

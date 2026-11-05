import { useEffect, useState } from 'react'
import { createPublicClient, formatUnits, http, isAddress, parseAbi } from 'viem'
import { baseSepolia } from 'viem/chains'
import { useAccount } from 'wagmi'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { loadConfig } from './near.ts'
import { readLivePosition } from './positions.ts'
import { repaymentGap, requiredRepayment, totalForToken } from './exit-readiness.ts'

const tokenAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])
type MarketReadiness = { id: string; symbol: string; decimals: number; debt: bigint; required: bigint; totalRequired: bigint; atPosition: bigint; allowance: bigint; allowanceRequired: bigint; inWallet: bigint; gap: bigint; collateral: bigint; collateralSymbol: string; collateralDecimals: number }
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; markets: MarketReadiness[]; position: string; readAt: number }

export function LiveExitReadiness() {
  const { address } = useAccount()
  const { selected } = useVaultSelection()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    if (!selected || !address) { setState({ kind: 'error', message: 'Connect the owner wallet and select a vault to inspect repayment.' }); return }
    setState({ kind: 'loading' })
    async function read() {
      const config = await loadConfig()
      const position = await readLivePosition(config, selected!.accountId, address!)
      const client = createPublicClient({ chain: baseSepolia, transport: http(config.baseRpcUrl) })
      const markets = await Promise.all(position.markets.map(async market => {
        const published = config.createVault?.markets.find(item => item.id.toLowerCase() === market.id.toLowerCase())
        if (!published || published.loan_token.toLowerCase() !== market.loanToken.toLowerCase() || !isAddress(published.executor)) throw new Error('A vault market does not match the published deployment.')
        const [atPosition, allowance, inWallet] = await Promise.all([
          client.readContract({ address: market.loanToken, abi: tokenAbi, functionName: 'balanceOf', args: [position.baseAddress] }),
          client.readContract({ address: market.loanToken, abi: tokenAbi, functionName: 'allowance', args: [position.baseAddress, published.executor as `0x${string}`] }),
          client.readContract({ address: market.loanToken, abi: tokenAbi, functionName: 'balanceOf', args: [address!] }),
        ])
        const required = requiredRepayment(market.debt)
        const totalRequired = totalForToken(position.markets, market.loanToken)
        const allowanceRequired = position.markets.filter(item => item.loanToken.toLowerCase() === market.loanToken.toLowerCase() && config.createVault?.markets.find(p => p.id.toLowerCase() === item.id.toLowerCase())?.executor.toLowerCase() === published.executor.toLowerCase()).reduce((total, item) => total + requiredRepayment(item.debt), 0n)
        return { id: market.id, symbol: market.loanSymbol, decimals: market.loanDecimals, debt: market.debt, required, totalRequired, atPosition, allowance, allowanceRequired, inWallet, gap: repaymentGap(totalRequired, atPosition), collateral: market.collateral, collateralSymbol: market.collateralSymbol, collateralDecimals: market.collateralDecimals }
      }))
      if (active) setState({ kind: 'ready', markets, position: position.baseAddress, readAt: Date.now() })
    }
    void read().catch(error => { if (active) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not read repayment readiness.' }) })
    return () => { active = false }
  }, [address, selected?.accountId, revision])

  const show = (value: bigint, decimals: number) => Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })
  return <section className="card" aria-labelledby="live-exit-title">
    <div className="card__header"><div><h2 id="live-exit-title">Selected vault · repayment check</h2><p>Read-only balances from Base Sepolia. No tokens move and no request is signed here.</p></div><button className="button button--secondary" onClick={() => setRevision(value => value + 1)} disabled={state.kind === 'loading'}>Refresh</button></div>
    {state.kind === 'loading' && <p role="status">Reading every market and token balance…</p>}
    {state.kind === 'error' && <p role="alert">{state.message}</p>}
    {state.kind === 'ready' && <>
      <p className="explain">Position: {state.position}. Each market must be repaid separately. The relayer checks the debt plus a 1% buffer for interest; the final amount can change before signing.</p>
      {state.markets.map((market, index) => <div className="live-exit-market" key={market.id}>
        <h3>Market {index + 1} · {market.collateralSymbol} / {market.symbol}</h3>
        <div className="row"><span>Current debt</span><strong>{show(market.debt, market.decimals)} {market.symbol}</strong></div>
        <div className="row"><span>This market, including 1% buffer</span><strong>{show(market.required, market.decimals)} {market.symbol}</strong></div>
        <div className="row"><span>All markets using {market.symbol}</span><strong>{show(market.totalRequired, market.decimals)} {market.symbol}</strong></div>
        <div className="row"><span>At position</span><strong>{show(market.atPosition, market.decimals)} {market.symbol}</strong></div>
        <div className="row"><span>Still needed at position for this token</span><strong>{show(market.gap, market.decimals)} {market.symbol}</strong></div>
        <div className="row"><span>In connected wallet</span><strong>{show(market.inWallet, market.decimals)} {market.symbol}</strong></div>
        <div className="row"><span>Allowance to executor</span><strong>{show(market.allowance, market.decimals)} / {show(market.allowanceRequired, market.decimals)} {market.symbol}</strong></div>
        <p className="explain">{market.debt === 0n ? 'No debt in this market.' : market.gap > 0n ? `Transfer the missing ${market.symbol} from your wallet to the position on Base Sepolia before closing all markets.` : market.allowance < market.allowanceRequired ? 'The token allowance is too low; the owner must approve setup before closing.' : 'Balances and allowance currently meet the relayer precheck. Refresh before signing.'} After close, {show(market.collateral, market.collateralDecimals)} {market.collateralSymbol} collateral returns to the position and needs a separate owner-signed withdrawal.</p>
      </div>)}
      <p className="explain">Read {new Date(state.readAt).toLocaleTimeString('en-US')}. This check does not close the loan.</p>
    </>}
  </section>
}

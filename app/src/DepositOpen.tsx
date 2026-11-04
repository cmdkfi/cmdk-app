import { useEffect, useState } from 'react'
import { formatUnits, isAddress, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { loadConfig, viewNear, type AppConfig } from './near.ts'
import { checkSetupSignature, readSetupJob, startSetupJob, SetupError, type SetupJob } from './vault-setup.ts'
import { accountKind } from './wallet-utils.ts'
import { executorOpenAbi, marketAbi, openMessage, openQuote, oracleAbi, parseWethAmount, tokenAbi, validDepositTarget, WETH } from './deposit-open.ts'

type VaultState = { owner?: string; owner_nonce?: number | string; base_address?: string; morpho?: string; markets?: { id?: string; executor?: string; corridor_set?: boolean }[] }
type Data = { wallet: bigint; position: bigint; oracle: bigint; supplied: bigint; debt: bigint; supplyAssets: bigint; borrowAssets: bigint; lltv: bigint; target: bigint; market: Hex; executor: Address; positionAddress: Address; config: AppConfig; nonce: number }
type View = { kind: 'checking' | 'blocked' | 'ready' | 'transferring' | 'signing' | 'working' | 'done' | 'uncertain'; message: string }
const WAD = 10n ** 18n
export function DepositOpen() {
  const { address, chainId } = useAccount()
  const { selected } = useVaultSelection()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const [data, setData] = useState<Data | null>(null)
  const [view, setView] = useState<View>({ kind: 'checking', message: 'Checking your vault and market…' })
  const [amount, setAmount] = useState('')
  const [targetPercent, setTargetPercent] = useState(50)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<SetupJob | null>(null)
  const [transferHash, setTransferHash] = useState<Hex | null>(null)
  const [review, setReview] = useState(false)
  const savedKey = selected && address ? `cmdk-open:${selected.accountId}:${address.toLowerCase()}` : null

  async function refresh() {
    if (!selected || !address || !client) { setView({ kind: 'blocked', message: 'Connect your owner wallet and select a vault first.' }); return }
    try {
      const config = await loadConfig()
      if (!config.near.factory || !config.createVault || !selected.baseAddress) throw new SetupError('Waiting for the published factory and position address. No deposit can be sent yet.')
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase() || vault.base_address?.toLowerCase() !== selected.baseAddress.toLowerCase()) throw new SetupError('The selected vault does not match this wallet and position address.')
      if (!vault.morpho || !isAddress(vault.morpho)) throw new SetupError('Morpho address is missing from the vault.')
      const configured = config.createVault.markets[0]
      const active = vault.markets?.find(item => item.id?.toLowerCase() === configured.id.toLowerCase())
      if (!active?.corridor_set || !active.executor || active.executor.toLowerCase() !== configured.executor.toLowerCase() || !validDepositTarget(vault.base_address, configured.collateral_token, configured.executor)) throw new SetupError('Set up the approved WETH market and executor before depositing.')
      const market = configured.id as Hex
      const positionAddress = vault.base_address
      const [wallet, position, totals, shares, params] = await Promise.all([
        client.readContract({ address: WETH, abi: tokenAbi, functionName: 'balanceOf', args: [address] }),
        client.readContract({ address: WETH, abi: tokenAbi, functionName: 'balanceOf', args: [positionAddress] }),
        client.readContract({ address: vault.morpho as Address, abi: marketAbi, functionName: 'market', args: [market] }),
        client.readContract({ address: vault.morpho as Address, abi: marketAbi, functionName: 'position', args: [market, positionAddress] }),
        client.readContract({ address: vault.morpho as Address, abi: marketAbi, functionName: 'idToMarketParams', args: [market] }),
      ])
      if (params[1].toLowerCase() !== WETH.toLowerCase() || params[0].toLowerCase() !== configured.loan_token.toLowerCase() || params[4] !== 860_000_000_000_000_000n) throw new SetupError('The live market differs from the published WETH / USDC market.')
      const [oracle, corridor] = await Promise.all([
        client.readContract({ address: params[2], abi: oracleAbi, functionName: 'price' }),
        client.readContract({ address: configured.executor as Address, abi: [{ type: 'function', name: 'corridors', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bool' }, { type: 'bool' }, { type: 'bool' }] }] as const, functionName: 'corridors', args: [positionAddress, market] }),
      ])
      if (!corridor[6] || oracle <= 0n || corridor[0] <= 0n || corridor[0] >= params[4]) throw new SetupError('Market oracle or protection corridor is not ready.')
      const debt = (shares[1] * (totals[2] + 1n) + totals[3] + 1_000_000n - 1n) / (totals[3] + 1_000_000n)
      const nonce = Number(vault.owner_nonce)
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new SetupError('Could not verify the current owner nonce.')
      setData({ wallet, position, oracle, supplied: shares[2], debt, supplyAssets: totals[0], borrowAssets: totals[2], lltv: params[4], target: corridor[0], market, executor: configured.executor as Address, positionAddress, config, nonce })
      setTargetPercent(Math.min(50, Number(corridor[0] * 100n / WAD)))
      const saved = sessionStorage.getItem(`cmdk-open:${selected.accountId}:${address.toLowerCase()}`)
      setView(saved === 'uncertain'
        ? { kind: 'uncertain', message: 'A previous Open request has an uncertain outcome. Check the vault and Base transactions before signing again.' }
        : { kind: 'ready', message: 'Live WETH balance and market quote loaded from Base Sepolia.' })
    } catch (error) { setData(null); setView({ kind: 'blocked', message: error instanceof Error ? error.message : 'Could not read the vault.' }) }
  }

  useEffect(() => { void refresh() }, [address, selected?.accountId, client])
  useEffect(() => {
    if (!savedKey) return
    const saved = sessionStorage.getItem(savedKey)
    if (saved === 'uncertain') setView({ kind: 'uncertain', message: 'A previous Open request has an uncertain outcome. Check the vault and Base transactions before signing again.' })
    else if (saved && /^[0-9a-f]{16}$/.test(saved)) setJobId(saved)
  }, [savedKey])
  useEffect(() => {
    if (!data || !jobId || job?.stage === 'done' || job?.stage === 'failed' || view.kind === 'uncertain') return
    let live = true
    let timer: number | undefined
    async function poll() {
      try {
        const next = await readSetupJob(data!.config, jobId!)
        if (!live) return
        setJob(next)
        if (next.stage === 'done') { setView({ kind: 'done', message: 'Open completed. Check the position and borrowed USDC before withdrawing.' }) }
        else if (next.stage === 'failed') setView({ kind: next.base_sent?.length || next.http_status === 502 ? 'uncertain' : 'blocked', message: next.error ?? 'Open failed. Check the linked transactions.' })
        else { setView({ kind: 'working', message: 'The relayer is checking and sending Open.' }); timer = window.setTimeout(poll, 1000) }
      } catch (error) { if (live) setView({ kind: 'uncertain', message: error instanceof Error ? error.message : 'Open status is uncertain.' }) }
    }
    void poll()
    return () => { live = false; window.clearTimeout(timer) }
  }, [data, jobId, job?.stage, view.kind])

  let deposit = 0n
  let inputError = ''
  try { if (amount) deposit = parseWethAmount(amount) } catch (error) { inputError = error instanceof Error ? error.message : 'Invalid amount.' }
  const targetLtv = BigInt(Math.round(targetPercent * 10)) * 10n ** 15n
  const quote = data && deposit > 0n ? openQuote(deposit, data.supplied, data.debt, data.oracle, targetLtv, data.supplyAssets, data.borrowAssets) : null
  const canTransfer = !!data && !inputError && deposit > 0n && deposit <= data.wallet && !!quote?.enoughLiquidity && targetLtv <= data.target && chainId === baseSepolia.id && view.kind === 'ready' && !jobId
  const canOpen = !!data && !inputError && deposit > 0n && deposit <= data.position && !!quote?.enoughLiquidity && targetLtv <= data.target && chainId === baseSepolia.id && view.kind === 'ready' && !jobId

  async function transfer() {
    if (!canTransfer || !data || !client) return
    setView({ kind: 'transferring', message: 'Confirm the WETH transfer in your wallet…' })
    try {
      const hash = await writeContractAsync({ chainId: baseSepolia.id, address: WETH, abi: tokenAbi, functionName: 'transfer', args: [data.positionAddress, deposit] })
      setTransferHash(hash)
      setView({ kind: 'transferring', message: 'Waiting for the WETH transfer receipt…' })
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new SetupError('WETH transfer reverted. Check the transaction before retrying.')
      for (let attempt = 0; attempt < 12; attempt++) {
        const balance = await client.readContract({ address: WETH, abi: tokenAbi, functionName: 'balanceOf', args: [data.positionAddress] })
        if (balance >= data.position + deposit) { await refresh(); return }
        await new Promise(resolve => window.setTimeout(resolve, 2000))
      }
      setView({ kind: 'uncertain', message: 'Transfer confirmed, but the position balance did not update. Check the vault before sending again.' })
    } catch (error) { setView({ kind: 'uncertain', message: error instanceof Error ? error.message : 'The transfer outcome is uncertain.' }) }
  }

  async function signOpen() {
    if (!canOpen || !data || !address || !client || !savedKey) return
    setView({ kind: 'signing', message: 'Checking the latest vault state and simulating Open…' })
    try {
      const code = await client.getCode({ address })
      if (!['plain', 'delegated'].includes(accountKind(code))) throw new SetupError('Connect an EOA to sign owner actions.')
      const vault = await viewNear<VaultState>(data.config.nearRpcUrl, selected!.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase() || !vault.morpho || !isAddress(vault.morpho) || vault.base_address?.toLowerCase() !== data.positionAddress.toLowerCase()) throw new SetupError('The vault owner or market address changed. Refresh before signing.')
      const freshNonce = Number(vault.owner_nonce)
      if (!Number.isSafeInteger(freshNonce) || freshNonce < 0) throw new SetupError('The owner nonce is unavailable.')
      const block = await client.getBlock()
      const expiry = Number(block.timestamp) + 600
      const balance = await client.readContract({ address: WETH, abi: tokenAbi, functionName: 'balanceOf', args: [data.positionAddress] })
      if (balance < deposit) throw new SetupError('The position no longer holds enough WETH. Refresh the quote.')
      const latestMarket = await client.readContract({ address: vault.morpho as Address, abi: marketAbi, functionName: 'market', args: [data.market] })
      const latestPrice = await client.readContract({ address: (await client.readContract({ address: vault.morpho as Address, abi: marketAbi, functionName: 'idToMarketParams', args: [data.market] }))[2], abi: oracleAbi, functionName: 'price' })
      const latestQuote = openQuote(deposit, data.supplied, data.debt, latestPrice, targetLtv, latestMarket[0], latestMarket[2])
      if (!latestQuote.enoughLiquidity) throw new SetupError('Market liquidity or price changed. Refresh the quote before signing.')
      await client.simulateContract({ account: data.positionAddress, address: data.executor, abi: executorOpenAbi, functionName: 'open', args: [data.market, deposit, targetLtv, BigInt(expiry)] })
      const message = openMessage(selected!.accountId, freshNonce + 1, expiry, data.config, data.market, deposit, targetLtv)
      setView({ kind: 'signing', message: 'Review the exact Open message in your wallet.' })
      const signature = await signMessageAsync({ message })
      await checkSetupSignature(message, signature, address)
      setView({ kind: 'working', message: 'Submitting the signed Open request once…' })
      const id = await startSetupJob(data.config, selected!.accountId, message, signature)
      sessionStorage.setItem(savedKey, id)
      setJobId(id)
    } catch (error) {
      const uncertain = error instanceof SetupError && error.uncertain
      if (uncertain) sessionStorage.setItem(savedKey, 'uncertain')
      setView({ kind: uncertain ? 'uncertain' : 'ready', message: error instanceof Error ? error.message : 'Open was cancelled.' })
    }
  }

  return <section className="card deposit-live" aria-labelledby="deposit-live-title">
    <div className="card__header"><div><h2 id="deposit-live-title">Open on Base Sepolia</h2><p>Transfer WETH to your selected position, then sign a separate Open message. The market must have enough USDC.</p></div></div>
    <p className="create-job__status" role="status">{view.message}</p>
    {selected && <p className="setup-live__detail">Vault: {selected.accountId} · Position: {selected.baseAddress ?? 'Not published'}</p>}
    {data && <>
      <div className="deposit-live__balances"><div><small>Wallet WETH</small><strong>{Number(formatUnits(data.wallet, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })}</strong></div><div><small>At position</small><strong>{Number(formatUnits(data.position, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })} WETH</strong></div></div>
      <label className="deposit-live__field">WETH to use<input inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setReview(false) }} placeholder="0.01" aria-describedby="deposit-live-help" /></label>
      <p id="deposit-live-help" className="explain">Enter a transfer amount, or use WETH already at the position. Your wallet also needs ETH for Base gas.</p>
      <label className="range-field"><span>Starting LTV <strong>{targetPercent}%</strong></span><input type="range" min="1" max={Math.max(1, Number(data.target * 100n / WAD))} value={targetPercent} onChange={event => { setTargetPercent(Number(event.target.value)); setReview(false) }} /></label>
      {quote && <div className="deposit-live__quote"><div><span>Borrow estimate</span><strong>{Number(formatUnits(quote.borrowed, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC</strong></div><div><span>Free market liquidity</span><strong>{Number(formatUnits(quote.liquidity, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC</strong></div><div><span>Market liquidation LTV</span><strong>86%</strong></div></div>}
      {inputError && <p className="inline-error" role="alert">{inputError}</p>}
      {deposit > data.wallet && deposit > data.position && <p className="inline-error">Your wallet and position do not hold this much WETH.</p>}
      {quote && !quote.enoughLiquidity && <p className="inline-error">This market cannot fund the estimated borrow. Choose a smaller amount or wait for liquidity.</p>}
      {chainId !== baseSepolia.id && <p className="inline-error">Switch your wallet to Base Sepolia before continuing.</p>}
      {review && <div className="setup-live__review"><h3>Review Open</h3><p>Use {amount} WETH already at {data.positionAddress} as collateral and borrow about {quote ? formatUnits(quote.borrowed, 6) : '0'} USDC at {targetPercent}% LTV. The loan stays at the position until you separately sign a withdrawal. The signature expires in 10 minutes. The on-chain simulation must succeed before your wallet opens.</p></div>}
      <div className="card-actions"><button className="button button--secondary" disabled={!canTransfer} onClick={() => void transfer()}>1 · Transfer WETH</button><button className="button" disabled={!canOpen} onClick={() => review ? void signOpen() : setReview(true)}>{review ? '2 · Simulate & sign Open' : '2 · Review Open'} <span aria-hidden="true">→</span></button><button className="button button--secondary" onClick={() => void refresh()}>Refresh balances</button></div>
    </>}
    {transferHash && <p className="setup-live__detail"><a href={`https://sepolia.basescan.org/tx/${transferHash}`} target="_blank" rel="noreferrer">View WETH transfer ↗</a></p>}
    {jobId && <p className="setup-live__detail">Open job: <code>{jobId}</code> · {job?.stage ?? 'Checking'}</p>}
    {job?.near_tx && <p className="setup-live__detail"><a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(job.near_tx)}`} target="_blank" rel="noreferrer">View NEAR transaction ↗</a></p>}
    {job?.base_sent?.map(hash => <p className="setup-live__detail" key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">View Base transaction ↗</a></p>)}
    <p className="explain">Live actions are disabled until the published factory, a selected owner vault, configured protection rules and market liquidity are available.</p>
  </section>
}

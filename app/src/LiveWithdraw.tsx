import { useEffect, useState } from 'react'
import { formatUnits, isAddress, type Address } from 'viem'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { useVaultSelection } from './VaultSelectionContext.tsx'
import { loadConfig, viewNear, type AppConfig } from './near.ts'
import { tokenAbi } from './deposit-open.ts'
import { parseUsdcAmount, withdrawMessage } from './live-withdraw.ts'
import { checkSetupSignature, readSetupJob, startSetupJob, SetupError, type SetupJob } from './vault-setup.ts'
import { accountKind } from './wallet-utils.ts'

type VaultState = { owner?: string; owner_nonce?: number | string; base_address?: string; markets?: { id?: string }[] }
type Data = { config: AppConfig; token: Address; position: Address; balance: bigint; ownerBalance: bigint }
type View = { kind: 'checking' | 'blocked' | 'ready' | 'signing' | 'working' | 'done' | 'uncertain'; message: string }

export function LiveWithdraw() {
  const { address } = useAccount()
  const { selected } = useVaultSelection()
  const client = usePublicClient({ chainId: baseSepolia.id })
  const { signMessageAsync } = useSignMessage()
  const [data, setData] = useState<Data | null>(null)
  const [view, setView] = useState<View>({ kind: 'checking', message: 'Checking the position USDC balance…' })
  const [amount, setAmount] = useState('')
  const [review, setReview] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<SetupJob | null>(null)
  const savedKey = selected && address ? `cmdk-withdraw:${selected.accountId}:${address.toLowerCase()}` : null

  async function refresh() {
    if (!selected || !address || !client) { setData(null); setView({ kind: 'blocked', message: 'Connect your owner wallet and select a vault first.' }); return }
    setView({ kind: 'checking', message: 'Checking the position USDC balance…' })
    try {
      const config = await loadConfig()
      const market = config.createVault?.markets[0]
      if (!config.near.factory || !market || !selected.baseAddress || !isAddress(selected.baseAddress) || !isAddress(market.loan_token)) throw new SetupError('The published vault, position or USDC token is unavailable.')
      const vault = await viewNear<VaultState>(config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase() || vault.base_address?.toLowerCase() !== selected.baseAddress.toLowerCase()) throw new SetupError('The selected vault does not belong to this wallet or its position changed.')
      if (!vault.markets?.some(item => item.id?.toLowerCase() === market.id.toLowerCase())) throw new SetupError('The published USDC market is not configured in this vault.')
      const token = market.loan_token as Address
      const position = selected.baseAddress as Address
      const [balance, ownerBalance] = await Promise.all([
        client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [position] }),
        client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [address] }),
      ])
      setData({ config, token, position, balance, ownerBalance })
      const saved = sessionStorage.getItem(`cmdk-withdraw:${selected.accountId}:${address.toLowerCase()}`)
      setView(saved === 'uncertain'
        ? { kind: 'uncertain', message: 'A previous withdrawal has an uncertain outcome. Check the vault, position and Base transactions before signing again.' }
        : { kind: 'ready', message: balance > 0n ? 'USDC is available at the selected position.' : 'No USDC is available to withdraw from this position.' })
    } catch (error) { setData(null); setView({ kind: 'blocked', message: error instanceof Error ? error.message : 'Could not read the position.' }) }
  }

  useEffect(() => { void refresh() }, [address, selected?.accountId, client])
  useEffect(() => {
    setJobId(null); setJob(null); setAmount(''); setReview(false)
    if (!savedKey) return
    const saved = sessionStorage.getItem(savedKey)
    if (saved === 'uncertain') setView({ kind: 'uncertain', message: 'A previous withdrawal has an uncertain outcome. Check the vault and Base transactions before signing again.' })
    else if (saved && /^[0-9a-f]{16}$/.test(saved)) setJobId(saved)
  }, [savedKey])
  useEffect(() => {
    if (!data || !jobId || job?.stage === 'done' || job?.stage === 'failed' || view.kind === 'uncertain') return
    let active = true
    let timer: number | undefined
    async function poll() {
      try {
        const next = await readSetupJob(data!.config, jobId!)
        if (!active) return
        setJob(next)
        if (next.stage === 'done') { setView({ kind: 'done', message: 'Withdrawal completed. Check the wallet and position balances.' }); await refresh() }
        else if (next.stage === 'failed') setView({ kind: next.base_sent?.length || next.http_status === 502 ? 'uncertain' : 'blocked', message: next.error ?? 'Withdrawal failed. Check the linked transactions.' })
        else { setView({ kind: 'working', message: 'The relayer is checking and sending the withdrawal.' }); timer = window.setTimeout(poll, 1000) }
      } catch (error) { if (active) setView({ kind: 'uncertain', message: error instanceof Error ? error.message : 'Withdrawal status is uncertain.' }) }
    }
    void poll()
    return () => { active = false; window.clearTimeout(timer) }
  }, [data, jobId, job?.stage, view.kind])

  let parsed = 0n
  let inputError = ''
  try { if (amount) parsed = parseUsdcAmount(amount) } catch (error) { inputError = error instanceof Error ? error.message : 'Invalid amount.' }
  const canReview = !!data && parsed > 0n && parsed <= data.balance && !inputError && view.kind === 'ready' && !jobId

  async function signWithdraw() {
    if (!canReview || !data || !address || !selected || !client || !savedKey) return
    setView({ kind: 'signing', message: 'Checking the latest balance and owner nonce…' })
    try {
      const code = await client.getCode({ address })
      if (!['plain', 'delegated'].includes(accountKind(code))) throw new SetupError('Connect an EOA to sign owner actions.')
      const vault = await viewNear<VaultState>(data.config.nearRpcUrl, selected.accountId, 'get_state')
      if (vault.owner?.toLowerCase() !== address.toLowerCase() || vault.base_address?.toLowerCase() !== data.position.toLowerCase()) throw new SetupError('The vault owner or position changed. Refresh before signing.')
      const nonce = Number(vault.owner_nonce)
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new SetupError('The owner nonce is unavailable.')
      const balance = await client.readContract({ address: data.token, abi: tokenAbi, functionName: 'balanceOf', args: [data.position] })
      if (balance < parsed) throw new SetupError('The position USDC balance changed. Refresh before signing.')
      const block = await client.getBlock()
      const expiry = Number(block.timestamp) + 600
      const message = withdrawMessage(selected.accountId, nonce + 1, expiry, data.config, data.token, parsed, address)
      setView({ kind: 'signing', message: 'Review the USDC amount and your wallet address in the signature request.' })
      const signature = await signMessageAsync({ message })
      await checkSetupSignature(message, signature, address)
      setView({ kind: 'working', message: 'Submitting the signed withdrawal once…' })
      const id = await startSetupJob(data.config, selected.accountId, message, signature)
      sessionStorage.setItem(savedKey, id)
      setJobId(id)
    } catch (error) {
      const uncertain = error instanceof SetupError && error.uncertain
      if (uncertain) sessionStorage.setItem(savedKey, 'uncertain')
      setView({ kind: uncertain ? 'uncertain' : 'ready', message: error instanceof Error ? error.message : 'Withdrawal was cancelled.' })
    }
  }

  return <section className="card deposit-live" aria-labelledby="live-withdraw-title">
    <div className="card__header"><div><h2 id="live-withdraw-title">Withdraw from the selected vault</h2><p>Read the borrowed USDC at your position, then sign one owner request to send it to your connected wallet.</p></div></div>
    <p className="create-job__status" role="status">{view.message}</p>
    {selected && <p className="setup-live__detail">Vault: {selected.accountId} · Position: {selected.baseAddress ?? 'Not published'}</p>}
    {data && <>
      <div className="deposit-live__balances"><div><small>At position</small><strong>{formatUnits(data.balance, 6)} USDC</strong></div><div><small>In your wallet</small><strong>{formatUnits(data.ownerBalance, 6)} USDC</strong></div></div>
      <label className="deposit-live__field">USDC to withdraw<input inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setReview(false) }} placeholder="0.00" aria-describedby="live-withdraw-help" /></label>
      <p id="live-withdraw-help" className="explain">Destination: {address}. Only USDC already at this position can be withdrawn. This does not repay the loan.</p>
      {inputError && <p className="inline-error" role="alert">{inputError}</p>}
      {parsed > data.balance && <p className="inline-error" role="alert">Amount exceeds the position balance.</p>}
      {review && <div className="setup-live__review"><h3>Review withdrawal</h3><p>Send {amount} USDC from position {data.position} to your connected wallet {address}. Your loan and WETH collateral remain at the position. The signature expires in 10 minutes.</p></div>}
      <div className="card-actions"><button className="button" disabled={!canReview} onClick={() => review ? void signWithdraw() : setReview(true)}>{review ? 'Sign withdrawal' : 'Review withdrawal'} <span aria-hidden="true">→</span></button><button className="button button--secondary" onClick={() => void refresh()}>Refresh balances</button></div>
    </>}
    {jobId && <p className="setup-live__detail">Withdrawal job: <code>{jobId}</code> · {job?.stage ?? 'Checking'}</p>}
    {job?.near_tx && <p className="setup-live__detail"><a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(job.near_tx)}`} target="_blank" rel="noreferrer">View NEAR transaction ↗</a></p>}
    {job?.base_sent?.map(hash => <p className="setup-live__detail" key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">View Base transaction ↗</a></p>)}
    {job && (job.stage === 'done' || (job.stage === 'failed' && !job.base_sent?.length && job.http_status !== 502)) && <div className="card-actions"><button className="button button--secondary" onClick={() => { if (savedKey) sessionStorage.removeItem(savedKey); setJobId(null); setJob(null); setReview(false); setAmount(''); void refresh() }}>Check for another withdrawal</button></div>}
  </section>
}

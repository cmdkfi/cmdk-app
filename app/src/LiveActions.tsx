import { useEffect, useRef, useState } from 'react'
import { formatUnits, type Hex } from 'viem'
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from 'wagmi'
import { loadConfig, viewNear, type Vault } from './near.ts'
import { readLivePosition, type MarketPosition, type VaultState } from './positions.ts'
import { checkSetupSignature, readSetupJob, startSetupJob } from './vault-setup.ts'
import { borrowCapacity, borrowTarget, erc20, executorActions, morphoActions, ownerMessage, params, parseAmount, preview, type Action } from './live-actions.ts'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'

export function LiveActions({ market: m, vault, onRefresh }: { market: MarketPosition; vault: Vault; onRefresh: () => void }) {
  const { address, chainId } = useAccount()
  const client = usePublicClient({ chainId: 84532 })
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const [action, setAction] = useState<Action>('Deposit')
  const [withdrawCollateral, setWithdrawCollateral] = useState(false)
  const [input, setInput] = useState('')
  const [balance, setBalance] = useState<bigint | null>(null)
  const inFlight = useRef(false)
  const [repayAll, setRepayAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [hashes, setHashes] = useState<string[]>([])
  const [nearTx, setNearTx] = useState<string>()
  const alive = useRef(true)
  const key = `cmdk-live-action:${vault.accountId}:${address}`
  const [locked, setLocked] = useState(() => !!localStorage.getItem(key))
  const token = action === 'Deposit' || (action === 'Withdraw' && withdrawCollateral) ? m.collateralToken : m.loanToken
  const decimals = token === m.collateralToken ? m.collateralDecimals : m.loanDecimals
  const symbol = token === m.collateralToken ? m.collateralSymbol : m.loanSymbol
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    setBalance(null)
    if (client && address && vault.baseAddress) client.readContract({address: token, abi: erc20, functionName:'balanceOf', args:[action === 'Withdraw' ? vault.baseAddress as Hex : address]})
      .then(value => { if (active) setBalance(value) }).catch(() => { if (active) setMessage('Token balance unavailable. Retry after refreshing.') })
    return () => { active = false }
  }, [action, token, client, address, vault.baseAddress, m])
  let value = 0n; let inputError = ''
  try { if (input) value = parseAmount(input, decimals) } catch (error) { inputError = (error as Error).message }
  const max = action === 'Borrow' ? borrowCapacity(m) : action === 'Repay' ? balance === null ? 0n : balance < m.debt ? balance : m.debt : balance ?? 0n
  const quote = preview(m, action, value)
  const liquidationPrice = quote.collateral > 0n && m.liquidationLtv > 0n ? quote.debt * 10n ** BigInt(m.collateralDecimals) * 10n ** 18n / (quote.collateral * m.liquidationLtv) : null
  const pct = (n: bigint | null) => n === null ? '—' : `${(Number(n) / 1e16).toFixed(1)}%`
  function assertSession() { if (!alive.current) throw new Error('Wallet or vault changed. Reopen this vault.') }
  async function receipt(hash: Hex) {
    setHashes(previous => [...previous, hash]); setMessage('Waiting for Base confirmation…')
    const result = await client!.waitForTransactionReceipt({hash, confirmations: 2})
    if (result.status !== 'success') throw new Error('Transaction reverted. No position change was applied.')
    assertSession()
  }
  async function recover() {
    if (!client) return
    setBusy(true)
    try {
      const record = JSON.parse(localStorage.getItem(key) ?? '{}')
      if (record.hash) { await receipt(record.hash) }
      else if (record.job) {
        const job = await readSetupJob(await loadConfig(), record.job)
        setHashes(job.base_sent ?? []); setNearTx(job.near_tx)
        if (job.stage !== 'done' || !job.base_sent?.length) throw new Error(job.error ?? 'Owner action is still pending. Check again; do not resubmit.')
        for (const hash of job.base_sent) await receipt(hash as Hex)
      } else throw new Error('Submission outcome is unknown. Inspect vault transactions before retrying; automatic resubmission is blocked.')
      localStorage.removeItem(key); setLocked(false); onRefresh(); setMessage('Confirmed. Position refreshed.')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  async function execute(close = false) {
    if (inFlight.current || busy || locked || localStorage.getItem(key) || !client || !address || chainId !== 84532 || !vault.baseAddress || (!close && (value <= 0n || value > max || inputError))) return
    inFlight.current = true
    setBusy(true); setMessage('Checking the latest owner, chain and market…')
    let submitted = false
    try {
      if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
      const config = await loadConfig()
      const fresh = await readLivePosition(config, vault.accountId, address)
      const market = fresh.markets.find(item => item.id === m.id)
      if (!market?.morpho || !market.executor || fresh.baseAddress.toLowerCase() !== vault.baseAddress.toLowerCase()) throw new Error('Vault or market changed. Refresh first.')
      assertSession()
      if (!close && (action === 'Deposit' || action === 'Repay')) {
        const walletBalance = await client.readContract({address: token, abi: erc20, functionName:'balanceOf', args:[address]})
        if (value > walletBalance || (action === 'Repay' && value > market.debt)) throw new Error('Balance or debt changed. Refresh the amount.')
        const approvalAmount = action === 'Repay' && repayAll ? market.debt + market.debt / 100n + 1n : value
        if (approvalAmount > walletBalance) throw new Error('Full repayment requires a 1% allowance buffer for interest. Add funds or repay a partial amount.')
        const allowance = await client.readContract({address: token, abi: erc20, functionName:'allowance', args:[address, market.morpho]})
        if (allowance < approvalAmount) {
          setMessage(`Approve exactly ${formatUnits(approvalAmount, decimals)} ${symbol} for Morpho.`)
          const approval = await client.simulateContract({account:address, address:token, abi:erc20, functionName:'approve', args:[market.morpho,approvalAmount]})
          assertSession()
          await receipt(await writeContractAsync({...approval.request, chainId:84532}))
        }
        const common = { account:address, address:market.morpho, abi:morphoActions } as const
        assertSession(); setMessage(`Confirm ${action.toLowerCase()} for vault ${vault.accountId}.`)
        let hash: Hex
        if (action === 'Deposit') {
          const {request} = await client.simulateContract({...common,functionName:'supplyCollateral',args:[params(market),value,fresh.baseAddress,'0x']})
          assertSession()
          localStorage.setItem(key, JSON.stringify({pending:true})); submitted = true; setLocked(true)
          hash = await writeContractAsync({...request,chainId:84532})
        } else {
          const {request} = await client.simulateContract({...common,functionName:'repay',args:[params(market),repayAll ? 0n : value,repayAll ? market.borrowShares ?? 0n : 0n,fresh.baseAddress,'0x']})
          assertSession()
          localStorage.setItem(key, JSON.stringify({pending:true})); submitted = true; setLocked(true)
          hash = await writeContractAsync({...request,chainId:84532})
        }
        localStorage.setItem(key,JSON.stringify({hash}))
        await receipt(hash)
      } else {
        const state = await viewNear<VaultState>(config.nearRpcUrl, vault.accountId, 'get_state')
        if (state.owner?.toLowerCase() !== address.toLowerCase()) throw new Error('Vault owner changed.')
        const expiry = Number((await client.getBlock()).timestamp) + 600
        let method: 'open' | 'withdraw' | 'close'; let args: Record<string,string>
        if (close) {
          if (market.debt !== 0n) throw new Error('Repay the debt before releasing collateral.')
          method = 'close'; args = {market:market.id}
          await client.simulateContract({account:fresh.baseAddress,address:market.executor,abi:executorActions,functionName:'close',args:[market.id,BigInt(expiry)]})
        } else if (action === 'Borrow') {
          const target = borrowTarget(market,value)
          method = 'open'; args = {market:market.id,collateral_in:'0',target_ltv:target.toString()}
          await client.simulateContract({account:fresh.baseAddress,address:market.executor,abi:executorActions,functionName:'open',args:[market.id,0n,target,BigInt(expiry)]})
        } else {
          method = 'withdraw'; args = {token,destination:address,amount:value.toString()}
          const free = await client.readContract({address:token,abi:erc20,functionName:'balanceOf',args:[fresh.baseAddress]})
          if (value > free) throw new Error('Insufficient free vault balance.')
          await client.simulateContract({account:fresh.baseAddress,address:token,abi:erc20,functionName:'transfer',args:[address,value]})
        }
        assertSession()
        const message = ownerMessage(vault.accountId,Number(state.owner_nonce)+1,expiry,method,args)
        setMessage('Review and sign the exact vault owner message in your wallet.')
        const signature = await signMessageAsync({message})
        assertSession(); await checkSetupSignature(message,signature,address)
        localStorage.setItem(key,JSON.stringify({pending:true})); submitted = true; setLocked(true)
        const job = await startSetupJob(config,vault.accountId,message,signature)
        localStorage.setItem(key,JSON.stringify({job})); setMessage('Owner action submitted. Waiting for NEAR and Base…')
        for (let i = 0; i < 90; i++) {
          const result = await readSetupJob(config,job)
          assertSession(); setHashes(result.base_sent ?? []); setNearTx(result.near_tx)
          if (result.stage === 'failed') throw new Error(result.error ?? 'Owner action failed. Check transaction status.')
          if (result.stage === 'done' && result.base_sent?.length) { for (const hash of result.base_sent) await receipt(hash as Hex); break }
          if (i === 89) throw new Error('Still pending. Use Check transaction status; do not submit again.')
          await new Promise(resolve => window.setTimeout(resolve,2000))
        }
      }
      localStorage.removeItem(key); setLocked(false); setMessage('Confirmed on Base Sepolia. Refreshing position…'); setInput(''); onRefresh()
    } catch (error) {
      setMessage((error as Error).message)
      const rejected = (error as {code?:number;walk?:()=>{code?:number}}).code === 4001 || (error as Error).message?.includes('User rejected')
      if (submitted && rejected && JSON.parse(localStorage.getItem(key) ?? '{}').pending) {localStorage.removeItem(key); setLocked(false)}
      // A submitted call may have reached the network. Keep its lock until reconciled.
      if (!submitted) setLocked(!!localStorage.getItem(key))
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <PrototypeSurface className="live-actions">
    <h3>Manage position</h3>
    <div className="live-action-tabs">{(['Deposit','Withdraw','Borrow','Repay'] as Action[]).map(tab => <PrototypeButton key={tab} primary={action === tab} disabled={busy || locked} onClick={() => {setAction(tab);setInput('');setMessage('');setRepayAll(false)}}>{tab}</PrototypeButton>)}</div>
    {action === 'Withdraw' && <><p>Withdraw free tokens only. Repay debt, then release collateral before withdrawing WETH.</p><label>Token <select disabled={busy} value={withdrawCollateral ? 'collateral' : 'loan'} onChange={e => {setWithdrawCollateral(e.target.value === 'collateral');setInput('')}}><option value="loan">{m.loanSymbol}</option><option value="collateral">{m.collateralSymbol}</option></select></label></>}
    {action === 'Borrow' && <p>Borrow to the vault via NEAR owner-call, then withdraw the free {m.loanSymbol}. The signed target determines the amount at execution; this is an estimate.</p>}
    <label>Amount · {symbol}<input inputMode="decimal" value={input} disabled={busy || locked} onChange={e => {setInput(e.target.value);setRepayAll(false)}} placeholder="0.0" /></label>
    <div className="live-action-tabs">{[25,50,75,100].map(n => <PrototypeButton key={n} disabled={busy || locked} onClick={() => {setInput(formatUnits(max*BigInt(n)/100n,decimals));setRepayAll(action === 'Repay' && n === 100 && max === m.debt)}}>{n.toFixed(1)}%</PrototypeButton>)}</div>
    {repayAll && <p>Repay all borrow shares. Approval includes a 1.0% buffer for interest; only the actual debt is spent.</p>}
    <p>Available {action === 'Borrow' ? 'within trigger and liquidity' : action === 'Withdraw' ? 'free at vault' : 'for this action'}: {formatUnits(max,decimals)} {symbol}</p>
    <p>LTV {pct(m.ltv)} → {pct(quote.ltv)} · Trigger {pct(m.agentTrigger)}</p>
    <p>Liquidation price: {liquidationPrice === null ? '—' : Number(formatUnits(liquidationPrice,m.loanDecimals)).toFixed(1)} {m.loanSymbol} / {m.collateralSymbol}</p>
    {quote.ltv !== null && m.agentTrigger !== null && <p>{quote.ltv > m.agentTrigger ? 'Above trigger' : 'Below trigger'} · {pct(quote.ltv > m.agentTrigger ? quote.ltv-m.agentTrigger : m.agentTrigger-quote.ltv)} distance</p>}
    {inputError && <p role="alert">{inputError}</p>}
    {value > max && <p role="alert">Amount exceeds available capacity.</p>}
    {chainId !== 84532 && <p>Switch your wallet to Base Sepolia to continue.</p>}
    <PrototypeButton primary disabled={busy || locked || chainId !== 84532 || value <= 0n || value > max || !!inputError} onClick={() => void execute()}>{busy ? 'Waiting for confirmation…' : `Review ${action.toLowerCase()}`}</PrototypeButton>
    {action === 'Withdraw' && m.debt === 0n && m.collateral > 0n && <PrototypeButton disabled={busy || locked || chainId !== 84532} onClick={() => void execute(true)}>Release collateral via vault</PrototypeButton>}
    {locked && <PrototypeButton disabled={busy} onClick={() => void recover()}>Check transaction status</PrototypeButton>}
    <p role="status">{message}</p>
    {nearTx && <a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(nearTx)}`} target="_blank" rel="noreferrer">NEAR transaction ↗</a>}
    {[...new Set(hashes)].map(hash => <p key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction {hash.slice(0,10)}… ↗</a></p>)}
  </PrototypeSurface>
}

import {ownerPendingRecord,readOwnerRecovery,type SignedOwnerTransaction} from './owner-recovery.ts'
import { useEffect, useRef, useState } from 'react'
import { encodeFunctionData, formatUnits, parseAbi, type Hex } from 'viem'
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from 'wagmi'
import { loadConfig, viewNear, type Vault } from './near.ts'
import { readLivePosition, type MarketPosition, type VaultState } from './positions.ts'
import { checkSetupSignature, readSetupJob, startSetupJob } from './vault-setup.ts'
import { borrowCapacity, borrowTarget, erc20, executorActions, morphoActions, ownerMessage, params, parseAmount, preview, type Action } from './live-actions.ts'
import { PrototypeButton, PrototypeSurface } from './ui/PrototypeControls.tsx'

import { ownerTransactionsConsumed, validateDepositReceipt, validateRecovery, type PendingTransaction } from './transaction-recovery.ts'

export function LiveActions({ market: m, vault, onRefresh }: { market: MarketPosition; vault: Vault; onRefresh: () => void }) {
  const { address, chainId } = useAccount()
  const client = usePublicClient({ chainId: 84532 })
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const [action, setAction] = useState<Action>('Deposit')
  const [repaySource,setRepaySource] = useState<'wallet'|'vault'>('wallet')
  const [review,setReview] = useState<boolean|null>(null)
  const [withdrawCollateral, setWithdrawCollateral] = useState(false)
  const [input, setInput] = useState('')
  const [ethBalance, setEthBalance] = useState<bigint | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const inFlight = useRef(false)
  const [repayAll, setRepayAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recovered,setRecovered]=useState<{signed:SignedOwnerTransaction[];message:string}|null>(null)
  const [recoveryNearHash,setRecoveryNearHash] = useState('')
  const [recoveryHash, setRecoveryHash] = useState('')
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
    const sync = () => setLocked(!!localStorage.getItem(key))
    sync()
    window.addEventListener('storage', sync)
    const timer = window.setInterval(sync, 1000)
    return () => { window.removeEventListener('storage', sync); window.clearInterval(timer) }
  }, [key])
  useEffect(() => {
    let active = true
    setBalance(null)
    setEthBalance(null)
    if (client && address) client.getBalance({address}).then(value => {if(active) setEthBalance(value)}).catch(() => {})
    if (client && address && vault.baseAddress) client.readContract({address: token, abi: erc20, functionName:'balanceOf', args:[action === 'Withdraw' || action === 'Repay' && repaySource === 'vault' ? vault.baseAddress as Hex : address]})
      .then(value => { if (active) setBalance(value) }).catch(() => { if (active) setMessage('Token balance unavailable. Retry after refreshing.') })
    return () => { active = false }
  }, [action, repaySource, token, client, address, vault.baseAddress, m])
  let value = 0n; let inputError = ''
  try { if (input) value = parseAmount(input, decimals) } catch (error) { inputError = (error as Error).message }
  const max = action === 'Borrow' ? m.priceUnavailable || m.policyUnavailable ? 0n : borrowCapacity(m) : action === 'Repay' ? balance === null ? 0n : balance < m.debt ? balance : m.debt : balance ?? 0n
  const quote = preview(m, action, value)
  const liquidationPrice = quote.collateral > 0n && m.liquidationLtv > 0n ? quote.debt * 10n ** BigInt(m.collateralDecimals) * 10n ** 18n / (quote.collateral * m.liquidationLtv) : null
  const currentLiquidationPrice = m.collateral > 0n && m.liquidationLtv > 0n ? m.debt * 10n ** BigInt(m.collateralDecimals) * 10n ** 18n / (m.collateral * m.liquidationLtv) : null
  const priceLabel = (price:bigint|null) => price===null?'—':Number(formatUnits(price,m.loanDecimals)).toFixed(1)
  const pct = (n: bigint | null) => n === null ? '—' : `${(Number(n) / 1e16).toFixed(1)}%`
  function assertSession() { if (!alive.current) throw new Error('Wallet or vault changed. Reopen this vault.') }
  async function receipt(hash: Hex) {
    setHashes(previous => [...previous, hash]); setMessage('Waiting for Base confirmation…')
    const result = await client!.waitForTransactionReceipt({hash, confirmations: 2})
    if (result.status !== 'success') {
      const record: PendingTransaction = JSON.parse(localStorage.getItem(key) ?? '{}')
      if (record.hash === hash && record.kind !== 'owner' && !record.job) {
        localStorage.removeItem(key); setLocked(false); onRefresh()
      }
      throw new Error('Transaction reverted. No position change was applied.')
    }
    assertSession()
  }
  async function recover() {
    if (!client || !address || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const record: PendingTransaction = JSON.parse(localStorage.getItem(key) ?? '{}')
      if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
      if (recoveryNearHash) {
        const signed=await readOwnerRecovery(await loadConfig(),vault,record,recoveryNearHash)
        setRecovered({signed,message:record.message!})
        if(signed.length>0&&!ownerTransactionsConsumed(signed,vault.baseAddress!,await client.getTransactionCount({address:vault.baseAddress as Hex,blockNumber:(await client.getBlockNumber())-1n})))throw new Error('The original signed Base calls still have unconsumed nonces. Review the recovered intent below before resuming its existing signed calls.')
        for(const tx of signed)setHashes(previous=>[...previous,tx.hash])
      } else if (record.hash) { await receipt(record.hash) }
      else if (record.job) {
        const job = await readSetupJob(await loadConfig(), record.job)
        if (job.vault !== vault.accountId) throw new Error('Recovery job belongs to another vault.')
        setHashes(job.base_sent ?? []); setNearTx(job.near_tx)
        if (job.stage === 'failed' && ownerTransactionsConsumed(job.signed ?? [], vault.baseAddress!, await client.getTransactionCount({address:vault.baseAddress as Hex,blockNumber:(await client.getBlockNumber()) - 1n}))) {
          assertSession(); localStorage.removeItem(key); setLocked(false); onRefresh(); setMessage('Previous owner action ended. Its signed Base nonces are consumed; review the refreshed position before continuing.'); return
        }
        if (job.stage !== 'done' || !job.base_sent?.length) throw new Error(job.error ?? 'Owner action is still pending. Check again; do not resubmit.')
        for (const hash of job.base_sent) await receipt(hash as Hex)
      } else {
        if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)) throw new Error('Paste the confirmed transaction hash from your wallet. Do not submit the action again.')
        const hash = recoveryHash as Hex
        const tx = await client.getTransaction({hash})
        try { validateRecovery(tx, record, address, vault.baseAddress!, m) }
        catch {
          const confirmed = await client.getTransactionReceipt({hash})
          if (confirmed.status !== 'success') throw new Error('Transaction reverted. The pending action has not been recovered.')
          validateDepositReceipt(confirmed.logs, record, address, vault.baseAddress!, m)
        }
        if (record.startedAt && tx.blockNumber !== null) {
          const block = await client.getBlock({blockNumber:tx.blockNumber})
          if (Number(block.timestamp) * 1000 < record.startedAt - 60_000) throw new Error('Transaction predates the pending action.')
        }
        localStorage.setItem(key,JSON.stringify({...record,hash}))
        await receipt(hash)
      }
      assertSession()
      localStorage.removeItem(key); setLocked(false); setRecovered(null); setRecoveryNearHash(''); setRecoveryHash(''); onRefresh(); setMessage('Confirmed. Position refreshed.')
    } catch (error) { setMessage((error as Error).message) } finally { inFlight.current = false; setBusy(false) }
  }
  async function resumeRecovered() {
    if(!recovered||!client||inFlight.current||!vault.baseAddress)return
    const record:PendingTransaction=JSON.parse(localStorage.getItem(key)??'{}')
    if(record.message!==recovered.message){setMessage('Pending intent changed. Verify its NEAR transaction again.');return}
    inFlight.current=true;setBusy(true)
    try{
      if(await client.getChainId()!==84532)throw Error('RPC is not Base Sepolia.')
      const nonce=await client.getTransactionCount({address:vault.baseAddress as Hex,blockNumber:(await client.getBlockNumber())-1n})
      for(const tx of recovered.signed){
        if(tx.nonce<nonce)continue
        assertSession()
        const existing=await client.getTransaction({hash:tx.hash}).catch(()=>null)
        if(!existing){const sent=await client.sendRawTransaction({serializedTransaction:tx.raw});if(sent.toLowerCase()!==tx.hash.toLowerCase())throw Error('Broadcast hash differs from the recovered signed call.')}
        await receipt(tx.hash)
      }
      const confirmed=await client.getTransactionCount({address:vault.baseAddress as Hex,blockNumber:(await client.getBlockNumber())-1n})
      if(!ownerTransactionsConsumed(recovered.signed,vault.baseAddress,confirmed))throw Error('Signed nonces remain outstanding. Check recovery status again.')
      assertSession();localStorage.removeItem(key);setLocked(false);setRecovered(null);setRecoveryNearHash('');onRefresh();setMessage('Recovered signed calls confirmed. Position refreshed.')
    }catch(error){setMessage((error as Error).message)}finally{inFlight.current=false;setBusy(false)}
  }
  async function wrap() {
    if (inFlight.current || locked || localStorage.getItem(key) || !client || !address || chainId !== 84532 || value <= 0n || inputError || ethBalance === null || value >= ethBalance || m.collateralToken.toLowerCase() !== '0x4200000000000000000000000000000000000006') return
    inFlight.current = true; setBusy(true)
    let sent = false
    try {
      if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
      const {request} = await client.simulateContract({account:address,address:m.collateralToken,abi:parseAbi(['function deposit() payable']),functionName:'deposit',value})
      assertSession()
      setMessage(`Confirm wrapping ${formatUnits(value,18)} test ETH into WETH in your own wallet. This does not deposit into the vault.`)
      localStorage.setItem(key,JSON.stringify({pending:true,to:request.address,data:encodeFunctionData(request),value:value.toString(),startedAt:Date.now()})); setLocked(true)
      const hash = await writeContractAsync({...request,chainId:84532})
      sent = true; localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key) ?? '{}'),hash}))
      await receipt(hash)
      localStorage.removeItem(key); setLocked(false); onRefresh()
    } catch (error) {
      setMessage((error as Error).message)
      if (!sent && (error as Error).message.includes('User rejected')) {localStorage.removeItem(key);setLocked(false)}
    } finally {inFlight.current = false;setBusy(false)}
  }
  async function execute(close = false) {
    if (m.readOnly || inFlight.current || busy || locked || localStorage.getItem(key) || !client || !address || chainId !== 84532 || !vault.baseAddress || (!close && (value <= 0n || value > max || inputError))) return
    inFlight.current = true
    setBusy(true); setMessage('Checking the latest owner, chain and market…')
    let submitted = false
    try {
      if (await client.getChainId() !== 84532) throw new Error('RPC is not Base Sepolia.')
      const config = await loadConfig()
      const fresh = await readLivePosition(config, vault.accountId, address)
      const market = fresh.markets.find(item => item.id === m.id)
      if (!market?.morpho || market.readOnly || !market.executor || fresh.baseAddress.toLowerCase() !== vault.baseAddress.toLowerCase()) throw new Error('Vault or market changed. Refresh first.')
      assertSession()
      if (!close && (action === 'Deposit' || action === 'Repay' && repaySource === 'wallet')) {
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
          localStorage.setItem(key, JSON.stringify({pending:true, to:request.address, data:encodeFunctionData(request), value:'0', startedAt:Date.now()})); submitted = true; setLocked(true)
          hash = await writeContractAsync({...request,chainId:84532})
        } else {
          const {request} = await client.simulateContract({...common,functionName:'repay',args:[params(market),repayAll ? 0n : value,repayAll ? market.borrowShares ?? 0n : 0n,fresh.baseAddress,'0x']})
          assertSession()
          localStorage.setItem(key, JSON.stringify({pending:true, to:request.address, data:encodeFunctionData(request), value:'0', startedAt:Date.now()})); submitted = true; setLocked(true)
          hash = await writeContractAsync({...request,chainId:84532})
        }
        localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key) ?? '{}'),hash}))
        await receipt(hash)
      } else {
        const state = await viewNear<VaultState>(config.nearRpcUrl, vault.accountId, 'get_state')
        if (state.owner?.toLowerCase() !== address.toLowerCase()) throw new Error('Vault owner changed.')
        const expiry = Number((await client.getBlock()).timestamp) + 600
        let method: 'open' | 'withdraw' | 'close' | 'repay'; let args: Record<string,string>
        if (close) {
          method = 'close'; args = {market:market.id}
          await client.simulateContract({account:fresh.baseAddress,address:market.executor,abi:executorActions,functionName:'close',args:[market.id,BigInt(expiry)]})
        } else if (action === 'Repay') {
          const amount = repayAll ? market.debt + market.debt / 100n + 1n : value
          const free = await client.readContract({address:market.loanToken,abi:erc20,functionName:'balanceOf',args:[fresh.baseAddress]})
          if (amount > free) throw new Error('Insufficient free vault USDC for repayment and interest buffer.')
          method='repay';args={market:market.id,amount:amount.toString()}
          await client.simulateContract({account:fresh.baseAddress,address:market.executor,abi:executorActions,functionName:'repay',args:[market.id,amount,BigInt(expiry)]})
        } else if (action === 'Borrow') {
          if (market.policyUnavailable) throw new Error('Live Executor permissions and corridor are required to borrow.')
          if (market.priceUnavailable) throw new Error('A live oracle price is required to borrow.')
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
        localStorage.setItem(key,JSON.stringify(ownerPendingRecord(message))); submitted = true; setLocked(true)
        const job = await startSetupJob(config,vault.accountId,message,signature)
        localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key) ?? '{}'),job})); setMessage('Owner action submitted. Waiting for NEAR and Base…')
        for (let i = 0; i < 90; i++) {
          const result = await readSetupJob(config,job)
          assertSession(); setHashes(result.base_sent ?? []); setNearTx(result.near_tx)
          if (result.stage === 'failed') throw new Error(result.error ?? 'Owner action failed. Check transaction status.')
          if (result.stage === 'done' && result.base_sent?.length) { for (const hash of result.base_sent) await receipt(hash as Hex); break }
          if (i === 89) throw new Error('Still pending. Use Check transaction status; do not submit again.')
          await new Promise(resolve => window.setTimeout(resolve,2000))
        }
      }
      localStorage.removeItem(key); setLocked(false); setMessage('Confirmed on Base Sepolia. Refreshing position…'); setInput(''); setReview(null); onRefresh()
    } catch (error) {
      setMessage((error as Error).message)
      const rejected = (error as {code?:number;walk?:()=>{code?:number}}).code === 4001 || (error as Error).message?.includes('User rejected')
      if (submitted && rejected && JSON.parse(localStorage.getItem(key) ?? '{}').pending) {localStorage.removeItem(key); setLocked(false)}
      // A submitted call may have reached the network. Keep its lock until reconciled.
      if (!submitted) setLocked(!!localStorage.getItem(key))
    } finally { inFlight.current = false; setBusy(false) }
  }
  if (m.readOnly) return <PrototypeSurface className="live-actions"><h3>Read-only market</h3><p>This owned position uses an Executor outside the current deployment. Its balances remain visible. Verify the deployment with the protocol maintainer before executing actions.</p></PrototypeSurface>
  return <PrototypeSurface className="live-actions">
    <h3>Manage position</h3>
    {m.priceUnavailable && <p role="alert">Oracle price unavailable. Risk preview and borrowing are unavailable. Repayment and free-token withdrawal remain available.</p>}
    <div className="live-action-tabs">{(['Deposit','Withdraw','Borrow','Repay'] as Action[]).map(tab => <PrototypeButton key={tab} primary={action === tab} disabled={busy || locked} onClick={() => {setAction(tab);setInput('');setMessage('');setRepayAll(false);setReview(null)}}>{tab}</PrototypeButton>)}</div>
    {action === 'Repay' && <label>Repayment source<select value={repaySource} disabled={busy||locked} onChange={e=>{setRepaySource(e.target.value as 'wallet'|'vault');setInput('');setRepayAll(false);setReview(null)}}><option value="wallet">Wallet USDC · direct Morpho repay</option><option value="vault">Free vault USDC · owner-call</option></select></label>}
    {action === 'Withdraw' && <><p>Withdraw free tokens only. Repay debt, then release collateral before withdrawing WETH.</p><label>Token <select disabled={busy} value={withdrawCollateral ? 'collateral' : 'loan'} onChange={e => {setWithdrawCollateral(e.target.value === 'collateral');setInput('');setReview(null)}}><option value="loan">{m.loanSymbol}</option><option value="collateral">{m.collateralSymbol}</option></select></label></>}
    {action === 'Borrow' && <p>Borrow to the vault via NEAR owner-call, then withdraw the free {m.loanSymbol}. The signed target determines the amount at execution; this is an estimate.</p>}
    <label>Amount · {symbol}<input inputMode="decimal" value={input} disabled={busy || locked} onChange={e => {setInput(e.target.value);setRepayAll(false);setReview(null)}} placeholder="0.0" /></label>
    {action === 'Deposit' && m.collateralToken.toLowerCase() === '0x4200000000000000000000000000000000000006' && <div><p>Wallet test ETH: {!address ? 'Connect wallet' : ethBalance === null ? 'Loading…' : formatUnits(ethBalance,18)}. Wrap ETH to get WETH first; keep ETH for gas.</p><PrototypeButton disabled={busy || locked || chainId !== 84532 || value <= 0n || !!inputError || ethBalance === null || value >= ethBalance} onClick={() => void wrap()}>Wrap entered ETH amount to WETH</PrototypeButton></div>}
    <div className="live-action-tabs">{[25,50,75,100].map(n => <PrototypeButton key={n} disabled={busy || locked} onClick={() => {setInput(formatUnits(max*BigInt(n)/100n,decimals));setRepayAll(action === 'Repay' && n === 100 && max === m.debt);setReview(null)}}>{n.toFixed(1)}%</PrototypeButton>)}</div>
    {repayAll && <p>Repay all borrow shares. Approval includes a 1.0% buffer for interest; only the actual debt is spent.</p>}
    <p>Available {action === 'Borrow' ? 'within trigger and liquidity' : action === 'Withdraw' ? 'free at vault' : 'for this action'}: {formatUnits(max,decimals)} {symbol}</p>
    <p>LTV {pct(m.ltv)} → {pct(quote.ltv)} · Trigger {pct(m.agentTrigger)}</p>
    <p>Liquidation price: {priceLabel(currentLiquidationPrice)} → {priceLabel(liquidationPrice)} {m.loanSymbol} / {m.collateralSymbol}</p>
    {quote.ltv !== null && m.agentTrigger !== null && <p>{quote.ltv > m.agentTrigger ? 'Above trigger' : 'Below trigger'} · {pct(quote.ltv > m.agentTrigger ? quote.ltv-m.agentTrigger : m.agentTrigger-quote.ltv)} distance</p>}
    {inputError && <p role="alert">{inputError}</p>}
    {value > max && <p role="alert">Amount exceeds available capacity.</p>}
    {chainId !== 84532 && <p>Switch your wallet to Base Sepolia to continue.</p>}
    <PrototypeButton primary disabled={busy || locked || chainId !== 84532 || value <= 0n || value > max || !!inputError} onClick={() => setReview(false)}>{busy ? 'Waiting for confirmation…' : `Review ${action.toLowerCase()}`}</PrototypeButton>
    {action === 'Withdraw' && m.collateral > 0n && <PrototypeButton disabled={busy || locked || chainId !== 84532} onClick={() => setReview(true)}>{m.debt > 0n ? 'Repay from vault and release collateral' : 'Release collateral via vault'}</PrototypeButton>}
    {review !== null && <section className="prototype-surface" aria-label="Review transaction"><h3>Review {review ? 'close position' : action.toLowerCase()}</h3><p>Vault: {vault.accountId}</p><p>{review ? 'Repay all remaining debt using free vault USDC, then release all collateral into the vault. Tokens are not sent to your wallet.' : `${input} ${symbol} · ${action === 'Repay' ? repaySource === 'wallet' ? 'from your wallet to Morpho' : 'from free vault funds via owner-call' : action === 'Withdraw' ? 'from free vault balance to your connected wallet' : action === 'Borrow' ? 'borrowed USDC stays in the vault until you withdraw it' : 'from your wallet into Morpho collateral'}`}</p><p>Current LTV {pct(m.ltv)} → {review ? 'No debt' : pct(quote.ltv)}. The final state is checked again before signing.</p><PrototypeButton primary disabled={busy||locked||chainId!==84532} onClick={()=>void execute(review)}>Continue to wallet</PrototypeButton><PrototypeButton disabled={busy} onClick={()=>setReview(null)}>Cancel review</PrototypeButton></section>}
    {locked && <label>NEAR owner-call hash<input value={recoveryNearHash} disabled={busy} onChange={e=>{setRecoveryNearHash(e.target.value.trim());setRecovered(null)}} placeholder="NEAR transaction hash" autoComplete="off" spellCheck={false}/><small>For a lost owner-call job, match the exact signed intent and verify every Base nonce against the chain.</small></label>}
    {locked && <label>Confirmed transaction hash<input value={recoveryHash} disabled={busy} onChange={e => setRecoveryHash(e.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} /><small>If the wallet completed the transaction but this page lost its status, paste its hash. Legacy recovery accepts only a confirmed collateral deposit for this vault and market.</small></label>}
    {locked && recovered && <section className="prototype-surface"><h3>Recovered owner intent</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{recovered.message}</pre><p>Broadcast only the original signed Base calls below, in nonce order. This can execute the original action without a new wallet signature. No call, amount or destination is changed.</p>{recovered.signed.map(tx=><p key={tx.hash}>Nonce {tx.nonce} · <a href={`https://sepolia.basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash.slice(0,12)}… ↗</a></p>)}<PrototypeButton disabled={busy||!recovered.signed.length} onClick={()=>void resumeRecovered()}>Resume original signed Base calls</PrototypeButton></section>}
    {locked && <PrototypeButton disabled={busy} onClick={() => void recover()}>Check transaction status</PrototypeButton>}
    <p role="status">{message}</p>
    {nearTx && <a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(nearTx)}`} target="_blank" rel="noreferrer">NEAR transaction ↗</a>}
    {[...new Set(hashes)].map(hash => <p key={hash}><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction {hash.slice(0,10)}… ↗</a></p>)}
  </PrototypeSurface>
}

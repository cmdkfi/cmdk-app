import {clearPendingAction,updatePendingAction,type PendingTransaction} from './transaction-recovery.ts'
import {useEffect,useRef,useState} from 'react'
import {encodeFunctionData,formatUnits,type Hex} from 'viem'
import {useAccount,usePublicClient,useSignMessage,useWriteContract} from 'wagmi'
import {loadConfig,viewNear,type Vault} from './near.ts'
import type {VaultState} from './positions.ts'
import {readRecoveryMarket} from './recovery-market.ts'
import {erc20,morphoActions,parseAmount} from './live-actions.ts'
import {ownerPendingRecord,assertFreshOwnerIntent,verifyOwnerJob} from './owner-recovery.ts'
import {checkSetupSignature,startSetupJob,readSetupJob} from './vault-setup.ts'
import {PrototypeButton,PrototypeSurface} from './ui/PrototypeControls.tsx'

type Data=Awaited<ReturnType<typeof readRecoveryMarket>>
export function VaultRecovery({vault,onRefresh}:{vault:Vault;onRefresh:()=>void}) {
 const {address,chainId}=useAccount(),client=usePublicClient({chainId:84532}),{signMessageAsync}=useSignMessage(),{writeContractAsync}=useWriteContract()
 const [data,setData]=useState<Data>(),[market,setMarket]=useState<string>(),[action,setAction]=useState<'repay'|'withdraw'>('repay'),[collateral,setCollateral]=useState(false),[input,setInput]=useState(''),[allShares,setAllShares]=useState(true),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[message,setMessage]=useState(''),[hash,setHash]=useState('')
 const flight=useRef(false),alive=useRef(true),session=useRef('');session.current=`${vault.accountId}:${address}:${chainId}`
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 function assertSession(expected:string){if(!alive.current||session.current!==expected)throw Error('Wallet or vault changed. Reopen recovery.')}
 async function read(selected=market){if(!client)return;setBusy(true);setMessage('Reading owner, market shares and token balances only…');try{const next=await readRecoveryMarket(await loadConfig(),vault,vault.owner,selected,client);if(alive.current){setData(next);setMarket(next.id);setMessage('No oracle or IRM reads are needed for this recovery panel.')}}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 const token=data?(action==='repay'||!collateral?data.loan:data.collateral):undefined
 let amount=0n,error='';try{if(input&&token)amount=parseAmount(input,token.decimals)}catch(e){error=(e as Error).message}
 async function confirm(hash:Hex){setHash(hash);const receipt=await client!.waitForTransactionReceipt({hash,confirmations:2});if(receipt.status!=='success'){const record=JSON.parse(localStorage.getItem(key)??'{}');if(record.hash===hash&&!record.job)clearPendingAction(key,record);throw Error('Transaction reverted. No repayment or withdrawal was applied.')} }
 async function execute(){if(flight.current||!client||!address||!data||!token)return;const expected=session.current;flight.current=true;setBusy(true);let submittedRecord:PendingTransaction|undefined
 try{
 if(chainId!==84532||await client.getChainId()!==84532)throw Error('Switch to Base Sepolia.')
 if(localStorage.getItem(key))throw Error('Another vault action is pending. Check its status first.')
 const config=await loadConfig(),fresh=await readRecoveryMarket(config,vault,address,data.id,client)
 if(fresh.id!==data.id||fresh.base.toLowerCase()!==data.base.toLowerCase())throw Error('Vault or market changed. Refresh recovery data.')
 assertSession(expected)
 if(action==='repay'){
  if(amount<=0n||amount>fresh.loan.wallet||fresh.borrowShares===0n)throw Error('Check the repayment cap, wallet balance and outstanding borrow shares.')
  const allowance=await client.readContract({address:fresh.loan.address,abi:erc20,functionName:'allowance',args:[address,fresh.morpho]})
  if(allowance!==amount){setMessage('Approve exactly the entered repayment cap for Morpho.');const approval=await client.simulateContract({account:address,address:fresh.loan.address,abi:erc20,functionName:'approve',args:[fresh.morpho,amount]});assertSession(expected);await confirm(await writeContractAsync({...approval.request,chainId:84532}))}
  if(localStorage.getItem(key))throw Error('Another vault action started. Inspect it before repaying.')
  const latest=await readRecoveryMarket(config,vault,address,data.id,client)
  assertSession(expected)
  const {request}=await client.simulateContract({account:address,address:fresh.morpho,abi:morphoActions,functionName:'repay',args:[fresh.params,allShares?0n:amount,allShares?latest.borrowShares:0n,fresh.base,'0x']})
  assertSession(expected);if(localStorage.getItem(key))throw Error('Another vault action started. Check its status.');submittedRecord={pending:true,to:request.address,data:encodeFunctionData(request),value:'0',startedAt:Date.now()};localStorage.setItem(key,JSON.stringify({...submittedRecord,operation:'recovery-repay'}))
  const tx=await writeContractAsync({...request,chainId:84532});updatePendingAction(key,submittedRecord!,{hash:tx});await confirm(tx)
  clearPendingAction(key,{hash:tx});setMessage('Repayment confirmed on Base. Refresh position metrics when their data source recovers.');onRefresh()
 }else{
  const selected=collateral?fresh.collateral:fresh.loan
  if(amount<=0n||amount>selected.free)throw Error('Amount exceeds the free vault balance.')
  await client.simulateContract({account:fresh.base,address:selected.address,abi:erc20,functionName:'transfer',args:[address,amount]})
  const state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state');if(state.owner?.toLowerCase()!==address.toLowerCase())throw Error('Connect the vault owner.')
  const nonce=Number(state.owner_nonce)+1,expiry=Number((await client.getBlock()).timestamp)+600
  if(!Number.isSafeInteger(nonce)||nonce<1)throw Error('Owner nonce unavailable.')
  const text=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,method:'withdraw',args:{token:selected.address,destination:address,amount:amount.toString()},nonce,expiry})
  assertSession(expected);const signature=await signMessageAsync({message:text});await checkSetupSignature(text,signature,address);await assertFreshOwnerIntent(config,vault,text);assertSession(expected)
  if(localStorage.getItem(key))throw Error('Another vault action started.')
  localStorage.setItem(key,JSON.stringify(ownerPendingRecord(text,{operation:'recovery-withdraw'})))
  const job=await startSetupJob(config,vault.accountId,text,signature);updatePendingAction(key,{message:text},{job});setMessage('Free-token withdrawal submitted. Check pending confirmation.')
 }
 setReview(false)
 }catch(e){const rejected=(e as {code?:number}).code===4001||(e as Error).message.includes('User rejected');if(rejected&&submittedRecord)clearPendingAction(key,submittedRecord);setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function check(){if(flight.current||!client)return;const expected=session.current;flight.current=true;setBusy(true);try{const record=JSON.parse(localStorage.getItem(key)??'{}');if(record.hash)await confirm(record.hash);else if(record.job){const job=await readSetupJob(await loadConfig(),record.job);if(job.vault!==vault.accountId||job.stage!=='done'||job.base_sent?.length!==1)throw Error(job.error??'Owner action is not confirmed yet.');await verifyOwnerJob(await loadConfig(),vault,record,job);await confirm(job.base_sent[0] as Hex)}else throw Error('No transaction hash or job is available. Use the vault transaction recovery path before resubmitting.');assertSession(expected);clearPendingAction(key,record);setMessage('Pending transaction confirmed. Refreshing position.');onRefresh()}catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return <details><summary>Recovery · direct repayment / free withdrawal</summary><PrototypeSurface className="live-actions"><h3>Risk-reducing recovery</h3><p>Uses ownership, registered market parameters, borrow shares and token balances. It does not require an oracle quote, IRM rate, LTV or agent telemetry.</p><PrototypeButton disabled={busy} onClick={()=>void read()}>Read recovery data</PrototypeButton>{data&&<><label>Market<select value={market} disabled={busy} onChange={e=>{setMarket(e.target.value);setData(undefined);setReview(false);void read(e.target.value)}}>{data.markets.map(id=><option key={id}>{id}</option>)}</select></label><div className="live-action-tabs"><PrototypeButton disabled={busy} primary={action==='repay'} onClick={()=>{setAction('repay');setInput('');setReview(false)}}>Repay</PrototypeButton><PrototypeButton disabled={busy} primary={action==='withdraw'} onClick={()=>{setAction('withdraw');setInput('');setReview(false)}}>Withdraw free</PrototypeButton></div>{action==='withdraw'&&<label>Token<select value={collateral?'collateral':'loan'} disabled={busy} onChange={e=>{setCollateral(e.target.value==='collateral');setInput('');setReview(false)}}><option value="loan">{data.loan.symbol}</option><option value="collateral">{data.collateral.symbol}</option></select></label>}{action==='repay'&&<label><input type="checkbox" checked={allShares} disabled={busy} onChange={e=>{setAllShares(e.target.checked);setReview(false)}}/>Repay all current borrow shares within my approval cap</label>}<label>{action==='repay'&&allShares?'Maximum approval cap':'Amount'} · {token?.symbol}<input inputMode="decimal" value={input} disabled={busy} onChange={e=>{setInput(e.target.value);setReview(false)}}/></label><p>Available: {token?formatUnits(action==='repay'?token.wallet:token.free,token.decimals):'Unavailable'} {token?.symbol}</p>{action==='repay'&&data.borrowShares===0n&&<p>No borrow shares to repay in this market.</p>}{action==='repay'&&<p>Exact debt and LTV are not quoted here. Full-share repayment reverts if the actual debt exceeds your entered approval cap. Partial repayment uses exactly the entered amount.</p>}{error&&<p role="alert">{error}</p>}{review?<><p>Review {input} {token?.symbol} · {action==='repay'?'from your wallet to Morpho for this vault; allowance is set to exactly the entered cap':'from free vault balance to your connected wallet; locked collateral stays in Morpho'}.</p><PrototypeButton primary disabled={busy||!address||chainId!==84532} onClick={()=>void execute()}>Continue to wallet</PrototypeButton><PrototypeButton disabled={busy} onClick={()=>setReview(false)}>Cancel review</PrototypeButton></>:<PrototypeButton disabled={busy||amount<=0n||!!error||!!token&&amount>(action==='repay'?token.wallet:token.free)||action==='repay'&&data.borrowShares===0n} onClick={()=>setReview(true)}>Review recovery action</PrototypeButton>}</>}<PrototypeButton disabled={busy} onClick={()=>void check()}>Check pending confirmation</PrototypeButton><p role="status">{message}</p>{hash&&<a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction ↗</a>}</PrototypeSurface></details>
}

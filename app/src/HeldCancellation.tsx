import {useEffect,useRef,useState} from 'react'
import {formatEther,type Hex} from 'viem'
import {useAccount,usePublicClient,useSignMessage} from 'wagmi'
import {loadConfig,viewNear,type Vault} from './near.ts'
import {ownerPendingRecord,assertFreshOwnerIntent,readOwnerRecovery,verifyOwnerJob,unsubmittedOwnerExpired,type SignedOwnerTransaction} from './owner-recovery.ts'
import {checkSetupSignature,startSetupJob,readSetupJob} from './vault-setup.ts'
import {ownerTransactionsConsumed} from './transaction-recovery.ts'
import {cancellationMessage,validateCancellation,cancellableNonce,replaceHeldRecord,archiveCancellation,type HeldRecord,type Cancellation} from './held-cancellation.ts'
import {PrototypeButton,PrototypeSurface} from './ui/PrototypeControls.tsx'

type Review={raw:string;signed:SignedOwnerTransaction[];near:string;nonce:number;gas:bigint}
export function HeldCancellation({vault,onRefresh}:{vault:Vault;onRefresh:()=>void}) {
 const {address,chainId}=useAccount(),client=usePublicClient({chainId:84532}),{signMessageAsync}=useSignMessage()
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[originalNear,setOriginalNear]=useState(''),[cancelNear,setCancelNear]=useState(''),[review,setReview]=useState<Review>(),[resumable,setResumable]=useState<{raw:string;tx:SignedOwnerTransaction}>(),[txHash,setTxHash]=useState(''),[evidence,setEvidence]=useState('')
 const flight=useRef(false),alive=useRef(true),session=useRef(''),reviewHeading=useRef<HTMLHeadingElement>(null),inspectTrigger=useRef<HTMLButtonElement>(null)
 session.current=`${vault.accountId}:${address}:${chainId}`
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 useEffect(()=>{if(review)reviewHeading.current?.focus()},[review])
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 useEffect(()=>{setReview(undefined);setResumable(undefined);setOriginalNear('');setCancelNear('');setTxHash('');setEvidence('');try{const stored=JSON.parse(localStorage.getItem(key)??'{}');setMessage(stored.cancellation?'A cancellation is persisted. Check confirmation before signing again.':'');const last=localStorage.getItem(`${key}:cancel-evidence:last`);if(last?.startsWith(`${key}:cancel-evidence:`))setEvidence(localStorage.getItem(last)??'')}catch{setMessage('Stored recovery evidence is unreadable. Do not resubmit the action.')}},[key,chainId])
 function assertSession(expected:string){if(!alive.current||session.current!==expected)throw Error('Wallet or vault changed. Reopen cancellation.')}
 function record(){const raw=localStorage.getItem(key);if(!raw)throw Error('No pending action for this wallet and vault.');const value=JSON.parse(raw) as HeldRecord;if(!value.message||!value.ownerNonce||value.kind!=='owner')throw Error('An exact persisted owner intent is required. Legacy or direct wallet transactions need separate recovery.');return{raw,value}}
 async function counts(){if(!client||!vault.baseAddress)throw Error('Base vault unavailable.');if(chainId!==84532||await client.getChainId()!==84532)throw Error('Connect the owner on Base Sepolia.');const block=await client.getBlockNumber();if(block<1n)throw Error('Confirmed Base block unavailable.');const base=vault.baseAddress as Hex;const [confirmed,pending]=await Promise.all([client.getTransactionCount({address:base,blockNumber:block-1n}),client.getTransactionCount({address:base,blockTag:'pending'})]);return{confirmed,pending}}
 async function inspect(){if(flight.current||!client||!address)return;const expected=session.current;flight.current=true;setBusy(true);setReview(undefined);setMessage('Verifying the original owner-call and signed nonces…')
 try{
  const {raw,value}=record();if(value.cancellation)throw Error('A cancellation is already persisted. Check its confirmation below.')
  if(address.toLowerCase()!==vault.owner.toLowerCase())throw Error('Connect the vault owner.')
  const config=await loadConfig();let signed:SignedOwnerTransaction[],near=originalNear
  if(originalNear){const block=await client.getBlock();if(value.expiry===undefined||BigInt(value.expiry)>=block.timestamp)throw Error('Wait until the original NEAR intent expires before recovering a lost job by hash.');signed=await readOwnerRecovery(config,vault,value,near)}
  else if(value.job){const job=await readSetupJob(config,value.job);if(job.stage!=='failed')throw Error('The original relayer job is not terminal. Wait for its outcome before cancelling.');signed=await verifyOwnerJob(config,vault,value,job);near=job.near_tx!}
  else {const block=await client.getBlock();if(value.expiry===undefined||BigInt(value.expiry)>=block.timestamp)throw Error('Wait until the original NEAR intent expires, then enter its finalized NEAR hash.');signed=await readOwnerRecovery(config,vault,value,near)}
  const {confirmed,pending}=await counts();const nonce=cancellableNonce(signed,vault.baseAddress!,confirmed,pending);const gas=await client.getBalance({address:vault.baseAddress as Hex})
  assertSession(expected);if(localStorage.getItem(key)!==raw)throw Error('Pending action changed. Inspect it again.');setReview({raw,signed,near,nonce,gas});setMessage('Review one cancellation. No transaction has been submitted.')
 }catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function cancel(){if(flight.current||!review||!client||!address)return;const expected=session.current;flight.current=true;setBusy(true)
 try{
  const current=record();if(current.raw!==review.raw||current.value.cancellation)throw Error('Recovery changed. Inspect again.')
  const config=await loadConfig(),state=await viewNear<{owner:string;owner_nonce:string|number}>(config.nearRpcUrl,vault.accountId,'get_state')
  if(state.owner.toLowerCase()!==address.toLowerCase())throw Error('Connect the current vault owner.')
  const now=await client.getBlock(),text=cancellationMessage(vault.accountId,Number(state.owner_nonce)+1,Number(now.timestamp)+600)
  const before=await counts();if(cancellableNonce(review.signed,vault.baseAddress!,before.confirmed,before.pending)!==review.nonce)throw Error('Base nonce changed. Inspect the original action again.')
  assertSession(expected);const signature=await signMessageAsync({message:text});assertSession(expected);await checkSetupSignature(text,signature,address);await assertFreshOwnerIntent(config,vault,text)
  const after=await counts();if(cancellableNonce(review.signed,vault.baseAddress!,after.confirmed,after.pending)!==review.nonce)throw Error('Base nonce changed while signing. Nothing was submitted; inspect again.')
  assertSession(expected);const cancellation={...ownerPendingRecord(text),originalNear:review.near} as Cancellation
  const next={...current.value,cancellation};replaceHeldRecord(key,current.raw,next);setReview(undefined);setMessage('Cancellation intent persisted. Submitting once…')
  const persisted=JSON.stringify(next),job=await startSetupJob(config,vault.accountId,text,signature)
  replaceHeldRecord(key,persisted,{...next,cancellation:{...cancellation,job}});setMessage('Cancellation submitted. Check confirmation; do not repeat the signature.')
 }catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function check(){if(flight.current||!client||!address)return;const expected=session.current;flight.current=true;setBusy(true);setResumable(undefined)
 try{
  const {raw,value}=record(),c=value.cancellation;if(!c?.message)throw Error('No persisted cancellation. Inspect held calls first.')
  const config=await loadConfig();await counts()
  let signed:SignedOwnerTransaction[]
  if(cancelNear)signed=await readOwnerRecovery(config,vault,c,cancelNear)
  else if(c.job){const job=await readSetupJob(config,c.job);if(!job.near_tx&&await unsubmittedOwnerExpired(config,vault,c)){assertSession(expected);replaceHeldRecord(key,raw,{...value,cancellation:undefined});setMessage('Unused cancellation intent expired. The original action remains locked; inspect before retrying.');return}signed=await verifyOwnerJob(config,vault,c,job)}
  else {if(await unsubmittedOwnerExpired(config,vault,c)){assertSession(expected);replaceHeldRecord(key,raw,{...value,cancellation:undefined});setMessage('Unused cancellation intent expired. Original intent retained.');return}throw Error('Cancellation outcome is uncertain. Enter its finalized NEAR hash; do not sign again.')}
  const tx=validateCancellation(signed,vault.baseAddress!)
  setTxHash(tx.hash)
  const receipt=await client.getTransactionReceipt({hash:tx.hash}).catch(()=>null)
  if(!receipt){assertSession(expected);setResumable({raw,tx});throw Error('Verified cancellation has no receipt. You may broadcast only this exact zero-value self-transfer below.')}
  await client.waitForTransactionReceipt({hash:tx.hash,confirmations:2})
  const original=await readOwnerRecovery(config,vault,value,c.originalNear),{confirmed}=await counts()
  if(tx.nonce>=confirmed)throw Error('Cancellation is still confirming.')
  const complete=ownerTransactionsConsumed(original,vault.baseAddress!,confirmed)
  assertSession(expected);if(localStorage.getItem(key)!==raw)throw Error('Recovery changed. Check again.');archiveCancellation(key,value,tx.hash,confirmed,complete);setEvidence(localStorage.getItem(`${key}:cancel-evidence:${value.ownerNonce}`)??'');replaceHeldRecord(key,raw,complete?null:{...value,cancellation:undefined});setReview(undefined);onRefresh()
  setMessage((receipt.status==='success'?'':'Cancellation reverted, but its Base nonce was consumed. ')+(complete?'All original Base nonces are consumed. Recovery unlocked. Inspect Activity: an original call may have executed before cancellation.':'One cancellation confirmed. Original intent retained: further held nonces remain. Inspect and review the next cancellation separately.'))
 }catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function broadcast(){if(flight.current||!client||!resumable)return;const expected=session.current;flight.current=true;setBusy(true)
 try{if(address?.toLowerCase()!==vault.owner.toLowerCase())throw Error('Connect the vault owner.');await counts();assertSession(expected);if(localStorage.getItem(key)!==resumable.raw)throw Error('Cancellation evidence changed. Check again.');validateCancellation([resumable.tx],vault.baseAddress!);const hash=await client.sendRawTransaction({serializedTransaction:resumable.tx.raw});if(hash.toLowerCase()!==resumable.tx.hash.toLowerCase())throw Error('Unexpected cancellation broadcast hash.');setTxHash(hash);setResumable(undefined);setMessage('Existing cancellation broadcast. Check confirmation; no new owner intent was signed.')}
 catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return <details className="held-cancellation"><summary>Held transaction cancellation</summary><PrototypeSurface className="live-actions"><h3>Cancel held Base calls</h3><p>For held calls from a failed or recovered owner-call. Preserve the original intent, verify its finalized NEAR result and consume outstanding Base nonces one at a time. No approvals or funds are transferred by cancel; the vault pays test ETH gas.</p><label>Original NEAR hash · if its job is unavailable<input value={originalNear} disabled={busy} onChange={e=>{setOriginalNear(e.target.value.trim());setReview(undefined)}}/></label><PrototypeButton buttonRef={inspectTrigger} disabled={busy||!address||chainId!==84532} onClick={()=>void inspect()}>Inspect held calls</PrototypeButton>{review&&<section aria-label="Review cancellation"><h3 tabIndex={-1} ref={reviewHeading}>Review one cancellation</h3><p>Vault: {vault.accountId}</p><p>Next verified Base nonce: {review.nonce}. Gas balance: {formatEther(review.gas)} test ETH.</p><p>The relayer chooses the pending nonce when it submits. If the original call wins the race, it can still execute. One cancel does not cancel a whole batch. Review the resulting receipts before continuing.</p><details><summary>Original intent and signed calls</summary><pre>{JSON.parse(review.raw).message}</pre>{review.signed.map(tx=><p key={tx.hash}>Nonce {tx.nonce} · <a href={`https://sepolia.basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash.slice(0,14)}… ↗</a></p>)}</details><PrototypeButton primary disabled={busy} onClick={()=>void cancel()}>Sign one cancellation</PrototypeButton><PrototypeButton disabled={busy} onClick={()=>{setReview(undefined);inspectTrigger.current?.focus();setMessage('Review dismissed. Original intent retained.')}}>Dismiss review</PrototypeButton></section>}<label>Cancellation NEAR hash · if its job was lost<input value={cancelNear} disabled={busy} onChange={e=>{setCancelNear(e.target.value.trim());setResumable(undefined)}}/></label><PrototypeButton disabled={busy||!address||chainId!==84532} onClick={()=>void check()}>Check cancellation</PrototypeButton>{resumable&&<PrototypeButton disabled={busy} onClick={()=>void broadcast()}>Broadcast verified cancellation</PrototypeButton>}<p className="position-read-status" role="status">{message||'No cancellation requested.'}</p>{evidence&&<details><summary>Saved cancellation evidence · this browser</summary><pre>{evidence}</pre></details>}{txHash&&<a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">Cancellation Base transaction ↗</a>}</PrototypeSurface></details>
}

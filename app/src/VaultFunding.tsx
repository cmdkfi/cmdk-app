import {fundingIntent} from './vault-funding.ts'
import {useEffect,useRef,useState} from 'react'
import {formatUnits,parseAbi,type Hex} from 'viem'
import {useAccount,usePublicClient,useSignMessage} from 'wagmi'
import {loadConfig,viewNear,type Vault} from './near.ts'
import {readLivePosition,type MarketPosition,type VaultState} from './positions.ts'
import {erc20,parseAmount} from './live-actions.ts'
import {ownerPendingRecord,verifyOwnerJob} from './owner-recovery.ts'
import {checkSetupSignature,readSetupJob,startSetupJob} from './vault-setup.ts'
import {PrototypeButton,PrototypeSurface} from './ui/PrototypeControls.tsx'
const abi=parseAbi(['function open(bytes32,uint256,uint256,uint256)','function openFromStables(bytes32,uint256,uint256,uint256)'])

export function VaultFunding({vault,market,onRefresh}:{vault:Vault;market:MarketPosition;onRefresh:()=>void}) {
 const {address,chainId}=useAccount(),client=usePublicClient({chainId:84532}),{signMessageAsync}=useSignMessage()
 const [source,setSource]=useState<'collateral'|'loan'>('collateral'),[input,setInput]=useState(''),[balance,setBalance]=useState<bigint>(),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[hash,setHash]=useState(''),[nearTx,setNearTx]=useState('')
 const flight=useRef(false),alive=useRef(true),session=useRef('');session.current=`${vault.accountId}:${address}:${chainId}`
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const token=source==='collateral'?market.collateralToken:market.loanToken,decimals=source==='collateral'?market.collateralDecimals:market.loanDecimals,symbol=source==='collateral'?market.collateralSymbol:market.loanSymbol
 const key=`cmdk-live-action:${vault.accountId}:${address}`
 useEffect(()=>{let active=true;setBalance(undefined);if(client&&vault.baseAddress)client.readContract({address:token,abi:erc20,functionName:'balanceOf',args:[vault.baseAddress as Hex]}).then(value=>{if(active)setBalance(value)}).catch(()=>{if(active)setMessage('Free balance unavailable.')});return()=>{active=false}},[client,token,vault.baseAddress,market])
 function assertSession(expected:string){if(!alive.current||session.current!==expected)throw Error('Wallet or vault changed. Reopen funding.')}
 let amount=0n,error='';try{if(input)amount=parseAmount(input,decimals)}catch(e){error=(e as Error).message}
 async function sign(){if(flight.current||!client||!address||!vault.baseAddress)return;const expected=session.current;flight.current=true;setBusy(true)
 try{
 if(chainId!==84532||await client.getChainId()!==84532)throw Error('Switch to Base Sepolia.')
 if(localStorage.getItem(key))throw Error('Another vault action is pending.')
 const config=await loadConfig(),position=await readLivePosition(config,vault.accountId,address),fresh=position.markets.find(m=>m.id===market.id)
 if(!fresh||fresh.readOnly||fresh.policyUnavailable||fresh.priceUnavailable||!fresh.executor||fresh.agentTarget===null||fresh.agentTrigger===null||fresh.agentTarget>fresh.agentTrigger||fresh.agentTarget>=fresh.liquidationLtv)throw Error('Fresh supported market, oracle and corridor are required.')
 if(fresh.agentTarget!==market.agentTarget||position.baseAddress.toLowerCase()!==vault.baseAddress.toLowerCase())throw Error('Target or vault changed. Refresh and review again.')
 const intent=fundingIntent(fresh,source,amount)
 const free=await client.readContract({address:token,abi:erc20,functionName:'balanceOf',args:[position.baseAddress]})
 const allowance=await client.readContract({address:token,abi:erc20,functionName:'allowance',args:[position.baseAddress,fresh.executor]})
 if(amount<=0n||amount>free)throw Error('Amount exceeds free vault funds.')
 if(allowance<amount)throw Error('Executor allowance is insufficient. Inspect / repair setup first.')
 const state=await viewNear<VaultState>(config.nearRpcUrl,vault.accountId,'get_state');if(state.owner?.toLowerCase()!==address.toLowerCase())throw Error('Connect the vault owner.')
 const expiry=Number((await client.getBlock()).timestamp)+600,target=fresh.agentTarget
 await client.simulateContract({account:position.baseAddress,address:fresh.executor,abi,functionName:source==='collateral'?'open':'openFromStables',args:[fresh.id,amount,target,BigInt(expiry)]})
 const nonce=Number(state.owner_nonce)+1;if(!Number.isSafeInteger(nonce)||nonce<1)throw Error('Owner nonce unavailable.')
 const text=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:vault.accountId,method:intent.method,args:intent.args,nonce,expiry})
 assertSession(expected);const signature=await signMessageAsync({message:text});await checkSetupSignature(text,signature,address);assertSession(expected)
 if(localStorage.getItem(key))throw Error('Another vault action started.')
 localStorage.setItem(key,JSON.stringify(ownerPendingRecord(text,{operation:'funding',market:fresh.id})))
 const job=await startSetupJob(config,vault.accountId,text,signature);localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)??'{}'),job}));setMessage('Submitted. Check funding confirmation. Borrowed USDC stays at the vault.');setReview(false)
 }catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 async function check(){if(flight.current||!client)return;const expected=session.current;flight.current=true;setBusy(true);try{const record=JSON.parse(localStorage.getItem(key)??'{}');if(record.operation!=='funding'||record.market!==market.id||!record.job)throw Error('No funding job for this market. Use transaction recovery if its response was lost.');const config=await loadConfig(),job=await readSetupJob(config,record.job);if(job.vault!==vault.accountId||job.stage!=='done'||job.base_sent?.length!==1)throw Error(job.error??'Funding is not confirmed yet.');await verifyOwnerJob(config,vault,record,job);setHash(job.base_sent[0]);setNearTx(job.near_tx??'');const receipt=await client.waitForTransactionReceipt({hash:job.base_sent[0] as Hex,confirmations:2});if(receipt.status!=='success')throw Error('Funding transaction reverted. Use transaction recovery.');assertSession(expected);localStorage.removeItem(key);setInput('');setMessage('Confirmed on Base. Position refreshed.');onRefresh()}catch(e){setMessage((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return <details><summary>Deploy free vault funds / reopen</summary><PrototypeSurface className="live-actions"><h3>Supply and borrow from vault funds</h3><p>This supplies free vault tokens and borrows to the stored Target. It also reopens an agent-closed market. Borrowed USDC remains in the vault.</p><label>Free asset<select value={source} disabled={busy} onChange={e=>{setSource(e.target.value as 'collateral'|'loan');setInput('');setReview(false)}}><option value="collateral">{market.collateralSymbol} · supply and borrow</option><option value="loan">{market.loanSymbol} · swap to collateral and borrow</option></select></label><label>Amount · {symbol}<input inputMode="decimal" value={input} disabled={busy} onChange={e=>{setInput(e.target.value);setReview(false)}}/></label><p>Free balance: {balance===undefined?'Unavailable':formatUnits(balance,decimals)} {symbol}</p><PrototypeButton disabled={busy||balance===undefined} onClick={()=>{setInput(formatUnits(balance??0n,decimals));setReview(false)}}>100.0%</PrototypeButton><p>Stored Target: {market.agentTarget===null?'Unavailable':`${(Number(market.agentTarget)/1e16).toFixed(1)}%`}. Final borrow size and swap output are determined at execution and checked by the Executor.</p>{error&&<p role="alert">{error}</p>}{review?<><p>Review {input} {symbol} from {vault.accountId}. {source==='loan'?'Swaps loan tokens into collateral before supplying.':'Supplies the free collateral token.'} This can create or increase debt and re-enable agent actions on this market.</p><PrototypeButton primary disabled={busy||!address||chainId!==84532} onClick={()=>void sign()}>Continue to wallet</PrototypeButton><PrototypeButton disabled={busy} onClick={()=>setReview(false)}>Cancel review</PrototypeButton></>:<PrototypeButton disabled={busy||amount<=0n||balance===undefined||amount>balance||!!error||market.readOnly||market.policyUnavailable||market.priceUnavailable} onClick={()=>setReview(true)}>Review vault funding</PrototypeButton>}<PrototypeButton disabled={busy} onClick={()=>void check()}>Check funding confirmation</PrototypeButton><p role="status">{message}</p>{hash&&<p><a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">Base transaction ↗</a></p>}{nearTx&&<p><a href={`https://testnet.nearblocks.io/txns/${nearTx}`} target="_blank" rel="noreferrer">NEAR owner-call ↗</a></p>}</PrototypeSurface></details>
}

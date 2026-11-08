import {useEffect,useState} from 'react'
import {isAddress,type Hex,type Address} from 'viem'
import {loadConfig,type Vault} from './near.ts'
import {VerificationDetails} from './VerificationDetails.tsx'
import {PrototypeButton} from './ui/PrototypeControls.tsx'

type Inspection={vault:Vault;market:{id:Hex;executor:Address;morpho:Address;readOnly:true}}
export function VerificationPage({accountId}:{accountId:string}) {
 const [revision,setRevision]=useState(0),[result,setResult]=useState<{id:string;data?:Inspection;error?:string}>()
 useEffect(()=>{
  const controller=new AbortController();setResult(undefined)
  void(async()=>{
   try{
    const config=await loadConfig()
    const prefix=accountId.slice(0,-(`.${config.near.factory}`).length)
    if(!config.near.factory||!accountId.endsWith(`.${config.near.factory}`)||!/^v[1-9][0-9]*$/.test(prefix))throw Error('Use a vault from the published NEAR Testnet factory.')
    const response=await fetch(`${config.relayerUrl}/vault/${encodeURIComponent(accountId)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:'no-store'})
    if(!response.ok)throw Error(`Public vault read unavailable (HTTP ${response.status}).`)
    const payload=await response.json(),state=payload.state,market=state?.markets?.[0]
    if(payload.ok!==true||payload.vault!==accountId||!isAddress(state?.owner??'')||!isAddress(state?.base_address??'')||!isAddress(state?.morpho??'')||!Array.isArray(state?.markets)||!Number.isSafeInteger(Number(prefix.slice(1)))||!/^0x[0-9a-fA-F]{64}$/.test(market?.id??'')||!isAddress(market?.executor??''))throw Error('Public vault response is incomplete or names another vault.')
    const data:Inspection={vault:{accountId,number:Number(prefix.slice(1)),owner:state.owner,baseAddress:state.base_address,marketCount:state.markets.length},market:{id:market.id,executor:market.executor,morpho:state.morpho,readOnly:true}}
    if(!controller.signal.aborted)setResult({id:accountId,data})
   }catch(error){if(!controller.signal.aborted)setResult({id:accountId,error:(error as Error).message})}
  })()
  return()=>controller.abort()
 },[accountId,revision])
 const current=result?.id===accountId?result:undefined
 return <section aria-label="Public vault verification"><p>Read-only public inspection. Vault identity comes from the protocol relayer; NEAR registration and evidence are checked independently in the panel. No wallet or signature is needed.</p>{!current?<p role="status">Reading vault identity…</p>:current.data?<><p className="vault-detail-address">{accountId}</p><VerificationDetails key={`${accountId}:${revision}`} vault={current.data.vault} market={current.data.market} inspectionOnly autoOpen/></>:<><p role="alert">{current.error}</p><PrototypeButton onClick={()=>setRevision(value=>value+1)}>Retry public vault read</PrototypeButton></>}</section>
}

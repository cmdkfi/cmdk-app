import {createHash} from 'node:crypto'
import {test as base,expect,type BrowserContext} from '@playwright/test'
import {decodeFunctionData,encodeFunctionResult,encodeFunctionData,parseAbi,keccak256,hexToString,toHex,type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {OTHER,OWNER,BASE,EXECUTOR,MORPHO,LIVE,BACKUP,VAULT,KEY,NOW,config,AGENT_BOOT,AGENT_KEY,AGENT_NEAR,measurement} from './data.ts'
const owner=privateKeyToAccount(('0x'+'11'.repeat(32)) as Hex),baseAccount=privateKeyToAccount(('0x'+'22'.repeat(32)) as Hex)
const HASH='0x'+'77'.repeat(32),ORIGINAL_NEAR='1'.repeat(44)
const ABI=parseAbi(['function corridors(address,bytes32) view returns(uint64,uint64,uint64,uint64,bool,bool,bool)','function setCorridor(bytes32,(uint64 target,uint64 act,uint64 floor,uint64 sellBudget,bool migrateAllowed,bool exitAllowed,bool set),uint256)','function allowance(address,address) view returns(uint256)','function isAuthorized(address,address) view returns(bool)','function balanceOf(address) view returns(uint256)','function getEthBalance(address) view returns(uint256)'])
const MULTICALL=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)'])
const pct=(n:number)=>BigInt(n)*10n**16n
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64')
type Signed={raw:Hex;hash:Hex;from:string;nonce:number}
export class ProtocolFixture {
 posts:{vault:string;message:string;signature:Hex}[]=[]
 signs:string[]=[];unexpected:string[]=[];broadcasts:string[]=[];walletCalls:string[]=[]
 runtimeErrors:string[]=[];ruleSigned:Signed[]=[];finishRules=false
 ownerNonce=3;confirmed=8;pending=8;contractWallet=false;losePost=false;finishCancel=false
 onSign?:()=>Promise<void>|void
 corridors=new Map([[LIVE,[pct(50),pct(70),pct(30),pct(20),true,true,true]],[BACKUP,[pct(45),pct(65),pct(25),pct(15),false,false,true]]])
 originalMessage=JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault:VAULT,method:'setup',args:{markets:[{market:LIVE,approve:false,authorize:false,corridor:{target:pct(50).toString(),act:pct(70).toString(),floor:pct(30).toString(),sell_budget:pct(20).toString(),migrate_allowed:true,exit_allowed:true}},{market:BACKUP,approve:false,authorize:false,corridor:{target:pct(45).toString(),act:pct(65).toString(),floor:pct(25).toString(),sell_budget:pct(15).toString(),migrate_allowed:false,exit_allowed:false}}],measurement:null},nonce:3,expiry:NOW-60})
 originalRecord:Record<string,unknown>={};originalSigned:Signed[]=[]
 nearResults=new Map<string,{message:string;signature:Hex;signed:Signed[]}>()
 jobs=new Map<string,Record<string,unknown>>()
 factoryCount=0;wrongPublicVault=false;publicVaultUnavailable=false;failEvidenceIndex=false;failTranscripts=false;failNearState=false;
 evidenceBoot=AGENT_BOOT;evidenceCount=2;evidenceStamp=Math.floor(Date.now()/1000)-60;corruptEvidence='';corruptTranscript=false;wrongTranscriptVault=false;secondaryError=false;rotateEvidence=false;agentWrongArgs=false;agentReceiptStatus='0x1';agentSigned?:Signed
 directReceipt=false;lastCancelNear='';lastCancel?:Signed
 async signed(nonce:number,to:Hex,data:Hex='0x'):Promise<Signed>{const raw=await baseAccount.signTransaction({chainId:84532,type:'eip1559',nonce,to,data,value:0n,gas:300000n,maxFeePerGas:1000000000n,maxPriorityFeePerGas:1n});return{raw,hash:keccak256(raw),from:BASE,nonce}}
 async setup(){
  for(const [index,id] of [LIVE,BACKUP].entries()){const c=this.corridors.get(id)!;this.originalSigned.push(await this.signed(8+index,EXECUTOR,encodeFunctionData({abi:ABI,functionName:'setCorridor',args:[id,{target:c[0] as bigint,act:c[1] as bigint,floor:c[2] as bigint,sellBudget:c[3] as bigint,migrateAllowed:c[4] as boolean,exitAllowed:c[5] as boolean,set:false},BigInt(NOW+600)]})))}
  this.agentSigned=await this.signed(8,EXECUTOR,encodeFunctionData({abi:parseAbi(['function reduce(bytes32,uint256,uint256)']),functionName:'reduce',args:[LIVE,100n,BigInt(NOW+600)]}))
  this.nearResults.set(ORIGINAL_NEAR,{message:this.originalMessage,signature:await owner.signMessage({message:this.originalMessage}),signed:this.originalSigned})
  this.originalRecord={pending:true,kind:'owner',message:this.originalMessage,ownerNonce:'3',expiry:NOW-60,startedAt:1,job:'a'.repeat(16)}
  this.jobs.set('a'.repeat(16),{kind:'owner_call',job:'a'.repeat(16),stage:'failed',vault:VAULT,near_tx:ORIGINAL_NEAR,base_sent:[],error:'fixture: broadcast stopped'})
 }
 rpc(method:string,params:unknown[]):unknown {
  const block={number:'0x64',hash:HASH,parentHash:HASH,nonce:'0x0000000000000000',sha3Uncles:HASH,logsBloom:'0x'+'00'.repeat(256),transactionsRoot:HASH,stateRoot:HASH,receiptsRoot:HASH,miner:BASE,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x1',gasLimit:'0x1c9c380',gasUsed:'0x0',timestamp:toHex(NOW),transactions:[],uncles:[],baseFeePerGas:'0x1'}
  switch(method){
   case 'eth_chainId':return '0x14a34'
   case 'eth_getCode':return this.contractWallet?'0x60006000':'0x'
   case 'eth_blockNumber':return '0x64'
   case 'eth_getBlockByNumber':return block
   case 'eth_getBalance':return toHex(10n**18n)
   case 'eth_getTransactionCount':return toHex(params[1]==='pending'?this.pending:this.confirmed)
   case 'eth_getTransactionReceipt':{
    const hash=params[0] as Hex
    const agent=hash===this.agentSigned?.hash
    const direct=this.directReceipt&&hash==='0x'+'dd'.repeat(32)
    if(!agent&&!direct&&!(this.finishCancel&&hash===this.lastCancel?.hash)&&!(this.finishRules&&this.ruleSigned.some(tx=>tx.hash===hash)))return null
    return {transactionHash:hash,transactionIndex:'0x0',blockHash:HASH,blockNumber:'0x63',from:direct?OWNER:BASE,to:agent?EXECUTOR:direct?MORPHO:BASE,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',effectiveGasPrice:'0x1',contractAddress:null,logs:[],logsBloom:'0x'+'00'.repeat(256),status:agent?this.agentReceiptStatus:direct?'0x0':'0x1',type:'0x2'}
   }
   case 'eth_sendRawTransaction':{
    if(params[0]!==this.lastCancel?.raw)throw Error('Only exact verified cancellation rebroadcast is permitted by this fixture.')
    this.broadcasts.push(String(params[0]));return this.lastCancel!.hash
   }
   case 'eth_call':{
    const call=params[0] as {data:Hex}
    if(call.data.startsWith('0x82ad56cb')){const batch=decodeFunctionData({abi:MULTICALL,data:call.data});return encodeFunctionResult({abi:MULTICALL,functionName:'aggregate3',result:batch.args[0].map(item=>({success:true,returnData:this.rpc('eth_call',[{to:item.target,data:item.callData},params[1]]) as Hex}))})}
    const decoded=decodeFunctionData({abi:ABI,data:call.data})
    const result=decoded.functionName==='corridors'?this.corridors.get(decoded.args[1])!:decoded.functionName==='isAuthorized'?true:decoded.functionName==='allowance'?(1n<<256n)-1n:['balanceOf','getEthBalance'].includes(decoded.functionName)?10n**18n:undefined
    return encodeFunctionResult({abi:ABI,functionName:decoded.functionName,result:result as never})
   }
   default:throw Error(`Unexpected RPC ${method}`)
  }
 }
 evidenceFiles(){
  const values:Record<string,unknown>={'info.json':{tcb_info:measurement},'event_log.json':[],'app-compose.json':{services:{}},'vm_config.json':{},'tdx_quote.hex':'deadbeef','registration-v1.json':{vault:VAULT,registered:true,vault_agent:{public_key:AGENT_KEY},near_tx:'5'.repeat(44)},'registration-v2.json':{vault:'v2.fixture.testnet',registered:true,vault_agent:{public_key:AGENT_KEY}}}
  return Object.entries(values).map(([name,value])=>{const text=typeof value==='string'?value:JSON.stringify(value);return{name,text,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}})
 }
 evidenceTranscripts(){
  return Array.from({length:this.evidenceCount},(_,index)=>{
   const loop=index+1,name=`${this.evidenceBoot}-v1-${String(loop).padStart(4,'0')}.json`
   const data:Record<string,unknown>={agent:{boot:this.evidenceBoot,public_key:AGENT_KEY,measurement},vault:{id:this.wrongTranscriptVault?'v2.fixture.testnet':VAULT},network:'Base Sepolia',twin:false,loop,time_utc:new Date((this.evidenceStamp+loop)*1000).toISOString(),inputs:{snapshot:{timestamp:this.evidenceStamp+loop,block:100,user:BASE,read_errors:[],rpc_disagree:[],rpc_second_error:this.secondaryError&&loop===this.evidenceCount?'secondary RPC timeout':null}},decisions:[]}
   if(loop===1)data.proposal={sent:true,method:'reduce',args:{market:LIVE,amount:'100'},near_tx:AGENT_NEAR,base:{hash:this.agentSigned!.hash,status:1}}
   const text=JSON.stringify(data);return{name,text,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),boot:this.evidenceBoot,vault:'v1',twin:false,loop}
  })
 }
 confirmRules(){
  const intent=JSON.parse(this.posts.at(-1)!.message);const updates=intent.method==='setup'?intent.args.markets.map((m:{market:string;corridor:Record<string,unknown>})=>({market:m.market,...m.corridor})):[intent.args]
  for(const u of updates)this.corridors.set(u.market,[BigInt(u.target),BigInt(u.act),BigInt(u.floor),BigInt(u.sell_budget),u.migrate_allowed,u.exit_allowed,true]);this.finishRules=true
 }
 async install(context:BrowserContext,{pending=false,directRevert=false,rejectConnect=false,chain='0x14a34'}={}) {
  await this.setup();this.directReceipt=directRevert
  context.on('page',page=>page.on('pageerror',error=>this.runtimeErrors.push(error.message)))
  await context.exposeBinding('fixtureSign',async(_source,text:string)=>{const message=hexToString(text as Hex);this.signs.push(message);await this.onSign?.();return owner.signMessage({message})})
  await context.exposeBinding('fixtureWalletCall',(_source,method:string)=>{this.walletCalls.push(method)})
  await context.addInitScript(({owner,key,record,reject,initialChain})=>{
   const listeners=new Map<string,Set<(...args:unknown[])=>void>>();let connected=false
   const emit=(name:string,value:unknown)=>listeners.get(name)?.forEach(fn=>fn(value))
   const control={account:owner,chain:initialChain,rejectConnect:reject,rejectSign:false,changeAccount(address:string){this.account=address;connected=true;emit('accountsChanged',[address])}}
   Object.assign(window,{fixtureWallet:control})
   const provider={isMetaMask:true,on(name:string,fn:(...args:unknown[])=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn)},removeListener(name:string,fn:(...args:unknown[])=>void){listeners.get(name)?.delete(fn)},async request({method,params=[]}:{method:string;params:unknown[]}){
    await window.fixtureWalletCall(method)
    switch(method){
     case 'eth_accounts':return connected?[control.account]:[]
     case 'eth_requestAccounts':if(control.rejectConnect){control.rejectConnect=false;throw Object.assign(Error('User rejected connection'),{code:4001})}connected=true;return[control.account]
     case 'eth_chainId':return control.chain
     case 'net_version':return String(parseInt(control.chain,16))
     case 'wallet_switchEthereumChain':control.chain=(params[0] as {chainId:string}).chainId;emit('chainChanged',control.chain);return null
     case 'wallet_revokePermissions':connected=false;emit('accountsChanged',[]);return null
     case 'personal_sign':if(control.rejectSign){control.rejectSign=false;throw Object.assign(Error('User rejected signature'),{code:4001})}return window.fixtureSign(String(params[0]))
     default:throw Error(`Forbidden wallet method: ${method}`)
    }
   }}
   Object.defineProperty(window,'ethereum',{value:provider,configurable:true})
   window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'4d2224fe-9aae-4a71-8d77-555555555555',name:'MetaMask Fixture',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'io.metamask'},provider}})))
   if(record&&!sessionStorage.getItem('fixture-seeded')){localStorage.setItem(key,record);sessionStorage.setItem('fixture-seeded','yes')}
  },{owner:OWNER,key:KEY,record:directRevert?JSON.stringify({pending:true,hash:'0x'+'dd'.repeat(32),to:MORPHO,data:'0x',value:'0',startedAt:1}):pending?JSON.stringify(this.originalRecord):null,reject:rejectConnect,initialChain:chain})
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   try{
    if(url.hostname==='localhost'&&url.port==='5177'){
     if(url.pathname==='/config.json')return route.fulfill({json:config})
     return route.continue()
    }
    // SDK analytics are deliberately swallowed locally, never forwarded.
    if(url.hostname==='cca-lite.coinbase.com')return route.fulfill({status:204,body:''})
    if(url.hostname==='near.fixture.test'){
     const req=request.postDataJSON();let result:unknown
     if(this.failNearState&&req.params?.method_name==='get_state')return route.fulfill({status:503,body:'NEAR temporarily unavailable'})
     if(req.method==='query'){
      const state=req.params.method_name==='get_config'?{count:this.factoryCount}:{owner:OWNER,owner_nonce:this.ownerNonce,base_address:BASE,approved:measurement,agent:{public_key:AGENT_KEY,expires_at:NOW+86400},markets:[LIVE,BACKUP].map(id=>({id,executor:EXECUTOR,corridor_set:true}))}
      result={block_hash:HASH,result:[...Buffer.from(JSON.stringify(state))]}
     }else if(req.method==='tx'){
      if(req.params.tx_hash===AGENT_NEAR){return route.fulfill({json:{result:{final_execution_status:'FINAL',receipts_outcome:[{outcome:{status:{SuccessValue:''}}}],transaction:{hash:AGENT_NEAR,receiver_id:VAULT,signer_id:VAULT,public_key:AGENT_KEY,actions:[{FunctionCall:{method_name:'reduce',args:encode({market:LIVE,amount:this.agentWrongArgs?'101':'100',tx:{}})}}]},status:{SuccessValue:encode([this.agentSigned])}}}})}
      const entry=this.nearResults.get(req.params.tx_hash);if(!entry)throw Error('Unknown fixture NEAR hash')
      result={transaction:{hash:req.params.tx_hash,receiver_id:VAULT,signer_id:'relayer.fixture.testnet',actions:[{FunctionCall:{method_name:'owner_call',args:encode({message:entry.message,signature:entry.signature})}}]},status:{SuccessValue:encode(entry.signed)}}
     }else if(req.method==='block')result={header:{hash:HASH,timestamp_nanosec:String(BigInt(NOW)*1000000000n)}}
     else throw Error('Unexpected NEAR method')
     return route.fulfill({json:{jsonrpc:'2.0',id:req.id,result}})
    }
    if(['relayer.fixture.test','fallback.fixture.test'].includes(url.hostname)){
     if(url.pathname==='/agent/'&&this.failEvidenceIndex)return route.fulfill({status:503,body:'Evidence temporarily unavailable'})
     if(url.pathname==='/agent/transcripts'&&this.failTranscripts)return route.fulfill({status:503,body:'Transcripts temporarily unavailable'})
     if(url.pathname==='/agent/')return route.fulfill({json:{boot:this.evidenceBoot,files:this.evidenceFiles().map(({text,...row})=>row)}})
     if(url.pathname==='/agent/transcripts')return route.fulfill({json:{boot:this.evidenceBoot,transcripts:this.evidenceTranscripts().map(({text,...row})=>row)}})
     if(url.pathname.startsWith('/agent/transcripts/')){const row=this.evidenceTranscripts().find(row=>row.name===url.pathname.split('/').pop());if(!row)throw Error('Unknown fixture transcript');return route.fulfill({contentType:'application/json',body:row.text+(this.corruptTranscript?'x':'')})}
     if(url.pathname.startsWith('/agent/evidence/')){const row=this.evidenceFiles().find(row=>row.name===url.pathname.split('/').pop());if(!row)throw Error('Unknown fixture evidence');if(this.rotateEvidence){this.rotateEvidence=false;this.evidenceBoot='boot-2000000001-abcdef34'}return route.fulfill({contentType:'text/plain',body:row.text+(this.corruptEvidence===row.name?'x':'')})}
     if(url.pathname===`/vault/${VAULT}`){if(this.publicVaultUnavailable)return route.fulfill({status:503,body:'Vault unavailable'});return route.fulfill({json:{ok:true,vault:this.wrongPublicVault?'v2.fixture.testnet':VAULT,state:{owner:OWNER,base_address:BASE,morpho:MORPHO,markets:[{id:LIVE,executor:EXECUTOR}]}}})}
     if(url.pathname==='/health')return route.fulfill({json:{ok:true,chain_id:84532,near_network:'testnet',factory:'fixture.testnet',factory_exists:true,sender:'relayer.fixture.testnet',eth_float_wei:'0'}})
     if(url.pathname.startsWith('/job/')){const job=this.jobs.get(url.pathname.split('/').pop()!);return route.fulfill({status:job?200:404,json:job??{error:'lost'}})}
     if(url.pathname==='/owner-call'){
      const body=request.postDataJSON();this.posts.push(body)
      const intent=JSON.parse(body.message),job=String(this.posts.length).padStart(16,'0')
      if(intent.method==='cancel'){
       const signed=await this.signed(this.pending,BASE);this.lastCancel=signed;this.lastCancelNear=String(this.posts.length+1).repeat(44);this.nearResults.set(this.lastCancelNear,{...body,signed:[signed]});this.ownerNonce=intent.nonce
       this.jobs.set(job,{kind:'owner_call',job,stage:'done',vault:VAULT,near_tx:this.lastCancelNear,base_sent:[signed.hash]})
      }
      if(['setup','set_corridor'].includes(intent.method)){
       const updates=intent.method==='setup'?intent.args.markets.map((m:{market:string;corridor:Record<string,unknown>})=>({market:m.market,...m.corridor})):[intent.args]
       this.ruleSigned=await Promise.all(updates.map((u:Record<string,unknown>,index:number)=>this.signed(this.pending+index,EXECUTOR,encodeFunctionData({abi:ABI,functionName:'setCorridor',args:[u.market as Hex,{target:BigInt(String(u.target)),act:BigInt(String(u.act)),floor:BigInt(String(u.floor)),sellBudget:BigInt(String(u.sell_budget)),migrateAllowed:u.migrate_allowed as boolean,exitAllowed:u.exit_allowed as boolean,set:false},BigInt(NOW+600)]}))))
       const near=String(this.posts.length+1).repeat(44);this.nearResults.set(near,{...body,signed:this.ruleSigned});this.ownerNonce=intent.nonce
       this.jobs.set(job,{kind:'owner_call',job,stage:'done',vault:VAULT,near_tx:near,base_sent:this.ruleSigned.map(tx=>tx.hash)})
      }
      if(this.losePost)return route.abort('failed')
      return route.fulfill({status:202,json:{ok:true,job}})
     }
     throw Error(`Unexpected relayer path ${url.pathname}`)
    }
    if(request.method()==='POST'){
     const data=request.postDataJSON();const rpc=(req:{id:number;method:string;params:unknown[]})=>({jsonrpc:'2.0',id:req.id,result:this.rpc(req.method,req.params)})
     if(!['base.fixture.test','sepolia.base.org'].includes(url.hostname))throw Error(`Unexpected RPC host ${url.hostname}`)
     return route.fulfill({json:Array.isArray(data)?data.map(rpc):rpc(data)})
    }
    throw Error(`External request blocked: ${url.href}`)
   }catch(error){this.unexpected.push(String(error));await route.abort('failed')}
  })
 }
}
declare global {interface Window {fixtureSign:(text:string)=>Promise<Hex>;fixtureWalletCall:(method:string)=>Promise<void>;fixtureWallet:{account:string;chain:string;rejectConnect:boolean;rejectSign:boolean;changeAccount:(address:string)=>void}}}
export const test=base.extend<{protocol:ProtocolFixture}>({protocol:async({},use)=>{const fixture=new ProtocolFixture();await use(fixture);expect(fixture.unexpected,'Unhandled/forbidden network requests').toEqual([]);expect(fixture.runtimeErrors,'Browser runtime errors').toEqual([])}})
export {expect,hexToString,OWNER,OTHER,BASE,KEY,VAULT,LIVE,BACKUP,NOW}

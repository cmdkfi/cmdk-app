import {createPublicClient,http,parseAbi,decodeEventLog,formatUnits,isAddress,type Hex} from 'viem'
import {baseSepolia} from 'viem/chains'
import {viewNear,type AppConfig,type Vault} from './near.ts'
import {readLivePosition} from './positions.ts'
export const activityAbi=parseAbi([
'event CorridorSet(address indexed caller,bytes32 indexed market,(uint64 target,uint64 act,uint64 floor,uint64 sellBudget,bool migrateAllowed,bool exitAllowed,bool set) corridor)',
'event Transfer(address indexed from,address indexed to,uint256 value)',
'event SupplyCollateral(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets)',
'event WithdrawCollateral(bytes32 indexed id,address caller,address indexed onBehalf,address indexed receiver,uint256 assets)',
'event Borrow(bytes32 indexed id,address caller,address indexed onBehalf,address indexed receiver,uint256 assets,uint256 shares)',
'event Repay(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets,uint256 shares)',
'event Repaid(address indexed caller,bytes32 indexed market,uint256 repaid)',
'event Opened(address indexed caller,bytes32 indexed market,uint256 collateralIn,uint256 borrowed,uint256 ltv)',
'event Closed(address indexed caller,bytes32 indexed market,uint256 repaid,uint256 collateralOut)',
'event Reduced(address indexed caller,bytes32 indexed market,uint256 repaid,uint256 collateralSold,uint256 ltvBefore,uint256 ltvAfter,bool protective)',
'event Migrated(address indexed caller,bytes32 indexed from,bytes32 indexed to,uint256 fraction,uint256 debtMoved,uint256 collateralMoved)',
'event Exited(address indexed caller,bytes32 indexed market,uint256 repaid,uint256 fromIdle,uint256 collateralSold,uint256 collateralOut)',
'event SessionEnded(address indexed caller,bytes32 indexed market,uint256 ltv)',
])
export type ActivityEvent={key:string;vault:string;name:string;actor:'user'|'agent'|'unknown';hash:Hex;block:bigint;index:number;timestamp?:number;amount?:string;details:Record<string,unknown>}
export function activityActor(name:string,caller:unknown,owner:string):ActivityEvent['actor']{
 if(['Reduced','Migrated','Exited','SessionEnded'].includes(name))return 'agent'
 if(['Opened','Closed','CorridorSet','Repaid'].includes(name)||typeof caller==='string'&&caller.toLowerCase()===owner.toLowerCase())return 'user'
 return 'unknown'
}
export async function readActivity(config:AppConfig,vault:Vault,from:bigint,to:bigint):Promise<ActivityEvent[]>{
 const position=await readLivePosition(config,vault.accountId,vault.owner)
 const client=createPublicClient({chain:baseSepolia,transport:http(config.baseRpcUrl)})
 if(await client.getChainId()!==84532)throw Error('RPC is not Base Sepolia.')
 const state=await viewNear<{markets?:{id:string;previous_executors?:string[]}[]}>(config.nearRpcUrl,vault.accountId,'get_state')
 const previous=(state.markets??[]).filter(m=>position.markets.some(active=>active.id.toLowerCase()===m.id.toLowerCase())).flatMap(m=>m.previous_executors??[])
 if(previous.some(address=>!isAddress(address)))throw Error('Vault returned an invalid previous executor address.')
 const addresses=[...new Set([...position.markets.flatMap(m=>[m.morpho!,m.executor!,m.collateralToken,m.loanToken]),...previous as Hex[]])]
 const logs=(await Promise.all(addresses.map(address=>client.getLogs({address,fromBlock:from,toBlock:to})))).flat()
 const events=logs.flatMap<ActivityEvent>(log=>{try{
 const decoded=decodeEventLog({abi:activityAbi,data:log.data,topics:log.topics});const args=decoded.args as Record<string,unknown>
 if(decoded.eventName==='Transfer'){
 if(![args.from,args.to].some(x=>String(x).toLowerCase()===position.baseAddress.toLowerCase()))return []
 return [{key:`${log.transactionHash}:${log.logIndex}:${vault.accountId}`,vault:vault.accountId,name:'Token transfer',actor:'unknown' as const,hash:log.transactionHash!,block:log.blockNumber!,index:log.logIndex!,details:{token:log.address,...args}}]
 }
 const affected=args.onBehalf??args.caller
 if(typeof affected!=='string'||affected.toLowerCase()!==position.baseAddress.toLowerCase())return []
 const market=args.id??args.market??args.from
 if(!position.markets.some(m=>m.id.toLowerCase()===String(market).toLowerCase()))return []
 return [{key:`${log.transactionHash}:${log.logIndex}:${vault.accountId}`,vault:vault.accountId,name:decoded.eventName,actor:activityActor(decoded.eventName,args.caller,vault.owner),hash:log.transactionHash!,block:log.blockNumber!,index:log.logIndex!,details:args}]
 }catch{return []}})
 const times=new Map<bigint,number>()
 await Promise.all([...new Set(events.map(event=>event.block))].map(async block=>{times.set(block,Number((await client.getBlock({blockNumber:block})).timestamp))}))
 return events.map(event=>{
 const market=position.markets.find(m=>m.id.toLowerCase()===String(event.details.id??event.details.market??event.details.from).toLowerCase())
 let value=event.details.assets??event.details.borrowed??event.details.repaid
 let symbol=market?.loanSymbol,decimals=market?.loanDecimals
 if(['SupplyCollateral','WithdrawCollateral'].includes(event.name)){symbol=market?.collateralSymbol;decimals=market?.collateralDecimals}
 if(event.name==='Token transfer'){
 value=event.details.value
 const token=String(event.details.token).toLowerCase()
 const source=position.markets.find(m=>[m.loanToken.toLowerCase(),m.collateralToken.toLowerCase()].includes(token))
 if(source){const loan=source.loanToken.toLowerCase()===token;symbol=loan?source.loanSymbol:source.collateralSymbol;decimals=loan?source.loanDecimals:source.collateralDecimals}
 }
 return {...event,timestamp:times.get(event.block),amount:typeof value==='bigint'&&symbol&&decimals!==undefined?`${formatUnits(value,decimals)} ${symbol}`:undefined}
 })
}
export function eventTitle(name:string){return ({SupplyCollateral:'Deposit collateral',WithdrawCollateral:'Release collateral',Borrow:'Borrow',Repay:'Repay debt',Repaid:'Repay from vault',Opened:'Open / borrow via vault',Closed:'Close position',Reduced:'Reduce debt',Migrated:'Migrate position',Exited:'Agent exit',SessionEnded:'Protection session ended',CorridorSet:'Update risk rules'} as Record<string,string>)[name]??name}

export function groupActivity(events:ActivityEvent[]) {
 const groups=new Map<string,ActivityEvent[]>()
 for(const event of events){const key=`${event.vault}:${event.hash}`;const group=groups.get(key)??[];if(!group.some(item=>item.key===event.key))group.push(event);groups.set(key,group)}
 const priorities=['Exited','Migrated','Reduced','Closed','Repaid','Opened','CorridorSet','Repay','Borrow','WithdrawCollateral','SupplyCollateral','Token transfer']
 return [...groups.values()].map(events=>({primary:[...events].sort((a,b)=>priorities.indexOf(a.name)-priorities.indexOf(b.name))[0],events}))
}

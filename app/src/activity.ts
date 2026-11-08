import {createPublicClient,http,parseAbi,decodeEventLog,type Hex} from 'viem'
import {baseSepolia} from 'viem/chains'
import type {AppConfig,Vault} from './near.ts'
import {readLivePosition} from './positions.ts'
export const activityAbi=parseAbi([
'event CorridorSet(address indexed caller,bytes32 indexed market,(uint64 target,uint64 act,uint64 floor,uint64 sellBudget,bool migrateAllowed,bool exitAllowed,bool set) corridor)',
'event Transfer(address indexed from,address indexed to,uint256 value)',
'event SupplyCollateral(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets)',
'event WithdrawCollateral(bytes32 indexed id,address caller,address indexed onBehalf,address indexed receiver,uint256 assets)',
'event Borrow(bytes32 indexed id,address caller,address indexed onBehalf,address indexed receiver,uint256 assets,uint256 shares)',
'event Repay(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets,uint256 shares)',
'event Opened(address indexed caller,bytes32 indexed market,uint256 collateralIn,uint256 borrowed,uint256 ltv)',
'event Closed(address indexed caller,bytes32 indexed market,uint256 repaid,uint256 collateralOut)',
'event Reduced(address indexed caller,bytes32 indexed market,uint256 repaid,uint256 collateralSold,uint256 ltvBefore,uint256 ltvAfter,bool protective)',
'event Migrated(address indexed caller,bytes32 indexed from,bytes32 indexed to,uint256 fraction,uint256 debtMoved,uint256 collateralMoved)',
'event Exited(address indexed caller,bytes32 indexed market,uint256 repaid,uint256 fromIdle,uint256 collateralSold,uint256 collateralOut)',
'event SessionEnded(address indexed caller,bytes32 indexed market,uint256 ltv)',
])
export type ActivityEvent={key:string;vault:string;name:string;actor:'user'|'agent'|'unknown';hash:Hex;block:bigint;index:number;details:Record<string,unknown>}
export function activityActor(name:string,caller:unknown,owner:string):ActivityEvent['actor']{
 if(['Reduced','Migrated','Exited','SessionEnded'].includes(name))return 'agent'
 if(['Opened','Closed','CorridorSet'].includes(name)||typeof caller==='string'&&caller.toLowerCase()===owner.toLowerCase())return 'user'
 return 'unknown'
}
export async function readActivity(config:AppConfig,vault:Vault,from:bigint,to:bigint):Promise<ActivityEvent[]>{
 const position=await readLivePosition(config,vault.accountId,vault.owner)
 const client=createPublicClient({chain:baseSepolia,transport:http(config.baseRpcUrl)})
 if(await client.getChainId()!==84532)throw Error('RPC is not Base Sepolia.')
 const addresses=[...new Set(position.markets.flatMap(m=>[m.morpho!,m.executor!,m.collateralToken,m.loanToken]))]
 const logs=(await Promise.all(addresses.map(address=>client.getLogs({address,fromBlock:from,toBlock:to})))).flat()
 return logs.flatMap(log=>{try{
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
}

// Phase 2 extension of the protocol fixture, without changing e2e/fixture.ts: serves the guided config
// blocks and the reads S1–S3 add (Executor.config, IRM borrowRateView, GasPriceOracle.getL1Fee, fee
// estimates), with knobs for wallet and position-address balances. Shapes follow cmdkfi/app 47fd4fb.
import type {BrowserContext} from '@playwright/test'
import {test as base,expect} from '@playwright/test'
import {decodeFunctionData,encodeAbiParameters,encodeFunctionResult,keccak256,parseAbi,toHex,type Hex} from 'viem'
import {readFileSync} from 'node:fs'
import {ProtocolFixture} from './fixture.ts'
import {BASE,EXECUTOR,MORPHO,OTHER,OWNER,USDC,WETH,config,measurement} from './data.ts'
import {guidedValues} from '../scripts/guided-values.mjs'

const IRM='0x6666666666666666666666666666666666666666' as Hex,ORACLE=OTHER as Hex,GAS_ORACLE='0x420000000000000000000000000000000000000F'
const ZERO='0x0000000000000000000000000000000000000000' as Hex
const A=(value:string)=>value as Hex
const LLTV=860000000000000000n
const paramsId=(p:readonly [Hex,Hex,Hex,Hex,bigint])=>keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'address'},{type:'address'},{type:'uint256'}],p))
/** The quote market: real IRM so borrowRateView is exercised. */
export const QUOTE_PARAMS=[A(USDC),A(WETH),ORACLE,IRM,LLTV] as const,QUOTE_ID=paramsId(QUOTE_PARAMS)
/** The discovery market: the base fixture's fullPosition market (oracle OTHER, no IRM). */
export const READ_PARAMS=[A(USDC),A(WETH),A(OTHER),ZERO,LLTV] as const,READ_ID=paramsId(READ_PARAMS)

const GUIDED_ABI=parseAbi([
 'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
 'struct MarketConfig { MarketParams params; address pool; address[2] feeds; uint32[2] maxAges; }',
 'function config(bytes32 id) view returns (MarketConfig)',
 'function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv),(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)) view returns (uint256)',
 'function getL1Fee(bytes) view returns (uint256)',
 'function balanceOf(address) view returns (uint256)',
 'function position(bytes32,address) view returns (uint256,uint128,uint128)',
 'function market(bytes32) view returns (uint128,uint128,uint128,uint128,uint128,uint128)',
 'function price() view returns (uint256)',
 'function decimals() view returns (uint8)',
])
const appValues=JSON.parse(readFileSync(new URL('../config.app.json',import.meta.url),'utf8'))
const deployment={base:{morpho:MORPHO,executorDeployBlock:1,gasPriceOracle:GAS_ORACLE,tokens:{weth:WETH,usdc:USDC}}}

export class GuidedFixture extends ProtocolFixture {
 walletEth=10n**18n;walletWeth=0n
 idleWeth=10n**18n;idleUsdc=10n**18n;collateral=10n**18n;debtShares=0n
 price:bigint|null=3200n*10n**24n;rate:bigint|null=1547125824n // ln(1.05)/year per second (WAD): exactly 5.0% APY
 supply=10_000n*10n**6n;borrowed=2_000n*10n**6n
 l1Fee=1000n
 /** EIP-7702: the wallet's code is the 0xef0100 delegation designator. */
 delegated=false
 guidedCalls:string[]=[]
 guidedConfig(){
  const markets=this.fullPosition?[READ_ID]:[QUOTE_ID,'0x'+'bb'.repeat(32)]
  return {...config,agent:{...config.agent,measurement},...guidedValues(appValues,deployment),createVault:{...config.createVault,markets:markets.map(id=>({id,loan_token:USDC,collateral_token:WETH,executor:EXECUTOR,slice_max:'1000000000'}))}}
 }
 override rpc(method:string,params:unknown[]):unknown{
  if(method==='eth_getBalance'&&String(params[0]).toLowerCase()===OWNER.toLowerCase())return toHex(this.walletEth)
  if(method==='eth_getCode'&&this.delegated)return '0xef0100'+'77'.repeat(20)
  if(method==='eth_maxPriorityFeePerGas'||method==='eth_gasPrice')return '0x3b9aca00'
  if(method==='eth_call'){
   const call=params[0] as {data:Hex;to?:string},to=(call.to??'').toLowerCase()
   let decoded:{functionName:string;args?:readonly unknown[]}|null=null
   try{decoded=decodeFunctionData({abi:GUIDED_ABI,data:call.data}) as {functionName:string;args?:readonly unknown[]}}catch{decoded=null}
   if(decoded){
    const name=decoded.functionName,args=decoded.args??[];const reply=(result:unknown)=>{this.guidedCalls.push(name);return encodeFunctionResult({abi:GUIDED_ABI,functionName:name as never,result:result as never})}
    if(name==='config'){const id=String(args[0]).toLowerCase();const p=id===READ_ID.toLowerCase()?READ_PARAMS:id===QUOTE_ID.toLowerCase()?QUOTE_PARAMS:null;if(!p)throw Error('Unknown fixture market');return reply({params:{loanToken:p[0],collateralToken:p[1],oracle:p[2],irm:p[3],lltv:p[4]},pool:ZERO,feeds:[ZERO,ZERO],maxAges:[0,0]})}
    // An unreadable contract answers with no return data; viem then rejects the read.
    if(name==='borrowRateView'){if(this.rate===null){this.guidedCalls.push('borrowRateView:empty');return '0x'}return reply(this.rate)}
    if(name==='getL1Fee')return reply(this.l1Fee)
    if(name==='price'&&to===ORACLE.toLowerCase()){if(this.price===null){this.guidedCalls.push('price:empty');return '0x'}return reply(this.price)}
    if(name==='market')return reply([this.supply,this.supply,this.borrowed,this.borrowed,2000000000n,0n])
    if(name==='decimals')return reply(to===USDC.toLowerCase()?6:18)
    if(name==='position')return reply([0n,this.debtShares,this.collateral])
    if(name==='balanceOf'){
     const holder=String(args[0]).toLowerCase()
     if(holder===OWNER.toLowerCase())return reply(to===WETH.toLowerCase()?this.walletWeth:0n)
     if(holder===BASE.toLowerCase())return reply(to===WETH.toLowerCase()?this.idleWeth:to===USDC.toLowerCase()?this.idleUsdc:0n)
    }
   }
  }
  return super.rpc(method,params)
 }
 override async install(context:BrowserContext,options?:Parameters<ProtocolFixture['install']>[1]){
  await super.install(context,options)
  // Registered after the base route, so it takes precedence for this one URL.
  await context.route('http://localhost:5177/config.json',route=>route.fulfill({json:this.guidedConfig()}))
 }
}

/** Every request host the page used, so specs can assert nothing left the fixture's hosts. */
export function recordHosts(context:BrowserContext){const hosts=new Set<string>();context.on('request',request=>hosts.add(new URL(request.url()).host));return hosts}

export const test=base.extend<{protocol:GuidedFixture}>({protocol:async({},use)=>{const fixture=new GuidedFixture();await use(fixture);expect(fixture.unexpected,'Unhandled/forbidden network requests').toEqual([]);expect(fixture.runtimeErrors,'Browser runtime errors').toEqual([])}})
export {expect,OWNER}

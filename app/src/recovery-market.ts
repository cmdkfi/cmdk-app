import {encodeAbiParameters,isAddress,keccak256,parseAbi,type Address,type Hex,type PublicClient} from 'viem'
import {viewNear,type AppConfig,type Vault} from './near.ts'
const abi=parseAbi(['function position(bytes32,address) view returns(uint256,uint128,uint128)','function idToMarketParams(bytes32) view returns(address,address,address,address,uint256)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)'])
export async function readRecoveryMarket(config:AppConfig,vault:Vault,owner:string,selected:string|undefined,client:Pick<PublicClient,'getChainId'|'readContract'>,fetcher:typeof fetch=fetch) {
 const state=await viewNear<{owner?:string;base_address?:string;morpho?:string;markets?:{id:string}[]}>(config.nearRpcUrl,vault.accountId,'get_state',fetcher)
 if(state.owner?.toLowerCase()!==owner.toLowerCase()||!state.base_address||!isAddress(state.base_address)||!state.morpho||!isAddress(state.morpho)||!state.markets?.length)throw Error('Owned vault and registered markets are required.')
 if(await client.getChainId()!==84532)throw Error('RPC is not Base Sepolia.')
 const market=selected?state.markets.find(m=>m.id===selected):state.markets[0]
 if(!market)throw Error('Selected market is no longer registered.')
 if(!/^0x[0-9a-fA-F]{64}$/.test(market.id))throw Error('Invalid registered market ID.')
 const id=market.id as Hex,base=state.base_address as Address,morpho=state.morpho as Address
 const [position,params]=await Promise.all([client.readContract({address:morpho,abi,functionName:'position',args:[id,base]}),client.readContract({address:morpho,abi,functionName:'idToMarketParams',args:[id]})])
 if(keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'address'},{type:'address'},{type:'uint256'}],params)).toLowerCase()!==id.toLowerCase())throw Error('Morpho parameters do not match the registered market.')
 const tokens=await Promise.all([params[0],params[1]].map(async address=>{const [symbol,decimals,free,wallet]=await Promise.all([client.readContract({address,abi,functionName:'symbol'}),client.readContract({address,abi,functionName:'decimals'}),client.readContract({address,abi,functionName:'balanceOf',args:[base]}),client.readContract({address,abi,functionName:'balanceOf',args:[owner as Address]})]);if(!Number.isInteger(decimals)||decimals>36)throw Error('Token precision unavailable.');return{address,symbol,decimals,free,wallet}}))
 return {id,markets:state.markets.map(m=>m.id),base,morpho,borrowShares:position[1],params:{loanToken:params[0],collateralToken:params[1],oracle:params[2],irm:params[3],lltv:params[4]},loan:tokens[0],collateral:tokens[1]}
}

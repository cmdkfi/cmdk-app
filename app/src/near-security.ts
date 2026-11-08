import {viewNear,type AppConfig,type Vault} from './near.ts'

type AccessKey = {public_key:string;access_key:{permission:'FullAccess'|{FunctionCall:{receiver_id:string;method_names:string[];allowance:string|null}}}}
type Account = {code_hash:string;global_contract_hash?:string;amount:string}
export async function readNearSecurity(config:AppConfig,vault:Vault,agentKey?:string,fetcher:typeof fetch=fetch) {
 async function query<T>(request_type:string):Promise<T> {
  const response=await fetcher(config.nearRpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',id:'security',method:'query',params:{request_type,finality:'final',account_id:vault.accountId}})})
  if(!response.ok)throw Error('NEAR security RPC unavailable.')
  const data=await response.json() as {result?:T;error?:unknown}
  if(data.error||!data.result)throw Error('NEAR security response unavailable.')
  return data.result
 }
 const [account,keys,factory]=await Promise.all([query<Account>('view_account'),query<{keys:AccessKey[]}>('view_access_key_list'),viewNear<{code_hash?:string}>(config.nearRpcUrl,config.near.factory!,'get_config',fetcher)])
 if(!Array.isArray(keys.keys))throw Error('NEAR access-key list unavailable.')
 const restricted=keys.keys.length===1 && keys.keys.every(key=>{
  const p=key.access_key.permission
  if(p==='FullAccess'||!p.FunctionCall)return false
  const methods=p.FunctionCall.method_names
  return key.public_key===agentKey && p.FunctionCall.receiver_id===vault.accountId && methods.length===3 && ['reduce','migrate','exit'].every(method=>methods.includes(method))
 })
 return {account,keys:keys.keys,restricted,codeMatches:!!factory.code_hash&&(account.global_contract_hash??account.code_hash)===factory.code_hash,factoryCodeHash:factory.code_hash}
}

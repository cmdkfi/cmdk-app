export class NearReadError extends Error {retryable:boolean;retryAt?:number;constructor(message:string,retryable:boolean,retryAt?:number){super(message);this.name='NearReadError';this.retryable=retryable;this.retryAt=retryAt}}
const pending=new WeakMap<typeof fetch,Map<string,Promise<unknown>>>()
const paused=new WeakMap<typeof fetch,Map<string,number>>()

export async function nearQuery<T>(rpcUrl:string,params:Record<string,unknown>,fetcher:typeof fetch=fetch):Promise<T> {
 let waits=paused.get(fetcher);if(!waits){waits=new Map();paused.set(fetcher,waits)}
 const until=waits.get(rpcUrl)??0
 if(until>Date.now())throw new NearReadError(`NEAR RPC is rate limited. Retry after ${new Date(until).toLocaleTimeString()}.`,true,until)
 let calls=pending.get(fetcher);if(!calls){calls=new Map();pending.set(fetcher,calls)}
 const key=JSON.stringify([rpcUrl,params])
 const existing=calls.get(key);if(existing)return existing as Promise<T>
 const task=(async()=>{
  let response:Response
  try{response=await fetcher(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',id:'cmdk',method:'query',params})})}catch{throw new NearReadError('NEAR RPC could not be reached. Check your connection or retry shortly.',true)}
  if(response.status===429){const header=response.headers.get('Retry-After');const seconds=header===null?NaN:Number(header);const retryAt=Number.isFinite(seconds)&&seconds>=0?Date.now()+seconds*1000:Date.parse(header??'');const deadline=Number.isFinite(retryAt)&&retryAt>Date.now()?retryAt:Date.now()+60000;waits.set(rpcUrl,deadline);throw new NearReadError(`NEAR RPC is rate limited. Retry after ${new Date(deadline).toLocaleTimeString()}.`,true,deadline)}
  if(!response.ok)throw new NearReadError(`NEAR RPC unavailable (HTTP ${response.status}).`,response.status>=500)
  const data=await response.json() as {result?:T;error?:unknown}
  if(data.error||data.result===undefined)throw Error('NEAR RPC query failed. Retry after checking the network.')
  return data.result
 })()
 calls.set(key,task)
 try{return await task as T}finally{if(calls.get(key)===task)calls.delete(key)}
}

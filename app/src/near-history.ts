export type NearHistoryRow={transaction_hash:string;signer_account_id:string;receiver_account_id:string;block_timestamp:string;actions:{action:string;method?:string}[];outcomes?:{status:boolean}}
export function parseNearHistory(value:unknown,account:string):{rows:NearHistoryRow[];next:string|null}{
 const data=value as {data?:NearHistoryRow[];meta?:{next_page?:unknown}}|null
 if(!data||!Array.isArray(data.data))throw Error('Unexpected NearBlocks response.')
 for(const row of data.data){if(typeof row.transaction_hash!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(row.transaction_hash)||row.receiver_account_id!==account||typeof row.signer_account_id!=='string'||!Array.isArray(row.actions)||row.actions.some(a=>!a||typeof a.action!=='string'||a.method!==undefined&&typeof a.method!=='string')||!/^\d{16,20}$/.test(row.block_timestamp))throw Error('NearBlocks returned incomplete or unrelated transaction records.')}
 if(data.meta?.next_page!==undefined&&data.meta.next_page!==null&&typeof data.meta.next_page!=='string')throw Error('Invalid NearBlocks pagination cursor.')
 return {rows:data.data,next:typeof data.meta?.next_page==='string'?data.meta.next_page:null}
}

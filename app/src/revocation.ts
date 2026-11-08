export function revocationMessage(vault:string,ownerNonce:number|string|undefined,now:number){
 const nonce=Number(ownerNonce)
 if(!/^[a-z0-9._-]+\.testnet$/.test(vault)||!Number.isSafeInteger(nonce)||nonce<0||nonce>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(now)||now<0)throw Error('Invalid vault nonce or timestamp. Refresh vault state.')
 return JSON.stringify({protocol:'cmdk-vault/1',network:'testnet',vault,method:'revoke_agent',args:{},nonce:nonce+1,expiry:now+600})
}
export function revocationConfirmed(state:{agent?:{public_key?:string}|null;approved?:unknown}){return !state.agent?.public_key&&!state.approved}

import type {Vault} from './near.ts'
export type DiscoveryState={kind:'disconnected'|'loading'|'pending'|'error'|'ready';owner?:string;factory?:string;vaults:Vault[];failed:number;selected:Vault|null;stale:boolean;checkedAt?:number;message?:string;retryAt?:number}
export const emptyDiscovery=(kind:DiscoveryState['kind'],owner?:string):DiscoveryState=>({kind,owner,vaults:[],failed:0,selected:null,stale:false})
export function retainDiscovery(previous:DiscoveryState,owner:string,kind:'loading'|'error',message?:string,retryAt?:number):DiscoveryState {
 const base=previous.owner===owner?previous:emptyDiscovery(kind,owner)
 return {...base,kind,stale:base.vaults.length>0,message,retryAt}
}
export function reconcileDiscovery(previous:DiscoveryState,owner:string,factory:string,result:{vaults:Vault[];failed:number;unreadAccounts?:string[];retryAt?:number},saved:string|null,now:number):DiscoveryState {
 const same=previous.owner===owner&&previous.factory===factory
 const unread=new Set(result.unreadAccounts??[])
 const retained=same?previous.vaults.filter(vault=>unread.has(vault.accountId)):[]
 const vaults=[...result.vaults,...retained.filter(vault=>!result.vaults.some(fresh=>fresh.accountId===vault.accountId))].sort((a,b)=>b.number-a.number)
 const selected=vaults.find(vault=>vault.accountId===(same?previous.selected?.accountId:undefined))??vaults.find(vault=>vault.accountId===saved)??vaults[0]??null
 return {kind:'ready',owner,factory,vaults,selected,failed:result.failed,stale:result.failed>0,checkedAt:result.failed?same?previous.checkedAt:undefined:now,retryAt:result.retryAt}
}

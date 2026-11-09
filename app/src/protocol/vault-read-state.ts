import type {LivePosition} from './positions.ts'
export type VaultRead={key:string;position?:LivePosition;error?:string}
export function failedVaultRead(previous:VaultRead|null,key:string,error:string):VaultRead{
 return{key,error,position:previous?.key===key?previous.position:undefined}
}

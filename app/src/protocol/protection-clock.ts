export function protectionLabel(status:string,validUntil:number|undefined,registrationExpiry:number|undefined,now:number) {
 if(registrationExpiry!==undefined&&registrationExpiry<=now)return 'Expired'
 if(status==='Active'&&(validUntil===undefined||validUntil<=now))return 'Unavailable'
 return status
}

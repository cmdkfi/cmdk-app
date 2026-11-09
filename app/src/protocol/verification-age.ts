export function verificationAge(seconds:number):string {
 if(!Number.isFinite(seconds)||seconds<0)return 'Clock mismatch'
 if(seconds<60)return `${seconds.toFixed(1)}s ago`
 if(seconds<3600)return `${(seconds/60).toFixed(1)} min ago`
 if(seconds<86400)return `${(seconds/3600).toFixed(1)}h ago`
 return `${(seconds/86400).toFixed(1)}d ago`
}

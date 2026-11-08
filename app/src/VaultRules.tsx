import {useEffect,useState} from 'react'
import type {Vault} from './near.ts'
import type {MarketPosition} from './positions.ts'
import {PrototypeSurface} from './ui/PrototypeControls.tsx'
import {EditRules} from './EditRules.tsx'
import {VaultSetup} from './VaultSetup.tsx'
import {marketTitle,sharedVisibleRules} from './vault-layout.ts'
const pct=(value:bigint|null|undefined)=>value==null?'Not configured':`${(Number(value)/1e16).toFixed(1)}%`

export function VaultRules({vault,live,backup,onRefresh}:{vault:Vault;live:MarketPosition;backup?:MarketPosition;onRefresh:()=>void}) {
 const [applyBackup,setApplyBackup]=useState(()=>!!backup&&sharedVisibleRules(live,backup))
 const fingerprint=[live.agentTarget,live.agentTrigger,live.dailyBudget,live.policyUnavailable,backup?.agentTarget,backup?.agentTrigger,backup?.dailyBudget,backup?.policyUnavailable].map(String).join(':')
 useEffect(()=>{setApplyBackup(!!backup&&sharedVisibleRules(live,backup))},[fingerprint])
 const needsSetup=live.agentTrigger===null||backup?.agentTrigger===null
 return <PrototypeSurface className="vault-rules-panel">
  <div className="vault-detail-heading"><div><h2>Protection rules</h2><p>{marketTitle(live)}</p></div>{!live.readOnly&&live.agentTrigger!==null&&<EditRules vault={vault} market={live} backup={backup} applyBackup={applyBackup} onApplyBackupChange={setApplyBackup} onRefresh={onRefresh}/>}</div>
  <dl className="vault-ltv-legend"><div><dt>Target</dt><dd>{pct(live.agentTarget)}</dd></div><div><dt>Trigger</dt><dd>{pct(live.agentTrigger)}</dd></div><div><dt>Daily budget</dt><dd>{pct(live.dailyBudget)}</dd></div></dl>
  {backup&&<><label className="shared-rules-check"><input type="checkbox" checked={applyBackup} disabled={live.readOnly||backup.readOnly||live.policyUnavailable||backup.policyUnavailable} onChange={event=>setApplyBackup(event.target.checked)}/>Apply the same rules to the backup market</label><p className="demo-summary">Applies Target, Trigger and Budget when you save. Each market keeps its Floor and permissions. The backup is the migration destination.</p></>}
  {needsSetup&&<VaultSetup vault={vault} onComplete={onRefresh} applySame={applyBackup} liveMarket={live} backupMarket={backup}/>}
  {backup&&!needsSetup&&<details className="independent-backup-rules"><summary>Advanced · independent backup rules</summary><p>{marketTitle(backup)} · Target {pct(backup.agentTarget)} · Trigger {pct(backup.agentTrigger)} · Budget {pct(backup.dailyBudget)}</p>{!backup.readOnly&&<EditRules vault={vault} market={backup} onRefresh={onRefresh} independent/>}</details>}
  {!needsSetup&&<details><summary>Inspect / repair vault setup</summary><VaultSetup vault={vault} onComplete={onRefresh} applySame={applyBackup} liveMarket={live} backupMarket={backup}/></details>}
 </PrototypeSurface>
}

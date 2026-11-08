import {useRef,useState} from 'react'
import {AgentEvidence} from '../src/AgentEvidence.tsx'
import {AGENT_KEY,measurement,OTHER} from './data.ts'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {WagmiProvider} from 'wagmi'
import {walletConfig} from '../src/wallet.ts'
import {WalletConnect} from '../src/WalletConnect.tsx'
import {VaultRules} from '../src/VaultRules.tsx'
import {HeldCancellation} from '../src/HeldCancellation.tsx'
import {LiveActions} from '../src/LiveActions.tsx'
import {vault,market,backup} from './data.ts'
import '../src/styles.css'
import '../src/vault-home.css'
import '../src/vault-detail.css'
function EvidencePreview(){
 const dialog=useRef<HTMLDialogElement>(null),[active,setActive]=useState(false),[revision,setRevision]=useState(0),[selected,setSelected]=useState(vault)
 return <><button onClick={()=>{dialog.current?.showModal();setActive(true);setRevision(v=>v+1)}}>Open evidence preview</button><dialog ref={dialog} className="connect-dialog verification-dialog" aria-label="Verification evidence preview" onClose={()=>setActive(false)}><h2>Verification evidence preview</h2><button onClick={()=>dialog.current?.close()}>Close evidence preview</button><button onClick={()=>setRevision(v=>v+1)}>Refresh evidence preview</button><button onClick={()=>setSelected({...vault,accountId:'v2.fixture.testnet',baseAddress:OTHER})}>Preview another vault</button><AgentEvidence vault={selected} active={active} revision={revision} approved={measurement} agentKey={AGENT_KEY}/></dialog></>
}
document.documentElement.dataset.theme='dark'
createRoot(document.getElementById('root')!).render(<WagmiProvider config={walletConfig}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main className="vault-main"><h1>Browser test harness</h1><p>Synthetic protocol fixtures. This entry is excluded from production builds.</p><WalletConnect/><EvidencePreview/><div className="vault-detail"><VaultRules vault={vault} live={market} backup={backup} onRefresh={()=>{}}/><HeldCancellation vault={vault} onRefresh={()=>{}}/><LiveActions vault={vault} market={market} onRefresh={()=>{}}/></div></main></QueryClientProvider></WagmiProvider>)

import { useEffect, useState } from 'react'
import { loadConfig } from './near.ts'
import { assessRelayer, readRelayerHealth, type Readiness } from './relayer.ts'

export function RelayerReadiness() {
  const [state, setState] = useState<Readiness | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setState(null)
    loadConfig().then(async config => {
      const health = await readRelayerHealth(config)
      if (active) setState(assessRelayer(config, health))
    }).catch(error => {
      if (active) setState({ kind: 'failed', message: error instanceof Error ? error.message : 'Relayer could not be checked.' })
    })
    return () => { active = false }
  }, [revision])
  return <section className="card relayer-readiness" aria-label="Testnet status">
    <div className="relayer-readiness__heading"><div><h2>Testnet status</h2><p>Read-only check of the relayer and vault factory.</p></div><button className="button button--secondary" onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
    <p className="wallet-message" role="status"><strong>{!state ? 'Checking' : state.kind === 'ready' ? 'Available' : state.kind === 'pending' ? 'Waiting' : 'Unavailable'}</strong><span>{state?.message ?? 'Checking relayer health…'}</span></p>
  </section>
}

import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { App } from './components/App.tsx'
import { persistable, QUERY_CACHE_KEY } from './flow/caches.ts'
import { parseBig, stringifyBig } from './flow/json.ts'
import './styles/base.css'
import './styles/prototype-controls.css'
import './styles/cmdk.css'

/**
 * localStorage for the persister, written only outside the sandbox: the persister writes its key even when no query
 * qualifies, and the sandbox never persists to localStorage (PRD §8a; e2e/sandbox.spec.ts found the empty write).
 */
function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  let local: Storage
  try { local = window.localStorage } catch { return undefined }
  const sandbox = () => window.location.hash.startsWith('#sandbox')
  return {
    getItem: key => local.getItem(key),
    setItem: (key, value) => { if (!sandbox()) local.setItem(key, value) },
    removeItem: key => { if (!sandbox()) local.removeItem(key) },
  }
}

// PRD §9 4: only the live position snapshot (key: 'position', 'live', owner, vault) is persisted, so it paints S5 on
// return with its block and age while live reads run. Nothing else is written; the sandbox never persists.
const queryClient = new QueryClient()
const persister = createSyncStoragePersister({ storage: storage(), key: QUERY_CACHE_KEY, serialize: stringifyBig, deserialize: parseBig })

document.documentElement.dataset.theme = 'dark'
createRoot(document.getElementById('root')!).render(
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, dehydrateOptions: { shouldDehydrateQuery: query => query.state.status === 'success' && persistable(query.queryKey) } }}
  >
    <App />
  </PersistQueryClientProvider>,
)

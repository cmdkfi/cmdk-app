import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { App } from './components/App.tsx'
import { persistable, QUERY_CACHE_KEY } from './flow/caches.ts'
import { parseBig, stringifyBig } from './flow/json.ts'
import './styles/base.css'
import './styles/prototype-controls.css'
import './styles/ltv-track.css'
import './styles/shell.css'
import './styles/screens.css'

function storage(): Storage | undefined {
  try { return window.localStorage } catch { return undefined }
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

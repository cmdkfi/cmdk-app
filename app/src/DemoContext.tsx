import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import { demoReducer, initialDemo, type DemoAction, type DemoState } from './demo.ts'

const DemoContext = createContext<{ state: DemoState; dispatch: (action: DemoAction) => void } | null>(null)
const storageKey = 'cmdk-local-demo-v1'

function restore(): DemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as DemoState | null
    if (saved && typeof saved === 'object' && typeof saved.phase === 'string' && saved.rules && Array.isArray(saved.events)) return saved
  } catch { /* Start a fresh local demo if storage is unavailable. */ }
  return initialDemo
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(demoReducer, initialDemo, restore)
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(state)) } catch { /* Demo still works for this visit. */ } }, [state])
  return <DemoContext.Provider value={{ state, dispatch }}>{children}</DemoContext.Provider>
}

export function useDemo() {
  const value = useContext(DemoContext)
  if (!value) throw new Error('DemoProvider is missing')
  return value
}

// sessionStorage for S1/S2 input (PRD §9 Persistence). Live and sandbox use separate keys so the sandbox
// never writes the live flow's state. Storage can be unavailable; every access is guarded.
export type StorageMode = 'live' | 'sandbox'

const key = (mode: StorageMode, name: string) => `cmdk.${mode}.${name}`

export function readSession(mode: StorageMode, name: string): string | null {
  try { return window.sessionStorage.getItem(key(mode, name)) } catch { return null }
}

export function writeSession(mode: StorageMode, name: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key(mode, name))
    else window.sessionStorage.setItem(key(mode, name), value)
  } catch { /* storage unavailable: the value lives only in memory */ }
}

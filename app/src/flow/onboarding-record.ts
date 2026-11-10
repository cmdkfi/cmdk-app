// Persistence of the onboarding record and the owner-call lock (PRD S4 rules, FR-6, §9; Phase 3 Q3).
//   record: <prefix>.onboarding.v1.<factory>:<owner>  (the vault, once known, is inside the record)
//   lock:   <prefix>.lock.v1.<vault>:<owner>
//   close:  <prefix>.close.v1.<factory>:<owner>:<vault>  (Phase 5; once completed it is the "closed" marker)
// Live uses localStorage so a reload resumes; the sandbox uses sessionStorage only and never the live keys (§8a).
import type { StorageMode } from './session.ts'
import type { OwnerLock } from './lock.ts'
import { STEPS, type OnboardingRecord } from './onboarding.ts'
import { CLOSE_STEPS, type CloseRecord } from './close.ts'

function store(mode: StorageMode): Storage | null {
  try { return mode === 'live' ? window.localStorage : window.sessionStorage } catch { return null }
}

export const recordKey = (mode: StorageMode, factory: string, owner: string) => `cmdk.${mode}.onboarding.v1.${factory}:${owner.toLowerCase()}`
export const lockKey = (mode: StorageMode, vault: string, owner: string) => `cmdk.${mode}.lock.v1.${vault}:${owner.toLowerCase()}`
export const closeKey = (mode: StorageMode, factory: string, owner: string, vault: string) => `cmdk.${mode}.close.v1.${factory}:${owner.toLowerCase()}:${vault}`

function read<T>(mode: StorageMode, key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const text = store(mode)?.getItem(key)
    if (!text) return null
    const value: unknown = JSON.parse(text)
    return valid(value) ? value : null
  } catch {
    return null
  }
}

function write(mode: StorageMode, key: string, value: unknown | null) {
  try {
    const s = store(mode)
    if (!s) return
    if (value === null) s.removeItem(key)
    else s.setItem(key, JSON.stringify(value))
  } catch { /* storage unavailable: state lives only in memory */ }
}

function isRecord(value: unknown): value is OnboardingRecord {
  const r = value as OnboardingRecord
  return !!r && r.version === 1 && typeof r.factory === 'string' && typeof r.owner === 'string' && !!r.steps && STEPS.every(id => typeof r.steps[id]?.status === 'string')
}

function isCloseRecord(value: unknown): value is CloseRecord {
  const r = value as CloseRecord
  return !!r && r.version === 1 && typeof r.factory === 'string' && typeof r.owner === 'string' && typeof r.vault?.accountId === 'string' && !!r.steps && CLOSE_STEPS.every(id => typeof r.steps[id]?.status === 'string')
}

function isLock(value: unknown): value is OwnerLock {
  const l = value as OwnerLock
  return !!l && typeof l.vault === 'string' && typeof l.message === 'string' && typeof l.signature === 'string' && Number.isSafeInteger(l.nonce) && Number.isSafeInteger(l.expiry)
}

export const loadRecord = (mode: StorageMode, factory: string, owner: string) => read(mode, recordKey(mode, factory, owner), isRecord)
export const saveRecord = (mode: StorageMode, record: OnboardingRecord) => write(mode, recordKey(mode, record.factory, record.owner), record)
export const clearRecord = (mode: StorageMode, factory: string, owner: string) => write(mode, recordKey(mode, factory, owner), null)

export const loadLock = (mode: StorageMode, vault: string, owner: string) => read(mode, lockKey(mode, vault, owner), isLock)
export const saveLock = (mode: StorageMode, lock: OwnerLock) => write(mode, lockKey(mode, lock.vault, lock.owner), lock)
export const clearLock = (mode: StorageMode, vault: string, owner: string) => write(mode, lockKey(mode, vault, owner), null)

export const loadCloseRecord = (mode: StorageMode, factory: string, owner: string, vault: string) => read(mode, closeKey(mode, factory, owner, vault), isCloseRecord)
export const saveCloseRecord = (mode: StorageMode, record: CloseRecord) => write(mode, closeKey(mode, record.factory, record.owner, record.vault.accountId), record)
export const clearCloseRecord = (mode: StorageMode, factory: string, owner: string, vault: string) => write(mode, closeKey(mode, factory, owner, vault), null)


import type { Adapters } from '../types.ts'
import { createLiveProtocol } from './protocol.ts'
import { createLiveWallet } from './wallet.ts'

export function createLiveAdapters(): Adapters {
  return { kind: 'live', wallet: createLiveWallet(), protocol: createLiveProtocol() }
}

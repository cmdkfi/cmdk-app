// Account type from on-chain code (PRD S3, FR-3). EIP-7702: a delegated EOA's code is the designator
// 0xef0100 ‖ address; it still signs with its own key, which the vault's ecrecover accepts (vault/src/owner.rs l.46).
export type AccountKind = 'plain' | 'delegated' | 'contract'

export function accountKind(code: string | undefined): AccountKind {
  if (!code || code === '0x') return 'plain'
  if (code.toLowerCase().startsWith('0xef0100')) return 'delegated'
  return 'contract'
}

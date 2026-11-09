export function accountKind(code: `0x${string}` | undefined): 'plain' | 'delegated' | 'contract' {
  if (!code || code === '0x') return 'plain'
  if (code.toLowerCase().startsWith('0xef0100')) return 'delegated'
  return 'contract'
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function connectionError(error: Error): string {
  const text = error.message.toLowerCase()
  if (text.includes('rejected') || text.includes('denied') || text.includes('cancelled')) return 'The wallet request was cancelled. You can try again.'
  if (text.includes('not found') || text.includes('not installed') || text.includes('provider')) return 'The wallet was not found in this browser. Install it, then try again.'
  return 'The wallet could not connect. Check the wallet and try again.'
}

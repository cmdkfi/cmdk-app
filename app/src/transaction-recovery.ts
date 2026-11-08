import { decodeEventLog, parseAbi, decodeFunctionData, encodeFunctionData, type Hex } from 'viem'
import { morphoActions, params } from './live-actions.ts'
import type { MarketPosition } from './positions.ts'

export type PendingTransaction = { message?: string; ownerNonce?: string; expiry?: number; pending?: boolean; kind?: 'owner'; hash?: Hex; job?: string; to?: string; data?: Hex; value?: string; startedAt?: number }
type Transaction = { from: string; to: string | null; input: Hex; value: bigint }

// Legacy records have no intent. Only a manually identified collateral deposit can recover them.
export function validateRecovery(tx: Transaction, record: PendingTransaction, owner: string, vault: string, market: MarketPosition) {
  if (tx.from.toLowerCase() !== owner.toLowerCase()) throw new Error('Transaction belongs to a different wallet.')
  if (record.to && record.data) {
    if (tx.to?.toLowerCase() !== record.to.toLowerCase() || tx.input.toLowerCase() !== record.data.toLowerCase() || tx.value !== BigInt(record.value ?? '0')) throw new Error('Transaction does not match the pending action.')
    return
  }
  if (record.kind === 'owner' || record.job || tx.to?.toLowerCase() !== market.morpho?.toLowerCase() || tx.value !== 0n) throw new Error('Expected a direct Morpho collateral deposit.')
  const call = decodeFunctionData({ abi: morphoActions, data: tx.input })
  if (call.functionName !== 'supplyCollateral' || call.args[1] <= 0n || call.args[2].toLowerCase() !== vault.toLowerCase()) throw new Error('Expected a collateral deposit for this vault.')
  const expected = encodeFunctionData({abi:morphoActions,functionName:'supplyCollateral',args:[params(market),call.args[1],vault as Hex,'0x']})
  if (tx.input.toLowerCase() !== expected.toLowerCase()) throw new Error('Deposit does not match this market.')
}

// Delegated wallets may broadcast through a relayer. Morpho's event records the actual caller.
export function validateDepositReceipt(logs: readonly {address:string; topics:readonly Hex[]; data:Hex}[], record: PendingTransaction, owner:string, vault:string, market:MarketPosition) {
  if (record.kind === 'owner' || record.job) throw new Error('Use the owner-call job status to recover this action.')
  let amount: bigint | undefined
  if (record.data) {
    if (record.to?.toLowerCase() !== market.morpho?.toLowerCase()) throw new Error('Not a Morpho deposit.')
    const call=decodeFunctionData({abi:morphoActions,data:record.data})
    if (call.functionName !== 'supplyCollateral' || call.args[2].toLowerCase() !== vault.toLowerCase()) throw new Error('Not a deposit for this vault.')
    const expected=encodeFunctionData({abi:morphoActions,functionName:'supplyCollateral',args:[params(market),call.args[1],vault as Hex,'0x']})
    if (record.data.toLowerCase() !== expected.toLowerCase()) throw new Error('Different market.')
    amount=call.args[1]
  }
  const matches=logs.filter(log=>{
    if(log.address.toLowerCase() !== market.morpho?.toLowerCase()) return false
    try {
      const {args}=decodeEventLog({abi:depositEvents,data:log.data,topics:log.topics as [Hex,...Hex[]]})
      return args.id.toLowerCase() === market.id.toLowerCase() && args.caller.toLowerCase() === owner.toLowerCase() && args.onBehalf.toLowerCase() === vault.toLowerCase() && args.assets>0n && (amount===undefined || amount===args.assets)
    } catch {return false}
  })
  if(matches.length !== 1) throw new Error('No unique matching Morpho deposit found in this transaction.')
}

const depositEvents=parseAbi(['event SupplyCollateral(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets)'])

export function ownerTransactionsConsumed(signed: readonly { nonce: number; from: string; hash: string }[], vault: string, confirmedNonce: number) {
  return signed.length > 0 && Number.isSafeInteger(confirmedNonce) && signed.every(tx =>
    Number.isSafeInteger(tx.nonce) && tx.nonce >= 0 && tx.nonce < confirmedNonce &&
    tx.from.toLowerCase() === vault.toLowerCase() && /^0x[0-9a-fA-F]{64}$/.test(tx.hash))
}

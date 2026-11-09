// Recent actions on a position address: Executor events whose first indexed topic (`caller`) is the position
// address — owner calls and agent calls both run from it (Executor.sol l.80-97) — plus WETH/USDC `Transfer` logs to
// or from it. Windows of at most 10 000 blocks, requested one after another (PRD R9; DEPLOY.md `cast logs` pattern).
import { decodeEventLog, getAbiItem, pad, toEventSelector, type PublicClient } from 'viem'
import { erc20Abi, executorAbi } from './abi.ts'

type Hex = `0x${string}`
export const MAX_WINDOW = 10_000n

const YOU = new Set(['CorridorSet', 'Opened', 'Repaid', 'Closed'])
const AGENT = new Set(['Reduced', 'Migrated', 'Exited', 'SessionEnded'])

/** Who an Executor event belongs to (PRD S5): owner calls are "you", the agent's reduce/migrate/exit are "agent". */
export function actorOf(eventName: string): 'you' | 'agent' | null {
  return YOU.has(eventName) ? 'you' : AGENT.has(eventName) ? 'agent' : null
}

export type ActivityEvent = {
  name: string
  actor: 'you' | 'agent' | 'transfer'
  blockNumber: bigint
  transactionHash: Hex
  logIndex: number
  args: Record<string, unknown>
  token?: Hex
}

type RawLog = { address: Hex; topics: [Hex, ...Hex[]]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex }

async function logs(client: PublicClient, address: Hex, topics: (Hex | null)[], from: bigint, to: bigint): Promise<RawLog[]> {
  return client.request({ method: 'eth_getLogs', params: [{ address, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] } as never) as Promise<RawLog[]>
}

export async function readActivity(client: PublicClient, q: { executor: Hex; positionAddress: Hex; tokens: Hex[] }, from: bigint, to: bigint): Promise<ActivityEvent[]> {
  if (to < from || to - from + 1n > MAX_WINDOW) throw new Error(`Read activity in windows of at most ${MAX_WINDOW} blocks.`)
  const who = pad(q.positionAddress.toLowerCase() as Hex)
  const events: ActivityEvent[] = []
  for (const log of await logs(client, q.executor, [null, who], from, to)) {
    const decoded = decodeEventLog({ abi: executorAbi, data: log.data, topics: log.topics })
    const actor = actorOf(decoded.eventName)
    if (!actor) continue
    events.push({ name: decoded.eventName, actor, blockNumber: BigInt(log.blockNumber), transactionHash: log.transactionHash, logIndex: Number(log.logIndex), args: decoded.args as Record<string, unknown> })
  }
  const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: 'Transfer' }))
  for (const token of q.tokens) {
    for (const topics of [[transfer, who], [transfer, null, who]] as (Hex | null)[][]) {
      for (const log of await logs(client, token, topics, from, to)) {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics })
        events.push({ name: decoded.eventName, actor: 'transfer', blockNumber: BigInt(log.blockNumber), transactionHash: log.transactionHash, logIndex: Number(log.logIndex), args: decoded.args as Record<string, unknown>, token })
      }
    }
  }
  return events.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : b.blockNumber > a.blockNumber ? 1 : -1))
}

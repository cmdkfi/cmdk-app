// Recent actions on a position address: Executor events whose first indexed topic (`caller`) is the position
// address — owner calls and agent calls both run from it (Executor.sol l.80-97) — plus WETH/USDC `Transfer` logs to
// or from it. Windows of at most 10 000 blocks (PRD R9). Per window two topic-filtered eth_getLogs with address arrays
// (product owner, Phase 5b: an unfiltered query over the three addresses returned 4,208 logs / 2.7 MB per window on
// 9 Nov; filtered, near zero), issued together so the transport sends them as one JSON-RPC batch:
//   A: [executors…, WETH, USDC] with topics [null, position]  → Executor events by caller, transfers from
//   B: [WETH, USDC] with topics [Transfer, null, position]     → transfers to
// Events are classified client-side exactly as before (Executor events by name; token logs only if Transfer).
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

async function logs(client: PublicClient, address: Hex[], topics: (Hex | null)[], from: bigint, to: bigint): Promise<RawLog[]> {
  return client.request({ method: 'eth_getLogs', params: [{ address, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] } as never) as Promise<RawLog[]>
}

export async function readActivity(client: PublicClient, q: { executors: Hex[]; positionAddress: Hex; tokens: Hex[] }, from: bigint, to: bigint): Promise<ActivityEvent[]> {
  if (to < from || to - from + 1n > MAX_WINDOW) throw new Error(`Read activity in windows of at most ${MAX_WINDOW} blocks.`)
  const who = pad(q.positionAddress.toLowerCase() as Hex)
  const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: 'Transfer' }))
  const executors = new Set(q.executors.map(a => a.toLowerCase()))
  const tokens = new Set(q.tokens.map(a => a.toLowerCase()))
  const [byCaller, toPosition] = await Promise.all([
    logs(client, [...q.executors, ...q.tokens], [null, who], from, to),
    logs(client, q.tokens, [transfer, null, who], from, to),
  ])
  const events: ActivityEvent[] = []
  for (const log of [...byCaller, ...toPosition]) {
    const address = log.address.toLowerCase()
    const base = { blockNumber: BigInt(log.blockNumber), transactionHash: log.transactionHash, logIndex: Number(log.logIndex) }
    if (executors.has(address)) {
      let decoded
      try { decoded = decodeEventLog({ abi: executorAbi, data: log.data, topics: log.topics }) } catch { continue }
      const actor = actorOf(decoded.eventName)
      if (actor) events.push({ ...base, name: decoded.eventName, actor, args: decoded.args as Record<string, unknown> })
    } else if (tokens.has(address) && log.topics[0]?.toLowerCase() === transfer.toLowerCase()) {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics })
      events.push({ ...base, name: decoded.eventName, actor: 'transfer', args: decoded.args as Record<string, unknown>, token: log.address })
    }
  }
  const unique = events.filter((e, i) => events.findIndex(x => x.transactionHash === e.transactionHash && x.logIndex === e.logIndex) === i)
  return unique.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : b.blockNumber > a.blockNumber ? 1 : -1))
}

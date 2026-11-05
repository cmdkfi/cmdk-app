import { isAddress, parseUnits, type Address } from 'viem'
import type { AppConfig } from './near.ts'
import { SetupError } from './vault-setup.ts'

export function parseUsdcAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new SetupError('Enter a valid USDC amount with up to six decimal places.')
  const amount = parseUnits(value, 6)
  if (amount <= 0n) throw new SetupError('Enter more than zero USDC.')
  return amount
}

export function withdrawMessage(vault: string, nonce: number, expiry: number, config: AppConfig, token: Address, amount: bigint, owner: Address): string {
  if (!config.near.factory || !/^v[1-9][0-9]*$/.test(vault.split('.')[0]) || vault.slice(vault.indexOf('.') + 1) !== config.near.factory) throw new SetupError('Select a vault from the published factory.')
  if (!config.createVault?.markets.some(market => market.loan_token.toLowerCase() === token.toLowerCase()) || !isAddress(token)) throw new SetupError('The USDC token is not in the published deployment.')
  if (!isAddress(owner) || !Number.isSafeInteger(nonce) || nonce < 1 || !Number.isSafeInteger(expiry) || expiry <= 0 || amount <= 0n) throw new SetupError('The withdrawal parameters are invalid.')
  return JSON.stringify({ protocol: 'cmdk-vault/1', network: 'testnet', vault, method: 'withdraw', args: { token, amount: amount.toString(), destination: owner }, nonce, expiry })
}

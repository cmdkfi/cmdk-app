// Validates and assembles the guided-flow config blocks (PRD FR-2, FR-17, Appendix C).
// Shared by generate-config.mjs and the unit tests; values come from config.app.json and the
// published deployment manifest only.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function fail(message) { throw new Error(`Guided config: ${message}`) }
function https(url, where) {
  if (typeof url !== 'string' || url.trim() === '') fail(`${where} is empty`)
  let parsed
  try { parsed = new URL(url) } catch { fail(`${where} is not a URL`) }
  if (parsed.protocol !== 'https:') fail(`${where} must use https`)
  return url
}
function links(list, where) {
  if (!Array.isArray(list) || list.length === 0) fail(`${where} needs at least one link`)
  return list.map((item, index) => {
    if (!item || typeof item.label !== 'string' || !item.label.trim() || typeof item.note !== 'string') fail(`${where}[${index}] needs label and note`)
    return { label: item.label, url: https(item.url, `${where}[${index}].url`), note: item.note }
  })
}

export function guidedValues(appValues, deployment) {
  const guided = appValues.guided ?? fail('missing "guided"')
  const c = guided.corridor ?? fail('missing corridor')
  const numbers = ['floor', 'target', 'act', 'budget']
  if (!numbers.every(key => typeof c[key] === 'number' && Number.isFinite(c[key])) || typeof c.migrate !== 'boolean' || typeof c.exit !== 'boolean') fail('invalid corridor')
  // CorridorMath.sol: floor < target, target + 0.1pp < act; act is checked against the market LLTV at setup time.
  if (!(c.floor >= 0 && c.floor < c.target && c.target + 0.1 < c.act && c.act < 100 && c.budget > 0 && c.budget <= 100)) fail('corridor outside protocol bounds')
  if (typeof guided.minDepositEth !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(guided.minDepositEth) || Number(guided.minDepositEth) <= 0) fail('invalid minDepositEth')
  if (!Number.isInteger(guided.messageExpirySecs) || guided.messageExpirySecs < 60 || guided.messageExpirySecs > 3600) fail('messageExpirySecs must be 60..3600 (vault expiry limit)')
  if (!Number.isInteger(guided.walletTxGasLimit) || guided.walletTxGasLimit < 21000) fail('invalid walletTxGasLimit')
  if (typeof guided.usdcDust !== 'string' || !/^\d+$/.test(guided.usdcDust)) fail('invalid usdcDust')
  // Vaults numbered below this were made by the previous app and are ignored (PRD D4, R8).
  if (!Number.isInteger(guided.firstVaultNumber) || guided.firstVaultNumber < 1) fail('firstVaultNumber must be a positive integer')

  const network = appValues.network ?? fail('missing "network"')
  if (network.chainId !== '0x14a34' || network.chainName !== 'Base Sepolia') fail('network must be Base Sepolia (0x14a34)')
  if (!Array.isArray(network.rpcUrls) || network.rpcUrls.length !== 1) fail('network needs exactly one rpc URL')
  if (!Array.isArray(network.blockExplorerUrls) || network.blockExplorerUrls.length !== 1) fail('network needs exactly one explorer URL')
  const currency = network.nativeCurrency
  if (!currency || currency.symbol !== 'ETH' || currency.decimals !== 18 || typeof currency.name !== 'string') fail('native currency must be ETH/18')

  const help = appValues.help ?? fail('missing "help"')
  const base = deployment?.base
  const addresses = { morpho: base?.morpho, weth: base?.tokens?.weth, usdc: base?.tokens?.usdc, gasPriceOracle: base?.gasPriceOracle }
  for (const [key, value] of Object.entries(addresses)) if (!ADDRESS.test(value ?? '')) fail(`deployment base.${key} is missing or invalid`)
  if (!Number.isInteger(base.executorDeployBlock) || base.executorDeployBlock <= 0) fail('deployment base.executorDeployBlock is missing')

  return {
    guided: { corridor: { ...c }, minDepositEth: guided.minDepositEth, messageExpirySecs: guided.messageExpirySecs, walletTxGasLimit: guided.walletTxGasLimit, usdcDust: guided.usdcDust, firstVaultNumber: guided.firstVaultNumber },
    network: {
      chainId: network.chainId, chainName: network.chainName,
      rpcUrls: [https(network.rpcUrls[0], 'network.rpcUrls[0]')],
      nativeCurrency: { name: currency.name, symbol: currency.symbol, decimals: currency.decimals },
      blockExplorerUrls: [https(network.blockExplorerUrls[0], 'network.blockExplorerUrls[0]')],
    },
    help: {
      metamaskInstall: https(help.metamaskInstall, 'help.metamaskInstall'),
      connectingToBase: https(help.connectingToBase, 'help.connectingToBase'),
      nearblocks: https(help.nearblocks, 'help.nearblocks'),
      ethFaucets: links(help.ethFaucets, 'help.ethFaucets'),
      usdcFaucets: links(help.usdcFaucets, 'help.usdcFaucets'),
    },
    base: { ...addresses, executorDeployBlock: base.executorDeployBlock },
  }
}

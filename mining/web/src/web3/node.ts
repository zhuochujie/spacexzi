import { getBlockNumber, readContracts } from '@wagmi/core'
import { erc20Abi, type Address } from 'viem'
import { wagmiConfig } from './config'
import { node, usdtToken } from './constants'

export async function getNodeChainOverview(address: Address) {
    const blockNumber = await getBlockNumber(wagmiConfig, { cacheTime: 0 })
    const [level, levels, paused, decimals, token] = await readContracts(wagmiConfig, {
        allowFailure: false,
        blockNumber,
        contracts: [
            { ...node, functionName: 'getUserLevel', args: [address] },
            { ...node, functionName: 'getAllLevels' },
            { ...node, functionName: 'purchasePaused' },
            { address: usdtToken, abi: erc20Abi, functionName: 'decimals' },
            { ...node, functionName: 'USDT' },
        ],
    })
    if (token.toLowerCase() !== usdtToken.toLowerCase())
        throw new Error('NODE_USDT_CONFIG_MISMATCH')
    return {
        level: Number(level), paused, decimals,
        levels: levels.map((tier, index) => ({
            index, name: tier.name, price: tier.price.toString(), enabled: tier.enabled,
        })),
    }
}

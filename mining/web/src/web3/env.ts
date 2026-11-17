import type { Address } from 'viem'

type ContractAddressKey =
    | 'VITE_BUYBACK_POOL_ADDRESS'
    | 'VITE_BUYBACK_DIVIDEND_VAULT_ADDRESS'
    | 'VITE_MARKET_CONTRACT_ADDRESS'
    | 'VITE_MINING_CONTRACT_ADDRESS'
    | 'VITE_NODE_CONTRACT_ADDRESS'
    | 'VITE_SPACE_TOKEN_ADDRESS'
    | 'VITE_USDT_TOKEN_ADDRESS'
    | 'VITE_NODE_FEE_VAULT_ADDRESS'
    | 'VITE_VIP_FEE_VAULT_ADDRESS'

function contractAddress(
    key: ContractAddressKey,
    configuredValue: string | undefined,
): Address {
    const value = configuredValue?.trim()
    if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error(
            `Invalid or missing ${key}. Check the web environment configuration.`,
        )
    }
    return value as Address
}

export const contractAddresses = {
    buybackPool: contractAddress(
        'VITE_BUYBACK_POOL_ADDRESS',
        import.meta.env.VITE_BUYBACK_POOL_ADDRESS,
    ),
    buybackDividendVault: contractAddress(
        'VITE_BUYBACK_DIVIDEND_VAULT_ADDRESS',
        import.meta.env.VITE_BUYBACK_DIVIDEND_VAULT_ADDRESS,
    ),
    market: contractAddress(
        'VITE_MARKET_CONTRACT_ADDRESS',
        import.meta.env.VITE_MARKET_CONTRACT_ADDRESS,
    ),
    mining: contractAddress(
        'VITE_MINING_CONTRACT_ADDRESS',
        import.meta.env.VITE_MINING_CONTRACT_ADDRESS,
    ),
    node: contractAddress(
        'VITE_NODE_CONTRACT_ADDRESS',
        import.meta.env.VITE_NODE_CONTRACT_ADDRESS,
    ),
    spaceToken: contractAddress(
        'VITE_SPACE_TOKEN_ADDRESS',
        import.meta.env.VITE_SPACE_TOKEN_ADDRESS,
    ),
    usdtToken: contractAddress(
        'VITE_USDT_TOKEN_ADDRESS',
        import.meta.env.VITE_USDT_TOKEN_ADDRESS,
    ),
    nodeFeeVault: contractAddress(
        'VITE_NODE_FEE_VAULT_ADDRESS',
        import.meta.env.VITE_NODE_FEE_VAULT_ADDRESS,
    ),
    vipFeeVault: contractAddress(
        'VITE_VIP_FEE_VAULT_ADDRESS',
        import.meta.env.VITE_VIP_FEE_VAULT_ADDRESS,
    ),
} as const

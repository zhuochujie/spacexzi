import { chainFromEnv } from './chain-config'
import type { Connector } from '@wagmi/core'
import { createConfig, http, injected } from 'wagmi'

export const appChain = chainFromEnv(import.meta.env, 'VITE_')
export const appChainId = appChain.id

export const wagmiConfig = createConfig({
    chains: [appChain],
    connectors: [injected()],
    transports: {
        [appChainId]: http(appChain.rpcUrls.default.http[0]),
    },
})

export async function ensureAppChain(connection: {
    chainId?: number
    connector?: Connector
}) {
    if (connection.chainId === appChainId) {
        return
    }

    if (!connection.connector?.switchChain) {
        throw new Error('Wallet does not support switching chains')
    }

    await connection.connector.switchChain({ chainId: appChainId })
}

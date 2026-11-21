import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from 'wagmi'
import { clearAccessToken, getLoginAddress } from '../../api'
import { useAuthSession } from '../../hooks/useAuthSession'
import { appChainId, ensureAppChain } from '../../web3/config'

function WalletAuthGuard() {
    const queryClient = useQueryClient()
    const token = useAuthSession()
    const { address, chainId, connector, isConnected, status } = useConnection()

    useEffect(() => {
        const loginAddress = getLoginAddress()

        if (!token || status === 'reconnecting' || status === 'connecting') {
            return
        }

        if (!isConnected || !address) {
            clearAccessToken()
            queryClient.clear()
            return
        }

        if (loginAddress && address.toLowerCase() !== loginAddress) {
            clearAccessToken()
            queryClient.clear()
        }
    }, [address, isConnected, status, token, queryClient])

    useEffect(() => {
        if (!isConnected || chainId === appChainId) {
            return
        }

        void ensureAppChain({ chainId, connector }).catch(() => {
            // Contract writes also declare appChainId, so a rejected switch cannot send on another chain.
        })
    }, [chainId, connector, isConnected])

    return null
}

export default WalletAuthGuard

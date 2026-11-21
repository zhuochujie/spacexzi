import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AUTH_CHANGED_EVENT, getAccessToken } from '../../api'

function AuthExpiredHandler() {
    const queryClient = useQueryClient()
    useEffect(() => {
        let previousToken = getAccessToken()
        const handleSessionChange = (event: Event) => {
            const nextToken = getAccessToken()
            if (nextToken !== previousToken || event.type === 'auth:expired') {
                previousToken = nextToken
                queryClient.clear()
            }
        }
        window.addEventListener(AUTH_CHANGED_EVENT, handleSessionChange)
        window.addEventListener('auth:expired', handleSessionChange)
        window.addEventListener('storage', handleSessionChange)
        return () => {
            window.removeEventListener(AUTH_CHANGED_EVENT, handleSessionChange)
            window.removeEventListener('auth:expired', handleSessionChange)
            window.removeEventListener('storage', handleSessionChange)
        }
    }, [queryClient])
    return null
}

export default AuthExpiredHandler

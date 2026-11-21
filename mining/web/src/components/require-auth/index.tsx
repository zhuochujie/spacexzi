import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuthSession } from '../../hooks/useAuthSession'

function RequireAuth({ children }: { children: ReactNode }) {
    const accessToken = useAuthSession()
    const location = useLocation()
    if (!accessToken) {
        const redirect = location.pathname + location.search
        return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
    }
    return children
}

export default RequireAuth

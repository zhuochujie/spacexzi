import { useSyncExternalStore } from 'react'
import { AUTH_CHANGED_EVENT, getAccessToken } from '../api'

function subscribe(onChange: () => void) {
    window.addEventListener(AUTH_CHANGED_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
        window.removeEventListener(AUTH_CHANGED_EVENT, onChange)
        window.removeEventListener('storage', onChange)
    }
}

export function useAuthSession() {
    return useSyncExternalStore(subscribe, getAccessToken, () => null)
}

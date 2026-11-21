// Retain referral parameters from existing root/login links without accepting external redirects.
export function getLoginDestination(search: string) {
    const params = new URLSearchParams(search)
    const requested = params.get('redirect') || '/index'
    const pathname = requested.split(/[?#]/)[0]
    const isInternal = requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\')
    const target = new URL(isInternal && pathname !== '/' && pathname !== '/login' ? requested : '/index', 'https://local.invalid')
    params.delete('redirect')
    for (const [key, value] of params) {
        if (!target.searchParams.has(key)) target.searchParams.set(key, value)
    }
    return target.pathname + target.search
}

type FormatAddressOptions = {
    prefix?: number
    suffix?: number
    fallback?: string
}

export function formatAddress(address?: string | null, options: FormatAddressOptions = {}) {
    const {
        prefix = 7,
        suffix = 5,
        fallback = '--',
    } = options

    if (!address) {
        return fallback
    }

    if (address.length <= prefix + suffix) {
        return address
    }

    return `${address.slice(0, prefix)}...${address.slice(-suffix)}`
}

// API token enums remain unchanged; normalize only user-facing labels.
export function formatTokenSymbol(value: string) {
    return value.replace(/\bSPACE\b/g, 'SpaceXZI')
}

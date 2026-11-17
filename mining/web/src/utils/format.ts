import { formatUnits, parseUnits } from 'viem'

type FormatAmountOptions = {
    decimals?: number
    fractionDigits?: number
    fixed?: boolean
    fallback?: string
    minVisibleAmount?: bigint
    minVisibleText?: string
    signed?: boolean
    display?: boolean
}

function trimTrailingZeros(value: string) {
    return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function toBigint(value: bigint | string | number | null | undefined) {
    return value === null || value === undefined
        ? 0n
        : typeof value === 'bigint'
            ? value
            : BigInt(value)
}

function absBigint(value: bigint) {
    return value < 0n ? -value : value
}

export function formatAmount(value: bigint | string | number | null | undefined, options: FormatAmountOptions = {}) {
    const {
        decimals = 18,
        fractionDigits = 2,
        fixed = false,
        fallback = '0',
        minVisibleAmount = options.display ? 10n ** 16n : undefined,
        minVisibleText = options.display ? '＜0.01' : undefined,
        signed = false,
    } = options

    try {
        if (decimals < 0 || !Number.isInteger(decimals)) {
            return fallback
        }

        if (fractionDigits !== undefined && (fractionDigits < 0 || !Number.isInteger(fractionDigits))) {
            return fallback
        }

        const bigintValue = toBigint(value)

        if (minVisibleAmount !== undefined && bigintValue !== 0n && absBigint(bigintValue) < minVisibleAmount) {
            const minText = minVisibleText ?? `<${formatUnits(minVisibleAmount, decimals)}`
            return signed && bigintValue > 0n
                ? `+${minText}`
                : signed && bigintValue < 0n
                    ? `-${minText}`
                    : minText
        }

        const rawAmount = formatUnits(bigintValue, decimals)
        const [integerPart, decimalPart = ''] = rawAmount.split('.')
        const decimal = fractionDigits === undefined
            ? decimalPart
            : decimalPart.slice(0, fractionDigits).padEnd(fixed ? fractionDigits : 0, '0')
        const formatted = decimal ? `${integerPart}.${decimal}` : integerPart
        const displayAmount = fixed ? formatted : trimTrailingZeros(formatted)

        return signed && bigintValue >= 0n ? `+${displayAmount}` : displayAmount
    } catch {
        return fallback
    }
}

export function parseTokenAmount(value: string, decimals = 18) {
    try {
        return Number(value) > 0 ? parseUnits(value, decimals) : 0n
    } catch {
        return 0n
    }
}

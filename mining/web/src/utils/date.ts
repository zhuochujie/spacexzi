function pad2(value: number) {
    return String(value).padStart(2, '0')
}

function getDateParts(timestamp: number) {
    const date = new Date(timestamp * 1000)

    return {
        year: date.getFullYear(),
        month: pad2(date.getMonth() + 1),
        day: pad2(date.getDate()),
        hour: pad2(date.getHours()),
        minute: pad2(date.getMinutes()),
    }
}

export function formatDate(timestamp: number) {
    const { year, month, day } = getDateParts(timestamp)

    return `${year}-${month}-${day}`
}

export function formatDateTime(timestamp: number) {
    const { year, month, day, hour, minute } = getDateParts(timestamp)

    return `${year}-${month}-${day} ${hour}:${minute}`
}

export function formatShortDateTime(timestamp: number) {
    const { month, day, hour, minute } = getDateParts(timestamp)

    return `${month}-${day} ${hour}:${minute}`
}

export function formatLocaleDate(timestamp?: number) {
    return timestamp ? new Date(timestamp * 1000).toLocaleDateString() : ''
}

export function formatLocaleDateTime(timestamp?: number) {
    return timestamp ? new Date(timestamp * 1000).toLocaleString() : ''
}

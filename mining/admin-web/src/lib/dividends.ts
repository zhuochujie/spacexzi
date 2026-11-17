import type { DividendRule } from '../api'

export function formatDividendCategory(category: DividendRule['category']) {
  return category === 'vip' ? 'VIP 分红' : category === 'buyback' ? '回购分红' : '节点分红'
}

export function formatDividendBp(bp: number) {
  return `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

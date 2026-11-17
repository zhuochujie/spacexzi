import { useQuery } from '@tanstack/react-query'
import { getMiningStatus } from '../api'
import { useI18n } from '../i18n'

export default function MiningStartNotice() {
    const { t } = useI18n()
    const { data } = useQuery({ queryKey: ['mining-status'], queryFn: getMiningStatus, refetchInterval: 15000 })
    if (!data || data.miningStartedAt !== null) return null
    return <p role="status" style={{ padding: '12px 16px', margin: '12px 0', borderRadius: 12, background: 'rgba(130, 110, 255, 0.12)', lineHeight: 1.6 }}>{t('miner.pendingPurchase')}</p>
}

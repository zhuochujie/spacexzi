import { useI18n } from '../../i18n'
import styles from './index.module.css'

type FetchingOverlayProps = {
    loading: boolean
}

function FetchingOverlay({ loading }: FetchingOverlayProps) {
    const { t } = useI18n()

    if (!loading) {
        return null
    }

    return (
        <div className={styles.overlay}>
            <div className={styles.spinner} />
            <span>{t('common.loading')}</span>
        </div>
    )
}

export default FetchingOverlay

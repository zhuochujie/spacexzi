import { formatTokenSymbol } from '../../utils/token'
import { freeMinerImage, fallbackMinerImage, getMinerPresentation } from '../../utils/miner-presentation'
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import copy from "copy-to-clipboard"
import { toast } from "react-hot-toast"
import { getCommissionLevel, getProfile, getTeam, type TeamMember } from "../../api"
import Modal from "../../components/modal"
import PageHeader from "../../components/page-header"
import SkeletonText from "../../components/skeleton-text"
import { formatAmount } from "../../utils/format"
import { formatAddress } from "../../utils/address"
import { formatDate } from "../../utils/date"
import { getApiErrorKey, useI18n } from "../../i18n"
import styles from "./index.module.css"

function TeamPage() {
    const { t } = useI18n()
    const [minerMember, setMinerMember] = useState<TeamMember | null>(null)
    const {
        data,
        isLoading: loading,
        isError,
        error,
    } = useQuery({
        queryKey: ['account', 'team'],
        queryFn: getTeam,
        staleTime: 30_000,
    })
    const { data: profile, isLoading: profileLoading } = useQuery({
        queryKey: ['profile'],
        queryFn: getProfile,
        staleTime: 30_000,
    })
    const { data: commissionLevel, isLoading: commissionLevelLoading } = useQuery({
        queryKey: ['account', 'commission-level'],
        queryFn: getCommissionLevel,
        staleTime: 30_000,
    })
    const members = data?.directList ?? []
    const canInvite = Boolean(profile?.canInvite || (profile?.nodeLevel ?? 0) > 0)
    const inviteLink = canInvite && profile?.refCode ? `${window.location.origin}/?refCode=${encodeURIComponent(profile.refCode)}` : ''

    const handleCopy = async (text: string, label: string) => {
        if (!text) {
            return
        }

        if (await copy(text)) {
            toast.success(t('team.copied', { label: t(label) }))
            return
        }

        toast.error(t('common.copyFailed'))
    }

    return (
        <div className={styles.page}>
            <PageHeader title="pages.team" backTo="/personal" />

            <div className={styles.summary}>
                <div>
                    <span>{t('team.members')}</span>
                    <strong>{loading ? <SkeletonText width={58} height={15} /> : `${data?.teamCount ?? 0} ${t('team.people')}`}</strong>
                </div>
                <div>
                    <span>{t('team.performance')}</span>
                    <strong>{loading ? <SkeletonText width={84} height={15} /> : `${formatAmount(data?.totalPerformance ?? '0', { display: true })} SpaceXZI`}</strong>
                </div>
            </div>

            <div className={styles.commission_card}>
                {commissionLevelLoading ? <SkeletonText width={120} height={12} /> : t('team.commissionLevel', { level: commissionLevel?.commissionLevel ?? 0 })}
            </div>

            {profileLoading && (
                <div className={styles.invite_card}>
                    <div>
                        <span>{t('team.referralLink')}</span>
                        <strong><SkeletonText width={180} height={12} /></strong>
                    </div>
                    <button type="button" disabled>
                        {t('team.copy')}
                    </button>
                </div>
            )}

            {!profileLoading && canInvite && (
                <div className={styles.invite_card}>
                    <div>
                        <span>{t('team.referralLink')}</span>
                        <strong>{inviteLink || '--'}</strong>
                    </div>
                    <button type="button" disabled={!inviteLink} onClick={() => handleCopy(inviteLink, 'team.referralLink')}>
                        {t('team.copy')}
                    </button>
                </div>
            )}

            <div className={styles.section_title}>{t('team.directMembers')}</div>

            <div className={styles.list}>
                {loading && <div className={styles.status}>{t('common.loading')}</div>}
                {!loading && isError && <div className={styles.status}>{error instanceof Error ? t(getApiErrorKey(error.message)) : t('team.loadFailed')}</div>}
                {!loading && !isError && members.length === 0 && <div className={styles.status}>{t('team.empty')}</div>}
                {!loading && !isError && members.map((member) => (
                    <div className={styles.member} key={member.id}>
                        <div className={styles.member_top}>
                            <div>
                                <button type="button" onClick={() => handleCopy(member.address, 'team.address')}>
                                    {formatAddress(member.address, { prefix: 8, suffix: 6 })}
                                </button>
                                <em>{formatDate(member.createdAt)}</em>
                            </div>
                            <strong>VIP {member.vipLevel}</strong>
                        </div>
                        <div className={styles.member_grid}>
                            <div>
                                <span>{t('team.miners')}</span>
                                <div className={styles.miner_count_value}>
                                    <strong>{member.miners?.length ?? 0}</strong>
                                    <button
                                        type="button"
                                        disabled={!member.miners?.length}
                                        onClick={() => setMinerMember(member)}
                                    >
                                        {t('team.details')}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <span>{t('team.branchPerformance')}</span>
                                <strong>{formatAmount(member.performance, { display: true })} SpaceXZI</strong>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <Modal
                open={Boolean(minerMember)}
                title="team.minerDetails"
                confirmText="team.close"
                showCancel={false}
                onCancel={() => setMinerMember(null)}
                onConfirm={() => setMinerMember(null)}
            >
                <div className={styles.miner_list}>
                    {(minerMember?.miners ?? []).map((miner) => (
                        <div className={styles.miner_item} key={`${miner.type}-${miner.id}`}>
                            <img
                                src={miner.type === 'free' ? freeMinerImage : getMinerPresentation(miner.minerId, '').image}
                                alt={formatTokenSymbol(miner.name)}
                                onError={(event) => {
                                    if (!event.currentTarget.src.endsWith(fallbackMinerImage)) event.currentTarget.src = fallbackMinerImage
                                }}
                            />
                            <strong>{formatTokenSymbol(miner.name)}</strong>
                        </div>
                    ))}
                </div>
            </Modal>
        </div>
    )
}

export default TeamPage

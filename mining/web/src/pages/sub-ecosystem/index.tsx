import { useNavigate } from "react-router"
import { useI18n } from "../../i18n"
import styles from "./index.module.css"
import SpaceBackground from "./images/space-ecosystem-bg.svg"
import ProposalIcon from "./images/icon-proposal.svg"
import VoteIcon from "./images/icon-vote.svg"
import FundingIcon from "./images/icon-funding.svg"
import DevelopIcon from "./images/icon-develop.svg"
import LaunchIcon from "./images/icon-launch.svg"
import ProposalArt from "./images/art-proposal.svg"
import VoteArt from "./images/art-vote.svg"
import FundingArt from "./images/art-funding.svg"
import DevelopArt from "./images/art-develop.svg"
import LaunchArt from "./images/art-launch.svg"

const tags = [
    'subEcosystem.tagCommunity',
    'subEcosystem.tagTransparent',
    'subEcosystem.tagIncentive',
    'subEcosystem.tagLaunch',
]

const steps = [
    {
        number: '01',
        icon: ProposalIcon,
        art: ProposalArt,
        titleKey: 'subEcosystem.proposalTitle',
        descKey: 'subEcosystem.proposalDesc',
    },
    {
        number: '02',
        icon: VoteIcon,
        art: VoteArt,
        titleKey: 'subEcosystem.voteTitle',
        descKey: 'subEcosystem.voteDesc',
    },
    {
        number: '03',
        icon: FundingIcon,
        art: FundingArt,
        titleKey: 'subEcosystem.fundingTitle',
        descKey: 'subEcosystem.fundingDesc',
    },
    {
        number: '04',
        icon: DevelopIcon,
        art: DevelopArt,
        titleKey: 'subEcosystem.developTitle',
        descKey: 'subEcosystem.developDesc',
    },
    {
        number: '05',
        icon: LaunchIcon,
        art: LaunchArt,
        titleKey: 'subEcosystem.launchTitle',
        descKey: 'subEcosystem.launchDesc',
    },
]

function SubEcosystemPage() {
    const navigate = useNavigate()
    const { t } = useI18n()

    return (
        <div className={styles.page}>
            <img className={styles.background} src={SpaceBackground} alt="" />
            <div className={styles.overlay} />

            <header className={styles.header}>
                <button type="button" aria-label={t('common.back')} onClick={() => navigate(-1)}>
                    <span />
                </button>
                <strong>{t('pages.subEcosystem')}</strong>
            </header>

            <main className={styles.content}>
                <section className={styles.hero}>
                    <h1>{t('subEcosystem.title')}</h1>
                    <h2>{t('subEcosystem.subtitle')}</h2>
                    <span className={styles.hero_line} />
                    <p>{t('subEcosystem.description')}</p>
                    <div className={styles.tags}>
                        {tags.map((tag) => (
                            <span key={tag}>{t(tag)}</span>
                        ))}
                    </div>
                </section>

                <section className={styles.steps} aria-label={t('subEcosystem.process')}>
                    {steps.map((step) => (
                        <article className={styles.step} key={step.number}>
                            <span className={styles.step_number}>{step.number}</span>
                            <span className={styles.step_icon} aria-hidden="true">
                                <img src={step.icon} alt="" />
                            </span>
                            <div className={styles.step_text}>
                                <h3>{t(step.titleKey)}</h3>
                                <p>{t(step.descKey)}</p>
                            </div>
                            <img className={styles.step_art} src={step.art} alt="" />
                        </article>
                    ))}
                </section>

                <section className={styles.coming_soon}>
                    <strong>{t('subEcosystem.comingSoon')}</strong>
                    <span>{t('subEcosystem.stayTuned')}</span>
                    <em />
                    <p>{t('subEcosystem.moreComing')}</p>
                </section>
            </main>
        </div>
    )
}

export default SubEcosystemPage

import LoginLogo from '../../assets/brand/spacexzi-logo-transparent.png'
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Navigate, useSearchParams } from "react-router"
import { getFriendlyErrorKey, useI18n } from "../../i18n"
import styles from "./index.module.css"
import { getAccountExists, getNonce, login, register, setAccessToken, setLoginAddress } from "../../api"
import Modal from "../../components/modal"
import LoadingLabel from "../../components/loading-label"
import ComputeCore from './images/compute-core.svg'
import { useAuthSession } from '../../hooks/useAuthSession'
import { getLoginDestination } from '../../utils/login-destination'

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Login failed'
}

function LoginPage() {
    const accessToken = useAuthSession()
    const { t, language, setLanguage } = useI18n()
    const queryClient = useQueryClient()
    const [searchParams] = useSearchParams()
    const [loading, setLoading] = useState(false)
    const [languageOpen, setLanguageOpen] = useState(false)
    const languageRef = useRef<HTMLDivElement>(null)
    const languageButtonRef = useRef<HTMLButtonElement>(null)
    const [message, setMessage] = useState('')
    const [refCodeInput, setRefCodeInput] = useState('')
    const [refCodeModalOpen, setRefCodeModalOpen] = useState(false)
    const refCodeResolver = useRef<((value: string) => void) | null>(null)

    useEffect(() => () => {
        refCodeResolver.current?.('')
        refCodeResolver.current = null
    }, [])

    useEffect(() => {
        if (!languageOpen) return
        const onPointerDown = (event: PointerEvent) => {
            if (!languageRef.current?.contains(event.target as Node)) setLanguageOpen(false)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLanguageOpen(false)
                languageButtonRef.current?.focus()
            }
        }
        window.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('pointerdown', onPointerDown)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [languageOpen])

    const requestRefCode = (defaultRefCode = '') => {
        setRefCodeInput(defaultRefCode)
        setRefCodeModalOpen(true)

        return new Promise<string>((resolve) => {
            refCodeResolver.current = resolve
        })
    }

    const closeRefCodeModal = (value: string) => {
        setRefCodeModalOpen(false)
        refCodeResolver.current?.(value.trim())
        refCodeResolver.current = null
    }

    const handleLogin = async () => {
        try {
            setLoading(true)
            setMessage('')

            const [{ connect, getAccount, signMessage }, { appChainId, ensureAppChain, wagmiConfig }] = await Promise.all([
                import('@wagmi/core'),
                import('../../web3/config'),
            ])
            let walletAddress = getAccount(wagmiConfig).address

            if (!walletAddress) {
                const connector = wagmiConfig.connectors[0]

                if (!connector) {
                    throw new Error(t('login.walletConnectorNotFound'))
                }

                walletAddress = (await connect(wagmiConfig, {
                    connector,
                    chainId: appChainId,
                })).accounts[0]
            }

            if (!walletAddress) {
                throw new Error(t('login.walletAddressNotFound'))
            }

            await ensureAppChain(getAccount(wagmiConfig))

            const normalizedAddress = walletAddress.toLowerCase()
            const account = await getAccountExists(normalizedAddress)
            const nonce = await getNonce(normalizedAddress)
            const pageSearchParams = new URLSearchParams(window.location.search)
            const destination = getLoginDestination(searchParams.toString())
            const destinationParams = new URLSearchParams(destination.split('?')[1] || '')
            const refCodeFromUrl = searchParams.get('refCode')
                || searchParams.get('ref')
                || destinationParams.get('refCode')
                || destinationParams.get('ref')
                || pageSearchParams.get('refCode')
                || pageSearchParams.get('ref')
                || ''
            const refCode = account.exists
                ? ''
                : await requestRefCode(refCodeFromUrl)
            const walletMessage = account.exists
                ? `Sign this message to login your account.\n\nAddress: ${normalizedAddress}\nNonce: ${nonce}`
                : `Sign this message to register your account.\n\nAddress: ${normalizedAddress}\nNonce: ${nonce}\nReferral Code: ${refCode}`

            if (!account.exists && !refCode) {
                throw new Error(t('login.referralRequired'))
            }

            const signature = await signMessage(wagmiConfig, { message: walletMessage })
            const result = account.exists
                ? await login(normalizedAddress, signature)
                : await register(normalizedAddress, refCode, signature)

            queryClient.clear()
            setLoginAddress(normalizedAddress)
            setAccessToken(result.access_token)

            try {
                const { syncNodeLevelIfUpgraded } = await import('../../utils/node-level')
                await syncNodeLevelIfUpgraded(normalizedAddress)
                queryClient.invalidateQueries({ queryKey: ['profile'] })
                queryClient.invalidateQueries({ queryKey: ['wallet-balances'] })
            } catch {
                // Node level sync should not block login when the RPC is temporarily unavailable.
            }

        } catch (error) {
            setMessage(t(getFriendlyErrorKey(getErrorMessage(error), 'common.walletActionFailed')))
        } finally {
            setLoading(false)
        }
    }

    if (accessToken) return <Navigate to={getLoginDestination(searchParams.toString())} replace />

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <img className={styles.brand} src={LoginLogo} alt="SpaceXZI" />
                <div className={styles.language} ref={languageRef}>
                    <button
                        ref={languageButtonRef}
                        className={styles.language_trigger}
                        type="button"
                        aria-label={`${t('login.language')}: ${t(`login.${language}`)}`}
                        aria-expanded={languageOpen}
                        aria-controls="login-language-menu"
                        onClick={() => setLanguageOpen((open) => !open)}
                    >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>
                        <span>{t(`login.${language}`)}</span>
                        <svg className={styles.language_arrow} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                    </button>
                    {languageOpen && (
                        <div id="login-language-menu" className={styles.language_menu} role="group" aria-label={t('login.language')}>
                            {(['en', 'th', 'ko', 'zh'] as const).map((item) => (
                                <button type="button" key={item} aria-pressed={language === item} onClick={() => {
                                    void setLanguage(item)
                                    setLanguageOpen(false)
                                    languageButtonRef.current?.focus()
                                }}>
                                    <span>{t(`login.${item}`)}</span>
                                    {language === item && <span aria-hidden="true">✓</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </header>
            <div className={styles.layout}>
                <section className={styles.hero} aria-labelledby="login-title">
                    <span className={styles.eyebrow}><i aria-hidden="true" />{t('login.computeLabel')}</span>
                    <h1 id="login-title">{t('login.heroTitle')}<br /><span>{t('login.heroAccent')}</span></h1>
                    <p className={styles.hero_description}>{t('login.heroDescription')}</p>
                    <div className={styles.visual} aria-hidden="true">
                        <img src={ComputeCore} alt="" />
                    </div>
                </section>
                <section className={styles.card} aria-labelledby="login-panel-title">
                    <div className={styles.card_heading}>
                        <span className={styles.wallet_icon} aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none"><path d="M4 7V5a2 2 0 0 1 2-2h12v4M4 7h16v13H4V7Z" /><path d="M20 11h-5v5h5M17 13.5h.01" /></svg>
                        </span>
                        <div><h2 id="login-panel-title">{t('login.walletTitle')}</h2><p>{t('login.walletSubtitle')}</p></div>
                    </div>
                    {message && <p className={styles.message} role="alert">{message}</p>}
                    <button className={styles.login_button} type="button" disabled={loading} onClick={handleLogin}>
                        {loading ? <LoadingLabel text={t('login.loggingIn')} /> : <><span>{t('login.connectWallet')}</span><span className={styles.login_arrow} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M7 7h10v10" /></svg></span></>}
                    </button>
                    <p className={styles.signature_hint}>
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg>
                        {t('login.signatureHint')}
                    </p>
                </section>
            </div>
            <footer className={styles.footer}><span>SpaceXZI</span><span>{t('login.footerLabel')}</span></footer>
            <Modal
                open={refCodeModalOpen}
                title="login.referralTitle"
                onCancel={() => closeRefCodeModal('')}
                onConfirm={() => closeRefCodeModal(refCodeInput)}
            >
                <input
                    className={styles.ref_code_input}
                    aria-label={t('login.referralTitle')}
                    value={refCodeInput}
                    placeholder={t('login.referralPlaceholder')}
                    onChange={(event) => setRefCodeInput(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') closeRefCodeModal(refCodeInput)
                    }}
                />
            </Modal>
        </main>
    )
}

export default LoginPage

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import IndexImage from './images/index.svg'
import IndexImageActive from './images/index-active.svg'
import MinerImage from './images/miner.svg'
import MinerImageActive from './images/miner-active.svg'
import MarketImage from './images/market.svg'
import MarketImageActive from './images/market-active.svg'
import PersonalImage from './images/personal.svg'
import PersonalImageActive from './images/personal-active.svg'
import BuybackImage from './images/buyback.svg'
import BuybackImageActive from './images/buyback-active.svg'
import { useI18n } from "../../i18n";

import styles from "./index.module.css"

const menus = [
    {
        path: '/index',
        label: 'nav.home',
        icon: IndexImage,
        activeIcon: IndexImageActive,
    },
    {
        path: '/miner',
        label: 'nav.miner',
        icon: MinerImage,
        activeIcon: MinerImageActive,
    },
    {
        path: '/market',
        label: 'nav.market',
        icon: MarketImage,
        activeIcon: MarketImageActive,
    },
    {
        path: '/buyback',
        label: 'nav.buyback',
        icon: BuybackImage,
        activeIcon: BuybackImageActive,
    },
    {
        path: '/personal',
        label: 'nav.personal',
        icon: PersonalImage,
        activeIcon: PersonalImageActive,
    },
]

function BottomMenu() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const { pathname } = useLocation();
    const showMenu = menus.some((item) => item.path === pathname);

    useEffect(() => {
        menus.flatMap((item) => [item.icon, item.activeIcon]).forEach((src) => {
            const image = new Image();
            image.src = src;
        });
    }, []);

    if (!showMenu) {
        return null;
    }

    return (
        <div>
            <div className={styles.menu_con}>
                {menus.map((item) => {
                    const isActive = pathname === item.path;

                    return (
                        <button type="button" key={item.path} aria-current={isActive ? 'page' : undefined} onClick={() => navigate(item.path)}>
                            <img src={isActive ? item.activeIcon : item.icon} alt="" />
                            <span className={isActive ? styles.menu_active : ''}>{t(item.label)}</span>
                        </button>
                    )
                })}
            </div>
            <div className={styles.placeholder}></div>
        </div>
    );
}

export default BottomMenu;

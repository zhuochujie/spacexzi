// 统一管理默认矿机的科技蓝插画与介绍，供首页、矿机页和团队弹窗使用。
const minerImages: Record<string, string> = {
    SPACE_10: 'SPACE_10',
    SPACE_50: 'SPACE_50',
    SPACE_100: 'SPACE_100',
    SPACE_300: 'SPACE_300',
    SPACE_500: 'SPACE_500',
    SPACE_1000: 'SPACE_1000',
    SPACE_3000: 'SPACE_3000',
    SPACE_5000: 'SPACE_5000',
}

export const freeMinerImage = '/miners/FREE_MINER.svg'
export const fallbackMinerImage = '/miners/SPACE_10.svg'

export function getMinerPresentation(id: string, description: string) {
    const image = minerImages[id]
    return {
        image: image ? `/miners/${image}.svg` : fallbackMinerImage,
        // 以默认矿机 ID 对应翻译，避免旧数据库里的错误描述键影响展示。
        description: image ? `miner.desc.${id}` : description,
    }
}

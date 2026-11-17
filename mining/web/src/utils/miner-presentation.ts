// 默认矿机按价值从低到高使用现有的八档图片；两处矿机列表共用此配置。
const minerImages: Record<string, string> = {
    SPACE_10: 'SPACE_30',
    SPACE_50: 'SPACE_100',
    SPACE_100: 'SPACE_300',
    SPACE_300: 'SPACE_500',
    SPACE_500: 'SPACE_1000',
    SPACE_1000: 'SPACE_3000',
    SPACE_3000: 'SPACE_5000',
    SPACE_5000: 'SPACE_10000',
}

export const freeMinerImage = '/miners/SPACE_40.webp'
export const fallbackMinerImage = '/miners/SPACE_30.webp'

export function getMinerPresentation(id: string, description: string) {
    const image = minerImages[id]
    return {
        image: image ? `/miners/${image}.webp` : fallbackMinerImage,
        // 以默认矿机 ID 对应翻译，避免旧数据库里的错误描述键影响展示。
        description: image ? `miner.desc.${id}` : description,
    }
}

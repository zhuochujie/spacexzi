import type { CSSProperties } from 'react'
import styles from './index.module.css'

type SkeletonTextProps = {
    width?: CSSProperties['width']
    height?: CSSProperties['height']
}

function SkeletonText({ width = '100%', height = 12 }: SkeletonTextProps) {
    return <span className={styles.skeleton} style={{ width, height }} />
}

export default SkeletonText

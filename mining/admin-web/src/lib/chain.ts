import { chainFromEnv } from './chain-config'
export const appChain = chainFromEnv(import.meta.env, 'VITE_')

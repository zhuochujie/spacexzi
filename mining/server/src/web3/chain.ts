import 'dotenv/config';
import { chainFromEnv } from './chain-config';

export const appChain = chainFromEnv(process.env);
export const chainConfirmations = appChain.confirmationDepth;

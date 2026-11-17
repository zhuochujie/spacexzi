import { marketAbi } from './market-abi';
import { buybackAbi } from './buyback-abi';
export { marketAbi } from './market-abi';
import { miningAbi } from './mining-abi';
export { miningAbi } from './mining-abi';
import { nodeAbi } from './node-abi';
export { nodeAbi } from './node-abi';
import { requiredEnv } from 'src/common/env.util';

export const signerPrivateKey = requiredEnv(
  'SIGNER_PRIVATE_KEY',
) as `0x${string}`;

export const market = {
  address: requiredEnv('MARKET_CONTRACT_ADDRESS') as `0x${string}`,
  abi: marketAbi,
} as const;

export const mining = {
  address: requiredEnv('MINING_CONTRACT_ADDRESS') as `0x${string}`,
  abi: miningAbi,
} as const;

export const node = {
  address: requiredEnv('NODE_CONTRACT_ADDRESS') as `0x${string}`,
  abi: nodeAbi,
} as const;

export const spaceToken = requiredEnv('SPACE_TOKEN_ADDRESS') as `0x${string}`;
export const usdtToken = requiredEnv('USDT_TOKEN_ADDRESS') as `0x${string}`;
export const nodeFeeVault = requiredEnv(
  'NODE_FEE_VAULT_ADDRESS',
) as `0x${string}`;
export const vipFeeVault = requiredEnv(
  'VIP_FEE_VAULT_ADDRESS',
) as `0x${string}`;

export const buybackPool = {
  address: requiredEnv('BUYBACK_POOL_ADDRESS') as `0x${string}`,
  abi: buybackAbi,
} as const;
export const buybackDividendVault = requiredEnv(
  'BUYBACK_DIVIDEND_VAULT_ADDRESS',
) as `0x${string}`;

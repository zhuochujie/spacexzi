import { marketAbi } from './market-abi';
import { buybackAbi } from './buyback-abi';
export { marketAbi } from './market-abi';
import { miningAbi } from './mining-abi';
export { miningAbi } from './mining-abi';
import { contractAddresses } from './env';
import { nodeAbi } from './node-abi';
export { nodeAbi } from './node-abi';

export const market = {
    address: contractAddresses.market,
    abi: marketAbi,
} as const;


export const mining = {
    address: contractAddresses.mining,
    abi: miningAbi,
} as const;

export const node = {
    address: contractAddresses.node,
    abi: nodeAbi,
} as const;

export const spaceToken = contractAddresses.spaceToken;
export const usdtToken = contractAddresses.usdtToken;

export const nodeFeeVault = contractAddresses.nodeFeeVault;
export const vipFeeVault = contractAddresses.vipFeeVault;

export const buybackPool = { address: contractAddresses.buybackPool, abi: buybackAbi } as const;
export const buybackDividendVault = contractAddresses.buybackDividendVault;

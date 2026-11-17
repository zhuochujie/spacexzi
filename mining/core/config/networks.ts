import { defineChain, type Chain } from 'viem';
import { anvil, bsc, bscTestnet } from 'viem/chains';

export type NetworkChain = Chain & { confirmationDepth: number };

// Reuse Viem presets. Only chains not built into Viem need a new defineChain entry.
// After changes, run: node core/scripts/sync-chain-config.cjs
export const networks: Record<string, NetworkChain> = {
  bsc: { ...bsc, confirmationDepth: 12 },
  bscTestnet: { ...bscTestnet, confirmationDepth: 12 },
  anvil: { ...anvil, confirmationDepth: 0 },
};

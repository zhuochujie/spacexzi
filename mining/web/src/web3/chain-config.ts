// Generated from mining/core/config/networks.ts. Run node core/scripts/sync-chain-config.cjs.
import { defineChain, type Chain } from "viem";
import { anvil, bsc, bscTestnet } from "viem/chains";

export type NetworkChain = Chain & { confirmationDepth: number };

// Reuse Viem presets. Only chains not built into Viem need a new defineChain entry.
// After changes, run: node core/scripts/sync-chain-config.cjs
export const networks: Record<string, NetworkChain> = {
  bsc: { ...bsc, confirmationDepth: 12 },
  bscTestnet: { ...bscTestnet, confirmationDepth: 12 },
  anvil: { ...anvil, confirmationDepth: 0 },
};

export function chainFromEnv(
  env: Record<string, string | undefined>,
  prefix = "",
): NetworkChain {
  const name = env[prefix + "CHAIN_NETWORK"]?.trim();
  if (!name) throw new Error("Missing " + prefix + "CHAIN_NETWORK");
  const chain = Object.prototype.hasOwnProperty.call(networks, name)
    ? networks[name]
    : undefined;
  if (!chain)
    throw new Error(
      "Unknown network " +
        name +
        ". Add it to mining/core/config/networks.ts and run the sync script.",
    );
  const rpc = env[prefix + "CHAIN_RPC_URL"]?.trim();
  if (!rpc) return chain;
  let parsed: URL;
  try {
    parsed = new URL(rpc);
  } catch {
    throw new Error("Invalid " + prefix + "CHAIN_RPC_URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Invalid " + prefix + "CHAIN_RPC_URL");
  return defineChain({ ...chain, rpcUrls: { default: { http: [rpc] } } });
}

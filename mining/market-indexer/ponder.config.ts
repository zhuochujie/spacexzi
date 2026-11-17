import { chainFromEnv } from './src/chain-config';
import { createConfig } from "ponder";
import { TokenExchangeAbi } from "./abis/TokenExchangeAbi";

const appChain = chainFromEnv(process.env);

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL!,
    poolConfig: {
      max: 30,
    },
  },
  chains: {
    configured: {
      id: appChain.id,
      rpc: appChain.rpcUrls.default.http[0],
      ws: process.env.CHAIN_WS_URL?.trim() || undefined,
    },
  },
  contracts: {
    TokenExchange: {
      chain: "configured",
      abi: TokenExchangeAbi,
      address: process.env.TOKEN_EXCHANGE_ADDRESS as `0x${string}`,
      startBlock: Number(process.env.START_BLOCK),
    },
  },
});

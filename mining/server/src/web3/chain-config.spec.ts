import { defineChain } from 'viem';
import { anvil, bsc, bscTestnet } from 'viem/chains';
import { chainFromEnv, networks } from './chain-config';

describe('named network presets', () => {
  it.each([
    ['bsc', 56],
    ['bscTestnet', 97],
    ['anvil', 31337],
  ])('selects %s using one env setting', (name, id) => {
    expect(chainFromEnv({ CHAIN_NETWORK: String(name) }).id).toBe(id);
  });
  it('retains the exact built-in network data with only project confirmation depth added', () => {
    expect(networks.bsc).toEqual({ ...bsc, confirmationDepth: 12 });
    expect(networks.bscTestnet).toEqual({
      ...bscTestnet,
      confirmationDepth: 12,
    });
    expect(networks.anvil).toEqual({ ...anvil, confirmationDepth: 0 });
  });
  it('includes all mainnet metadata automatically', () => {
    const chain = chainFromEnv({ CHAIN_NETWORK: 'bsc' });
    expect(chain.nativeCurrency.symbol).toBe('BNB');
    expect(chain.blockExplorers?.default.url).toBe('https://bscscan.com');
    expect(chain.contracts?.multicall3).toBeDefined();
    expect(chain.testnet).toBe(bsc.testnet);
    expect(chain.confirmationDepth).toBe(12);
  });
  it('keeps local networks free of explorer/multicall requirements and confirmation delays', () => {
    const chain = chainFromEnv({ CHAIN_NETWORK: 'anvil' });
    expect(chain.contracts).toBeUndefined();
    expect(chain.blockExplorers).toBeUndefined();
    expect(chain.confirmationDepth).toBe(0);
    expect(chain.testnet).toBe(anvil.testnet);
  });
  it('supports prefixed frontend selection and an optional RPC override', () => {
    const chain = chainFromEnv(
      {
        VITE_CHAIN_NETWORK: 'anvil',
        VITE_CHAIN_RPC_URL: 'http://localhost:18545',
      },
      'VITE_',
    );
    expect(chain.id).toBe(31337);
    expect(chain.rpcUrls.default.http).toEqual(['http://localhost:18545']);
  });
  it('retains preset metadata when overriding RPC', () => {
    const chain = chainFromEnv({
      CHAIN_NETWORK: 'bsc',
      CHAIN_RPC_URL: 'https://rpc.example',
    });
    expect(chain.nativeCurrency.symbol).toBe('BNB');
    expect(chain.contracts?.multicall3).toBeDefined();
    expect(chain.blockExplorers?.default.url).toBe('https://bscscan.com');
  });
  it('allows new chains to be added with defineChain instead of more env fields', () => {
    networks.custom = defineChain({
      id: 8453,
      name: 'Custom',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.example'] } },
      confirmationDepth: 1,
    });
    try {
      expect(chainFromEnv({ CHAIN_NETWORK: 'custom' }).id).toBe(8453);
    } finally {
      delete networks.custom;
    }
  });
  it('fails clearly for missing or unknown network names', () => {
    expect(() => chainFromEnv({})).toThrow('CHAIN_NETWORK');
    expect(() => chainFromEnv({ CHAIN_NETWORK: 'typo' })).toThrow(
      'Unknown network',
    );
  });
  it('rejects invalid RPC overrides and ignores blank overrides', () => {
    expect(() =>
      chainFromEnv({ CHAIN_NETWORK: 'bsc', CHAIN_RPC_URL: 'file:///tmp/rpc' }),
    ).toThrow('CHAIN_RPC_URL');
    expect(chainFromEnv({ CHAIN_NETWORK: 'anvil', CHAIN_RPC_URL: '' }).id).toBe(
      31337,
    );
  });
});

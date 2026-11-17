import { parseAbi, type PublicClient } from 'viem';
import { readContracts } from './read-contracts';
const contract = {
  address: '0x0000000000000000000000000000000000000001',
  abi: parseAbi(['function value() view returns (uint256)']),
  functionName: 'value',
} as const;
const parameters = {
  contracts: [contract, contract],
  allowFailure: false,
} as const;
describe('reading contract groups across EVM chains', () => {
  it('pins fallback reads to the same block when Multicall3 is absent', async () => {
    const client = {
      chain: {},
      getBlockNumber: jest.fn().mockResolvedValue(99n),
      readContract: jest
        .fn()
        .mockResolvedValueOnce(1n)
        .mockResolvedValueOnce(2n),
      multicall: jest.fn(),
    };
    expect(
      await readContracts(client as unknown as PublicClient, parameters),
    ).toEqual([1n, 2n]);
    expect(client.readContract).toHaveBeenCalledWith({
      ...contract,
      blockNumber: 99n,
    });
    expect(client.multicall).not.toHaveBeenCalled();
  });
  it('uses the requested confirmation block without querying a new head', async () => {
    const client = {
      chain: {},
      getBlockNumber: jest.fn(),
      readContract: jest.fn().mockResolvedValue(1n),
    };
    await readContracts(client as unknown as PublicClient, {
      ...parameters,
      blockNumber: 0n,
    });
    expect(client.getBlockNumber).not.toHaveBeenCalled();
    expect(client.readContract).toHaveBeenCalledWith({
      ...contract,
      blockNumber: 0n,
    });
  });
  it('uses multicall when its deployment is configured', async () => {
    const client = {
      chain: { contracts: { multicall3: {} } },
      getBlockNumber: jest.fn().mockResolvedValue(99n),
      multicall: jest.fn().mockResolvedValue([1n, 2n]),
    };
    expect(
      await readContracts(client as unknown as PublicClient, parameters),
    ).toEqual([1n, 2n]);
    expect(client.multicall).toHaveBeenCalledWith({
      ...parameters,
      blockNumber: 99n,
    });
  });
  it('propagates read failures instead of marking missing nonce results unused', async () => {
    const client = {
      chain: {},
      readContract: jest.fn().mockRejectedValue(new Error('RPC failed')),
    };
    await expect(
      readContracts(client as unknown as PublicClient, {
        ...parameters,
        blockNumber: 99n,
      }),
    ).rejects.toThrow('RPC failed');
  });
});

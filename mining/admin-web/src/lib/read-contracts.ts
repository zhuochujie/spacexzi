import type { PublicClient, MulticallParameters, MulticallReturnType, ReadContractParameters } from 'viem';

export async function readContracts<const Contracts extends readonly unknown[]>(
  client: PublicClient,
  parameters: MulticallParameters<Contracts, false>,
): Promise<MulticallReturnType<Contracts, false>> {
  const blockNumber = parameters.blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });
  if (client.chain?.contracts?.multicall3) {
    return client.multicall({ ...parameters, blockNumber });
  }
  const contracts = parameters.contracts as readonly ReadContractParameters[];
  const results = await Promise.all(contracts.map(contract => client.readContract({ ...contract, blockNumber })));
  return results as MulticallReturnType<Contracts, false>;
}

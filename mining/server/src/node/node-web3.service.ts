import { readContracts } from 'src/web3/read-contracts';
import { Injectable } from '@nestjs/common';
import { erc20Abi, keccak256, stringToBytes, type Address } from 'viem';
import { Web3Service } from 'src/web3/web3.service';
import { mining, node, usdtToken } from 'src/web3/constants';
import { appChain, chainConfirmations } from 'src/web3/chain';

@Injectable()
export class NodeWeb3Service {
  constructor(private readonly web3: Web3Service) {}
  readonly chainId = appChain.id;
  readonly contractAddress = node.address;
  async snapshot(buyer: string) {
    await this.assertRewardReceiver();
    const client = this.web3.publicClient;
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const [level, levels, paused, token, decimals] = await Promise.all([
      client.readContract({
        ...node,
        functionName: 'getUserLevel',
        args: [buyer as Address],
        blockNumber,
      }),
      client.readContract({
        ...node,
        functionName: 'getAllLevels',
        blockNumber,
      }),
      client.readContract({
        ...node,
        functionName: 'purchasePaused',
        blockNumber,
      }),
      client.readContract({ ...node, functionName: 'USDT', blockNumber }),
      client.readContract({
        address: usdtToken,
        abi: erc20Abi,
        functionName: 'decimals',
        blockNumber,
      }),
    ]);
    if (token.toLowerCase() !== usdtToken.toLowerCase())
      throw new Error('NODE_USDT_CONFIG_MISMATCH');
    return { level: Number(level), levels, paused, decimals };
  }
  async signPurchase(input: {
    buyer: string;
    action: string;
    fromLevel: number;
    targetLevelIndex: number;
    amount: string;
    rewardAmount: string;
    nonce: string;
    deadline: number;
  }) {
    return this.web3.sign(
      [
        'bytes32',
        'address',
        'uint256',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes32',
        'uint256',
      ],
      [
        keccak256(
          stringToBytes(
            input.action === 'purchase' ? 'PURCHASE_NODE' : 'UPGRADE_NODE',
          ),
        ),
        node.address,
        appChain.id,
        input.buyer,
        BigInt(input.fromLevel),
        BigInt(input.targetLevelIndex),
        BigInt(input.amount),
        BigInt(input.rewardAmount),
        keccak256(stringToBytes(input.nonce)),
        BigInt(input.deadline),
      ],
    );
  }
  async assertRewardReceiver() {
    const [receiver, token] = await Promise.all([
      this.web3.publicClient.readContract({ ...node, functionName: 'mining' }),
      this.web3.publicClient.readContract({ ...node, functionName: 'USDT' }),
    ]);
    if (receiver.toLowerCase() !== mining.address.toLowerCase())
      throw new Error('NODE_MINING_CONFIG_MISMATCH');
    if (token.toLowerCase() !== usdtToken.toLowerCase())
      throw new Error('NODE_USDT_CONFIG_MISMATCH');
  }
  async confirmedBlock() {
    const latest = await this.web3.publicClient.getBlockNumber({
      cacheTime: 0,
    });
    // 同一确认高度用于 nonce 状态和过期判定，避免解冻仍可能在链上执行的签名。
    return this.web3.publicClient.getBlock({
      blockNumber:
        latest > BigInt(chainConfirmations)
          ? latest - BigInt(chainConfirmations)
          : 0n,
    });
  }
  purchaseNonces(nonces: string[], blockNumber: bigint) {
    return readContracts(this.web3.publicClient, {
      contracts: nonces.map(
        (nonce) =>
          ({
            ...node,
            functionName: 'usedPurchaseNonces',
            args: [nonce],
          }) as const,
      ),
      allowFailure: false,
      blockNumber,
    });
  }
}

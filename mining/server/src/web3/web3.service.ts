import { readContracts } from './read-contracts';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CustomException } from 'src/common/custom.exception';
import {
  PublicClient,
  verifyMessage,
  createPublicClient,
  http,
  parseEventLogs,
  keccak256,
  encodePacked,
  stringToBytes,
  createWalletClient,
  erc20Abi,
} from 'viem';
import {
  market,
  buybackDividendVault,
  mining,
  node,
  nodeFeeVault,
  signerPrivateKey,
  spaceToken,
  usdtToken,
  vipFeeVault,
} from './constants';
import { privateKeyToAccount } from 'viem/accounts';
import { ConfigService } from 'src/config/config.service';
import { appChain } from './chain';

@Injectable()
export class Web3Service implements OnModuleInit {
  private readonly logger = new Logger(Web3Service.name, { timestamp: true });

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const actualChainId = await this.publicClient.getChainId();
    if (actualChainId !== appChain.id)
      throw new Error(
        `CHAIN_ID mismatch: configured ${appChain.id}, RPC returned ${actualChainId}`,
      );
  }

  // 构建客户端
  publicClient: PublicClient = createPublicClient({
    chain: appChain,
    transport: http(),
  });

  async accountVerify(address: string, message: string, signature: string) {
    try {
      return await verifyMessage({
        address: address as `0x${string}`,
        message: message,
        signature: signature as `0x${string}`,
      });
    } catch {
      return false;
    }
  }

  async sign(types: string[], values: any[]) {
    const account = privateKeyToAccount(signerPrivateKey);
    const messageHash = keccak256(encodePacked(types, values));

    const signature = await account.signMessage({
      message: { raw: messageHash },
    });
    return signature;
  }

  async signClaim(
    user: string,
    amount: string,
    vipFee: string,
    nodeFee: string,
    nonce: string,
    deadline: number,
  ) {
    const CLAIM_REWARD_ACTION = keccak256(stringToBytes('CLAIM_REWARD'));
    const value = [
      CLAIM_REWARD_ACTION,
      mining.address,
      appChain.id,
      user,
      amount,
      vipFee,
      nodeFee,
      keccak256(stringToBytes(nonce)),
      deadline,
    ];
    const signature = await this.sign(
      [
        'bytes32',
        'address',
        'uint256',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'bytes32',
        'uint256',
      ],
      value,
    );
    return { value, signature };
  }

  async signWithdrawUsdt(
    account: string,
    amount: string,
    nonce: string,
    deadline: number,
  ) {
    const WITHDRAW_USDT_ACTION = keccak256(stringToBytes('WITHDRAW_USDT'));
    const value = [
      WITHDRAW_USDT_ACTION,
      mining.address,
      appChain.id,
      account,
      amount,
      keccak256(stringToBytes(nonce)),
      deadline,
    ];
    const signature = await this.sign(
      [
        'bytes32',
        'address',
        'uint256',
        'address',
        'uint256',
        'bytes32',
        'uint256',
      ],
      value,
    );
    return { value, signature };
  }

  async signFeeExempt(user: string) {
    const nonce = await this.publicClient.readContract({
      address: market.address,
      abi: market.abi,
      functionName: 'feeExemptNonces',
      args: [user as `0x${string}`],
    });
    const SET_FEE_EXEMPT_ACTION = keccak256(stringToBytes('SET_FEE_EXEMPT'));
    const value = [
      SET_FEE_EXEMPT_ACTION,
      market.address,
      appChain.id,
      user,
      true,
      nonce,
    ];
    const signature = await this.sign(
      ['bytes32', 'address', 'uint256', 'address', 'bool', 'uint256'],
      value,
    );
    return { value, signature, nonce: nonce.toString() };
  }

  async isFeeExemptAccount(address: string) {
    return this.publicClient.readContract({
      address: market.address,
      abi: market.abi,
      functionName: 'feeExemptAccounts',
      args: [address as `0x${string}`],
    });
  }

  async signPurchaseMiner(
    buyer: string,
    minerId: string,
    price: string,
    payValue: string,
    expectedReward: string,
    nonce: string,
    deadline: number,
  ) {
    const PURCHASE_MINER_ACTION = keccak256(stringToBytes('PURCHASE_MINER'));
    const value = [
      PURCHASE_MINER_ACTION,
      mining.address,
      appChain.id,
      buyer,
      keccak256(stringToBytes(minerId)),
      price,
      payValue,
      expectedReward,
      keccak256(stringToBytes(nonce)),
      deadline,
    ];
    const signature = await this.sign(
      [
        'bytes32',
        'address',
        'uint256',
        'address',
        'bytes32',
        'uint256',
        'uint256',
        'uint256',
        'bytes32',
        'uint256',
      ],
      value,
    );
    return { value, signature };
  }

  getLatestBlock() {
    return this.publicClient.getBlock({ blockTag: 'latest' });
  }

  async getPurchaseMinerNoncesUsed(
    nonces: string[],
    blockNumber?: bigint,
  ): Promise<boolean[]> {
    if (nonces.length === 0) {
      return [];
    }

    const results = await readContracts(this.publicClient, {
      contracts: nonces.map((nonce) => ({
        address: mining.address,
        abi: mining.abi,
        functionName: 'usedPurchaseNonces',
        args: [nonce],
      })),
      allowFailure: false,
      blockNumber,
    });

    return results as unknown as boolean[];
  }

  async getClaimNoncesUsed(
    nonces: string[],
    blockNumber?: bigint,
  ): Promise<boolean[]> {
    if (nonces.length === 0) {
      return [];
    }

    const results = await readContracts(this.publicClient, {
      contracts: nonces.map((nonce) => ({
        address: mining.address,
        abi: mining.abi,
        functionName: 'usedClaimNonces',
        args: [nonce],
      })),
      allowFailure: false,
      blockNumber,
    });

    return results as unknown as boolean[];
  }

  async getWithdrawUsdtNoncesUsed(
    nonces: string[],
    blockNumber?: bigint,
  ): Promise<boolean[]> {
    if (nonces.length === 0) {
      return [];
    }

    const results = await readContracts(this.publicClient, {
      contracts: nonces.map((nonce) => ({
        address: mining.address,
        abi: mining.abi,
        functionName: 'usedWithdrawUsdtNonces',
        args: [nonce],
      })),
      allowFailure: false,
      blockNumber,
    });

    return results as unknown as boolean[];
  }

  async getNodeLevel(address: `0x${string}`) {
    const level = await this.publicClient.readContract({
      ...node,
      functionName: 'getUserLevel',
      args: [address],
    });
    return Number(level);
  }

  getNodeDeployment() {
    return { chainId: appChain.id, contractAddress: node.address };
  }

  // 分红
  async getNodeLevelValues() {
    const levels = await this.publicClient.readContract({
      ...node,
      functionName: 'getAllLevels',
    });
    return levels.map((level) => level.price);
  }

  async getBuybackDividendBalance() {
    return this.publicClient.readContract({
      address: usdtToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [buybackDividendVault],
    });
  }

  async dividend(buybackDividendUsdtAmount = 0n, includeNodeDividends = true) {
    const account = privateKeyToAccount(signerPrivateKey);
    const walletClient = createWalletClient({
      account,
      chain: appChain,
      transport: http(),
    });

    const [
      vipFeeVaultSpaceBalance,
      nodeFeeVaultSpaceBalance,
      nodeFeeVaultUsdtBalance,
    ] = await readContracts(this.publicClient, {
      contracts: [
        {
          address: spaceToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [vipFeeVault],
        },
        {
          address: spaceToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [nodeFeeVault],
        },
        {
          address: usdtToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [nodeFeeVault],
        },
      ],
      allowFailure: false,
    });

    const nodeSpaceAmount = includeNodeDividends
      ? nodeFeeVaultSpaceBalance
      : 0n;
    const nodeUsdtAmount = includeNodeDividends ? nodeFeeVaultUsdtBalance : 0n;
    const usdtDividendFeeBp = await this.configService.getUsdtDividendFeeBp();
    const usdtFee = (nodeUsdtAmount * usdtDividendFeeBp) / 10000n;
    const toMiner = nodeUsdtAmount - usdtFee;

    const { request } = await this.publicClient.simulateContract({
      account,
      address: mining.address,
      abi: mining.abi,
      functionName: 'dividend',
      args: [
        vipFeeVaultSpaceBalance,
        nodeSpaceAmount,
        toMiner,
        usdtFee,
        buybackDividendUsdtAmount,
      ],
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });
    this.logger.log(`分红Hash:${receipt.transactionHash}`);

    return {
      vipFeeVaultSpaceBalance,
      nodeFeeVaultSpaceBalance: nodeSpaceAmount,
      nodeFeeVaultUsdtBalance: toMiner,
    };
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delayMs = 3000,
    onFail?: () => void,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (error instanceof CustomException) {
          throw error; // 特殊异常直接抛
        }

        if (attempt === maxRetries) {
          try {
            onFail?.(); // ✅ 这里调用
          } catch {
            /* Keep the original RPC failure. */
          }
          throw lastError;
        }

        this.logger.log(`操作失败，第 ${attempt + 1} 次重试`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError!;
  }

  async getMarketEvent(hash: string) {
    const onFail = () => {
      // fetch(`https://api.day.app/pT8EThsAeMqa7d6Yg4DCJ8/Hash处理失败/${hash}`)
      // sendMessage('8579285388:AAEix3_ZBa3d04yyGdzvTYON93IliWK_RnE', '1875011696', `Hash处理失败\n<code>${hash}</code>`)
    };
    return this.withRetry(
      async () => {
        const receipt = await this.publicClient.getTransactionReceipt({
          hash: hash as `0x${string}`,
        });

        const marketLogs = receipt.logs.filter(
          (log) => log.address.toLowerCase() === market.address.toLowerCase(),
        );

        const logs = parseEventLogs({
          abi: market.abi,
          logs: marketLogs,
          eventName: ['OrderPlaced', 'OrderFilled', 'OrderCancelled'],
        });

        if (logs.length === 0) {
          this.logger.warn('未找到市场订单事件');

          throw new CustomException('MARKET_EVENT_NOT_FOUND', 400);
        }

        return logs;
      },
      3,
      3000,
      () => {
        onFail();
      },
    );
  }

  async getFreeMinerClaimEvent(hash: string) {
    return this.withRetry(async () => {
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: hash as `0x${string}`,
      });

      if (receipt.status !== 'success') {
        throw new CustomException('FREE_MINER_TX_FAILED', 400);
      }

      const miningLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === mining.address.toLowerCase(),
      );

      const logs = parseEventLogs({
        abi: mining.abi,
        logs: miningLogs,
        eventName: ['FreeMinerClaimed'],
      });

      if (logs.length === 0) {
        this.logger.warn('未找到免费矿机领取事件');
        throw new CustomException('FREE_MINER_EVENT_NOT_FOUND', 400);
      }

      const blockNumber = logs[0].blockNumber;
      if (blockNumber === null) {
        throw new CustomException('FREE_MINER_EVENT_NOT_FOUND', 400);
      }

      const blockTimestamp = Number(
        (await this.publicClient.getBlock({ blockNumber })).timestamp,
      );

      return {
        account: logs[0].args.account.toLowerCase(),
        spaceAmount: logs[0].args.spaceAmount.toString(),
        blockTimestamp,
      };
    });
  }
}

import { calculateFreeMinerRound } from './utils/free-miner-round.util';
import {
  lockMiningStart,
  parseMiningStartedAt,
  MINING_STARTED_AT_KEY,
} from './utils/mining-start.util';
import { Config } from 'src/config/entities/config.entity';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  LessThanOrEqual,
  MoreThan,
  QueryFailedError,
} from 'typeorm';
import { Miner } from './entities/miner.entity';
import { parseEther } from 'viem';
import { Account } from 'src/account/entities/account.entity';
import { AccountMiner } from './entities/account-miner.entity';
import { CustomException } from 'src/common/custom.exception';
import { computeCycleEndAt } from './utils/cycle.util';
import { Web3Service } from 'src/web3/web3.service';
import { randomUUID } from 'crypto';
import { MinerPurchaseSignature } from './entities/miner-purchase-signature.entity';
import { MinerPurchaseSignatureStatus } from './enums/miner-purchase-signature-status.enum';
import { PurchaseMethod } from './enums/purchase-method.enum';
import {
  AccountBalanceLog,
  AccountBalanceLogToken,
  AccountBalanceLogType,
} from 'src/account/entities/account-balance-log.entity';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from 'src/config/config.service';
import { FreeMiner } from './entities/free-miner.entity';

export interface FreeMinerHashJobData {
  accountId: number;
  address: string;
  hash: string;
}

@Injectable()
export class MinerService {
  private readonly logger = new Logger(MinerService.name, { timestamp: true });
  constructor(
    private readonly dataSource: DataSource,
    private readonly web3Service: Web3Service,
    private readonly configService: ConfigService,
    @InjectQueue('miner-queue')
    private readonly minerQueue: Queue,
  ) {}

  async initializeDefaults() {
    const miners = [
      {
        id: 'SPACE_10',
        name: 'SPACE 10',
        price: parseEther('10').toString(),
        expectedReward: parseEther('50').toString(),
        desc: 'miner.desc.SPACE_10',
      },
      {
        id: 'SPACE_50',
        name: 'SPACE 50',
        price: parseEther('50').toString(),
        expectedReward: parseEther('250').toString(),
        desc: 'miner.desc.SPACE_50',
      },
      {
        id: 'SPACE_100',
        name: 'SPACE 100',
        price: parseEther('100').toString(),
        expectedReward: parseEther('500').toString(),
        desc: 'miner.desc.SPACE_100',
      },
      {
        id: 'SPACE_300',
        name: 'SPACE 300',
        price: parseEther('300').toString(),
        expectedReward: parseEther('1500').toString(),
        desc: 'miner.desc.SPACE_300',
      },
      {
        id: 'SPACE_500',
        name: 'SPACE 500',
        price: parseEther('500').toString(),
        expectedReward: parseEther('2500').toString(),
        desc: 'miner.desc.SPACE_500',
      },
      {
        id: 'SPACE_1000',
        name: 'SPACE 1000',
        price: parseEther('1000').toString(),
        expectedReward: parseEther('5000').toString(),
        desc: 'miner.desc.SPACE_1000',
      },
      {
        id: 'SPACE_3000',
        name: 'SPACE 3000',
        price: parseEther('3000').toString(),
        expectedReward: parseEther('15000').toString(),
        desc: 'miner.desc.SPACE_3000',
      },
      {
        id: 'SPACE_5000',
        name: 'SPACE 5000',
        price: parseEther('5000').toString(),
        expectedReward: parseEther('25000').toString(),
        desc: 'miner.desc.SPACE_5000',
      },
    ];

    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'initialize_default_miners',
      ]);

      const minerRepository = manager.getRepository(Miner);
      const existingMiners = await minerRepository.find({
        where: [
          ...miners.map((miner) => ({ id: miner.id })),
          ...miners.map((miner) => ({ name: miner.name })),
        ],
        select: {
          id: true,
          name: true,
        },
      });
      const existingMinerIds = new Set(existingMiners.map((miner) => miner.id));
      const existingMinerNames = new Set(
        existingMiners.map((miner) => miner.name),
      );
      const missingMiners = miners.filter(
        (miner) =>
          !existingMinerIds.has(miner.id) &&
          !existingMinerNames.has(miner.name),
      );

      if (missingMiners.length > 0) {
        await minerRepository.insert(missingMiners);
      }
    });
  }

  async submitNonce(nonce: string) {
    return await this.minerQueue.add('mining-nonce', nonce, {
      jobId: `mining-nonce-${nonce}`,
    });
  }

  async submitFreeMinerHash(accountId: number, address: string, hash: string) {
    const freeMinerRepository = this.dataSource.getRepository(FreeMiner);
    const existingFreeMiner = await freeMinerRepository.findOne({
      where: [{ accountId }, { hash }],
    });

    if (existingFreeMiner?.accountId === accountId) {
      throw new ConflictException('FREE_MINER_ALREADY_CLAIMED');
    }
    if (existingFreeMiner?.hash === hash) {
      throw new ConflictException('FREE_MINER_HASH_ALREADY_USED');
    }

    return await this.minerQueue.add(
      'free-miner-hash',
      {
        accountId,
        address: address.toLowerCase(),
        hash,
      } satisfies FreeMinerHashJobData,
      { jobId: `free-miner-hash-${hash}` },
    );
  }

  async getFreeMinerHashStatus(hash: string) {
    const freeMinerRepository = this.dataSource.getRepository(FreeMiner);
    return await freeMinerRepository.findOne({
      where: { hash },
    });
  }

  async getMyFreeMiner(accountId: number) {
    const freeMinerRepository = this.dataSource.getRepository(FreeMiner);
    const freeMiner = await freeMinerRepository.findOne({
      where: { accountId },
    });

    if (!freeMiner) {
      return null;
    }

    const claimInfo = this.getFreeMinerClaimInfo(freeMiner);

    return {
      ...freeMiner,
      producedReward: claimInfo.projectedProducedReward.toString(),
      state: claimInfo.state,
      roundEndAt: claimInfo.roundEndAt,
      cycle: claimInfo.cycle,
      cycleEndAt: claimInfo.cycleEndAt,
      rewardPerSecond: claimInfo.rewardPerSecond.toString(),
      availableReward: claimInfo.availableReward.toString(),
      claimableReward: claimInfo.claimableReward.toString(),
    };
  }

  async claimFreeMinerReward(accountId: number) {
    return await this.dataSource.transaction(async (manager) => {
      const accountRepository = manager.getRepository(Account);
      const freeMinerRepository = manager.getRepository(FreeMiner);
      const accountBalanceLogRepository =
        manager.getRepository(AccountBalanceLog);
      const freeMiner = await freeMinerRepository.findOne({
        where: { accountId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!freeMiner) {
        throw new NotFoundException('FREE_MINER_NOT_FOUND');
      }

      const claimInfo = this.getFreeMinerClaimInfo(freeMiner);
      if (claimInfo.availableReward <= 0n) {
        throw new ConflictException('NO_FREE_MINER_REWARD_TO_CLAIM');
      }

      const account = await accountRepository.findOne({
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new CustomException('UNKNOWN_ERROR', 500);
      }

      const claimAmount = claimInfo.claimableReward;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const balanceBefore = account.balance;
      freeMiner.producedReward = claimInfo.projectedProducedReward.toString();
      freeMiner.cycle = claimInfo.cycle;
      freeMiner.cycleEndAt = claimInfo.cycleEndAt;
      freeMiner.rewardPerSecond = claimInfo.rewardPerSecond.toString();
      if (BigInt(freeMiner.producedReward) < BigInt(freeMiner.expectedReward)) {
        // Existing cycle boundaries are preserved; new policy applies from this new round.
        const [cycleConfig, freeConfig] = await Promise.all([
          this.configService.getMinerCycleConfig(),
          this.configService.getFreeMinerConfig(),
        ]);
        freeMiner.roundRewardBp = Number(freeConfig.cycleRewardBp);
        freeMiner.roundMaxCycle = cycleConfig.maxCycle;
        freeMiner.roundCycleExtension = cycleConfig.minerExtendedPerCycle;
        freeMiner.rewardPerSecond = (
          (BigInt(freeMiner.price) * freeConfig.cycleRewardBp) /
          10000n /
          BigInt(freeMiner.cycle)
        ).toString();
      }
      freeMiner.roundStartedAt =
        BigInt(freeMiner.producedReward) >= BigInt(freeMiner.expectedReward)
          ? null
          : currentTimestamp;
      freeMiner.lastRewardAt = currentTimestamp;
      freeMiner.claimedReward = (
        BigInt(freeMiner.claimedReward) + claimAmount
      ).toString();
      account.balance = (BigInt(account.balance) + claimAmount).toString();

      await freeMinerRepository.save(freeMiner);
      await accountRepository.save(account);
      await accountBalanceLogRepository.save(
        accountBalanceLogRepository.create({
          accountId: account.id,
          type: AccountBalanceLogType.FreeMinerClaim,
          token: AccountBalanceLogToken.Space,
          amount: claimAmount.toString(),
          balanceBefore,
          balanceAfter: account.balance,
          createdAt: currentTimestamp,
        }),
      );

      return {
        freeMiner: {
          ...freeMiner,
          state: freeMiner.roundStartedAt === null ? 'finished' : 'running',
          roundEndAt:
            freeMiner.roundStartedAt === null
              ? null
              : freeMiner.roundStartedAt + 86400,
          availableReward: (
            BigInt(freeMiner.producedReward) - BigInt(freeMiner.claimedReward)
          ).toString(),
          claimableReward: '0',
        },
        claimedAmount: claimAmount.toString(),
        balance: account.balance,
      };
    });
  }

  private getFreeMinerClaimInfo(freeMiner: FreeMiner) {
    const result = calculateFreeMinerRound(
      freeMiner,
      Math.floor(Date.now() / 1000),
    );
    return { ...result, claimableReward: result.availableReward };
  }

  async getFreeMinerConfig() {
    const [freeConfig, cycleConfig] = await Promise.all([
      this.configService.getFreeMinerConfig(),
      this.configService.getMinerCycleConfig(),
    ]);
    return {
      price: freeConfig.price.toString(),
      initialCycleDays: cycleConfig.initCycle / 86400,
    };
  }

  async getPurchaseMinerNonceStatus(nonce: string) {
    const minerPurchaseSignatureRepository = this.dataSource.getRepository(
      MinerPurchaseSignature,
    );
    return await minerPurchaseSignatureRepository.findOne({
      where: { nonce },
    });
  }

  async getMiners(accountId: number) {
    return this.dataSource
      .getRepository(Miner)
      .createQueryBuilder('miner')
      .select([
        'miner.id AS id',
        'miner.name AS name',
        'miner.price::text AS price',
        'miner.desc AS "desc"',
        'miner.expected_reward::text AS "expectedReward"',
        'miner.is_purchasable AS "isPurchasable"',
      ])
      .addSelect(
        `EXISTS (
          SELECT 1
          FROM account_miner
          WHERE account_miner.account_id = :accountId
            AND account_miner.miner_id = miner.id
        )`,
        'isOwned',
      )
      .setParameter('accountId', accountId)
      .orderBy('miner.price', 'ASC')
      .getRawMany<{
        id: string;
        name: string;
        price: string;
        desc: string | null;
        expectedReward: string;
        isPurchasable: boolean;
        isOwned: boolean;
      }>();
  }

  async getInitialCycle() {
    const cycleConfig = await this.configService.getMinerCycleConfig();
    return cycleConfig.initCycle / 86400;
  }

  async getMiningStatus() {
    const config = await this.dataSource
      .getRepository(Config)
      .findOneBy({ key: MINING_STARTED_AT_KEY });
    if (!config)
      throw new CustomException('MINING_START_CONFIG_NOT_FOUND', 500);
    return { miningStartedAt: parseMiningStartedAt(config.value) };
  }

  async processFreeMinerHash(data: FreeMinerHashJobData) {
    const hash = data.hash.toLowerCase();
    const event = await this.web3Service.getFreeMinerClaimEvent(hash);
    if (event.account !== data.address.toLowerCase()) {
      throw new CustomException('FREE_MINER_ACCOUNT_MISMATCH', 400);
    }

    const freeMinerConfig = await this.configService.getFreeMinerConfig();
    const cycleConfig = await this.configService.getMinerCycleConfig();
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const rewardPerSecond = (
      (freeMinerConfig.price * freeMinerConfig.cycleRewardBp) /
      10000n /
      BigInt(cycleConfig.initCycle)
    ).toString();

    await this.dataSource.transaction(async (manager) => {
      const { miningStartedAt } = await lockMiningStart(manager);
      const rewardStartAt =
        miningStartedAt === null
          ? null
          : Math.max(event.blockTimestamp, miningStartedAt);
      const accountRepository = manager.getRepository(Account);
      const freeMinerRepository = manager.getRepository(FreeMiner);
      const account = await accountRepository.findOne({
        where: { id: data.accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new CustomException('UNKNOWN_ERROR', 500);
      }
      if (account.address.toLowerCase() !== data.address.toLowerCase()) {
        throw new CustomException('FREE_MINER_ACCOUNT_MISMATCH', 400);
      }

      try {
        await freeMinerRepository.insert({
          accountId: account.id,
          price: freeMinerConfig.price.toString(),
          expectedReward: event.spaceAmount,
          roundRewardBp: Number(freeMinerConfig.cycleRewardBp),
          roundMaxCycle: cycleConfig.maxCycle,
          roundCycleExtension: cycleConfig.minerExtendedPerCycle,
          roundStartedAt: rewardStartAt,
          producedReward: '0',
          claimedReward: '0',
          cycle: cycleConfig.initCycle,
          cycleEndAt:
            rewardStartAt === null
              ? null
              : computeCycleEndAt(rewardStartAt, cycleConfig.initCycle),
          lastRewardAt: rewardStartAt,
          rewardPerSecond,
          createdAt: currentTimestamp,
          hash,
        });
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          this.logger.warn(`免费矿机 hash 或账户已处理，跳过:${hash}`);
          return;
        }

        throw error;
      }
    });
  }

  async getMyMiners(accountId: number) {
    const accountMinerRepository = this.dataSource.getRepository(AccountMiner);
    const accountBalanceLogRepository =
      this.dataSource.getRepository(AccountBalanceLog);

    const list = await accountMinerRepository.find({
      where: {
        accountId,
      },
      relations: {
        miner: true,
      },
    });

    const rewardSums = await accountBalanceLogRepository
      .createQueryBuilder('log')
      .select('log.type', 'type')
      .addSelect('COALESCE(SUM(log.amount), 0)', 'amount')
      .where('log.account_id = :accountId', { accountId })
      .andWhere('log.type IN (:...types)', {
        types: [
          AccountBalanceLogType.MinerReward,
          AccountBalanceLogType.TeamReward,
        ],
      })
      .groupBy('log.type')
      .getRawMany<{ type: AccountBalanceLogType; amount: string }>();

    const rewardMap = new Map(
      rewardSums.map((rewardSum) => [rewardSum.type, rewardSum.amount]),
    );

    const sortedList = list.sort((left, right) => {
      const leftPrice = BigInt(left.miner.price);
      const rightPrice = BigInt(right.miner.price);

      if (leftPrice === rightPrice) {
        return 0;
      }

      return leftPrice > rightPrice ? 1 : -1;
    });

    return {
      list: sortedList,
      minerReward: rewardMap.get(AccountBalanceLogType.MinerReward) ?? '0',
      teamReward: rewardMap.get(AccountBalanceLogType.TeamReward) ?? '0',
    };
  }

  async generatePurchaseMinerSignature(
    accountId: number,
    minerId: string,
    method: PurchaseMethod,
  ) {
    return await this.dataSource.transaction(async (manager) => {
      const accountRepository = manager.getRepository(Account);
      const accountMinerRepository = manager.getRepository(AccountMiner);
      const minerRepository = manager.getRepository(Miner);
      const minerPurchaseSignatureRepository = manager.getRepository(
        MinerPurchaseSignature,
      );
      const accountBalanceLogRepository =
        manager.getRepository(AccountBalanceLog);
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const account = await accountRepository.findOne({
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        // 账户不存在,正常都会存在,属于严重错误
        this.logger.error(`生成购买矿机签名时账户不存在`);
        throw new CustomException('UNKNOWN_ERROR', 500);
      }

      const accountMiner = await accountMinerRepository.findOne({
        where: {
          accountId: account.id,
          minerId: minerId,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        accountMiner &&
        BigInt(accountMiner.producedReward) <
          BigInt(accountMiner.expectedReward)
      ) {
        throw new ConflictException('MINER_NOT_EXPIRED');
      }

      const signedInfo = await minerPurchaseSignatureRepository.findOne({
        where: {
          accountId,
          minerId,
          status: MinerPurchaseSignatureStatus.Pending,
          deadline: MoreThan(currentTimestamp),
        },
        lock: { mode: 'pessimistic_write' },
      });
      const miner = await minerRepository.findOne({
        where: { id: minerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!miner) {
        this.logger.error(`矿机不存在`);
        throw new NotFoundException('MINER_NOT_FOUND');
      }

      if (!miner.isPurchasable) {
        throw new ConflictException('MINER_NOT_PURCHASABLE');
      }

      if (signedInfo) {
        if (signedInfo.method !== method) {
          throw new ConflictException('PENDING_PURCHASE_SIGNATURE_EXISTS');
        }

        return signedInfo;
      }

      let payValue: string;
      if (method == PurchaseMethod.InternalBalance) {
        payValue = '0';
      } else if (method == PurchaseMethod.WalletBalance) {
        payValue = miner.price;
      } else if (method == PurchaseMethod.InternalAndWalletBalance) {
        const minerPrice = BigInt(miner.price);
        const accountBalance = BigInt(account.balance);
        payValue =
          accountBalance >= minerPrice
            ? '0'
            : (minerPrice - accountBalance).toString();
      } else {
        throw new BadRequestException('INVALID_PURCHASE_METHOD');
      }
      const internalValue = BigInt(miner.price) - BigInt(payValue);

      if (BigInt(account.balance) < internalValue) {
        throw new ConflictException('INSUFFICIENT_BALANCE');
      }

      // 预扣余额
      if (internalValue > BigInt(0)) {
        const balanceBefore = account.balance;
        account.balance = (BigInt(account.balance) - internalValue).toString();
        await accountRepository.save(account);
        await accountBalanceLogRepository.save(
          accountBalanceLogRepository.create({
            accountId: account.id,
            type: AccountBalanceLogType.MinerPurchase,
            token: AccountBalanceLogToken.Space,
            amount: (-internalValue).toString(),
            balanceBefore,
            balanceAfter: account.balance,
            createdAt: currentTimestamp,
          }),
        );
      }

      const nonce = randomUUID();
      const deadline = currentTimestamp + 3 * 60;
      const signed = await this.web3Service.signPurchaseMiner(
        account.address,
        minerId,
        miner.price,
        payValue,
        miner.expectedReward,
        nonce,
        deadline,
      );

      let minerPurchaseSignature: MinerPurchaseSignature;
      try {
        minerPurchaseSignature = await minerPurchaseSignatureRepository.save(
          minerPurchaseSignatureRepository.create({
            accountId: account.id,
            buyer: account.address,
            minerId,
            price: miner.price,
            payValue,
            expectedReward: miner.expectedReward,
            method,
            nonce,
            deadline,
            signature: signed.signature,
            status: MinerPurchaseSignatureStatus.Pending,
            createdAt: currentTimestamp,
          }),
        );
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException('RETRY_AFTER_5_MINUTES');
        }

        throw error;
      }

      return minerPurchaseSignature;
    });
  }

  private async purchaseMinerInTransaction(
    manager: EntityManager,
    buyer: string,
    minerId: string,
    expectedReward: string,
  ) {
    const { miningStartedAt } = await lockMiningStart(manager);
    const accountRepository = manager.getRepository(Account);
    const accountMinerRepository = manager.getRepository(AccountMiner);
    const minerRepository = manager.getRepository(Miner);
    const currentTimestamp = Math.floor(Date.now() / 1000);

    const account = await accountRepository.findOne({
      where: { address: buyer },
    });
    if (!account) {
      // 账户不存在,正常都会存在,属于严重错误
      this.logger.error(`购买矿机时账户不存在`);
      throw new CustomException('UNKNOWN_ERROR', 500);
    }

    const miner = await minerRepository.findOne({
      where: { id: minerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!miner) {
      this.logger.error(`矿机不存在`);
      throw new CustomException('UNKNOWN_ERROR', 500);
    }

    const accountMiner = await accountMinerRepository.findOne({
      where: {
        accountId: account.id,
        minerId: minerId,
      },
      lock: { mode: 'pessimistic_write' },
    });

    const cycleConfig = await this.configService.getMinerCycleConfig();
    const rewardStartAt =
      miningStartedAt === null
        ? null
        : Math.max(currentTimestamp, miningStartedAt);

    if (accountMiner) {
      // 复投
      if (
        BigInt(accountMiner.producedReward) <
        BigInt(accountMiner.expectedReward)
      ) {
        this.logger.error(`复投的时候未出局`);
        throw new CustomException('UNKNOWN_ERROR', 500);
      }
      accountMiner.cycle = Math.min(
        accountMiner.cycle + cycleConfig.minerExtendedPerCycle,
        cycleConfig.maxCycle,
      );

      // 修改
      accountMiner.expectedReward = (
        BigInt(accountMiner.expectedReward) + BigInt(expectedReward)
      ).toString();
      accountMiner.cycleEndAt =
        rewardStartAt === null
          ? null
          : computeCycleEndAt(rewardStartAt, accountMiner.cycle);
      accountMiner.lastRewardAt = rewardStartAt;
      accountMiner.rewardPerSecond = (
        (BigInt(miner.price) * cycleConfig.cycleRewardBp) /
        10000n /
        BigInt(accountMiner.cycle)
      ).toString();

      await accountMinerRepository.save(accountMiner);
    } else {
      // 购买
      const cycle = cycleConfig.initCycle;
      try {
        await accountMinerRepository.save(
          accountMinerRepository.create({
            accountId: account.id,
            minerId: minerId,
            expectedReward: expectedReward,
            cycle: cycle,
            cycleEndAt:
              rewardStartAt === null
                ? null
                : computeCycleEndAt(rewardStartAt, cycle),
            lastRewardAt: rewardStartAt,
            rewardPerSecond: (
              (BigInt(miner.price) * cycleConfig.cycleRewardBp) /
              10000n /
              BigInt(cycle)
            ).toString(),
            createdAt: currentTimestamp,
          }),
        );
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          this.logger.error(
            `购买矿机时账户矿机已存在, accountId:${account.id}, minerId:${minerId}`,
          );
          throw new CustomException('INVALID_MINER_STATUS', 500);
        }

        throw error;
      }
    }

    // VIP 等级不在购买后即时局部重算，统一交给全量重算流程处理。
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === '23505'
    );
  }

  async resetCycleAndDistributeRewardTask() {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    await this.dataSource.transaction(async (manager) => {
      const { miningStartedAt } = await lockMiningStart(manager);
      if (miningStartedAt === null) return;
      // 先发放奖励(存储过程)
      await manager.query('CALL distribute_miner_rewards()');
      // 重置周期
      // 1. 查询出未出局并且周期已到的矿机
      // 修改 cycle、cycleEndAt、rewardPerSecond
      const accountMinerRepository = manager.getRepository(AccountMiner);
      const list = await accountMinerRepository
        .createQueryBuilder('am')
        .leftJoinAndSelect('am.miner', 'miner')
        .where('am.produced_reward < am.expected_reward')
        .andWhere('am.cycle_end_at <= :currentTimestamp', { currentTimestamp })
        .getMany();
      const cycleConfig = await this.configService.getMinerCycleConfig();
      for (const accountMiner of list) {
        accountMiner.cycle =
          accountMiner.cycle + cycleConfig.minerExtendedPerCycle;
        accountMiner.cycle =
          accountMiner.cycle > cycleConfig.maxCycle
            ? cycleConfig.maxCycle
            : accountMiner.cycle;

        accountMiner.cycleEndAt = computeCycleEndAt(
          currentTimestamp,
          accountMiner.cycle,
        );
        accountMiner.rewardPerSecond = (
          (BigInt(accountMiner.miner.price) * cycleConfig.cycleRewardBp) /
          10000n /
          BigInt(accountMiner.cycle)
        ).toString();
      }
      await accountMinerRepository.save(list);
    });
  }

  async checkPurchaseMinerSignatureTask() {
    this.logger.log('定时检查购买矿机签名');
    const minerPurchaseSignatureRepository = this.dataSource.getRepository(
      MinerPurchaseSignature,
    );
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const gracePeriod = 2 * 60;
    const list = await minerPurchaseSignatureRepository.find({
      where: {
        status: MinerPurchaseSignatureStatus.Pending,
        deadline: LessThanOrEqual(currentTimestamp - gracePeriod),
      },
      order: {
        deadline: 'ASC',
        id: 'ASC',
      },
    });

    if (list.length === 0) {
      return;
    }

    const latestBlock = await this.web3Service.getLatestBlock();

    const usedResults = await this.web3Service.getPurchaseMinerNoncesUsed(
      list.map((minerPurchaseSignature) => minerPurchaseSignature.nonce),
      latestBlock.number,
    );

    for (const [index, minerPurchaseSignature] of list.entries()) {
      try {
        const isUsed = usedResults[index];
        if (
          !isUsed &&
          latestBlock.timestamp <= BigInt(minerPurchaseSignature.deadline)
        ) {
          continue;
        }
        await this.processPurchaseMinerSignature(
          minerPurchaseSignature,
          isUsed,
          currentTimestamp,
        );
      } catch (error) {
        this.logger.error(
          `处理购买矿机签名失败 nonce=${minerPurchaseSignature.nonce}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  async processPurchaseMinerSignatureNonce(nonce: string) {
    const minerPurchaseSignatureRepository = this.dataSource.getRepository(
      MinerPurchaseSignature,
    );
    const minerPurchaseSignature =
      await minerPurchaseSignatureRepository.findOne({
        where: {
          nonce,
          status: MinerPurchaseSignatureStatus.Pending,
        },
      });

    if (!minerPurchaseSignature) {
      this.logger.warn(`购买矿机签名不存在或已处理, nonce:${nonce}`);
      return;
    }

    let [isUsed] = await this.web3Service.getPurchaseMinerNoncesUsed([nonce]);
    if (!isUsed) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      [isUsed] = await this.web3Service.getPurchaseMinerNoncesUsed([nonce]);
    }

    if (isUsed) {
      await this.processPurchaseMinerSignature(
        minerPurchaseSignature,
        isUsed,
        Math.floor(Date.now() / 1000),
      );
    } else {
      this.logger.log(`购买矿机 nonce 未使用，保持待确认, nonce:${nonce}`);
    }
  }

  private async processPurchaseMinerSignature(
    minerPurchaseSignature: MinerPurchaseSignature,
    isUsed: boolean,
    currentTimestamp: number,
  ) {
    if (isUsed) {
      await this.dataSource.transaction(async (manager) => {
        const signatureRepository = manager.getRepository(
          MinerPurchaseSignature,
        );
        const pendingSignature = await signatureRepository.findOne({
          where: {
            id: minerPurchaseSignature.id,
            status: MinerPurchaseSignatureStatus.Pending,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!pendingSignature) {
          return;
        }

        pendingSignature.status = MinerPurchaseSignatureStatus.Used;
        await signatureRepository.save(pendingSignature);
        await this.purchaseMinerInTransaction(
          manager,
          pendingSignature.buyer,
          pendingSignature.minerId,
          pendingSignature.expectedReward,
        );
      });
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const accountRepository = manager.getRepository(Account);
      const accountBalanceLogRepository =
        manager.getRepository(AccountBalanceLog);
      const signatureRepository = manager.getRepository(MinerPurchaseSignature);
      const pendingSignature = await signatureRepository.findOne({
        where: {
          id: minerPurchaseSignature.id,
          status: MinerPurchaseSignatureStatus.Pending,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!pendingSignature) {
        return;
      }

      const refundAmount =
        BigInt(pendingSignature.price) - BigInt(pendingSignature.payValue);
      if (refundAmount > 0n) {
        const account = await accountRepository.findOne({
          where: {
            id: pendingSignature.accountId,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!account) {
          this.logger.error(
            `购买矿机签名退款时账户不存在, signatureId:${pendingSignature.id}`,
          );
          throw new CustomException('UNKNOWN_ERROR', 500);
        }

        const balanceBefore = account.balance;
        account.balance = (BigInt(account.balance) + refundAmount).toString();
        await accountRepository.save(account);
        await accountBalanceLogRepository.save(
          accountBalanceLogRepository.create({
            accountId: account.id,
            type: AccountBalanceLogType.MinerPurchaseRefund,
            token: AccountBalanceLogToken.Space,
            amount: refundAmount.toString(),
            balanceBefore,
            balanceAfter: account.balance,
            createdAt: currentTimestamp,
          }),
        );
      }

      pendingSignature.status = MinerPurchaseSignatureStatus.Unused;
      await signatureRepository.save(pendingSignature);
    });
  }
}

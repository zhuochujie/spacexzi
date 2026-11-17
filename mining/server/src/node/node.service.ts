import {
  AccountBalanceLog,
  AccountBalanceLogToken,
  AccountBalanceLogType,
} from 'src/account/entities/account-balance-log.entity';
import { ConfigService } from 'src/config/config.service';
import { allocateNodeMakerSlots } from './node-maker-slots';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource, MoreThan } from 'typeorm';
import { Account } from 'src/account/entities/account.entity';
import { AccountRelation } from 'src/account/entities/account-relation.entity';
import { NodePurchaseSignature, NodeRewardLog } from './node.entities';
import { NodeWeb3Service } from './node-web3.service';

@Injectable()
export class NodeService {
  private readonly logger = new Logger(NodeService.name);
  constructor(
    private readonly db: DataSource,
    private readonly chain: NodeWeb3Service,
    @InjectQueue('node-queue') private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}
  private now() {
    return Math.floor(Date.now() / 1000);
  }
  private assertDeployment(record: {
    chainId: number;
    contractAddress: string;
  }) {
    if (
      record.chainId !== this.chain.chainId ||
      record.contractAddress.toLowerCase() !==
        this.chain.contractAddress.toLowerCase()
    )
      throw new Error('NODE_DEPLOYMENT_MISMATCH');
  }
  private async account(accountId: number) {
    const account = await this.db
      .getRepository(Account)
      .findOneBy({ id: accountId });
    if (!account) throw new NotFoundException('ACCOUNT_NOT_FOUND');
    return account;
  }
  async pendingPurchase(accountId: number) {
    return this.db.getRepository(NodePurchaseSignature).findOneBy({
      accountId,
      status: 'pending',
    });
  }
  async referralStats(accountId: number) {
    const account = await this.account(accountId);
    const [totals, stats] = await Promise.all([
      this.db.query<Array<{ totalReward: string }>>(
        `SELECT COALESCE(SUM(amount), 0)::text AS "totalReward" FROM node_reward_log WHERE account_id = $1 AND type = 'reward'`,
        [accountId],
      ),
      this.db.query<
        Array<{
          directCount: number;
          teamCount: number;
          directPerformance: string;
          teamPerformance: string;
        }>
      >(
        `SELECT COUNT(*) FILTER (WHERE r.level = 1)::int AS "directCount", COUNT(*)::int AS "teamCount",
        COALESCE(SUM(p.amount) FILTER (WHERE r.level = 1), 0)::text AS "directPerformance", COALESCE(SUM(p.amount), 0)::text AS "teamPerformance"
        FROM account_relation r LEFT JOIN (SELECT account_id, SUM(amount) AS amount FROM node_purchase_signature WHERE status = 'used' GROUP BY account_id) p ON p.account_id = r.subordinate_id WHERE r.superior_id = $1`,
        [accountId],
      ),
    ]);
    return {
      usdtBalance: account.usdtBalance,
      totalReward: totals[0].totalReward,
      ...stats[0],
    };
  }
  async purchase(accountId: number, targetLevelIndex: number) {
    return this.db.transaction(async (manager) => {
      const account = await manager.findOne(Account, {
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw new NotFoundException('ACCOUNT_NOT_FOUND');
      const existing = await manager.findOneBy(NodePurchaseSignature, {
        accountId,
        status: 'pending',
      });
      if (existing) {
        this.assertDeployment(existing);
        if (
          existing.targetLevelIndex !== targetLevelIndex ||
          existing.deadline <= this.now()
        )
          throw new ConflictException('NODE_PURCHASE_PENDING');
        return existing;
      }
      const snapshot = await this.chain.snapshot(account.address);
      if (snapshot.paused)
        throw new BadRequestException('NODE_PURCHASE_PAUSED');
      const target = snapshot.levels[targetLevelIndex];
      if (!target?.enabled || targetLevelIndex + 1 <= snapshot.level)
        throw new BadRequestException('NODE_INVALID_LEVEL');
      const amount =
        target.price -
        (snapshot.level > 0 ? snapshot.levels[snapshot.level - 1].price : 0n);
      if (amount <= 0n) throw new BadRequestException('NODE_INVALID_LEVEL');
      const parent = await manager.findOneBy(AccountRelation, {
        subordinateId: accountId,
        level: 1,
      });
      const rewardBp = await this.configService.getNodeReferralRewardBp();
      const input: Omit<NodePurchaseSignature, 'id' | 'signature' | 'status'> =
        {
          accountId,
          buyer: account.address,
          action: snapshot.level === 0 ? 'purchase' : 'upgrade',
          fromLevel: snapshot.level,
          targetLevelIndex,
          amount: amount.toString(),
          rewardAmount: ((amount * rewardBp) / 10000n).toString(),
          beneficiaryAccountId: parent?.superiorId ?? null,
          nonce: randomUUID(),
          deadline: this.now() + 180,
          createdAt: this.now(),
          chainId: this.chain.chainId,
          contractAddress: this.chain.contractAddress,
        };
      const signature = await this.chain.signPurchase(input);
      return manager.save(NodePurchaseSignature, {
        ...input,
        signature,
        status: 'pending',
      });
    });
  }
  async nonceStatus(accountId: number, nonce: string) {
    const record = await this.db
      .getRepository(NodePurchaseSignature)
      .findOneBy({ accountId, nonce });
    if (!record) throw new NotFoundException('NODE_SIGNATURE_NOT_FOUND');
    return { nonce: record.nonce, status: record.status };
  }
  async submitNonce(accountId: number, nonce: string) {
    await this.nonceStatus(accountId, nonce);
    await this.queue.add('purchase', nonce, {
      jobId: `node-${nonce}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    });
    return { nonce };
  }
  async processNonce(nonce: string) {
    const record = await this.db
      .getRepository(NodePurchaseSignature)
      .findOneBy({ nonce, status: 'pending' });
    if (!record) return;
    this.assertDeployment(record);
    const block = await this.chain.confirmedBlock();
    const [used] = await this.chain.purchaseNonces([nonce], block.number);
    await this.settlePurchase(record, used, block.timestamp);
  }
  async settlePurchase(
    record: NodePurchaseSignature,
    used: boolean,
    timestamp: bigint,
  ) {
    if (typeof used !== 'boolean') throw new Error('NODE_NONCE_RESULT_MISSING');
    if (!used && timestamp <= BigInt(record.deadline)) return;
    if (used) await this.chain.assertRewardReceiver();
    await this.db.transaction(async (manager) => {
      const pending = await manager.findOne(NodePurchaseSignature, {
        where: { id: record.id, status: 'pending' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!pending) return;
      this.assertDeployment(pending);
      pending.status = used ? 'used' : 'unused';
      await manager.save(pending);
      if (!used) return;
      await allocateNodeMakerSlots(
        manager,
        pending,
        pending.targetLevelIndex + 1,
      );
      if (pending.beneficiaryAccountId !== null) {
        const beneficiary = await manager.findOne(Account, {
          where: { id: pending.beneficiaryAccountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!beneficiary) throw new NotFoundException('ACCOUNT_NOT_FOUND');
        const before = beneficiary.usdtBalance;
        beneficiary.usdtBalance = (
          BigInt(before) + BigInt(pending.rewardAmount)
        ).toString();
        await manager.save(beneficiary);
        await manager.save(AccountBalanceLog, {
          accountId: beneficiary.id,
          type: AccountBalanceLogType.NodeReferralReward,
          token: AccountBalanceLogToken.Usdt,
          amount: pending.rewardAmount,
          balanceBefore: before,
          balanceAfter: beneficiary.usdtBalance,
          createdAt: this.now(),
        });
        await manager.save(NodeRewardLog, {
          accountId: beneficiary.id,
          purchaseSignatureId: pending.id,
          type: 'reward',
          amount: pending.rewardAmount,
          beforeBalance: before,
          afterBalance: beneficiary.usdtBalance,
          createdAt: this.now(),
        });
      }
      await manager
        .createQueryBuilder()
        .update(Account)
        .set({ nodeLevel: () => 'GREATEST(node_level, :level)' })
        .where('id = :id', {
          id: pending.accountId,
          level: pending.targetLevelIndex + 1,
        })
        .execute();
    });
  }
  async reconcile() {
    const block = await this.chain.confirmedBlock();
    let cursor = 0;
    for (;;) {
      const records = await this.db.getRepository(NodePurchaseSignature).find({
        where: { status: 'pending', id: MoreThan(cursor) },
        order: { id: 'ASC' },
        take: 100,
      });
      if (!records.length) break;
      cursor = records[records.length - 1].id;
      for (const record of records) this.assertDeployment(record);
      const results = await this.chain.purchaseNonces(
        records.map((record) => record.nonce),
        block.number,
      );
      for (const [index, record] of records.entries()) {
        try {
          await this.settlePurchase(record, results[index], block.timestamp);
        } catch (error) {
          this.logger.error(
            `Node purchase reconciliation failed id=${record.id}`,
            error,
          );
        }
      }
    }
  }
  async list(
    kind: 'purchases' | 'rewards',
    page: number,
    pageSize: number,
    accountId?: number,
  ) {
    const entity = kind === 'purchases' ? NodePurchaseSignature : NodeRewardLog;
    const repo = this.db.getRepository(entity);
    const [list, total] = await repo.findAndCount({
      where: accountId === undefined ? {} : { accountId },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }
  async retry(id: number) {
    const record = await this.db
      .getRepository(NodePurchaseSignature)
      .findOneBy({ id });
    if (!record) throw new NotFoundException('NODE_SIGNATURE_NOT_FOUND');
    await this.queue.add('purchase', record.nonce, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    });
    return { id };
  }
}

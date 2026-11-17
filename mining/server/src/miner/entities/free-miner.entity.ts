import { Account } from 'src/account/entities/account.entity';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
@Index(['accountId'], { unique: true })
@Index(['hash'], { unique: true })
@Index(['lastRewardAt'])
export class FreeMiner {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  accountId!: number;

  @Column({ type: 'numeric', precision: 28, scale: 0 })
  price!: string;

  // 预期奖励
  @Column({ type: 'numeric', precision: 28, scale: 0 })
  expectedReward!: string;

  // 已产出奖励
  @Column({ type: 'numeric', precision: 28, scale: 0, default: 0 })
  producedReward!: string;

  // 已提取奖励
  @Column({ type: 'numeric', precision: 28, scale: 0, default: 0 })
  claimedReward!: string;

  @Column({ type: 'integer' })
  cycle!: number;

  // 当前周期结束时间
  @Column({ type: 'integer', nullable: true })
  cycleEndAt!: number | null;

  // 上一次奖励的时间
  @Column({ type: 'integer', nullable: true })
  lastRewardAt!: number | null;

  // 每秒奖励
  @Column({ type: 'numeric', precision: 28, scale: 0 })
  rewardPerSecond!: string;

  @Column({ type: 'integer' })
  createdAt!: number;

  @ManyToOne(() => Account, {
    onDelete: 'CASCADE',
  })
  account!: Account;

  @Column({ length: 66 })
  hash!: string;

  @Column({ type: 'integer', nullable: true })
  roundStartedAt!: number | null;

  @Column({ type: 'numeric', precision: 28, scale: 0 })
  nonWithdrawableReward!: string;
  // Immutable for this round; refreshed only after the current reward is claimed.
  @Column({ type: 'integer' }) roundRewardBp!: number;
  @Column({ type: 'integer' }) roundMaxCycle!: number;
  @Column({ type: 'integer' }) roundCycleExtension!: number;
}

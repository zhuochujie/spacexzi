import { Account } from 'src/account/entities/account.entity';
import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
@Check('node_purchase_action_check', "\"action\" IN ('purchase', 'upgrade')")
@Check(
  'node_purchase_status_check',
  "\"status\" IN ('pending', 'used', 'unused')",
)
@Check(
  'node_purchase_values_check',
  '"target_level_index" >= 0 AND "amount" > 0 AND "reward_amount" >= 0',
)
@Index(['accountId'], { unique: true, where: `"status" = 'pending'` })
@Index(['status', 'deadline'])
@Index(['chainId', 'contractAddress', 'targetLevelIndex', 'createdAt', 'id'], {
  where: `"status" = 'used'`,
})
export class NodePurchaseSignature {
  @PrimaryGeneratedColumn() id!: number;
  @Column() accountId!: number;
  @Column({ length: 42 }) buyer!: string;
  @Column() chainId!: number;
  @Column({ length: 42 }) contractAddress!: string;
  @Column() action!: 'purchase' | 'upgrade';
  @Column() fromLevel!: number;
  @Column() targetLevelIndex!: number;
  @Column({ type: 'numeric', precision: 78, scale: 0 }) amount!: string;
  @Column({ type: 'numeric', precision: 78, scale: 0 }) rewardAmount!: string;
  @Column({ type: 'integer', nullable: true }) beneficiaryAccountId!:
    | number
    | null;
  @Column({ unique: true }) nonce!: string;
  @Column() deadline!: number;
  @Column({ length: 132 }) signature!: string;
  @Column({ default: 'pending' }) status!: 'pending' | 'used' | 'unused';
  @Column() createdAt!: number;
  @ManyToOne(() => Account, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account?: Account;
  @ManyToOne(() => Account, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'beneficiary_account_id' })
  beneficiary?: Account | null;
}

@Entity()
@Check(
  'node_reward_values_check',
  '"type" = \'reward\' AND "amount" >= 0 AND "before_balance" >= 0 AND "after_balance" >= 0',
)
@Index(['purchaseSignatureId', 'accountId'], { unique: true })
@Index(['accountId', 'id'])
export class NodeRewardLog {
  @PrimaryGeneratedColumn() id!: number;
  @Column() accountId!: number;
  @Column() purchaseSignatureId!: number;
  @Column() type!: 'reward';
  @Column({ type: 'numeric', precision: 78, scale: 0 }) amount!: string;
  @Column({ type: 'numeric', precision: 78, scale: 0 }) beforeBalance!: string;
  @Column({ type: 'numeric', precision: 78, scale: 0 }) afterBalance!: string;
  @Column() createdAt!: number;
  @ManyToOne(() => Account, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account?: Account;
  @ManyToOne(() => NodePurchaseSignature, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'purchase_signature_id' })
  purchaseSignature?: NodePurchaseSignature;
}

@Entity()
@Check('node_maker_slot_range_check', '"level" > 0 AND "slot" BETWEEN 1 AND 30')
@Index(['chainId', 'contractAddress', 'level', 'accountId'], { unique: true })
export class NodeMarketMakerSlot {
  @PrimaryColumn() chainId!: number;
  @PrimaryColumn({ length: 42 }) contractAddress!: string;
  @PrimaryColumn() level!: number;
  @PrimaryColumn() slot!: number;
  @Column() accountId!: number;
  @Column() purchaseSignatureId!: number;
  @Column() createdAt!: number;
  @ManyToOne(() => Account, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account?: Account;
  @ManyToOne(() => NodePurchaseSignature, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'purchase_signature_id' })
  purchaseSignature?: NodePurchaseSignature;
}

export const nodeEntities = [
  NodeMarketMakerSlot,
  NodePurchaseSignature,
  NodeRewardLog,
];

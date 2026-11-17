import { nodeEntities } from 'src/node/node.entities';
import { AccountBalanceLog } from 'src/account/entities/account-balance-log.entity';
import { AccountRelation } from 'src/account/entities/account-relation.entity';
import { AccountWithdrawSignature } from 'src/account/entities/account-withdraw-signature.entity';
import { Account } from 'src/account/entities/account.entity';
import { MarketMakerWhitelist } from 'src/account/entities/market-maker-whitelist.entity';
import { DividendLevelStat } from 'src/account/entities/dividend-level-stat.entity';
import { AdminUser } from 'src/admin-auth/entities/admin-user.entity';
import { Config } from 'src/config/entities/config.entity';
import { DividendRule } from 'src/config/entities/dividend-rule.entity';
import { AccountMiner } from 'src/miner/entities/account-miner.entity';
import { FreeMiner } from 'src/miner/entities/free-miner.entity';
import { MinerPurchaseSignature } from 'src/miner/entities/miner-purchase-signature.entity';
import { Miner } from 'src/miner/entities/miner.entity';
import { Notice } from 'src/notice/entities/Notice.entity';

export const databaseEntities = [
  ...nodeEntities,
  Account,
  MarketMakerWhitelist,
  AccountRelation,
  AccountBalanceLog,
  AccountWithdrawSignature,
  DividendLevelStat,
  AdminUser,
  Config,
  DividendRule,
  Miner,
  AccountMiner,
  MinerPurchaseSignature,
  FreeMiner,
  Notice,
];

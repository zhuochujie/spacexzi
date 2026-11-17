import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CustomException } from 'src/common/custom.exception';
import { Config } from './entities/config.entity';
import {
  DividendRule,
  DividendRuleCategory,
} from './entities/dividend-rule.entity';
import { AccountBalanceLogToken } from 'src/account/entities/account-balance-log.entity';

@Injectable()
export class ConfigService {
  static readonly NODE_REFERRAL_REWARD_BP_KEY = 'NODE_REFERRAL_REWARD_BP';
  static readonly VIP_FEE_BP_KEY = 'VIP_FEE_BP';
  static readonly NODE_FEE_BP_KEY = 'NODE_FEE_BP';
  static readonly INIT_CYCLE_SECONDS_KEY = 'INIT_CYCLE_SECONDS';
  static readonly MINING_STARTED_AT_KEY = 'MINING_STARTED_AT';
  static readonly MAX_CYCLE_SECONDS_KEY = 'MAX_CYCLE_SECONDS';
  static readonly MINER_EXTENDED_PER_CYCLE_SECONDS_KEY =
    'MINER_EXTENDED_PER_CYCLE_SECONDS';
  static readonly CYCLE_REWARD_BP_KEY = 'CYCLE_REWARD_BP';
  static readonly FEE_EXEMPT_MIN_NODE_LEVEL_KEY = 'FEE_EXEMPT_MIN_NODE_LEVEL';
  static readonly FEE_EXEMPT_MIN_VIP_LEVEL_KEY = 'FEE_EXEMPT_MIN_VIP_LEVEL';
  static readonly USDT_DIVIDEND_FEE_BP_KEY = 'USDT_DIVIDEND_FEE_BP';
  static readonly COMMISSION_MID_MINER_PRICE_WEI_KEY =
    'COMMISSION_MID_MINER_PRICE_WEI';
  static readonly COMMISSION_HIGH_MINER_PRICE_WEI_KEY =
    'COMMISSION_HIGH_MINER_PRICE_WEI';
  static readonly TEAM_REWARD_BP_KEY = 'TEAM_REWARD_BP';
  static readonly VIP_V1_MARKET_THRESHOLD_WEI_KEY =
    'VIP_V1_MARKET_THRESHOLD_WEI';
  static readonly FREE_MINER_PRICE_WEI_KEY = 'FREE_MINER_PRICE_WEI';
  static readonly FREE_MINER_CYCLE_REWARD_BP_KEY = 'FREE_MINER_CYCLE_REWARD_BP';
  static readonly FREE_MINER_CAN_INVITE_KEY = 'FREE_MINER_CAN_INVITE';

  constructor(
    @InjectRepository(Config)
    private readonly configRepository: Repository<Config>,
    @InjectRepository(DividendRule)
    private readonly dividendRuleRepository: Repository<DividendRule>,
  ) {}

  async initializeDefaults() {
    const configs = this.getDefaultConfigs();
    await this.configRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'initialize_default_configs',
      ]);

      const configRepository = manager.getRepository(Config);
      // 首页节点卡片永久显示，清理之前的展示开关。
      await configRepository.delete({
        key: In([
          'NODE_HOME_ENTRY_ENABLED',
          'NODE_HOME_FLOATING_ENTRY_ENABLED',
        ]),
      });
      const existingConfigs = await configRepository.find({
        where: { key: In(configs.map((config) => config.key)) },
        select: {
          key: true,
        },
      });
      const existingConfigKeys = new Set(
        existingConfigs.map((config) => config.key),
      );
      const missingConfigs = configs.filter(
        (config) => !existingConfigKeys.has(config.key),
      );

      if (missingConfigs.length > 0) {
        await configRepository.insert(missingConfigs);
      }

      await this.initDividendRules(manager);
    });
  }

  async getNodeReferralRewardBp() {
    const config = await this.configRepository.findOneBy({
      key: ConfigService.NODE_REFERRAL_REWARD_BP_KEY,
    });
    return this.parseBp(
      ConfigService.NODE_REFERRAL_REWARD_BP_KEY,
      config?.value,
    );
  }

  async getWithdrawFeeBps() {
    const configs = await this.configRepository.find({
      where: {
        key: In([ConfigService.VIP_FEE_BP_KEY, ConfigService.NODE_FEE_BP_KEY]),
      },
    });
    const configMap = new Map(
      configs.map((config) => [config.key, config.value]),
    );
    const vipFeeBp = this.parseBp(
      ConfigService.VIP_FEE_BP_KEY,
      configMap.get(ConfigService.VIP_FEE_BP_KEY),
    );
    const nodeFeeBp = this.parseBp(
      ConfigService.NODE_FEE_BP_KEY,
      configMap.get(ConfigService.NODE_FEE_BP_KEY),
    );

    if (vipFeeBp + nodeFeeBp > 10000n) {
      throw new CustomException('INVALID_WITHDRAW_FEE_CONFIG', 500);
    }

    return {
      vipFeeBp,
      nodeFeeBp,
    };
  }

  async getMinerCycleConfig() {
    const configMap = await this.getConfigMap([
      ConfigService.INIT_CYCLE_SECONDS_KEY,
      ConfigService.MAX_CYCLE_SECONDS_KEY,
      ConfigService.MINER_EXTENDED_PER_CYCLE_SECONDS_KEY,
      ConfigService.CYCLE_REWARD_BP_KEY,
    ]);

    return {
      initCycle: this.parsePositiveInteger(
        ConfigService.INIT_CYCLE_SECONDS_KEY,
        configMap.get(ConfigService.INIT_CYCLE_SECONDS_KEY),
      ),
      maxCycle: this.parsePositiveInteger(
        ConfigService.MAX_CYCLE_SECONDS_KEY,
        configMap.get(ConfigService.MAX_CYCLE_SECONDS_KEY),
      ),
      minerExtendedPerCycle: this.parsePositiveInteger(
        ConfigService.MINER_EXTENDED_PER_CYCLE_SECONDS_KEY,
        configMap.get(ConfigService.MINER_EXTENDED_PER_CYCLE_SECONDS_KEY),
      ),
      cycleRewardBp: this.parseBp(
        ConfigService.CYCLE_REWARD_BP_KEY,
        configMap.get(ConfigService.CYCLE_REWARD_BP_KEY),
      ),
    };
  }

  async getMarketMakerEligibilityConfig() {
    const configMap = await this.getConfigMap([
      ConfigService.FEE_EXEMPT_MIN_NODE_LEVEL_KEY,
      ConfigService.FEE_EXEMPT_MIN_VIP_LEVEL_KEY,
    ]);

    return {
      nodeLevel: this.parsePositiveInteger(
        ConfigService.FEE_EXEMPT_MIN_NODE_LEVEL_KEY,
        configMap.get(ConfigService.FEE_EXEMPT_MIN_NODE_LEVEL_KEY),
      ),
      vipLevel: this.parsePositiveInteger(
        ConfigService.FEE_EXEMPT_MIN_VIP_LEVEL_KEY,
        configMap.get(ConfigService.FEE_EXEMPT_MIN_VIP_LEVEL_KEY),
      ),
    };
  }

  async getUsdtDividendFeeBp() {
    const config = await this.configRepository.findOne({
      where: { key: ConfigService.USDT_DIVIDEND_FEE_BP_KEY },
    });

    return this.parseBp(ConfigService.USDT_DIVIDEND_FEE_BP_KEY, config?.value);
  }

  async getFreeMinerConfig() {
    const configMap = await this.getConfigMap([
      ConfigService.FREE_MINER_PRICE_WEI_KEY,
      ConfigService.FREE_MINER_CYCLE_REWARD_BP_KEY,
    ]);

    return {
      price: this.parsePositiveBigInt(
        ConfigService.FREE_MINER_PRICE_WEI_KEY,
        configMap.get(ConfigService.FREE_MINER_PRICE_WEI_KEY),
      ),
      cycleRewardBp: this.parseBp(
        ConfigService.FREE_MINER_CYCLE_REWARD_BP_KEY,
        configMap.get(ConfigService.FREE_MINER_CYCLE_REWARD_BP_KEY),
      ),
    };
  }

  async getFreeMinerCanInvite() {
    const config = await this.configRepository.findOne({
      where: { key: ConfigService.FREE_MINER_CAN_INVITE_KEY },
    });

    return this.parseBooleanLike(
      ConfigService.FREE_MINER_CAN_INVITE_KEY,
      config?.value,
    );
  }

  async getDividendRules(
    category: DividendRuleCategory,
    token: AccountBalanceLogToken,
  ) {
    const rules = await this.dividendRuleRepository.find({
      where: {
        category,
        token,
      },
      order: {
        level: 'ASC',
      },
    });

    return rules.map((rule) => ({
      level: rule.level,
      bp: BigInt(rule.bp),
    }));
  }

  private getDefaultConfigs(): Array<
    Pick<Config, 'key' | 'value' | 'desc' | 'isAdminEditable'>
  > {
    return [
      {
        key: ConfigService.VIP_FEE_BP_KEY,
        value: '1200',
        desc: '提现时给 VIP 的手续费分红比例，单位 BP，10000 表示 100%；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.NODE_FEE_BP_KEY,
        value: '300',
        desc: '提现时给节点的手续费分红比例，单位 BP，10000 表示 100%；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.INIT_CYCLE_SECONDS_KEY,
        value: (30 * 86400).toString(),
        desc: '矿机初始周期，单位秒；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.MINING_STARTED_AT_KEY,
        value: 'null',
        desc: '实际统一产币启动时间，null 表示待启动；仅可通过后台开启产币操作设置一次',
        isAdminEditable: false,
      },
      {
        key: ConfigService.MAX_CYCLE_SECONDS_KEY,
        value: (120 * 86400).toString(),
        desc: '矿机最大周期，单位秒；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.MINER_EXTENDED_PER_CYCLE_SECONDS_KEY,
        value: (10 * 86400).toString(),
        desc: '矿机周期到期后每次延长时间，单位秒；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.CYCLE_REWARD_BP_KEY,
        value: '4000',
        desc: '矿机周期奖励比例，单位 BP，10000 表示 100%；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.FEE_EXEMPT_MIN_NODE_LEVEL_KEY,
        value: '4',
        desc: '申请做市商要求的节点等级，账户等级必须等于该值且获得该等级前30名成功签名购买者资格；VIP与白名单通道独立',
        isAdminEditable: true,
      },
      {
        key: ConfigService.FEE_EXEMPT_MIN_VIP_LEVEL_KEY,
        value: '3',
        desc: '申请做市商所需最低有效 VIP 等级；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.USDT_DIVIDEND_FEE_BP_KEY,
        value: '1000',
        desc: 'USDT 分红手续费比例，单位 BP，10000 表示 100%；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.COMMISSION_MID_MINER_PRICE_WEI_KEY,
        value: '1000000000000000000000',
        desc: '佣金等级中价值直推矿机价格门槛，单位 wei；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.COMMISSION_HIGH_MINER_PRICE_WEI_KEY,
        value: '3000000000000000000000',
        desc: '佣金等级高价值直推矿机价格门槛，单位 wei；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.NODE_REFERRAL_REWARD_BP_KEY,
        value: '1500',
        desc: '节点推荐奖励比例，单位 BP，1500 表示 15%，范围 0–10000；只影响新生成的购买/升级签名，已有签名保持原金额',
        isAdminEditable: true,
      },
      {
        key: ConfigService.TEAM_REWARD_BP_KEY,
        value: '1000',
        desc: '团队奖励比例，单位 BP，10000 表示 100%；修改后只影响后续矿机奖励发放产生的团队奖励',
        isAdminEditable: true,
      },
      {
        key: ConfigService.VIP_V1_MARKET_THRESHOLD_WEI_KEY,
        value: '10000000000000000000000',
        desc: 'VIP1 直推市场业绩门槛，单位 wei；',
        isAdminEditable: true,
      },

      {
        key: ConfigService.FREE_MINER_PRICE_WEI_KEY,
        value: '10000000000000000000',
        desc: '免费矿机收益计算本金，单位 wei；已有免费矿机 price 和 rewardPerSecond 不会自动重算，不建议在已有用户领取后修改',
        isAdminEditable: false,
      },
      {
        key: ConfigService.FREE_MINER_CYCLE_REWARD_BP_KEY,
        value: '4000',
        desc: '免费矿机周期奖励比例，单位 BP，10000 表示 100%；',
        isAdminEditable: true,
      },
      {
        key: ConfigService.FREE_MINER_CAN_INVITE_KEY,
        value: '1',
        desc: '免费矿机是否可以邀请，1 表示可以，0 表示不可以；付费矿机邀请不受影响',
        isAdminEditable: true,
      },
    ];
  }

  private async initDividendRules(manager: EntityManager) {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const rules = [
      ...[7000, 1800, 800, 300, 100].map((bp, index) => ({
        category: DividendRuleCategory.Buyback,
        token: AccountBalanceLogToken.Usdt,
        level: index + 1,
        bp,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      })),
      {
        category: DividendRuleCategory.Vip,
        token: AccountBalanceLogToken.Space,
        level: 1,
        bp: 3000,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      },
      {
        category: DividendRuleCategory.Vip,
        token: AccountBalanceLogToken.Space,
        level: 2,
        bp: 2500,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      },
      {
        category: DividendRuleCategory.Vip,
        token: AccountBalanceLogToken.Space,
        level: 3,
        bp: 2000,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      },
      {
        category: DividendRuleCategory.Vip,
        token: AccountBalanceLogToken.Space,
        level: 4,
        bp: 1500,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      },
      {
        category: DividendRuleCategory.Vip,
        token: AccountBalanceLogToken.Space,
        level: 5,
        bp: 1000,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      },
    ];
    const dividendRuleRepository = manager.getRepository(DividendRule);
    const existingRules = await dividendRuleRepository.find({
      where: rules.map((rule) => ({
        category: rule.category,
        token: rule.token,
        level: rule.level,
      })),
      select: {
        category: true,
        token: true,
        level: true,
      },
    });
    const existingRuleKeys = new Set(
      existingRules.map(
        (rule) => `${rule.category}:${rule.token}:${rule.level}`,
      ),
    );
    const missingRules = rules.filter(
      (rule) =>
        !existingRuleKeys.has(`${rule.category}:${rule.token}:${rule.level}`),
    );

    if (missingRules.length > 0) {
      await dividendRuleRepository.insert(missingRules);
    }
  }

  private async getConfigMap(keys: string[]) {
    const configs = await this.configRepository.find({
      where: { key: In(keys) },
    });

    return new Map(configs.map((config) => [config.key, config.value]));
  }

  private parseBp(key: string, value?: string) {
    if (value === undefined) {
      throw new CustomException('CONFIG_NOT_FOUND', 500);
    }

    if (!/^\d+$/.test(value)) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    const bp = BigInt(value);
    if (bp > 10000n) {
      throw new CustomException('CONFIG_EXCEEDS_LIMIT', 500);
    }

    return bp;
  }

  private parsePositiveInteger(key: string, value?: string) {
    if (value === undefined) {
      throw new CustomException('CONFIG_NOT_FOUND', 500);
    }

    if (!/^\d+$/.test(value)) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    return parsed;
  }

  private parseNonNegativeInteger(key: string, value?: string) {
    if (value === undefined) {
      throw new CustomException('CONFIG_NOT_FOUND', 500);
    }

    if (!/^\d+$/.test(value)) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    return parsed;
  }

  private parsePositiveBigInt(key: string, value?: string) {
    if (value === undefined) {
      throw new CustomException('CONFIG_NOT_FOUND', 500);
    }

    if (!/^\d+$/.test(value)) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new CustomException('INVALID_CONFIG_FORMAT', 500);
    }

    return parsed;
  }

  private parseBooleanLike(key: string, value?: string) {
    if (value === undefined) {
      throw new CustomException('CONFIG_NOT_FOUND', 500);
    }

    if (value === '1') {
      return true;
    }

    if (value === '0') {
      return false;
    }

    throw new CustomException('INVALID_CONFIG_FORMAT', 500);
  }
}

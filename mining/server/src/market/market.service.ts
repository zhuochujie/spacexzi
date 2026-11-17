import {
  DividendRule,
  DividendRuleCategory,
} from 'src/config/entities/dividend-rule.entity';
import { AccountBalanceLogToken } from 'src/account/entities/account-balance-log.entity';
import { shanghaiWeekStart, WEEK_SECONDS } from 'src/common/week.util';
import { buybackPool } from 'src/web3/constants';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  PayloadTooLargeException,
} from '@nestjs/common';
import { requiredEnv } from 'src/common/env.util';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import {
  MarketOrderSide,
  OpenOrdersQueryDto,
} from './dto/open-orders-query.dto';
import {
  MARKET_REDIS,
  MARKET_TRADE_VOLUME_ADJUSTMENT_REDIS_KEY,
} from './market.constants';

type MarketOrder = {
  id: string;
  maker: string;
  side: 'buy' | 'sell';
  spaceAmount: string;
  remainingSpaceAmount: string;
  price: string;
  status: 'open' | 'filled' | 'cancelled';
  visible: boolean;
  transactionHash: string;
  logIndex: number;
  createdAt: number;
};

type MarketOrderPage = {
  items: MarketOrder[];
  total: number;
  page: number;
  pageSize: number;
};

type MarketIndexerResponse<T> = {
  success?: boolean;
  data?: T;
  message?: string;
};

type MarketPrices = {
  averagePrice24h: string;
  latestPrice: string | null;
  tradeCount24h: number;
  totalSpaceAmount24h: string;
  from: number;
  to: number;
};

export type BuybackRankingItem = {
  rewardBp: number;
  address: string;
  spaceAmount: string;
  rank: number;
};
export type BuybackRanking = {
  items: BuybackRankingItem[];
  total: number;
  page: number;
  pageSize: number;
  startTime: number;
  endTime: number;
  pool: string;
};

@Injectable()
export class MarketService implements OnModuleDestroy {
  private readonly marketIndexerApiUrl = requiredEnv(
    'MARKET_INDEXER_API_URL',
  ).replace(/\/$/, '');
  private readonly marketIndexerInternalApiKey = requiredEnv(
    'MARKET_INDEXER_INTERNAL_API_KEY',
  );

  constructor(
    private readonly dataSource: DataSource,
    @Inject(MARKET_REDIS) private readonly redis: Redis,
  ) {}

  async getOpenOrders(accountId: number, query: OpenOrdersQueryDto) {
    const accountRows = await this.dataSource.query<
      { address: string; isMarketMaker: boolean }[]
    >(
      `
      SELECT
        lower(account.address) AS address,
        account.is_market_maker AS "isMarketMaker"
      FROM account
      WHERE account.id = $1
      `,
      [accountId],
    );
    const account = accountRows[0];
    if (!account) {
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    }

    if (query.side === MarketOrderSide.Sell && account.isMarketMaker) {
      const params = new URLSearchParams({
        side: query.side,
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      return this.requestIndexer<MarketOrderPage>(
        `/orders/open?${params.toString()}`,
      );
    }

    const includeSuperiorChain = query.side === MarketOrderSide.Buy;
    const relatedRows = await this.dataSource.query<{ address: string }[]>(
      `
      SELECT lower(related_account.address) AS address
      FROM (
        SELECT relation.subordinate_id AS account_id
        FROM account_relation relation
        WHERE relation.superior_id = $1
        ${
          includeSuperiorChain
            ? `
        UNION
        SELECT relation.superior_id AS account_id
        FROM account_relation relation
        WHERE relation.subordinate_id = $1

        UNION
        SELECT maker.id AS account_id
        FROM account maker
        WHERE maker.is_market_maker = true
        `
            : ''
        }
      ) related
      JOIN account related_account
        ON related_account.id = related.account_id
      `,
      [accountId],
    );

    const makers = Array.from(
      new Set([account.address, ...relatedRows.map((row) => row.address)]),
    );

    if (makers.length > 50_000) {
      throw new PayloadTooLargeException('TEAM_ADDRESS_LIMIT_EXCEEDED');
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.marketIndexerApiUrl}/orders/open/by-makers`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-market-indexer-key': this.marketIndexerInternalApiKey,
          },
          body: JSON.stringify({
            makers,
            side: query.side,
            page: query.page,
            pageSize: query.pageSize,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new BadGatewayException('MARKET_INDEXER_UNAVAILABLE');
    }

    let payload: MarketIndexerResponse<MarketOrderPage>;
    try {
      payload =
        (await response.json()) as MarketIndexerResponse<MarketOrderPage>;
    } catch {
      throw new BadGatewayException('MARKET_INDEXER_INVALID_RESPONSE');
    }

    if (!response.ok || payload.success === false || !payload.data) {
      throw new BadGatewayException(
        payload.message || 'MARKET_INDEXER_REQUEST_FAILED',
      );
    }

    return payload.data;
  }

  async getMarketPrices() {
    const prices = await this.requestIndexer<MarketPrices>('/stats/prices');
    const adjustment = await this.getTradeVolumeAdjustmentValue();
    let realTradeVolume: bigint;
    try {
      realTradeVolume = BigInt(prices.totalSpaceAmount24h);
    } catch {
      throw new BadGatewayException('MARKET_INDEXER_INVALID_RESPONSE');
    }

    return {
      ...prices,
      totalSpaceAmount24h: (realTradeVolume + adjustment).toString(),
    };
  }

  async getTradeVolumeAdjustment() {
    return {
      amount: (await this.getTradeVolumeAdjustmentValue()).toString(),
    };
  }

  async setTradeVolumeAdjustment(amount: string) {
    const normalizedAmount = BigInt(amount).toString();
    await this.redis.set(
      MARKET_TRADE_VOLUME_ADJUSTMENT_REDIS_KEY,
      normalizedAmount,
    );

    return { amount: normalizedAmount };
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private async getTradeVolumeAdjustmentValue() {
    const value = await this.redis.get(
      MARKET_TRADE_VOLUME_ADJUSTMENT_REDIS_KEY,
    );
    if (!value) {
      return 0n;
    }

    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }

  async getBuybackRanking(
    startTime = shanghaiWeekStart(),
    endTime = startTime + WEEK_SECONDS,
    page = 1,
    pageSize = 20,
    account?: string,
  ): Promise<BuybackRanking> {
    if (endTime <= startTime)
      throw new BadRequestException('INVALID_TIME_RANGE');
    const params = new URLSearchParams({
      startTime: String(startTime),
      endTime: String(endTime),
      page: String(page),
      pageSize: String(pageSize),
    });
    if (account) params.set('account', account.toLowerCase());
    const data = await this.requestIndexer<BuybackRanking>(
      `/buyback/ranking?${params}`,
    );
    if (
      !Array.isArray(data.items) ||
      data.pool?.toLowerCase() !== buybackPool.address.toLowerCase()
    )
      throw new BadGatewayException('MARKET_INDEXER_INVALID_RESPONSE');
    const rules = await this.dataSource.getRepository(DividendRule).find({
      where: {
        category: DividendRuleCategory.Buyback,
        token: AccountBalanceLogToken.Usdt,
      },
    });
    if (
      rules.length !== 5 ||
      new Set(rules.map((rule) => rule.level)).size !== 5 ||
      rules.some(
        (rule) =>
          rule.level < 1 ||
          rule.level > 5 ||
          !Number.isInteger(rule.bp) ||
          rule.bp < 0,
      ) ||
      rules.reduce((sum, rule) => sum + rule.bp, 0) !== 10000
    ) {
      throw new BadGatewayException('INVALID_BUYBACK_DIVIDEND_RULES');
    }
    const ratios = new Map(rules.map((rule) => [rule.level, rule.bp]));
    return {
      ...data,
      items: data.items.map((item) => ({
        ...item,
        rewardBp: ratios.get(item.rank) ?? 0,
      })),
    };
  }

  private async requestIndexer<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.marketIndexerApiUrl}${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('MARKET_INDEXER_UNAVAILABLE');
    }

    let payload: MarketIndexerResponse<T>;
    try {
      payload = (await response.json()) as MarketIndexerResponse<T>;
    } catch {
      throw new BadGatewayException('MARKET_INDEXER_INVALID_RESPONSE');
    }

    if (!response.ok || payload.success === false || !payload.data) {
      throw new BadGatewayException(
        payload.message || 'MARKET_INDEXER_REQUEST_FAILED',
      );
    }

    return payload.data;
  }
}

import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { Hono } from 'hono';
import { and, asc, eq, gte, lt, sql } from 'ponder';
import { z } from 'zod';
import { ok, paginationQuerySchema, validateQuery } from '../utils';

const querySchema = paginationQuerySchema.extend({
  startTime: z.coerce.number().int().min(0).max(2147483647),
  endTime: z.coerce.number().int().min(0).max(2147483647),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase()).optional(),
}).refine(q => q.endTime > q.startTime, { message: 'endTime must exceed startTime', path: ['endTime'] });
export const buybackRoutes = new Hono();
buybackRoutes.get('/buyback/ranking', validateQuery(querySchema), async (c) => {
  const q = c.req.valid('query');
  const pool = (process.env.BUYBACK_POOL_ADDRESS ?? '').toLowerCase() as `0x${string}`;
  const purchases = schema.buybackPurchase;
  const totalsByAccount = db.select({
    account: purchases.account,
    spaceAmount: sql<string>`sum(${purchases.spaceAmount})`.as('space_amount'),
    lastPosition: sql<string>`max(${purchases.position})`.as('last_position'),
  }).from(purchases).where(and(eq(purchases.pool, pool), gte(purchases.createdAt, q.startTime), lt(purchases.createdAt, q.endTime)))
    .groupBy(purchases.account).as('buyback_totals');
  const ranked = db.select({ account: totalsByAccount.account, spaceAmount: totalsByAccount.spaceAmount,
    rank: sql<string>`row_number() over(order by ${totalsByAccount.spaceAmount} desc, ${totalsByAccount.lastPosition} asc, ${totalsByAccount.account} asc)`.as('rank'),
  }).from(totalsByAccount).as('ranked_buyback');
  const filter = q.account ? eq(ranked.account, q.account as `0x${string}`) : undefined;
  const [rows, totals] = await Promise.all([
    db.select().from(ranked).where(filter).orderBy(asc(ranked.rank)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<string>`count(*)` }).from(ranked).where(filter),
  ]);
  return ok(c, { items: rows.map(r => ({ address: r.account, spaceAmount: r.spaceAmount.toString(), rank: Number(r.rank) })),
    total: Number(totals[0]?.total ?? 0), page: q.page, pageSize: q.pageSize, startTime: q.startTime, endTime: q.endTime, pool });
});

import { EntityManager } from 'typeorm';

export type NodeDeployment = { chainId: number; contractAddress: string };

// Slots are permanent once assigned. Late confirmations can fill remaining slots,
// but cannot displace purchasers whose eligibility has already been recorded.
export async function allocateNodeMakerSlots(
  manager: EntityManager,
  deployment: NodeDeployment,
  level: number,
) {
  const address = deployment.contractAddress.toLowerCase();
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `node-maker-slots:${deployment.chainId}:${address}:${level}`,
  ]);
  await manager.query(
    `
    WITH filled AS (
      SELECT count(*)::int AS count FROM node_market_maker_slot
      WHERE chain_id = $1 AND contract_address = $2 AND level = $3
    ), first_purchases AS (
      SELECT DISTINCT ON (p.account_id) p.account_id, p.id, p.created_at
      FROM node_purchase_signature p
      WHERE p.chain_id = $1 AND lower(p.contract_address) = $2
        AND p.target_level_index = $3 - 1 AND p.status = 'used'
        AND NOT EXISTS (
          SELECT 1 FROM node_market_maker_slot s
          WHERE s.chain_id = $1 AND s.contract_address = $2 AND s.level = $3
            AND s.account_id = p.account_id
        )
      ORDER BY p.account_id, p.created_at, p.id
    ), candidates AS (
      SELECT *, row_number() OVER (ORDER BY created_at, id)::int AS position
      FROM first_purchases
    )
    INSERT INTO node_market_maker_slot
      (chain_id, contract_address, level, slot, account_id, purchase_signature_id, created_at)
    SELECT $1, $2, $3, filled.count + candidates.position, candidates.account_id,
           candidates.id, EXTRACT(EPOCH FROM NOW())::int
    FROM candidates CROSS JOIN filled
    WHERE filled.count + candidates.position <= 30
    ON CONFLICT DO NOTHING
  `,
    [deployment.chainId, address, level],
  );
}

export async function hasNodeMakerSlot(
  manager: EntityManager,
  deployment: NodeDeployment,
  level: number,
  accountId: number,
) {
  await allocateNodeMakerSlots(manager, deployment, level);
  const slots = await manager.query<Array<{ slot: number }>>(
    `
    SELECT slot FROM node_market_maker_slot
    WHERE chain_id = $1 AND contract_address = $2 AND level = $3 AND account_id = $4
  `,
    [
      deployment.chainId,
      deployment.contractAddress.toLowerCase(),
      level,
      accountId,
    ],
  );
  return slots.length > 0;
}

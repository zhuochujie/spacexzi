import { validate } from 'class-validator';
import { PurchaseMinerDto } from './dto/purchase-miner.dto';
import { PurchaseMethod } from './enums/purchase-method.enum';

describe('SPACE-only miner purchase methods', () => {
  it.each(Object.values(PurchaseMethod))(
    'accepts supported method %s',
    async (method) => {
      const dto = Object.assign(new PurchaseMinerDto(), {
        minerId: 'SPACE_100',
        method,
      });
      expect(await validate(dto)).toHaveLength(0);
    },
  );
  it('rejects the removed wallet USDT method', async () => {
    const dto = Object.assign(new PurchaseMinerDto(), {
      minerId: 'SPACE_100',
      method: 'wallet_usdt_balance',
    });
    expect(
      (await validate(dto)).some((error) => error.property === 'method'),
    ).toBe(true);
  });
});

"""Run after forge build: python3 scripts/sync-trading-abis.py."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
for name, filename, symbol in [('Mining','mining-abi.ts','miningAbi'),('TokenExchange','market-abi.ts','marketAbi'),('BuybackPool','buyback-abi.ts','buybackAbi')]:
    abi = json.loads((root / f'core/out/{name}.sol/{name}.json').read_text())['abi']
    for app in ['server','web']:
        (root / f'{app}/src/web3/{filename}').write_text(f'// Generated from mining/core/src/{name}.sol\nexport const {symbol} = ' + json.dumps(abi,indent=2)+' as const;\n')
    if name == 'TokenExchange':
        (root / 'market-indexer/abis/TokenExchangeAbi.ts').write_text('// Generated from mining/core/src/TokenExchange.sol\nexport const TokenExchangeAbi = '+json.dumps(abi,indent=2)+' as const;\n')

(root / 'admin-web/src/buyback-abi.ts').write_text((root / 'web/src/web3/buyback-abi.ts').read_text())

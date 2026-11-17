"""Run after forge build: python3 scripts/sync-node-abi.py."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
abi = json.loads((root / 'core/out/NodeMembership.sol/NodeMembership.json').read_text())['abi']
for app in ('server', 'web'):
    target = root / app / 'src/web3/node-abi.ts'
    target.write_text('// Generated from mining/core/NodeMembership.sol. Run core/scripts/sync-node-abi.py.\nexport const nodeAbi = ' + json.dumps(abi, indent=2) + ' as const;\n')

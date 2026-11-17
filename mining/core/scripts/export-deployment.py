#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export confirmed deployment metadata and update application .env.example and existing .env files."""
import argparse
import json
import re
from pathlib import Path

ADDRESS = re.compile(r'^0x[0-9a-fA-F]{40}$')


def number(value):
    return int(value, 0) if isinstance(value, str) else int(value)


def address(value):
    if not isinstance(value, str) or not ADDRESS.fullmatch(value) or int(value, 16) == 0:
        raise ValueError('Invalid deployment address')
    return value.lower()


def update_env_text(text, values):
    """Replace known public settings while preserving unrelated settings/comments."""
    pending = dict(values)
    newline = '\r\n' if '\r\n' in text else '\n'
    lines = []
    assignment = re.compile(r'^(\s*)(?:#\s*)?(export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$')
    for line in text.splitlines(keepends=True):
        body = line.rstrip('\r\n')
        ending = line[len(body):]
        match = assignment.match(body)
        if match and match.group(3) in values:
            key = match.group(3)
            comment = re.search(r'(\s+#.*)$', match.group(5))
            suffix = comment.group(1) if comment else ''
            body = f"{match.group(1)}{match.group(2) or ''}{key}{match.group(4)}{values[key]}{suffix}"
            pending.pop(key, None)
        lines.append(body + ending)
    result = ''.join(lines)
    if pending:
        if result and not result.endswith(('\n', '\r')):
            result += newline
        result += ''.join(f'{key}={value}{newline}' for key, value in pending.items())
    return result


def plan_example_updates(root, settings):
    updates = {}
    for project, values in settings.items():
        for filename in ('.env.example', '.env'):
            path = root / project / filename
            if path.is_symlink():
                raise ValueError(f'Env file must not be a symlink: {path}')
            if filename == '.env' and not path.exists():
                continue
            text = path.read_bytes().decode('utf-8')
            updates[path] = update_env_text(text, values)
    return updates


def export(broadcast_path, output_dir=None, *, update_examples=True, examples_root=None):
    if 'dry-run' in broadcast_path.parts:
        raise ValueError('Dry-run results are not deployed contracts')
    data = json.loads(broadcast_path.read_text())
    transactions = data.get('transactions', [])
    receipts = {r['transactionHash'].lower(): r for r in data.get('receipts', [])}
    if not transactions or data.get('pending'):
        raise ValueError('Deployment is empty or has pending transactions')
    for tx in transactions:
        receipt = receipts.get((tx.get('hash') or '').lower())
        if not receipt or number(receipt['status']) != 1:
            raise ValueError('Every deployment/setup transaction must have a successful receipt')
    chain_id = number(data['chain'])
    if chain_id <= 0:
        raise ValueError('Invalid chain ID')
    presets = json.loads((Path(__file__).resolve().parents[1] / 'config/networks.json').read_text())
    names = [name for name, settings in presets.items() if settings['id'] == chain_id]
    if len(names) != 1:
        raise ValueError('Add the deployed network to mining/core/config/networks.ts and sync it first')
    network = names[0]


    def created(name):
        matches = [t for t in transactions if t.get('contractName') == name and t.get('transactionType') in ('CREATE', 'CREATE2')]
        if len(matches) != 1:
            raise ValueError('Expected exactly one deployed ' + name)
        tx = matches[0]
        receipt = receipts[tx['hash'].lower()]
        deployed = address(receipt['contractAddress'])
        if address(tx['contractAddress']) != deployed:
            raise ValueError('Deployment address does not match its receipt')
        return deployed, tx, receipt

    space, space_tx, _ = created('SpaceXZIToken')
    mining, mining_tx, _ = created('Mining')
    market, _, market_receipt = created('TokenExchange')
    node, node_tx, _ = created('NodeMembership')
    buyback, buyback_tx, _ = created('BuybackPool')
    buyback_args = buyback_tx['arguments']
    if len(buyback_args) != 7:
        raise ValueError('Unexpected BuybackPool constructor arguments')
    buyback_dividend = address(buyback_args[3])
    args = mining_tx['arguments']
    if len(args) != 8 or address(args[0]) != space:
        raise ValueError('Unexpected Mining constructor arguments')
    usdt, vault, signer, vip_vault, node_vault, usdt_fee = map(address, args[1:7])
    if len(node_tx['arguments']) != 4 or address(node_tx['arguments'][3]) != mining:
        raise ValueError('NodeMembership reward receiver must be Mining')
    if address(node_tx['arguments'][0]) != usdt or address(node_tx['arguments'][2]) != signer:
        raise ValueError('Mining and NodeMembership must use the same USDT and signer')
    if address(space_tx['arguments'][2]) != node_vault:
        raise ValueError('SPACE node fee receiver is not the node vault')
    deployer = address(space_tx['arguments'][0])
    contracts = {space, vault, node_vault, vip_vault, mining, market, node, buyback, buyback_dividend}
    owners = {c: deployer for c in contracts}
    for tx in transactions:
        if tx.get('function') == 'transferOwnership(address)' and tx.get('contractAddress', '').lower() in contracts:
            owners[tx['contractAddress'].lower()] = address(tx['arguments'][0])
    if len(set(owners.values())) != 1:
        raise ValueError('Deployment ownership setup is incomplete')
    values = {
        'BUYBACK_POOL_ADDRESS': buyback,
        'BUYBACK_DIVIDEND_VAULT_ADDRESS': buyback_dividend,
        'MARKET_CONTRACT_ADDRESS': market,
        'MINING_CONTRACT_ADDRESS': mining,
        'NODE_CONTRACT_ADDRESS': node,
        'SPACE_TOKEN_ADDRESS': space,
        'USDT_TOKEN_ADDRESS': usdt,
        'NODE_FEE_VAULT_ADDRESS': node_vault,
        'VIP_FEE_VAULT_ADDRESS': vip_vault,
    }
    start_block = number(market_receipt['blockNumber'])
    output = output_dir or Path(__file__).resolve().parents[1] / 'deployments' / str(chain_id) / ('run-' + str(number(data['timestamp'])))
    manifest = {
        'network': network, 'chainId': chain_id, 'deployer': deployer, 'owner': owners[mining], 'signer': signer,
        'marketFeeReceiver': address(space_tx['arguments'][1]), 'usdtFeeReceiver': usdt_fee,
        'nodeTreasury': address(node_tx['arguments'][1]), 'vault': vault,
        'marketStartBlock': start_block, 'addresses': values,
    }
    server_values = {'CHAIN_NETWORK': network, **values}
    web_values = {'VITE_CHAIN_NETWORK': network, **{f'VITE_{key}': value for key, value in values.items()}}
    admin_values = {'VITE_CHAIN_NETWORK': network, 'VITE_BUYBACK_POOL_ADDRESS': buyback}
    indexer_values = {'CHAIN_NETWORK': network, 'TOKEN_EXCHANGE_ADDRESS': market,
                      'BUYBACK_POOL_ADDRESS': buyback, 'START_BLOCK': str(start_block)}
    settings = {'server': server_values, 'web': web_values,
                'admin-web': admin_values, 'market-indexer': indexer_values}
    # Read every template before writing anything, so missing files cannot cause partial updates.
    updates = plan_example_updates(examples_root or Path(__file__).resolve().parents[2], settings) if update_examples else {}
    output.mkdir(parents=True, exist_ok=True)
    (output / 'deployment.json').write_text(json.dumps(manifest, indent=2) + '\n')
    header = '# 公开部署配置片段：合并到对应项目的环境文件，保留数据库、API、私钥等其他配置。\n'
    (output / 'server.env').write_text(header + f'CHAIN_NETWORK={network}\n' + ''.join(f'{k}={v}\n' for k, v in values.items()))
    (output / 'web.env').write_text(header + f'VITE_CHAIN_NETWORK={network}\n' + ''.join(f'VITE_{k}={v}\n' for k, v in values.items()))
    (output / 'admin.env').write_text(header + f'VITE_CHAIN_NETWORK={network}\nVITE_BUYBACK_POOL_ADDRESS={buyback}\n')
    (output / 'indexer.env').write_text(header + f'CHAIN_NETWORK={network}\nTOKEN_EXCHANGE_ADDRESS={market}\nBUYBACK_POOL_ADDRESS={buyback}\nSTART_BLOCK={start_block}\n')
    for path, content in updates.items():
        path.write_bytes(content.encode('utf-8'))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('broadcast', type=Path)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--no-update-examples', '--no-update-env', action='store_true', help='Only export fragments; leave .env.example and .env files unchanged')
    args = parser.parse_args()
    try:
        print('Exported deployment configuration: ' + str(export(args.broadcast, args.output_dir, update_examples=not args.no_update_examples)))
        if not args.no_update_examples:
            print('Updated .env.example and existing .env: server, web, admin-web, market-indexer (core unchanged)')
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, 'Cannot export deployment: ' + str(error) + '\n')

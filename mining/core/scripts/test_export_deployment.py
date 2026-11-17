import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('export_deployment', Path(__file__).with_name('export-deployment.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def addr(i):
    return '0x' + format(i, '040x')


def fixture():
    deployer, signer, marker, usdt, treasury = map(addr, range(100, 105))
    space, vault, node_vault, vip_vault, mining, market, node = map(addr, range(1, 8))
    definitions = [
        ('Vault', vault, None), ('Vault', node_vault, None), ('Vault', vip_vault, None),
        ('SpaceXZIToken', space, [deployer, marker, node_vault]),
        ('Mining', mining, [space, usdt, vault, signer, vip_vault, node_vault, marker, '200']),
        ('TokenExchange', market, []), ('NodeMembership', node, [usdt, treasury, signer, mining]),
        ('Vault', addr(8), None), ('BuybackPool', addr(9), [space, usdt, market, addr(8), marker, '100', '20']),
    ]
    transactions, receipts = [], []
    for i, (name, contract, args) in enumerate(definitions):
        tx_hash = '0x' + format(i + 1, '064x')
        transactions.append({'hash': tx_hash, 'transactionType': 'CREATE', 'contractName': name, 'contractAddress': contract, 'arguments': args})
        receipts.append({'transactionHash': tx_hash, 'status': '0x1', 'contractAddress': contract, 'blockNumber': hex(100 + i)})
    return {'chain': 56, 'timestamp': 1234, 'transactions': transactions, 'receipts': receipts, 'pending': []}


class ExportDeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'run-latest.json'
        self.output = self.root / 'output'
        self.data = fixture()
        self.examples = self.root / 'examples'
        self.originals = {}
        for project in ['core', 'server', 'web', 'admin-web', 'market-indexer']:
            directory = self.examples / project
            directory.mkdir(parents=True)
            template = ('# Preserve template comments\nCHAIN_NETWORK=bscTestnet\n'
                        'PRIVATE_KEY=keep-private-placeholder\nSIGNER_PRIVATE_KEY=keep-signer-placeholder\n'
                        'DB_PASSWORD=keep-db-password\nVITE_API_BASE_URL=/custom-api\n'
                        '# OWNER_ADDRESS=0x0000000000000000000000000000000000000000 # owner note\n'
                        'MARKET_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000\n')
            path = directory / '.env.example'
            path.write_text(template)
            self.originals[path] = template
            (directory / '.env').write_text('LIVE_ENV_MUST_NOT_CHANGE=true\n')

    def run_export(self):
        self.source.write_text(json.dumps(self.data))
        return module.export(self.source, self.output, examples_root=self.examples)

    def test_exports_address_fragments_and_exact_market_block(self):
        self.run_export()
        manifest = json.loads((self.output / 'deployment.json').read_text())
        self.assertEqual(manifest['marketStartBlock'], 105)
        self.assertEqual(manifest['addresses']['MINING_CONTRACT_ADDRESS'], addr(5))
        self.assertEqual(manifest['addresses']['NODE_FEE_VAULT_ADDRESS'], addr(3))
        self.assertIn('VITE_NODE_CONTRACT_ADDRESS=' + addr(7), (self.output / 'web.env').read_text())
        self.assertNotIn('PRIVATE_KEY', (self.output / 'server.env').read_text())
        self.assertIn('START_BLOCK=105', (self.output / 'indexer.env').read_text())
        self.assertIn('CHAIN_NETWORK=bsc', (self.output / 'server.env').read_text())
        self.assertIn('VITE_CHAIN_NETWORK=bsc', (self.output / 'web.env').read_text())
        self.assertIn('VITE_CHAIN_NETWORK=bsc', (self.output / 'admin.env').read_text())
        self.assertIn('CHAIN_NETWORK=bsc', (self.output / 'indexer.env').read_text())

    def test_updates_each_project_example_with_its_own_public_settings(self):
        self.run_export()
        server = (self.examples / 'server/.env.example').read_text()
        web = (self.examples / 'web/.env.example').read_text()
        admin = (self.examples / 'admin-web/.env.example').read_text()
        indexer = (self.examples / 'market-indexer/.env.example').read_text()
        self.assertIn('MARKET_CONTRACT_ADDRESS=' + addr(6), server)
        self.assertIn('NODE_CONTRACT_ADDRESS=' + addr(7), server)
        self.assertIn('VITE_MINING_CONTRACT_ADDRESS=' + addr(5), web)
        self.assertIn('VITE_BUYBACK_POOL_ADDRESS=' + addr(9), admin)
        self.assertIn('TOKEN_EXCHANGE_ADDRESS=' + addr(6), indexer)
        self.assertIn('START_BLOCK=105', indexer)

    def test_never_updates_or_requires_the_core_example(self):
        core = self.examples / 'core/.env.example'
        original = core.read_bytes()
        self.run_export()
        self.assertEqual(core.read_bytes(), original)
        core.unlink()
        self.run_export()
        self.assertFalse(core.exists())

    def test_preserves_unrelated_settings_in_examples_and_actual_env_files(self):
        self.run_export()
        for directory in self.examples.iterdir():
            text = (directory / '.env.example').read_text()
            self.assertIn('PRIVATE_KEY=keep-private-placeholder', text)
            self.assertIn('SIGNER_PRIVATE_KEY=keep-signer-placeholder', text)
            self.assertIn('DB_PASSWORD=keep-db-password', text)
            self.assertIn('VITE_API_BASE_URL=/custom-api', text)
            self.assertIn('# Preserve template comments', text)
            self.assertIn('LIVE_ENV_MUST_NOT_CHANGE=true\n', (directory / '.env').read_text())

    def test_updates_existing_env_with_project_settings_and_preserves_secrets(self):
        env = self.examples / 'server/.env'
        env.write_text('# Local config\nCHAIN_NETWORK=old\nDB_PASSWORD=private-test-value\n')
        self.run_export()
        self.assertIn('CHAIN_NETWORK=bsc\n', env.read_text())
        self.assertIn('MINING_CONTRACT_ADDRESS=' + addr(5), env.read_text())
        self.assertIn('DB_PASSWORD=private-test-value\n', env.read_text())
        self.assertIn('VITE_NODE_CONTRACT_ADDRESS=' + addr(7), (self.examples / 'web/.env').read_text())
        self.assertIn('VITE_BUYBACK_POOL_ADDRESS=' + addr(9), (self.examples / 'admin-web/.env').read_text())
        self.assertIn('START_BLOCK=105', (self.examples / 'market-indexer/.env').read_text())
        self.assertEqual((self.examples / 'core/.env').read_text(), 'LIVE_ENV_MUST_NOT_CHANGE=true\n')

    def test_does_not_create_missing_actual_env(self):
        env = self.examples / 'web/.env'
        env.unlink()
        self.run_export()
        self.assertFalse(env.exists())

    def test_refuses_symlinked_actual_env_before_writing(self):
        env = self.examples / 'market-indexer/.env'
        env.unlink()
        env.symlink_to(self.examples / 'core/.env')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.run_export()
        self.assertEqual(self.originals, {path: path.read_text() for path in self.originals})
        self.assertFalse(self.output.exists())

    def test_template_updates_are_idempotent(self):
        self.run_export()
        first = {path: path.read_bytes() for path in self.originals}
        self.run_export()
        self.assertEqual(first, {path: path.read_bytes() for path in self.originals})

    def test_invalid_broadcast_does_not_change_any_templates(self):
        self.data['receipts'][0]['status'] = '0x0'
        with self.assertRaisesRegex(ValueError, 'successful receipt'):
            self.run_export()
        self.assertEqual(self.originals, {path: path.read_text() for path in self.originals})
        self.assertFalse(self.output.exists())

    def test_missing_template_is_detected_before_any_write(self):
        missing = self.examples / 'market-indexer/.env.example'
        missing.unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_export()
        for path, original in self.originals.items():
            if path != missing:
                self.assertEqual(path.read_text(), original)
        self.assertFalse(self.output.exists())

    def test_can_export_fragments_without_updating_examples(self):
        self.source.write_text(json.dumps(self.data))
        module.export(self.source, self.output, update_examples=False, examples_root=self.root / 'missing')
        self.assertTrue((self.output / 'deployment.json').exists())
        self.assertEqual(self.originals, {path: path.read_text() for path in self.originals})

    def test_preserves_crlf_export_prefix_and_inline_comments(self):
        text = '# Heading\r\nexport CHAIN_NETWORK = "old" # note\r\nDB_PASSWORD=unchanged\r\n'
        updated = module.update_env_text(text, {'CHAIN_NETWORK': 'anvil', 'START_BLOCK': '15'})
        self.assertEqual(updated, '# Heading\r\nexport CHAIN_NETWORK = anvil # note\r\nDB_PASSWORD=unchanged\r\nSTART_BLOCK=15\r\n')

    def test_refuses_symlinked_templates(self):
        path = self.examples / 'server/.env.example'
        path.unlink()
        path.symlink_to(self.examples / 'server/.env')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.run_export()
        self.assertEqual((self.examples / 'server/.env').read_text(), 'LIVE_ENV_MUST_NOT_CHANGE=true\n')

    def test_exports_local_network_name(self):
        self.data['chain'] = 31337
        self.run_export()
        self.assertIn('CHAIN_NETWORK=anvil', (self.output / 'server.env').read_text())
        self.assertIn('VITE_CHAIN_NETWORK=anvil', (self.output / 'web.env').read_text())
        self.assertIn('CHAIN_NETWORK=anvil', (self.examples / 'server/.env.example').read_text())
        self.assertIn('VITE_CHAIN_NETWORK=anvil', (self.examples / 'web/.env.example').read_text())

    def test_rejects_unknown_network(self):
        self.data['chain'] = 999999
        with self.assertRaisesRegex(ValueError, 'networks.ts'):
            self.run_export()

    def test_refuses_failed_transaction(self):
        self.data['receipts'][0]['status'] = '0x0'
        with self.assertRaisesRegex(ValueError, 'successful receipt'):
            self.run_export()
        self.assertFalse(self.output.exists())

    def test_refuses_missing_receipt(self):
        self.data['receipts'].pop()
        with self.assertRaisesRegex(ValueError, 'successful receipt'):
            self.run_export()

    def test_refuses_pending_transaction(self):
        self.data['pending'] = ['0xpending']
        with self.assertRaisesRegex(ValueError, 'pending'):
            self.run_export()

    def test_refuses_dry_run_even_with_receipts(self):
        folder = self.root / 'dry-run'
        folder.mkdir()
        self.source = folder / 'run-latest.json'
        with self.assertRaisesRegex(ValueError, 'Dry-run'):
            self.run_export()

    def test_refuses_address_mismatching_receipt(self):
        self.data['transactions'][4]['contractAddress'] = addr(999)
        with self.assertRaisesRegex(ValueError, 'match its receipt'):
            self.run_export()

    def test_refuses_missing_node_contract(self):
        self.data['transactions'].pop(6)
        self.data['receipts'].pop(6)
        with self.assertRaisesRegex(ValueError, 'NodeMembership'):
            self.run_export()

    def test_refuses_node_rewards_sent_to_a_different_mining_contract(self):
        self.data['transactions'][6]['arguments'][3] = addr(999)
        with self.assertRaisesRegex(ValueError, 'reward receiver must be Mining'):
            self.run_export()
        self.assertEqual(self.originals, {path: path.read_text() for path in self.originals})

    def test_refuses_wrong_node_signer(self):
        self.data['transactions'][6]['arguments'][2] = addr(999)
        with self.assertRaisesRegex(ValueError, 'same USDT and signer'):
            self.run_export()


if __name__ == '__main__':
    unittest.main()

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadProjectEnv } = require('./ponder.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ponder-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_SCHEMA=market_indexer_test\nCHAIN_NETWORK=anvil\nDATABASE_URL=postgresql://test@localhost/test\n');
  return root;
}

test('loads schema, database and network from .env without any local env file', (t) => {
  const root = fixture(t);
  const env = loadProjectEnv(root, {});
  assert.equal(env.DATABASE_SCHEMA, 'market_indexer_test');
  assert.equal(env.CHAIN_NETWORK, 'anvil');
  assert.equal(env.DATABASE_URL, 'postgresql://test@localhost/test');
  assert.equal(fs.existsSync(path.join(root, '.env.local')), false);
});

test('preserves explicit process environment values', (t) => {
  const root = fixture(t);
  const env = loadProjectEnv(root, { DATABASE_SCHEMA: 'container_schema' });
  assert.equal(env.DATABASE_SCHEMA, 'container_schema');
  assert.equal(env.CHAIN_NETWORK, 'anvil');
});

test('allows a fileless container deployment', (t) => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, '.env'));
  assert.equal(loadProjectEnv(root, { DATABASE_SCHEMA: 'external' }).DATABASE_SCHEMA, 'external');
});

test('loads .env before the CLI module executes and forwards CLI options', (t) => {
  const root = fixture(t);
  const packageDir = path.join(root, 'node_modules', 'ponder');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ type: 'module', bin: { ponder: './entry.mjs' } }));
  fs.writeFileSync(path.join(packageDir, 'entry.mjs'), `
    if (!process.env.DATABASE_SCHEMA) throw new Error('Database schema required');
    console.log(JSON.stringify({ schema: process.env.DATABASE_SCHEMA, network: process.env.CHAIN_NETWORK, args: process.argv.slice(2), cwd: process.cwd() }));
  `);
  const env = { ...process.env };
  for (const key of ['DATABASE_SCHEMA', 'DATABASE_URL', 'CHAIN_NETWORK']) delete env[key];
  const program = `require(${JSON.stringify(path.join(__dirname, 'ponder.cjs'))}).runPonder({ root: ${JSON.stringify(root)}, args: ['start', '--schema', 'cli_override'] }).catch(e => { console.error(e); process.exitCode = 1; });`;
  const result = spawnSync(process.execPath, ['-e', program], { env, cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.schema, 'market_indexer_test');
  assert.equal(output.network, 'anvil');
  assert.deepEqual(output.args, ['start', '--schema', 'cli_override']);
  assert.equal(output.cwd, fs.realpathSync(root));
});

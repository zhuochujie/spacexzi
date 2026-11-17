// Generate all network consumers from one defineChain registry.
(async () => {
// Synchronize the single network registry into independently buildable applications and Foundry.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../..');
const projectRequire = createRequire(path.join(root, 'server/package.json'));
const ts = projectRequire('typescript');
const prettier = projectRequire('prettier');
const source = fs.readFileSync(path.join(root, 'core/config/networks.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleResult = { exports: {} };
vm.runInNewContext(compiled, { module: moduleResult, exports: moduleResult.exports, require: projectRequire });
const networks = moduleResult.exports.networks;
const manifest = {};
for (const [name, chain] of Object.entries(networks)) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !Number.isSafeInteger(chain.id) || chain.id <= 0 || !chain.rpcUrls.default.http[0]) throw new Error(`Invalid network ${name}`);
  if (!Number.isSafeInteger(chain.confirmationDepth) || chain.confirmationDepth < 0) throw new Error(`Invalid confirmation depth for ${name}`);
  manifest[name] = { id: chain.id, rpcUrl: chain.rpcUrls.default.http[0] };
}
const resolveSource = `
export function chainFromEnv(env: Record<string, string | undefined>, prefix = ''): NetworkChain {
  const name = env[prefix + 'CHAIN_NETWORK']?.trim();
  if (!name) throw new Error('Missing ' + prefix + 'CHAIN_NETWORK');
  const chain = Object.prototype.hasOwnProperty.call(networks, name) ? networks[name] : undefined;
  if (!chain) throw new Error('Unknown network ' + name + '. Add it to mining/core/config/networks.ts and run the sync script.');
  const rpc = env[prefix + 'CHAIN_RPC_URL']?.trim();
  if (!rpc) return chain;
  let parsed: URL;
  try { parsed = new URL(rpc); } catch { throw new Error('Invalid ' + prefix + 'CHAIN_RPC_URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid ' + prefix + 'CHAIN_RPC_URL');
  return defineChain({ ...chain, rpcUrls: { default: { http: [rpc] } } });
}
`;
for (const file of ['server/src/web3/chain-config.ts', 'web/src/web3/chain-config.ts', 'admin-web/src/lib/chain-config.ts', 'market-indexer/src/chain-config.ts']) {
  const target = path.join(root, file);
  const content = '// Generated from mining/core/config/networks.ts. Run node core/scripts/sync-chain-config.cjs.\n' + source + resolveSource;
  fs.writeFileSync(target, await prettier.format(content, { ...(await prettier.resolveConfig(target)), parser: 'typescript' }));
}
fs.mkdirSync(path.join(root, 'core/config'), { recursive: true });
fs.writeFileSync(path.join(root, 'core/config/networks.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Synced networks: ' + Object.keys(networks).join(', '));

})().catch(error => { console.error(error); process.exitCode = 1; });

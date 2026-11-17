// Ponder 0.16 automatically loads .env.local, while this project uses .env only.
// Load it before importing the CLI: namespace/schema validation happens early.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dotenv = require('dotenv');

function loadProjectEnv(root, env = process.env) {
  const result = dotenv.config({
    path: path.join(root, '.env'),
    processEnv: env,
    override: false,
  });
  // Container/process environment variables are also supported without a file.
  if (result.error && result.error.code !== 'ENOENT') throw result.error;
  return env;
}

async function runPonder({ root = path.resolve(__dirname, '..'), args = process.argv.slice(2) } = {}) {
  loadProjectEnv(root);
  const packageDir = path.join(root, 'node_modules', 'ponder');
  const metadata = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.ponder;
  if (!bin) throw new Error('Cannot find the installed Ponder CLI entry');
  const cliPath = path.resolve(packageDir, bin);
  process.chdir(root);
  process.argv = [process.execPath, cliPath, ...args];
  await import(pathToFileURL(cliPath).href);
}

module.exports = { loadProjectEnv, runPonder };

if (require.main === module) {
  runPonder().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

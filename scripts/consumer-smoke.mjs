import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manager = process.argv[2] || 'pnpm';
const major = process.argv[3] || '11';
const backend = process.argv[4] || 'typescript';
const bootstrapOnly = process.argv.includes('--bootstrap-only');
assert(['npm', 'pnpm'].includes(manager));
assert(['typescript', 'csharp', 'python'].includes(backend));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), `swallowkit-consumer-${manager}-${major}-`));
console.log(`Consumer test directory: ${directory} (Node ${process.version})`);
const home = path.join(directory, 'home');
fs.mkdirSync(home);
const env = {
  PATH: [path.dirname(process.execPath), ...process.env.PATH.split(path.delimiter).filter(entry => !entry.includes('node_modules'))].join(path.delimiter),
  HOME: home,
  CI: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
  XDG_CONFIG_HOME: path.join(directory, 'config'),
  XDG_CACHE_HOME: path.join(directory, 'cache'),
  XDG_DATA_HOME: path.join(directory, 'data'),
  PNPM_HOME: path.join(directory, 'pnpm-home'),
  npm_config_cache: path.join(directory, 'npm-cache'),
  npm_config_userconfig: path.join(directory, 'npmrc'),
  npm_config_globalconfig: path.join(directory, 'global-npmrc'),
};
fs.writeFileSync(env.npm_config_userconfig, '');
fs.writeFileSync(env.npm_config_globalconfig, '');
let sequence = 0;
function run(command, args, cwd = directory, environment = env) {
  console.log(`> ${command} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const logPath = path.join(directory, `${++sequence}-${path.basename(command)}.log`);
    const log = fs.createWriteStream(logPath);
    const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output += chunk;
      log.write(chunk);
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
    child.on('error', error => { clearTimeout(timer); log.end(); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      log.end();
      if (code !== 0) reject(new Error(`Exit ${code}; ${logPath}\n${output.slice(-10000)}`));
      else resolve(output);
    });
  });
}

await run('npm', ['pack', '--pack-destination', directory], repository, { ...env, npm_config_cache: path.join(directory, 'pack-cache') });
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'));
const archive = fs.readFileSync(path.join(directory, `${manifest.name}-${manifest.version}.tgz`));
const upstream = await (await fetch(`https://registry.npmjs.org/${manifest.name}`)).json();
// Synthetic registry fixture: an aged publish date also permits testing unreleased versions.
// No consumer security settings or dependency metadata are changed.
const published = upstream.time?.[manifest.version] || '2020-01-01T00:00:00.000Z';
let registry;
let artifactDownloads = 0;
const server = http.createServer((request, response) => {
  if (request.url === '/swallowkit.tgz') {
    artifactDownloads++;
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(archive);
  } else if (request.url.split('?')[0] === '/swallowkit' || request.url.startsWith('/swallowkit/')) {
    const version = {
      ...manifest,
      dist: {
        tarball: `${registry}/swallowkit.tgz`,
        shasum: createHash('sha1').update(archive).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      },
    };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url.startsWith('/swallowkit/') ? version : {
      name: manifest.name,
      'dist-tags': { latest: manifest.version },
      versions: { [manifest.version]: version },
      time: { created: upstream.time.created, modified: published, [manifest.version]: published },
    }));
  } else {
    response.writeHead(302, { location: `https://registry.npmjs.org${request.url}` });
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
registry = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await run('node', ['--version'])).trim(), process.version, 'Children must use the requested Node version');
  if (manager === 'pnpm' || major !== 'bundled') {
    await run('npm', ['install', '--prefix', path.join(directory, 'tools'), `${manager}@${major}`, '--no-audit', '--no-fund']);
    env.PATH = `${path.join(directory, 'tools', 'node_modules', '.bin')}${path.delimiter}${env.PATH}`;
    console.log((await run(manager, ['--version'])).trim());
  }
  env.npm_config_registry = registry;
  env.pnpm_config_registry = registry;
  const launcher = manager === 'pnpm' ? 'pnpm' : 'npx';
  const bootstrap = manager === 'pnpm' ? ['dlx', `swallowkit@${manifest.version}`] : ['--yes', '--package', `swallowkit@${manifest.version}`, 'swallowkit'];
  const help = await run(launcher, [...bootstrap, '--help']);
  assert(!help.includes('ERR_PNPM_IGNORED_BUILDS'));
  const inventory = new Map();
  for (const root of [path.join(directory, 'cache'), path.join(directory, 'npm-cache')]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || entry.name !== 'package.json') continue;
      const location = path.join(entry.parentPath, entry.name);
      const pkg = JSON.parse(fs.readFileSync(location, 'utf8'));
      if (!pkg.name || !pkg.version) continue;
      const lifecycle = Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([name]) => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name)));
      inventory.set(`${pkg.name}@${pkg.version}`, { lifecycle, location });
      assert(!['tsx', 'esbuild', 'next', 'react', 'react-dom'].includes(pkg.name), `Unexpected CLI dependency: ${pkg.name}`);
      assert(!['preinstall', 'install', 'postinstall'].some(name => lifecycle[name]), `CLI install script: ${pkg.name}`);
    }
  }
  assert([...inventory.keys()].some(name => name.startsWith('swallowkit@')), 'Audit must find installed artifact');
  fs.writeFileSync(path.join(directory, 'dependency-audit.json'), JSON.stringify(Object.fromEntries(inventory), null, 2));
  const installedPackage = path.dirname(inventory.get(`${manifest.name}@${manifest.version}`).location);
  await run('node', ['-e', `require('node:assert/strict').equal(typeof require(${JSON.stringify(installedPackage)}).DatabaseClient, 'function')`]);
  assert(artifactDownloads > 0, 'Bootstrap must download the packed artifact, not the published version');
  if (!bootstrapOnly) {
    await run(launcher, [...bootstrap, 'init', 'sample',
      '--cicd', 'github', '--backend-language', backend, '--cosmos-db-mode', 'serverless',
      '--vnet', 'none', '--swa-plan', 'standard']);
    const project = path.join(directory, 'sample');
    const local = manager === 'pnpm' ? ['exec'] : ['--no-install'];
    const localCommand = manager === 'pnpm' ? 'pnpm' : 'npx';
    const cli = args => run(localCommand, [...local, 'swallowkit', ...args], project);
    const lockfile = manager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json';
    for (const other of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']) {
      assert.equal(fs.existsSync(path.join(project, other)), other === lockfile, other);
    }
    assert.equal(fs.existsSync(path.join(project, 'pnpm-workspace.yaml')), manager === 'pnpm');
    await run(manager, manager === 'pnpm' ? ['install', '--frozen-lockfile'] : ['ci'], project);
    await cli(['create-model', 'task']);
    await cli(['scaffold', 'shared/models/task.ts']);
    await cli(['machine', 'inspect', 'project']);
    await run(manager, ['run', 'build'], project);
    await run(localCommand, [...local, 'tsc', '--noEmit'], project);
    const contractTest = path.join(project, 'consumer-contract.test.cjs');
    fs.writeFileSync(contractTest, `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Task } = require('@sample/shared');
test('compiled shared model validates data through the installed workspace', () => {
  assert.equal(Task.safeParse({ id: '1', name: 'hello' }).success, true);
  assert.equal(Task.safeParse({ id: '1', name: '' }).success, false);
});
`);
    try { await run('node', ['--test', contractTest], project); }
    finally { fs.unlinkSync(contractTest); }
    if (backend === 'typescript') await run(manager, ['run', 'build'], path.join(project, 'functions'));
    await cli(['machine', 'verify', 'project']);
    if (backend === 'typescript') {
      // Exercise the dependency staging used by generated Functions deployment workflows.
      const staging = path.join(directory, 'function-deployment');
      fs.mkdirSync(staging);
      const functionsManifest = JSON.parse(fs.readFileSync(path.join(project, 'functions', 'package.json'), 'utf8'));
      const sharedName = JSON.parse(fs.readFileSync(path.join(project, 'shared', 'package.json'), 'utf8')).name;
      delete functionsManifest.dependencies[sharedName];
      fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(functionsManifest));
      await run(manager, manager === 'pnpm' ? ['install', '--prod', '--no-frozen-lockfile'] : ['install', '--omit=dev'], staging);
      const destination = path.join(staging, 'node_modules', sharedName);
      fs.mkdirSync(destination, { recursive: true });
      fs.cpSync(path.join(project, 'shared', 'dist'), path.join(destination, 'dist'), { recursive: true });
      fs.copyFileSync(path.join(project, 'shared', 'package.json'), path.join(destination, 'package.json'));
      await run('node', ['-e', `require(${JSON.stringify(sharedName)}); require('@azure/functions'); require('@azure/cosmos'); require('@azure/identity')`], staging);
    }
    // Frontend startup is independent of external Cosmos/Core Tools prerequisites.
    const portProbe = http.createServer();
    await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    const port = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    console.log('> project-local swallowkit dev --no-functions --no-swa (HTTP smoke)');
    const dev = spawn(localCommand, [...local, 'swallowkit', 'dev', '--no-functions', '--no-swa', '--port', String(port)], {
      cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let devOutput = '';
    dev.stdout.on('data', chunk => { devOutput += chunk; });
    dev.stderr.on('data', chunk => { devOutput += chunk; });
    let devError;
    dev.on('error', error => { devError = error; });
    try {
      const deadline = Date.now() + 120000;
      let ready = false;
      while (Date.now() < deadline && dev.exitCode === null && !devError) {
        try { ready = (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert(ready, `dev failed: ${devError || devOutput}`);
    } finally {
      if (dev.pid) { try { process.kill(-dev.pid, 'SIGTERM'); } catch {} }
      fs.writeFileSync(path.join(directory, 'dev.log'), devOutput);
    }

    const agents = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
    assert(agents.includes(`${manager === 'pnpm' ? 'pnpm exec' : 'npx'} swallowkit`));
    assert(!agents.includes(manager === 'pnpm' ? 'npx swallowkit' : 'pnpm exec swallowkit'));
    const mcp = JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8')).mcpServers.swallowkit;
    assert.equal(mcp.command, launcher);
    assert.equal(mcp.env.SWALLOWKIT_MCP_VERSION, 'latest');
    await new Promise((resolve, reject) => {
      const child = spawn(mcp.command, mcp.args.map(arg => arg.replace('${SWALLOWKIT_MCP_VERSION}', 'latest')), {
        cwd: project, env: { ...env, ...mcp.env }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      let initialized = false;
      let inspected = false;
      const timer = setTimeout(() => child.kill(), 120000);
      child.stderr.on('data', chunk => { errors += chunk; });
      child.stdout.on('data', chunk => {
        output += chunk;
        for (const line of output.split('\n')) {
          try {
            const message = JSON.parse(line);
            if (message.id === 1 && message.result?.serverInfo && !initialized) {
              initialized = true;
              child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
              child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
                name: 'swallowkit_inspect_project', arguments: {},
              } })}\n`);
            }
            if (message.id === 2) {
              inspected = Boolean(message.result?.content?.length && !message.result.isError);
              child.kill();
            }
          } catch {}
        }
      });
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        if (initialized && inspected) resolve();
        else reject(new Error(`MCP initialize/inspect failed: ${errors}\n${output}`));
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'consumer-smoke', version: '1.0.0' },
      } })}\n`);
    });
  }
  console.log(`PASS ${manager} ${major} ${backend}${bootstrapOnly ? ' bootstrap' : ''}`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildSharedTsConfig, buildTypeScriptFunctionsPackageJson, buildSwallowKitConfigSource, createInfrastructure } = require('../dist/cli/commands/init.js');
const { createModelOperation } = require('../dist/core/operations/create-model.js');
const { addModelMigrationOperation } = require('../dist/core/operations/model-infrastructure.js');
const { planScaffoldOperation } = require('../dist/core/operations/scaffold-plan.js');
const { applyScaffoldOperation } = require('../dist/core/operations/scaffold-apply.js');
const { loadMigrationManifest } = require('../dist/core/project/migrations.js');
const root = fs.mkdtempSync(path.join(repository, '.model-consumer-'));
const previous = process.cwd();
const pkg = require('../package.json');
const write = (relative, content) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
};
const cli = (...args) => execFileSync(process.execPath, [path.join(repository, 'dist', 'cli', 'index.js'), ...args], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const compile = relative => execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, relative),
], { cwd: root, stdio: 'inherit' });

try {
  process.chdir(root);
  write('package.json', {
    name: 'model-reliability-consumer', private: true, workspaces: ['shared', 'functions'],
    dependencies: { next: pkg.devDependencies.next, react: pkg.devDependencies.react, 'react-dom': pkg.devDependencies['react-dom'], zod: '^4.0.0', '@model-reliability-consumer/shared': 'file:shared' },
    devDependencies: { typescript: '^5.9.2', '@types/node': pkg.devDependencies['@types/node'], '@types/react': pkg.devDependencies['@types/react'] },
  });
  write('swallowkit.config.js', buildSwallowKitConfigSource('typescript'));
  write('shared/package.json', {
    name: '@model-reliability-consumer/shared', version: '1.0.0', private: true,
    main: 'dist/index.js', types: 'dist/index.d.ts', dependencies: { zod: '>=3.25.0' },
  });
  write('shared/index.ts', '');
  write('shared/tsconfig.json', buildSharedTsConfig());
  write('functions/package.json', buildTypeScriptFunctionsPackageJson('model-reliability-consumer', 'npm'));
  write('functions/tsconfig.json', {
    compilerOptions: { target: 'ES2020', module: 'commonjs', moduleResolution: 'node', lib: ['ES2020'], outDir: 'dist', rootDir: 'src', strict: true, esModuleInterop: true, skipLibCheck: true },
    include: ['src/**/*.ts'],
  });
  write('tsconfig.json', {
    compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', lib: ['ES2020', 'DOM'], jsx: 'react-jsx', strict: true, esModuleInterop: true, skipLibCheck: true, noEmit: true, paths: { '@/*': ['./*'] } },
    include: ['app/**/*.ts', 'app/**/*.tsx', 'lib/**/*.ts'],
  });
  await createInfrastructure(root, 'model-reliability-consumer', {
    cosmosDbMode: 'serverless', vnetOption: 'none', swaPlan: 'standard',
  }, 'typescript');
  await createModelOperation({ names: ['learning-profile'], overwriteMode: 'never' });
  assert.equal(loadMigrationManifest(root).migrations.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'functions', 'src', 'learning-profile.ts')), false);

  write('shared/models/topic-mastery.ts', `import {z} from 'zod/v4';
export const TopicMastery = z.object({topicId:z.string(),score:z.number()});`);
  write('shared/models/learning-profile.ts', `import {z} from 'zod/v4';
import {TopicMastery} from './topic-mastery';
export const unrelatedSchema = z.object({wrong:z.string()});
export const LearningProfile = z.object({id:z.string(),name:z.string(),userId:z.string(),masteryByTopic:z.array(TopicMastery)});
export type LearningProfile = z.infer<typeof LearningProfile>;
`);
  const before = fs.readFileSync(path.join(root, 'shared', 'models', 'learning-profile.ts'));
  await addModelMigrationOperation('learning-profile');
  assert.deepEqual(loadMigrationManifest(root).migrations.map(migration => migration.sourceModel), ['LearningProfile']);
  assert.deepEqual(fs.readFileSync(path.join(root, 'shared', 'models', 'learning-profile.ts')), before);
  const plan = await planScaffoldOperation({ model: 'learning-profile' });
  assert.equal(plan.schemaAnalysis.canonicalModel.schemaName, 'LearningProfile');
  await applyScaffoldOperation({ planId: plan.planId });

  const npmCli = process.env.npm_execpath;
  assert(npmCli, 'Run via npm run test:model-reliability so the active npm CLI is explicit.');
  execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  compile('shared');
  compile('functions');
  compile('.');
  const compiled = require(path.join(root, 'shared', 'dist', 'index.js'));
  assert.equal(compiled.LearningProfile.safeParse({ id: '1', name: 'Learner', userId: 'u', masteryByTopic: [{ topicId: 't', score: 9 }] }).success, true);
  assert.equal(compiled.LearningProfile.safeParse({ id: '1', name: 'Learner', userId: 'u', masteryByTopic: [{ topicId: 't', score: 'wrong' }] }).success, false);

  write('shared/models/workflow-step-state.ts', `import {z} from 'zod/v4';
export const WorkflowStepState=z.object({id:z.string(),output:z.record(z.string(),z.string())});`);
  const rejected = JSON.parse(cli('machine', 'verify', 'project', '--checks', 'structure'));
  assert.equal(rejected.data.summary.done, false);
  assert.equal(fs.existsSync(path.join(root, 'infra', 'migrations', '0002-create-workflow-step-state-container')), false);
  console.log('Generated shared/Functions/BFF/UI compile and runtime schema assertions passed; unsupported record verification fails closed. No Azure/emulator operations.');
} finally {
  process.chdir(previous);
  fs.rmSync(root, { recursive: true, force: true });
}

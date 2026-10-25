const fs = require('node:fs');

const numeric = '(?:0|[1-9][0-9]*)';
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const match = typeof version === 'string' ? semver.exec(version) : null;
if (!match || match[0] !== version) {
  throw new Error('package.json version must be a valid SemVer version');
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (lock.version !== version || lock.packages?.['']?.version !== version) {
  throw new Error('package.json and package-lock.json versions must match');
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error('Git tag must match package.json version');
}

const prerelease = match[1]?.split('.')[0];
const distTag = !prerelease
  ? 'latest'
  : prerelease === 'alpha' || prerelease === 'beta'
    ? prerelease
    : 'next';
const output = `version=${version}\ndist_tag=${distTag}\n`;
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
}
process.stdout.write(output);

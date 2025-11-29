import * as fs from "fs";
import * as path from "path";

interface BuildOptions {
  output: string;
}

export async function buildCommand(options: BuildOptions) {
  console.log("🔨 Building Next.js app for Azure Static Web Apps...");

  const projectRoot = process.cwd();
  const outputDir = path.join(projectRoot, options.output);

  try {
    // 1. Next.js の設定を確認・更新
    console.log("\n⚙️  Configuring Next.js for Azure deployment...");
    await ensureNextJsConfig(projectRoot);

    // 2. Next.js をビルド (standalone モード)
    console.log("\n📦 Building Next.js application...");
    await buildNextJs(projectRoot);

    // 3. ビルド成果物を出力ディレクトリにコピー
    console.log("\n📦 Preparing deployment artifacts...");
    await copyBuildArtifacts(projectRoot, outputDir);

    console.log(`\n✅ Build completed!`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log(`📁 Standalone output: ${path.join(projectRoot, '.next/standalone')}`);
    console.log("\n📝 Next steps:");
    console.log("  1. swallowkit deploy (Deploy to Azure Static Web Apps)");
  } catch (error) {
    console.error("❌ Build failed:", error);
    if (error instanceof Error) {
      console.error("Details:", error.message);
    }
    process.exit(1);
  }
}

// Next.js の設定を確認・更新 (standalone モード有効化)
async function ensureNextJsConfig(projectRoot: string) {
  const nextConfigPath = path.join(projectRoot, 'next.config.js');
  const nextConfigMjsPath = path.join(projectRoot, 'next.config.mjs');
  
  let configPath = nextConfigPath;
  let isEsm = false;
  
  if (!fs.existsSync(nextConfigPath) && fs.existsSync(nextConfigMjsPath)) {
    configPath = nextConfigMjsPath;
    isEsm = true;
  }

  // 既存の設定を読み込む
  let configContent = '';
  if (fs.existsSync(configPath)) {
    configContent = fs.readFileSync(configPath, 'utf-8');
  }

  // standalone モードが設定されているか確認
  if (configContent.includes("output: 'standalone'") || configContent.includes('output: "standalone"')) {
    console.log('✅ Next.js standalone mode is already configured');
    return;
  }

  // standalone モードを追加
  const newConfig = isEsm 
    ? `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // その他の設定はここに追加
};

export default nextConfig;
`
    : `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // その他の設定はここに追加
};

module.exports = nextConfig;
`;

  fs.writeFileSync(configPath, newConfig, 'utf-8');
  console.log('✅ Next.js configured for standalone mode');
}

async function buildNextJs(projectRoot: string) {
  const { spawn } = require('child_process');
  
  return new Promise<void>((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    build.on('close', (code: number) => {
      if (code === 0) {
        console.log('✅ Next.js build completed');
        resolve();
      } else {
        reject(new Error(`Next.js build failed with code ${code}`));
      }
    });
  });
}

// ビルド成果物を出力ディレクトリにコピー
async function copyBuildArtifacts(projectRoot: string, outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const standaloneDir = path.join(projectRoot, '.next/standalone');
  const staticDir = path.join(projectRoot, '.next/static');
  const publicDir = path.join(projectRoot, 'public');

  if (!fs.existsSync(standaloneDir)) {
    console.warn('⚠️  Standalone output not found. Make sure output: "standalone" is set in next.config.js');
    return;
  }

  // standalone ディレクトリの内容をコピー
  console.log('📦 Copying standalone output...');
  const { execSync } = require('child_process');
  
  try {
    // Windows の場合は xcopy、それ以外は cp を使用
    if (process.platform === 'win32') {
      execSync(`xcopy "${standaloneDir}" "${outputDir}" /E /I /Y /Q`, { stdio: 'inherit' });
    } else {
      execSync(`cp -r "${standaloneDir}/." "${outputDir}/"`, { stdio: 'inherit' });
    }
    
    // .next/static をコピー
    if (fs.existsSync(staticDir)) {
      const targetStaticDir = path.join(outputDir, '.next/static');
      fs.mkdirSync(path.dirname(targetStaticDir), { recursive: true });
      
      if (process.platform === 'win32') {
        execSync(`xcopy "${staticDir}" "${targetStaticDir}" /E /I /Y /Q`, { stdio: 'inherit' });
      } else {
        execSync(`cp -r "${staticDir}" "${targetStaticDir}"`, { stdio: 'inherit' });
      }
    }

    // public ディレクトリをコピー
    if (fs.existsSync(publicDir)) {
      const targetPublicDir = path.join(outputDir, 'public');
      
      if (process.platform === 'win32') {
        execSync(`xcopy "${publicDir}" "${targetPublicDir}" /E /I /Y /Q`, { stdio: 'inherit' });
      } else {
        execSync(`cp -r "${publicDir}" "${targetPublicDir}"`, { stdio: 'inherit' });
      }
    }

    console.log('✅ Build artifacts copied successfully');
  } catch (error) {
    throw new Error(`Failed to copy build artifacts: ${error}`);
  }
}

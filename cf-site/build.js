/**
 * 构建脚本 — 生成 Cloudflare Workers 站点的 dist/
 *
 * 用法: node build.js
 *
 * 将主项目的静态资源复制到 dist/，并替换 js/ai-panel.js 中的 API_URL。
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(__dirname, 'dist');

/* ── 配置 ──────────────────────────────────────────────────────────────────── */
// 需要复制并做 API URL 替换的文件
const NEEDS_PATCH = new Set(['ai-panel.js']);
// 需要整体复制的子目录
const COPY_SUBDIRS = ['css', 'js'];
// 根目录需要复制的文件
const COPY_ROOT = ['index.html'];
// 忽略的目录
const SKIP_DIRS = new Set(['node_modules', 'api', 'cf-site', '.git', '.env', 'dist']);

/* ── 工具 ──────────────────────────────────────────────────────────────────── */
function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

/* ── 主逻辑 ─────────────────────────────────────────────────────────────────── */
console.log('Building cf-site/dist/ ...\n');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 复制根目录指定文件
for (const name of COPY_ROOT) {
  const src = join(ROOT, name);
  if (exists(src)) {
    copyFileSync(src, join(DIST, name));
    console.log(`  ${name}`);
  }
}

// 复制子目录
for (const sub of COPY_SUBDIRS) {
  const srcDir = join(ROOT, sub);
  const dstDir = join(DIST, sub);
  mkdirSync(dstDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = join(srcDir, name);
    const dstPath = join(dstDir, name);
    if (NEEDS_PATCH.has(name)) {
      let content = readFileSync(srcPath, 'utf8');
      content = content.replace(
        /const API_URL\s*=\s*['"][^'"]+['"]/,
        "const API_URL  = '/api/chat'"
      );
      writeFileSync(dstPath, content);
      console.log(`  patched ${sub}/${name}`);
    } else {
      copyFileSync(srcPath, dstPath);
      console.log(`  ${sub}/${name}`);
    }
  }
}

console.log('\n构建完成！部署步骤：');
console.log('  cd cf-site');
console.log('  npm install');
console.log('  npm run deploy');
console.log('\n首次部署需设置密钥：');
console.log('  npx wrangler secret put LLM_API_KEY');
console.log('  npx wrangler secret put LLM_API_URL');

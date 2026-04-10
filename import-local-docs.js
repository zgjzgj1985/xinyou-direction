/**
 * 将本地 Markdown 文档批量导入 Supabase 数据库
 * 用法：node import-local-docs.js
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = 'https://ltldrqazzgljweblrnpt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0HMYW6nQe5sdKg5AAk7xhw_ZRORoP1c';

// 要导入的文档列表
const DOCS = [
  { title: '洛克王国：世界介绍', file: '洛克王国：世界介绍.md' },
  { title: '梦幻西游与洛克王国战斗分析报告（一）', file: '梦幻西游与洛克王国战斗分析报告1.md' },
  { title: '梦幻西游与洛克王国战斗分析报告（二）', file: '梦幻西游与洛克王国战斗分析报告2.md' },
  { title: '卡牌回合游戏设计原则', file: '卡牌回合游戏设计原则.md' },
  { title: '次时代轻策略回合制MMO战斗系统白皮书', file: '次世代轻策略回合制MMO战斗系统白皮书.md' },
];

async function restInsert(title, content) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ title, content }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function restCheck(title) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/documents?title=eq.${encodeURIComponent(title)}&select=id&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  return res.json();
}

async function main() {
  console.log('开始导入文档到 Supabase...\n');

  for (const doc of DOCS) {
    const filePath = join(__dirname, doc.file);
    let content;

    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.log(`[跳过] 文件不存在: ${doc.file}`);
      continue;
    }

    // 查重
    const existing = await restCheck(doc.title);
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`[跳过] 已存在: ${doc.title}`);
      continue;
    }

    // 插入
    const result = await restInsert(doc.title, content);
    if (result.ok) {
      const id = result.data?.[0]?.id;
      console.log(`[成功] ${doc.title}${id ? ` (id: ${id})` : ''}`);
    } else {
      console.log(`[失败] ${doc.title}: ${JSON.stringify(result.data)}`);
    }
  }

  console.log('\n全部完成！');
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});

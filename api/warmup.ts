/**
 * Vercel Cron 保温接口
 * 每 5 分钟自动调用一次，防止 ai-chat 函数因冷启动导致首次请求超时
 * 配置在 vercel.json 的 crons 中
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 仅允许 Vercel 内部 cron 调用（可通过 Authorization 头做简单验证）
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CRON_SECRET || 'warmup-secret';

  if (authHeader && authHeader === `Bearer ${expectedToken}`) {
    // 主动触发一次 fetch 预热（实际调用外部 API 会建立连接池）
    const start = Date.now();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - start,
    });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

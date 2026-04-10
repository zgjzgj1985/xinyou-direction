/**
 * Vercel 保温：唤醒同目录下的 Serverless 运行时，减轻冷启动。
 * 浏览器与 Cron 均可 GET；无需密钥（仅返回 ok，不暴露敏感信息）。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  return res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
}

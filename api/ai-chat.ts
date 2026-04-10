import type { VercelRequest, VercelResponse } from '@vercel/node';

// OpenRouter API 配置
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// 模型映射（前端传入 key → OpenRouter 模型名）
const MODEL_MAP: Record<string, string> = {
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4o':      'openai/gpt-4o',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'gemini-1.5-flash': 'google/gemini-1.5-flash',
  '豆包-pro':      'doubao/pro',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 仅允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  // 检查 API Key
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: '未配置 OPENROUTER_API_KEY 环境变量' });
  }

  const { messages, modelKey = 'gpt-4o-mini' } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 格式错误' });
  }

  const modelId = MODEL_MAP[modelKey] || MODEL_MAP['gpt-4o-mini'];

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://xinyou-direction.vercel.app',
        'X-Title': '新游方向探索',
      },
      body: JSON.stringify({
        model: modelId,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `API 请求失败：${response.status} ${errText}` });
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };

    const reply = data?.choices?.[0]?.message?.content || '';

    return res.status(200).json({ reply });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `服务器内部错误：${message}` });
  }
}
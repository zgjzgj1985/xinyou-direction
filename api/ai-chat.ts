import type { VercelRequest, VercelResponse } from '@vercel/node';

const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_API_URL = process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

// 中转 API 配置

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 仅允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  // 检查 API Key
  if (!LLM_API_KEY) {
    return res.status(500).json({ error: '未配置 LLM_API_KEY 环境变量' });
  }

  const { messages } = req.body;
  const modelId = process.env.LLM_MODEL || '';

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 格式错误' });
  }

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
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
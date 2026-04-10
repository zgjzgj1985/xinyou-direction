import type { VercelRequest, VercelResponse } from '@vercel/node';

const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_API_URL = process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).send(null);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  if (!LLM_API_KEY) {
    return res.status(500).json({ error: '未配置 LLM_API_KEY 环境变量' });
  }

  const { messages } = req.body;
  const modelId = process.env.LLM_MODEL || '';

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 格式错误' });
  }

  const requestBody: Record<string, unknown> = {
    messages,
    stream: true,
  };
  if (modelId) {
    requestBody.model = modelId;
  }

  // 允许跨域 & SSE
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullText = '';

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://xinyou-direction.vercel.app',
        'X-Title': 'NewGameDirection',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.write(`event: error\ndata: ${JSON.stringify({ error: `API 请求失败：${response.status} ${errText}` })}\n\n`);
      res.end();
      return;
    }

    if (!response.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'API 无返回内容' })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // OpenAI-compatible SSE 格式：data: {...}\ndata: {...}\n
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          res.write(`event: done\ndata: ${JSON.stringify({ done: true })}\n\n`);
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          // ignore parse error
        }
      }
    }

    res.write(`event: done\ndata: ${JSON.stringify({ done: true, full: fullText })}\n\n`);
    res.end();

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: `服务器内部错误：${message}` })}\n\n`);
    res.end();
  }
}

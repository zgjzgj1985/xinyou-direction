import type { VercelRequest, VercelResponse } from '@vercel/node';

const LLM_API_KEY  = process.env.LLM_API_KEY  || '';
const LLM_API_URL  = process.env.LLM_API_URL  || 'https://openrouter.ai/api/v1/chat/completions';

/** 从 OpenAI 兼容流式 chunk 中提取文本 delta */
function extractDelta(parsed: unknown): string {
  const p = parsed as {
    choices?: Array<{ delta?: { content?: string } }>;
  };
  return p?.choices?.[0]?.delta?.content || '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── CORS 预检 ──────────────────────────────────────────────────────────────
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

  let body: { messages?: unknown[]; docTitle?: string; docContent?: string };
  try {
    body = req.body as { messages?: unknown[]; docTitle?: string; docContent?: string };
  } catch {
    return res.status(400).json({ error: '请求体格式错误' });
  }

  const { messages } = body;
  const modelId = process.env.LLM_MODEL || '';

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 格式错误' });
  }

  let fullText = '';

  // ── 用 ReadableStream 正确实现 SSE 流式转发 ────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: Record<string, unknown>) {
        const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      }

      function sendError(msg: string) {
        try {
          sendEvent('error', { error: msg });
          controller.close();
        } catch { /* ignore */ }
      }

      try {
        const response = await fetch(LLM_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LLM_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://xinyou-direction.vercel.app',
            'X-Title': 'NewGameDirection',
          },
          body: JSON.stringify({
            model: modelId || undefined,
            messages,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          sendError(`API 请求失败：${response.status} ${errText}`);
          return;
        }

        if (!response.body) {
          sendError('API 无返回内容');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const raw of lines) {
            const line = raw.replace(/\r$/, '').trim();
            if (!line.startsWith('data:')) continue;
            const data = line.startsWith('data: ')
              ? line.slice(6).trim()
              : line.slice(5).trim();

            if (data === '[DONE]') {
              sendEvent('done', { done: true });
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = extractDelta(parsed);
              if (delta) {
                fullText += delta;
                sendEvent('message', { delta });
              }
            } catch {
              // ignore parse error
            }
          }
        }

        sendEvent('done', { done: true, full: fullText });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendError(`服务器内部错误：${message}`);
      } finally {
        try {
          controller.close();
        } catch { /* ignore */ }
      }
    },
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Alt-Svc', 'clear');
  return res.send(stream);
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

const LLM_API_KEY = (process.env.LLM_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const LLM_API_URL = process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

/** OpenAI 兼容流式 chunk → 文本（含 Gemini 多段 content） */
function extractDelta(parsed: unknown): string {
  const choice = (parsed as { choices?: Array<{ delta?: Record<string, unknown> }> })?.choices?.[0];
  const delta = choice?.delta;
  if (!delta) return '';
  const c = delta.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        const o = part as { text?: string };
        return o?.text ?? '';
      })
      .join('');
  }
  return '';
}

function sendSse(res: VercelResponse, event: string, data: Record<string, unknown>) {
  const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  res.write(text);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const body = req.body as { messages?: unknown[]; docTitle?: string; docContent?: string } | undefined;
  const { messages } = body || {};
  const modelId = process.env.LLM_MODEL || '';

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 格式错误' });
  }

  // ── 以下走 SSE：必须用 Node 的 res.write，Vercel 上 res.send(Web ReadableStream) 常导致空 body ──
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Alt-Svc', 'clear');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let fullText = '';

  function endWithError(msg: string) {
    try {
      if (!res.writableEnded) {
        sendSse(res, 'error', { error: msg });
        res.end();
      }
    } catch {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://xinyou-direction.vercel.app',
        'X-Title': 'NewGameDirection',
      },
      body: JSON.stringify({
        ...(modelId ? { model: modelId } : {}),
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      endWithError(`API 请求失败：${response.status} ${errText}`);
      return;
    }

    if (!response.body) {
      endWithError('API 无返回内容');
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
        const data = line.startsWith('data: ') ? line.slice(6).trim() : line.slice(5).trim();

        if (data === '[DONE]') {
          sendSse(res, 'done', { done: true });
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = extractDelta(parsed);
          if (delta) {
            fullText += delta;
            sendSse(res, 'message', { delta });
          }
        } catch {
          // ignore parse error
        }
      }
    }

    sendSse(res, 'done', { done: true, full: fullText });
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    endWithError(`服务器内部错误：${message}`);
  }
}

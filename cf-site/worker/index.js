/**
 * Cloudflare Workers — 静态资源（env.ASSETS）+ /api/chat
 *
 * wrangler.toml 使用 [assets] directory = "./dist" + run_worker_first = true，
 * 与官方文档一致：https://developers.cloudflare.com/workers/static-assets/binding/
 */

/* ── 请求处理主入口 ───────────────────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/chat' || path === '/api/ai-chat') {
      return handleChat(request, env, ctx);
    }

    if (!env.ASSETS) {
      return new Response('ASSETS binding missing', { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};

/* ── AI 对话接口 ─────────────────────────────────────────────────────────── */
async function handleChat(request, env, ctx) {
  const LLM_API_KEY = env.LLM_API_KEY || '';
  // 与 api/ai-chat.ts 一致：未配置时走 OpenRouter，避免与海外版行为不一致
  const LLM_API_URL =
    env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL_ID = env.LLM_MODEL || '';

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'POST') {
    return json({ error: '只支持 POST 请求' }, 405);
  }

  if (!LLM_API_KEY) {
    return streamError('未配置 LLM_API_KEY，请在 Cloudflare Dashboard → Workers & Pages → Settings → Variables 中设置。');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求 body 解析失败' }, 400);
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages 格式错误' }, 400);
  }

  // 流式转发
  const requestBody = { messages, stream: true };
  if (MODEL_ID) requestBody.model = MODEL_ID;

  let upstream;
  try {
    upstream = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${LLM_API_KEY}`,
        'Content-Type':    'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    return streamError('无法连接 AI 服务：' + (err?.message || String(err)));
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    return streamError(`AI 服务返回错误 ${upstream.status}：${errText.slice(0, 200)}`);
  }

  if (!upstream.body) {
    return streamError('AI 服务无返回内容');
  }

  // 透传上游 SSE 流
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = upstream.body.getReader();

  ctx.waitUntil(
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        await writer.close();
      } catch (e) {
        try { await writer.abort(e); } catch { /* ignore */ }
      }
    })()
  );

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type':               'text/event-stream; charset=utf-8',
      'Cache-Control':              'no-cache',
      'Connection':                  'keep-alive',
      'X-Accel-Buffering':          'no',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function streamError(msg) {
  return new Response(`data: ${JSON.stringify({ error: msg })}\n\n`, {
    status: 200,
    headers: {
      'Content-Type':               'text/event-stream; charset=utf-8',
      'Cache-Control':              'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

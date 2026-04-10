// api/ai-chat.ts
// Vercel Serverless Function — AI 中转代理
// API Key 不暴露在前端，部署在服务端

import type { VercelRequest, VercelResponse } from '@vercel/node';

const LLM_API_URL = process.env.LLM_API_URL || 'https://api.zhtunnel.com/v1/chat/completions';
const LLM_API_KEY  = process.env.LLM_API_KEY  || '';
const LLM_MODEL    = process.env.LLM_MODEL    || 'gpt-4o-mini';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST 请求' });
  }

  try {
    const { messages, docTitle, docContent } = req.body as {
      messages: Array<{ role: string; content: string }>;
      docTitle?: string;
      docContent?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: '缺少 messages 参数' });
    }

    // 构建系统提示词，注入当前文档上下文
    const systemPrompt = docContent
      ? `你是一个游戏设计文档分析助手。当前正在阅读的文档是「${docTitle}」，内容如下：\n\n${String(docContent).slice(0, 3000)}`
      : '你是一个游戏设计文档分析助手，专注于回合制战斗系统设计。';

    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    // 调用 LLM
    const llmRes = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: chatMessages,
        stream: false,
        temperature: 0.7,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      return res.status(502).json({ error: 'LLM 调用失败', detail: errText });
    }

    const data = await llmRes.json();
    const reply = data.choices?.[0]?.message?.content || '';

    return res.status(200).json({ reply });

  } catch (err: any) {
    console.error('AI Chat Error:', err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
}
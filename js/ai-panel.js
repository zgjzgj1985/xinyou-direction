/**
 * AI 对话面板
 * — 与当前文档关联，支持快捷操作和一键插入文档，流式输出
 */
import { supabase } from './supabase.js';

// ── 常量 ─────────────────────────────────────────────────────────────────────
const API_BASE = '';
const API_URL  = '/api/ai-chat';

const MODEL_LABELS = {
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4o':      'GPT-4o',
  'claude-3.5-sonnet': 'Claude',
  'gemini-1.5-flash': 'Gemini',
  'gemini-3.1-pro':   'Gemini 3.1 Pro',
  '豆包-pro':      '豆包',
};

// ── 状态 ─────────────────────────────────────────────────────────────────────
let chatHistory = [];           // 当前会话历史
let isGenerating = false;      // 是否正在生成
let isAIPanelOpen = false;     // 移动端面板是否打开
let modelKey = 'gpt-4o-mini'; // 当前模型

// ── 引导 ─────────────────────────────────────────────────────────────────────
export function initAIPanel() {
  bindEvents();
  renderEmptyHint();
}

// ── 事件绑定 ─────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('aiSendBtn')?.addEventListener('click', sendMessage);
  document.getElementById('aiInput')?.addEventListener('keydown', handleInputKey);
  document.getElementById('aiInput')?.addEventListener('input', autoResizeTextarea);
  document.getElementById('aiSendDoc')?.addEventListener('click', sendCurrentDoc);
  document.getElementById('aiGenTags')?.addEventListener('click', generateTags);
  document.getElementById('aiSummarize')?.addEventListener('click', summarizeDoc);
  document.getElementById('aiAnalyze')?.addEventListener('click', analyzeDoc);
  document.getElementById('aiPanelClose')?.addEventListener('click', closeAIPanel);
  document.getElementById('aiPanelOpenBtn')?.addEventListener('click', openAIPanel);
  document.getElementById('aiStopBtn')?.addEventListener('click', stopGenerating);
}

// ── 发送消息 ─────────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('aiInput');
  const text  = input?.value.trim();
  if (!text || isGenerating) return;

  input.value = '';
  autoResizeTextarea.call(input);

  chatHistory.push({ role: 'user', content: text });
  renderMessages();

  showTyping();
  await generateAIStream(chatHistory);
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── 流式调用 AI ─────────────────────────────────────────────────────────────
let _abortController = null;

async function generateAIStream(messages, opts = {}) {
  const { docTitle = '', docContent = '', onDone } = opts;
  isGenerating = true;
  _abortController = new AbortController();
  setQuickBtnsDisabled(true);
  updateStopBtn(true);

  // 建立消息占位
  let msgDiv = null;
  let msgText = '';
  let msgPending = true; // 是否还在等待内容

  function ensureMsgDiv() {
    if (!msgDiv) {
      msgDiv = addAssistantMessage('');
      msgPending = true;
    }
  }

  function flushMsg() {
    if (msgDiv) {
      msgDiv.innerHTML = parseAIResponse(msgText);
      scrollToBottom();
    }
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, docTitle, docContent }),
      signal: _abortController.signal,
    });

    if (!res.ok) {
      removeTyping();
      ensureMsgDiv();
      msgDiv.innerHTML = parseAIResponse(`请求失败（${res.status}），请稍后重试。`);
      chatHistory.push({ role: 'assistant', content: msgText });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    removeTyping();
    ensureMsgDiv();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        if (!raw.startsWith('data: ')) continue;
        const data = raw.slice(6).trim();
        if (!data) continue;

        // SSE event 格式: event: xxx\ndata: {...}\n\n
        // 简单兼容：如果有换行说明是 event+data 混在一起
        let event = 'message';
        let jsonStr = data;
        if (data.includes('\n')) {
          const parts = data.split('\n');
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i].trim();
            if (!p) continue;
            if (p.startsWith('event:')) {
              event = p.slice(6).trim();
            } else if (p.startsWith('data:')) {
              jsonStr = p.slice(5).trim();
            } else {
              jsonStr = p;
            }
          }
        }

        try {
          const parsed = JSON.parse(jsonStr);

          if (event === 'error') {
            ensureMsgDiv();
            msgDiv.innerHTML = parseAIResponse('错误：' + (parsed.error || '未知错误'));
            return;
          }

          if (event === 'done') {
            msgPending = false;
            chatHistory.push({ role: 'assistant', content: msgText });
            onDone?.();
            return;
          }

          if (parsed.delta) {
            msgText += parsed.delta;
            msgPending = true;
            flushMsg();
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    // 意外结束
    if (msgPending) {
      chatHistory.push({ role: 'assistant', content: msgText });
    }

  } catch (err) {
    removeTyping();
    if (err.name === 'AbortError') {
      // 用户主动取消
      if (msgText) {
        chatHistory.push({ role: 'assistant', content: msgText });
      }
    } else {
      ensureMsgDiv();
      msgDiv.innerHTML = parseAIResponse('网络错误：' + err.message);
      if (msgText) chatHistory.push({ role: 'assistant', content: msgText });
    }
  } finally {
    isGenerating = false;
    _abortController = null;
    setQuickBtnsDisabled(false);
    updateStopBtn(false);
  }
}

// 停止生成
function stopGenerating() {
  _abortController?.abort();
}

// 更新停止按钮可见性
function updateStopBtn(show) {
  const btn = document.getElementById('aiStopBtn');
  if (btn) btn.style.display = show ? 'inline-flex' : 'none';
}

// ── 快捷操作（统一用流式）──────────────────────────────────────────────────

/** 发送当前文档 */
async function sendCurrentDoc() {
  const doc = getCurrentDocument();
  if (!doc) { showToast('请先打开一个文档'); return; }

  const intro = `请阅读以下文档内容，然后等待我的进一步提问。\n\n文档：「${doc.title}」\n\n${doc.content}`;
  chatHistory.push({ role: 'user', content: intro });
  renderMessages();

  showTyping();
  await generateAIStream(chatHistory, { docTitle: doc.title, docContent: doc.content });
}

/** 生成标签 */
async function generateTags() {
  const doc = getCurrentDocument();
  if (!doc) { showToast('请先打开一个文档'); return; }

  const systemPrompt = `你是一个游戏设计文档标签生成专家。请分析以下文档，提取最核心的标签。

要求：
- 返回 3-5 个标签
- 每个标签 2-4 个字
- 只返回标签本身，用中文逗号分隔，不要任何解释
- 标签参考：战斗系统、数值平衡、回合制、技能设计、宠物系统、角色设计、战斗公式、速度机制、装备系统、Boss设计、伤害计算、Buff系统、怒气机制

示例返回格式：
战斗系统, 回合制, 速度机制`;

  const tempHistory = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `文档：「${doc.title}」\n\n${doc.content.slice(0, 2000)}` }
  ];

  isGenerating = true;
  _abortController = new AbortController();
  setQuickBtnsDisabled(true);
  updateStopBtn(true);
  showTyping();

  let msgDiv = null;
  let msgText = '';
  let tagsResult = '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tempHistory, docTitle: doc.title, docContent: '' }),
      signal: _abortController.signal,
    });

    removeTyping();

    if (!res.ok) {
      addAssistantMessage(`标签生成失败（${res.status}），请稍后重试。`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    msgDiv = addAssistantMessage('');
    scrollToBottom();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        if (!raw.startsWith('data: ')) continue;
        const data = raw.slice(6).trim();
        if (!data) continue;

        let event = 'message';
        let jsonStr = data;
        if (data.includes('\n')) {
          const parts = data.split('\n');
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('event:')) event = trimmed.slice(6).trim();
            else if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
            else jsonStr = trimmed;
          }
        }

        try {
          const parsed = JSON.parse(jsonStr);
          if (event === 'done') {
            tagsResult = msgText;
            renderTagsResult(msgDiv, tagsResult);
            return;
          }
          if (parsed.delta) {
            msgText += parsed.delta;
            msgDiv.innerHTML = parseAIResponse('推荐标签：' + msgText);
            scrollToBottom();
          }
        } catch { /* ignore */ }
      }
    }

    tagsResult = msgText;
    renderTagsResult(msgDiv, tagsResult);

  } catch (err) {
    removeTyping();
    if (err.name !== 'AbortError') {
      addAssistantMessage('标签生成失败：' + err.message);
    } else if (msgText) {
      chatHistory.push({ role: 'assistant', content: msgText });
    }
  } finally {
    isGenerating = false;
    _abortController = null;
    setQuickBtnsDisabled(false);
    updateStopBtn(false);
  }
}

function renderTagsResult(msgDiv, tagsText) {
  if (!msgDiv || !tagsText) return;
  msgDiv.innerHTML = parseAIResponse('推荐标签：' + tagsText);
  scrollToBottom();
}

/** 总结全文 */
async function summarizeDoc() {
  const doc = getCurrentDocument();
  if (!doc) { showToast('请先打开一个文档'); return; }

  const tempHistory = [
    { role: 'system', content: '你是一个游戏设计文档分析助手，擅长提炼关键信息。用简洁的要点形式呈现核心内容。' },
    { role: 'user', content: `请总结以下文档的核心内容，用 5-8 个简洁要点呈现。\n\n文档：「${doc.title}」\n\n${doc.content.slice(0, 3000)}` }
  ];

  isGenerating = true;
  _abortController = new AbortController();
  setQuickBtnsDisabled(true);
  updateStopBtn(true);
  showTyping();

  let msgText = '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tempHistory, docTitle: doc.title, docContent: '' }),
      signal: _abortController.signal,
    });

    removeTyping();

    if (!res.ok) {
      addAssistantMessage(`总结失败（${res.status}），请稍后重试。`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const msgDiv = addAssistantMessage('');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        if (!raw.startsWith('data: ')) continue;
        const data = raw.slice(6).trim();
        if (!data) continue;

        let event = 'message';
        let jsonStr = data;
        if (data.includes('\n')) {
          const parts = data.split('\n');
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('event:')) event = trimmed.slice(6).trim();
            else if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
            else jsonStr = trimmed;
          }
        }

        try {
          const parsed = JSON.parse(jsonStr);
          if (event === 'done') {
            chatHistory.push({ role: 'assistant', content: msgText });
            return;
          }
          if (parsed.delta) {
            msgText += parsed.delta;
            msgDiv.innerHTML = parseAIResponse(msgText);
            scrollToBottom();
          }
        } catch { /* ignore */ }
      }
    }

    chatHistory.push({ role: 'assistant', content: msgText });

  } catch (err) {
    removeTyping();
    if (err.name !== 'AbortError') {
      addAssistantMessage('总结失败：' + err.message);
    } else if (msgText) {
      chatHistory.push({ role: 'assistant', content: msgText });
    }
  } finally {
    isGenerating = false;
    _abortController = null;
    setQuickBtnsDisabled(false);
    updateStopBtn(false);
  }
}

/** 分析文档（数值平衡 / 设计建议等） */
async function analyzeDoc() {
  const doc = getCurrentDocument();
  if (!doc) { showToast('请先打开一个文档'); return; }

  const tempHistory = [
    { role: 'system', content: '你是一个资深游戏数值策划，专注于回合制游戏的战斗系统设计。善于从专业角度分析数值平衡、战斗机制设计，并给出改进建议。' },
    { role: 'user', content: `请从以下角度分析这份游戏设计文档，并给出专业意见：\n1. 数值平衡是否合理\n2. 战斗机制是否有改进空间\n3. 有哪些设计亮点\n4. 可能存在的平衡风险\n\n文档：「${doc.title}」\n\n${doc.content.slice(0, 3000)}` }
  ];

  isGenerating = true;
  _abortController = new AbortController();
  setQuickBtnsDisabled(true);
  updateStopBtn(true);
  showTyping();

  let msgText = '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tempHistory, docTitle: doc.title, docContent: '' }),
      signal: _abortController.signal,
    });

    removeTyping();

    if (!res.ok) {
      addAssistantMessage(`分析失败（${res.status}），请稍后重试。`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const msgDiv = addAssistantMessage('');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        if (!raw.startsWith('data: ')) continue;
        const data = raw.slice(6).trim();
        if (!data) continue;

        let event = 'message';
        let jsonStr = data;
        if (data.includes('\n')) {
          const parts = data.split('\n');
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('event:')) event = trimmed.slice(6).trim();
            else if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
            else jsonStr = trimmed;
          }
        }

        try {
          const parsed = JSON.parse(jsonStr);
          if (event === 'done') {
            chatHistory.push({ role: 'assistant', content: msgText });
            return;
          }
          if (parsed.delta) {
            msgText += parsed.delta;
            msgDiv.innerHTML = parseAIResponse(msgText);
            scrollToBottom();
          }
        } catch { /* ignore */ }
      }
    }

    chatHistory.push({ role: 'assistant', content: msgText });

  } catch (err) {
    removeTyping();
    if (err.name !== 'AbortError') {
      addAssistantMessage('分析失败：' + err.message);
    } else if (msgText) {
      chatHistory.push({ role: 'assistant', content: msgText });
    }
  } finally {
    isGenerating = false;
    _abortController = null;
    setQuickBtnsDisabled(false);
    updateStopBtn(false);
  }
}

// ── 渲染 ─────────────────────────────────────────────────────────────────────

function renderEmptyHint() {
  const container = document.getElementById('aiMessages');
  if (!container) return;
  container.innerHTML = `
    <div class="ai-empty-hint">
      <strong>AI 助手</strong>
      选择一个文档后，可以开始对话或使用快捷分析功能。
    </div>`;
}

function renderMessages() {
  const container = document.getElementById('aiMessages');
  if (!container) return;

  if (chatHistory.length === 0) {
    renderEmptyHint();
    return;
  }

  container.innerHTML = chatHistory.map(msg => {
    const cls = msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant';
    const body = msg.role === 'user'
      ? escapeHtml(msg.content)
      : parseAIResponse(msg.content);
    return `<div class="ai-msg ${cls}">${body}</div>`;
  }).join('');

  scrollToBottom();
}

function addAssistantMessage(text) {
  const container = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.className = 'ai-msg ai-msg-assistant';
  div.innerHTML = parseAIResponse(text);
  container.appendChild(div);
  scrollToBottom();
  return div;
}

function showTyping() {
  const container = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.className = 'ai-typing';
  div.id = 'aiTyping';
  div.innerHTML = `
    <div class="ai-typing-dots">
      <div class="ai-typing-dot"></div>
      <div class="ai-typing-dot"></div>
      <div class="ai-typing-dot"></div>
    </div>
    <span>思考中...</span>`;
  container.appendChild(div);
  scrollToBottom();
}

function removeTyping() {
  document.getElementById('aiTyping')?.remove();
}

function appendInsertBtns() {
  // 已移除
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function autoResizeTextarea() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 90) + 'px';
}

function scrollToBottom() {
  const container = document.getElementById('aiMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

function setQuickBtnsDisabled(disabled) {
  document.querySelectorAll('.ai-quick-btn').forEach(btn => {
    btn.disabled = disabled;
  });
  const sendBtn = document.getElementById('aiSendBtn');
  if (sendBtn) sendBtn.disabled = disabled;
}

function openAIPanel() {
  document.getElementById('aiPanel')?.classList.add('is-open');
  isAIPanelOpen = true;
}

function closeAIPanel() {
  document.getElementById('aiPanel')?.classList.remove('is-open');
  isAIPanelOpen = false;
}

function getCurrentDocument() {
  if (!window._currentDocId) return null;
  return window._documents?.find(d => d.id === window._currentDocId);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseAIResponse(html) {
  let h = escapeHtml(html);
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  h = h.replace(/^(?!<[huplo]|<pre|<code|<ul|<ol|<strong)(.+)$/gm, '<p>$1</p>');
  h = h.replace(/<p>\s*<\/p>/g, '');
  return h;
}

function showToast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  t._timer = setTimeout(() => {
    t.classList.remove('toast-visible');
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

function getMsgPureText(msgEl) {
  // 已移除按钮功能，此函数保留备用
  return msgEl.textContent || '';
}

// 导出
export { API_URL };

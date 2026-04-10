/**
 * AI 对话面板
 * — 与当前文档关联，支持快捷操作和一键插入文档，流式输出
 */
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
  document.getElementById('aiSummarize')?.addEventListener('click', summarizeDoc);
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

/** 判断是否是网络层可重试错误 */
function isNetworkRetryableError(err) {
  const msg = err?.message || '';
  return (
    msg.includes('QUIC') ||
    msg.includes('net::ERR_') ||
    msg.includes('network error') ||
    err.name === 'TypeError'
  );
}

/** 通用 fetch 包装：网络错误时自动重试一次 */
async function fetchWithRetry(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (!isNetworkRetryableError(err)) throw err;
    await new Promise(r => setTimeout(r, 500));
    return fetch(url, options);
  }
}

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
    const res = await fetchWithRetry(API_URL, {
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
    /** 服务端每帧先发 event: 再发 data:，必须配对，否则 done/error 永远对不上 */
    let pendingEvent = 'message';

    removeTyping();
    ensureMsgDiv();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.replace(/\r$/, '').trim();
        if (line === '') continue;

        const evMatch = line.match(/^event:\s*(.*)$/);
        if (evMatch) {
          pendingEvent = evMatch[1].trim();
          continue;
        }

        if (!line.startsWith('data:')) continue;
        const data = line.startsWith('data: ')
          ? line.slice(6).trim()
          : line.slice(5).trim();
        if (!data) continue;

        const event = pendingEvent;
        pendingEvent = 'message';

        let jsonStr = data;
        if (data.includes('\n')) {
          const parts = data.split('\n');
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('event:')) { /* nested, ignore */ }
            else if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
            else jsonStr = trimmed;
          }
        }

        try {
          const parsed = JSON.parse(jsonStr);

          if (event === 'error') {
            ensureMsgDiv();
            msgDiv.innerHTML = parseAIResponse('错误：' + (parsed.error || '未知错误'));
            return;
          }

          if (event === 'done' || parsed.done) {
            msgPending = false;
            if (!msgText && typeof parsed.full === 'string') msgText = parsed.full;
            chatHistory.push({ role: 'assistant', content: msgText });
            flushMsg();
            onDone?.();
            return;
          }

          if (event === 'thinking' && parsed.delta) {
            continue;
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

/** 总结全文 */
async function summarizeDoc() {
  const doc = getCurrentDocument();
  if (!doc) { showToast('请先打开一个文档'); return; }

  const tempHistory = [
    { role: 'system', content: '你是一个游戏设计文档分析助手，擅长提炼关键信息。请详细展开分析，每个要点都给出具体解释和说明。' },
    { role: 'user', content: `请详细总结以下文档的核心内容，包括：核心玩法、主要机制、设计亮点、潜在问题等。请展开说明，不要只列要点。\n\n文档：「${doc.title}」\n\n${doc.content}` }
  ];

  isGenerating = true;
  _abortController = new AbortController();
  setQuickBtnsDisabled(true);
  updateStopBtn(true);
  showTyping();

  let msgText = '';

  try {
    const res = await fetchWithRetry(API_URL, {
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
    let pendingEvent = 'message';

    const msgDiv = addAssistantMessage('');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.replace(/\r$/, '').trim();
        if (line === '') continue;

        const evMatch = line.match(/^event:\s*(.*)$/);
        if (evMatch) {
          pendingEvent = evMatch[1].trim();
          continue;
        }

        if (!line.startsWith('data:')) continue;
        const data = line.startsWith('data: ')
          ? line.slice(6).trim()
          : line.slice(5).trim();
        if (!data) continue;

        const event = pendingEvent;
        pendingEvent = 'message';

        let jsonStr = data;
        if (data.includes('\n')) {
          const parts = data.split('\n');
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
            else jsonStr = trimmed;
          }
        }

        try {
          const parsed = JSON.parse(jsonStr);
          if (event === 'done' || parsed.done) {
            if (!msgText && typeof parsed.full === 'string') msgText = parsed.full;
            chatHistory.push({ role: 'assistant', content: msgText });
            return;
          }
          if (event === 'thinking' && parsed.delta) {
            continue;
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

/**
 * AI 对话面板
 * — 与当前文档关联，支持快捷操作和一键插入文档
 */
import { supabase } from './supabase.js';

// ── 常量 ─────────────────────────────────────────────────────────────────────
const API_BASE = 'https://xin-you-fang-xiang.vercel.app';
const API_URL  = API_BASE + '/api/ai-chat';

const MODEL_LABELS = {
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4o':      'GPT-4o',
  'claude-3.5-sonnet': 'Claude',
  'gemini-1.5-flash': 'Gemini',
  '豆包-pro':      '豆包',
};

// ── 状态 ─────────────────────────────────────────────────────────────────────
let chatHistory = [];           // 当前会话历史
let isGenerating = false;      // 是否正在生成
let isAIPanelOpen = false;     // 移动端面板是否打开
let modelKey = 'gpt-4o-mini'; // 当前模型（从 .env 读，实际用常量）

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

  // 添加"正在输入"动画
  showTyping();
  await generateAIResponse(chatHistory);
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── 调用 AI 中转接口 ───────────────────────────────────────────────────────────
async function generateAIResponse(messages) {
  isGenerating = true;
  setQuickBtnsDisabled(true);

  const doc = getCurrentDocument();
  const docContent = doc?.content || '';
  const docTitle   = doc?.title   || '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, docTitle, docContent }),
    });

    const data = await res.json();

    removeTyping();

    if (data.error) {
      addAssistantMessage('请求失败：' + data.error);
      return;
    }

    chatHistory.push({ role: 'assistant', content: data.reply });
    renderMessages();

    // 在最后一条 AI 回复后追加插入按钮
    setTimeout(() => appendInsertBtns(), 100);

  } catch (err) {
    removeTyping();
    addAssistantMessage('网络错误：' + err.message);
  } finally {
    isGenerating = false;
    setQuickBtnsDisabled(false);
  }
}

// ── 快捷操作 ─────────────────────────────────────────────────────────────────

/** 发送当前文档 */
async function sendCurrentDoc() {
  const doc = getCurrentDocument();
  if (!doc) return;

  const intro = `请阅读以下文档内容，然后等待我的进一步提问。\n\n文档：「${doc.title}」`;
  chatHistory.push({ role: 'user', content: intro });
  renderMessages();
  showTyping();
  await generateAIResponse(chatHistory);
}

/** 生成标签 */
async function generateTags() {
  const doc = getCurrentDocument();
  if (!doc) return;

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
  setQuickBtnsDisabled(true);
  showTyping();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tempHistory, docTitle: doc.title, docContent: '' }),
    });
    const data = await res.json();
    removeTyping();

    if (data.reply) {
      // 智能追加标签
      addAssistantMessage('推荐标签：' + data.reply);
      setTimeout(() => {
        const lastMsg = document.querySelector('.ai-msg:last-child');
        const wrap = document.createElement('div');
        wrap.className = 'ai-insert-wrap';

        const insertBtn = document.createElement('button');
        insertBtn.className = 'ai-insert-btn';
        insertBtn.textContent = '📎 追加到文档';
        insertBtn.addEventListener('click', () => insertTagsToDoc(data.reply));
        wrap.appendChild(insertBtn);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'ai-insert-btn';
        copyBtn.textContent = '📋 复制';
        copyBtn.addEventListener('click', () => navigator.clipboard.writeText(data.reply));
        wrap.appendChild(copyBtn);

        lastMsg?.appendChild(wrap);
      }, 100);
    }
  } catch (err) {
    removeTyping();
    addAssistantMessage('标签生成失败：' + err.message);
  } finally {
    isGenerating = false;
    setQuickBtnsDisabled(false);
  }
}

/** 总结全文 */
async function summarizeDoc() {
  const doc = getCurrentDocument();
  if (!doc) return;

  const tempHistory = [
    { role: 'system', content: '你是一个游戏设计文档分析助手，擅长提炼关键信息。用简洁的要点形式呈现核心内容。' },
    { role: 'user', content: `请总结以下文档的核心内容，用 5-8 个简洁要点呈现。\n\n文档：「${doc.title}」\n\n${doc.content.slice(0, 3000)}` }
  ];

  isGenerating = true;
  setQuickBtnsDisabled(true);
  showTyping();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tempHistory, docTitle: doc.title, docContent: '' }),
    });
    const data = await res.json();
    removeTyping();

    if (data.reply) {
      addAssistantMessage(data.reply);
      setTimeout(() => appendInsertBtns(), 100);
    }
  } catch (err) {
    removeTyping();
    addAssistantMessage('总结失败：' + err.message);
  } finally {
    isGenerating = false;
    setQuickBtnsDisabled(false);
  }
}

/** 分析文档（数值平衡 / 设计建议等） */
async function analyzeDoc() {
  const doc = getCurrentDocument();
  if (!doc) return;

  const tempHistory = [
    { role: 'system', content: '你是一个资深游戏数值策划，专注于回合制游戏的战斗系统设计。善于从专业角度分析数值平衡、战斗机制设计，并给出改进建议。' },
    { role: 'user', content: `请从以下角度分析这份游戏设计文档，并给出专业意见：\n1. 数值平衡是否合理\n2. 战斗机制是否有改进空间\n3. 有哪些设计亮点\n4. 可能存在的平衡风险\n\n文档：「${doc.title}」\n\n${doc.content.slice(0, 3000)}` }
  ];

  isGenerating = true;
  setQuickBtnsDisabled(true);
  showTyping();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tempHistory, docTitle: doc.title, docContent: '' }),
    });
    const data = await res.json();
    removeTyping();

    if (data.reply) {
      addAssistantMessage(data.reply);
      setTimeout(() => appendInsertBtns(), 100);
    }
  } catch (err) {
    removeTyping();
    addAssistantMessage('分析失败：' + err.message);
  } finally {
    isGenerating = false;
    setQuickBtnsDisabled(false);
  }
}

// ── 插入文档 ─────────────────────────────────────────────────────────────────

function insertTagsToDoc(tagsText) {
  const tags = tagsText.split(/[,，、]/).map(t => t.trim()).filter(Boolean);
  if (!tags.length) return;

  const tagLine = `\n\n---\n**AI 推荐标签**：${tags.join('、')}\n`;
  appendToCurrentDoc(tagLine);
  showToast('标签已添加到文档末尾');
}

function insertToDocEnd(content) {
  appendToCurrentDoc(`\n\n---\n## AI 分析结果\n\n${content}`);
  showToast('内容已插入到文档末尾');
}

function appendToCurrentDoc(text) {
  if (window._cmView) {
    const current = window._cmView.getValue?.() || '';
    window._cmView.setValue?.(current + text);
  } else {
    const ta = document.getElementById('fallbackEditor');
    if (ta) ta.value += text;
  }
  // 如果在预览模式，追加到数据库（自动保存）
  scheduleAutoSave(text);
}

function scheduleAutoSave(extraText) {
  // 通知 main.js 执行保存（通过自定义事件）
  window.dispatchEvent(new CustomEvent('ai-content-append', { detail: { text: extraText } }));
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
  const lastMsg = document.querySelector('.ai-msg:last-child');
  if (!lastMsg || lastMsg.classList.contains('ai-msg-user')) return;
  if (lastMsg.querySelector('.ai-insert-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'ai-insert-wrap';

  const insertBtn = document.createElement('button');
  insertBtn.className = 'ai-insert-btn';
  insertBtn.textContent = '📎 插入到文档末尾';
  insertBtn.addEventListener('click', () => {
    const content = lastMsg.textContent || '';
    insertToDocEnd(content);
  });
  wrap.appendChild(insertBtn);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'ai-insert-btn';
  copyBtn.textContent = '📋 复制全部';
  copyBtn.addEventListener('click', () => {
    const content = lastMsg.textContent || '';
    navigator.clipboard.writeText(content);
    showToast('已复制到剪贴板');
  });
  wrap.appendChild(copyBtn);

  lastMsg.appendChild(wrap);
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
  // 简单的消息格式化：处理 **加粗**、- 列表、```代码块```
  let h = escapeHtml(html);

  // 代码块
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // 行内代码
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 加粗
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 列表项
  h = h.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // 段落
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

// 导出 API URL（其他模块可能需要）
export { API_URL };

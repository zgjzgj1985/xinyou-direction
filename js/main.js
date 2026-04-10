/**
 * 多人实时协作文档编辑网站 - 主逻辑
 *
 * 技术方案：Supabase 实时数据库
 * - 文档数据存储在 Supabase PostgreSQL
 * - 通过 Supabase Realtime 实现多人同步编辑
 * - 编辑器使用现有的 CodeMirror 6
 */
import { supabase } from './supabase.js';
import { createMarkdownEditor } from './cm-editor.bundle.mjs';

// ── 状态 ──────────────────────────────────────────────────────────────────────
let documents = [];           // 文档列表
let currentDocId = null;      // 当前编辑的文档 ID
let rawMarkdown = '';         // 当前文档内容
let cmView = null;            // CodeMirror 编辑器实例
let autoSaveTimer = null;     // 自动保存定时器
let isRemoteUpdate = false;   // 标记是否为远程更新（避免更新自己触发的回显）
let realtimeChannel = null;   // Supabase 实时频道

// ── 引导 ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadDocuments();
    bindGlobalEvents();
    // 默认加载第一个文档
    if (documents.length > 0) {
      await openDocument(documents[0].id);
    } else {
      showWelcome();
    }
  } catch (err) {
    console.error('页面初始化失败', err);
    showError('页面加载失败：' + err.message);
  }
});

// ── 加载文档列表 ─────────────────────────────────────────────────────────────
async function loadDocuments() {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  documents = data || [];
  renderDocList();
}

// ── 渲染文档列表 ─────────────────────────────────────────────────────────────
function renderDocList() {
  const list = document.getElementById('sideNavList');
  const count = document.getElementById('sideNavCount');
  count.textContent = documents.length > 0 ? `${documents.length} 篇` : '暂无文档';

  if (documents.length === 0) {
    list.innerHTML = '<p class="empty-notice" style="padding:16px 12px">暂无文档，点击上方「新建」创建一个</p>';
    return;
  }

  list.innerHTML = documents.map((doc) => `
    <button type="button" class="side-nav-item ${doc.id === currentDocId ? 'active' : ''}"
      data-doc-id="${doc.id}">
      <span class="side-nav-index">${doc.title.slice(0, 1)}</span>
      <span class="side-nav-text">
        <span class="side-nav-item-title">${e(doc.title)}</span>
        <span class="side-nav-item-meta">${formatDate(doc.updated_at)}</span>
      </span>
    </button>
  `).join('');

  list.querySelectorAll('.side-nav-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.docId;
      await openDocument(id);
      closeMobileDrawer();
    });
  });
}

// ── 打开文档 ─────────────────────────────────────────────────────────────────
async function openDocument(id) {
  clearTimeout(autoSaveTimer);
  disposeCurrentEditor();

  currentDocId = id;
  renderDocList();

  const doc = documents.find(d => d.id === id);
  if (!doc) return;

  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="content-header content-header-row">
      <h2>${e(doc.title)}</h2>
      <div class="content-actions">
        <button type="button" class="action-btn action-btn-primary" id="editBtn">编辑</button>
        <button type="button" class="action-btn action-btn-secondary" id="newDocBtn">新建</button>
        <button type="button" class="action-btn action-btn-ghost" id="deleteBtn" title="删除文档">删除</button>
        <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn">目录</button>
      </div>
    </div>
    <div class="pane-wrap pane-wrap-view">
      <div class="pane pane-preview markdown-body">${parseMarkdown(doc.content)}</div>
    </div>`;

  document.getElementById('editBtn')?.addEventListener('click', () => enterEditMode(doc));
  document.getElementById('newDocBtn')?.addEventListener('click', showNewDocDialog);
  document.getElementById('deleteBtn')?.addEventListener('click', () => deleteDocument(id));
  document.getElementById('mobileDirBtn')?.addEventListener('click', openMobileDrawer);
}

// ── 编辑模式 ─────────────────────────────────────────────────────────────────
async function enterEditMode(doc) {
  rawMarkdown = doc.content;
  isRemoteUpdate = false;

  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="content-header content-header-row">
      <h2>${e(doc.title)}</h2>
      <div class="content-actions">
        <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn">目录</button>
      </div>
    </div>
    <div class="edit-wrap" id="editWrap">
      <div class="pane-wrap pane-split" id="paneSplit">
        <div class="pane pane-editor" id="editPane">
          <div class="pane-label">Markdown</div>
          <div class="edit-editor" id="editEditor"></div>
        </div>
        <div class="pane pane-preview markdown-body" id="previewPane">
          <div class="pane-label">预览</div>
          <div id="livePreview">${parseMarkdown(rawMarkdown)}</div>
        </div>
      </div>
    </div>
    <div class="edit-footer">
      <div class="edit-footer-left">
        <span class="edit-status" id="editStatus">已同步</span>
        <span class="edit-hint">Ctrl+S 保存 · 多人同时编辑，内容实时同步</span>
      </div>
      <div class="edit-footer-actions">
        <button type="button" class="action-btn action-btn-secondary" id="backBtn">返回</button>
        <button type="button" class="action-btn action-btn-primary" id="saveBtn">保存</button>
      </div>
    </div>`;

  document.getElementById('mobileDirBtn')?.addEventListener('click', openMobileDrawer);
  document.getElementById('backBtn')?.addEventListener('click', () => openDocument(currentDocId));
  document.getElementById('saveBtn')?.addEventListener('click', () => saveDocument());

  requestAnimationFrame(() => {
    initEditor();
    subscribeRealtime();
  });
}

// ── 初始化编辑器 ─────────────────────────────────────────────────────────────
function initEditor() {
  const container = document.getElementById('editEditor');
  if (!container) return;

  try {
    cmView = createMarkdownEditor(container, rawMarkdown, {
      onDocChange(content) {
        if (isRemoteUpdate) return;
        rawMarkdown = content;
        updatePreview(content);
        scheduleAutoSave();
      },
      onSave() {
        saveDocument();
      }
    });
  } catch (err) {
    console.error('CodeMirror 初始化失败，使用 textarea 回退', err);
    initPlainTextEditor();
  }
}

function initPlainTextEditor() {
  const container = document.getElementById('editEditor');
  if (!container) return;
  cmView = null;
  container.innerHTML = `<textarea id="fallbackEditor" class="doc-editor-fallback" spellcheck="false"></textarea>`;
  const ta = document.getElementById('fallbackEditor');
  ta.value = rawMarkdown;
  ta.addEventListener('input', () => {
    if (isRemoteUpdate) return;
    rawMarkdown = ta.value;
    updatePreview(rawMarkdown);
    scheduleAutoSave();
  });
}

// ── 实时订阅 ─────────────────────────────────────────────────────────────────
function subscribeRealtime() {
  unsubscribeRealtime();
  realtimeChannel = supabase
    .channel('doc-' + currentDocId)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'documents',
        filter: 'id=eq.' + currentDocId
      },
      (payload) => {
        if (!payload.new) return;
        const newContent = payload.new.content;
        if (newContent === rawMarkdown) return;
        isRemoteUpdate = true;
        rawMarkdown = newContent;
        updateEditorContent(newContent);
        updatePreview(newContent);
        setEditStatus('已同步（远程更新）');
        setTimeout(() => { isRemoteUpdate = false; }, 500);
      }
    )
    .subscribe();
}

function unsubscribeRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function updateEditorContent(content) {
  if (cmView) {
    try {
      cmView.setValue(content);
    } catch (_) {
      const ta = document.getElementById('fallbackEditor');
      if (ta) ta.value = content;
    }
  } else {
    const ta = document.getElementById('fallbackEditor');
    if (ta) ta.value = content;
  }
}

// ── 自动保存 ─────────────────────────────────────────────────────────────────
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  setEditStatus('● 未保存');
  autoSaveTimer = setTimeout(() => saveDocument(), 2000);
}

// ── 保存文档 ─────────────────────────────────────────────────────────────────
async function saveDocument() {
  clearTimeout(autoSaveTimer);
  setEditStatus('保存中...');

  let content = rawMarkdown;
  if (cmView) {
    content = cmView.getValue ? cmView.getValue() : rawMarkdown;
  } else {
    const ta = document.getElementById('fallbackEditor');
    if (ta) content = ta.value;
  }

  rawMarkdown = content;

  const { error } = await supabase
    .from('documents')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', currentDocId);

  if (error) {
    setEditStatus('保存失败');
    showToast('保存失败：' + error.message);
    return;
  }

  setEditStatus('已同步');
  showToast('已保存');
  // 更新本地文档列表中的内容
  const idx = documents.findIndex(d => d.id === currentDocId);
  if (idx !== -1) documents[idx].content = content;
}

// ── 新建文档 ─────────────────────────────────────────────────────────────────
async function createDocument(title) {
  const { data, error } = await supabase
    .from('documents')
    .insert([{ title: title || '未命名文档', content: '# ' + (title || '未命名文档') + '\n\n开始编辑...\n' }])
    .select()
    .single();

  if (error) {
    showToast('创建失败：' + error.message);
    return;
  }

  documents.unshift(data);
  renderDocList();
  await openDocument(data.id);
  showToast('文档已创建');
}

// ── 删除文档 ─────────────────────────────────────────────────────────────────
async function deleteDocument(id) {
  if (!confirm('确定删除这篇文档？此操作不可恢复。')) return;

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('删除失败：' + error.message);
    return;
  }

  documents = documents.filter(d => d.id !== id);
  renderDocList();
  if (currentDocId === id) {
    if (documents.length > 0) {
      await openDocument(documents[0].id);
    } else {
      currentDocId = null;
      showWelcome();
    }
  }
  showToast('文档已删除');
}

// ── 新建文档对话框 ───────────────────────────────────────────────────────────
function showNewDocDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal-title">新建文档</h3>
      <input type="text" id="newDocTitle" class="modal-input" placeholder="文档标题" maxlength="60" autofocus>
      <div class="modal-actions">
        <button type="button" class="action-btn action-btn-secondary" id="cancelNewDoc">取消</button>
        <button type="button" class="action-btn action-btn-primary" id="confirmNewDoc">创建</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { document.body.removeChild(overlay); };

  overlay.querySelector('#cancelNewDoc').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#confirmNewDoc').addEventListener('click', () => {
    const title = document.getElementById('newDocTitle').value.trim();
    close();
    createDocument(title || '未命名文档');
  });

  requestAnimationFrame(() => document.getElementById('newDocTitle').focus());
}

// ── 欢迎页 ───────────────────────────────────────────────────────────────────
function showWelcome() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="content-header content-header-row">
      <h2>欢迎使用</h2>
      <div class="content-actions">
        <button type="button" class="action-btn action-btn-primary" id="welcomeNewBtn">新建文档</button>
        <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn">目录</button>
      </div>
    </div>
    <div class="content-body">
      <div class="empty-notice">
        <p>还没有任何文档。</p>
        <p>点击「新建文档」创建一个，开启你的多人协作之旅。</p>
      </div>
    </div>`;
  document.getElementById('welcomeNewBtn')?.addEventListener('click', showNewDocDialog);
  document.getElementById('mobileDirBtn')?.addEventListener('click', openMobileDrawer);
}

// ── 错误提示 ─────────────────────────────────────────────────────────────────
function showError(msg) {
  const area = document.getElementById('contentArea');
  if (!area) return;
  area.innerHTML = `
    <div class="content-header"><h2>出错了</h2></div>
    <div class="content-body">
      <div class="empty-notice">
        <p>${e(msg)}</p>
        <p>请检查网络连接或刷新页面重试。</p>
      </div>
    </div>`;
}

// ── 全局事件绑定 ─────────────────────────────────────────────────────────────
function bindGlobalEvents() {
  document.getElementById('docFilter')?.addEventListener('input', ev => applyFilter(ev.target.value.trim()));
  document.getElementById('navOverlay')?.addEventListener('click', closeMobileDrawer);
  document.getElementById('drawerOpenBtn')?.addEventListener('click', openMobileDrawer);

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.target?.closest?.('.cm-editor')) return;
    if (e.key === 'Escape') { closeMobileDrawer(); return; }
  });
}

function applyFilter(q) {
  q = q.toLowerCase();
  let visible = 0;
  document.querySelectorAll('.side-nav-item').forEach(btn => {
    const title = documents.find(d => d.id === btn.dataset.docId)?.title || '';
    const show = !q || title.toLowerCase().includes(q);
    btn.hidden = !show;
    if (show) visible++;
  });
  document.getElementById('sideNavCount').textContent =
    q ? `显示 ${visible} / ${documents.length}` : `${documents.length} 篇`;
}

function openMobileDrawer() {
  if (window.matchMedia('(min-width: 901px)').matches) return;
  document.getElementById('sideNav')?.classList.add('is-open');
  document.getElementById('navOverlay')?.classList.add('is-visible');
}

function closeMobileDrawer() {
  document.getElementById('sideNav')?.classList.remove('is-open');
  document.getElementById('navOverlay')?.classList.remove('is-visible');
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────
function setEditStatus(text) {
  document.getElementById('editStatus') && (document.getElementById('editStatus').textContent = text);
}

function updatePreview(content) {
  const el = document.getElementById('livePreview');
  if (el) el.innerHTML = parseMarkdown(content);
}

function disposeCurrentEditor() {
  unsubscribeRealtime();
  if (cmView) {
    try { cmView.destroy(); } catch (_) { /* ignore */ }
    cmView = null;
  }
}

function e(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-visible'));
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('toast-visible');
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

// ── Markdown 解析 ────────────────────────────────────────────────────────────
function parseMarkdown(md) {
  let h = String(md || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  h = h.replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>');
  h = h.replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>');
  h = h.replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>');

  h = h.replace(/^>\s+(.+)$/gm, '<blockquote><p>$1</p></blockquote>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/__(.+?)__/g, '<strong>$1</strong>');
  h = h.replace(/_(.+?)_/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^---+$/gm, '<hr>');
  h = h.replace(/^\*\*\*+$/gm, '<hr>');
  h = h.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  h = h.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  h = parseTables(h);
  h = h.replace(/^(?!<[huplo]|<blockquote|<pre|<table)(.+)$/gm, '<p>$1</p>');
  h = h.replace(/<p>\s*<\/p>/g, '');
  h = h.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  h = h.replace(/<blockquote><p>(.*?)<\/p><\/blockquote>/gs, '<blockquote>$1</blockquote>');
  return h;
}

function parseTables(html) {
  return html.replace(
    /^\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/gm,
    (m, headerRow, bodyRows) => {
      const headers = headerRow.split('|').map(h => h.trim()).filter(Boolean);
      const rows = bodyRows.trim().split('\n').map(row =>
        row.split('|').map(c => c.trim()).filter(Boolean)
      );
      let t = '<table><thead><tr>';
      headers.forEach(h => { t += `<th>${h}</th>`; });
      t += '</tr></thead><tbody>';
      rows.forEach(row => {
        t += '<tr>';
        row.forEach(c => { t += `<td>${c}</td>`; });
        t += '</tr>';
      });
      t += '</tbody></table>';
      return t;
    }
  );
}

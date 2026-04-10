/**
 * 新游方向探索 - Obsidian 风格逐块感知编辑
 * CodeMirror 6：平时隐藏 Markdown 符号（视觉像阅读），光标跳入某行时露出 #、** 等符号。
 */
import { createMarkdownEditor } from './cm-editor.bundle.mjs';

const DOCUMENTS = [
    { id: 0, filename: '洛克王国：世界介绍.md', title: '洛克王国：世界介绍', level: '入门', progress: 100, description: '腾讯UE4引擎打造的大世界宠物收集RPG深度分析' },
    { id: 1, filename: '梦幻西游与洛克王国战斗分析报告1.md', title: '战斗分析报告（一）', level: '进阶', progress: 100, description: '基础结构、博弈结构、反馈机制与长期粘性对比' },
    { id: 2, filename: '梦幻西游与洛克王国战斗分析报告2.md', title: '战斗分析报告（二）', level: '进阶', progress: 100, description: '战斗系统详细拆解与最终结论' },
    { id: 3, filename: '卡牌回合游戏设计原则.md', title: '卡牌回合游戏设计原则', level: '核心', progress: 80, description: '核心设计理念、原则与MMO社交重构方案' },
    { id: 4, filename: '次世代轻策略回合制MMO战斗系统白皮书.md', title: '战斗系统白皮书', level: '终极', progress: 60, description: '完整的设计哲学、三层战斗生态与数值架构' }
];

const STORAGE_PREFIX = 'doc_edit_';
let currentDocId = 0;
let rawMarkdown = '';
let cmView = null;
let autoSaveTimer = null;

// ── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    try {
        renderSideNav();
        bindNavChrome();
        await loadDocument(0);
    } catch (err) {
        console.error('页面初始化失败', err);
        const area = document.getElementById('contentArea');
        if (area) {
            area.innerHTML = `<div class="content-body"><p class="empty-notice">页面加载出错，请刷新重试。<br><small>${String(err && err.message ? err.message : err)}</small></p></div>`;
        }
    }
});

// ── Sidebar ─────────────────────────────────────────────────────────────────

function renderSideNav() {
    const list = document.getElementById('sideNavList');
    document.getElementById('sideNavCount').textContent = `${DOCUMENTS.length} 篇`;

    list.innerHTML = DOCUMENTS.map((doc, idx) => {
        const edited = !!localStorage.getItem(STORAGE_PREFIX + doc.id + '_ts');
        return `<button type="button" class="side-nav-item ${doc.id === currentDocId ? 'active' : ''}"
            data-doc-id="${doc.id}"
            data-search="${e(doc.title + ' ' + doc.filename + ' ' + doc.level)}">
            <span class="side-nav-index">${idx + 1}</span>
            <span class="side-nav-text">
                <span class="side-nav-item-title">${doc.title}</span>
                ${edited
                    ? '<span class="side-nav-edited">已修改</span>'
                    : `<span class="side-nav-item-meta">${doc.level}</span>`}
            </span>
        </button>`;
    }).join('');

    list.querySelectorAll('.side-nav-item').forEach(btn => {
        btn.addEventListener('click', async () => {
            await loadDocument(parseInt(btn.dataset.docId, 10));
            closeMobileDrawer();
        });
    });
}

function e(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function updateSideNavActive(id) {
    document.querySelectorAll('.side-nav-item').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.docId, 10) === id);
    });
    const a = document.querySelector(`.side-nav-item[data-doc-id="${id}"]`);
    if (a) a.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function bindNavChrome() {
    document.getElementById('docFilter').addEventListener('input', ev => applyFilter(ev.target.value.trim()));
    document.getElementById('navOverlay').addEventListener('click', closeMobileDrawer);
    document.getElementById('drawerOpenBtn').addEventListener('click', openMobileDrawer);
}

function applyFilter(q) {
    q = q.toLowerCase();
    let visible = 0;
    document.querySelectorAll('.side-nav-item').forEach(btn => {
        const show = !q || btn.dataset.search.toLowerCase().includes(q);
        btn.hidden = !show;
        if (show) visible++;
    });
    document.getElementById('sideNavCount').textContent =
        q ? `显示 ${visible} / ${DOCUMENTS.length}` : `${DOCUMENTS.length} 篇`;
}

function openMobileDrawer() {
    if (window.matchMedia('(min-width: 901px)').matches) return;
    document.getElementById('sideNav').classList.add('is-open');
    document.getElementById('navOverlay').classList.add('is-visible');
    document.getElementById('navOverlay').setAttribute('aria-hidden', 'false');
}

function closeMobileDrawer() {
    document.getElementById('sideNav').classList.remove('is-open');
    document.getElementById('navOverlay').classList.remove('is-visible');
    document.getElementById('navOverlay').setAttribute('aria-hidden', 'true');
}

// ── Load Document ─────────────────────────────────────────────────────────────

function disposeCurrentEditor() {
    if (!cmView) return;
    if (typeof cmView.destroy === 'function') {
        try {
            cmView.destroy();
        } catch (_) {
            /* ignore */
        }
    }
    cmView = null;
}

async function loadDocument(id) {
    if (id < 0 || id >= DOCUMENTS.length) return;
    clearTimeout(autoSaveTimer);
    disposeCurrentEditor();

    currentDocId = id;
    const doc = DOCUMENTS[id];
    const area = document.getElementById('contentArea');

    updateSideNavActive(id);
    area.innerHTML = `
        <div class="content-header content-header-row">
            <h2>${doc.title}</h2>
            <div class="content-actions">
                <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn">目录</button>
            </div>
        </div>
        <div class="content-body"><div class="loading">正在加载</div></div>`;

    document.getElementById('mobileDirBtn').addEventListener('click', openMobileDrawer);

    const edited = localStorage.getItem(STORAGE_PREFIX + id);
    if (edited !== null) {
        rawMarkdown = edited;
        renderView(doc);
        return;
    }
    try {
        const res = await fetch(doc.filename);
        if (!res.ok) throw new Error();
        rawMarkdown = await res.text();
        renderView(doc);
    } catch {
        rawMarkdown = '';
        renderEmptyEdit(doc);
    }
}

// ── View Mode ──────────────────────────────────────────────────────────────────

function renderView(doc) {
    const area = document.getElementById('contentArea');
    area.innerHTML = `
        <div class="content-header content-header-row">
            <h2>${doc.title}</h2>
            <div class="content-actions">
                <button type="button" class="action-btn action-btn-primary" id="editBtn">编辑</button>
                <button type="button" class="action-btn action-btn-secondary" id="downloadBtn">下载</button>
                <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn2">目录</button>
            </div>
        </div>
        <div class="pane-wrap pane-wrap-view">
            <div class="pane pane-preview markdown-body">${parseMarkdown(rawMarkdown)}</div>
        </div>`;

    document.getElementById('editBtn').addEventListener('click', () => enterEditMode(doc));
    document.getElementById('downloadBtn').addEventListener('click', () => triggerDownload(rawMarkdown, doc.filename));
    document.getElementById('mobileDirBtn2').addEventListener('click', openMobileDrawer);
}

function renderEmptyEdit(doc) {
    const area = document.getElementById('contentArea');
    area.innerHTML = `
        <div class="content-header content-header-row">
            <h2>${doc.title}</h2>
            <div class="content-actions">
                <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn2">目录</button>
            </div>
        </div>
        <div class="content-body">
            <div class="empty-notice">
                <p>无法加载原文件（浏览器安全限制）。</p>
                <p>请使用本地 HTTP 服务（Live Server / <code>python -m http.server</code>）打开本页。</p>
                <button type="button" class="action-btn action-btn-primary" id="startEditBtn" style="margin-top:12px">开始编辑</button>
            </div>
        </div>`;
    document.getElementById('mobileDirBtn2').addEventListener('click', openMobileDrawer);
    document.getElementById('startEditBtn').addEventListener('click', () => enterEditMode(doc));
}

// ── Edit Mode ─────────────────────────────────────────────────────────────

async function enterEditMode(doc) {
    const area = document.getElementById('contentArea');
    area.innerHTML = `
        <div class="content-header content-header-row">
            <h2>${doc.title}</h2>
            <div class="content-actions">
                <button type="button" class="action-btn action-btn-secondary" id="mobileDirBtn2">目录</button>
            </div>
        </div>
        <div class="edit-wrap" id="editWrap">
            <div class="edit-editor" id="editEditor"></div>
        </div>
        <div class="edit-footer" id="editFooter">
            <div class="edit-footer-left">
                <span class="edit-status" id="editStatus"></span>
                <span class="edit-hint">底部可切换「Markdown」查看 #、** 等符号</span>
            </div>
            <div class="edit-footer-actions">
                <button type="button" class="action-btn action-btn-secondary" id="resetBtn">重置</button>
                <button type="button" class="action-btn action-btn-secondary" id="downloadEditBtn">下载</button>
                <button type="button" class="action-btn action-btn-primary" id="saveBtn">保存</button>
            </div>
        </div>`;

    document.getElementById('mobileDirBtn2').addEventListener('click', openMobileDrawer);

    requestAnimationFrame(() => {
        initEditor(doc);
        bindEditButtons(doc);
    });
}

function initEditor(doc) {
    const container = document.getElementById('editEditor');
    if (!container) return;

    try {
        cmView = createMarkdownEditor(container, rawMarkdown, {
            onDocChange(content) {
                rawMarkdown = content;
                scheduleAutoSave(doc, content);
            },
            onSave() {
                saveContent(doc);
            }
        });
    } catch (err) {
        console.error('CodeMirror 6 初始化失败，使用 textarea 回退', err);
        initPlainTextEditor(doc);
    }
}

/** CDN 不可用时的 textarea 回退 */
function initPlainTextEditor(doc) {
    const container = document.getElementById('editEditor');
    if (!container) return;
    cmView = null;
    container.innerHTML = `<textarea id="fallbackEditor" class="doc-editor-fallback" spellcheck="false"></textarea>`;
    const ta = document.getElementById('fallbackEditor');
    ta.value = rawMarkdown;
    ta.addEventListener('input', () => {
        rawMarkdown = ta.value;
        scheduleAutoSave(doc, ta.value);
    });
    ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveContent(doc);
        }
    });
}

function scheduleAutoSave(doc, content) {
    clearTimeout(autoSaveTimer);
    setEditStatus('● 未保存');
    autoSaveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_PREFIX + doc.id, content);
        localStorage.setItem(STORAGE_PREFIX + doc.id + '_ts', Date.now());
        renderSideNav();
        setEditStatus('已保存');
    }, 1500);
}

function setEditStatus(text) {
    const el = document.getElementById('editStatus');
    if (el) el.textContent = text;
}

function bindEditButtons(doc) {
    document.getElementById('saveBtn')?.addEventListener('click', () => saveContent(doc));

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        if (!confirm('确定重置为原文？所有修改将被清除。')) return;
        localStorage.removeItem(STORAGE_PREFIX + doc.id);
        localStorage.removeItem(STORAGE_PREFIX + doc.id + '_ts');
        rawMarkdown = '';
        renderSideNav();
        loadDocument(doc.id);
    });

    document.getElementById('downloadEditBtn')?.addEventListener('click', () => {
        triggerDownload(rawMarkdown, doc.filename);
    });
}

function saveContent(doc) {
    clearTimeout(autoSaveTimer);
    let content = rawMarkdown;
    if (cmView) {
        content =
            typeof cmView.getValue === 'function' ? cmView.getValue() : cmView.state?.doc?.toString?.() ?? rawMarkdown;
    } else {
        const ta = document.getElementById('fallbackEditor');
        if (ta) content = ta.value;
    }
    rawMarkdown = content;
    localStorage.setItem(STORAGE_PREFIX + doc.id, content);
    localStorage.setItem(STORAGE_PREFIX + doc.id + '_ts', Date.now());
    renderSideNav();
    setEditStatus('已保存');
    showToast('已保存');
    loadDocument(doc.id);
}

// ── Download ───────────────────────────────────────────────────────────────

function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Toast ────────────────────────────────────────────────────────────────

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

// ── Markdown Parser ─────────────────────────────────────────────────────────

function parseMarkdown(md) {
    let h = String(md)
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

// ── Keyboard ────────────────────────────────────────────────────────────

function nextDoc() { if (currentDocId < DOCUMENTS.length - 1) loadDocument(currentDocId + 1); }
function prevDoc() { if (currentDocId > 0) loadDocument(currentDocId - 1); }

document.addEventListener('keydown', function (e) {
    const tag = e.target && e.target.tagName;
    // 不拦截编辑器内部和普通输入框内的按键
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.target && e.target.closest && (
        e.target.closest('.cm-editor')
    )) return;
    if (e.key === 'Escape') { closeMobileDrawer(); return; }
    if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); nextDoc(); }
    if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); prevDoc(); }
});

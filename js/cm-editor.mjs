/**
 * CodeMirror 6 Markdown 编辑器
 * 列表/引用等标记用浅灰显示；勿对 .tok-list 设 transparent（** 内 * 易被标成 list，会留下空白占位）。
 */
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
    bracketMatching,
    indentOnInput,
    syntaxHighlighting,
    HighlightStyle,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';

// ── Markdown 语法高亮 ─────────────────────────────────────────────────────────

const mkHighlight = HighlightStyle.define([
    { tag: t.heading1,  color: '#007AFF', fontWeight: '700', fontSize: '1.75em' },
    { tag: t.heading2,  color: '#007AFF', fontWeight: '700', fontSize: '1.35em' },
    { tag: t.heading3,  color: '#007AFF', fontWeight: '600', fontSize: '1.1em'  },
    { tag: t.heading4,  color: '#007AFF', fontWeight: '600', fontSize: '0.9375em' },
    { tag: t.heading5,  color: '#007AFF', fontWeight: '600' },
    { tag: t.heading6,  color: '#007AFF', fontWeight: '600' },
    { tag: t.strong,    fontWeight: '700', color: 'var(--ios-text-primary)' },
    { tag: t.emphasis,  fontStyle: 'italic', color: 'var(--ios-text-secondary)' },
    { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--ios-text-tertiary)' },
    { tag: t.link,      color: '#007AFF', textDecoration: 'underline' },
    { tag: t.url,       color: '#007AFF', fontSize: '0.875em' },
    { tag: t.monospace,
      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
      fontSize: '0.85em',
      background: 'rgba(0,122,255,0.08)',
      color: '#007AFF',
      padding: '1px 5px',
      borderRadius: '4px',
    },
    { tag: t.quote,     color: '#8e8e93' },
    /* 勿用 transparent：解析易把 ** 内的 * 标成 list，会留下大块“空白”占位 */
    { tag: t.list,      color: '#8e8e93' },
    { tag: t.meta,      color: 'var(--ios-text-tertiary)', fontSize: '0.8em' },
    { tag: t.comment,   color: '#8e8e93' },
    { tag: t.keyword,   color: '#AF52DE' },
    { tag: t.string,   color: '#32D74B' },
    { tag: t.number,   color: '#FF9F0A' },
    { tag: t.operator,  color: '#FF453A' },
    { tag: t.punctuation, color: 'var(--ios-text-tertiary)' },
    { tag: t.content,   color: 'var(--ios-text-secondary)' },
]);

// ── 编辑器主体 ────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {string} initialText
 * @param {{ onDocChange?: (s: string) => void, onSave?: () => void }} hooks
 */
export function createMarkdownEditor(container, initialText, hooks) {
    const extensions = [
        history(),

        markdown({
            base: markdownLanguage,
            codeLanguages: [],
            addKeymap: true,
        }),

        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(mkHighlight),

        highlightActiveLine(),

        EditorView.lineWrapping,
        obsidianTheme,

        keymap.of([
            {
                key: 'Mod-s',
                run() { hooks.onSave?.(); return true; },
            },
            {
                key: 'Escape',
                run() { hooks.onSave?.(); return true; },
            },
            ...defaultKeymap,
            ...historyKeymap,
        ]),

        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                hooks.onDocChange?.(update.state.doc.toString());
            }
        }),
    ];

    const view = new EditorView({
        state: EditorState.create({ doc: initialText, extensions }),
        parent: container,
    });

    return {
        getValue() { return view.state.doc.toString(); },
        destroy() { view.destroy(); },
    };
}

// ── CodeMirror 主题 ───────────────────────────────────────────────────────────

const obsidianTheme = EditorView.theme(
    {
        '&': {
            backgroundColor: 'transparent',
            color: 'var(--ios-text-primary)',
            fontFamily: "'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif",
            fontSize: '0.9375rem',
            lineHeight: '1.75',
            caretColor: 'var(--ios-blue)',
        },
        '.cm-scroller': {
            fontFamily: 'inherit',
            overflow: 'auto',
            padding: '28px 32px 40px',
        },
        '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'var(--ios-blue)',
            borderLeftWidth: '2px',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
            backgroundColor: 'rgba(0,122,255,0.18)',
        },
        '::selection': { backgroundColor: 'rgba(0,122,255,0.2)' },

        /* 默认行（无符号）：背景透明，无特殊样式 */
        '.cm-line': {
            wordBreak: 'break-word',
        },

        /* 当前光标行：浅蓝背景（与 style.css 中 .cm-activeLine 配合） */
        '.cm-activeLine': {
            backgroundColor: 'rgba(0,122,255,0.04)',
            borderRadius: '6px',
        },
        '.cm-activeLine .tok-monospace': {
            background: 'rgba(0,122,255,0.08)',
            color: '#007AFF',
        },

        '.cm-placeholder': { color: 'var(--ios-text-tertiary)', fontStyle: 'italic' },
        '.cm-matchingBracket': { backgroundColor: 'rgba(0,122,255,0.12)', outline: 'none' },
        '.cm-meta': { color: 'var(--ios-text-tertiary)', fontSize: '0.8em' },
        '.cm-punctuation': { color: 'var(--ios-text-tertiary)' },
    },
    { dark: false },
);

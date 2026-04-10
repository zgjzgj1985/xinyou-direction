# 新游方向探索

回合制游戏战斗系统设计研究的多人协作文档编辑网站。

## 在线访问

| 环境 | 地址 |
|------|------|
| 海外版（Vercel） | https://xinyou-direction.vercel.app |
| 国内镜像（Cloudflare Workers） | https://xinyou-direction-cn.zhangguangjian998.workers.dev |

## 技术架构

| 层级 | 技术选型 |
|------|---------|
| 前端 | 原生 HTML/CSS/JS，无框架依赖 |
| 数据库 | Supabase（PostgreSQL） |
| 实时同步 | Supabase Realtime |
| 编辑器 | CodeMirror 6（Markdown） |
| AI 中转 | Vercel Serverless Function（`/api/ai-chat`）或 Cloudflare Worker（`/api/chat`） |
| 部署（海外） | Vercel（静态托管 + API 函数） |
| 部署（国内） | Cloudflare Workers（一体化 Worker，含静态文件 + AI 接口） |

## 文件结构

```
新游方向/
├── index.html              # 主页面
├── css/
│   ├── style.css           # 主样式（iOS 风格）
│   └── ai-panel.css        # AI 面板样式
├── js/
│   ├── main.js             # 主逻辑（文档列表、编辑器、实时同步）
│   ├── supabase.js         # Supabase 客户端
│   ├── ai-panel.js         # AI 对话面板逻辑
│   └── cm-editor.bundle.mjs # CodeMirror 6 编辑器（构建产物）
├── api/
│   └── ai-chat.ts          # AI 中转 API（Vercel Serverless）
├── vercel.json             # Vercel 配置
├── cf-site/                # 国内镜像（Cloudflare Workers）
│   ├── worker/index.js     # Worker 主入口（含静态文件服务 + AI 接口）
│   ├── build.js            # 构建脚本（复制静态资源 + 替换 API URL）
│   ├── wrangler.toml       # Cloudflare Workers 配置
│   └── .dev.vars           # 本地环境变量（需填入 LLM_API_KEY）
└── package.json            # npm 依赖
```

## 功能特性

- **协作文档编辑** — 多人同时编辑，内容实时同步
- **AI 助手** — 集成 AI 对话能力，支持发送文档、生成标签、总结全文、数值分析
- **Markdown 预览** — 编辑器左侧写 Markdown，右侧实时预览
- **自动保存** — 编辑停止 2 秒后自动保存
- **文档目录** — 左侧导航栏，支持按标题筛选
- **响应式设计** — 支持桌面端与移动端

## 文件结构

```
d:/新游方向/
├── index.html              # 主页面
├── css/
│   ├── style.css           # 主样式（iOS 风格）
│   └── ai-panel.css        # AI 面板样式
├── js/
│   ├── main.js             # 主逻辑（文档列表、编辑器、实时同步）
│   ├── supabase.js         # Supabase 客户端
│   ├── ai-panel.js         # AI 对话面板逻辑
│   └── cm-editor.bundle.mjs # CodeMirror 6 编辑器（构建产物）
├── api/
│   └── ai-chat.ts          # AI 中转 API（Vercel Serverless）
├── vercel.json             # Vercel 配置
└── package.json             # npm 依赖
```

## 常用操作

### 本地运行

直接在浏览器中打开 `index.html` 即可，Supabase 连接信息已内置。

### 修改 CodeMirror 编辑器

编辑器源码在 `js/cm-editor.mjs`，修改后执行构建：

```bash
npm run build:editor
```

### 修改 Supabase 连接信息

编辑 `js/supabase.js` 中的两处：

- 项目 URL（第 8 行）
- anon public key（第 9 行）

获取位置：Supabase Dashboard → Project Settings → API

### 修改 AI 模型

AI 模型由后端环境变量 `LLM_MODEL` 控制，修改 `api/ai-chat.ts` 中的默认值或直接在 Vercel 环境变量中设置。

当前支持的模型标识：`gemini-3.1-pro`、`gpt-4o-mini`、`claude-3.5-sonnet` 等（取决于中转 API）。

## 数据库表结构

**表名：** `documents`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `title` | text | 文档标题 |
| `content` | text | Markdown 内容 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 最后修改时间 |

Row Level Security (RLS) 已禁用（允许匿名访问）。

## 环境变量

### Vercel（海外版）

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | AI 中转 API 的密钥 |
| `LLM_API_URL` | AI 中转 API 地址（默认 `https://openrouter.ai/api/v1/chat/completions`） |
| `LLM_MODEL` | 使用的模型 ID（如 `gemini-3.1-pro`） |

### Cloudflare Workers（国内镜像）

在 `cf-site/` 目录下，首次部署时用命令设置密钥：

```bash
cd cf-site
npm install
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_API_URL
npm run deploy
```

构建后访问 https://xinyou-direction-cn.zhangguangjian998.workers.dev

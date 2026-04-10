# 新游方向探索

回合制游戏战斗系统设计研究的多人协作文档编辑网站。

## 在线访问

**生产环境：** https://xinyou-direction.vercel.app

## 技术架构

- **前端：** 原生 HTML/CSS/JS，无框架依赖
- **实时协作：** Supabase Realtime（PostgreSQL + 实时订阅）
- **编辑器：** CodeMirror 6（Markdown 编辑器）
- **部署：** Vercel（静态托管）

## 功能特性

- Markdown 文档的阅读与编辑
- 多人同时编辑，内容实时同步
- 左侧文档目录导航，支持按标题筛选
- 自动保存（编辑停止 2 秒后）
- 响应式设计，支持移动端

## 文件结构

```
d:/新游方向/
├── index.html          # 主页面（协作文档编辑器）
├── import-docs.html    # 一次性工具：将本地 md 文档导入 Supabase
├── css/
│   └── style.css       # iOS 风格样式
├── js/
│   ├── main.js         # 主逻辑（文档列表、编辑器、实时同步）
│   ├── supabase.js     # Supabase 客户端配置
│   └── cm-editor.bundle.mjs  # CodeMirror 6 编辑器（构建产物）
├── vercel.json         # Vercel 配置
├── package.json        # npm 依赖（CodeMirror 包 + esbuild）
└── .gitignore
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `VERCEL_TOKEN` | Vercel API Token（运行 deploy.ps1 时需要） |

## 常用操作

### 本地运行

直接用浏览器打开 `index.html` 即可。Supabase 连接信息已内置在 `js/supabase.js` 中。

### 构建编辑器包（仅修改了 CodeMirror 源码时需要）

```bash
npm run build:editor
```

### 部署到 Vercel

项目已在 Vercel 上配置完成。推送代码到 GitHub 后，Vercel 会自动触发重新部署。

手动部署（需要设置 `VERCEL_TOKEN` 环境变量）：

```powershell
.\deploy.ps1
```

### 导入本地 Markdown 文档到数据库

1. 确保 `js/supabase.js` 中的连接信息正确
2. 浏览器打开 `import-docs.html`
3. 点击「开始导入」

### 修改 Supabase 连接信息

编辑 `js/supabase.js` 中的两处：
- 项目 URL（第 8 行）
- anon public key（第 9 行）

获取位置：Supabase Dashboard → Project Settings → API

## 数据库表结构

**表名：** `documents`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `title` | text | 文档标题 |
| `content` | text | Markdown 内容 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 最后修改时间 |

Row Level Security (RLS) 已禁用（匿名访问）。

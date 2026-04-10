-- ============================================================
-- 新游方向 · 数据库初始化 SQL
-- 运行方式：Supabase Dashboard → SQL Editor → 粘贴执行
-- ============================================================

-- 1. 确保 documents 表存在
CREATE TABLE IF NOT EXISTS public.documents (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT        NOT NULL DEFAULT '未命名文档',
  content     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 关闭 RLS（允许任何人读写）
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;

-- 3. 删除所有旧策略（防止残留干扰）
DROP POLICY IF EXISTS "允许公开读取" ON public.documents;
DROP POLICY IF EXISTS "允许公开插入" ON public.documents;
DROP POLICY IF EXISTS "允许公开更新" ON public.documents;
DROP POLICY IF EXISTS "允许公开删除" ON public.documents;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.documents;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.documents;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.documents;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.documents;

-- 4. 重新创建宽松策略（允许所有匿名操作）
CREATE POLICY "public_all" ON public.documents
  FOR ALL USING (true) WITH CHECK (true);

-- 5. 确保 updated_at 自动更新
CREATE OR REPLACE FUNCTION public.update_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_updated_at ON public.documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. 插入一篇示例文档（如果没有的话）
INSERT INTO public.documents (title, content)
SELECT '游戏战斗系统设计', '# 游戏战斗系统设计\n\n这是第一篇协作文档。\n\n## 核心机制\n\n- 回合制\n- 技能系统\n- 属性克制\n\n> 点击「编辑」开始多人协作编辑\n'
WHERE NOT EXISTS (SELECT 1 FROM public.documents LIMIT 1);

-- 7. 验证：查询文档列表
SELECT id, title, updated_at FROM public.documents ORDER BY updated_at DESC LIMIT 10;

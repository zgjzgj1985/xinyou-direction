/**
 * Supabase 客户端配置
 * 连接信息来自 Supabase Project Settings → API
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://ltldrqazzgljweblrnpt.supabase.co',
  'sb_publishable_0HMYW6nQe5sdKg5AAk7xhw_ZRORoP1c'
);

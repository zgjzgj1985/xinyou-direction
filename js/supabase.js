/**
 * Supabase 客户端配置
 * 连接信息来自 Supabase Project Settings → API
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://ltldrqazzgljweblrnpt.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0bGRycWF6emdsandalZWxybnB0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwMzA4NTYsImV4cCI6MjA2MjYwNjg1Nn0.sb_publishable_0HMYW6nQe5sdKg5AAk7xhw_ZRORoP1c'
);

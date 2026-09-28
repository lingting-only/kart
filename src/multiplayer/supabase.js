// Supabase 初始化与匿名登录。项目无构建步骤，SDK 通过 esm.sh 以 ESM 形式加载。
import { createClient } from '@supabase/supabase-js';
import { bus } from '../events.js';

// TODO: 替换成你自己的 Supabase 项目信息（Settings → API）
const SUPABASE_URL = 'https://xuunfjmreduwkhmoikxk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dW5mam1yZWR1d2tobW9pa3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1ODAxMDIsImV4cCI6MjEwNjE1NjEwMn0.Bwbc3_LNPu0dI-_jG74yBOcMjOnvCQMeaCBe-oH91YY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
});

let currentUser = null;

/** 匿名登录，返回用户对象。幂等：已登录则直接返回。 */
export async function getCurrentUser() {
  if (currentUser) return currentUser;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (session?.user) {
    currentUser = session.user;
    return currentUser;
  }
  const { data, error: signErr } = await supabase.auth.signInAnonymously();
  if (signErr) throw signErr;
  currentUser = data.user;
  bus.emit('mp:ready', { user: currentUser });
  return currentUser;
}

export function getUserId() {
  return currentUser ? currentUser.id : null;
}

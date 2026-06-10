// 极简 API 客户端：自动带 JWT，统一错误处理
import { useAuth } from './store';

export async function api(path, { method = 'GET', body, formData } = {}) {
  const auth = useAuth();
  const headers = {};
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401) auth.logout();
    throw err;
  }
  return data;
}

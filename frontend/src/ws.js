// WebSocket 客户端：自动重连 + 订阅分发
import { useAuth } from './store';

export function createWS() {
  let ws = null;
  let alive = false;
  const listeners = new Set();
  let pending = [];
  let retry = 0;
  let closedByUser = false;

  function connect() {
    const auth = useAuth();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws${auth.token ? `?token=${auth.token}` : ''}`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      alive = true; retry = 0;
      pending.forEach((m) => ws.send(JSON.stringify(m)));
      pending = [];
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      listeners.forEach((fn) => fn(msg));
    };
    ws.onclose = () => {
      alive = false;
      if (!closedByUser) setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
    };
    ws.onerror = () => ws.close();
  }
  connect();

  return {
    send(msg) {
      if (alive && ws.readyState === 1) ws.send(JSON.stringify(msg));
      else pending.push(msg);
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { closedByUser = true; ws && ws.close(); }
  };
}

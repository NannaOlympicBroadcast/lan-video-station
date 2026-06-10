'use strict';
// WebSocket 网关：个人事件订阅 + 直播间聊天/在线 + 管理员全局监听
// 连接: ws://host/ws?token=<JWT 或 lvs_apikey>
// 客户端消息:
//   {type:'join', roomId, password?}   进入直播间（聊天/事件）
//   {type:'leave', roomId}
//   {type:'chat', roomId, content}
//   {type:'ping'}
const { WebSocketServer } = require('ws');
const db = require('../db/pool');
const { sub } = require('../lib/redis');
const { WS_CHANNEL, emitRoomEvent, emitToAdmins } = require('../lib/events');
const { resolveAuth, isBanned } = require('../middleware/auth');
const { getRoom, checkRoomAccess } = require('../routes/live');

const clients = new Set(); // { ws, user, rooms:Set<roomId> }

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function setupGateway(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // redis 订阅 -> 扇出到本进程连接
  sub.subscribe(WS_CHANNEL).then(() => console.log('[ws] subscribed event channel'));
  sub.on('message', (channel, raw) => {
    if (channel !== WS_CHANNEL) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    for (const c of clients) {
      if (msg.target === 'user' && c.user && c.user.id === msg.userId) send(c.ws, { scope: 'personal', ...msg.event });
      else if (msg.target === 'admins' && c.user && c.user.role === 'admin') send(c.ws, { scope: 'admin', ...msg.event });
      else if (msg.target === 'room' && c.rooms.has(msg.roomId)) send(c.ws, { scope: 'room', ...msg.event });
    }
  });

  wss.on('connection', async (ws, req) => {
    let user = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      const fakeReq = { headers: {}, query: { token: url.searchParams.get('token') } };
      user = await resolveAuth(fakeReq);
    } catch { /* 匿名 */ }
    if (user && isBanned(user)) {
      send(ws, { type: 'error', error: 'banned' });
      return ws.close();
    }
    const client = { ws, user, rooms: new Set() };
    clients.add(client);
    send(ws, { type: 'hello', authenticated: !!user, username: user && user.username, role: user && user.role });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', error: 'invalid json' }); }
      try {
        if (msg.type === 'ping') return send(ws, { type: 'pong' });

        if (msg.type === 'join') {
          const room = await getRoom(msg.roomId);
          if (!room) return send(ws, { type: 'error', error: 'room not found' });
          const access = await checkRoomAccess(room, user, msg.password);
          if (!access.ok) return send(ws, { type: 'error', error: access.reason === 'blacklisted' ? '已被拉黑' : '密码错误', reason: access.reason });
          client.rooms.add(room.id);
          send(ws, { type: 'joined', roomId: room.id });
          await emitRoomEvent(room, 'room.user.joined', {
            userId: user ? user.id : null, username: user ? user.username : '游客'
          });
          return;
        }

        if (msg.type === 'leave') {
          if (client.rooms.delete(msg.roomId)) {
            const room = await getRoom(msg.roomId);
            if (room) await emitRoomEvent(room, 'room.user.left', {
              userId: user ? user.id : null, username: user ? user.username : '游客'
            });
          }
          return;
        }

        if (msg.type === 'chat') {
          if (!user) return send(ws, { type: 'error', error: '登录后才能发言' });
          if (!client.rooms.has(msg.roomId)) return send(ws, { type: 'error', error: '请先 join 直播间' });
          const content = String(msg.content || '').trim().slice(0, 500);
          if (!content) return;
          const room = await getRoom(msg.roomId);
          if (!room) return;
          // 二次校验黑名单（发言时刻）
          const bl = await db.query('SELECT 1 FROM room_blacklist WHERE room_id=$1 AND user_id=$2', [room.id, user.id]);
          if (bl.rows[0]) return send(ws, { type: 'error', error: '已被拉黑' });
          await db.query('INSERT INTO live_messages (room_id, user_id, content) VALUES ($1,$2,$3)',
            [room.id, user.id, content]);
          await emitRoomEvent(room, 'chat.message', { userId: user.id, username: user.username, content });
          await emitToAdmins('admin.chat.message', { roomId: room.id, userId: user.id, username: user.username, content });
          return;
        }

        send(ws, { type: 'error', error: `unknown message type: ${msg.type}` });
      } catch (e) {
        console.error('[ws] message error', e.message);
        send(ws, { type: 'error', error: e.message });
      }
    });

    ws.on('close', async () => {
      clients.delete(client);
      for (const roomId of client.rooms) {
        const room = await getRoom(roomId).catch(() => null);
        if (room) await emitRoomEvent(room, 'room.user.left', {
          userId: user ? user.id : null, username: user ? user.username : '游客'
        }).catch(() => {});
      }
    });
  });

  console.log('[ws] gateway ready at /ws');
  return wss;
}

module.exports = { setupGateway };

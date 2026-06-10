'use strict';
// 直播间：创建/信息(含推流地址)/密码/黑名单/连麦/录制/自定义回调/媒体流直链
const express = require('express');
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');
const { streamUrls, kickStream } = require('../lib/srs');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { emitRoomEvent, emitToUser } = require('../lib/events');
const recorder = require('../lib/recorder');
const { pickEdge } = require('./cdn');

const router = express.Router();

async function getRoom(id) {
  const { rows } = await db.query(
    `SELECT r.*, u.username AS owner_name FROM live_rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

function isOwner(room, user) {
  return user && (user.id === room.owner_id || user.role === 'admin');
}

async function isBlacklisted(roomId, userId) {
  if (!userId) return false;
  const { rows } = await db.query('SELECT 1 FROM room_blacklist WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
  return !!rows[0];
}

async function checkRoomAccess(room, user, password) {
  if (isOwner(room, user)) return { ok: true };
  if (user && await isBlacklisted(room.id, user.id)) return { ok: false, reason: 'blacklisted' };
  if (room.password && room.password !== (password || '')) return { ok: false, reason: 'password' };
  return { ok: true };
}

function roomPublic(room, withSecrets = false) {
  const base = {
    id: room.id, title: room.title, description: room.description,
    owner_id: room.owner_id, owner_name: room.owner_name,
    is_live: room.is_live, live_started_at: room.live_started_at,
    has_password: !!room.password, created_at: room.created_at
  };
  if (withSecrets) {
    base.stream_key = room.stream_key;
    base.password = room.password;
    base.publish = streamUrls(room.stream_key); // rtmp_publish / whip_publish
  }
  return base;
}

// 直播间列表
router.get('/rooms', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, u.username AS owner_name FROM live_rooms r JOIN users u ON u.id = r.owner_id
       ORDER BY r.is_live DESC, r.created_at DESC LIMIT 100`);
    res.json(rows.map((r) => roomPublic(r, req.user && (req.user.id === r.owner_id || req.user.role === 'admin'))));
  } catch (e) { next(e); }
});

// 创建直播间
router.post('/rooms', requireAuth, async (req, res, next) => {
  try {
    const { title, description = '', password = null } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title 必填' });
    const streamKey = 'live_' + crypto.randomBytes(12).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO live_rooms (owner_id, title, description, stream_key, password)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, title.slice(0, 200), description.slice(0, 2000), streamKey, password || null]);
    res.status(201).json(roomPublic({ ...rows[0], owner_name: req.user.username }, true));
  } catch (e) { next(e); }
});

// 直播间信息（主播/管理员可见推流地址与密码）
router.get('/rooms/:id', optionalAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    res.json(roomPublic(room, isOwner(room, req.user)));
  } catch (e) { next(e); }
});

// 修改直播间（标题/简介/密码；密码传空字符串则取消）
router.patch('/rooms/:id', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    if (!isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { title, description, password } = req.body || {};
    const newPassword = password === undefined ? room.password : (password === '' ? null : password);
    const { rows } = await db.query(
      `UPDATE live_rooms SET title = COALESCE($1, title), description = COALESCE($2, description), password = $3
       WHERE id = $4 RETURNING *`, [title, description, newPassword, room.id]);
    res.json(roomPublic({ ...rows[0], owner_name: room.owner_name }, true));
  } catch (e) { next(e); }
});

// 观众获取播放地址（校验密码与黑名单；可走 CDN）
router.post('/rooms/:id/watch', optionalAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    const access = await checkRoomAccess(room, req.user, req.body && req.body.password);
    if (!access.ok) {
      return res.status(403).json({ error: access.reason === 'blacklisted' ? '你已被该直播间拉黑' : '直播间密码错误', reason: access.reason });
    }
    const edge = (req.query.cdn === 'off') ? null : await pickEdge();
    const urls = streamUrls(room.stream_key, edge && edge.base_url);
    // 当前在麦的连麦流
    const mics = await db.query(
      `SELECT m.id, m.user_id, m.stream_name, u.username FROM mic_sessions m
       JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 AND m.status = 'live'`, [room.id]);
    res.json({
      room: roomPublic(room),
      play: { flv: urls.flv, hls: urls.hls, whep: urls.whep },
      via_cdn: edge ? edge.name : null,
      mic_streams: mics.rows.map((m) => ({
        micId: m.id, userId: m.user_id, username: m.username,
        ...((u) => ({ flv: u.flv, hls: u.hls, whep: u.whep }))(streamUrls(m.stream_name, edge && edge.base_url))
      }))
    });
  } catch (e) { next(e); }
});

// 媒体流直链（API：主播/管理员获取本房间全部直链）
router.get('/rooms/:id/stream-urls', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    if (!isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    res.json({ stream_key: room.stream_key, urls: streamUrls(room.stream_key), is_live: room.is_live });
  } catch (e) { next(e); }
});

// ---- 黑名单 ----
router.get('/rooms/:id/blacklist', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await db.query(
      `SELECT b.user_id, u.username, b.created_at FROM room_blacklist b
       JOIN users u ON u.id = b.user_id WHERE b.room_id = $1`, [room.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/rooms/:id/blacklist', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { user_id, username } = req.body || {};
    let targetId = user_id;
    if (!targetId && username) {
      const u = await db.query('SELECT id FROM users WHERE username = $1', [username]);
      targetId = u.rows[0] && u.rows[0].id;
    }
    if (!targetId) return res.status(400).json({ error: '需要 user_id 或 username' });
    await db.query(
      `INSERT INTO room_blacklist (room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [room.id, targetId]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/rooms/:id/blacklist/:userId', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    await db.query('DELETE FROM room_blacklist WHERE room_id = $1 AND user_id = $2', [room.id, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- 连麦 ----
// 观众发起连麦请求
router.post('/rooms/:id/mic/request', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    if (!room.is_live) return res.status(400).json({ error: '直播未开始' });
    const access = await checkRoomAccess(room, req.user, req.body && req.body.password);
    if (!access.ok) return res.status(403).json({ error: '无权进入该直播间' });
    const streamName = `mic_${crypto.randomBytes(8).toString('hex')}`;
    const { rows } = await db.query(
      `INSERT INTO mic_sessions (room_id, user_id, stream_name) VALUES ($1,$2,$3) RETURNING *`,
      [room.id, req.user.id, streamName]);
    await emitRoomEvent(room, 'mic.requested', {
      micId: rows[0].id, userId: req.user.id, username: req.user.username
    });
    res.status(201).json({ micId: rows[0].id, status: 'requested' });
  } catch (e) { next(e); }
});

// 主播同意/拒绝连麦
router.post('/rooms/:id/mic/:micId/decision', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const approve = !!(req.body && req.body.approve);
    const { rows } = await db.query(
      `UPDATE mic_sessions SET status = $1, updated_at = now()
       WHERE id = $2 AND room_id = $3 AND status = 'requested' RETURNING *`,
      [approve ? 'approved' : 'rejected', req.params.micId, room.id]);
    const mic = rows[0];
    if (!mic) return res.status(404).json({ error: 'mic request not found or already handled' });
    const guest = (await db.query('SELECT username FROM users WHERE id = $1', [mic.user_id])).rows[0];
    if (approve) {
      await emitRoomEvent(room, 'mic.approved', { micId: mic.id, userId: mic.user_id, username: guest.username });
      // 私信连麦者推流地址（WHIP）
      await emitToUser(mic.user_id, 'mic.approved', {
        micId: mic.id, roomId: room.id,
        whip_publish: `${config.publicBaseUrl}/rtc/v1/whip/?app=live&stream=${mic.stream_name}`,
        stream_name: mic.stream_name
      });
    } else {
      await emitRoomEvent(room, 'mic.rejected', { micId: mic.id, userId: mic.user_id, username: guest.username });
      await emitToUser(mic.user_id, 'mic.rejected', { micId: mic.id, roomId: room.id });
    }
    res.json({ ok: true, status: approve ? 'approved' : 'rejected' });
  } catch (e) { next(e); }
});

// 结束连麦（主播或连麦者本人）
router.post('/rooms/:id/mic/:micId/end', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    const { rows } = await db.query('SELECT * FROM mic_sessions WHERE id = $1 AND room_id = $2',
      [req.params.micId, room.id]);
    const mic = rows[0];
    if (!mic) return res.status(404).json({ error: 'not found' });
    if (!isOwner(room, req.user) && mic.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    await db.query(`UPDATE mic_sessions SET status = 'ended', updated_at = now() WHERE id = $1`, [mic.id]);
    await kickStream(mic.stream_name).catch(() => {});
    const guest = (await db.query('SELECT username FROM users WHERE id = $1', [mic.user_id])).rows[0];
    await emitRoomEvent(room, 'mic.ended', { micId: mic.id, userId: mic.user_id, username: guest.username });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 连麦请求列表（主播）
router.get('/rooms/:id/mic', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await db.query(
      `SELECT m.*, u.username FROM mic_sessions m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = $1 AND m.status IN ('requested','approved','live') ORDER BY m.created_at`, [room.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// ---- 录制 ----
router.post('/rooms/:id/recording/start', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    if (!room.is_live) return res.status(400).json({ error: '直播未开始，无法录制' });
    const rec = await recorder.startRecording(room, req.user.id);
    res.status(201).json({ recordingId: rec.id, status: 'recording' });
  } catch (e) { next(e); }
});

router.post('/rooms/:id/recording/stop', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const r = await recorder.stopRecording(room.id);
    if (!r.stopping) return res.status(400).json({ error: r.reason });
    res.json(r);
  } catch (e) { next(e); }
});

router.get('/rooms/:id/recordings', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await db.query(
      'SELECT * FROM recordings WHERE room_id = $1 ORDER BY started_at DESC LIMIT 100', [room.id]);
    res.json(rows.map((r) => ({
      ...r,
      url: r.object_key ? `${config.publicBaseUrl}/storage/${config.buckets.recordings}/${r.object_key}` : null
    })));
  } catch (e) { next(e); }
});

// ---- 直播间自定义事件回调（主播设置区） ----
router.get('/rooms/:id/webhooks', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await db.query('SELECT * FROM room_webhooks WHERE room_id = $1 ORDER BY id', [room.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/rooms/:id/webhooks', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { url, secret = '', events = [] } = req.body || {};
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'url 必须是 http(s) 地址' });
    const { rows } = await db.query(
      'INSERT INTO room_webhooks (room_id, url, secret, events) VALUES ($1,$2,$3,$4) RETURNING *',
      [room.id, url, secret, events]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/rooms/:id/webhooks/:whId', requireAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room || !isOwner(room, req.user)) return res.status(403).json({ error: 'forbidden' });
    await db.query('DELETE FROM room_webhooks WHERE id = $1 AND room_id = $2', [req.params.whId, room.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 聊天历史
router.get('/rooms/:id/messages', optionalAuth, async (req, res, next) => {
  try {
    const room = await getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'room not found' });
    const { rows } = await db.query(
      `SELECT m.id, m.content, m.created_at, u.id AS user_id, u.username FROM live_messages m
       JOIN users u ON u.id = m.user_id WHERE m.room_id = $1 ORDER BY m.id DESC LIMIT 50`, [room.id]);
    res.json(rows.reverse());
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.getRoom = getRoom;
module.exports.checkRoomAccess = checkRoomAccess;
module.exports.isBlacklisted = isBlacklisted;

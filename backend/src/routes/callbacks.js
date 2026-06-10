'use strict';
// SRS HTTP 回调：推流鉴权 + 直播开始/结束事件
// SRS 约定：响应 JSON {code:0} 放行，非 0 拒绝
const express = require('express');
const db = require('../db/pool');
const { emitRoomEvent, emitToAdmins } = require('../lib/events');
const { streamUrls, findStream } = require('../lib/srs');
const recorder = require('../lib/recorder');

const router = express.Router();

function streamOf(body) {
  return (body && body.stream) || '';
}

async function roomByKey(streamKey) {
  const { rows } = await db.query(
    `SELECT r.*, u.username AS owner_name FROM live_rooms r JOIN users u ON u.id = r.owner_id
     WHERE r.stream_key = $1`, [streamKey]);
  return rows[0] || null;
}

// 推流鉴权：直播间主流（live_xxx）或连麦流（mic_xxx）
router.post('/on_publish', async (req, res) => {
  try {
    const stream = streamOf(req.body);
    if (stream.startsWith('live_')) {
      const room = await roomByKey(stream);
      if (!room) return res.json({ code: 403, msg: 'unknown stream key' });
      const owner = (await db.query('SELECT banned_until FROM users WHERE id = $1', [room.owner_id])).rows[0];
      if (owner.banned_until && new Date(owner.banned_until) > new Date()) {
        return res.json({ code: 403, msg: 'owner banned' });
      }
      await db.query(`UPDATE live_rooms SET is_live = true, live_started_at = now() WHERE id = $1`, [room.id]);
      await emitRoomEvent(room, 'live.started', { roomTitle: room.title, owner: room.owner_name });
      await emitToAdmins('admin.live.started', { roomId: room.id, roomTitle: room.title, owner: room.owner_name });
      await emitToAdmins('admin.stream.urls', { roomId: room.id, urls: streamUrls(stream) });
      return res.json({ code: 0 });
    }
    if (stream.startsWith('mic_')) {
      const { rows } = await db.query(
        `SELECT m.*, u.username FROM mic_sessions m JOIN users u ON u.id = m.user_id
         WHERE m.stream_name = $1 AND m.status IN ('approved','live')`, [stream]);
      const mic = rows[0];
      if (!mic) return res.json({ code: 403, msg: 'mic not approved' });
      await db.query(`UPDATE mic_sessions SET status = 'live', updated_at = now() WHERE id = $1`, [mic.id]);
      const room = (await db.query(
        `SELECT r.*, u.username AS owner_name FROM live_rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = $1`,
        [mic.room_id])).rows[0];
      if (room) {
        await emitRoomEvent(room, 'mic.live', {
          micId: mic.id, userId: mic.user_id, username: mic.username,
          streams: (({ flv, hls, whep }) => ({ flv, hls, whep }))(streamUrls(stream))
        });
      }
      return res.json({ code: 0 });
    }
    return res.json({ code: 403, msg: 'invalid stream name' });
  } catch (e) {
    console.error('[callbacks] on_publish', e.message);
    return res.json({ code: 500, msg: e.message });
  }
});

router.post('/on_unpublish', async (req, res) => {
  try {
    const stream = streamOf(req.body);
    if (stream.startsWith('live_')) {
      const room = await roomByKey(stream);
      if (room) {
        // 重复推流被拒(StreamBusy)的客户端断开也会触发 on_unpublish；
        // 先确认 SRS 上确实没有活跃发布者，避免把直播中的房间误标为下播
        const s = await findStream(stream).catch(() => null);
        if (s && s.publish && s.publish.active) return res.json({ code: 0 });
        await db.query(`UPDATE live_rooms SET is_live = false WHERE id = $1`, [room.id]);
        await recorder.stopRecording(room.id).catch(() => {});
        await emitRoomEvent(room, 'live.stopped', { roomTitle: room.title });
        await emitToAdmins('admin.live.stopped', { roomId: room.id, roomTitle: room.title });
      }
    } else if (stream.startsWith('mic_')) {
      const { rows } = await db.query(
        `UPDATE mic_sessions SET status = 'ended', updated_at = now()
         WHERE stream_name = $1 AND status = 'live' RETURNING *`, [stream]);
      const mic = rows[0];
      if (mic) {
        const room = (await db.query(
          `SELECT r.*, u.username AS owner_name FROM live_rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = $1`,
          [mic.room_id])).rows[0];
        const guest = (await db.query('SELECT username FROM users WHERE id = $1', [mic.user_id])).rows[0];
        if (room) await emitRoomEvent(room, 'mic.ended', { micId: mic.id, userId: mic.user_id, username: guest.username });
      }
    }
    res.json({ code: 0 });
  } catch (e) {
    console.error('[callbacks] on_unpublish', e.message);
    res.json({ code: 0 }); // 停流回调不阻塞
  }
});

// 播放回调：目前放行（密码/黑名单在 watch API 校验后才下发地址）
router.post('/on_play', (_req, res) => res.json({ code: 0 }));
router.post('/on_stop', (_req, res) => res.json({ code: 0 }));

module.exports = router;

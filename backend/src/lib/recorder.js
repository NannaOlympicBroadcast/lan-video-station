'use strict';
// 直播录制：后端 ffmpeg 从 SRS 拉 RTMP 流写本地 mp4，停止后转存 MinIO
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const db = require('../db/pool');
const { client: minio } = require('./minio');
const { emitRoomEvent, emitToAdmins } = require('./events');

const active = new Map(); // recordingId -> { proc, filePath, room }

async function startRecording(room, userId) {
  // 已在录制则直接返回现有记录
  for (const [, rec] of active) {
    if (rec.room.id === room.id) return rec.row;
  }
  const filePath = path.join(os.tmpdir(), `rec_${room.id}_${Date.now()}.mp4`);
  const { rows } = await db.query(
    `INSERT INTO recordings (room_id, started_by) VALUES ($1, $2) RETURNING *`, [room.id, userId]);
  const row = rows[0];

  const src = `${config.srs.rtmpInternal}/live/${room.stream_key}`;
  const proc = spawn('ffmpeg', [
    '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', filePath
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderrTail = '';
  proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-2000); });

  proc.on('close', async () => {
    active.delete(row.id);
    try {
      const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      if (!stat || stat.size === 0) {
        await db.query(`UPDATE recordings SET status='failed', stopped_at=now() WHERE id=$1`, [row.id]);
        console.error(`[recorder] recording ${row.id} produced no data. ffmpeg: ${stderrTail.slice(-300)}`);
        return;
      }
      const objectKey = `${room.id}/${row.id}.mp4`;
      await minio.fPutObject(config.buckets.recordings, objectKey, filePath, { 'Content-Type': 'video/mp4' });
      fs.unlinkSync(filePath);
      await db.query(
        `UPDATE recordings SET status='stored', object_key=$1, size_bytes=$2, stopped_at=now() WHERE id=$3`,
        [objectKey, stat.size, row.id]);
      await emitRoomEvent(room, 'recording.stored', {
        recordingId: row.id, objectKey,
        url: `${config.publicBaseUrl}/storage/${config.buckets.recordings}/${objectKey}`,
        sizeBytes: stat.size
      });
    } catch (e) {
      console.error('[recorder] store failed:', e.message);
      await db.query(`UPDATE recordings SET status='failed', stopped_at=now() WHERE id=$1`, [row.id]).catch(() => {});
    }
  });

  active.set(row.id, { proc, filePath, room, row });
  await emitRoomEvent(room, 'recording.started', { recordingId: row.id });
  await emitToAdmins('admin.recording.started', { roomId: room.id, recordingId: row.id });
  return row;
}

async function stopRecording(roomId) {
  for (const [id, rec] of active) {
    if (rec.room.id === roomId) {
      rec.proc.kill('SIGINT'); // 让 ffmpeg 正常收尾写 moov
      setTimeout(() => { try { rec.proc.kill('SIGKILL'); } catch {} }, 10000);
      return { stopping: true, recordingId: id };
    }
  }
  return { stopping: false, reason: 'no active recording for room' };
}

function isRecording(roomId) {
  for (const [, rec] of active) if (rec.room.id === roomId) return true;
  return false;
}

module.exports = { startRecording, stopRecording, isRecording };

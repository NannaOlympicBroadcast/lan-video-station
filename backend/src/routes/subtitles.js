'use strict';
// 字幕：列表 / 上传（挂在 /api/videos/:videoId/subtitles）
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/pool');
const config = require('../config');
const { client: minio, objectUrl } = require('../lib/minio');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { canSee } = require('./videos');

const upload = multer({ dest: path.join(os.tmpdir(), 'lvs-subs'), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router({ mergeParams: true });

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const v = (await db.query('SELECT * FROM videos WHERE id = $1', [req.params.videoId])).rows[0];
    if (!v || !canSee(v, req.user)) return res.status(404).json({ error: 'video not found' });
    const { rows } = await db.query(
      `SELECT s.id, s.lang, s.label, s.format, s.object_key, s.created_at, u.username AS uploader
       FROM subtitles s JOIN users u ON u.id = s.uploader_id WHERE s.video_id = $1 ORDER BY s.id`, [v.id]);
    res.json(rows.map((s) => ({ ...s, url: objectUrl(config.buckets.subtitles, s.object_key) })));
  } catch (e) { next(e); }
});

// 上传字幕（multipart: file (.vtt/.srt), lang, label）— srt 会自动转 vtt
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  const tmp = req.file && req.file.path;
  try {
    const v = (await db.query('SELECT * FROM videos WHERE id = $1', [req.params.videoId])).rows[0];
    if (!v || !canSee(v, req.user)) return res.status(404).json({ error: 'video not found' });
    if (!req.file) return res.status(400).json({ error: '缺少 file 字段' });

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!['.vtt', '.srt'].includes(ext)) return res.status(400).json({ error: '仅支持 .vtt / .srt' });

    let content = fs.readFileSync(tmp, 'utf8');
    if (ext === '.srt') {
      // SRT -> WebVTT：加头、逗号毫秒改点
      content = 'WEBVTT\n\n' + content
        .replace(/\r/g, '')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    const objectKey = `${v.id}/${uuidv4()}.vtt`;
    await minio.putObject(config.buckets.subtitles, objectKey, Buffer.from(content, 'utf8'),
      undefined, { 'Content-Type': 'text/vtt; charset=utf-8' });

    const { rows } = await db.query(
      `INSERT INTO subtitles (video_id, uploader_id, lang, label, format, object_key)
       VALUES ($1,$2,$3,$4,'vtt',$5) RETURNING *`,
      [v.id, req.user.id, req.body.lang || 'zh', req.body.label || '中文', objectKey]);
    res.status(201).json({ ...rows[0], url: objectUrl(config.buckets.subtitles, objectKey) });
  } catch (e) { next(e); }
  finally { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); }
});

router.delete('/:subId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM subtitles WHERE id = $1 AND video_id = $2',
      [req.params.subId, req.params.videoId]);
    const s = rows[0];
    if (!s) return res.status(404).json({ error: 'not found' });
    const v = (await db.query('SELECT owner_id FROM videos WHERE id = $1', [s.video_id])).rows[0];
    const allowed = s.uploader_id === req.user.id || v.owner_id === req.user.id || req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
    await minio.removeObject(config.buckets.subtitles, s.object_key).catch(() => {});
    await db.query('DELETE FROM subtitles WHERE id = $1', [s.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

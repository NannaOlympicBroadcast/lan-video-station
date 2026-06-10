'use strict';
// 视频：上传(MinIO) / 列表 / 详情 / 播放直链(可走CDN) / 下载 / 删除
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/pool');
const config = require('../config');
const { client: minio, objectUrl } = require('../lib/minio');
const { probeDuration, makeThumbnail } = require('../lib/ffmpeg');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { emitToAdmins, emitToUser } = require('../lib/events');
const { pickEdge } = require('./cdn');

const upload = multer({
  dest: path.join(os.tmpdir(), 'lvs-uploads'),
  limits: { fileSize: config.uploadLimitBytes }
});

const router = express.Router();

async function reviewRequired() {
  const { rows } = await db.query(`SELECT value FROM site_settings WHERE key = 'review_required'`);
  return rows[0] ? rows[0].value === true || rows[0].value === 'true' : true;
}

function canSee(video, user) {
  if (user && (user.role === 'admin' || user.id === video.owner_id)) return true;
  return video.visibility === 'public' && video.status === 'approved';
}

// 私有视频：白名单用户或密码正确可解锁观看
async function canAccess(video, user, password) {
  if (canSee(video, user)) return true;
  if (video.visibility !== 'private') return false;
  if (user) {
    const { rows } = await db.query(
      'SELECT 1 FROM video_whitelist WHERE video_id = $1 AND user_id = $2', [video.id, user.id]);
    if (rows[0]) return true;
  }
  return !!(video.unlock_password && password && password === video.unlock_password);
}

function publicVideo(v, edge) {
  return {
    id: v.id, owner_id: v.owner_id, owner_name: v.owner_name,
    title: v.title, description: v.description,
    duration_sec: v.duration_sec, size_bytes: Number(v.size_bytes || 0),
    visibility: v.visibility, status: v.status,
    reject_reason: v.reject_reason, takedown_reason: v.takedown_reason,
    views: Number(v.views || 0), created_at: v.created_at,
    has_password: !!v.unlock_password,
    thumbnail_url: v.thumbnail_key ? objectUrl(config.buckets.thumbnails, v.thumbnail_key, edge) : null
  };
}

// 公开视频列表
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const { rows } = await db.query(
      `SELECT v.*, u.username AS owner_name FROM videos v JOIN users u ON u.id = v.owner_id
       WHERE v.visibility = 'public' AND v.status = 'approved' AND (v.title ILIKE $1 OR v.description ILIKE $1)
       ORDER BY v.created_at DESC LIMIT 100`, [q]);
    res.json(rows.map((v) => publicVideo(v)));
  } catch (e) { next(e); }
});

// 我的视频
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT v.*, u.username AS owner_name FROM videos v JOIN users u ON u.id = v.owner_id
       WHERE v.owner_id = $1 ORDER BY v.created_at DESC`, [req.user.id]);
    res.json(rows.map((v) => publicVideo(v)));
  } catch (e) { next(e); }
});

// 上传（multipart: file 必填, title/description/visibility/unlock_password/collection_id 可选）
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  const tmp = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: '缺少 file 字段（multipart/form-data）' });
    const title = (req.body.title || req.file.originalname || '未命名').slice(0, 200);
    const description = (req.body.description || '').slice(0, 5000);
    const visibility = req.body.visibility === 'private' ? 'private' : 'public';
    const unlockPassword = visibility === 'private' && req.body.unlock_password ? req.body.unlock_password : null;
    const collectionId = req.body.collection_id || null;
    if (collectionId) {
      const c = await db.query('SELECT id FROM collections WHERE id = $1 AND owner_id = $2',
        [collectionId, req.user.id]);
      if (!c.rows[0]) return res.status(400).json({ error: '收藏夹不存在或不属于你' });
    }

    const needReview = await reviewRequired();
    // 私有视频不需要审核；公开视频按站点设置
    const status = visibility === 'private' ? 'approved' : (needReview ? 'pending' : 'approved');

    const id = uuidv4();
    const ext = (path.extname(req.file.originalname || '') || '.mp4').toLowerCase();
    const objectKey = `${id}${ext}`;

    const duration = await probeDuration(tmp);
    await minio.fPutObject(config.buckets.videos, objectKey, tmp,
      { 'Content-Type': req.file.mimetype || 'video/mp4' });

    let thumbnailKey = null;
    const thumb = await makeThumbnail(tmp);
    if (thumb) {
      thumbnailKey = `${id}.jpg`;
      await minio.fPutObject(config.buckets.thumbnails, thumbnailKey, thumb, { 'Content-Type': 'image/jpeg' });
      fs.unlinkSync(thumb);
    }

    const { rows } = await db.query(
      `INSERT INTO videos (id, owner_id, title, description, object_key, thumbnail_key, mime, size_bytes, duration_sec, visibility, status, unlock_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, req.user.id, title, description, objectKey, thumbnailKey,
       req.file.mimetype || 'video/mp4', req.file.size, duration, visibility, status, unlockPassword]);

    if (collectionId) {
      await db.query(
        `INSERT INTO collection_videos (collection_id, video_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [collectionId, id]);
    }

    await emitToUser(req.user.id, 'video.uploaded', { videoId: id, title, status });
    await emitToAdmins('admin.video.uploaded', {
      videoId: id, title, ownerId: req.user.id, ownerName: req.user.username, status, needReview
    });
    res.status(201).json({ ...publicVideo({ ...rows[0], owner_name: req.user.username }), message: status === 'pending' ? '已上传，等待管理员审核' : '已上传并上架' });
  } catch (e) { next(e); }
  finally { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); }
});

// 详情（私有视频可带 ?password= 解锁；无权限时返回锁定占位信息）
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT v.*, u.username AS owner_name FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = $1`,
      [req.params.id]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'video not found' });
    if (!(await canAccess(v, req.user, req.query.password))) {
      if (v.visibility === 'private') {
        return res.json({
          id: v.id, title: v.title, owner_id: v.owner_id, owner_name: v.owner_name,
          locked: true, has_password: !!v.unlock_password
        });
      }
      return res.status(404).json({ error: 'video not found' });
    }
    res.json(publicVideo(v));
  } catch (e) { next(e); }
});

// 播放/下载直链（可经 CDN 边缘）；?cdn=off 强制回源；私有视频可带 ?password=
router.get('/:id/play', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = rows[0];
    if (!v || !(await canAccess(v, req.user, req.query.password))) return res.status(404).json({ error: 'video not found' });
    const edge = req.query.cdn === 'off' ? null : await pickEdge();
    db.query('UPDATE videos SET views = views + 1 WHERE id = $1', [v.id]).catch(() => {});
    res.json({
      video_url: objectUrl(config.buckets.videos, v.object_key, edge && edge.base_url),
      download_url: objectUrl(config.buckets.videos, v.object_key, edge && edge.base_url),
      mime: v.mime,
      via_cdn: edge ? edge.name : null
    });
  } catch (e) { next(e); }
});

// 修改可见性/信息
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { title, description, visibility, unlock_password } = req.body || {};
    // 解锁密码：传空字符串取消，undefined 保持不变
    const newPassword = unlock_password === undefined ? v.unlock_password
      : (unlock_password === '' ? null : unlock_password);
    const upd = await db.query(
      `UPDATE videos SET title = COALESCE($1, title), description = COALESCE($2, description),
        visibility = COALESCE($3, visibility), unlock_password = $4 WHERE id = $5 RETURNING *`,
      [title, description, visibility, newPassword, v.id]);
    res.json(publicVideo(upd.rows[0]));
  } catch (e) { next(e); }
});

// ---- 私有视频白名单（视频主/管理员管理，按用户名添加） ----
router.get('/:id/whitelist', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const list = await db.query(
      `SELECT w.user_id, u.username, w.created_at FROM video_whitelist w
       JOIN users u ON u.id = w.user_id WHERE w.video_id = $1 ORDER BY w.created_at`, [v.id]);
    res.json(list.rows);
  } catch (e) { next(e); }
});

router.post('/:id/whitelist', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const { user_id, username } = req.body || {};
    let targetId = user_id;
    if (!targetId && username) {
      const u = await db.query('SELECT id FROM users WHERE username = $1', [username]);
      targetId = u.rows[0] && u.rows[0].id;
    }
    if (!targetId) return res.status(400).json({ error: '用户不存在（需要 user_id 或 username）' });
    await db.query(
      `INSERT INTO video_whitelist (video_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [v.id, targetId]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id/whitelist/:userId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    await db.query('DELETE FROM video_whitelist WHERE video_id = $1 AND user_id = $2', [v.id, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    await minio.removeObject(config.buckets.videos, v.object_key).catch(() => {});
    if (v.thumbnail_key) await minio.removeObject(config.buckets.thumbnails, v.thumbnail_key).catch(() => {});
    await db.query('DELETE FROM videos WHERE id = $1', [v.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.canSee = canSee;
module.exports.canAccess = canAccess;
module.exports.publicVideo = publicVideo;

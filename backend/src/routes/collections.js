'use strict';
// 视频收藏夹：创建/列表/详情(含视频列表)/增删视频/分享（公开收藏夹任何人可通过链接查看）
const express = require('express');
const db = require('../db/pool');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { canSee, publicVideo } = require('./videos');

const router = express.Router();

async function getCollection(id) {
  const { rows } = await db.query(
    `SELECT c.*, u.username AS owner_name FROM collections c JOIN users u ON u.id = c.owner_id WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

function isOwner(collection, user) {
  return user && (user.id === collection.owner_id || user.role === 'admin');
}

function collectionPublic(c) {
  return {
    id: c.id, owner_id: c.owner_id, owner_name: c.owner_name,
    name: c.name, description: c.description, visibility: c.visibility,
    video_count: c.video_count !== undefined ? Number(c.video_count) : undefined,
    created_at: c.created_at
  };
}

// 我的收藏夹
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u.username AS owner_name,
        (SELECT count(*) FROM collection_videos cv WHERE cv.collection_id = c.id) AS video_count
       FROM collections c JOIN users u ON u.id = c.owner_id
       WHERE c.owner_id = $1 ORDER BY c.created_at DESC`, [req.user.id]);
    res.json(rows.map(collectionPublic));
  } catch (e) { next(e); }
});

// 创建收藏夹
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description = '', visibility } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name 必填' });
    const { rows } = await db.query(
      `INSERT INTO collections (owner_id, name, description, visibility) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, name.trim().slice(0, 100), description.slice(0, 2000),
       visibility === 'private' ? 'private' : 'public']);
    res.status(201).json(collectionPublic({ ...rows[0], owner_name: req.user.username, video_count: 0 }));
  } catch (e) { next(e); }
});

// 收藏夹详情 + 视频列表（私有收藏夹仅本人/管理员；他人不可见的视频以锁定占位返回）
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const c = await getCollection(req.params.id);
    if (!c) return res.status(404).json({ error: 'collection not found' });
    if (c.visibility === 'private' && !isOwner(c, req.user)) {
      return res.status(404).json({ error: 'collection not found' });
    }
    const { rows } = await db.query(
      `SELECT v.*, u.username AS owner_name FROM collection_videos cv
       JOIN videos v ON v.id = cv.video_id JOIN users u ON u.id = v.owner_id
       WHERE cv.collection_id = $1 ORDER BY cv.position`, [c.id]);
    const videos = rows.map((v) => canSee(v, req.user)
      ? publicVideo(v)
      : { id: v.id, title: v.title, owner_id: v.owner_id, owner_name: v.owner_name,
          locked: true, has_password: !!v.unlock_password });
    res.json({ ...collectionPublic(c), video_count: videos.length, videos });
  } catch (e) { next(e); }
});

// 修改收藏夹
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const c = await getCollection(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (!isOwner(c, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { name, description, visibility } = req.body || {};
    const { rows } = await db.query(
      `UPDATE collections SET name = COALESCE($1, name), description = COALESCE($2, description),
        visibility = COALESCE($3, visibility) WHERE id = $4 RETURNING *`,
      [name, description, visibility, c.id]);
    res.json(collectionPublic({ ...rows[0], owner_name: c.owner_name }));
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const c = await getCollection(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (!isOwner(c, req.user)) return res.status(403).json({ error: 'forbidden' });
    await db.query('DELETE FROM collections WHERE id = $1', [c.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 添加视频到收藏夹
router.post('/:id/videos', requireAuth, async (req, res, next) => {
  try {
    const c = await getCollection(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (!isOwner(c, req.user)) return res.status(403).json({ error: 'forbidden' });
    const { video_id } = req.body || {};
    if (!video_id) return res.status(400).json({ error: 'video_id 必填' });
    const v = (await db.query('SELECT * FROM videos WHERE id = $1', [video_id])).rows[0];
    if (!v) return res.status(404).json({ error: 'video not found' });
    await db.query(
      `INSERT INTO collection_videos (collection_id, video_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [c.id, video_id]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id/videos/:videoId', requireAuth, async (req, res, next) => {
  try {
    const c = await getCollection(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (!isOwner(c, req.user)) return res.status(403).json({ error: 'forbidden' });
    await db.query('DELETE FROM collection_videos WHERE collection_id = $1 AND video_id = $2',
      [c.id, req.params.videoId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

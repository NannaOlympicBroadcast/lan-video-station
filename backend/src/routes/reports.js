'use strict';
// 举报：举报视频或评论
const express = require('express');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { emitToAdmins } = require('../lib/events');

const router = express.Router();
router.use(requireAuth);

// body: { target_type: 'video'|'comment', target_id, reason }
router.post('/', async (req, res, next) => {
  try {
    const { target_type, target_id, reason } = req.body || {};
    if (!['video', 'comment'].includes(target_type)) return res.status(400).json({ error: 'target_type 必须是 video 或 comment' });
    if (!target_id || !reason) return res.status(400).json({ error: 'target_id 和 reason 必填' });

    if (target_type === 'video') {
      const v = await db.query('SELECT id FROM videos WHERE id = $1', [target_id]);
      if (!v.rows[0]) return res.status(404).json({ error: 'video not found' });
    } else {
      const c = await db.query('SELECT id FROM comments WHERE id = $1', [target_id]);
      if (!c.rows[0]) return res.status(404).json({ error: 'comment not found' });
    }
    const { rows } = await db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, target_type, String(target_id), reason.slice(0, 1000)]);
    await emitToAdmins('admin.report.created', {
      reportId: rows[0].id, targetType: target_type, targetId: String(target_id),
      reason, reporter: req.user.username
    });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.get('/mine', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM reports WHERE reporter_id = $1 ORDER BY id DESC LIMIT 100', [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;

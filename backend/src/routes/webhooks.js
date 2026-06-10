'use strict';
// 用户级 webhook 配置 + 个人事件历史
const express = require('express');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, url, secret, events, enabled, created_at FROM user_webhooks WHERE user_id = $1 ORDER BY id', [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { url, secret = '', events = [] } = req.body || {};
    if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'url 必须是 http(s) 地址' });
    const { rows } = await db.query(
      'INSERT INTO user_webhooks (user_id, url, secret, events) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, url, secret, events]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { url, secret, events, enabled } = req.body || {};
    const { rows } = await db.query(
      `UPDATE user_webhooks SET
         url = COALESCE($1, url), secret = COALESCE($2, secret),
         events = COALESCE($3, events), enabled = COALESCE($4, enabled)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [url, secret, events, enabled, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM user_webhooks WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 个人事件历史（WS 掉线后可拉取）
router.get('/events', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const { rows } = await db.query(
      'SELECT id, type, payload, created_at FROM events WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
      [req.user.id, limit]);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;

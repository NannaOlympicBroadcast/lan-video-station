'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// 创建个人 API Key（可访问全部功能）
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body && req.body.name) || 'default';
    const token = 'lvs_' + crypto.randomBytes(24).toString('hex');
    const { rows } = await db.query(
      'INSERT INTO api_keys (user_id, name, token) VALUES ($1, $2, $3) RETURNING id, name, token, created_at',
      [req.user.id, name, token]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, left(token, 12) || '...' AS token_preview, created_at, last_used_at
       FROM api_keys WHERE user_id = $1 ORDER BY id DESC`, [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM api_keys WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

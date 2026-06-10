'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { username, password, email } = req.body || {};
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'username 必填，password 至少 6 位' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, username, email, role, created_at`,
      [username.trim(), email || null, hash]
    ).catch((e) => {
      if (e.code === '23505') throw Object.assign(new Error('用户名或邮箱已存在'), { status: 409 });
      throw e;
    });
    const user = rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username || '']);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      return res.status(403).json({ error: 'banned', banned_until: user.banned_until, reason: user.ban_reason });
    }
    delete user.password_hash;
    res.json({ user, token: signToken(user) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;

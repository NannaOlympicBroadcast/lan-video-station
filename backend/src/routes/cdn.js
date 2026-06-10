'use strict';
// CDN 节点：边缘自动注册 + 管理员管理 + 播放调度（轮询健康节点）
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
let rrCounter = 0;

// 选一个可用边缘节点（round-robin），无则回源（返回 null）
async function pickEdge() {
  const { rows } = await db.query('SELECT id, name, base_url FROM cdn_nodes WHERE enabled = true ORDER BY id');
  if (rows.length === 0) return null;
  return rows[rrCounter++ % rows.length];
}

// 边缘节点自动注册（容器启动脚本调用，凭注册 token）
router.post('/register', async (req, res, next) => {
  try {
    if (req.headers['x-cdn-register-token'] !== config.cdnRegisterToken) {
      return res.status(403).json({ error: 'bad register token' });
    }
    const { name, base_url } = req.body || {};
    if (!name || !base_url) return res.status(400).json({ error: 'name/base_url 必填' });
    const { rows } = await db.query(
      `INSERT INTO cdn_nodes (name, base_url, last_seen_at) VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE SET base_url = $2, last_seen_at = now() RETURNING *`,
      [name, base_url.replace(/\/$/, '')]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ---- 管理员管理 ----
router.use(requireAuth, requireAdmin);

router.get('/nodes', async (_req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM cdn_nodes ORDER BY id');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/nodes', async (req, res, next) => {
  try {
    const { name, base_url, enabled = true, type = 'edge' } = req.body || {};
    if (!name || !base_url) return res.status(400).json({ error: 'name/base_url 必填' });
    if (!['edge', 'public'].includes(type)) return res.status(400).json({ error: 'type 必须是 edge 或 public' });
    if (!/^https?:\/\//.test(base_url)) return res.status(400).json({ error: 'base_url 必须是 http(s) 地址' });
    const { rows } = await db.query(
      `INSERT INTO cdn_nodes (name, base_url, enabled, type) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET base_url = $2, enabled = $3, type = $4 RETURNING *`,
      [name, base_url.replace(/\/$/, ''), enabled, type]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/nodes/:id', async (req, res, next) => {
  try {
    const { base_url, enabled, name, type } = req.body || {};
    if (type !== undefined && !['edge', 'public'].includes(type)) {
      return res.status(400).json({ error: 'type 必须是 edge 或 public' });
    }
    if (base_url !== undefined && !/^https?:\/\//.test(base_url)) {
      return res.status(400).json({ error: 'base_url 必须是 http(s) 地址' });
    }
    const { rows } = await db.query(
      `UPDATE cdn_nodes SET name = COALESCE($1, name), base_url = COALESCE($2, base_url),
        enabled = COALESCE($3, enabled), type = COALESCE($4, type) WHERE id = $5 RETURNING *`,
      [name, base_url && base_url.replace(/\/$/, ''), enabled, type, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/nodes/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM cdn_nodes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 健康检查（管理员触发）：自建边缘节点探测 /edge/health；公网 CDN 仅探测可达性（HEAD 根路径）
router.post('/nodes/check', async (_req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM cdn_nodes');
    const results = [];
    for (const n of rows) {
      let ok = false;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = n.type === 'public'
          ? await fetch(n.base_url, { method: 'HEAD', signal: ctrl.signal })
          : await fetch(`${n.base_url}/edge/health`, { signal: ctrl.signal });
        clearTimeout(t);
        ok = n.type === 'public' ? r.status < 500 : r.ok;
      } catch { ok = false; }
      if (ok) await db.query('UPDATE cdn_nodes SET last_seen_at = now() WHERE id = $1', [n.id]);
      results.push({ id: n.id, name: n.name, base_url: n.base_url, type: n.type, healthy: ok });
    }
    res.json(results);
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.pickEdge = pickEdge;

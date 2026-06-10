'use strict';
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
const config = require('../config');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  // 初始化管理员
  const { rows } = await pool.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
  if (rows.length === 0) {
    const hash = await bcrypt.hash(config.admin.password, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO UPDATE SET role = 'admin'`,
      [config.admin.username, hash]
    );
    console.log(`[migrate] admin user "${config.admin.username}" created`);
  }
  console.log('[migrate] schema ready');
}

module.exports = { migrate };

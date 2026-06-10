'use strict';
// ffmpeg / ffprobe 工具：探测时长、生成缩略图
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
  });
}

async function probeDuration(filePath) {
  try {
    const out = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath
    ]);
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

async function makeThumbnail(filePath) {
  const out = path.join(os.tmpdir(), `thumb_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await run('ffmpeg', ['-y', '-ss', '1', '-i', filePath, '-vframes', '1', '-vf', 'scale=480:-2', out]);
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

module.exports = { run, probeDuration, makeThumbnail, spawn };

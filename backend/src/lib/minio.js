'use strict';
const Minio = require('minio');
const config = require('../config');

const client = new Minio.Client(config.minio);

// 公共读策略（对象 key 为随机 UUID，私有视频靠不可猜测的 key + API 权限控制）
function publicReadPolicy(bucket) {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${bucket}/*`]
    }]
  });
}

async function ensureBuckets() {
  for (const bucket of Object.values(config.buckets)) {
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (!exists) await client.makeBucket(bucket);
    await client.setBucketPolicy(bucket, publicReadPolicy(bucket));
  }
  console.log('[minio] buckets ready:', Object.values(config.buckets).join(', '));
}

// 浏览器可访问的对象 URL（经前端 nginx /storage/ 反代或 CDN 边缘）
function objectUrl(bucket, key, edgeBase) {
  const base = edgeBase || config.publicBaseUrl;
  return `${base}/storage/${bucket}/${key}`;
}

module.exports = { client, ensureBuckets, objectUrl };

'use strict';

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://lvs:lvs_password@localhost:5432/lvs',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret',
  jwtExpires: '7d',
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY || 'lvsminio',
    secretKey: process.env.MINIO_SECRET_KEY || 'lvsminio_secret'
  },
  buckets: { videos: 'videos', thumbnails: 'thumbnails', subtitles: 'subtitles', recordings: 'recordings' },
  // 对外地址（观众浏览器可达）
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost').replace(/\/$/, ''),
  srs: {
    rtmpHost: process.env.SRS_RTMP_HOST || 'localhost',           // 对外 RTMP 推流主机
    httpInternal: process.env.SRS_HTTP_INTERNAL || 'http://srs:8080', // 容器内 FLV/HLS
    apiInternal: process.env.SRS_API_INTERNAL || 'http://srs:1985',   // 容器内 SRS API
    rtmpInternal: process.env.SRS_RTMP_INTERNAL || 'rtmp://srs:1935', // 容器内 RTMP（录制用）
    callbackSecret: process.env.SRS_CALLBACK_SECRET || 'srs_cb_secret'
  },
  cdnRegisterToken: process.env.CDN_REGISTER_TOKEN || 'cdn_register_secret',
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin12345'
  },
  uploadLimitBytes: 4 * 1024 * 1024 * 1024 // 4GB
};

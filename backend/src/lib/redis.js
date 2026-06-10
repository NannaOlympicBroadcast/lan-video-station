'use strict';
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.redisUrl);
const sub = new Redis(config.redisUrl);

redis.on('error', (e) => console.error('[redis]', e.message));
sub.on('error', (e) => console.error('[redis:sub]', e.message));

module.exports = { redis, sub };

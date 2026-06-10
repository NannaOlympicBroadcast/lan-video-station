'use strict';
// SRS HTTP API 封装：查询流、踢流（断流）
const config = require('../config');

async function srsGet(path) {
  const res = await fetch(`${config.srs.apiInternal}${path}`);
  if (!res.ok) throw new Error(`SRS API ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function listStreams() {
  const data = await srsGet('/api/v1/streams/');
  return data.streams || [];
}

async function findStream(streamName) {
  const streams = await listStreams();
  return streams.find((s) => s.name === streamName) || null;
}

// 断流：找到 publisher client 并踢掉
async function kickStream(streamName) {
  const stream = await findStream(streamName);
  if (!stream) return { kicked: false, reason: 'stream not found' };
  const cid = stream.publish && stream.publish.cid;
  // SRS 5: stream.publish.cid 为发布者 client id；也兜底遍历 clients
  let clientId = cid;
  if (!clientId) {
    const data = await srsGet(`/api/v1/clients/?count=100`);
    const pub = (data.clients || []).find((c) => c.stream === streamName && c.publish === true);
    clientId = pub && pub.id;
  }
  if (!clientId) return { kicked: false, reason: 'publisher client not found' };
  const res = await fetch(`${config.srs.apiInternal}/api/v1/clients/${clientId}`, { method: 'DELETE' });
  return { kicked: res.ok, clientId };
}

// 拼装播放/推流直链
function streamUrls(streamName, edgeBase) {
  const base = edgeBase || config.publicBaseUrl;
  return {
    rtmp_publish: `rtmp://${config.srs.rtmpHost}/live/${streamName}`,
    whip_publish: `${config.publicBaseUrl}/rtc/v1/whip/?app=live&stream=${streamName}`,
    flv: `${base}/live/${streamName}.flv`,
    hls: `${base}/live/${streamName}.m3u8`,
    whep: `${config.publicBaseUrl}/rtc/v1/whep/?app=live&stream=${streamName}`,
    rtmp_play: `rtmp://${config.srs.rtmpHost}/live/${streamName}`
  };
}

module.exports = { listStreams, findStream, kickStream, streamUrls };

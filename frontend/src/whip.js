// 最小 WHIP/WHEP 客户端（SRS WebRTC 推/拉流）
// opts: maxBitrate(bps), maxFramerate, degradationPreference
export async function whipPublish(url, stream, opts = {}) {
  const pc = new RTCPeerConnection();
  for (const track of stream.getTracks()) {
    const sender = pc.addTrack(track, stream);
    if (track.kind === 'video') {
      // 限制编码码率/帧率，避免高分屏幕采集把软编码压垮导致卡顿
      try {
        const p = sender.getParameters();
        p.degradationPreference = opts.degradationPreference || 'maintain-framerate';
        p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
        p.encodings[0].maxBitrate = opts.maxBitrate || 2500000;
        p.encodings[0].maxFramerate = opts.maxFramerate || 30;
        await sender.setParameters(p);
      } catch { /* 浏览器不支持时忽略 */ }
    }
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offer.sdp
  });
  if (!res.ok) { pc.close(); throw new Error(`WHIP publish failed: HTTP ${res.status}`); }
  const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  return pc;
}

async function whepNegotiate(url, videoEl, kinds) {
  const pc = new RTCPeerConnection();
  kinds.forEach((k) => pc.addTransceiver(k, { direction: 'recvonly' }));
  pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offer.sdp
  });
  if (!res.ok) { pc.close(); throw new Error(`WHEP play failed: HTTP ${res.status}`); }
  const answer = await res.text();
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    return pc;
  } catch (e) {
    pc.close();
    e._answer = answer; // 留给上层解析实际 m-line
    throw e;
  }
}

export async function whepPlay(url, videoEl) {
  // SRS 的 WHEP answer 按「流的实际轨道」生成 m-line：
  // 纯视频流（如未勾选音频的屏幕共享）answer 只有 video 一条 m-line，
  // 与 audio+video 的 offer 不匹配会被浏览器拒绝。
  // 策略：先按 audio+video 协商；失败则解析 answer 实际包含的 m-line 种类与顺序重试。
  try {
    return await whepNegotiate(url, videoEl, ['audio', 'video']);
  } catch (e) {
    if (!e._answer) throw e;
    const kinds = [...e._answer.matchAll(/^m=(audio|video)/gm)].map((m) => m[1]);
    if (!kinds.length) throw e;
    return await whepNegotiate(url, videoEl, kinds);
  }
}

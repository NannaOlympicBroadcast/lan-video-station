<template>
  <div class="page">
    <!-- 密码 -->
    <div v-if="needPassword" class="modal-bg">
      <div class="modal form-grid">
        <h3>该直播间需要密码</h3>
        <input v-model="password" type="password" placeholder="直播间密码" @keyup.enter="enter" />
        <button @click="enter">进入</button>
        <p v-if="error" style="color:var(--danger)">{{ error }}</p>
      </div>
    </div>

    <template v-if="info">
      <div class="row" style="margin-bottom:10px">
        <span class="tag" :class="{ live: info.room.is_live }">{{ info.room.is_live ? '直播中' : '未开播' }}</span>
        <h2 style="margin:0">{{ info.room.title }}</h2>
        <span class="muted">主播：{{ info.room.owner_name }}</span>
        <span v-if="info.via_cdn" class="tag ok">CDN: {{ info.via_cdn }}</span>
      </div>

      <div class="live-layout">
        <div style="flex:1;min-width:0">
          <video ref="player" controls autoplay playsinline muted></video>
          <!-- 连麦小窗 -->
          <div class="row" style="margin-top:8px">
            <div v-for="m in micStreams" :key="m.micId" style="width:200px">
              <video :ref="(el) => setMicEl(m.micId, el)" autoplay playsinline style="width:100%"></video>
              <div class="muted">🎤 {{ m.username }}</div>
            </div>
          </div>
          <div class="row" style="margin-top:8px">
            <button class="ghost" @click="switchMode('rtc')">WebRTC(最流畅)</button>
            <button class="ghost" @click="switchMode('flv')">FLV(低延迟)</button>
            <button class="ghost" @click="switchMode('hls')">HLS</button>
            <template v-if="auth.loggedIn && info.room.is_live">
              <button v-if="micState === 'idle'" @click="requestMic">申请连麦</button>
              <span v-else-if="micState === 'requested'" class="tag warn">等待主播同意...</span>
              <button v-else-if="micState === 'publishing'" class="danger" @click="endMic">结束连麦</button>
            </template>
          </div>
          <p class="muted">{{ info.room.description }}</p>
        </div>

        <!-- 聊天 -->
        <div class="chat-panel">
          <div class="chat-msgs" ref="msgBox">
            <div v-for="(m, i) in messages" :key="i" :class="{ sys: m.sys }">
              <template v-if="m.sys">{{ m.text }}</template>
              <template v-else><strong>{{ m.username }}：</strong>{{ m.content }}</template>
            </div>
          </div>
          <div class="row" style="padding:10px">
            <input v-model="chatInput" :placeholder="auth.loggedIn ? '发送消息...' : '登录后可发言'"
              :disabled="!auth.loggedIn" @keyup.enter="sendChat" />
            <button :disabled="!auth.loggedIn" @click="sendChat">发送</button>
          </div>
        </div>
      </div>
    </template>
    <p v-else-if="error" style="color:var(--danger)">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import mpegts from 'mpegts.js';
import Hls from 'hls.js';
import { api } from '../api';
import { useAuth } from '../store';
import { createWS } from '../ws';
import { whipPublish, whepPlay } from '../whip';
import { ensureCapture, mediaUrl, getCaptureStream, captureErrorText } from '../media';

const route = useRoute();
const auth = useAuth();
const roomId = route.params.id;

const info = ref(null), error = ref(''), needPassword = ref(false), password = ref('');
const player = ref(null), msgBox = ref(null);
const messages = ref([]), chatInput = ref('');
const micState = ref('idle'); // idle/requested/publishing
const micStreams = ref([]);
const micEls = new Map(), micPcs = new Map();

let flvPlayer = null, hlsPlayer = null, mainRtcPc = null, ws = null, myMicPc = null, myMicId = null, myStream = null;

function sys(text) {
  messages.value.push({ sys: true, text });
  scrollChat();
}
function scrollChat() {
  nextTick(() => { if (msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight; });
}

function destroyPlayers() {
  if (flvPlayer) { flvPlayer.destroy(); flvPlayer = null; }
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
  if (mainRtcPc) { mainRtcPc.close(); mainRtcPc = null; }
  if (player.value) { player.value.srcObject = null; player.value.removeAttribute('src'); }
}

function switchMode(mode) {
  if (!info.value || !info.value.room.is_live) return;
  destroyPlayers();
  const el = player.value;
  if (mode === 'rtc') {
    // WebRTC 直看：不经 RTMP 转封装，延迟最低、最流畅（适合网页/屏幕推流的直播）
    whepPlay(mediaUrl(info.value.play.whep), el)
      .then((pc) => { mainRtcPc = pc; el.play().catch(() => {}); })
      .catch((e) => { sys(`WebRTC 播放失败(${e.message})，回退 FLV`); switchMode('flv'); });
    return;
  }
  if (mode === 'flv' && mpegts.isSupported()) {
    flvPlayer = mpegts.createPlayer(
      { type: 'flv', isLive: true, url: mediaUrl(info.value.play.flv) },
      {
        // 低延迟追帧：防止网络抖动后缓冲越积越大、画面忽快忽慢
        enableStashBuffer: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 2.5,
        liveBufferLatencyMinRemain: 0.5,
        autoCleanupSourceBuffer: true
      }
    );
    flvPlayer.attachMediaElement(el);
    flvPlayer.load();
    flvPlayer.play().catch(() => {});
  } else {
    const url = mediaUrl(info.value.play.hls);
    if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; el.play().catch(() => {}); }
    else if (Hls.isSupported()) {
      hlsPlayer = new Hls({ maxBufferLength: 10, liveSyncDurationCount: 2 });
      hlsPlayer.loadSource(url);
      hlsPlayer.attachMedia(el);
    }
  }
}

function setMicEl(micId, el) {
  if (!el || micEls.get(micId) === el) return;
  micEls.set(micId, el);
  const m = micStreams.value.find((x) => x.micId === micId);
  if (m && !micPcs.has(micId)) {
    whepPlay(mediaUrl(m.whep), el).then((pc) => micPcs.set(micId, pc)).catch((e) => sys(`连麦画面拉取失败: ${e.message}`));
  }
}

async function enter() {
  error.value = '';
  try {
    info.value = await api(`/live/rooms/${roomId}/watch`, { method: 'POST', body: { password: password.value } });
    needPassword.value = false;
    micStreams.value = info.value.mic_streams || [];
    const history = await api(`/live/rooms/${roomId}/messages`);
    messages.value = history.map((m) => ({ username: m.username, content: m.content }));
    setupWS();
    nextTick(() => switchMode('flv'));
  } catch (e) {
    if (e.data && e.data.reason === 'password') { needPassword.value = true; if (password.value) error.value = '密码错误'; }
    else error.value = e.message;
  }
}

function setupWS() {
  ws = createWS();
  ws.send({ type: 'join', roomId, password: password.value });
  ws.on((msg) => {
    if (msg.scope === 'room') {
      if (msg.type === 'chat.message') { messages.value.push({ username: msg.username, content: msg.content }); scrollChat(); }
      else if (msg.type === 'room.user.joined') sys(`${msg.username} 进入直播间`);
      else if (msg.type === 'room.user.left') sys(`${msg.username} 离开直播间`);
      else if (msg.type === 'live.started') { sys('直播开始了'); enterRefresh(); }
      else if (msg.type === 'live.stopped') { sys('直播已结束'); destroyPlayers(); }
      else if (msg.type === 'mic.live') {
        micStreams.value.push({ micId: msg.micId, username: msg.username, ...msg.streams });
        sys(`${msg.username} 开始连麦`);
      } else if (msg.type === 'mic.ended') {
        micStreams.value = micStreams.value.filter((m) => m.micId !== msg.micId);
        const pc = micPcs.get(msg.micId);
        if (pc) { pc.close(); micPcs.delete(msg.micId); }
        if (msg.micId === myMicId) stopMyMic();
        sys(`${msg.username} 结束连麦`);
      }
    }
    if (msg.scope === 'personal') {
      if (msg.type === 'mic.approved' && msg.micId === myMicId) startPublishMic(msg.whip_publish);
      if (msg.type === 'mic.rejected' && msg.micId === myMicId) { micState.value = 'idle'; sys('主播拒绝了你的连麦请求'); }
    }
  });
}

async function enterRefresh() {
  info.value = await api(`/live/rooms/${roomId}/watch`, { method: 'POST', body: { password: password.value } });
  nextTick(() => switchMode('flv'));
}

function sendChat() {
  const content = chatInput.value.trim();
  if (!content) return;
  ws.send({ type: 'chat', roomId, content });
  chatInput.value = '';
}

async function requestMic() {
  if (!ensureCapture()) return; // 连麦需要 HTTPS 安全上下文才能采集摄像头
  try {
    const r = await api(`/live/rooms/${roomId}/mic/request`, { method: 'POST', body: { password: password.value } });
    myMicId = r.micId;
    micState.value = 'requested';
    sys('已发送连麦请求，等待主播同意');
  } catch (e) { sys(`连麦请求失败: ${e.message}`); }
}

async function startPublishMic(whipUrl) {
  if (!ensureCapture()) { micState.value = 'idle'; return; }
  try {
    const cap = await getCaptureStream();
    myStream = cap.stream;
    if (cap.note) sys(`⚠️ ${cap.note}`);
    myMicPc = await whipPublish(mediaUrl(whipUrl), myStream);
    micState.value = 'publishing';
    sys(cap.videoEnabled ? '连麦已接通，你的画面正在推送' : '连麦已接通（仅语音）');
  } catch (e) {
    micState.value = 'idle';
    sys(`连麦推流失败: ${e._bothFailed ? '摄像头和麦克风都不可用。' + captureErrorText(e) : captureErrorText(e)}`);
  }
}

function stopMyMic() {
  if (myMicPc) { myMicPc.close(); myMicPc = null; }
  if (myStream) { myStream.getTracks().forEach((t) => t.stop()); myStream = null; }
  micState.value = 'idle';
}

async function endMic() {
  if (myMicId) await api(`/live/rooms/${roomId}/mic/${myMicId}/end`, { method: 'POST' }).catch(() => {});
  stopMyMic();
}

onMounted(enter);
onBeforeUnmount(() => {
  destroyPlayers();
  stopMyMic();
  micPcs.forEach((pc) => pc.close());
  if (ws) { ws.send({ type: 'leave', roomId }); ws.close(); }
});
</script>

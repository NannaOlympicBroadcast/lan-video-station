<template>
  <div class="page" v-if="room">
    <!-- Header -->
    <div class="row style-header" style="margin-bottom:14px">
      <span class="tag" :class="{ live: room.is_live }">{{ room.is_live ? '直播中' : '未开播' }}</span>
      <h2 style="margin:0">主播控制台 — {{ room.title }}</h2>
      <span class="spacer"></span>
      <router-link :to="`/live/${room.id}`"><button class="ghost">观众视角</button></router-link>
    </div>

    <!-- 3-Column Layout -->
    <div class="studio-layout">
      <!-- Left Column: Web Push & Mic Management -->
      <div class="studio-left">
        <!-- Option 1: Web Push -->
        <div class="card form-grid">
          <h3>方式一：网页推流（摄像头/屏幕）</h3>
          <video ref="preview" autoplay muted playsinline style="max-height:300px; background: #000;"></video>
          <div class="row">
            <button v-if="!publishing" @click="startWebPush('camera')">📷 摄像头开播</button>
            <button v-if="!publishing" class="ghost" @click="startWebPush('screen')">🖥️ 屏幕共享开播</button>
            <button v-else class="danger" @click="stopWebPush">停止网页推流</button>
          </div>
        </div>

        <!-- Co-hosting Management -->
        <div class="card">
          <h3>连麦管理</h3>
          <table>
            <tr><th>用户ID</th><th>请求时间</th><th>动作</th></tr>
            <tr v-for="m in mics" :key="m.id">
              <td>{{ m.username }}</td>
              <td>{{ m.created_at ? new Date(m.created_at).toLocaleString() : '未知' }}</td>
              <td class="row">
                <template v-if="m.status === 'requested'">
                  <button @click="decide(m, true)">接受</button>
                  <button class="ghost danger-text" @click="decide(m, false)">否决</button>
                </template>
                <button v-if="['approved','live'].includes(m.status)" class="danger" @click="endMic(m)">结束连麦</button>
              </td>
            </tr>
          </table>
          <p v-if="!mics.length" class="muted">暂无连麦请求</p>
        </div>
      </div>

      <!-- Middle Column: Live management / Settings / Callbacks Tabs -->
      <div class="studio-mid">
        <div class="tabs">
          <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">{{ t.name }}</button>
        </div>

        <!-- Live Management Tab -->
        <div v-show="tab === 'stream'" class="card form-grid">
          <h3>方式二：OBS 等软件 RTMP 推流</h3>
          
          <div class="input-copy-group">
            <span class="label">服务器：</span>
            <div class="input-copy-row">
              <input readonly :value="rtmpServer" class="copy-input" />
              <button class="copy-btn" @click="copyText(rtmpServer)" title="复制">
                <svg class="copy-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" /></svg>
              </button>
            </div>
          </div>

          <div class="input-copy-group">
            <span class="label">推流码：</span>
            <div class="input-copy-row">
              <input readonly :value="streamKeyOnly" class="copy-input" />
              <button class="copy-btn" @click="copyText(streamKeyOnly)" title="复制">
                <svg class="copy-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" /></svg>
              </button>
            </div>
          </div>

          <h3>播放直链（API 可获取）</h3>
          <div class="url-list" v-if="urls">
            <div class="url-item">
              <span class="url-label">FLV:</span>
              <code class="url-code">{{ urls.flv }}</code>
            </div>
            <div class="url-item">
              <span class="url-label">HLS:</span>
              <code class="url-code">{{ urls.hls }}</code>
            </div>
            <div class="url-item">
              <span class="url-label">WebRTC:</span>
              <code class="url-code">{{ urls.whep }}</code>
            </div>
          </div>

          <div class="row" style="margin-top: 10px;">
            <button class="ghost" @click="toggleRecording" :disabled="!room.is_live">
              {{ recording ? '⏹ 停止录制' : '⏺ 开始录制' }}
            </button>
          </div>
          
          <table v-if="recordings.length" class="recordings-table">
            <tr><th>录制时间</th><th>状态</th><th>文件</th></tr>
            <tr v-for="r in recordings" :key="r.id">
              <td>{{ new Date(r.started_at).toLocaleString() }}</td>
              <td><span class="tag" :class="{ ok: r.status === 'stored', warn: r.status === 'recording' }">{{ r.status }}</span></td>
              <td><a v-if="r.url" :href="r.url" target="_blank">下载</a></td>
            </tr>
          </table>
        </div>

        <!-- Settings Tab -->
        <div v-show="tab === 'settings'" class="card form-grid">
          <h3>直播间设置</h3>
          <input v-model="form.title" placeholder="标题" />
          <textarea v-model="form.description" rows="2" placeholder="简介"></textarea>
          <input v-model="form.password" placeholder="直播间密码（留空 = 无密码）" />
          <button @click="saveSettings">保存</button>

          <h3>黑名单</h3>
          <div class="row">
            <input v-model="blackName" placeholder="要拉黑的用户名" style="max-width:220px" />
            <button class="ghost" @click="addBlack">拉黑</button>
          </div>
          <table v-if="blacklist.length">
            <tr v-for="b in blacklist" :key="b.user_id">
              <td>{{ b.username }}</td>
              <td><button class="ghost" @click="removeBlack(b)">移除</button></td>
            </tr>
          </table>
        </div>

        <!-- Events Webhook Tab -->
        <div v-show="tab === 'webhooks'" class="card form-grid">
          <h3>直播间事件回调（Webhook）</h3>
          <p class="muted">可监听: live.started, live.stopped, room.user.joined, room.user.left, chat.message,
            mic.requested, mic.approved, mic.rejected, mic.live, mic.ended, recording.started, recording.stored。
            留空 = 全部事件。也可直接连接 <code>/ws?token=...</code> 以 WebSocket 实时接收。</p>
          <input v-model="whForm.url" placeholder="回调 URL（http://...）" />
          <input v-model="whForm.secret" placeholder="签名密钥（可选，HMAC-SHA256 于 X-LVS-Signature 头）" />
          <input v-model="whForm.events" placeholder="事件列表，逗号分隔（留空=全部）" />
          <button @click="addWebhook">添加回调</button>
          <table v-if="webhooks.length">
            <tr><th>URL</th><th>事件</th><th></th></tr>
            <tr v-for="w in webhooks" :key="w.id">
              <td><code>{{ w.url }}</code></td>
              <td>{{ w.events.length ? w.events.join(', ') : '全部' }}</td>
              <td><button class="ghost" @click="delWebhook(w)">删除</button></td>
            </tr>
          </table>
        </div>
      </div>

      <!-- Right Column: Interactive Chat Room -->
      <div class="studio-right">
        <div class="chat-panel">
          <div class="chat-header">
            <h4>互动聊天</h4>
          </div>
          <div class="chat-msgs" ref="msgBox">
            <div v-for="(m, i) in messages" :key="i" :class="{ sys: m.sys }">
              <template v-if="m.sys">{{ m.text }}</template>
              <template v-else><strong>{{ m.username }}：</strong>{{ m.content }}</template>
            </div>
          </div>
          <div class="row chat-input-area">
            <input v-model="chatInput" :placeholder="auth.loggedIn ? '发送消息...' : '登录后可发言'"
              :disabled="!auth.loggedIn" @keyup.enter="sendChat" />
            <button :disabled="!auth.loggedIn" @click="sendChat">发送</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Notice banner -->
    <p v-if="notice" class="notice-text">{{ notice }}</p>

    <!-- Bottom-right mic request popup modal -->
    <Transition name="slide-up">
      <div v-if="activeMicRequest" class="mic-request-popup">
        <div class="popup-header">
          <span class="popup-title">🎤 连麦申请</span>
          <button class="close-btn" @click="activeMicRequest = null">&times;</button>
        </div>
        <div class="popup-body">
          <strong>{{ activeMicRequest.username }}</strong> 申请与您连麦。
        </div>
        <div class="popup-actions">
          <button class="accept-btn" @click="handlePopupDecision(true)">接听</button>
          <button class="reject-btn" @click="handlePopupDecision(false)">拒绝</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { createWS } from '../ws';
import { whipPublish } from '../whip';
import { ensureCapture, mediaUrl, getCaptureStream, captureErrorText } from '../media';
import { useAuth } from '../store';

const route = useRoute();
const auth = useAuth();
const roomId = route.params.id;

const tabs = [
  { key: 'stream', name: '直播管理' },
  { key: 'settings', name: '设置与黑名单' },
  { key: 'webhooks', name: '事件回调' }
];
const tab = ref('stream');
const room = ref(null), urls = ref(null), mics = ref([]), blacklist = ref([]), webhooks = ref([]), recordings = ref([]);
const form = ref({ title: '', description: '', password: '' });
const whForm = ref({ url: '', secret: '', events: '' });
const blackName = ref(''), notice = ref('');
const publishing = ref(false), recording = ref(false);
const preview = ref(null);

// Chat-related state
const messages = ref([]);
const chatInput = ref('');
const msgBox = ref(null);

// Popup request state
const activeMicRequest = ref(null);

let pc = null, stream = null, ws = null;

const rtmpServer = computed(() => room.value && room.value.publish ? room.value.publish.rtmp_publish.replace(/\/[^/]+$/, '') : '');
const streamKeyOnly = computed(() => room.value ? room.value.stream_key : '');

async function load() {
  room.value = await api(`/live/rooms/${roomId}`);
  form.value = { title: room.value.title, description: room.value.description, password: room.value.password || '' };
  const su = await api(`/live/rooms/${roomId}/stream-urls`);
  urls.value = su.urls;
  mics.value = await api(`/live/rooms/${roomId}/mic`);
  blacklist.value = await api(`/live/rooms/${roomId}/blacklist`);
  webhooks.value = await api(`/live/rooms/${roomId}/webhooks`);
  recordings.value = await api(`/live/rooms/${roomId}/recordings`);
  recording.value = recordings.value.some((r) => r.status === 'recording');
  
  // Load chat messages history
  const history = await api(`/live/rooms/${roomId}/messages`);
  messages.value = history.map((m) => ({ username: m.username, content: m.content }));
  scrollChat();
}

function scrollChat() {
  nextTick(() => { if (msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight; });
}

function setupWS() {
  ws = createWS();
  ws.send({ type: 'join', roomId, password: form.value.password });
  ws.on((msg) => {
    // Reload data for mic and room control signals
    if (['mic.requested', 'mic.live', 'mic.ended', 'live.started', 'live.stopped', 'recording.stored'].includes(msg.type)) {
      load();
      if (msg.type === 'mic.requested') {
        notice.value = `🎤 ${msg.username} 请求连麦`;
        // Open the bottom-right popup
        activeMicRequest.value = { id: msg.micId, username: msg.username };
      }
    }
    
    // Handle chat panel events
    if (msg.scope === 'room') {
      if (msg.type === 'chat.message') {
        messages.value.push({ username: msg.username, content: msg.content });
        scrollChat();
      } else if (msg.type === 'room.user.joined') {
        messages.value.push({ sys: true, text: `${msg.username} 进入直播间` });
        scrollChat();
      } else if (msg.type === 'room.user.left') {
        messages.value.push({ sys: true, text: `${msg.username} 离开直播间` });
        scrollChat();
      }
    }
  });
}

function sendChat() {
  const content = chatInput.value.trim();
  if (!content) return;
  ws.send({ type: 'chat', roomId, content });
  chatInput.value = '';
}

async function startWebPush(kind) {
  if (!ensureCapture()) return; // 摄像头/屏幕共享需要 HTTPS 安全上下文
  try {
    let pubOpts = { maxBitrate: 2500000, maxFramerate: 30 };
    if (kind === 'screen') {
      // 限制分辨率/帧率：高分屏原始采集会压垮浏览器软编码导致卡顿
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: true
      });
      const vt = stream.getVideoTracks()[0];
      if (vt) vt.contentHint = 'motion'; // 优先流畅度（看视频/动态画面）；演示文档可改 'detail'
      pubOpts = { maxBitrate: 4000000, maxFramerate: 30, degradationPreference: 'maintain-framerate' };
    } else {
      const cap = await getCaptureStream();
      stream = cap.stream;
      if (cap.note) notice.value = `⚠️ ${cap.note}`;
    }
    preview.value.srcObject = stream;
    pc = await whipPublish(mediaUrl(room.value.publish.whip_publish), stream, pubOpts);
    publishing.value = true;
    if (!notice.value.startsWith('⚠️')) notice.value = '网页推流已开始';
  } catch (e) { notice.value = `推流失败: ${captureErrorText(e)}`; }
}

function stopWebPush() {
  if (pc) { pc.close(); pc = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (preview.value) preview.value.srcObject = null;
  publishing.value = false;
}

async function toggleRecording() {
  try {
    if (recording.value) await api(`/live/rooms/${roomId}/recording/stop`, { method: 'POST' });
    else await api(`/live/rooms/${roomId}/recording/start`, { method: 'POST' });
    recording.value = !recording.value;
    setTimeout(load, 1500);
  } catch (e) { notice.value = e.message; }
}

async function decide(m, approve) {
  await api(`/live/rooms/${roomId}/mic/${m.id}/decision`, { method: 'POST', body: { approve } });
  load();
}

async function handlePopupDecision(approve) {
  if (!activeMicRequest.value) return;
  const m = { id: activeMicRequest.value.id, username: activeMicRequest.value.username };
  activeMicRequest.value = null;
  await decide(m, approve);
}

async function endMic(m) {
  await api(`/live/rooms/${roomId}/mic/${m.id}/end`, { method: 'POST' });
  load();
}

async function saveSettings() {
  await api(`/live/rooms/${roomId}`, { method: 'PATCH', body: { ...form.value } });
  notice.value = '设置已保存';
  load();
}

async function addBlack() {
  if (!blackName.value) return;
  try {
    await api(`/live/rooms/${roomId}/blacklist`, { method: 'POST', body: { username: blackName.value } });
    blackName.value = '';
    load();
  } catch (e) { notice.value = e.message; }
}
async function removeBlack(b) {
  await api(`/live/rooms/${roomId}/blacklist/${b.user_id}`, { method: 'DELETE' });
  load();
}

async function addWebhook() {
  try {
    await api(`/live/rooms/${roomId}/webhooks`, {
      method: 'POST',
      body: {
        url: whForm.value.url,
        secret: whForm.value.secret,
        events: whForm.value.events ? whForm.value.events.split(',').map((s) => s.trim()).filter(Boolean) : []
      }
    });
    whForm.value = { url: '', secret: '', events: '' };
    load();
  } catch (e) { notice.value = e.message; }
}
async function delWebhook(w) {
  await api(`/live/rooms/${roomId}/webhooks/${w.id}`, { method: 'DELETE' });
  load();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notice.value = '已复制到剪贴板';
    setTimeout(() => {
      if (notice.value === '已复制到剪贴板') notice.value = '';
    }, 2000);
  } catch (e) {
    notice.value = '复制失败: ' + e.message;
  }
}

onMounted(async () => { await load(); setupWS(); });
onBeforeUnmount(() => { stopWebPush(); if (ws) ws.close(); });
</script>

<style scoped>
/* 3-column layout structure */
.studio-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-top: 14px;
}

.studio-left {
  flex: 1.2;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.studio-mid {
  flex: 1.5;
  min-width: 0;
}

.studio-right {
  width: 320px;
  flex-shrink: 0;
}

/* Copy group style */
.input-copy-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.input-copy-group .label {
  font-size: 14px;
  color: var(--muted);
}
.input-copy-row {
  display: flex;
  gap: 8px;
}
.copy-input {
  flex: 1;
  background: var(--panel2);
  border: 1px solid #2b3242;
  color: var(--text);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
}
.copy-btn {
  background: var(--accent);
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  transition: background-color 0.2s, transform 0.1s;
}
.copy-btn:hover {
  background-color: #3b74e6;
}
.copy-btn:active {
  transform: scale(0.95);
}
.copy-icon {
  width: 18px;
  height: 18px;
}

/* Playback url styling */
.url-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--panel2);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #2b3242;
  margin-bottom: 14px;
}
.url-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.url-label {
  font-weight: bold;
  color: var(--accent);
  width: 60px;
  flex-shrink: 0;
}
.url-code {
  word-break: break-all;
  background: none;
  padding: 0;
  color: var(--text);
}

/* Notice banners */
.notice-text {
  background: rgba(79, 140, 255, 0.15);
  color: var(--accent);
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  margin-top: 14px;
  border: 1px solid rgba(79, 140, 255, 0.3);
}

/* Chat Panel */
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 580px;
  background: var(--panel);
  border-radius: var(--radius);
  border: 1px solid #2b3242;
  overflow: hidden;
}
.chat-header {
  padding: 12px 16px;
  background: var(--panel2);
  border-bottom: 1px solid #2b3242;
}
.chat-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.chat-input-area {
  padding: 12px;
  background: var(--panel2);
  border-top: 1px solid #2b3242;
}

/* Mic request popup */
.mic-request-popup {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 280px;
  background: var(--panel2);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.popup-title {
  font-weight: bold;
  color: var(--accent);
  font-size: 14px;
}
.close-btn {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.close-btn:hover {
  color: var(--text);
}
.popup-body {
  font-size: 13px;
  color: var(--text);
  line-height: 1.4;
}
.popup-actions {
  display: flex;
  gap: 10px;
}
.popup-actions button {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 6px;
  font-weight: 500;
}
.accept-btn {
  background: var(--accent);
  color: #fff;
}
.accept-btn:hover {
  background-color: #3b74e6;
}
.reject-btn {
  background: rgba(255, 93, 93, 0.15);
  color: var(--danger);
  border: 1px solid rgba(255, 93, 93, 0.3) !important;
}
.reject-btn:hover {
  background: var(--danger);
  color: #fff;
}

/* Transition animations */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px) scale(0.95);
  opacity: 0;
}

/* Table overrides */
.danger-text {
  color: var(--danger);
  border-color: rgba(255, 93, 93, 0.3) !important;
}
.danger-text:hover {
  background-color: rgba(255, 93, 93, 0.1) !important;
}

/* Mobile responsive styles */
@media (max-width: 960px) {
  .studio-layout {
    flex-direction: column;
    align-items: stretch;
  }
  .studio-right {
    width: 100%;
  }
  .chat-panel {
    height: 380px;
  }
}
</style>

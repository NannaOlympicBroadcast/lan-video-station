<template>
  <div class="page" v-if="room">
    <div class="row" style="margin-bottom:10px">
      <span class="tag" :class="{ live: room.is_live }">{{ room.is_live ? '直播中' : '未开播' }}</span>
      <h2 style="margin:0">主播控制台 — {{ room.title }}</h2>
      <span class="spacer"></span>
      <router-link :to="`/live/${room.id}`"><button class="ghost">观众视角</button></router-link>
    </div>

    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">{{ t.name }}</button>
    </div>

    <!-- 推流 -->
    <div v-show="tab === 'stream'" class="card form-grid">
      <h3>方式一：网页推流（摄像头/屏幕）</h3>
      <video ref="preview" autoplay muted playsinline style="max-height:300px"></video>
      <div class="row">
        <button v-if="!publishing" @click="startWebPush('camera')">📷 摄像头开播</button>
        <button v-if="!publishing" class="ghost" @click="startWebPush('screen')">🖥️ 屏幕共享开播</button>
        <button v-else class="danger" @click="stopWebPush">停止网页推流</button>
      </div>
      <h3>方式二：OBS 等软件 RTMP 推流</h3>
      <p>服务器：<code>{{ rtmpServer }}</code></p>
      <p>推流码：<code>{{ streamKeyOnly }}</code></p>
      <h3>播放直链（API 可获取）</h3>
      <p v-if="urls">FLV: <code>{{ urls.flv }}</code><br/>HLS: <code>{{ urls.hls }}</code><br/>WebRTC: <code>{{ urls.whep }}</code></p>
      <div class="row">
        <button class="ghost" @click="toggleRecording" :disabled="!room.is_live">
          {{ recording ? '⏹ 停止录制' : '⏺ 开始录制' }}
        </button>
      </div>
      <table v-if="recordings.length">
        <tr><th>录制时间</th><th>状态</th><th>文件</th></tr>
        <tr v-for="r in recordings" :key="r.id">
          <td>{{ new Date(r.started_at).toLocaleString() }}</td>
          <td><span class="tag" :class="{ ok: r.status === 'stored', warn: r.status === 'recording' }">{{ r.status }}</span></td>
          <td><a v-if="r.url" :href="r.url" target="_blank">下载</a></td>
        </tr>
      </table>
    </div>

    <!-- 连麦管理 -->
    <div v-show="tab === 'mic'" class="card">
      <h3>连麦请求</h3>
      <table>
        <tr><th>用户</th><th>状态</th><th>操作</th></tr>
        <tr v-for="m in mics" :key="m.id">
          <td>{{ m.username }}</td>
          <td><span class="tag" :class="{ ok: m.status === 'live', warn: m.status === 'requested' }">{{ m.status }}</span></td>
          <td class="row">
            <template v-if="m.status === 'requested'">
              <button @click="decide(m, true)">同意</button>
              <button class="ghost" @click="decide(m, false)">拒绝</button>
            </template>
            <button v-if="['approved','live'].includes(m.status)" class="danger" @click="endMic(m)">结束连麦</button>
          </td>
        </tr>
      </table>
      <p v-if="!mics.length" class="muted">暂无连麦请求</p>
    </div>

    <!-- 设置 -->
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

    <!-- 事件回调 -->
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

    <p v-if="notice" class="muted">{{ notice }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { createWS } from '../ws';
import { whipPublish } from '../whip';
import { ensureCapture, mediaUrl, getCaptureStream, captureErrorText } from '../media';

const route = useRoute();
const roomId = route.params.id;
const tabs = [
  { key: 'stream', name: '推流与录制' },
  { key: 'mic', name: '连麦管理' },
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
}

function setupWS() {
  ws = createWS();
  ws.send({ type: 'join', roomId, password: form.value.password });
  ws.on((msg) => {
    if (['mic.requested', 'mic.live', 'mic.ended', 'live.started', 'live.stopped', 'recording.stored'].includes(msg.type)) {
      load();
      if (msg.type === 'mic.requested') notice.value = `🎤 ${msg.username} 请求连麦`;
    }
  });
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

onMounted(async () => { await load(); setupWS(); });
onBeforeUnmount(() => { stopWebPush(); if (ws) ws.close(); });
</script>

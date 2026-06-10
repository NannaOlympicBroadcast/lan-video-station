<template>
  <div class="page" style="max-width:760px">
    <h2>个人设置</h2>

    <div class="card form-grid" style="margin-bottom:14px">
      <h3>API Key</h3>
      <p class="muted">使用 <code>X-API-Key: lvs_xxx</code> 或 <code>Authorization: Bearer lvs_xxx</code> 调用全部 API。</p>
      <div class="row">
        <input v-model="keyName" placeholder="Key 名称" style="max-width:200px" />
        <button @click="createKey">创建 API Key</button>
      </div>
      <p v-if="newKey" style="color:var(--ok)">已创建（仅显示一次，请保存）：<code>{{ newKey }}</code></p>
      <table v-if="keys.length">
        <tr><th>名称</th><th>Key</th><th>最后使用</th><th></th></tr>
        <tr v-for="k in keys" :key="k.id">
          <td>{{ k.name }}</td>
          <td><code>{{ k.token_preview }}</code></td>
          <td class="muted">{{ k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '从未' }}</td>
          <td><button class="ghost" @click="delKey(k)">删除</button></td>
        </tr>
      </table>
    </div>

    <div class="card form-grid" style="margin-bottom:14px">
      <h3>事件 Webhook</h3>
      <p class="muted">
        可监听: video.uploaded, video.review.approved, video.review.rejected, video.taken_down,
        video.comment.created, account.banned, live.started, live.stopped, mic.requested, recording.stored 等。
        留空 = 全部。POST JSON，带 <code>X-LVS-Event</code> 与 <code>X-LVS-Signature</code>(HMAC-SHA256) 头。
        也可直接连接 WebSocket：<code>ws://站点/ws?token=&lt;JWT 或 API Key&gt;</code>
      </p>
      <input v-model="whForm.url" placeholder="回调 URL" />
      <input v-model="whForm.secret" placeholder="签名密钥（可选）" />
      <input v-model="whForm.events" placeholder="事件列表，逗号分隔（留空=全部）" />
      <button @click="addWebhook">添加 Webhook</button>
      <table v-if="webhooks.length">
        <tr><th>URL</th><th>事件</th><th>启用</th><th></th></tr>
        <tr v-for="w in webhooks" :key="w.id">
          <td><code>{{ w.url }}</code></td>
          <td>{{ w.events.length ? w.events.join(', ') : '全部' }}</td>
          <td><input type="checkbox" :checked="w.enabled" @change="toggle(w, $event)" style="width:auto" /></td>
          <td><button class="ghost" @click="delWebhook(w)">删除</button></td>
        </tr>
      </table>
    </div>

    <div class="card">
      <h3>最近事件</h3>
      <table>
        <tr><th>时间</th><th>类型</th><th>内容</th></tr>
        <tr v-for="e in events" :key="e.id">
          <td class="muted">{{ new Date(e.created_at).toLocaleString() }}</td>
          <td><span class="tag">{{ e.type }}</span></td>
          <td class="muted" style="word-break:break-all">{{ JSON.stringify(e.payload).slice(0, 120) }}</td>
        </tr>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const keys = ref([]), newKey = ref(''), keyName = ref('');
const webhooks = ref([]), events = ref([]);
const whForm = ref({ url: '', secret: '', events: '' });

async function load() {
  keys.value = await api('/keys');
  webhooks.value = await api('/me/webhooks');
  events.value = await api('/me/webhooks/events');
}

async function createKey() {
  const k = await api('/keys', { method: 'POST', body: { name: keyName.value || 'default' } });
  newKey.value = k.token;
  load();
}
async function delKey(k) { await api(`/keys/${k.id}`, { method: 'DELETE' }); load(); }

async function addWebhook() {
  await api('/me/webhooks', {
    method: 'POST',
    body: {
      url: whForm.value.url,
      secret: whForm.value.secret,
      events: whForm.value.events ? whForm.value.events.split(',').map((s) => s.trim()).filter(Boolean) : []
    }
  });
  whForm.value = { url: '', secret: '', events: '' };
  load();
}
async function toggle(w, e) {
  await api(`/me/webhooks/${w.id}`, { method: 'PATCH', body: { enabled: e.target.checked } });
}
async function delWebhook(w) { await api(`/me/webhooks/${w.id}`, { method: 'DELETE' }); load(); }

onMounted(load);
</script>

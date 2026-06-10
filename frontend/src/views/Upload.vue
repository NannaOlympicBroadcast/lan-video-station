<template>
  <div class="page" style="max-width:560px">
    <div class="card form-grid">
      <h2>上传视频</h2>
      <input type="file" accept="video/*" @change="onFile" />
      <input v-model="title" placeholder="标题" />
      <textarea v-model="description" rows="3" placeholder="简介"></textarea>
      <select v-model="visibility">
        <option value="public">公开（可能需要管理员审核）</option>
        <option value="private">私有（仅自己可见）</option>
      </select>
      <button :disabled="!file || uploading" @click="submit">
        {{ uploading ? `上传中 ${progress}%` : '上传' }}
      </button>
      <p v-if="msg" :style="{ color: ok ? 'var(--ok)' : 'var(--danger)' }">{{ msg }}</p>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>我的视频</h3>
      <table>
        <tr><th>标题</th><th>状态</th><th>可见性</th><th></th></tr>
        <tr v-for="v in mine" :key="v.id">
          <td><router-link :to="`/video/${v.id}`">{{ v.title }}</router-link></td>
          <td>
            <span class="tag" :class="{ ok: v.status==='approved', warn: v.status==='pending' }">{{ statusText(v) }}</span>
          </td>
          <td>{{ v.visibility === 'public' ? '公开' : '私有' }}</td>
          <td><button class="ghost" @click="del(v)">删除</button></td>
        </tr>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { useAuth } from '../store';

const file = ref(null), title = ref(''), description = ref(''), visibility = ref('public');
const uploading = ref(false), progress = ref(0), msg = ref(''), ok = ref(false);
const mine = ref([]);
const auth = useAuth();

function onFile(e) {
  file.value = e.target.files[0] || null;
  if (file.value && !title.value) title.value = file.value.name.replace(/\.[^.]+$/, '');
}

function statusText(v) {
  return { pending: '待审核', approved: '已上架', rejected: `已拒绝: ${v.reject_reason || ''}`, taken_down: `已下架: ${v.takedown_reason || ''}` }[v.status] || v.status;
}

async function loadMine() { mine.value = await api('/videos/mine'); }

function submit() {
  msg.value = ''; uploading.value = true; progress.value = 0;
  const fd = new FormData();
  fd.append('file', file.value);
  fd.append('title', title.value);
  fd.append('description', description.value);
  fd.append('visibility', visibility.value);
  // XHR 以获得上传进度
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/videos');
  xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) progress.value = Math.round((e.loaded / e.total) * 100); };
  xhr.onload = () => {
    uploading.value = false;
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) { ok.value = true; msg.value = data.message || '上传成功'; loadMine(); }
      else { ok.value = false; msg.value = data.error || `HTTP ${xhr.status}`; }
    } catch { ok.value = false; msg.value = `HTTP ${xhr.status}`; }
  };
  xhr.onerror = () => { uploading.value = false; ok.value = false; msg.value = '网络错误'; };
  xhr.send(fd);
}

async function del(v) {
  if (!confirm(`删除「${v.title}」？`)) return;
  await api(`/videos/${v.id}`, { method: 'DELETE' });
  loadMine();
}

onMounted(loadMine);
</script>

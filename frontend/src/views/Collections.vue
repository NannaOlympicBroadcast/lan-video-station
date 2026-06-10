<template>
  <div class="page" style="max-width:720px">
    <div class="card form-grid" style="margin-bottom:14px">
      <h2>我的收藏夹</h2>
      <div class="row">
        <input v-model="name" placeholder="收藏夹名称" @keyup.enter="create" />
        <select v-model="visibility" style="max-width:170px">
          <option value="public">公开（可分享）</option>
          <option value="private">私有（仅自己）</option>
        </select>
        <button @click="create">创建</button>
      </div>
    </div>

    <div class="card">
      <table>
        <tr><th>名称</th><th>视频数</th><th>可见性</th><th></th></tr>
        <tr v-for="c in collections" :key="c.id">
          <td><router-link :to="`/collection/${c.id}`">{{ c.name }}</router-link></td>
          <td>{{ c.video_count }}</td>
          <td>{{ c.visibility === 'public' ? '公开' : '私有' }}</td>
          <td class="row" style="justify-content:flex-end">
            <button class="ghost" v-if="c.visibility === 'public'" @click="share(c)">分享</button>
            <button class="ghost" @click="del(c)">删除</button>
          </td>
        </tr>
      </table>
      <p v-if="!collections.length" class="muted">还没有收藏夹，创建一个吧。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const collections = ref([]), name = ref(''), visibility = ref('public');

async function load() { collections.value = await api('/collections/mine'); }

async function create() {
  if (!name.value.trim()) return;
  await api('/collections', { method: 'POST', body: { name: name.value.trim(), visibility: visibility.value } });
  name.value = '';
  load();
}

async function share(c) {
  const url = `${location.origin}/collection/${c.id}`;
  try { await navigator.clipboard.writeText(url); alert(`分享链接已复制：${url}`); }
  catch { prompt('复制分享链接：', url); }
}

async function del(c) {
  if (!confirm(`删除收藏夹「${c.name}」？（不会删除其中的视频）`)) return;
  await api(`/collections/${c.id}`, { method: 'DELETE' });
  load();
}

onMounted(load);
</script>

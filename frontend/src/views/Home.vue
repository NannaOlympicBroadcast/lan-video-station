<template>
  <div class="page">
    <div class="row" style="margin-bottom:14px">
      <input v-model="q" placeholder="搜索视频..." style="max-width:320px" @keyup.enter="load" />
      <button class="ghost" @click="load">搜索</button>
    </div>
    <div class="grid">
      <router-link v-for="v in videos" :key="v.id" :to="`/video/${v.id}`" class="card" style="padding:0;overflow:hidden">
        <img v-if="v.thumbnail_url" :src="v.thumbnail_url" class="thumb" />
        <div v-else class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">无封面</div>
        <div style="padding:10px">
          <div style="font-weight:600;color:var(--text)">{{ v.title }}</div>
          <div class="muted">{{ v.owner_name }} · {{ v.views }} 次观看 · {{ fmtDur(v.duration_sec) }}</div>
        </div>
      </router-link>
    </div>
    <p v-if="!videos.length" class="muted">暂无公开视频</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const videos = ref([]), q = ref('');
async function load() { videos.value = await api(`/videos?q=${encodeURIComponent(q.value)}`); }
function fmtDur(s) {
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
onMounted(load);
</script>

<template>
  <div class="page" v-if="creator">
    <div class="card row" style="margin-bottom:14px">
      <div style="width:56px;height:56px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:24px">
        {{ creator.username[0].toUpperCase() }}
      </div>
      <div>
        <h2 style="margin:0">{{ creator.username }}</h2>
        <div class="muted">{{ creator.video_count }} 个视频 · {{ creator.total_views }} 总播放 · 加入于 {{ new Date(creator.created_at).toLocaleDateString() }}</div>
        <div v-if="creator.bio" class="muted">{{ creator.bio }}</div>
      </div>
    </div>
    <div class="grid">
      <router-link v-for="v in videos" :key="v.id" :to="`/video/${v.id}`" class="card" style="padding:0;overflow:hidden">
        <img v-if="v.thumbnail_url" :src="v.thumbnail_url" class="thumb" />
        <div v-else class="thumb"></div>
        <div style="padding:10px">
          <div style="font-weight:600;color:var(--text)">{{ v.title }}</div>
          <div class="muted">{{ v.views }} 次观看 <span v-if="v.status !== 'approved'" class="tag warn">{{ v.status }}</span></div>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';

const route = useRoute();
const creator = ref(null), videos = ref([]);

async function load() {
  creator.value = await api(`/users/${route.params.id}`);
  videos.value = await api(`/users/${route.params.id}/videos`);
}
onMounted(load);
watch(() => route.params.id, load);
</script>

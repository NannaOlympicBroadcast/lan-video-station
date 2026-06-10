<template>
  <div class="page" v-if="collection">
    <div class="row" style="margin-bottom:14px">
      <h2 style="margin:0">📁 {{ collection.name }}</h2>
      <span class="muted">{{ collection.owner_name }} · {{ collection.videos.length }} 个视频</span>
      <span v-if="collection.visibility === 'private'" class="tag warn">私有</span>
      <span class="spacer"></span>
      <button class="ghost" v-if="collection.visibility === 'public'" @click="share">分享</button>
    </div>
    <p class="muted" v-if="collection.description">{{ collection.description }}</p>

    <div class="grid">
      <div v-for="v in collection.videos" :key="v.id" class="card" style="padding:0;overflow:hidden;position:relative">
        <router-link :to="`/video/${v.id}?collection=${collection.id}`">
          <img v-if="v.thumbnail_url" :src="v.thumbnail_url" class="thumb" />
          <div v-else class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">
            {{ v.locked ? '🔒 私有视频' : '无封面' }}
          </div>
          <div style="padding:10px">
            <div style="font-weight:600;color:var(--text)">{{ v.locked ? '🔒 ' : '' }}{{ v.title }}</div>
            <div class="muted">{{ v.owner_name }}<template v-if="!v.locked"> · {{ v.views }} 次观看</template></div>
          </div>
        </router-link>
        <button v-if="isOwner" class="ghost" style="position:absolute;top:6px;right:6px;padding:4px 10px"
          @click="remove(v)">移除</button>
      </div>
    </div>
    <p v-if="!collection.videos.length" class="muted">收藏夹是空的。</p>
  </div>
  <div class="page" v-else><p class="muted">{{ error || '加载中...' }}</p></div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useAuth } from '../store';

const route = useRoute();
const auth = useAuth();
const collection = ref(null), error = ref('');
const isOwner = computed(() =>
  auth.loggedIn && collection.value && (auth.user.id === collection.value.owner_id || auth.isAdmin));

async function load() {
  try { collection.value = await api(`/collections/${route.params.id}`); }
  catch (e) { error.value = e.message; }
}

async function share() {
  const url = `${location.origin}/collection/${collection.value.id}`;
  try { await navigator.clipboard.writeText(url); alert(`分享链接已复制：${url}`); }
  catch { prompt('复制分享链接：', url); }
}

async function remove(v) {
  if (!confirm(`从收藏夹移除「${v.title}」？`)) return;
  await api(`/collections/${collection.value.id}/videos/${v.id}`, { method: 'DELETE' });
  load();
}

onMounted(load);
</script>

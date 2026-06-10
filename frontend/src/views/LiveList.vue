<template>
  <div class="page">
    <div class="row" style="margin-bottom:14px">
      <h2 style="margin:0">直播间</h2>
      <span class="spacer"></span>
      <button v-if="auth.loggedIn" @click="creating = true">创建直播间</button>
    </div>
    <div class="grid">
      <div v-for="r in rooms" :key="r.id" class="card">
        <div class="row">
          <span class="tag" :class="{ live: r.is_live }">{{ r.is_live ? '直播中' : '未开播' }}</span>
          <span v-if="r.has_password" class="tag">🔒</span>
        </div>
        <h3 style="margin:8px 0 4px">{{ r.title }}</h3>
        <div class="muted">主播：{{ r.owner_name }}</div>
        <div class="row" style="margin-top:10px">
          <router-link :to="`/live/${r.id}`"><button class="ghost">进入观看</button></router-link>
          <router-link v-if="auth.loggedIn && auth.user.id === r.owner_id" :to="`/studio/${r.id}`">
            <button>主播控制台</button>
          </router-link>
        </div>
      </div>
    </div>
    <p v-if="!rooms.length" class="muted">暂无直播间</p>

    <div v-if="creating" class="modal-bg" @click.self="creating = false">
      <div class="modal form-grid">
        <h3>创建直播间</h3>
        <input v-model="form.title" placeholder="直播间标题" />
        <textarea v-model="form.description" rows="2" placeholder="简介"></textarea>
        <input v-model="form.password" placeholder="直播间密码（留空则公开）" />
        <div class="row">
          <button @click="create">创建</button>
          <button class="ghost" @click="creating = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useAuth } from '../store';

const auth = useAuth();
const router = useRouter();
const rooms = ref([]), creating = ref(false);
const form = ref({ title: '', description: '', password: '' });

async function load() { rooms.value = await api('/live/rooms'); }
async function create() {
  const r = await api('/live/rooms', { method: 'POST', body: { ...form.value, password: form.value.password || null } });
  creating.value = false;
  router.push(`/studio/${r.id}`);
}
onMounted(load);
</script>

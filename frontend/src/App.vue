<template>
  <nav class="nav">
    <router-link to="/" class="brand">📺 LAN 视频站</router-link>
    <router-link to="/" class="link">视频</router-link>
    <router-link to="/live" class="link">直播</router-link>
    <router-link v-if="auth.loggedIn" to="/upload" class="link">上传</router-link>
    <span class="spacer"></span>
    <template v-if="auth.loggedIn">
      <router-link v-if="auth.isAdmin" to="/admin" class="link">管理后台</router-link>
      <router-link to="/settings" class="link">设置</router-link>
      <router-link :to="`/user/${auth.user.id}`" class="link">{{ auth.user.username }}</router-link>
      <button class="ghost" @click="logout">退出</button>
    </template>
    <template v-else>
      <router-link to="/login" class="link">登录</router-link>
      <router-link to="/register" class="link">注册</router-link>
    </template>
  </nav>
  <router-view />
</template>

<script setup>
import { useAuth } from './store';
import { useRouter } from 'vue-router';
const auth = useAuth();
const router = useRouter();
function logout() { auth.logout(); router.push('/login'); }
</script>

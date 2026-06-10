<template>
  <div class="page" style="max-width:400px">
    <div class="card form-grid">
      <h2>登录</h2>
      <input v-model="username" placeholder="用户名或邮箱" />
      <input v-model="password" type="password" placeholder="密码" @keyup.enter="submit" />
      <button :disabled="loading" @click="submit">{{ loading ? '登录中...' : '登录' }}</button>
      <p class="muted">没有账号？<router-link to="/register">注册</router-link></p>
      <p v-if="error" style="color:var(--danger)">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useAuth } from '../store';

const username = ref(''), password = ref(''), error = ref(''), loading = ref(false);
const auth = useAuth();
const router = useRouter();

async function submit() {
  error.value = ''; loading.value = true;
  try {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { username: username.value, password: password.value } });
    auth.setSession(token, user);
    router.push('/');
  } catch (e) {
    error.value = e.data && e.data.reason ? e.message : (e.message === 'banned' ? `账号被封禁至 ${e.data.banned_until}：${e.data.reason}` : e.message);
  } finally { loading.value = false; }
}
</script>

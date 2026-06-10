<template>
  <div class="page" style="max-width:400px">
    <div class="card form-grid">
      <h2>注册</h2>
      <input v-model="username" placeholder="用户名" />
      <input v-model="email" placeholder="邮箱（可选）" />
      <input v-model="password" type="password" placeholder="密码（至少 6 位）" @keyup.enter="submit" />
      <button :disabled="loading" @click="submit">{{ loading ? '注册中...' : '注册' }}</button>
      <p class="muted">已有账号？<router-link to="/login">登录</router-link></p>
      <p v-if="error" style="color:var(--danger)">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useAuth } from '../store';

const username = ref(''), email = ref(''), password = ref(''), error = ref(''), loading = ref(false);
const auth = useAuth();
const router = useRouter();

async function submit() {
  error.value = ''; loading.value = true;
  try {
    const { token, user } = await api('/auth/register', { method: 'POST', body: { username: username.value, email: email.value || undefined, password: password.value } });
    auth.setSession(token, user);
    router.push('/');
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}
</script>

<template>
  <div class="page" v-if="video">
    <video ref="player" controls playsinline crossorigin="anonymous">
      <track v-for="s in subtitles" :key="s.id" kind="subtitles" :src="s.url" :srclang="s.lang" :label="s.label" />
    </video>
    <h2 style="margin:10px 0 4px">{{ video.title }}</h2>
    <div class="row muted">
      <router-link :to="`/user/${video.owner_id}`">{{ video.owner_name }}</router-link>
      <span>{{ video.views }} 次观看</span>
      <span v-if="viaCdn" class="tag ok">CDN: {{ viaCdn }}</span>
      <span class="spacer"></span>
      <a v-if="play" :href="play.download_url" download>下载</a>
      <button class="ghost" v-if="auth.loggedIn" @click="reporting = true">举报</button>
    </div>
    <p>{{ video.description }}</p>

    <!-- 添加字幕 -->
    <div class="card" v-if="auth.loggedIn" style="margin-bottom:14px">
      <div class="row">
        <strong>字幕</strong>
        <span class="muted" v-for="s in subtitles" :key="s.id">{{ s.label }}({{ s.lang }})</span>
        <span class="spacer"></span>
        <input ref="subFile" type="file" accept=".vtt,.srt" style="max-width:220px" />
        <input v-model="subLang" placeholder="语言码" style="max-width:90px" />
        <input v-model="subLabel" placeholder="名称" style="max-width:110px" />
        <button class="ghost" @click="uploadSub">上传字幕</button>
      </div>
    </div>

    <!-- 评论 -->
    <div class="card">
      <h3>评论 ({{ comments.length }})</h3>
      <div class="row" v-if="auth.loggedIn" style="margin-bottom:12px">
        <input v-model="newComment" :placeholder="replyTo ? `回复 @${replyTo.username}...` : '发表评论...'" @keyup.enter="postComment" />
        <button @click="postComment">发送</button>
        <button v-if="replyTo" class="ghost" @click="replyTo = null">取消回复</button>
      </div>
      <p v-else class="muted"><router-link to="/login">登录</router-link>后参与评论</p>
      <div v-for="c in topComments" :key="c.id" style="margin-bottom:12px">
        <div><strong>{{ c.username }}</strong> <span class="muted">{{ fmtTime(c.created_at) }}</span></div>
        <div>{{ c.content }}</div>
        <div class="row muted" style="font-size:13px">
          <a href="#" @click.prevent="replyTo = c">回复</a>
          <a href="#" v-if="auth.loggedIn" @click.prevent="reportComment(c)">举报</a>
          <a href="#" v-if="canDelete(c)" @click.prevent="delComment(c)" style="color:var(--danger)">删除</a>
        </div>
        <div v-for="r in repliesOf(c.id)" :key="r.id" style="margin:8px 0 0 24px">
          <div><strong>{{ r.username }}</strong> <span class="muted">{{ fmtTime(r.created_at) }}</span></div>
          <div>{{ r.content }}</div>
          <div class="row muted" style="font-size:13px">
            <a href="#" v-if="auth.loggedIn" @click.prevent="reportComment(r)">举报</a>
            <a href="#" v-if="canDelete(r)" @click.prevent="delComment(r)" style="color:var(--danger)">删除</a>
          </div>
        </div>
      </div>
    </div>

    <!-- 举报弹窗 -->
    <div v-if="reporting" class="modal-bg" @click.self="reporting = false">
      <div class="modal form-grid">
        <h3>举报{{ reportTarget.type === 'video' ? '视频' : '评论' }}</h3>
        <textarea v-model="reportReason" rows="3" placeholder="举报理由"></textarea>
        <div class="row">
          <button class="danger" @click="submitReport">提交举报</button>
          <button class="ghost" @click="reporting = false">取消</button>
        </div>
      </div>
    </div>
  </div>
  <div class="page" v-else><p class="muted">{{ error || '加载中...' }}</p></div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { useAuth } from '../store';
import { mediaUrl } from '../media';

const route = useRoute();
const auth = useAuth();
const video = ref(null), play = ref(null), viaCdn = ref(null), error = ref('');
const subtitles = ref([]), comments = ref([]);
const newComment = ref(''), replyTo = ref(null);
const reporting = ref(false), reportReason = ref(''), reportTarget = ref({ type: 'video', id: null });
const player = ref(null), subFile = ref(null);
const subLang = ref('zh'), subLabel = ref('中文');

const topComments = computed(() => comments.value.filter((c) => !c.parent_id));
const repliesOf = (id) => comments.value.filter((c) => c.parent_id === id);
const fmtTime = (t) => new Date(t).toLocaleString();
const canDelete = (c) => auth.loggedIn && (auth.user.id === c.user_id || auth.isAdmin);

async function load() {
  try {
    const id = route.params.id;
    video.value = await api(`/videos/${id}`);
    play.value = await api(`/videos/${id}/play`);
    viaCdn.value = play.value.via_cdn;
    subtitles.value = await api(`/videos/${id}/subtitles`);
    comments.value = await api(`/videos/${id}/comments`);
    requestAnimationFrame(() => { if (player.value) player.value.src = mediaUrl(play.value.video_url); });
  } catch (e) { error.value = e.message; }
}

async function postComment() {
  if (!newComment.value.trim()) return;
  await api(`/videos/${video.value.id}/comments`, {
    method: 'POST',
    body: { content: newComment.value, parent_id: replyTo.value ? replyTo.value.id : undefined }
  });
  newComment.value = ''; replyTo.value = null;
  comments.value = await api(`/videos/${video.value.id}/comments`);
}

async function delComment(c) {
  await api(`/videos/${video.value.id}/comments/${c.id}`, { method: 'DELETE' });
  comments.value = await api(`/videos/${video.value.id}/comments`);
}

function reportComment(c) {
  reportTarget.value = { type: 'comment', id: c.id };
  reporting.value = true;
}

async function submitReport() {
  if (!reportReason.value.trim()) return;
  await api('/reports', {
    method: 'POST',
    body: {
      target_type: reportTarget.value.type,
      target_id: reportTarget.value.type === 'video' ? video.value.id : reportTarget.value.id,
      reason: reportReason.value
    }
  });
  reporting.value = false; reportReason.value = '';
  reportTarget.value = { type: 'video', id: null };
  alert('举报已提交');
}

async function uploadSub() {
  const f = subFile.value.files[0];
  if (!f) return alert('请选择字幕文件 (.vtt/.srt)');
  const fd = new FormData();
  fd.append('file', f);
  fd.append('lang', subLang.value);
  fd.append('label', subLabel.value);
  await api(`/videos/${video.value.id}/subtitles`, { method: 'POST', formData: fd });
  subtitles.value = await api(`/videos/${video.value.id}/subtitles`);
  alert('字幕已上传，刷新页面生效');
}

onMounted(load);
</script>

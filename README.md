# LAN Video Station — 局域网全栈视频站

视频点播 + 直播 + 连麦 + 开放 API/Webhook + 局域网 CDN，全部 Docker Compose 一键部署。

技术栈：Node.js (Express) · Vue 3 (Vite) · PostgreSQL · Redis · MinIO（视频存储）· SRS 5.0（RTMP/WebRTC/HLS/FLV）· Nginx（网关 + CDN 边缘）

## 快速开始

```bash
cp .env.example .env
# 必改：LAN_IP 设为宿主机的局域网 IP（WebRTC 连麦/网页推流依赖它）
docker compose up -d --build
```

| 入口 | 地址 |
|---|---|
| 站点（电脑/手机浏览器） | http://LAN_IP |
| 站点 HTTPS（网页推流/连麦必须） | https://LAN_IP |
| MinIO 控制台 | http://LAN_IP:9001 |
| CDN 边缘节点 1 | http://LAN_IP:8081 |
| RTMP 推流（OBS） | rtmp://LAN_IP/live/<推流码> |

默认管理员：`.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（默认 admin / admin12345）。

## 功能

**视频**：注册/登录、上传（自动取时长 + 生成缩略图，存 MinIO）、播放（公开/私有）、评论与回复、字幕（vtt/srt 上传，srt 自动转 vtt）、举报视频与评论、下载直链。

**私有视频解锁**：私有视频默认仅自己可见；视频主可设置「解锁密码」（观众凭密码观看）或将用户名加入白名单（白名单用户登录后直接观看）。上传时可设密码，视频页（视频主可见）可改密码/管理白名单。

**收藏夹**：创建/分享视频收藏夹（公开收藏夹复制链接即可分享，他人无法看到的私有视频在列表中以 🔒 锁定占位显示）；从收藏夹打开视频后，右侧显示收藏夹内全部视频可连续切换；上传发布时可选择已有收藏夹自动加入；视频页「⭐ 收藏」可随时加入/新建收藏夹。

**审核**：管理后台可切换「免审模式」。开审核时公开视频需管理员通过才上架；管理员可以理由下架视频（触发 `video.taken_down` 事件）、封禁用户一定时长（小时，触发 `account.banned`）。

**直播**：
- 推流：网页推流（摄像头/屏幕共享，WebRTC WHIP）或 OBS RTMP 推流，推流码在主播控制台。主播控制台已支持一键复制 RTMP 服务器地址和推流码。
- 观看：HTTP-FLV（低延迟，mpegts.js）/ HLS（移动端友好），网页移动端已适配。
- 聊天：WebSocket 实时聊天 + 进出房提示。
- 主播控制台（Studio）：全新重构为 3 栏集成管理面板，方便主播集中式控制：
  - **左栏**：网页推流预览/控制，以及常驻的「连麦管理」列表。当有新的连麦请求时，屏幕右下角会自动弹出气泡通知，支持直接点击「接听」或「拒绝」。
  - **中栏**：采用标签页组织「直播管理」（OBS 推流与录制控制/历史）、「设置与黑名单」以及「事件回调（Webhook）」。
  - **右栏**：集成互动聊天室，方便主播实时与观众互动。
- 连麦：观众申请 → 主播同意（可在连麦管理中操作，或通过右下角弹窗快速接听） → 观众浏览器经 WHIP 推流 → 全员经 WHEP 看到连麦小窗；主播或本人可随时结束。
- 直播间密码、用户黑名单（设置区配置，发言/进房/连麦均校验）。
- 录制：主播控制台开/停录制（后端 ffmpeg 拉 RTMP 转存 MinIO），完成触发 `recording.stored`（含文件直链）。
- 管理员可查看所有直播间、获取流直链、一键断流（同时断连麦流）。

**CDN**：`cdn-edge` 为 nginx 缓存边缘（直播 HLS 分片缓存 + FLV 透传、点播分片缓存），启动后自动向 API 注册；管理后台可增删/启停节点、健康检查；播放接口在启用节点间轮询调度，`?cdn=off` 强制回源。要加节点，复制 compose 中 `cdn-edge-1` 块（或在其他机器上单独 `docker build ./cdn-edge` 部署，配好 `ORIGIN_LIVE/ORIGIN_STORAGE/EDGE_PUBLIC_URL`）。

管理后台 CDN 节点管理还支持添加「公网 CDN」类型节点（如腾讯云 CDN、Cloudflare CDN 等）：将公网 CDN 的源站配置指向本站（回源 `/storage/` 路径），然后在管理后台填写该 CDN 的访问域名（如 `https://cdn.example.com`）即可加入轮询调度。公网 CDN 节点的健康检查为根路径可达性探测（不依赖 `/edge/health`）。

## 开放 API

认证二选一：`Authorization: Bearer <JWT>` 或 `X-API-Key: lvs_xxx`（设置页创建，全功能）。

```
POST /api/auth/register|login          注册/登录
GET  /api/videos?q=                    公开视频列表
POST /api/videos                       上传（multipart: file,title,visibility）
GET  /api/videos/:id/play              播放/下载直链（可经 CDN；私有视频可带 ?password=）
GET|POST /api/videos/:id/whitelist     私有视频白名单（视频主）/ 添加 {username}
DELETE /api/videos/:id/whitelist/:uid  移除白名单用户
GET  /api/collections/mine             我的收藏夹
POST /api/collections                  创建收藏夹 {name, description, visibility}
GET  /api/collections/:id              收藏夹详情（含视频列表，公开收藏夹可分享）
POST /api/collections/:id/videos       添加视频 {video_id}
DELETE /api/collections/:id/videos/:vid  移除视频
GET|POST /api/videos/:id/comments      评论列表 / 评论与回复(parent_id)
GET|POST /api/videos/:id/subtitles     字幕列表 / 添加字幕
GET  /api/users/:id /:id/videos        创作者信息 / 主页视频列表
POST /api/reports                      举报 {target_type, target_id, reason}
POST /api/live/rooms                   创建直播间
GET  /api/live/rooms/:id               直播间信息（主播可见推流地址）
GET  /api/live/rooms/:id/stream-urls   媒体流直链（rtmp/flv/hls/whip/whep）
POST /api/live/rooms/:id/watch         观众取播放地址（密码/黑名单校验）
POST /api/live/rooms/:id/recording/start|stop  开/停录制
POST /api/live/rooms/:id/mic/request   申请连麦
POST /api/live/rooms/:id/mic/:micId/decision   主播同意/拒绝 {approve}
GET|POST /api/me/webhooks              个人 Webhook 配置
GET|POST /api/live/rooms/:id/webhooks  直播间自定义回调
# 管理员
POST /api/admin/videos/:id/takedown    审核 API 下架 {reason}
POST /api/admin/rooms/:id/cut          审核 API 断流
POST /api/admin/users/:id/ban          封禁 {hours, reason}（hours=0 解封）
PUT  /api/admin/settings/review_required  免审开关
GET|POST|PATCH|DELETE /api/cdn/nodes   CDN 节点管理
```

## 事件推送（WebSocket / Webhook）

- WebSocket：`ws://站点/ws?token=<JWT 或 API Key>`，连接即收个人事件；发送 `{"type":"join","roomId":"..."}` 收直播间事件，`{"type":"chat","roomId","content"}` 发弹幕。管理员连接自动收全站事件。
- Webhook：设置页（个人）或主播控制台（直播间）配置 URL/密钥/事件过滤；POST JSON，头部 `X-LVS-Event`（类型）与 `X-LVS-Signature`（HMAC-SHA256 签名）。

| 角色 | 事件 |
|---|---|
| 创作者 | video.uploaded, video.review.approved/rejected, video.taken_down, video.comment.created, account.banned |
| 主播/直播间 | live.started, live.stopped, room.user.joined/left, chat.message, mic.requested/approved/rejected/live/ended, recording.started, recording.stored |
| 管理员 | admin.video.uploaded, admin.live.started/stopped, admin.chat.message, admin.stream.urls, admin.report.created, admin.user.banned |

## 目录结构

```
backend/    Express API + WS 网关 + SRS 回调 + ffmpeg 录制
frontend/   Vue 3 SPA + nginx 网关（/api /ws /live /rtc /storage 反代）
srs/        SRS 5.0 配置（RTMP/WebRTC/HLS/FLV + HTTP 回调）
cdn-edge/   CDN 边缘节点镜像（nginx 缓存 + 自动注册）
```

## 网页推流 / 连麦必须用 HTTPS

浏览器只在安全上下文（HTTPS 或 localhost）暴露 `navigator.mediaDevices`，否则摄像头/屏幕采集不可用（报错 `Cannot read properties of undefined (reading 'getUserMedia')`）。本项目 nginx 同时监听 80 和 443（内置自签证书）：

1. 主播/连麦观众请访问 `https://LAN_IP`，首次访问浏览器会警告证书不受信任，点「高级 → 继续访问」即可；
2. 在 HTTP 页面点「开播/连麦」时，前端会自动提示并跳转 HTTPS；
3. 仅观看/聊天用 HTTP 即可（可享受 CDN 边缘调度；HTTPS 页面会自动改写媒体地址回源站以规避混合内容拦截）。

## 已知边界（局域网场景的取舍）

- 私有视频/未上架视频的对象 URL 为不可猜测的随机 key（MinIO 桶公共读 + nginx 反代），未走逐请求签名；如需更强隔离可改为 API 代理流式输出。
- HLS 分片请求不做逐片鉴权（密码/黑名单在获取播放地址与聊天/连麦时校验）。
- 直播间密码、私有视频解锁密码明文存库（仅限内网使用场景）。

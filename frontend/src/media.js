// 媒体采集与混合内容处理
// 浏览器仅在安全上下文(HTTPS/localhost)暴露 navigator.mediaDevices，
// 网页推流/连麦前先确保可用，否则引导跳转到 HTTPS 版本。
export function captureAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function ensureCapture() {
  if (captureAvailable()) return true;
  if (location.protocol === 'http:') {
    if (confirm('摄像头/屏幕采集需要 HTTPS（浏览器安全限制）。\n是否跳转到 HTTPS 版本？\n（自签名证书，首次访问请在警告页点击「高级→继续访问」）')) {
      location.href = `https://${location.hostname}${location.pathname}${location.search}`;
    }
  } else {
    alert('当前浏览器不支持摄像头/屏幕采集（navigator.mediaDevices 不可用）');
  }
  return false;
}

// getUserMedia 错误转成可操作的中文提示
export function captureErrorText(e) {
  const map = {
    NotReadableError: '摄像头/麦克风被其他程序占用（同机的主播推流标签页、OBS、微信等）。请关闭占用方，或同机测试时连麦将自动降级为仅语音。',
    NotAllowedError: '浏览器或系统拒绝了摄像头/麦克风权限。请检查地址栏权限设置，以及 Windows 设置→隐私→相机/麦克风。',
    NotFoundError: '未检测到摄像头/麦克风设备。',
    OverconstrainedError: '设备不满足采集要求（分辨率/设备约束）。',
    AbortError: '设备启动被中断，请重试。'
  };
  return map[e.name] || `${e.name || 'Error'}: ${e.message}`;
}

// 采集流：优先音视频，摄像头不可用时自动降级为仅语音
export async function getCaptureStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    return { stream, videoEnabled: true, note: '' };
  } catch (e) {
    if (['NotReadableError', 'NotFoundError', 'OverconstrainedError'].includes(e.name)) {
      // 摄像头打不开 → 尝试仅语音
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        .catch((e2) => { throw Object.assign(e2, { _bothFailed: true, _videoErr: e }); });
      return { stream, videoEnabled: false, note: `摄像头不可用（${captureErrorText(e)}），已降级为仅语音` };
    }
    throw e;
  }
}

// HTTPS 页面引用 http:// 媒体地址会被浏览器按混合内容拦截，
// 统一改写为当前源（nginx 网关同样代理 /live /rtc /storage）。
export function mediaUrl(url) {
  if (!url) return url;
  if (location.protocol === 'https:' && url.startsWith('http:')) {
    try {
      const u = new URL(url);
      return location.origin + u.pathname + u.search;
    } catch { return url; }
  }
  return url;
}

// ============================================================
// 成语消消乐 · 音频模块（疏肝理气版）
// BGM：audio/bgm_shugan.wav 治愈系轻音乐——四和弦进行(Am7→Fmaj7→C→Gsus4)和声垫底
//      + 分解琶音 + 带回声的五声主旋律，24s 严格周期合成、无缝循环（2026-10-13 v3 加强版）
// 音效：sfx_win（过关）/ sfx_lose（结束）/ sfx_correct（答对），一次性触发
// BGM 与音效音量分轨可调；切后台自动暂停、回前台续播
// ★ 音频资源路径集中在此配置，后续换曲/换音效只改 AUDIO_PATHS 即可
// ============================================================

// --- 音频资源路径（集中配置，替换资源只改这里） ---
const AUDIO_PATHS = {
  bgm: 'audio/bgm_shugan.mp3',      // ★ 96kbps MP3（原 WAV 768KB → MP3 283KB，省 485KB）
  sfx: {
    win:     'audio/sfx_win.wav',
    lose:    'audio/sfx_lose.wav',
    correct: 'audio/sfx_correct.wav',
  },
};

const BGM_DEFAULT_VOL = 0.22;  // 舒缓曲适当抬高一点点仍作铺垫，不盖音效
const SFX_DEFAULT_VOL = 0.55;  // 音效适中，短促不刺耳
const SFX_NAMES = ['win', 'lose', 'correct'];

let bgm = null;
let bgmVol = BGM_DEFAULT_VOL;
let sfxVol = SFX_DEFAULT_VOL;
let sfxMap = {};   // { win: InnerAudioContext, ... }
let musicOn = true;

function makeAudio(src, loop, vol) {
  try {
    const a = wx.createInnerAudioContext();
    a.src = src;
    a.loop = loop;
    a.volume = vol;
    if (a.onError) a.onError(() => { /* 加载失败静默，不影响游戏 */ });
    return a;
  } catch (e) {
    return null;
  }
}

function init() {
  if (bgm) return; // 防重入：重复 init 会泄漏旧实例（启动段只调一次，此处兜底）
  bgm = makeAudio(AUDIO_PATHS.bgm, true, musicOn ? bgmVol : 0);
  if (bgm && musicOn) {
    try { bgm.play(); } catch (e) { /* 忽略 */ }
  }

  // 音效实例预创建（loop=false 播完自停；播放前 stop 归零，短音效重触发不叠音）
  sfxMap = {};
  SFX_NAMES.forEach(name => {
    sfxMap[name] = makeAudio(AUDIO_PATHS.sfx[name], false, sfxVol);
  });

  // 前后台切换：只管 BGM，切后台暂停、回前台续播
  try {
    wx.onHide(() => { if (bgm) bgm.pause(); });
    wx.onShow(() => { if (bgm && musicOn) bgm.play(); });
  } catch (e) { /* 环境不支持则忽略 */ }
}

// --- 音效：一次性触发 ---
function playSfx(name) {
  const sfx = sfxMap[name];
  if (!sfx) return;
  try {
    sfx.stop();   // 上一次没播完时重触发：归零重播，不叠音
    sfx.volume = sfxVol;
    sfx.play();
  } catch (e) { /* 音效失败不影响游戏 */ }
}

// --- 音量分轨调节（0~1，运行时可调） ---
function setBgmVolume(v) {
  bgmVol = Math.max(0, Math.min(1, v));
  if (bgm) { try { bgm.volume = musicOn ? bgmVol : 0; } catch (e) {} }
}

function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  SFX_NAMES.forEach(name => {
    if (sfxMap[name]) { try { sfxMap[name].volume = sfxVol; } catch (e) {} }
  });
}

// --- BGM 开关（只控背景音乐，不影响音效） ---
function toggle() {
  musicOn = !musicOn;
  stopFade(); // 用户手动切：立即生效，取消进行中的渐变
  try {
    if (bgm) bgm.volume = musicOn ? bgmVol : 0;
    if (musicOn) { if (bgm) bgm.play(); }
    else { if (bgm) bgm.pause(); }
  } catch (e) { /* 忽略 */ }
  return musicOn;
}

// --- 首次用户触摸后调用（解决 iOS WKWebView 首次静音） ---
// iOS 的 InnerAudioContext 要求 play() 必须在用户手势之后触发；init() 里那次 play()
// 常被静默吞掉。onTouchStart 首次触发这里，已播放的实例 play() 幂等不会重启。
function resumeBgm() {
  if (!bgm || !musicOn) return;
  try { if (bgm) bgm.play(); } catch (e) { /* 忽略 */ }
}

// --- BGM 渐弱（结算/过关用，避免硬切到静音的突兀） ---
// 每帧从 from 线性插值到 target，durationMs 内完成。setInterval 30ms 一步。
let fadeTimer = null;
function stopFade() {
  if (fadeTimer) { try { clearInterval(fadeTimer); } catch (e) {} fadeTimer = null; }
}
function fadeBgm(target, durationMs) {
  if (!bgm || !musicOn) return;   // ★ 静音下彻底不 fade，避免用户切静音后 fade 又偷偷把音量改回去
  stopFade();
  const from = typeof bgm.volume === 'number' ? bgm.volume : bgmVol;
  target = Math.max(0, Math.min(1, target));
  durationMs = Math.max(30, durationMs || 300);
  // ★ 浮点比较：连续 fade 让 volume 停在 0.22000000001 时 `===` 会永远走不完
  if (Math.abs(from - target) < 1e-6) { try { bgm.volume = target; } catch (e) {} return; }
  const steps = Math.max(1, Math.round(durationMs / 30));
  const stepSize = (target - from) / steps;
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    if (!bgm) { stopFade(); return; }
    try {
      if (step >= steps) {
        bgm.volume = target;
        stopFade();
      } else {
        bgm.volume = from + stepSize * step;
      }
    } catch (e) { stopFade(); }
  }, 30);
}

// --- 场景切换/退出时统一停止 ---
function stopAll() {
  stopFade();
  try {
    if (bgm) { bgm.pause(); bgm.volume = 0; }
    SFX_NAMES.forEach(name => { if (sfxMap[name]) sfxMap[name].stop(); });
  } catch (e) { /* 忽略 */ }
}

function isOn() {
  return musicOn;
}

module.exports = { init, playSfx, setBgmVolume, setSfxVolume, toggle, stopAll, isOn, resumeBgm, fadeBgm };

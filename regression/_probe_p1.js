// ============================================================
// _probe_p1.js · 无头回归探针（2026-10-15 自查后 4 项 P1 修复）
//   P1-1 死后竞态守卫        P1-2 鼓励文案不再被吞
//   P1-3 结算面板按钮排布    P1-4 清除进度二次确认
// 手法：mock wx + 可控时钟 + 手动定时器队列 + Proxy noop ctx
// 跑法：cd idiom-game && node regression/_probe_p1.js
// 注：放在 wx-minigame/ 之外的 regression/ 目录，避免被打进小游戏包
// ============================================================
'use strict';
const Module = require('module');

// ---------- 假时钟 + 手动定时器队列 ----------
let NOW = 1000000;
Date.now = () => NOW;
const timers = [];
const intervals = [];
let nextId = 1;
global.setTimeout = (fn, ms) => { const id = nextId++; timers.push({ id, at: NOW + (ms || 0), fn }); return id; };
global.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
global.setInterval = (fn, ms) => { const id = nextId++; intervals.push({ id, every: ms, last: NOW, fn }); return id; };
global.clearInterval = (id) => { const i = intervals.findIndex(t => t.id === id); if (i >= 0) intervals.splice(i, 1); };
global.requestAnimationFrame = () => 0;

function advance(ms) {
  const end = NOW + ms;
  while (NOW < end) {
    NOW += 1;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= NOW) { const t = timers.splice(i, 1)[0]; try { t.fn(); } catch (e) { console.log('  [timer err]', e.message); } }
    }
    for (let i = intervals.length - 1; i >= 0; i--) {
      const t = intervals[i];
      if (NOW - t.last >= t.every) { t.last = NOW; try { t.fn(); } catch (e) { console.log('  [interval err]', e.message); } }
    }
  }
  NOW = end;
}

// ---------- ctx 代理（记录 fillText 用于判定"是否真的画了"） ----------
const fillTexts = [];
function makeCtx() {
  const rec = {};
  return new Proxy(rec, {
    get(t, k) {
      if (k === 'fillText') return (txt) => { fillTexts.push(String(txt)); };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// ---------- wx mock ----------
const store = {};
const storageWrites = {};
const modalCalls = [];
const shareCalls = [];
const ctx = makeCtx();
const wxInner = {
  createCanvas: () => ({ getContext: () => ctx, width: 0, height: 0 }),
  getSystemInfoSync: () => ({ screenWidth: 375, screenHeight: 667, pixelRatio: 2, statusBarHeight: 20 }),
  getDeviceInfo: () => ({ platform: 'ios', system: 'iOS 17.0', brand: 'apple' }),
  createImage: () => ({}),
  createInnerAudioContext: () => ({ play() {}, pause() {}, stop() {}, onError() {},
    set volume(v) {}, get volume() { return 0; }, set loop(v) {}, set src(v) {} }),
  canIUse: () => true,
  showModal: (o) => { modalCalls.push(o); return { then() {} }; },
  shareAppMessage: (o) => { shareCalls.push(o); },
  createRewardedVideoAd: undefined,
  createInterstitialAd: undefined,
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; storageWrites[k] = (storageWrites[k] || 0) + 1; },
  removeStorageSync: (k) => { delete store[k]; },
};
global.wx = new Proxy(wxInner, { get: (t, k) => (k in t ? t[k] : () => {}) });

// ---------- 导出 canvas.js 内部状态 ----------
const origCompile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
  if (String(filename).endsWith('canvas.js')) {
    // 注 1：必须显式回传 content —— arguments[0] 不会跟着局部变量一起变
    // 注 2：touchZones 是被整体重新赋值的 let，导出普通属性会拿到旧快照，必须用 getter
    return origCompile.call(this,
      content + '\nmodule.exports = { get touchZones() { return touchZones; },'
      + ' state, LAYOUT, hitTest, delay, clearPendingTimers,'
      + ' stillPlaying, buildResultPanel, startGame, endGame, checkAnswer, showHint, skipPuzzle,'
      + ' addTimeByAd, reviveByAd, confirmClearProgress, showEmotion, drawEmotion, drawExplain,'
      + ' saveProgress, loadProgress, EMOTION_MS, EXPLAIN_DURATION, PROGRESS_MAX };',
      filename);
  }
  return origCompile.apply(this, arguments);
};

const G = require('../wx-minigame/canvas.js');

// ---------- 断言 ----------
let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log('  \u2705 ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  \u274C ' + name + (extra ? '  (' + extra + ')' : '')); }
}

console.log('\n=== P1-1 死后竞态守卫 ===');
// T1 死亡后遗留的 delay 回调不再执行
G.state.solvedCount = 7;
let leaked = false;
G.delay(() => { leaked = true; G.state.solvedCount += 1; }, 200);
G.endGame();
advance(400);
assert(leaked === false, 'T1a 死后遗留回调未执行');
assert(G.state.solvedCount === 7, 'T1b 进度未虚增', 'solvedCount=' + G.state.solvedCount);
assert(G.state.scene === 'result', 'T1c 场景已切结算');
assert(G.state.pendingTimers.length === 0, 'T1d pending 队列已清空');

// T2 checkAnswer 自带守门（不依赖 delay 包装也能挡住）
G.startGame();
const before = G.state.solvedCount;
G.endGame();
G.checkAnswer();
advance(200);
assert(G.state.solvedCount === before, 'T2 死后 checkAnswer 被守门', 'solvedCount=' + G.state.solvedCount);

// T3 startGame 清掉上一局遗留
leaked = false;
G.delay(() => { leaked = true; }, 500);
G.startGame();
advance(700);
assert(leaked === false, 'T3 重开一局时遗留回调被清理');
assert(G.state.isPlaying && G.state.scene === 'playing', 'T3b 开局状态正确');

console.log('\n=== 回归：正常判分链路未被守卫误伤 ===');
// T4 正常答对仍计分 + 600ms 后换题
G.startGame();
const idiom = G.state.currentIdiom;
G.state.blanks.forEach((pos, i) => { G.state.filledBlanks[i] = { char: idiom[pos], candIdx: -1 }; });
G.delay(G.checkAnswer, 200);
const cnt0 = G.state.solvedCount;
advance(300);
assert(G.state.solvedCount === cnt0 + 1, 'T4a 正常答对仍计分', 'solvedCount=' + G.state.solvedCount);
advance(500);
assert(G.state.currentIdiom !== idiom, 'T4b 600ms 后仍换题', idiom + ' → ' + G.state.currentIdiom);
assert(G.state.scene === 'playing', 'T4c 仍在对局中');

// T5 提示/跳过/加时/复活 回归
const t0 = G.state.timeLeft, u0 = G.state.adTimeUses;
G.addTimeByAd();
assert(G.state.timeLeft === t0 + 10 && G.state.adTimeUses === u0 - 1, 'T5a 加时按钮仍生效');
assert(G.state.addTimeFx > 0, 'T5b 按下反馈已触发');
const hl = G.state.hintsLeft;
G.showHint();
assert(G.state.hintsLeft === hl - 1, 'T5c 提示仍扣次数', 'hintsLeft=' + G.state.hintsLeft);
const sc = G.state.score;
G.skipPuzzle();
assert(G.state.score === Math.max(0, sc - 50), 'T5d 跳过仍扣 50 分');

console.log('\n=== P1-2 鼓励文案不再被释义卡吞掉 ===');
// T6 几何前提：emotionY 在释义卡下方，两者可并行
const gap = G.LAYOUT.emotionY - (G.LAYOUT.explainY + G.LAYOUT.explainH);
assert(gap >= 0, 'T6a emotionY 在释义卡下方', '间距 ' + gap.toFixed(1) + 'rpx');
// T6b 有释义卡时鼓励文案仍被真正绘制
fillTexts.length = 0;
G.state.explainText = '\u3010\u56f4\u9b4f\u6551\u8d75\u3011\u524d\u516c\u5143\u4e09\u767e\u4e00\u5341\u56db\u5e74\u5f53\u5929\uff0c\u9b4f\u56fd\u5c01\u88ad\u8d75\u56fd\u90fd\u57ce\u90ef\u90f8';
G.state.explainTime = Date.now();
G.showEmotion('\u26a1 \u624b\u901f\u60ca\u4eba +10\uff01');
G.drawEmotion();
assert(fillTexts.some(t => t.indexOf('\u624b\u901f\u60ca\u4eba') >= 0), 'T6b 有释义卡时鼓励文案仍绘制');
// T6c 释义卡过期后释放被让位的鼓励文案（补足 1.3s）
G.state.explainTime = Date.now() - 5000;
G.state.emotionTime = Date.now() - 1700;
G.drawExplain();
const remain = (G.state.emotionTime + G.EMOTION_MS) - Date.now();
assert(remain >= 1250, 'T6c 释义卡过期后鼓励文案补足 1.3s', '实际剩余 ' + Math.round(remain) + 'ms');
assert(G.state.explainText === '', 'T6d 释义卡已清空');

console.log('\n=== P1-3 结算面板按钮排布（复活缺席自动收紧） ===');
G.state.revivedThisGame = false;
G.buildResultPanel();
const slotH = G.LAYOUT.resultBtnH + G.LAYOUT.resultBtnGap;
const cardH4 = G.LAYOUT.resultCardH;
const cy4 = G.LAYOUT.resultCardY;
// 上按钮 y 应比下按钮 y 小一个 slotH（屏幕坐标 y 向下为正）
const step = (up, down) => Math.abs((up - down) + slotH) < 1.5;
assert(step(G.touchZones.btnRevive.y, G.touchZones.btnRestart.y)
  && step(G.touchZones.btnRestart.y, G.touchZones.btnShare.y)
  && step(G.touchZones.btnShare.y, G.touchZones.btnClear.y),
  'T7a 未复活：四按钮等间距排布',
  'y=' + [G.touchZones.btnRevive.y, G.touchZones.btnRestart.y, G.touchZones.btnShare.y, G.touchZones.btnClear.y].map(v => v.toFixed(1)).join('/'));
assert(Math.abs((G.touchZones.btnClear.y + G.LAYOUT.resultBtnH) - (cy4 + cardH4 - 28)) < 1.5,
  'T7b 未复活：最底按钮贴卡底 28rpx');
assert(G.touchZones.btnRevive.y >= cy4, 'T7c 未复活：最上按钮未溢出卡顶');

G.state.revivedThisGame = true;
G.buildResultPanel();
const cardH3 = G.LAYOUT.resultCardH;
const cy3 = G.LAYOUT.resultCardY;
assert(Math.abs(cardH4 - cardH3 - slotH) < 1.5, 'T8a 已复活：卡高收紧一行', '4键' + Math.round(cardH4) + 'rpx → 3键' + Math.round(cardH3) + 'rpx');
assert(step(G.touchZones.btnRestart.y, G.touchZones.btnShare.y)
  && step(G.touchZones.btnShare.y, G.touchZones.btnClear.y),
  'T8b 已复活：三按钮等间距、无空档',
  'y=' + [G.touchZones.btnRestart.y, G.touchZones.btnShare.y, G.touchZones.btnClear.y].map(v => v.toFixed(1)).join('/'));
assert(Math.abs((G.touchZones.btnClear.y + G.LAYOUT.resultBtnH) - (cy3 + cardH3 - 28)) < 1.5,
  'T8c 已复活：最底按钮仍贴卡底 28rpx',
  'clear底=' + (G.touchZones.btnClear.y + G.LAYOUT.resultBtnH).toFixed(1) + ' 期望=' + (cy3 + cardH3 - 28).toFixed(1));
assert(G.touchZones.btnRestart.y >= cy3 + 200, 'T8d 已复活：顶部仍有足够空间放评语/分数');

console.log('\n=== P1-4 清除进度二次确认 ===');
G.startGame();
G.state.solvedCount = 12;
try { G.saveProgress(); } catch (e) {}
G.endGame();
modalCalls.length = 0;
shareCalls.length = 0;
G.confirmClearProgress();
assert(modalCalls.length === 1, 'T9a 点击后弹出确认框');
assert(G.state.solvedCount === 12 && G.state.scene === 'result', 'T9b 未确认前不清空、不重开');
assert(modalCalls[0].confirmText === '\u6e05\u9664' && modalCalls[0].cancelText === '\u518d\u60f3\u60f3', 'T9c 按钮文案正确');
modalCalls[0].success({ confirm: false });
assert(G.state.solvedCount === 12 && G.state.scene === 'result', 'T9d 点"再想想"→ 停留结算');
modalCalls.length = 0;
G.confirmClearProgress();
modalCalls[0].success({ confirm: true });
assert(G.state.solvedCount === 0 && G.state.scene === 'playing' && G.state.isPlaying,
  'T9e 点"清除"→ 存档归零并回到第 1 关');
assert(shareCalls.length === 0, 'T9f 全程未触发分享（无诱导分享）');

console.log('\n=== P1-5 skipPuzzle 竞态守卫（第五轮修） ===');
// 场景：玩家快速填完 4 格（selectCandidate 触发 200ms delay(checkAnswer)），
//   立即按跳过按钮——skipPuzzle 必须在首行 clearPendingTimers，否则遗留 checkAnswer
//   会用新题数据判空答案 → 误触 onWrong（额外 -3s）
G.startGame();
const curIdiom = G.state.currentIdiom;
const t4 = G.state.timeLeft;
// 手动模拟"填完 4 格"状态（selectCandidate 的等价效果）
G.state.blanks = [0, 1, 2, 3];
G.state.filledBlanks = [
  { char: curIdiom[0], candIdx: 0 },
  { char: curIdiom[1], candIdx: 1 },
  { char: curIdiom[2], candIdx: 2 },
  { char: curIdiom[3], candIdx: 3 },
];
// 入队 200ms 延迟 checkAnswer（模拟 selectCandidate 的行为）
G.delay(G.checkAnswer, 200);
assert(G.state.pendingTimers.length === 1, 'T10a 填完 4 格后 pendingTimers=1');

// 200ms 内立即按跳过
const comboBefore = G.state.combo;
G.skipPuzzle();

// 断言 1：skipPuzzle 已清 pendingTimers
assert(G.state.pendingTimers.length === 0, 'T10b skipPuzzle 首行已清 pendingTimers',
  '实际 ' + G.state.pendingTimers.length);

// 推进 250ms（覆盖 200ms 到期 + 缓冲）
advance(250);

// 断言 2：timeLeft 只减 5（skipPuzzle 扣费），不额外减 3（无 checkAnswer → onWrong）
assert(G.state.timeLeft === t4 - 5, 'T10c timeLeft 只减 5（未误触 onWrong）',
  '期望 ' + (t4 - 5) + ' 实际 ' + G.state.timeLeft + ' 差值 ' + (t4 - G.state.timeLeft));

// 断言 3：pendingTimers 推进后仍为空（无 onWrong 内部 delay 400ms 加入）
assert(G.state.pendingTimers.length === 0, 'T10d 250ms 后 pendingTimers 仍为空',
  '实际 ' + G.state.pendingTimers.length);

console.log('\n=== P1-6 小游戏 canIUse 误报不挡清除进度（第六轮修） ===');
// 场景：小游戏模式下 wx.canIUse('showModal') 误返回 false，但 showModal 实际可用。
//   修复前会走降级分支弹 toast"当前环境不支持弹窗"，清除进度功能失效（用户实测复现）。
const origCanIUse = wxInner.canIUse;
wxInner.canIUse = () => false;              // 模拟小游戏模式误报
G.startGame();
G.state.solvedCount = 12;
try { G.saveProgress(); } catch (e) {}
G.endGame();
modalCalls.length = 0;
G.confirmClearProgress();
assert(modalCalls.length === 1, 'T11a canIUse=false 时仍弹出确认框（不误降级）',
  'modalCalls=' + modalCalls.length);
modalCalls[0].success({ confirm: true });
assert(G.state.solvedCount === 0 && G.state.scene === 'playing' && G.state.isPlaying,
  'T11b 点"清除"→ 存档归零并回到第 1 关',
  'solvedCount=' + G.state.solvedCount + ' scene=' + G.state.scene);
wxInner.canIUse = origCanIUse;              // 恢复 mock

if (fail > 0) process.exit(1);
console.log('\n===========================================');
console.log('  \u7ed3\u679c\uff1a' + pass + ' \u901a\u8fc7 / ' + fail + ' \u5931\u8d25');
console.log('===========================================\n');

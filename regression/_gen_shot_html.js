// ============================================================
// _gen_shot_html.js · 生成无头截图用 HTML（2026-10-15）
// 用途：微信小游戏备案需要"游戏内截图"，但真机截屏流程繁琐。
//       本脚本把 wx-minigame 全部 JS 内联进一个 HTML，mock wx API，
//       用系统 Chrome headless 截出真实渲染画面。
// 用法：node regression/_gen_shot_html.js
//   生成 regression/_shot.html，然后：
//   chrome --headless --screenshot=out.png --window-size=750,1334
//          --virtual-time-budget=2500 "file:///.../_shot.html?scene=playing"
//   scene: playing(默认答题) | result(结算，加速计时器)
//   solved=N  预置存档 solvedCount=N（截高关卡画面）
//   ach=<id>  答题场景用受控时钟解锁指定成就，截「成就弹窗」画面（备案系统功能模块用）
//             可选 id: first_blood/combo_3/combo_5/combo_10/speed_5/solve_20/score_500
// 注：故意放 regression/（上传根目录之外），不会被打进小游戏包。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'wx-minigame');
const FILES = ['idioms.js', 'common_idioms.js', 'idioms_meaning.js', 'platform.js', 'audio.js', 'canvas.js'];

const codes = {};
for (const f of FILES) {
  codes[f] = fs.readFileSync(path.join(DIR, f), 'utf8');
  console.log('[read] ' + f + '  ' + (codes[f].length / 1024).toFixed(1) + 'KB');
}

// canvas.js 无 module.exports，注入一个最小导出供截图脚本外部触发成就解锁。
// 只在本 HTML 内生效，不进小游戏包（regression/ 目录不会被上传）。
codes['canvas.js'] += '\nmodule.exports = { state: state, unlockAchievement: unlockAchievement };\n';

// ---------- HTML 模板 ----------
const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>补一字 · 备案截图</title>
<style>
  html,body{margin:0;padding:0;background:#ffffff}
  canvas{display:block;image-rendering:auto}
</style>
</head>
<body>
<canvas id="game"></canvas>
<script>
// ---------- 1. 从 DOM 取真实 canvas（canvas.js 会自己设 width/height） ----------
var __realCanvas = document.getElementById('game');

// ---------- 2. wx mock（覆盖 grep 出的全部 API） ----------
var __store = {};
var __imgOnload = [];
var wx = {
  createCanvas: function () { return __realCanvas; },
  createImage: function () {
    var img = { _src: '', onload: null, onerror: null,
      set src(v) { this._src = v; if (this.onload) { var c = this.onload; setTimeout(function(){ c(); }, 0); } },
      get src() { return this._src; } };
    return img;
  },
  createInnerAudioContext: function () {
    return { play: function(){}, pause: function(){}, stop: function(){}, onError: function(){},
      volume: 0, loop: false, src: '' };
  },
  createRewardedVideoAd: undefined,
  createInterstitialAd: undefined,
  getSystemInfoSync: function () {
    return { screenWidth: 375, screenHeight: 667, pixelRatio: 2, statusBarHeight: 20,
      safeArea: { top: 88, bottom: 647, left: 0, right: 375, width: 375, height: 559 } };
  },
  getDeviceInfo: function () { return { platform: 'ios', system: 'iOS 17.0', brand: 'apple' }; },
  canIUse: function () { return true; },
  showToast: function () {},
  showModal: function () {},
  showShareMenu: function () {},
  onShareAppMessage: function () {},
  shareAppMessage: function () {},
  onTouchStart: function () {}, onTouchMove: function () {},
  onTouchEnd: function () {}, onTouchCancel: function () {},
  onHide: function () {}, onShow: function () {},
  setStorageSync: function (k, v) { __store[k] = v; },
  getStorageSync: function (k) { return (k in __store) ? __store[k] : ''; },
  removeStorageSync: function (k) { delete __store[k]; }
};
window.wx = wx;

// ---------- 3. require shim（同步执行，代码已全部内联） ----------
var __codes = __CODES_JSON__;
var __mods = {};
function require(name) {
  var key = name.replace(/^\\.\\//, '');
  if (__mods[key]) return __mods[key].exports;
  var module = { exports: {} };
  __mods[key] = module;
  var fn = new Function('module', 'exports', 'require', 'wx', 'console', __codes[key]);
  fn(module, module.exports, require, wx, console);
  return module.exports;
}

// ---------- 4. 场景参数 ----------
var scene = (location.search.match(/scene=(\\w+)/) || [])[1] || 'playing';
var solved = parseInt((location.search.match(/solved=(\\d+)/) || [])[1] || '0', 10);
// 受控时钟（仅 ach= 截图用）：装在存档预置之后、require 之前，
// 保证 loadProgress 读到的 savedAt 与游戏内计时都用同一套时钟，互不穿帮
var __t = 0;
if (location.search.indexOf('ach=') >= 0) {
  Date.now = function () { return __t; };
}
// 预置存档：直接进入高关卡（用于截不同关卡的画面）
if (solved > 0) {
  __store['idiomGameProgress'] = { solvedCount: solved, savedAt: Date.now() };
}
if (scene === 'result') {
  // 加速计时器：把 1000ms 的 setInterval 压到 1ms，72s 时限在 ~72ms 内走完 → 进结算
  var __realSetInterval = window.setInterval;
  window.setInterval = function (fn, ms) { return __realSetInterval(fn, 1); };
}

// ---------- 5. 加载游戏（platform 先于 canvas） ----------
require('./platform.js');
var __G = require('./canvas.js');

// ---------- 5b. 成就系统截图支援（备案「系统功能」模块用） ----------
var ach = (location.search.match(/ach=([A-Za-z0-9_]+)/) || [])[1] || '';
if (scene === 'result') {
  // 结算页变体：预置战绩 + 预解锁 6 项成就，让「解锁成就 N / 7」显示真实收集进度
  __G.state.score = 680; __G.state.solvedCount = 20; __G.state.maxCombo = 8;
  ['first_blood','combo_3','combo_5','speed_5','solve_20','score_500'].forEach(function(id){
    __G.unlockAchievement(id);
  });
} else if (ach) {
  // 答题中变体：受控时钟 + 冻结，让弹窗恒定停在完全展示状态
  // 背景：弹窗动画按真实 Date.now() 走，而 --virtual-time-budget 会把真实耗时压缩到几十毫秒，
  //      直接用 setTimeout 延迟解锁，截图时 elapsed≈0，弹窗还在滑入动画里（offsetX 把它推到屏外）。
  // 解法：Date.now 换成受控时钟——先走到 1100ms 解锁（pop.time=1100），再推到 2200ms 后冻结，
  //      之后每帧 elapsed 恒为 1100ms，正落在稳定展示窗（0.4s~2.1s）中段，与截图时机彻底解耦。
  __t = 1100;
  __G.unlockAchievement(ach);
  __t = 2200;
}

// ---------- 6. 渲染稳定后打标记（headless 截图等待点） ----------
var __frames = 0;
(function waitStable() {
  __frames++;
  if (__frames < 30) { requestAnimationFrame(waitStable); return; }
  document.title = 'READY:' + scene + ':' + __realCanvas.width + 'x' + __realCanvas.height;
  document.body.setAttribute('data-ready', '1');
})();
<\/script>
</body>
</html>
`;

// 把 codes 转成 JSON 注入（避免模板字符串嵌套地狱）
const out = html.replace('__CODES_JSON__', JSON.stringify(codes));
const outPath = path.join(__dirname, '_shot.html');
fs.writeFileSync(outPath, out);
console.log('[gen] ' + outPath + '  ' + (out.length / 1024).toFixed(1) + 'KB');
console.log('[next] chrome --headless --screenshot=out.png --window-size=750,1334 --virtual-time-budget=2500 "file://' + outPath.replace(/\\/g, '/') + '?scene=playing"');

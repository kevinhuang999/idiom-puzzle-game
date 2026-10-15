// ============================================================
// 成语消消乐 · Canvas 渲染逻辑（微信小游戏版）
// 微信小游戏无 DOM，全部用 wx.createCanvas() 绘制
// ============================================================

// 导入题库
const IDIOMS = require('./idioms.js');
// 导入大众熟知成语白名单（先易后难第一层：第 1-2 关只从这里出题）
const COMMON_IDIOMS = require('./common_idioms.js');
// 导入释义表（答对后展示释义卡；无释义的成语不展示）
const IDIOM_MEANINGS = require('./idioms_meaning.js');
// 导入鸿蒙适配层（平台判断 / 安全区 / API 兜底，需在 idioms 之后、用到 sysInfo 之前）
const PF = require('./platform.js');
// 导入 BGM 模块（上头循环音乐 + 开关 + 前后台暂停）
const AudioSys = require('./audio.js');

// --- 获取系统信息（经 platform.js 兜底，鸿蒙/低版本基础库不崩）---
const sysInfo = PF.sysInfo;
const SCREEN_W = sysInfo.screenWidth;
const SCREEN_H = sysInfo.screenHeight;
const DPR = sysInfo.pixelRatio || 1;
// ★ 渲染倍率上限 2.5：小米14 DPR=3.5 会算出 1313×3081 canvas（约 16MB 显存），
// 高刷屏开太大 canvas 会拖帧。2.5 是清晰度与内存的平衡点（iPhone Pro Max 3 也不受影响）。
const SCALE = Math.min(2.5, DPR);
// 底部安全区：鸿蒙手势条避让（鸿蒙=24dp，其他平台=0）
const SAFE_BOTTOM = PF.safeBottom;

// --- 创建画布 ---
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
canvas.width = SCREEN_W * SCALE;
canvas.height = SCREEN_H * SCALE;
ctx.scale(SCALE, SCALE);

// --- 适配 ---
function rpx(px) {
  // 简易适配：按 375 设计稿宽等比缩放
  return px * (SCREEN_W / 375);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================
// 统一布局（LAYOUT）：所有渲染与触摸热区共用同一套坐标
//   ① 顶部整体下移，避开状态栏 + 右上角胶囊按钮
//   ② 鼓励文案（浮动文字）独占成语格与候选区之间的展示带
//   ③ 候选字双排错落随机布局，横向铺满利用左右留白
// ============================================================
const LAYOUT = {};

function buildLayout() {
  // 胶囊按钮约占：状态栏 + 高 32 + 间距 8
  // ★ 用真实 statusBarHeight 兜底：rpx(88) 是 375 设计稿基准，iPhone Pro Max statusBarHeight=59
  // 时胶囊底部=91，超过 rpx(88)，用 Math.max 保证不贴到系统状态栏
  const statusBarPx = (typeof sysInfo.statusBarHeight === 'number' && sysInfo.statusBarHeight > 0)
    ? sysInfo.statusBarHeight : 20;
  const topY = Math.max(rpx(88), statusBarPx + rpx(38));
  const barY = topY + rpx(42);              // 进度条
  const statY = barY + rpx(40);             // 统计行（连击/Lv/答对）
  const idiomY = statY + rpx(40);           // 成语格
  const idiomSize = rpx(64);
  // 释义卡（答对后展示）：紧贴成语格下方，与浮动鼓励文案共用展示带（释义优先，展示期间抑制鼓励文案）
  const explainY = idiomY + idiomSize + rpx(8);
  const explainH = rpx(56);
  const emotionY = explainY + explainH + rpx(4); // 浮动鼓励文案基准线

  const adH = rpx(24);
  const adY = SCREEN_H - SAFE_BOTTOM - adH - rpx(6); // 底部广告位（避让鸿蒙手势条）
  const btnH = rpx(44);
  // 按钮与广告位之间留出「下一关信息行」的位置
  const btnY = adY - rpx(34) - btnH;
  const nextLvTextY = adY - rpx(15);

  let candTopY = emotionY + rpx(35);
  let candZoneH = btnY - rpx(10) - candTopY;
  const minZone = rpx(120);
  if (candZoneH < minZone) {
    // 矮屏兜底：压缩浮动文案带，保证候选区最小高度
    candZoneH = minZone;
    candTopY = btnY - rpx(10) - candZoneH;
    LAYOUT.emotionY = Math.min(emotionY, candTopY - rpx(24));
  } else {
    LAYOUT.emotionY = emotionY;
  }

  Object.assign(LAYOUT, {
    topY, barY, statY, idiomY, idiomSize, explainY, explainH, adY, btnY, btnH, adH,
    candTopY, candZoneH, nextLvTextY,
  });

  // 结算面板几何（卡高/卡位/四按钮）统一由 buildResultPanel() 计算：
  // 卡高垂直居中，高度不够时兜底到顶部下方；复活按钮缺席时自动收紧一行
  LAYOUT.resultBtnH = rpx(44);
  LAYOUT.resultBtnGap = rpx(14);
  buildResultPanel();
}

// --- 结算面板几何：卡高 / 卡位 / 四按钮。
//     复活按钮缺席时少一行按钮，卡高与按钮整体同步收紧，
//     避免「复活后再死亡」时顶部留出一个按钮高度的空白间隙 ---
function buildResultPanel() {
  const w = SCREEN_W;
  const hasRevive = !state.revivedThisGame;
  const slotH = LAYOUT.resultBtnH + LAYOUT.resultBtnGap;

  const cardMax = SCREEN_H - SAFE_BOTTOM - rpx(40) - LAYOUT.topY - rpx(16);
  const cardH = Math.min(rpx(500) - (hasRevive ? 0 : slotH), cardMax);
  LAYOUT.resultCardH = cardH;
  LAYOUT.resultCardY = Math.max(LAYOUT.topY + rpx(16), (SCREEN_H - SAFE_BOTTOM - cardH) / 2);

  LAYOUT.resultHasRevive = hasRevive;
  // 按钮自卡底往上排，底部留 rpx(28) 内边距；复活缺席时整列自然上移，不留下白档
  const bx = w * 0.15;
  const bw = w * 0.7;
  const yClear = LAYOUT.resultCardY + cardH - rpx(28) - LAYOUT.resultBtnH;
  touchZones.btnClear   = { x: bx, y: yClear, w: bw, h: LAYOUT.resultBtnH };
  touchZones.btnShare   = { x: bx, y: yClear - slotH, w: bw, h: LAYOUT.resultBtnH };
  touchZones.btnRestart = { x: bx, y: yClear - slotH * 2, w: bw, h: LAYOUT.resultBtnH };
  // ★ 复活按钮已用过（revivedThisGame=true）时置 null，防止热区仍存在但不响应造成的错觉
  touchZones.btnRevive  = hasRevive ? { x: bx, y: yClear - slotH * 3, w: bw, h: LAYOUT.resultBtnH } : null;
  LAYOUT.resultBtnY0 = yClear - slotH * 2;   // 「再来一局」的 y（兼容旧引用）
}

// 候选字错落布局：横向 6 带铺满（利用左右留白），纵向双排交错 + 随机抖动/旋转/缩放
function layoutCandidates(count) {
  const twoRow = LAYOUT.candZoneH >= rpx(190);
  const size = twoRow ? rpx(54) : rpx(46);
  const padX = rpx(30);
  const rows = twoRow ? 2 : 1;
  const perRow = Math.ceil(count / rows);
  const bandW = (SCREEN_W - padX * 2) / perRow;
  const rowGap = twoRow ? rpx(78) : 0;
  const zoneTop = LAYOUT.candTopY + rpx(6) + size / 2;
  const zoneBottom = LAYOUT.candTopY + LAYOUT.candZoneH - rpx(6) - size / 2;
  const yJit = twoRow ? rpx(10) : (zoneBottom - zoneTop) * 0.22;

  const pts = [];
  for (let i = 0; i < count; i++) {
    const row = twoRow ? Math.floor(i / perRow) : 0;
    const col = i % perRow;
    // 双排时下排横向错开半带，形成交错
    const bandShift = (twoRow && row === 1) ? bandW * 0.5 : 0;
    const bandCenter = padX + bandW * (col + 0.5) + bandShift;
    // 横向抖动幅度：双排带宽大可多抖；单排带宽小，抖动收窄避免同排相撞
    const xJit = twoRow ? bandW * 0.42 : bandW * 0.18;
    const x = clamp(
      bandCenter + (Math.random() - 0.5) * xJit,
      padX + size / 2, SCREEN_W - padX - size / 2
    );
    const rowCenter = twoRow
      ? zoneTop + row * rowGap
      : (zoneTop + zoneBottom) / 2;
    const y = clamp(rowCenter + (Math.random() - 0.5) * 2 * yJit, zoneTop, zoneBottom);
    pts.push({
      x, y, size,
      rot: (Math.random() - 0.5) * 0.14,            // ±4°
      scale: 0.94 + Math.random() * 0.10,
    });
  }
  return pts;
}

// --- 颜色常量 ---

const COLORS = {
  bg: '#f5f0e8',
  primary: '#e74c3c',
  secondary: '#f39c12',
  success: '#2ecc71',
  text: '#2c3e50',
  light: '#ecf0f1',
  white: '#ffffff',
  gold: '#ffd700',
  gray: '#cccccc',
  darkGray: '#888888',
  lightGray: '#eeeeee',
  black: '#333333',
};

// --- 情绪文案 ---
const PRAISES = {
  2: ["不错嘛，手感来了！", "稳稳的，继续～", "这个回答我很满意！"],
  3: ["三连击！你今天状态绝了！", "越来越顺，挡都挡不住！", "手热了！再接再厉～"],
  4: ["四连击！势不可挡！", "这波操作，我直接五体投地！", "开挂了吧？没有？那就是实力！"],
  5: ["五连击！成语大师就是你了！", "行云流水，太优雅了！", "五连达成，今天的你是发光的！"],
  6: ["六连击！词典都要认你当老大！", "一路高歌，无人能挡！", "这实力，我先干为敬！"],
  7: ["七连击！前无古人！", "活字典本典出现了！", "甘拜下风，请收下我的膝盖～"],
  8: ["八连击！通天了！", "外星人都看傻了！", "这波连击，值得截图留念！"],
  9: ["九连击！破纪录了！", "你已经飞出地球了！", "跪了跪了，大神带带我！"],
  10: ["十连击！封神时刻！", "历史第一人，说的就是你！", "这不是实力，这是传奇！"],
};

// --- 关卡系统（无限关卡：甲方案题数递增——每 2 关 +1 题封顶 12，限时随题数微涨） ---
// 题数：第1-2关5题，第3-4关6题…每2关+1，封顶12（防后期单关过长流失）
function questionsOf(lv) {
  return Math.min(5 + Math.floor((lv - 1) / 2), 12);
}
// 各关累计题数表（LEVEL_CUM[lv] = 前 lv 关累计；用于由总答对数反推当前关）
// ★ 扩容到 2000 关（约 22.5k 题）：300 关只有 3544 题，重度用户几天就打穿 → 边界答一题下次 load 回 0。
const LEVEL_CUM = (() => {
  const arr = [0];
  let c = 0;
  for (let lv = 1; lv <= 2000; lv++) { c += questionsOf(lv); arr.push(c); }
  return arr;
})();
function levelOfCount(count) {
  // ★ 二分查找：LEVEL_CUM 长度 2001，线性扫描 O(2000) 每次调用有性能损耗，log2(2000)=11 步够。
  if (count <= 0) return 1;
  if (count >= LEVEL_CUM[LEVEL_CUM.length - 1]) return LEVEL_CUM.length - 1;
  let lo = 1, hi = LEVEL_CUM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (LEVEL_CUM[mid] <= count) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// --- 关卡进度持久化（存总答对数 solvedCount，可精确恢复到某关第几题）---
const PROGRESS_KEY = 'idiomGameProgress';
// 存档上限：LEVEL_CUM 已扩容到 2000 关；重度用户也基本碰不到这个上限
const PROGRESS_MAX = LEVEL_CUM[LEVEL_CUM.length - 1];

// ★ 节流写盘：每答对一题写一次，setStorageSync 30-150ms 会短暂阻塞主线程 → 掉帧。
// 每答对 3 题才落盘一次，onHide/endGame 兜底强写，保证不丢进度。
let savePendingCount = 0;
function saveProgress(force) {
  savePendingCount++;
  if (!force && savePendingCount % 3 !== 0) return;
  const solvedCount = state.solvedCount;
  flushSave(solvedCount);
}
function flushSave(solvedCount) {
  if (solvedCount == null) solvedCount = state.solvedCount;
  try {
    wx.setStorageSync(PROGRESS_KEY, { solvedCount, savedAt: Date.now() });
  } catch (e) { /* storage 不可用（隐私模式等）：进度功能静默降级，不影响游戏 */ }
}
function flushSaveNow() {
  if (savePendingCount > 0) { flushSave(state.solvedCount); savePendingCount = 0; }
}
// ★ 切后台强写：节流缓冲里可能有 1-2 题未落盘，用户切后台杀进程时全丢。
// audio.js 也有自己的 onHide（暂停 BGM），此处单独挂一个只负责存档。
try { wx.onHide(() => { flushSaveNow(); }); } catch (e) { /* 低版本基础库 */ }

// ★ loadProgress 严格校验：只接受「数字且整数且 ≥0 且 ≤ PROGRESS_MAX」
// 防止 wx.getStorageSync 返回异常值（如 'true'/'50'/true/NaN/Infinity/-1）导致后续反推错乱。
function loadProgress() {
  try {
    const raw = wx.getStorageSync(PROGRESS_KEY);
    const n = (raw && typeof raw === 'object') ? raw.solvedCount : raw;
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > PROGRESS_MAX) return 0;
    return n;
  } catch (e) {
    return 0; // 读取失败绝不抛错、绝不卡死
  }
}
function clearProgress() {
  try { wx.removeStorageSync(PROGRESS_KEY); } catch (e) {}
  try { wx.setStorageSync(PROGRESS_KEY, { solvedCount: 0, savedAt: Date.now() }); } catch (e) {}
}
// --- 清除进度入口：不可逆操作，必须先二次确认 ---
function confirmClearProgress() {
  // ★ 第六轮修：去掉 canIUse('showModal') 预判——小游戏模式下 canIUse 对 showModal
  //   误返回 false（小游戏 API 检测机制与小程序不同），导致清除进度功能失效。
  //   canIUse 语义是"API 是否存在"而非"调用会成功"，直接 try + 下方 catch 兜底更可靠：
  //   showModal 可用则正常弹窗；不存在或抛错则 catch 保守拒绝（保留第三轮保护意图）。
  try {
    wx.showModal({
      title: '确认清除进度？',
      content: '将回到第 1 关，之前答对的所有记录都会清空且无法恢复。',
      confirmText: '清除',
      cancelText: '再想想',
      success: (res) => {
        if (res && res.confirm) {
          clearProgress();
          startGame();
        }
      },
    });
  } catch (e) {
    // 弹窗本身抛错/不存在：不直接执行清除，保守提示
    try {
      wx.showToast({ title: '弹窗失败，无法清除进度', icon: 'none', duration: 2500 });
    } catch (err) { /* 静默 */ }
  }
}
const LEVEL_NAMES = [
  "初出茅庐", "小试牛刀", "初露锋芒", "崭露头角", "游刃有余",
  "炉火纯青", "出神入化", "登峰造极", "博古通今", "学富五车",
  "才高八斗", "文曲星下凡", "成语宗师", "一代宗师", "华语巅峰",
];

function levelTimeOf(lv) {
  // ★ 曲线平缓（10-15 调整）：老版 60+4x 让后期每题 7.3s（3 格题每格 2.4s 窒息）；
  //   新版 72+2x，前期 14.4s 稍松但不至于磨蹭，后期 7.7s 稍喘，3 格题每格仍有 2.6s 反应空间。
  return 72 + Math.max(0, questionsOf(lv) - 5) * 2;
}

// --- 小可爱吉祥物（5 个造型，每 3 关换一个，越后越华丽）---
// 图片：images/mascot1~5.png（Q版萌系吉祥物，透明背景 PNG）
const MASCOT_IMGS = [1, 2, 3, 4, 5].map(n => {
  const img = wx.createImage();
  img.src = `images/mascot${n}.png`; // 加载失败静默：气泡台词仍会显示
  return img;
});
function mascotIdxOf(lv) {
  return Math.min(4, Math.floor((lv - 1) / 3)); // 1-3关→0，4-6→1 … 13+→4
}
const MASCOT_START_LINES = [
  '大家好呀～我是小橙！和我一起闯关吧！',
  '小粉来啦！这一关我们一起加油哦！',
  '小龙女驾到～有我在，别怕难！',
  '星星仙子为你护航～冲鸭！',
  '女神降临！你可是最棒的，冲呀！',
];
function mascotLevelLine(lv) {
  return `第${lv}关「${levelNameOf(lv)}」开始！${levelTimeOf(lv)} 秒内答对 ${questionsOf(lv)} 题～`;
}

function levelNameOf(lv) {
  return lv <= LEVEL_NAMES.length ? LEVEL_NAMES[lv - 1] : `传奇·${lv}段`;
}

function getLevelInfo() {
  // 由累计答对数反推当前关（题数递增后每关边界不同）
  const lv = levelOfCount(state.solvedCount);
  // 挖空数规则（2026-10-15 v5）：lv1-10 全 1 格；lv11-13 全 2 格；lv14-15 过渡带 25% 概率 3 格；lv16-25 全 2 格；lv26+ 1/2/3 等概率
  const blanks = blanksOf(lv);
  return {
    lv,
    name: levelNameOf(lv),
    blanks,
    questions: questionsOf(lv),
    levelTime: levelTimeOf(lv),
    solvedInLevel: state.solvedCount - LEVEL_CUM[lv - 1],
  };
}

const ACHIEVEMENTS = [
  { id: "first_blood", name: "初战告捷" },
  { id: "combo_3",    name: "三连之力" },
  { id: "combo_5",    name: "五连神迹" },
  { id: "combo_10",   name: "十连封神" },
  { id: "speed_5",    name: "闪电侠" },
  { id: "solve_20",   name: "博古通今" },
  { id: "score_500",  name: "分数过五百" },
];

// --- 去重题库 ---
const ALL_IDIOMS = [...new Set(IDIOMS)].filter(s => s.length === 4);
// 大众熟知白名单（与题库求交集，防手误；全部为耳熟能详的成语）
const COMMON_SET = [...new Set(COMMON_IDIOMS)].filter(w => ALL_IDIOMS.includes(w));

// --- 游戏状态 ---
const state = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  timeLeft: 35,        // 当前关剩余时间（每关重置）
  currentIdiom: null,
  blanks: [],
  filledBlanks: [],
  candidates: [],
  candidateLayout: [], // 候选字错落布局 [{x,y,size,rot,scale}]
  solvedCount: 0,
  isPlaying: false,
  usedIdioms: new Set(),
  unlockedAchievements: new Set(),
  hintsLeft: 0,        // 本局剩余提示次数（限制）
  adTimeUses: 0,       // 本局剩余「看广告加时」次数
  addTimeFx: 0,        // 加时按钮按下反馈时间戳（弹跳 + 浮动「+10s」）
  puzzleStartTime: 0,
  solvedIdiomList: [],
  revivedThisGame: false,
  pendingTimers: [],    // 登记中的 setTimeout（endGame/startGame 统一清理，防死后复活）
  // 触摸/动画状态
  emotionText: '',
  emotionTime: 0,
  emotionColor: COLORS.primary,
  explainText: '',     // 答对后展示的成语释义（答错不显示）
  explainTime: 0,
  confettiList: [],
  achievementQueue: [], // ★ 队列：多个成就同题解锁时依次播放，不再覆盖（例：solvedCount=50 触发 score_500 与 solve_50 同题）
  // 小可爱互动
  mascot: null,        // { idx, text, time } 关卡开始/加时成功的卡通形象反馈
  mascotPos: null,     // 玩家拖动后的当前位置 {x,y}（左上角），跨局记忆
  mascotDrag: null,    // 拖动中 { offX, offY, moved }
  // 转场动画
  cellAnims: [], // [{type:'correct'|'wrong', time:0}]
  // 场景
  scene: 'playing', // 'playing' | 'result'
  timer: null,
};

// --- 工具 ---
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- 题库分层（先易后难）：字符出现频率 ≈ 常用度，成语取四字最低频字打分 ---
// 启动时算一次：低关卡只出「高频字组成的常用成语」，随关卡扩大池子
const CHAR_FREQ = {};
ALL_IDIOMS.forEach(idiom => { for (const ch of idiom) CHAR_FREQ[ch] = (CHAR_FREQ[ch] || 0) + 1; });
const IDIOM_SCORED = ALL_IDIOMS
  .map(w => ({ w, s: Math.min(...[...w].map(c => CHAR_FREQ[c] || 0)) }))
  .sort((a, b) => b.s - a.s);
const TIER_POOLS = { t1: null, t2: null, t3: null, src: {} };
const TIER_CHAR_POOLS = { lv1to3: null, lv4to6: null, lv7to10: null, lv11plus: null, sortedAll: null };
(function buildTiers() {
  const n = IDIOM_SCORED.length;
  const cut = p => new Set(IDIOM_SCORED.slice(0, Math.floor(n * p)).map(o => o.w));
  TIER_POOLS.t1 = cut(0.15);  // 最常用 ~3000 条：第 1 关
  TIER_POOLS.t2 = cut(0.35);  // ~7000 条：第 2 关起
  TIER_POOLS.t3 = cut(0.60);  // ~12000 条：第 3-4 关
  TIER_POOLS.src = {
    1: ALL_IDIOMS.filter(w => TIER_POOLS.t1.has(w)),
    2: ALL_IDIOMS.filter(w => TIER_POOLS.t2.has(w)),
    3: ALL_IDIOMS.filter(w => TIER_POOLS.t3.has(w)),
  };
  // ★ 字符池按 tier 缓存：避免 getSimilarChars 每题遍历整个 tier source 4ms
  const buildChars = src => { const s = new Set(); for (const w of src) for (const ch of w) s.add(ch); return [...s]; };
  TIER_CHAR_POOLS.lv1to3   = buildChars(COMMON_SET);
  TIER_CHAR_POOLS.lv4to6   = buildChars(COMMON_SET.concat(TIER_POOLS.src[2]));
  // ★ 第五轮修：lv7-10 与 tierSource 同步——新版 tierSource lv7-10 累加 COMMON+src[2]+src[3]，
  //   字符池若只用 src[3] 会漏掉 COMMON 独有字符（约 280 个），导致 lv7-10 抽到 COMMON-only 成语时干扰字质量下降。
  TIER_CHAR_POOLS.lv7to10  = buildChars(COMMON_SET.concat(TIER_POOLS.src[2], TIER_POOLS.src[3]));
  TIER_CHAR_POOLS.lv11plus = buildChars(ALL_IDIOMS);
  // 高频字符池（预排序，避免每题再 sort 20k 字符）
  TIER_CHAR_POOLS.sortedAll = TIER_CHAR_POOLS.lv11plus
    .slice()
    .sort((a, b) => (CHAR_FREQ[b] || 0) - (CHAR_FREQ[a] || 0));
})();
function tierSource(lv) {
  // 先易后难四层递进（2026-10-15 v5：修正 lv7-10 池子倒挂——原版 lv7 从「COMMON+T2」切到「T3 子集」，
  // 玩家感觉越往后题越少越重复。改成累加，保留大众高频 + 逐步引入中等偏难，池子单调递增）
  if (lv <= 3)  return COMMON_SET;                                        // 1-3 关：只出大众熟知成语
  if (lv <= 6)  return COMMON_SET.concat(TIER_POOLS.src[2]);              // 4-6 关：白名单 + 次常用
  if (lv <= 10) return COMMON_SET.concat(TIER_POOLS.src[2], TIER_POOLS.src[3]);  // 7-10 关：累加（★ 修正倒挂）
  return ALL_IDIOMS;                                                       // 11 关起：全池 20000+
}

// 挖空数规则（2026-10-15 v5：单关统一 + 过渡带）
// - lv1-10  全 1 格：上手期节奏稳，玩家不用来回切换单双预期
// - lv11-13 全 2 格：中期稳定
// - lv14-15 过渡带 25% 3 格：提前让玩家接触 3 格，为 lv26+ 的混合做铺垫
// - lv16-25 全 2 格：稳定期，让玩家在最高难度（3 格混合）前先适应长关+多题
// - lv26+   1/2/3 等概率：真正的高端混合，节奏波动=难度
function blanksOf(lv) {
  if (lv <= 10) return 1;
  if (lv <= 13) return 2;
  if (lv <= 15) return Math.random() < 0.25 ? 3 : 2;
  if (lv <= 25) return 2;
  return 1 + Math.floor(Math.random() * 3);
}

function getSimilarChars(target, count, lv) {
  // ★ 字符池用缓存（TIER_CHAR_POOLS），启动时按 tier 预构建，避免每题遍历 20k+ 字符
  let chars;
  if (lv <= 3) chars = TIER_CHAR_POOLS.lv1to3;
  else if (lv <= 6) chars = TIER_CHAR_POOLS.lv4to6;
  else if (lv <= 10) chars = TIER_CHAR_POOLS.lv7to10;
  else chars = TIER_CHAR_POOLS.lv11plus;
  chars = chars.filter(ch => !target.includes(ch));
  // ★ lv1-4 全部用高频字前 N（10-15 调整）：老版 lv<=2 用高频、lv3+ 切 tier 池随机，
  //   导致 lv3 难度反弹（tier 池里可能蹦出偏生僻字，比 lv1 还难）。延到 lv5 才切 tier 池，曲线顺。
  if (lv <= 4) {
    const sorted = TIER_CHAR_POOLS.sortedAll.filter(ch => !target.includes(ch));
    const hot = sorted.slice(0, Math.max(count * 6, 50));
    return shuffle(hot).slice(0, count);
  }
  return shuffle(chars).slice(0, count);
}

// --- 触摸区域定义 ---
let touchZones = {};

function buildTouchZones() {
  const w = SCREEN_W;
  const cellSize = LAYOUT.idiomSize;
  const cellGap = rpx(8);
  const idiomY = LAYOUT.idiomY;
  const idiomW = cellSize * 4 + cellGap * 3;
  const idiomX = (w - idiomW) / 2;

  // 四个格子
  const cells = [];
  for (let i = 0; i < 4; i++) {
    cells.push({
      x: idiomX + i * (cellSize + cellGap),
      y: idiomY,
      w: cellSize,
      h: cellSize,
    });
  }

  // 底部按钮行：提示 | 跳过 | 看广告加时（同排三按钮，同源坐标；不再悬浮在顶部遮挡关卡名）
  const rowW = rpx(100) + rpx(100) + rpx(88) + rpx(12) * 2;
  const rowX = (w - rowW) / 2;
  touchZones = {
    cells,
    candidates: state.candidateLayout || [],
    btnHint:    { x: rowX, y: LAYOUT.btnY, w: rpx(100), h: LAYOUT.btnH },
    btnSkip:    { x: rowX + rpx(100) + rpx(12), y: LAYOUT.btnY, w: rpx(100), h: LAYOUT.btnH },
    btnAddTime: { x: rowX + (rpx(100) + rpx(12)) * 2, y: LAYOUT.btnY, w: rpx(88), h: LAYOUT.btnH },
    // 音乐开关（左上角，避开右上角胶囊）
    btnMusic: { x: rpx(16), y: LAYOUT.topY - rpx(34), w: rpx(30), h: rpx(30) },
    // 结算面板按钮由 buildResultPanel() 统一计算（复活缺席时自动收紧，不留顶部空白）
  };
  buildResultPanel();
}

// --- 定时任务登记（P1 修复：判分/换题/清格的 setTimeout 统一登记，
//     endGame/startGame 时一次性作废，杜绝「时间归零进了结算，遗留回调仍在改状态」的死后复活竞态）---
function delay(fn, ms) {
  const id = setTimeout(() => {
    state.pendingTimers = state.pendingTimers.filter(t => t !== id);
    fn();
  }, ms);
  state.pendingTimers.push(id);
  return id;
}
function clearPendingTimers() {
  state.pendingTimers.forEach(id => clearTimeout(id));
  state.pendingTimers = [];
}
// 判分链路的守门：只有仍在对局中才允许继续
function stillPlaying() {
  return state.isPlaying && state.scene === 'playing';
}

// --- 生成一题 ---
function generatePuzzle() {
  const info = getLevelInfo();
  // 难度曲线：低关只从常用成语池出题
  const source = tierSource(info.lv);
  let available = source.filter(id => !state.usedIdioms.has(id));
  if (available.length === 0) {
    state.usedIdioms.clear();
    available = source;
  }
  const idiom = shuffle(available)[0];
  state.usedIdioms.add(idiom);
  state.currentIdiom = idiom;
  state.puzzleStartTime = Date.now();

  // 挖空数：每题现摇（规则见 blanksOf v5）——lv1-13 单关统一；lv14-15 过渡带 25% 3 格；lv16-25 全 2 格；lv26+ 1/2/3 等概率
  const blankCount = blanksOf(info.lv);
  const positions = info.lv === 1
    ? [3]
    : shuffle([0, 1, 2, 3]).slice(0, blankCount).sort((a, b) => a - b);
  state.blanks = positions;
  state.filledBlanks = new Array(blankCount).fill(null);

  const correctChars = positions.map(p => idiom[p]);
  // 难度曲线：第 1-2 关只给 5 个候选（干扰字更少），第 3 关起 6 个
  const candCount = info.lv <= 2 ? 5 : 6;
  const distractChars = getSimilarChars(correctChars, candCount - blankCount, info.lv);
  state.candidates = shuffle([...correctChars, ...distractChars]);
  // 候选字错落随机布局：每局重新摇（横向铺满利用左右留白，纵向双排交错）
  state.candidateLayout = layoutCandidates(state.candidates.length);
  state.cellAnims = [];

  buildTouchZones();
}

// --- 选择候选字 ---
function selectCandidate(idx) {
  if (!state.isPlaying) return;
  if (state.scene !== 'playing') return;
  const ch = state.candidates[idx];
  if (ch === undefined) return;
  const emptyIdx = state.filledBlanks.indexOf(null);
  if (emptyIdx === -1) return;
  state.filledBlanks[emptyIdx] = { char: ch, candIdx: idx };
  if (state.filledBlanks.every(f => f !== null)) {
    delay(checkAnswer, 200);
  }
}

// --- 检查答案（守门：结算后遗留的判分回调直接作废，不再改状态）---
function checkAnswer() {
  if (!stillPlaying()) return;
  // ★ 长度校验：filledBlanks 与 blanks 长度必须一致，否则 every 会返回 true（越界比较 undefined===undefined）
  // 正常路径不会触发；这里加兜底防换题/复活过程中的状态错乱
  if (state.blanks.length !== state.filledBlanks.length) {
    generatePuzzle();
    return;
  }
  const idiom = state.currentIdiom;
  const userAnswer = state.blanks.map((p, i) => state.filledBlanks[i] ? state.filledBlanks[i].char : null);
  const correctAnswer = state.blanks.map(p => idiom[p]);
  const isCorrect = userAnswer.every((ch, i) => ch === correctAnswer[i]);
  if (isCorrect) onCorrect(); else onWrong();
}

// --- 答对 ---
function onCorrect() {
  state.combo++;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.solvedCount++;
  // ★ 封顶 PROGRESS_MAX：超限时 levelOfCount 会早退返 2000 关，但 flushSave 会把 >MAX 的脏值写盘，
  // 下次冷启动 loadProgress 判 n > PROGRESS_MAX 直接归零 —— 长期答对的玩家白干一辈子
  if (state.solvedCount > PROGRESS_MAX) state.solvedCount = PROGRESS_MAX;
  state.solvedIdiomList.push(state.currentIdiom);

  // 释义卡：答对才展示（答错不显示）；无释义的成语静默跳过；持续 3.2s（跨下一题，供玩家阅读）
  const meaning = IDIOM_MEANINGS[state.currentIdiom];
  if (meaning) {
    state.explainText = `【${state.currentIdiom}】${meaning}`;
    state.explainTime = Date.now();
  }

  // 进度持久化：每答对一题立即存档（刷新/退出/闪退都不丢）
  saveProgress();

  const baseScore = 10;
  const comboBonus = Math.min(state.combo - 1, 10) * 5;
  state.score += baseScore + comboBonus;

  const elapsed = (Date.now() - state.puzzleStartTime) / 1000;
  if (elapsed < 5) {
    state.score += 10;
    showEmotion("⚡ 手速惊人 +10！");
    unlockAchievement("speed_5");
  }

  // 升关判断：本题答对前后关卡号变化（题数递增后边界不再固定）
  if (levelOfCount(state.solvedCount) > levelOfCount(state.solvedCount - 1)) {
    // ★ 升关强写：节流缓冲里可能没写盘，此时是"玩家完成了某关"的语义边界，必须落盘。
    // 否则玩家在升关瞬间被系统 kill，loadProgress 会恢复到上一关而非当前关。
    flushSaveNow();
    // 升关：时间重置为本关限时（每一关限定时间，而不是限定总时间）
    const next = getLevelInfo();
    state.timeLeft = next.levelTime;
    showEmotion(`🏆 第${next.lv}关 ${next.name}！`);
    AudioSys.playSfx('win');   // 古筝上行刮奏：过关音效
    spawnConfetti(30);
    // 小可爱宣布新关卡开始
    showMascot(mascotLevelLine(next.lv) + ' ' + MASCOT_START_LINES[mascotIdxOf(next.lv)]);
  } else {
    AudioSys.playSfx('correct'); // 古筝单音轻拨：普通答对
  }

  if (state.combo >= 2) {
    const praises = PRAISES[state.combo] || PRAISES[10];
    showEmotion(praises[Math.floor(Math.random() * praises.length)]);
    unlockAchievement(
      state.combo >= 10 ? "combo_10" :
      state.combo >= 5 ? "combo_5" :
      state.combo >= 3 ? "combo_3" : null
    );
  }

  if (state.solvedCount === 1) {
    unlockAchievement("first_blood");
    showEmotion("🎉 开门红！今天运势爆棚～");
  }

  if (state.score >= 500) unlockAchievement("score_500");
  if (state.solvedCount >= 20) unlockAchievement("solve_20");

  state.cellAnims = state.blanks.map(() => ({ type: 'correct', time: Date.now() }));

  if (state.combo >= 3) spawnConfetti(15);
  if (state.combo >= 5) spawnConfetti(25);

  // 换题也走登记定时器：期间若时间归零进入结算，该回调会被 clearPendingTimers 作废
  delay(() => { if (stillPlaying()) generatePuzzle(); }, 600);
}

// --- 答错 ---
function onWrong() {
  const prevCombo = state.combo;
  state.combo = 0;
  state.timeLeft = Math.max(0, state.timeLeft - 3);
  state.cellAnims = state.blanks.map(() => ({ type: 'wrong', time: Date.now() }));

  if (prevCombo >= 3) {
    showEmotion("连击休息了一下，马上满血回来！");
  } else {
    const arr = ["没关系，下一个就是它！", "差一点点，眼神已经很准了！", "小磕绊而已，继续冲～", "答错的题都是来送分的，再来！", "别急，慢慢来，我陪你～"];
    showEmotion(arr[Math.floor(Math.random() * arr.length)]);
  }

  delay(() => {
    if (!stillPlaying()) return;   // 结算后不再重置格子，避免与新一轮开局打架
    state.filledBlanks = state.filledBlanks.map(() => null);
    state.cellAnims = [];
  }, 400);
}

// --- 小可爱互动反馈 ---
const MASCOT_DURATION = 4500; // 展示 4.5s（2026-10-13 加长，方便阅读与拖动）
const MASCOT_POS_KEY = 'mascotPos';
// 位置记忆：默认左下（按钮行上方，不遮挡提示按钮）；玩家拖动后存 storage，下次出现在该位置
let mascotDefaultPos = null; // buildLayout 后计算
try {
  const saved = wx.getStorageSync(MASCOT_POS_KEY);
  // ★ 严格校验：saved.x/y 必须是有限数字，防止脏数据（字符串/NaN/Infinity/undefined）污染坐标
  if (saved && typeof saved === 'object' &&
      typeof saved.x === 'number' && Number.isFinite(saved.x) &&
      typeof saved.y === 'number' && Number.isFinite(saved.y)) {
    mascotDefaultPos = { x: saved.x, y: saved.y };
  }
} catch (e) { /* storage 不可用时用默认位置 */ }
// 小可爱纵向可达范围：
//   上界＝不越过头像信息区；下界＝头像底部必须停在按钮行上方 rpx(16) 处，
//   ★关键：绝不遮挡底部按钮行（提示/跳过/加时），否则会压住按钮导致点不到
function mascotYRange(size) {
  return {
    minY: LAYOUT.topY + rpx(50),
    maxY: Math.min(SCREEN_H - SAFE_BOTTOM - size - rpx(120), LAYOUT.btnY - rpx(16) - size),
  };
}
function mascotHomePos(size) {
  const yr = mascotYRange(size);
  if (mascotDefaultPos) {
    // 拖过：clamp 进屏（防止换机型后出屏；旧存档若压在按钮行会被自动上推）
    return {
      x: clamp(mascotDefaultPos.x, rpx(6), SCREEN_W - size - rpx(6)),
      y: clamp(mascotDefaultPos.y, yr.minY, yr.maxY),
    };
  }
  // 默认：左下角，头像底部距按钮行 10rpx（不遮挡提示/跳过/加时）
  return { x: rpx(10), y: LAYOUT.btnY - rpx(10) - size };
}
function showMascot(text) {
  const lv = getLevelInfo().lv;
  state.mascot = { idx: mascotIdxOf(lv), text, time: Date.now() };
  if (!state.mascotPos) state.mascotPos = mascotHomePos(rpx(84));
}

// --- 情绪浮动文字 ---
function showEmotion(text) {
  state.emotionText = text;
  state.emotionTime = Date.now();
  state.emotionColor = state.combo >= 5 ? COLORS.gold : state.combo >= 3 ? COLORS.secondary : COLORS.primary;
}

// --- 撒花（v2：旋转飘落 + 左右摇摆 + 方/圆/长条三形状混撒 + 尾段淡出） ---
function spawnConfetti(count) {
  const colors = ['#ff6b81','#ffb84d','#7ed957','#5b8def','#b28dff','#ffd700','#ff9ff3','#4ecdc4'];
  for (let i = 0; i < count; i++) {
    const shape = Math.random() < 0.55 ? 'rect' : Math.random() < 0.6 ? 'strip' : 'dot';
    state.confettiList.push({
      x: Math.random() * SCREEN_W,
      y: -20 - Math.random() * 80,
      vx: 0,
      vy: 1.6 + Math.random() * 2.6,               // 整体更缓，飘感更强
      size: rpx(5) + Math.random() * rpx(7),
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
      shape,
      // 旋转：各自随机转速与初始角（长条转起来最像真彩带）
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.25,
      // 左右摇摆：正弦相位 + 摆幅，模拟空气阻力
      swayPhase: Math.random() * Math.PI * 2,
      swayFreq: 0.04 + Math.random() * 0.04,
      swayAmp: 0.6 + Math.random() * 1.2,
      // 少量金色「闪光款」：绘制时叠加高光小星
      sparkle: Math.random() < 0.15,
    });
  }
  // ★ 上限保护：push 后再裁（先裁后 push 会导致总数 200+count 超上限）
  // 200 已足够视觉冲击，超出的裁掉最早的（先落完的先被裁）
  if (state.confettiList.length > 200) {
    state.confettiList.splice(0, state.confettiList.length - 200);
  }
}

// --- 成就 ---
function unlockAchievement(id) {
  if (!id) return;
  if (state.unlockedAchievements.has(id)) return;
  state.unlockedAchievements.add(id);
  const ach = ACHIEVEMENTS.find(a => a.id === id);
  if (ach) {
    // ★ 入队而非覆盖：同题解锁多个成就时依次播放（例：solvedCount=50 触发 score_500 与 solve_50 同题）
    state.achievementQueue.push({ name: ach.name, time: Date.now() });
  }
}

// --- 结算评语 ---
function getRank(score, solved) {
  if (solved >= 25) return { title: "成语之神！", text: "这脑子，孔子看了都点赞～" };
  if (solved >= 20) return { title: "文曲星下凡！", text: "华语圈已装不下你的才华" };
  if (solved >= 15) return { title: "学富五车！", text: "成语活词典非你莫属～" };
  if (solved >= 10) return { title: "博古通今！", text: "相当厉害了，给自己鼓个掌！" };
  if (solved >= 7)  return { title: "初露锋芒！", text: "手感正热，下一局更精彩～" };
  if (solved >= 3)  return { title: "小试牛刀", text: "已经很棒啦，进步肉眼可见！" };
  if (solved >= 1)  return { title: "初出茅庐", text: "万事开头难，你已经开好头了！" };
  return { title: "再接再厉", text: "热身结束，好戏才刚开始～" };
}

// --- 游戏结束 ---
function endGame() {
  state.isPlaying = false;
  state.scene = 'result';
  clearPendingTimers();   // 时间归零＝死亡线：遗留的判分/换题/清格回调全部作废（防死后复活）
  buildResultPanel();     // 复活按钮是否出现会改变面板高度，进入结算时重算一次
  AudioSys.playSfx('lose');   // 古筝低音下行：结束音效
  // ★ BGM 渐弱到 0.05（保留极低环境音），不再硬切到 0，听觉体验更平滑。
  // 300ms 内完成，与结算面板弹出同步。重开时 startGame 会 fadeBgm 回 bgmVol。
  if (AudioSys.fadeBgm && AudioSys.isOn()) AudioSys.fadeBgm(0.05, 300);
  flushSaveNow(); // 结算前强写存档，防节流缓冲里的进度丢失
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  // ★ 结算页视觉清场：死亡前的吉祥物/拖动态/未播完的成就队列在结算期间都不再显示，
  // 否则玩家会看到"结算已出，成就还在右上角刷"、"结算卡背后吉祥物还在讲话"的怪场景
  state.mascot = null;
  state.mascotDrag = null;
  if (state.achievementQueue) state.achievementQueue.length = 0;
}

// --- 重新开始 ---
function startGame() {
  clearPendingTimers();   // 先清掉上一局遗留的判分/换题/清格回调
  // ★ 强写：把节流缓冲里未落盘的进度先补上，防止下一局读到的是过期进度
  flushSaveNow();
  // ★ BGM 音量恢复：endGame 会 fadeBgm 到 0.05 做渐弱，重开一局拉回默认 0.22。
  // 音量 0.22 与 audio.js BGM_DEFAULT_VOL 保持同步（改音频默认值时两处都要改）。
  if (AudioSys.fadeBgm && AudioSys.isOn()) AudioSys.fadeBgm(0.22, 300);
  state.score = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.solvedCount = 0;
  state.isPlaying = true;
  state.hintsLeft = 3;   // 提示有限制：每局 3 次
  state.adTimeUses = 3;  // 看广告加时：每局 3 次
  state.solvedIdiomList = [];
  state.revivedThisGame = false;
  state.unlockedAchievements = new Set();
  state.usedIdioms.clear();
  state.scene = 'playing';
  state.emotionText = '';
  state.explainText = ''; // 重开局清掉上一局残留释义
  state.confettiList = [];
  // ★ 新开局彻底清旧 mascot：防止上一局残留的吉祥物气泡延续到新游戏
  state.mascot = null;
  state.mascotDrag = null;
  // ★ 清遗留成就队列：死亡前 2s 刚解锁的成就弹窗可能还没播完，玩家在结算页直接点"再来一局"，
  // 否则新游戏第 1 题会冒出上一局的"解锁成就"提示
  if (state.achievementQueue) state.achievementQueue.length = 0;
  // 进度持久化：读档续玩（无存档/异常自动回退第 1 关）
  state.solvedCount = loadProgress();
  state.timeLeft = getLevelInfo().levelTime; // 本关限时（含恢复的进度关）
  // 小可爱宣布开局（按恢复后的关卡）
  const startLv = getLevelInfo().lv;
  showMascot(mascotLevelLine(startLv) + ' ' + MASCOT_START_LINES[mascotIdxOf(startLv)]);

  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.timeLeft--;
    if (state.timeLeft <= 0) {
      endGame();
    }
  }, 1000);

  generatePuzzle();
}

// --- 提示（基础每局 3 次；用完免费无限续补 +3，V1.0 免费策略；V1.1 接流量主后改为看激励视频补） ---
function showHint() {
  if (!state.isPlaying || state.scene !== 'playing') return;
  // 提示用完 → 免费续补 3 次（V1.0 无广告版直接给；V1.1 接流量主后改为看激励视频补）
  if (state.hintsLeft <= 0) {
    // ⚠ 不在此处调起分享：避免"给奖励后强制弹分享"的诱导分享风险，分享只走结算页独立按钮
    state.hintsLeft += 3;
    showEmotion("💡 又送你 3 次提示，慢慢挑～");
    return;
  }
  const emptyIdx = state.filledBlanks.indexOf(null);
  if (emptyIdx === -1) return;
  state.hintsLeft--;
  const correctChar = state.currentIdiom[state.blanks[emptyIdx]];
  const usedIndices = new Set(state.filledBlanks.filter(f => f).map(f => f.candIdx));
  const matchIdx = state.candidates.findIndex((ch, idx) => ch === correctChar && !usedIndices.has(idx));
  state.filledBlanks[emptyIdx] = { char: correctChar, candIdx: matchIdx >= 0 ? matchIdx : -1 };
  state.score = Math.max(0, state.score - 5);
  showEmotion("小提示送你，-5分换个思路，值！");
  if (state.filledBlanks.every(f => f !== null)) delay(checkAnswer, 200);
  // TODO: 激励视频广告（V1.1 接入）
  // ⚠ 鸿蒙小游戏暂不支持广告：接入时必须先 PF.canUseRewardedAd() 判断，
  //   鸿蒙上降级为「看分享免费提示」，绝不让点提示按钮无反应。
}

// --- 跳过 ---
function skipPuzzle() {
  if (!state.isPlaying || state.scene !== 'playing') return;
  // ★ 第五轮修：玩家快速填完 4 格后（selectCandidate 触发 200ms delay(checkAnswer)）立即按跳过，
  //   遗留的 checkAnswer 会用新题数据判空答案，必然误判 onWrong（-3s + combo 清零 + 视觉闪红）。
  //   同 skipPuzzle 首行清 timer，showHint 的 200ms 判分窗口同理。
  clearPendingTimers();
  state.combo = 0;
  state.timeLeft = Math.max(0, state.timeLeft - 5);
  // 跳过代价：扣 50 分（分数不为负），与 -5s 一起作为跳过的双重代价
  state.score = Math.max(0, state.score - 50);
  showEmotion("跳过啦～50分买路钱，前方的题更好拿捏！");
  generatePuzzle();
}

// --- 看广告加时长（每局 2 次，+10s） ---
function addTimeByAd() {
  if (!state.isPlaying || state.scene !== 'playing') return;
  if (state.adTimeUses <= 0) {
    showEmotion("加时次数都花完啦，省着点用～");
    return;
  }
  state.adTimeUses--;
  // V1.0 无广告版直接加时；V1.1 接流量主后改为看激励视频加时（此处不调分享，杜绝诱导分享）
  state.timeLeft += 10;
  state.addTimeFx = Date.now(); // 按钮原地强反馈：弹一下 + 上方浮出「+10s 已到账」
  showEmotion("⏱ 时间君再借你 10 秒，冲！");
  // 小可爱播报加时成功
  showMascot(`加时成功！小可爱送你 10 秒～本局还剩 ${state.adTimeUses} 次`);
}

// --- 看广告复活 ---
function reviveByAd() {
  if (state.revivedThisGame) return;
  state.revivedThisGame = true;
  // ★ 复活视为新一段：断掉死亡前的连击，避免"白捡"死前的 combo 直接升到下一档
  state.combo = 0;
  // ★ 清残留视觉态：死亡→复活路径上，上一段的释义卡/emotion/吉祥物/彩带不应继续显示
  state.explainText = '';
  state.emotionText = '';
  state.mascot = null;
  state.mascotDrag = null;
  state.confettiList = [];
  state.timeLeft += 30;
  state.isPlaying = true;
  state.scene = 'playing';
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.timeLeft--;
    if (state.timeLeft <= 0) endGame();
  }, 1000);
  generatePuzzle();
  showEmotion("王者归来！+30s 继续大杀四方～");
  spawnConfetti(20);
  // TODO: 激励视频广告（V1.1 接入）
  // ⚠ 鸿蒙暂不支持广告：PF.canUseRewardedAd() 为 false 时降级为「分享复活」或直接免费复活
}

// --- 分享 ---
// ★ 文案保守化（10-15 第六轮）：去掉"来挑战我吧"——小游戏分享审核里此类引导语
//   属"诱导分享"高风险表述，真机可能被微信拦截。改成纯成绩播报。
function shareScore() {
  const rank = getRank(state.score, state.solvedCount);
  const title = `我在补一字答对了${state.solvedCount}个成语，得分${state.score}，称号「${rank.title}」`;
  // 经 platform.js 兜底：鸿蒙「转发」为部分支持，失败时静默降级不中断游戏
  PF.safeShareAppMessage({
    title: title,
    // imageUrl: '', // 可自定义分享图
  });
}

// 设置默认分享（鸿蒙上 onShareAppMessage 可用性以真机为准，try/catch 兜底）
try {
  wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
} catch (e) { /* 部分平台不支持，忽略 */ }
try {
  wx.onShareAppMessage(() => {
    const rank = getRank(state.score, state.solvedCount);
    return {
      title: `我在补一字答对了${state.solvedCount}个成语，得分${state.score}，称号「${rank.title}」`,
    };
  });
} catch (e) { /* 部分平台不支持，忽略 */ }

// --- 触摸处理 ---
// 长按小可爱拖动：按下头像 → 350ms 未松手即进入拖动（跟手），松手保存位置到 storage
let mascotTouch = null; // { startX, startY, startT, dragging }

function hitMascot(x, y) {
  if (!state.mascot || !state.mascotPos) return false;
  const size = rpx(84);
  const { x: mx, y: my } = state.mascotPos;
  // 圆形热区外扩 10px 便于手指按住
  const cx = mx + size / 2, cy = my + size / 2;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= Math.pow(size / 2 + 10, 2);
}

wx.onTouchStart((e) => {
  const t = e.changedTouches && e.changedTouches[0];
  if (!t) return;
  // ★ 多指守卫：mascotTouch 是单例记录，第二指按下会覆盖第一指的 startX/Y，
  // 松手时 hitTest 命中错位（如"跳过按钮 + 候选字"两指，第一指抬起命中跳过 → 换题 → 第二指抬起按到新题的候选字）
  if (mascotTouch) return;
  // ★ 首次触摸续播 BGM：iOS WKWebView 要求 play() 在用户手势之后触发，
  // 否则 init() 那次 play() 被静默吞掉、BGM 永不发声。这里补一次，幂等。
  if (!state._audioResumed) {
    state._audioResumed = true;
    if (AudioSys.resumeBgm) AudioSys.resumeBgm();
  }
  mascotTouch = { startX: t.clientX, startY: t.clientY, startT: Date.now(), dragging: false };
});

wx.onTouchMove((e) => {
  const t = e.changedTouches && e.changedTouches[0];
  if (!t || !mascotTouch) return;
  const heldMs = Date.now() - mascotTouch.startT;
  // ★必须「长按 350ms + 手指真实位移 ≥10px」才进入拖动：
  //   否则「原地长按」会被当成拖动，松手时吞掉这次点击 → 按钮点了没反应
  const drift = Math.abs(t.clientX - mascotTouch.startX) + Math.abs(t.clientY - mascotTouch.startY);
  if (!mascotTouch.dragging && heldMs >= 350 && drift >= rpx(10) &&
      hitMascot(mascotTouch.startX, mascotTouch.startY)) {
    mascotTouch.dragging = true;
    state.mascotDrag = { offX: 0, offY: 0 };
  }
  if (mascotTouch.dragging && state.mascot) {
    const size = rpx(84);
    const yr = mascotYRange(size);
    state.mascotPos = {
      x: clamp(t.clientX - size / 2, rpx(6), SCREEN_W - size - rpx(6)),
      y: clamp(t.clientY - size / 2, yr.minY, yr.maxY),
    };
    // 拖动期间保持显示不消失
    state.mascot.time = Date.now() - 1000;
  }
});

wx.onTouchEnd((e) => {
  const touch = e.changedTouches[0];
  const wasDragging = mascotTouch && mascotTouch.dragging;
  if (wasDragging) {
    // 保存拖动位置，下次出现在这里
    if (state.mascotPos) {
      try { wx.setStorageSync(MASCOT_POS_KEY, state.mascotPos); } catch (err) {}
      mascotDefaultPos = { x: state.mascotPos.x, y: state.mascotPos.y };
    }
    state.mascotDrag = null;
    // 拖完重新计时展示，给玩家时间看台词
    if (state.mascot) state.mascot.time = Date.now();
    mascotTouch = null;
    return;
  }
  mascotTouch = null;
  if (!touch) return;
  const x = touch.clientX;
  const y = touch.clientY;

  // 音乐开关：所有场景都可点（playing + result），最先判断
  if (hitTest(x, y, touchZones.btnMusic)) {
    AudioSys.toggle();
    return;
  }

  if (state.scene === 'result') {
    // 结算面板按钮
    if (hitTest(x, y, touchZones.btnRevive) && !state.revivedThisGame) {
      reviveByAd();
    } else if (hitTest(x, y, touchZones.btnRestart)) {
      startGame();
    } else if (hitTest(x, y, touchZones.btnShare)) {
      shareScore();
    } else if (hitTest(x, y, touchZones.btnClear)) {
      confirmClearProgress();   // 不可逆操作：先二次确认再清空存档
    }
    return;
  }

  if (!state.isPlaying || state.scene !== 'playing') return;

  // 看广告加时
  if (hitTest(x, y, touchZones.btnAddTime)) {
    addTimeByAd();
    return;
  }

  // 候选字
  for (let i = 0; i < touchZones.candidates.length; i++) {
    if (hitTest(x, y, touchZones.candidates[i])) {
      // 检查这个候选是否已被使用
      const usedIndices = new Set(state.filledBlanks.filter(f => f).map(f => f.candIdx));
      if (!usedIndices.has(i)) {
        selectCandidate(i);
      }
      return;
    }
  }

  // 提示按钮
  if (hitTest(x, y, touchZones.btnHint)) {
    showHint();
    return;
  }

  // 跳过按钮
  if (hitTest(x, y, touchZones.btnSkip)) {
    skipPuzzle();
    return;
  }
});

// ★ 触摸取消：来电/系统弹窗会中断触摸事件，此时必须清掉拖拽中间态，
// 否则下次触摸会被误判为「续拖」导致按钮点不到。与 onTouchEnd 走同样的清理路径。
wx.onTouchCancel((e) => {
  const wasDragging = mascotTouch && mascotTouch.dragging;
  if (wasDragging && state.mascotPos) {
    try { wx.setStorageSync(MASCOT_POS_KEY, state.mascotPos); } catch (err) {}
    mascotDefaultPos = { x: state.mascotPos.x, y: state.mascotPos.y };
  }
  state.mascotDrag = null;
  mascotTouch = null;
  // ★ 拖拽中被系统打断（来电/弹窗），重置 mascot 计时让玩家还能看到完整的 MASCOT_DURATION。
  // 拖动时 time 被持续刷成 Date.now()-1000，取消后若不改 time，mascot 只剩 3.5s 就消失。
  if (state.mascot && wasDragging) state.mascot.time = Date.now();
});

function hitTest(x, y, zone) {
  // ★ 热区可能为 null（如已用过的复活按钮被置空），短路返回
  if (!zone) return false;
  if (zone.size !== undefined) {
    // 候选字：以 (x,y) 为中心，热区外扩补偿旋转/缩放的视觉偏差
    const r = zone.size / 2 + rpx(6);
    return x >= zone.x - r && x <= zone.x + r && y >= zone.y - r && y <= zone.y + r;
  }
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}

// --- 圆角矩形辅助 ---
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ★ 音乐开关按钮（左上角）：playing 与 result 场景共用，避免结算面板时音乐按钮不可点
function drawMusicButton() {
  const mu = touchZones.btnMusic;
  if (!mu) return;
  ctx.fillStyle = 'rgba(44, 62, 80, 0.12)';
  roundRect(ctx, mu.x, mu.y, mu.w, mu.h, rpx(15));
  ctx.fill();
  ctx.font = `${rpx(15)}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cx = mu.x + mu.w / 2, cy = mu.y + mu.h / 2 + 1;
  ctx.save();
  if (AudioSys.isOn()) {
    ctx.translate(cx, cy);
    ctx.rotate((Date.now() % 3000) / 3000 * Math.PI * 2);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = COLORS.primary;
  } else {
    ctx.fillStyle = '#b0b8bf';
  }
  ctx.fillText('♪', cx, cy);
  ctx.restore();
  if (!AudioSys.isOn()) {
    ctx.strokeStyle = '#b0b8bf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mu.x + 5, mu.y + mu.h - 5);
    ctx.lineTo(mu.x + mu.w - 5, mu.y + 5);
    ctx.stroke();
  }
  ctx.textBaseline = 'alphabetic';
}

// --- 主渲染循环 ---
// ★ try/finally：任何一帧抛错（比如某处 state 字段暂时为空）都不能中断循环，
// 否则动画/倒计时/emoji 渲染会永久冻结。catch 后照常 requestAnimationFrame。
function render() {
  try {
    const w = SCREEN_W;
    const h = SCREEN_H;

    // 清屏
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (state.scene === 'playing') {
      renderPlaying();
    } else if (state.scene === 'result') {
      renderResult();
    }

    // ★ 音乐按钮所有场景都可点（原来只在 playing 场景绘制和热区）
    drawMusicButton();

    // 撒花
    updateAndDrawConfetti();

    // 情绪浮动文字
    drawEmotion();

    // 成就弹窗
    drawAchievementPop();

    // 小可爱互动（关卡开始/加时成功）
    drawMascot();
  } catch (e) {
    // 单帧异常不上报（避免刷屏），只保证下一帧继续
  } finally {
    // 请求下一帧（放 finally 保证不丢帧）
    requestAnimationFrame(render);
  }
}

function renderPlaying() {
  const w = SCREEN_W;
  // 坐标全部取自统一布局（顶部避开胶囊 / 鼓励文案独立展示带 / 候选错落区）
  const cellSize = LAYOUT.idiomSize;
  const cellGap = rpx(8);
  const topY = LAYOUT.topY;
  const barY = LAYOUT.barY;
  const statY = LAYOUT.statY;
  const idiomY = LAYOUT.idiomY;

  const info = getLevelInfo();

  // 分数
  ctx.fillStyle = COLORS.primary;
  ctx.font = `bold ${rpx(14)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('得分', rpx(16), topY + rpx(14));
  ctx.font = `bold ${rpx(22)}px sans-serif`;
  ctx.fillText(state.score, rpx(16), topY + rpx(40));

  // 计时器（当前关剩余时间，答完 5 题重置）
  ctx.fillStyle = state.timeLeft <= 10 ? COLORS.primary : COLORS.secondary;
  ctx.font = `bold ${rpx(18)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(`⏱ ${state.timeLeft}s`, w - rpx(16), topY + rpx(22));

  // 看广告加时按钮：已移入底部按钮行（提示|跳过|加时 同排），不再悬浮在顶部

  // 当前关卡（顶部居中）+ 游戏名「补一字」（★ 10-15 加：小游戏备案要求截图内可见小游戏名字）
  ctx.fillStyle = COLORS.text;
  ctx.font = `bold ${rpx(16)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`补一字 · 第${info.lv}关 ${info.name}`, w / 2, topY + rpx(20));

  // 进度条（本关内进度：答对 n/5）
  const barW = w - rpx(32);
  const progress = info.solvedInLevel / info.questions;
  ctx.fillStyle = COLORS.lightGray;
  roundRect(ctx, rpx(16), barY, barW, rpx(4), rpx(2));
  ctx.fill();
  ctx.fillStyle = COLORS.secondary;
  roundRect(ctx, rpx(16), barY, barW * progress, rpx(4), rpx(2));
  ctx.fill();

  // 统计行：本关进度 | 连击胶囊（恒显，替代原顶部徽章，不与右侧按钮抢位）| 剩余提示
  ctx.font = `${rpx(11)}px sans-serif`;
  ctx.fillStyle = COLORS.darkGray;
  ctx.textAlign = 'left';
  ctx.fillText(`本关 ${info.solvedInLevel}/${info.questions} 题`, rpx(16), statY);

  let badgeColor = COLORS.lightGray;
  if (state.combo >= 5) badgeColor = COLORS.gold;
  else if (state.combo >= 3) badgeColor = COLORS.secondary;
  else if (state.combo >= 2) badgeColor = COLORS.darkGray;
  const badgeText = `🔥 连击 ${state.combo}`;
  ctx.font = `bold ${rpx(11)}px sans-serif`;
  const badgeW = ctx.measureText(badgeText).width + rpx(16);
  ctx.fillStyle = badgeColor;
  roundRect(ctx, w/2 - badgeW/2, statY - rpx(14), badgeW, rpx(20), rpx(10));
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, w/2, statY - rpx(4));
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = COLORS.darkGray;
  ctx.font = `${rpx(11)}px sans-serif`;
  ctx.textAlign = 'right';
  const hintStat = state.hintsLeft > 0 ? `×${state.hintsLeft}` : '可免费补';
  ctx.fillText(`💡 提示 ${hintStat}`, w - rpx(16), statY);

  // 成语格子
  const idiom = state.currentIdiom;
  if (idiom) {
    const idiomW = cellSize * 4 + cellGap * 3;
    const idiomX = (w - idiomW) / 2;
    const isOnFire = state.combo >= 3;

    for (let i = 0; i < 4; i++) {
      const cx = idiomX + i * (cellSize + cellGap);
      const cy = idiomY;
      const blankIdx = state.blanks.indexOf(i);
      const anim = state.cellAnims[blankIdx];
      const now = Date.now();

      if (blankIdx === -1) {
        // 已知字
        ctx.fillStyle = COLORS.success;
        roundRect(ctx, cx, cy, cellSize, cellSize, rpx(12));
        ctx.fill();
        if (isOnFire) {
          ctx.strokeStyle = COLORS.gold;
          ctx.lineWidth = 2;
          roundRect(ctx, cx, cy, cellSize, cellSize, rpx(12));
          ctx.stroke();
        }
        ctx.fillStyle = COLORS.white;
        ctx.font = `bold ${rpx(28)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(idiom[i], cx + cellSize/2, cy + cellSize/2);
      } else {
        // 空格
        const filled = state.filledBlanks[blankIdx];
        if (filled) {
          ctx.fillStyle = COLORS.secondary;
          roundRect(ctx, cx, cy, cellSize, cellSize, rpx(12));
          ctx.fill();
          ctx.fillStyle = COLORS.white;
          ctx.font = `bold ${rpx(28)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(filled.char, cx + cellSize/2, cy + cellSize/2);
        } else {
          // 空格虚线效果（Canvas 用虚线）
          ctx.fillStyle = COLORS.white;
          roundRect(ctx, cx, cy, cellSize, cellSize, rpx(12));
          ctx.fill();
          ctx.strokeStyle = COLORS.gray;
          ctx.lineWidth = 1;
          ctx.setLineDash([rpx(6), rpx(4)]);
          roundRect(ctx, cx, cy, cellSize, cellSize, rpx(12));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = COLORS.gray;
          ctx.font = `bold ${rpx(28)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', cx + cellSize/2, cy + cellSize/2);
        }

        // 动画效果
        if (anim) {
          const elapsed = (now - anim.time) / 1000;
          if (elapsed < 0.4) {
            const opacity = 1 - elapsed / 0.4;
            ctx.fillStyle = anim.type === 'correct'
              ? `rgba(46, 204, 113, ${opacity * 0.3})`
              : `rgba(231, 76, 60, ${opacity * 0.3})`;
            roundRect(ctx, cx, cy, cellSize, cellSize, rpx(12));
            ctx.fill();
          }
        }
      }
    }

    // 候选字（错落随机布局：横向铺满利用左右留白，纵向双排交错 + 随机旋转/缩放）
    const usedIndices = new Set(state.filledBlanks.filter(f => f).map(f => f.candIdx));

    for (let i = 0; i < state.candidates.length; i++) {
      const pos = state.candidateLayout[i];
      if (!pos) continue;
      const ch = state.candidates[i];
      const isUsed = usedIndices.has(i);

      ctx.save();
      ctx.globalAlpha = isUsed ? 0.25 : 1;
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.rot);
      ctx.scale(pos.scale, pos.scale);
      const s = pos.size;

      ctx.fillStyle = COLORS.white;
      roundRect(ctx, -s/2, -s/2, s, s, rpx(10));
      ctx.fill();
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      roundRect(ctx, -s/2, -s/2, s, s, rpx(10));
      ctx.stroke();

      ctx.fillStyle = COLORS.text;
      ctx.font = `bold ${rpx(22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 释义卡（答对后 3.2s 内展示，答错不显示）：紧贴成语格下方，两行折行
    drawExplain();

    // 按钮行：三按钮同源坐标（与 buildTouchZones 完全一致）
    const btnY = LAYOUT.btnY;
    const btnH = LAYOUT.btnH;
    const rowW = rpx(100) + rpx(100) + rpx(88) + rpx(12) * 2;
    const rowX = (w - rowW) / 2;

    // 提示按钮两态：有次数 / 用完可免费续补（V1.0：无广告版，直接续补；V1.1 接流量主后改为看广告补）
    const hintBtnText = state.hintsLeft > 0 ? `💡提示 ×${state.hintsLeft}` : '▶+3';
    ctx.fillStyle = COLORS.secondary;
    roundRect(ctx, rowX, btnY, rpx(100), btnH, rpx(8));
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.font = `bold ${rpx(12)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hintBtnText, rowX + rpx(50), btnY + btnH/2);

    // 跳过按钮
    const skipX = rowX + rpx(100) + rpx(12);
    ctx.fillStyle = '#95a5a6';
    roundRect(ctx, skipX, btnY, rpx(100), btnH, rpx(8));
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.fillText('跳过', skipX + rpx(50), btnY + btnH/2);

    // 看广告加时按钮（第三位）
    const at = touchZones.btnAddTime;
    // 按下强反馈：0.8s 内按钮弹一下（sin 脉冲），并在按钮上方浮出「+10s 已到账」
    let fxP = 1;
    if (state.addTimeFx) {
      fxP = (Date.now() - state.addTimeFx) / 800;
      if (fxP >= 1) { fxP = 1; state.addTimeFx = 0; }
    }
    const atScale = fxP < 1 ? 1 + 0.08 * Math.sin(Math.PI * fxP) : 1;
    ctx.save();
    ctx.translate(at.x + at.w / 2, at.y + at.h / 2);
    ctx.scale(atScale, atScale);
    ctx.translate(-(at.x + at.w / 2), -(at.y + at.h / 2));
    ctx.fillStyle = state.adTimeUses > 0 ? COLORS.secondary : COLORS.gray;
    roundRect(ctx, at.x, at.y, at.w, at.h, rpx(8));
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`▶+10s ×${state.adTimeUses}`, at.x + at.w / 2, at.y + at.h / 2);
    ctx.restore();
    if (fxP < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - fxP;
      ctx.fillStyle = COLORS.gold;
      ctx.font = `bold ${rpx(15)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+10s 已到账', at.x + at.w / 2, at.y - rpx(10) - fxP * rpx(16));
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';

    // 下一关信息（按黄总要求放到提示/跳过按钮下方）
    const nlv = info.lv + 1;
    ctx.fillStyle = COLORS.darkGray;
    ctx.font = `${rpx(10)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`下一关：第${nlv}关 ${levelNameOf(nlv)} · ${questionsOf(nlv)}题 · 限时${levelTimeOf(nlv)}s`, w/2, LAYOUT.nextLvTextY);

    // 音乐按钮已在 render() 顶层统一绘制（playing 与 result 共用 drawMusicButton()），此处不再重复调用

    // 底部分享引导区（原广告位占位；V1.0 无广告版改为品牌标语）
    // ★ 10-15 第七轮修：原文案「喜欢就分享给朋友，一起挑战成语」属 UI 诱导分享，
    //   微信小游戏审核（及真机分享拦截）对此敏感，与"分享成绩被拦"直接相关。改成中性产品标语。
    const adY = LAYOUT.adY;
    ctx.fillStyle = '#f4f6f8';
    roundRect(ctx, rpx(16), adY, w - rpx(32), rpx(24), rpx(4));
    ctx.fill();
    ctx.fillStyle = '#9aa4ad';
    ctx.font = `${rpx(10)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('补一字 · 每天几分钟，轻松学成语', w/2, adY + rpx(12));
  }

  ctx.textBaseline = 'alphabetic';
}

function renderResult() {
  const w = SCREEN_W;
  const h = SCREEN_H;

  // 半透明遮罩（通透版：0.75 → 0.45，背后游戏画面隐约可见，文字与按钮对比度仍充足）
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, h);

  // 卡片（位置与高度都取自 LAYOUT，与按钮同源；半透明白 0.92 保证卡内文字清晰）
  const cardW = w * 0.8;
  const cardH = LAYOUT.resultCardH;
  const cardX = (w - cardW) / 2;
  const cardY = LAYOUT.resultCardY;

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, cardX, cardY, cardW, cardH, rpx(16));
  ctx.fill();

  const rank = getRank(state.score, state.solvedCount);
  const cy = cardY + rpx(36);

  // 游戏名（★ 10-15 加：备案截图需可见小游戏名字，结算页也带上）
  ctx.fillStyle = COLORS.darkGray;
  ctx.font = `bold ${rpx(11)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('补一字', w/2, cy + rpx(6));

  ctx.fillStyle = COLORS.primary;
  ctx.font = `bold ${rpx(20)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(rank.title, w/2, cy + rpx(28));

  ctx.fillStyle = COLORS.secondary;
  ctx.font = `${rpx(13)}px sans-serif`;
  ctx.fillText(rank.text, w/2, cy + rpx(46));

  ctx.fillStyle = COLORS.primary;
  ctx.font = `bold ${rpx(40)}px sans-serif`;
  ctx.fillText(state.score, w/2, cy + rpx(102));

  ctx.fillStyle = COLORS.darkGray;
  ctx.font = `${rpx(12)}px sans-serif`;
  ctx.fillText(`答对成语：${state.solvedCount} 个`, w/2, cy + rpx(140));
  ctx.fillText(`最高连击：${state.maxCombo} 连`, w/2, cy + rpx(162));
  ctx.fillText(`解锁成就：${state.unlockedAchievements.size} / ${ACHIEVEMENTS.length}`, w/2, cy + rpx(184));

  // 复活按钮（revivedThisGame=true 时热区已被 buildResultPanel 置 null，此处防御性再判一次）
  if (!state.revivedThisGame && touchZones.btnRevive) {
    ctx.fillStyle = COLORS.secondary;
    roundRect(ctx, touchZones.btnRevive.x, touchZones.btnRevive.y, touchZones.btnRevive.w, touchZones.btnRevive.h, rpx(8));
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.font = `bold ${rpx(15)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('复活 (+30s)', w/2, touchZones.btnRevive.y + touchZones.btnRevive.h/2);
  }

  // 再来一局（从存档进度继续）
  ctx.fillStyle = COLORS.primary;
  roundRect(ctx, touchZones.btnRestart.x, touchZones.btnRestart.y, touchZones.btnRestart.w, touchZones.btnRestart.h, rpx(8));
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.font = `bold ${rpx(15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const continueLv = levelOfCount(state.solvedCount);
  ctx.fillText(state.solvedCount > 0 ? `继续挑战（第${continueLv}关）` : '再来一局', w/2, touchZones.btnRestart.y + touchZones.btnRestart.h/2);

  // 分享
  ctx.fillStyle = COLORS.success;
  roundRect(ctx, touchZones.btnShare.x, touchZones.btnShare.y, touchZones.btnShare.w, touchZones.btnShare.h, rpx(8));
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.fillText('分享成绩', w/2, touchZones.btnShare.y + touchZones.btnShare.h/2);

  // 清除进度（回到第 1 关重新开始）
  ctx.fillStyle = '#95a5a6';
  roundRect(ctx, touchZones.btnClear.x, touchZones.btnClear.y, touchZones.btnClear.w, touchZones.btnClear.h, rpx(8));
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.font = `bold ${rpx(13)}px sans-serif`;
  ctx.fillText('🗑 清除进度，从第 1 关开始', w/2, touchZones.btnClear.y + touchZones.btnClear.h/2);

  ctx.textBaseline = 'alphabetic';
}

function updateAndDrawConfetti() {
  for (let i = state.confettiList.length - 1; i >= 0; i--) {
    const c = state.confettiList[i];
    c.life++;
    // 左右摇摆（正弦）+ 恒定下落 + 自转
    c.x += Math.sin(c.life * c.swayFreq + c.swayPhase) * c.swayAmp;
    c.y += c.vy;
    c.rot += c.spin;

    // 尾段（近屏底 20%）淡出，落到底前就优雅退场，不再硬消失
    const fadeStart = SCREEN_H * 0.8;
    const alpha = c.y > fadeStart ? Math.max(0, 1 - (c.y - fadeStart) / (SCREEN_H * 0.2)) : 1;

    if (c.y > SCREEN_H || alpha <= 0) {
      state.confettiList.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    if (c.shape === 'rect') {
      // 圆角小方片（用项目自写 roundRect，兼容老基础库，不用原生 ctx.roundRect）
      const s = c.size;
      roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.25);
      ctx.fill();
      // 上面叠一道高光，制造「纸片翻面」的立体感
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-s / 2, -s / 2, s, s * 0.35);
    } else if (c.shape === 'strip') {
      // 细长彩带条（宽:高 = 1:3）
      const s = c.size;
      ctx.fillRect(-s / 3, -s * 1.5, s * 0.66, s * 3);
    } else {
      // 圆点
      ctx.beginPath();
      ctx.arc(0, 0, c.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 金色闪光款：中心叠一个白色小星点，随闪烁
    if (c.sparkle && c.life % 20 < 10) {
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, c.size * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

const EMOTION_MS = 1800; // 鼓励文案寿命（被释义卡让位的时长不计入，释放后再补足）
function drawEmotion() {
  if (!state.emotionText) return;
  // 只有几何上真的压到释义卡时才让位（矮屏兜底会把 emotionY 上压）；
  // 正常布局 emotionY 在释义卡下方 rpx(4)，两者可并行显示。
  // ★P1 修复：原来「只要有释义卡就早退」会导致 89.5% 的答对（释义覆盖 18090/20207）
  //   鼓励文案全程不显示也不清理 —— 连击夸奖/手速提示/开门红全部哑掉。
  if (state.explainText && LAYOUT.emotionY < LAYOUT.explainY + LAYOUT.explainH) return;
  const elapsed = (Date.now() - state.emotionTime) / 1000;
  if (elapsed > EMOTION_MS / 1000) {
    state.emotionText = '';
    return;
  }

  let alpha = 1;
  let scale = 1;
  let offsetY = 0;

  if (elapsed < 0.2) {
    scale = 0.3 + (elapsed / 0.2) * 0.85;
    alpha = elapsed / 0.2;
  } else if (elapsed < 0.4) {
    scale = 1.15 - (elapsed - 0.2) / 0.2 * 0.15;
    alpha = 1;
  } else if (elapsed > 1.4) {
    alpha = 1 - (elapsed - 1.4) / 0.4;
    offsetY = -(elapsed - 1.4) / 0.4 * 30;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = state.emotionColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 长文案自动折行：先按 36 号折，超过 2 行降为 28 号重折（中文逐字断行）
  const maxWidth = SCREEN_W - rpx(32);
  let fontSize = rpx(36) * scale;
  ctx.font = `bold ${fontSize}px sans-serif`;
  let lines = wrapText(state.emotionText, maxWidth);
  if (lines.length > 2) {
    fontSize = rpx(28) * scale;
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = wrapText(state.emotionText, maxWidth);
  }

  // 多行围绕 emotionY 垂直居中展开，随动画一起上浮
  const lineHeight = fontSize * 1.25;
  const startY = LAYOUT.emotionY + offsetY - (lines.length - 1) * lineHeight / 2;
  lines.forEach((ln, i) => {
    ctx.fillText(ln, SCREEN_W / 2, startY + i * lineHeight);
  });
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

// 逐字符折行（依赖当前 ctx.font，须先设 font 再调用）
function wrapText(text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --- 释义卡（答对后展示；答错不显示）---
const EXPLAIN_DURATION = 3200; // 展示 3.2s，跨下一题供玩家阅读
function drawExplain() {
  if (!state.explainText) return;
  const elapsed = Date.now() - state.explainTime;
  if (elapsed > EXPLAIN_DURATION) {
    state.explainText = '';
    // 释义卡占位期间鼓励文案被让位，到这里释放：把计时回拨到「还剩至少 1.3s」，
    // 保证被让位的连击夸奖 / 手速提示一定能被玩家看到（P1 修复）
    if (state.emotionText) {
      const remain = state.emotionTime + EMOTION_MS - Date.now();
      state.emotionTime = Date.now() - (EMOTION_MS - Math.max(1300, remain));
    }
    return;
  }
  // 淡入淡出
  let alpha = 1;
  if (elapsed < 150) alpha = elapsed / 150;
  else if (elapsed > EXPLAIN_DURATION - 400) alpha = Math.max(0, (EXPLAIN_DURATION - elapsed) / 400);

  const exY = LAYOUT.explainY;
  const exH = LAYOUT.explainH;
  const exW = SCREEN_W - rpx(32);
  const exX = rpx(16);

  ctx.save();
  ctx.globalAlpha = alpha;
  // 半透明米白卡片（与整体古风底色协调，文字保持深色高对比）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  roundRect(ctx, exX, exY, exW, exH, rpx(10));
  ctx.fill();
  ctx.strokeStyle = 'rgba(243, 156, 18, 0.35)'; // 淡金描边：暗示「答对了才出现」
  ctx.lineWidth = 1;
  roundRect(ctx, exX, exY, exW, exH, rpx(10));
  ctx.stroke();

  // 文案折行：先 13 号折，超 2 行降为 11 号重折
  const padX = rpx(12);
  const maxWidth = exW - padX * 2;
  const centerX = exX + exW / 2;
  ctx.textAlign = 'center';
  let fontSize = rpx(13);
  ctx.font = `${fontSize}px sans-serif`;
  let lines = wrapText(state.explainText, maxWidth);
  if (lines.length > 2) {
    fontSize = rpx(11);
    ctx.font = `${fontSize}px sans-serif`;
    lines = wrapText(state.explainText, maxWidth);
  }
  if (lines.length > 3) lines = lines.slice(0, 3); // 极端兜底：绝不溢出卡片
  const lineHeight = fontSize * 1.35;
  const startY = exY + exH / 2 - (lines.length - 1) * lineHeight / 2 + fontSize * 0.1;
  ctx.fillStyle = COLORS.text;
  ctx.textBaseline = 'middle';
  lines.forEach((ln, i) => ctx.fillText(ln, centerX, startY + i * lineHeight));
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

// --- 小可爱吉祥物绘制（左下角圆形头像 + 气泡台词）---
function drawMascot() {
  if (!state.mascot) return;
  const m = state.mascot;
  const elapsed = (Date.now() - m.time) / 1000;
  if (elapsed > MASCOT_DURATION / 1000) {
    state.mascot = null;
    return;
  }
  // 弹入弹出动画：0~0.25s 缩放弹入，最后 0.3s 淡出
  let scale = 1, alpha = 1;
  if (elapsed < 0.25) scale = 0.3 + (elapsed / 0.25) * 0.7;
  if (elapsed > (MASCOT_DURATION / 1000) - 0.3) alpha = Math.max(0, ((MASCOT_DURATION / 1000) - elapsed) / 0.3);

  const size = rpx(84);                 // 圆形头像直径
  // 位置：玩家拖过的位置优先，否则默认左下（按钮行上方，不遮挡提示按钮）
  if (!state.mascotPos) state.mascotPos = mascotHomePos(size);
  const mx = state.mascotPos.x;
  const my = state.mascotPos.y;

  ctx.save();
  ctx.globalAlpha = alpha;

  // 头像：圆形裁剪 + 描边
  const img = MASCOT_IMGS[m.idx];
  ctx.beginPath();
  ctx.arc(mx + size / 2, my + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  if (img && img.width > 0) {
    // 图片已按 alpha bbox 裁过，等比铺满圆形
    ctx.drawImage(img, mx, my, size, size);
  } else {
    ctx.fillStyle = '#ffd9e0';
    ctx.fillRect(mx, my, size, size);
  }
  ctx.restore();
  // 拖动中高亮描边（提示可拖）
  ctx.strokeStyle = state.mascotDrag ? 'rgba(243,156,18,0.9)' : 'rgba(255,255,255,0.9)';
  ctx.lineWidth = state.mascotDrag ? rpx(4) : rpx(3);
  ctx.beginPath();
  ctx.arc(mx + size / 2, my + size / 2, size / 2, 0, Math.PI * 2);
  ctx.stroke();

  // 气泡（默认在头像右侧；靠右屏时翻到头像左侧；随 scale 弹入）
  const bubH = rpx(76);
  const bubW = Math.min(rpx(230), SCREEN_W - rpx(120));
  const bubbleFits = mx + size + rpx(8) + bubW <= SCREEN_W - rpx(6);
  const bubX = bubbleFits ? mx + size + rpx(8) : Math.max(rpx(6), mx - rpx(8) - bubW);
  const bubY = clamp(my - rpx(4), LAYOUT.topY + rpx(50), SCREEN_H - SAFE_BOTTOM - bubH - rpx(6));
  ctx.save();
  ctx.translate(bubX + bubW / 2, bubY + bubH / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(bubX + bubW / 2), -(bubY + bubH / 2));
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, bubX, bubY, bubW, bubH, rpx(12));
  ctx.fill();
  // 气泡指向头像的小三角（右侧气泡尖朝左，左侧气泡尖朝右）
  const tipBase = bubbleFits ? bubX + 1 : bubX + bubW - 1;
  const tipApex = bubbleFits ? bubX - rpx(8) : bubX + bubW + rpx(8);
  ctx.beginPath();
  ctx.moveTo(tipBase, bubY + bubH / 2 - rpx(6));
  ctx.lineTo(tipApex, bubY + bubH / 2);
  ctx.lineTo(tipBase, bubY + bubH / 2 + rpx(6));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(243,156,18,0.5)';
  ctx.lineWidth = 1;
  roundRect(ctx, bubX, bubY, bubW, bubH, rpx(12));
  ctx.stroke();

  // 台词折行（最多 2 行，超长降字号）
  const textMax = bubW - rpx(20);
  ctx.font = `${rpx(12)}px sans-serif`;
  let lines = wrapText(m.text, textMax);
  if (lines.length > 2) {
    ctx.font = `${rpx(10)}px sans-serif`;
    lines = wrapText(m.text, textMax);
  }
  if (lines.length > 3) lines = lines.slice(0, 3);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = parseFloat(ctx.font);
  const lh = rpx(16);
  const startY = bubY + bubH / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, bubX + bubW / 2, startY + i * lh));
  ctx.restore();
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
}

function drawAchievementPop() {
  // ★ 队列版：多个成就依次播放，不再互相覆盖。
  // 先清过期（每个 2.5s），再从队头取当前显示。
  const q = state.achievementQueue;
  while (q.length && (Date.now() - q[0].time) > 2500) q.shift();
  if (!q.length) return;
  const pop = q[0];
  const elapsed = (Date.now() - pop.time) / 1000;

  let offsetX = 0;
  if (elapsed < 0.4) {
    offsetX = (1 - elapsed / 0.4) * SCREEN_W * 0.3;
  } else if (elapsed > 2.1) {
    offsetX = (elapsed - 2.1) / 0.4 * SCREEN_W * 0.3;
  }

  const boxW = rpx(180);
  const boxH = rpx(50);
  const boxX = SCREEN_W - boxW - rpx(10) + offsetX;
  const boxY = LAYOUT.topY + rpx(8); // 避开右上角胶囊按钮

  ctx.fillStyle = 'rgba(44, 62, 80, 0.88)'; // 半透明深色弹窗（原 #2c3e50 不透明）
  roundRect(ctx, boxX, boxY, boxW, boxH, rpx(10));
  ctx.fill();

  ctx.fillStyle = '#cccccc';
  ctx.font = `${rpx(10)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // 队里有多个成就时提示「还有 N 个」，比固定显示 "1/N" 更准确（shift 后 index 会变）
  const suffix = q.length > 1 ? ` (还有 ${q.length - 1} 个)` : '';
  ctx.fillText('解锁成就' + suffix, boxX + rpx(12), boxY + rpx(15));

  ctx.fillStyle = COLORS.gold;
  ctx.font = `bold ${rpx(14)}px sans-serif`;
  ctx.fillText(pop.name, boxX + rpx(12), boxY + rpx(34));
  ctx.textBaseline = 'alphabetic';
}

// --- 启动 ---
buildLayout();
buildTouchZones();
AudioSys.init(); // BGM（失败静默，不影响游戏）
startGame();
render();

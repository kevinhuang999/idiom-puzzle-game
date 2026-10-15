// ============================================================
// platform.js · HarmonyOS 适配层（基础库 3.7.0+）
// 来源：微信官方《鸿蒙 OS 适配指南》
//   - 小游戏在鸿蒙上 JS 运行于 v8，运行/更新机制与安卓一致
//   - 判断：wx.getDeviceInfo().platform === 'ohos' | 'ohos_pc'
//   - 开发者工具模拟鸿蒙时 platform 为 'devtools'，改用 system 判断
//   - 暂不支持：广告 / 录音 / 相机 / 视频解码 / 手柄 / 陀螺仪 / 对局回放等
// ============================================================

(function () {
  // --- 1. 安全获取设备信息（低版本基础库无 getDeviceInfo，全部 try/catch 兜底）---
  var sysInfo = {
    screenWidth: 375,
    screenHeight: 667,
    pixelRatio: 2,
    statusBarHeight: 20,
    platform: '',
    system: '',
  };

  try {
    var s = wx.getSystemInfoSync();
    if (s) {
      if (s.screenWidth) sysInfo.screenWidth = s.screenWidth;
      if (s.screenHeight) sysInfo.screenHeight = s.screenHeight;
      if (s.pixelRatio) sysInfo.pixelRatio = s.pixelRatio;
      if (s.statusBarHeight) sysInfo.statusBarHeight = s.statusBarHeight;
      if (s.platform) sysInfo.platform = s.platform;
      if (s.system) sysInfo.system = s.system;
      if (s.safeArea) sysInfo.safeArea = s.safeArea;
    }
  } catch (e) { /* 接口异常时用默认值，游戏不崩 */ }

  try {
    var d = wx.getDeviceInfo && wx.getDeviceInfo();
    if (d) {
      if (d.platform) sysInfo.platform = d.platform;
      if (d.system) sysInfo.system = d.system;
      if (d.brand) sysInfo.brand = d.brand;
    }
  } catch (e) { /* 低版本基础库忽略 */ }

  // --- 2. 平台判断 ---
  function isOhos() {
    var p = sysInfo.platform;
    if (p === 'ohos' || p === 'ohos_pc') return true;      // 真机纯血鸿蒙
    if (String(sysInfo.system).indexOf('HarmonyOS') >= 0) return true; // 工具模拟鸿蒙
    return false;
  }

  var OHOS = isOhos();

  // --- 3. 底部安全区 ---
  // ★ 优先用 sysInfo.safeArea：涵盖 iOS 全面屏 Home Indicator、鸿蒙手势条、安卓部分机型虚拟导航栏。
  // 计算方式：screenHeight - safeArea.bottom（safeArea.bottom 是安全区底部，越小 = 底部有越大的安全区）。
  // 兜底：无 safeArea（低版本基础库）时鸿蒙按 24dp、其他 0。
  var safeBottom = 0;
  if (sysInfo.safeArea && typeof sysInfo.safeArea.bottom === 'number') {
    safeBottom = Math.max(0, sysInfo.screenHeight - sysInfo.safeArea.bottom);
  }
  if (safeBottom === 0 && OHOS) safeBottom = 24;

  // --- 4. 分享安全包装（鸿蒙"转发"为部分支持，失败不中断游戏）---
  function safeShareAppMessage(opts) {
    try {
      wx.shareAppMessage(opts);
      return true;
    } catch (e) {
      console.log('[platform] 分享不可用', e);
      return false;
    }
  }

  // --- 5. 广告可用性（★鸿蒙小游戏暂不支持广告，接广告前必须判断）---
  function canUseRewardedAd() {
    try {
      if (!wx.createRewardedVideoAd) return false;
      if (wx.canIUse && !wx.canIUse('createRewardedVideoAd')) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function canUseInterstitialAd() {
    try {
      if (!wx.createInterstitialAd) return false;
      if (wx.canIUse && !wx.canIUse('createInterstitialAd')) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // --- 6. 调试输出（真机验证时看 console 用）---
  console.log('[platform] platform=' + sysInfo.platform +
    ' system=' + sysInfo.system +
    ' ohos=' + OHOS +
    ' safeBottom=' + safeBottom +
    ' rewardedAd=' + canUseRewardedAd());

  module.exports = {
    sysInfo: sysInfo,
    isOhos: OHOS,
    safeBottom: safeBottom,
    safeShareAppMessage: safeShareAppMessage,
    canUseRewardedAd: canUseRewardedAd,
    canUseInterstitialAd: canUseInterstitialAd,
  };
})();

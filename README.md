# 成语消消乐 · 补一字

[中文](#中文) | [English](#english)

---

<a id="中文"></a>
# 中文

> **一句话结论**：成语消除类微信小游戏「补一字」——给缺字的成语填空补字，难度随关卡递增；小程序账号已于 2026-10-15 注销，本项目仅作**源码存档与学习参考**，无法在微信平台继续上架分发。

## 项目状态

- **已结项（2026-10-15）**：微信小游戏账号已注销，无法在微信平台预览、上架或分发。
- 代码完整保留，可用**微信开发者工具**导入 `wx-minigame/` 目录做本地预览与学习。
- 备案截图与无头截图工具链一并归档于 `regression/shots/` 与 `regression/`。

## 玩法

给一个缺 1~3 个字的成语（如「随声附?」），从候选字（含形近字干扰）中选出正确字补上。连续答对积累连击，累计答对与得分决定称号。

| 系统 | 说明 |
|---|---|
| 填空补字 | 每关缺字 1~3 个，候选含相似形近字干扰 |
| 连击 | 连续答对累积 combo，提升称号 |
| 成就 | 7 项成就（初战告捷 / 三连之力 / 五连神迹 / 十连封神 / 闪电侠 / 博古通今 / 分数过五百） |
| 称号 / 计分 | 按累计答对与单局得分评定称号 |
| 限时 | 每关限时随关卡动态变化 |

难度曲线（v5，含 `questionsOf` / `levelTimeOf` / `blanksOf` / `tierSource` / `getSimilarChars` 五参数联动）详见 `wx-minigame/README.md`。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行平台 | 微信小游戏（原生，无游戏引擎） |
| 渲染 | Canvas 2D（自绘 UI，无第三方 UI 框架） |
| 逻辑语言 | JavaScript（ES5 兼容，适配小游戏运行时） |
| 音频 | WebAudio（程序化音效，无音频文件依赖） |
| 题库 | 内置 JS 数据（idioms.js / idioms_meaning.js） |
| 工具链 | Node.js + headless Chrome（无头截图与探针自测） |

## 目录结构

```
idiom-puzzle-game/
├── wx-minigame/              # 微信小游戏源码（微信开发者工具导入此目录）
│   ├── canvas.js             # 主游戏逻辑 + Canvas 渲染
│   ├── idioms.js             # 成语题库
│   ├── idioms_meaning.js     # 成语释义库
│   ├── platform.js           # 平台适配（wx API 封装）
│   ├── audio.js              # 音效（WebAudio）
│   ├── project.config.json   # 小游戏工程配置
│   └── README.md             # 难度曲线 v5 等细节
├── regression/               # 无头截图 + 探针工具链（不上传小游戏包）
│   ├── _probe_p1.js          # 37 项自测探针（全绿）
│   ├── _gen_shot_html.js     # 生成无头截图 HTML
│   └── shots/                # 备案截图产物
├── index.html                # 布局预览（开发期用）
├── gen_icon.py               # 图标生成脚本
└── A_tianzige_*.png          # 田字格图标素材
```

## 运行（本地预览）

用**微信开发者工具**导入 `wx-minigame/` 目录即可本地预览与调试（无需账号也可在开发者工具内运行）。

```bash
# 微信开发者工具 → 导入项目 → 选择 wx-minigame/ 目录
```

> 注：因账号已注销，无法上传或真机预览，仅限开发者工具内运行。

## 自测

```bash
node regression/_probe_p1.js     # 37 项探针，全绿
```

无头截图（生成备案用图，需本机 Chrome）：

```bash
node regression/_gen_shot_html.js
# 再用 headless Chrome 打开 regression/_shot.html?scene=playing&ach=first_blood 截图
```

## 许可

源码仅供个人学习与技术参考。任何商业用途（含二次上架、改作牟利）需先取得作者授权。

---

<a id="english"></a>
# English

> **One-line summary**: "Bu Yi Zi" is an idiom-fill-in WeChat mini-game (native Canvas 2D, no engine). The mini-game account was closed on 2026-10-15, so this repo is **source-code archival / learning reference only** — it can no longer be published on WeChat.

Import `wx-minigame/` into WeChat DevTools for local preview. See the Chinese section above for gameplay, tech stack, and self-test details.

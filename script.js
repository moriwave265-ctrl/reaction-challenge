// 通用反应挑战 · 本地增强版（纯 HTML + Vanilla JS，零构建零依赖）
//
// ===== 文件结构 =====
//   index.html  页面骨架（难度/设置/训练/奖励/结束 5 页 + 年龄门）
//   style.css   全部样式（含全屏沉浸 ui-idle、双视频层淡入）
//   script.js   本文件：全部逻辑（分区见下）
//   tools/      构建与测试（tools/README.md）
//   media/      本地素材（gitignore，不入库）
//
// ===== script.js 分区（自上而下） =====
//   1. 配置与常量   mediaConfig / DEFAULT_LIBRARY / KEYS
//   2. 指令系统     解析/渲染/难度×阶段指令池
//   3. 基础页面控制  byId / showPage / rAF+watchdog 主循环
//   4. 持久化设置   timing 对象 + applyTiming 派生常量
//   5. 媒体池       发现（内嵌清单/manifest/目录句柄）+ blob URL 登记
//   6. 背景轮播     双缓冲视频 + 图片定时
//   7. 结果与奖励   连播/预加载/随机起点/速度/音量
//   8. 会话主循环   animate / 暂停（时间戳平移）/ 跨轮统计
//   9. 事件绑定     按钮与快捷键
//  10. 设置页       时长/玩法/自定义指令读写
//  11. 媒体目录     showDirectoryPicker + IndexedDB 记住句柄
//  12. 年龄门 + boot
//
// ===== 不变式（改动前必读） =====
//   · timing 是唯一设置来源；改它后必须 applyTiming() + saveTimingLocal()
//   · 暂停靠时间戳平移实现（togglePause），新增计时字段要同步平移
//   · 结算条件是 endsAt 与 taskEndsAt 双到点（见 animate）

let SUCCESS_CHANCE = 0.7;   // 训练结束后进入奖励阶段的概率（可由「玩法设置」调整）
const rewardConfig = {
    title: "恭喜你获得了射精的机会🥵",
    task: "请你在进度条结束前射出💦",
    durationSeconds: 10,
    completedTitle: "恭喜你挑战成功",
    completedMessage: "快来开启你的下一轮挑战吧"
};

// ===== 媒体激励配置 =====
const mediaConfig = {
    enabled: true,          // 总开关；false 则退回纯文字奖励
    preferVideo: true,      // 池子里同时有图有视频时，优先抽视频
    tickSound: true,        // 任务/奖励最后 3 秒滴答声
    keepAwake: true,        // 挑战期间屏幕常亮（Wake Lock，需 https 或 localhost）
    fullscreenOnStart: true,// 点"开始"进入全屏（浏览器拒绝则自动忽略）
    urls: []                // 可选：手动填素材 URL，如 "https://example.com/a.mp4"
};
const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp"];
const videoExts = [".mp4", ".webm", ".mov", ".m4v", ".ogv"];

// ---------- 本地存储键名（集中管理；改名 = 老用户本地数据丢失，慎重） ----------
const KEYS = Object.freeze({
    timing: "cwm-timing-v1",            // 媒体时长 + 玩法设置（timing 对象）
    selection: "cwm-last-selection-v1", // 上次难度/时长
    stats: "cwm-total-stats-v1",        // 跨轮累计统计
    tasks: "cwm-custom-tasks-v1",       // 自定义指令库
    age: "cwm-age-verified-v1",         // 年龄门已确认
    taskCardPos: "cwm-task-card-pos-v1",// 任务卡拖动位置（{game:{x,y}, reward:{x,y}}）
    mediaDirDB: "cwm-media-dir",        // IndexedDB 库名（记住素材目录句柄）
    mediaDirKey: "dirHandle"            // IndexedDB 键名
});

const DIFF_KEYS = ["Easy", "Normal", "Hard"];
const PHASE_KEYS = ["warmup", "build", "edge"];
const PHASE_LABELS = { warmup: "热身", build: "推进", edge: "高潮边缘" };
const DIFF_TAG = { Easy: "[E]", Normal: "[N]", Hard: "[H]" };
const PHASE_TAG = { warmup: "[W]", build: "[B]", edge: "[X]" };

// 默认指令库：难度(Easy温和 / Normal混合 / Hard高强度羞耻) × 阶段(热身→推进→高潮边缘)
const DEFAULT_LIBRARY = {
  Easy: {
    warmup: [
      { text: "双手抱头，现在不准碰" },
      { text: "深呼吸，放松身体" },
      { text: "闭上眼睛，感受心跳", durationSeconds: 15 },
      { text: "轻轻抚摸大腿内侧" },
      { text: "缓慢抚摸自己，不要加速" }
    ],
    build: [
      { text: "缓慢撸动，保持节奏" },
      { text: "双手捏乳头" },
      { text: "放松臀部，继续动作" },
      { text: "加快一点，找到节奏" },
      { text: "看着屏幕，深呼吸" },
      { text: "{左手|右手|双手}轻轻抚摸自己" }
    ],
    edge: [
      { text: "继续刺激，别停" },
      { text: "感受快感，深呼吸" },
      { text: "坚持住，保持这个速度" },
      { text: "慢下来，在边缘停住", durationSeconds: 10, redScreen: true },
      { text: "想象你最渴望的画面", durationSeconds: 20 },
      { text: "快到了就放慢，感受它退一点再继续" }
    ]
  },
  Normal: {
    warmup: [
      { text: "双手抱头，现在不准碰" },
      { text: "深呼吸，感受身体的反应" },
      { text: "轻抚全身，预热" },
      { text: "双腿分开站好，双手背后", durationSeconds: 15 },
      { text: "闭上眼睛，想象你想要的" }
    ],
    build: [
      { text: "快速撸动" },
      { text: "慢慢稳定的撸" },
      { text: "双手捏乳头" },
      { text: "拍打鸡巴" },
      { text: "快 {10:30} 下，慢 {3:8} 下" },
      { text: "继续上一任务，保持节奏" },
      { text: "换个姿势继续" },
      { text: "跟着画面的节奏，快 {10:20} 下，再慢 {5:8} 下" }
    ],
    edge: [
      { text: "拍打睾丸" },
      { text: "跪好，抬头看着屏幕", durationSeconds: 20 },
      { text: "摆一个你觉得最羞耻的姿势", durationSeconds: 15 },
      { text: "舔自己的肱二头肌" },
      { text: "立刻停手，把双手从鸡巴上移开", durationSeconds: 5, redScreen: true },
      { text: "倒计时结束之前不准碰自己", redScreen: true },
      { text: "大声说出来：你想要什么" },
      { text: "看着屏幕，直到倒计时结束", durationSeconds: 15 },
      { text: "{快速|缓慢|停下来}，感受自己" },
      { text: "感觉到快感的瞬间就停，手拿开，深呼吸 3 次，再慢慢继续", durationSeconds: 12, redScreen: true },
      { text: "快到了就停！拇指压住系带下方 {5:10} 秒，等感觉退下去再继续", durationSeconds: 15, redScreen: true },
      { text: "我应该让你射，还是让你憋着？先继续，答案稍后揭晓" }
    ]
  },
  Hard: {
    warmup: [
      { text: "跪好，双手背后，抬头看屏幕", durationSeconds: 15 },
      { text: "脱掉多余的衣服", durationSeconds: 10 },
      { text: "双手抱头，感受自己勃起" },
      { text: "站到镜子前，看着自己" },
      { text: "深呼吸，迎接即将到来的" }
    ],
    build: [
      { text: "快速撸动，不要停" },
      { text: "拍打鸡巴，感受疼痛" },
      { text: "边撸边捏乳头" },
      { text: "快 {20:40} 下，慢 {3:6} 下" },
      { text: "{站着|跪着|坐着}继续，不许停" },
      { text: "放慢，在快感边缘停住" },
      { text: "换个姿势继续，不许停" },
      { text: "跟着画面节奏：快 {15:30} 下，停 3 秒，再慢 {5:10} 下" }
    ],
    edge: [
      { text: "大声说出来：我想要", durationSeconds: 10 },
      { text: "摆最羞耻的姿势，保持到倒计时结束", durationSeconds: 15 },
      { text: "拍打睾丸，直到倒计时结束" },
      { text: "对着屏幕自慰，想象它在看着你" },
      { text: "立刻停手，双手抱头", durationSeconds: 5, redScreen: true },
      { text: "倒计时结束之前不准碰自己", redScreen: true },
      { text: "舔自己的肱二头肌，看着屏幕", durationSeconds: 20 },
      { text: "说出一句最下流的话", durationSeconds: 10 },
      { text: "用{左手|右手|双手}继续，直到倒计时结束" },
      { text: "{坐|跪|躺}下来，继续刺激自己" },
      { text: "到边缘就停！拇指压住系带下方 {8:12} 秒，等它退下去，再来一次", durationSeconds: 15, redScreen: true },
      { text: "我带你到边缘，一次又一次，然后让你停。你的手在颤抖，忍住", durationSeconds: 20 },
      { text: "撸到脑子放空，重复默念：边缘，不停，不射", durationSeconds: 15 },
      { text: "永远边缘，永不射——直到我说可以", durationSeconds: 10, redScreen: true },
      { text: "最后一刻——松开手，让它在没有触碰下流出来", durationSeconds: 8 },
      { text: "我应该让你射，还是让你憋着？继续，等我决定" }
    ]
  }
};

// 渲染指令中的随机占位符：
//   {a:b}   随机整数 a~b，如 快 {10:30} 下
//   {a|b|c} 随机选一个，如 {双手|单手} 捏乳头
function renderTaskText(text) {
    if (!text || (!text.includes("{"))) return text;
    return text.replace(/\{([^}]+)\}/g, (whole, inner) => {
        inner = inner.trim();
        if (/^\d+\s*:\s*\d+$/.test(inner)) {
            const [a, b] = inner.split(":").map(s => parseInt(s, 10));
            const lo = Math.min(a, b), hi = Math.max(a, b);
            if (lo === hi) return String(lo);
            return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
        }
        if (inner.includes("|")) {
            const opts = inner.split("|").map(s => s.trim()).filter(Boolean);
            if (opts.length) return opts[Math.floor(Math.random() * opts.length)];
        }
        return whole;
    });
}

// 解析自定义指令文本（每行一条）：
//   [E]/[N]/[H] 难度标记（不写=全难度）；[W]/[B]/[X] 阶段标记（不写=全阶段）；
//   ! 前缀 = 红屏警告；@秒数 后缀 = 指定时长。空行忽略。可组合如 [H][X] 大声说出来。
function parseCustomTasks(text) {
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    const lib = {};
    for (const line of lines) {
        let redScreen = false;
        let body = line;
        if (body.startsWith("!")) { redScreen = true; body = body.slice(1).trim(); }
        let durationSeconds = null;
        const m = body.match(/^(.*?)\s*@(\d+)\s*$/);
        if (m) { body = m[1].trim(); durationSeconds = parseInt(m[2], 10); }
        // 难度/阶段标记
        let diffs = DIFF_KEYS.slice();
        let phases = PHASE_KEYS.slice();
        const tagRe = /\[([ENHWBX])\]/g;
        let tag;
        while ((tag = tagRe.exec(body))) {
            const c = tag[1];
            if (c === "E") diffs = ["Easy"];
            else if (c === "N") diffs = ["Normal"];
            else if (c === "H") diffs = ["Hard"];
            else if (c === "W") phases = ["warmup"];
            else if (c === "B") phases = ["build"];
            else if (c === "X") phases = ["edge"];
        }
        body = body.replace(/\[[ENHWBX]\]/g, "").trim();
        if (!body) continue;
        const t = { text: body };
        if (redScreen) t.redScreen = true;
        if (durationSeconds && durationSeconds > 0) t.durationSeconds = durationSeconds;
        for (const d of diffs) for (const p of phases) {
            (lib[d] = lib[d] || {})[p] = (lib[d][p] || []).concat([t]);
        }
    }
    return lib;
}
function libToText(lib) {
    const seen = new Map(); // text -> {diffs, phases, redScreen, duration}
    for (const d of DIFF_KEYS) for (const p of PHASE_KEYS) {
        for (const t of (lib[d] && lib[d][p]) || []) {
            if (!seen.has(t.text)) seen.set(t.text, { diffs: new Set(), phases: new Set(), redScreen: !!t.redScreen, duration: t.durationSeconds });
            const rec = seen.get(t.text);
            rec.diffs.add(d); rec.phases.add(p);
        }
    }
    const rows = [];
    for (const [text, rec] of seen) {
        let line = "";
        if (rec.diffs.size === 1) line += DIFF_TAG[rec.diffs.values().next().value];
        if (rec.phases.size === 1) line += PHASE_TAG[rec.phases.values().next().value];
        if (rec.redScreen) line += "!";
        line += text;
        if (rec.duration) line += " @" + rec.duration;
        rows.push(line);
    }
    return rows.join("\n");
}
function tasksToText() {
    return libToText(window.__customLibrary || DEFAULT_LIBRARY);
}

// 取指定难度+阶段的指令池；该阶段空→该难度全阶段；仍空且用了自定义→回退默认库
function resolvePool(diff, phase) {
    const L = window.__customLibrary || DEFAULT_LIBRARY;
    let d = L[diff] || {};
    let p = (d[phase] || []).slice();
    if (!p.length) {
        for (const ph of PHASE_KEYS) p = p.concat(d[ph] || []);
    }
    if (!p.length && L !== DEFAULT_LIBRARY) {
        const dd = DEFAULT_LIBRARY[diff] || {};
        p = (dd[phase] || []).slice();
        if (!p.length) for (const ph of PHASE_KEYS) p = p.concat(dd[ph] || []);
    }
    return p;
}
function currentLibrary() {
    return window.__customLibrary || DEFAULT_LIBRARY;
}
function hasAnyTasks() {
    const L = currentLibrary();
    for (const d of DIFF_KEYS) for (const p of PHASE_KEYS) {
        if ((L[d] && L[d][p] && L[d][p].length)) return true;
    }
    return false;
}

const difficultyLabels = { Easy: "简单", Normal: "普通", Hard: "困难" };
const byId = id => document.getElementById(id);
const pages = ["difficulty-page", "settings-page", "game-page", "reward-page", "ending-page"];
const difficultyButtons = document.querySelectorAll("[data-difficulty]");

let selectedDifficulty = null;
let animationFrameId = null;
let session = null;
let reward = null;
let lastTasks = [];       // 最近 4 条任务文本，避免连抽重复
let mediaPool = null;     // [{ src, kind: "image"|"video" }]
let mediaSourceName = "";
let lastBeepSecond = -1;  // 滴答音去重
let wakeLock = null;
let audioCtx = null;
let watchdogId = null;    // rAF 被限速/后台冻结时的兜底驱动
let lastFrameAt = 0;
// 背景轮播配置：图片展示时长 / 视频最大播放时长（可从设置面板调整，localStorage 持久化）
const DEFAULT_TIMING = {
    bgImgSeconds: 10,        // 背景图片切换（秒）
    bgVideoMinutes: 0,       // 背景视频最大时长（分钟，0=不限制，自然播完再切换）
    rewardVideoMinutes: 5,   // 奖励视频最大时长（分钟，0=不限制）
    rewardImageSeconds: 10,  // 奖励图片固定时长（秒）
    successChancePct: 70,    // 训练结束进入奖励阶段的概率（%）
    taskMinSeconds: 5,       // 指令随机时长下限（秒）
    taskMaxSeconds: 15,      // 指令随机时长上限（秒）
    bgMuted: false,          // 背景视频默认有声（可在训练界面右上角或设置里静音）
    fitMode: "contain",       // contain=完整显示留黑边；cover=铺满裁切
    rewardChain: 1,           // 奖励连播个数：1=不连播（每轮 1 个素材），3/5=自动连播多个素材后再结算
    rewardStartRandom: false, // 奖励视频从随机位置开始（长视频不用每次都从头看）
    rewardSpeed: 1,           // 奖励视频默认播放速度（倍速）
    bgVolume: 0.7,            // 背景视频音量（0~1）
    rewardVolume: 0.9         // 奖励视频音量（0~1）
};
let timing = { ...DEFAULT_TIMING };
try {
    const saved = JSON.parse(localStorage.getItem(KEYS.timing) || "null");
    if (saved && typeof saved === "object") timing = { ...DEFAULT_TIMING, ...saved };
} catch (e) { /* 解析失败用默认 */ }
let BG_IMG_MS = (timing.bgImgSeconds || 10) * 1000;
let BG_VIDEO_MAX_MS = timing.bgVideoMinutes > 0 ? timing.bgVideoMinutes * 60000 : 0;  // 0=不限制
let REWARD_VIDEO_MAX_MS = timing.rewardVideoMinutes > 0 ? timing.rewardVideoMinutes * 60000 : 0;
let REWARD_IMAGE_MS = Math.max(1, Number(timing.rewardImageSeconds) || 10) * 1000;
let REWARD_CHAIN = Math.max(1, Math.min(5, Number(timing.rewardChain) || 1));
let TASK_MIN_SEC = Math.max(3, Number(timing.taskMinSeconds) || 5);
let TASK_MAX_SEC = Math.max(TASK_MIN_SEC, Number(timing.taskMaxSeconds) || 15);
function vol01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function saveTimingLocal() { try { localStorage.setItem(KEYS.timing, JSON.stringify(timing)); } catch (e) {} }
function applyTiming() {
    BG_IMG_MS = (timing.bgImgSeconds || 10) * 1000;
    BG_VIDEO_MAX_MS = timing.bgVideoMinutes > 0 ? timing.bgVideoMinutes * 60000 : 0;
    REWARD_VIDEO_MAX_MS = timing.rewardVideoMinutes > 0 ? timing.rewardVideoMinutes * 60000 : 0;
    REWARD_IMAGE_MS = Math.max(1, Number(timing.rewardImageSeconds) || 10) * 1000;
    REWARD_CHAIN = Math.max(1, Math.min(5, Number(timing.rewardChain) || 1));
    SUCCESS_CHANCE = Math.max(0, Math.min(100, Number(timing.successChancePct))) / 100;
    TASK_MIN_SEC = Math.max(3, Number(timing.taskMinSeconds) || 5);
    TASK_MAX_SEC = Math.max(TASK_MIN_SEC, Number(timing.taskMaxSeconds) || 15);
    document.body.classList.toggle("fit-cover", timing.fitMode === "cover");
}
let bgMediaTimer = null;  // 训练背景轮播定时器（图片定时切换）
let bgVideoTimer = null;  // 训练背景视频超时切换定时器
let bgRevealTimer = null; // 双缓冲：新视频就绪前的显示兜底
let bgLoadToken = 0;      // 双缓冲加载令牌，避免旧回调串台
let bgVidEl = null;       // 当前正在显示的视频元素（双缓冲用）
let lastBgSrc = "";
let lastRewardSrcs = [];  // 最近 5 个奖励素材，避免连抽重复
let runStats = { tasks: 0, startedAt: 0, elapsed: 0 };  // 本轮统计（任务数/用时）
let pauseState = null;    // 训练暂停状态 { at }
let lastRun = null;       // 最近一次开局的 { difficulty, minutes }，用于「再来一轮」

// ---------- 基础页面控制 ----------
function showPage(id, focusId) {
    pages.forEach(page => { byId(page).hidden = page !== id; });
    if (focusId) byId(focusId).focus();
}
function clearAnimation() {
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    if (watchdogId !== null) { clearInterval(watchdogId); watchdogId = null; }
}
// rAF 正常时负责顺滑；切后台/被限速时由 watchdog 用 setInterval 兜底，保证倒计时不停
function armLoop() {
    animationFrameId = requestAnimationFrame(animate);
    if (watchdogId === null) watchdogId = setInterval(watchdogTick, 250);
}
function watchdogTick() {
    if (!session && !reward) return;
    if (Date.now() - lastFrameAt > 300) { lastFrameAt = Date.now(); animate(); }
}
function resetRun() {
    clearAnimation();
    disarmUiAutoHide();
    session = null;
    reward = null;
    pauseState = null;
    lastBeepSecond = -1;
    stopRewardMedia();
    stopBackgroundMedia();
    releaseWakeLock();
    document.body.classList.remove("stop-task", "success-theme", "paused");
    const overlay = byId("pause-overlay");
    if (overlay) overlay.hidden = true;
    const pb = byId("pause-button");
    if (pb) pb.textContent = "⏸";
}
function showStartPage() {
    resetRun();
    showPage("difficulty-page", "difficulty-heading");
}
function showSettingsPage() {
    resetRun();
    showPage("settings-page", "settings-heading");
}
function updateStartButton() {
    byId("start-button").disabled = !selectedDifficulty ||
        ![5, 10, 15, 20].includes(Number(byId("duration-select").value));
}
// ---------- 记住上一次的选择（难度 + 时长），下次打开自动带出 ----------
function saveSelection() {
    try {
        localStorage.setItem(KEYS.selection, JSON.stringify({
            difficulty: selectedDifficulty,
            minutes: Number(byId("duration-select").value) || null
        }));
    } catch (e) { /* 存储不可用则忽略 */ }
}
function restoreSelection() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEYS.selection) || "null"); } catch (e) { s = null; }
    if (!s || !DIFF_KEYS.includes(s.difficulty)) return;
    selectedDifficulty = s.difficulty;
    difficultyButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.difficulty === s.difficulty)));
    byId("difficulty-status").textContent = `已选择难度：${difficultyLabels[s.difficulty]}（上次的选择）`;
    const mins = Number(s.minutes);
    if ([5, 10, 15, 20].includes(mins)) {
        byId("duration-select").value = String(mins);
        lastRun = { difficulty: s.difficulty, minutes: mins };
    }
    updateStartButton();
}
// 三角分布：简单偏长、普通均衡、困难偏短，范围为 5–15 秒。
function randomTaskSeconds(difficulty) {
    const a = Math.random(), b = Math.random();
    const fraction = difficulty === "Easy" ? Math.max(a, b)
        : difficulty === "Hard" ? Math.min(a, b) : a;
    const span = Math.max(0, TASK_MAX_SEC - TASK_MIN_SEC);
    return TASK_MIN_SEC + Math.floor(fraction * (span + 1));
}
// 按时间比例划分阶段：热身 0-20% → 推进 20-60% → 高潮边缘 60-100%
function phaseForProgress(session, now) {
    const total = session.endsAt - session.startsAt;
    const frac = total > 0 ? (now - session.startsAt) / total : 0;
    if (frac < 0.2) return "warmup";
    if (frac < 0.6) return "build";
    return "edge";
}
function nextTask(now) {
    runStats.tasks++;
    const phase = phaseForProgress(session, now);
    const pool = resolvePool(session.difficulty, phase);
    const fresh = pool.filter(t => !lastTasks.includes(t.text));
    const source = fresh.length ? fresh : pool;
    const task = source[Math.floor(Math.random() * source.length)];
    const seconds = task.durationSeconds ?? randomTaskSeconds(session.difficulty);
    const rendered = renderTaskText(task.text);
    session.task = task;
    session.taskRendered = rendered;
    session.taskStartedAt = now;
    session.taskEndsAt = now + seconds * 1000;
    session.phase = phase;
    lastTasks.push(task.text);
    if (lastTasks.length > 4) lastTasks.shift();
    lastBeepSecond = -1;
    document.body.classList.toggle("stop-task", Boolean(task.redScreen));
    byId("task-text").textContent = rendered;
    byId("task-progress").value = 0;
    lastRemainSec = -1;
    updateGameSummary();
}
// 训练页顶部胶囊：难度 · 阶段 · 剩余时间（秒级节流，只在秒变化时写 DOM）
let lastRemainSec = -1;
function updateGameSummary(force) {
    if (!session) return;
    const sec = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
    if (!force && sec === lastRemainSec) return;
    lastRemainSec = sec;
    const m = Math.floor(sec / 60), s = sec % 60;
    byId("game-summary").textContent = `难度：${difficultyLabels[session.difficulty]} · 阶段：${PHASE_LABELS[session.phase]} · 剩余 ${m}:${String(s).padStart(2, "0")}`;
}

// ---------- 滴答提示音 ----------
function ensureAudio() {
    if (!mediaConfig.tickSound || audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
}
function tickBeep(high) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = high ? 1100 : 700;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
}
function maybeTick(endsAt, now) {
    if (!mediaConfig.tickSound || !audioCtx) return;
    const remain = endsAt - now;
    if (remain > 3000) return;
    const sec = Math.max(0, Math.ceil(remain / 1000));
    if (sec !== lastBeepSecond) {
        lastBeepSecond = sec;
        tickBeep(sec === 0);
    }
}

// ---------- 媒体激励 ----------
function kindOf(src) {
    const low = src.toLowerCase();
    const dot = low.lastIndexOf(".");
    const ext = dot >= 0 ? low.slice(dot) : "";
    return videoExts.includes(ext) ? "video" : imageExts.includes(ext) ? "image" : null;
}
async function fetchMediaManifest() {
    try {
        const r = await fetch("media/manifest.json", { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        const list = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : null);
        if (!list || !list.length) return null;
        return list
            .map(x => typeof x === "string" ? { src: x } : x)
            .filter(x => x && typeof x.src === "string" && kindOf(x.src))
            .map(x => ({ ...x, kind: (x.kind === "video" || x.kind === "image") ? x.kind : kindOf(x.src) }));
    } catch (e) { return null; }
}
async function fetchDirListing() {
    try {
        const r = await fetch("media/", { cache: "no-store" });
        if (!r.ok) return null;
        const html = await r.text();
        const out = [];
        const re = /href="([^"]+)"/g;
        let m;
        while ((m = re.exec(html)) && out.length < 300) {
            const href = m[1];
            if (!href || href === "../" || href.startsWith("?") || href.startsWith("#") ||
                href.startsWith("http") || href.startsWith("/")) continue;
            const clean = href.split("#")[0].split("?")[0];
            const kind = kindOf(clean);
            if (!kind) continue;
            out.push({ src: "media/" + clean, kind });
        }
        return out.length ? out : null;
    } catch (e) { return null; }
}
// 记住的目录句柄（file:// 下用 IndexedDB 持久化，跨会话恢复；加载见「媒体目录」分区）
let rememberedDirHandle = null;

async function discoverMedia() {
    if (!mediaConfig.enabled) return null;
    // 单文件版：构建时注入的内嵌清单（相对路径直引，免选目录）
    if (Array.isArray(window.__EMBEDDED_MEDIA) && window.__EMBEDDED_MEDIA.length) {
        const list = window.__EMBEDDED_MEDIA.filter(x => typeof x === "string" && kindOf(x));
        if (list.length) {
            mediaSourceName = "内嵌清单（" + list.length + " 个）";
            return list.map(src => ({ src, kind: kindOf(src) }));
        }
    }
    // file:// 双击模式：只用记住的目录句柄（IndexedDB，Chrome/Edge），无则引导选目录
    if (location.protocol === "file:") {
        if (rememberedDirHandle) {
            try {
                const perm = await rememberedDirHandle.queryPermission({ mode: "read" });
                if (perm === "granted") {
                    const items = await loadFromDirHandle(rememberedDirHandle);
                    if (items) { mediaSourceName = "记住的目录：" + rememberedDirHandle.name; return items; }
                }
            } catch (e) { /* 句柄失效则忽略 */ }
        }
        return null;   // 引导手动选目录
    }
    let items = await fetchMediaManifest();
    if (items) { mediaSourceName = "media/manifest.json"; return items; }
    items = await fetchDirListing();
    if (items) { mediaSourceName = "media/ 文件夹"; return items; }
    if (Array.isArray(mediaConfig.urls) && mediaConfig.urls.length) {
        mediaSourceName = "配置 URL";
        return mediaConfig.urls.map(src => ({ src, kind: kindOf(src) })).filter(x => x.kind);
    }
    return null;
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function pickRewardMedia() {
    if (!mediaPool || !mediaPool.length) return null;
    let pool = mediaPool;
    if (mediaConfig.preferVideo) {
        const vids = pool.filter(x => x.kind === "video");
        if (vids.length) pool = vids;
    }
    // 避免最近 N 条重复（默认 5 条）
    if (pool.length > 1 && lastRewardSrcs.length) {
        const fresh = pool.filter(x => !lastRewardSrcs.includes(x.src));
        if (fresh.length) pool = fresh;
    }
    const item = shuffle(pool)[0];
    if (item) { lastRewardSrcs.push(item.src); if (lastRewardSrcs.length > 5) lastRewardSrcs.shift(); }
    return item;
}
function stopRewardMedia() {
    if (rewardVideoTimer !== null) { clearTimeout(rewardVideoTimer); rewardVideoTimer = null; }
    const img = byId("reward-img");
    const vid = byId("reward-video");
    vid.pause();
    vid.removeAttribute("src");
    vid.load();
    vid.ontimeupdate = null;
    vid.onloadedmetadata = null;
    img.removeAttribute("src");
    img.hidden = true;
    vid.hidden = true;
    const rvProg = byId("reward-video-progress");
    rvProg.hidden = true;
    rvProg.value = 0;
    byId("reward-media").hidden = true;
    byId("reward-sound-btn").hidden = true;
    byId("reward-speed-button").hidden = true;
}

// ---------- 训练背景轮播（独立于任务进度；图片定时一换，视频播完自动切下一个） ----------
// 双缓冲：切视频时先在另一个 <video> 里加载/播放，就绪后才切换显示，避免黑闪
function hideBgVideos() {
    for (const id of ["game-video", "game-video-2"]) {
        const v = byId(id);
        if (!v) continue;
        v.pause();
        v.hidden = true;
        v.onended = null;
        v.onerror = null;
        v.oncanplay = null;
        v.ontimeupdate = null;
        v.removeAttribute("src");
        try { v.load(); } catch (e) { /* ignore */ }
    }
    bgVidEl = null;
}
function stopBackgroundMedia() {
    if (bgMediaTimer !== null) { clearInterval(bgMediaTimer); bgMediaTimer = null; }
    if (bgVideoTimer !== null) { clearTimeout(bgVideoTimer); bgVideoTimer = null; }
    if (bgRevealTimer !== null) { clearTimeout(bgRevealTimer); bgRevealTimer = null; }
    bgLoadToken++;
    hideBgVideos();
    const img = byId("game-img");
    img.removeAttribute("src");
    img.hidden = true;
    const prog = byId("bg-video-progress");
    prog.hidden = true;
    prog.value = 0;
    byId("game-media").hidden = true;
}
function bgShowVideo(item) {
    const vidA = byId("game-video"), vidB = byId("game-video-2");
    const prog = byId("bg-video-progress");
    const cur = bgVidEl;
    const next = (cur === vidA) ? vidB : vidA;
    const token = ++bgLoadToken;

    next.hidden = true;
    next.style.opacity = "0";
    next.muted = timing.bgMuted !== false;
    next.volume = vol01(timing.bgVolume);
    next.loop = false;   // 不循环：播完自动切下一个素材
    next.src = item.src;
    next.onerror = () => { console.warn("bg video error, skip:", item.src); if (token === bgLoadToken) bgShowNext(); };
    next.onended = () => {
        if (token !== bgLoadToken) return;
        if (bgVideoTimer !== null) { clearTimeout(bgVideoTimer); bgVideoTimer = null; }
        bgShowNext();
    };
    next.ontimeupdate = () => {
        if (next !== bgVidEl || !next.duration || !isFinite(next.duration)) return;
        prog.value = Math.max(0, Math.min(100, next.currentTime / next.duration * 100));
    };
    prog.hidden = false;
    prog.value = 0;

    let revealed = false;
    const reveal = () => {
        if (revealed || token !== bgLoadToken) return;
        revealed = true;
        next.hidden = false;
        bgVidEl = next;
        requestAnimationFrame(() => { next.style.opacity = "1"; });  // 淡入
        // 隐藏并清理另一个（旧）元素
        const other = (next === vidA) ? vidB : vidA;
        if (other !== next && !other.hidden) {
            other.pause();
            other.hidden = true;
            other.onended = null; other.onerror = null; other.oncanplay = null; other.ontimeupdate = null;
            other.removeAttribute("src");
            try { other.load(); } catch (e) { /* ignore */ }
        }
        byId("game-img").hidden = true;
        byId("game-media").hidden = false;
    };
    const tryPlay = () => next.play().catch(() => { next.muted = true; next.play().catch(() => {}); });

    if (next.readyState >= 2) { tryPlay(); reveal(); }
    else {
        next.oncanplay = () => { next.oncanplay = null; tryPlay(); reveal(); };
        // 兜底：若迟迟不就绪也先显示（避免卡住）
        if (bgRevealTimer !== null) clearTimeout(bgRevealTimer);
        bgRevealTimer = setTimeout(() => { bgRevealTimer = null; tryPlay(); reveal(); }, 1500);
    }

    // 视频最大时长（0=不限制，自然播完再切换；>0 则到时切换，两者先到先切）
    if (bgVideoTimer !== null) { clearTimeout(bgVideoTimer); bgVideoTimer = null; }
    if (BG_VIDEO_MAX_MS > 0) {
        bgVideoTimer = setTimeout(() => { bgVideoTimer = null; bgShowNext(); }, BG_VIDEO_MAX_MS);
    }
}
function bgShowImage(item) {
    const img = byId("game-img");
    const token = ++bgLoadToken;
    img.style.opacity = "0";
    const pre = new Image();
    const done = () => {
        if (token !== bgLoadToken) return;
        img.src = item.src;
        img.hidden = false;
        hideBgVideos();
        const prog = byId("bg-video-progress");
        prog.hidden = true;
        prog.value = 0;
        byId("game-media").hidden = false;
        requestAnimationFrame(() => { img.style.opacity = "1"; });  // 淡入
    };
    pre.onload = done;
    pre.onerror = () => { console.warn("bg img error, skip:", item.src); done(); };
    pre.src = item.src;
}
function bgPick() {
    if (!mediaPool || !mediaPool.length) return null;
    const candidates = mediaPool.filter(x => x.src !== lastBgSrc);
    const pool = candidates.length ? candidates : mediaPool;
    return pool[Math.floor(Math.random() * pool.length)];
}
function bgShowNext() {
    const item = bgPick();
    if (!item) return;
    lastBgSrc = item.src;
    byId("game-media").hidden = false;
    if (bgVideoTimer !== null) { clearTimeout(bgVideoTimer); bgVideoTimer = null; }
    if (bgRevealTimer !== null) { clearTimeout(bgRevealTimer); bgRevealTimer = null; }
    if (item.kind === "video") bgShowVideo(item);
    else bgShowImage(item);
}
function startBackgroundMedia() {
    stopBackgroundMedia();
    if (!mediaPool || !mediaPool.length) return;
    bgShowNext();
    // 图片按 BG_IMG_MS 一换；视频播完由 onended 立即切换，此定时器只兜底（图片/卡住的视频）
    bgMediaTimer = setInterval(() => {
        const v = bgVidEl;
        const playingVideo = v && !v.hidden && !v.paused && !v.ended;
        if (!playingVideo) bgShowNext();
    }, BG_IMG_MS);
}
function rewardSpeedValue() { return Math.max(0.25, Math.min(4, Number(timing.rewardSpeed) || 1)); }
const SPEED_STEPS = [1, 1.25, 1.5, 2, 0.75];   // 速度按钮循环档位
function applyRewardSpeed() {
    const v = byId("reward-video");
    if (v && !v.hidden) { try { v.playbackRate = rewardSpeedValue(); } catch (e) {} }
    const b = byId("reward-speed-button");
    if (b) b.textContent = rewardSpeedValue() + "x";
}
function showRewardMedia(item) {
    if (!item) return;
    const media = byId("reward-media");
    const img = byId("reward-img");
    const vid = byId("reward-video");
    const soundBtn = byId("reward-sound-btn");
    const rvProg = byId("reward-video-progress");
    media.hidden = false;
    if (item.kind === "video") {
        vid.hidden = false;
        vid.muted = false;
        vid.volume = vol01(timing.rewardVolume);
        vid.playbackRate = rewardSpeedValue();
        vid.loop = false;   // 不循环：播完自然结束（不限制时长）
        // 随机起点：长视频从随机位置开始（避免每次都从头看）；留 20% 尾部不抽
        vid.onloadedmetadata = () => {
            vid.onloadedmetadata = null;
            if (timing.rewardStartRandom && isFinite(vid.duration) && vid.duration > 30) {
                try { vid.currentTime = Math.random() * vid.duration * 0.8; } catch (e) { /* 不支持 seek 时忽略 */ }
            }
        };
        vid.src = item.src;
        rvProg.hidden = false;
        rvProg.value = 0;
        vid.ontimeupdate = () => {
            if (vid.duration && isFinite(vid.duration)) {
                rvProg.value = Math.max(0, Math.min(100, vid.currentTime / vid.duration * 100));
                // 任务卡进度条同步显示视频播放进度（不隐藏）
                byId("reward-progress").value = rvProg.value;
            }
        };
        vid.onerror = () => {
            console.warn("reward video error, skip:", item.src);
            stopRewardMedia();
            showRewardMedia(pickRewardMedia());
        };
        vid.onended = () => {
            // 视频播放完毕：若连播未完则播下一个，否则结算成功
            if (rewardVideoTimer !== null) { clearTimeout(rewardVideoTimer); rewardVideoTimer = null; }
            if (reward) rewardAdvance();
        };
        // 视频最大时长（0=不限制，播完自然结束；>0 则超时截断）
        if (rewardVideoTimer !== null) { clearTimeout(rewardVideoTimer); rewardVideoTimer = null; }
        if (REWARD_VIDEO_MAX_MS > 0) {
            rewardVideoTimer = setTimeout(() => {
                rewardVideoTimer = null;
                if (reward) rewardAdvance();
            }, REWARD_VIDEO_MAX_MS);
        }
        const tryPlay = () => vid.play().catch(() => {
            vid.muted = true;
            soundBtn.hidden = false;
            vid.play().catch(() => {});
        });
        tryPlay();
        soundBtn.onclick = () => { vid.muted = false; soundBtn.hidden = true; };
        applyRewardSpeed();
        byId("reward-speed-button").hidden = false;
    } else {
        // 图片：淡入过渡（与背景视频一致；换素材先移除再 reveal）
        img.classList.remove("revealed");
        img.hidden = false;
        img.onload = () => {
            img.onload = null;
            requestAnimationFrame(() => img.classList.add("revealed"));
        };
        img.onerror = () => { img.classList.add("revealed"); };   // 加载失败也显示占位，不卡住
        img.src = item.src;
        rvProg.hidden = true;
        rvProg.value = 0;
        byId("reward-speed-button").hidden = true;
    }
}
function handleMediaFiles(files) {
    const items = [];
    for (const f of files) {
        const kind = kindOf(f.name);
        if (!kind) continue;
        items.push({ src: URL.createObjectURL(f), kind });
        if (items.length >= 300) break;
    }
    if (!items.length) {
        byId("media-status").textContent = "所选文件夹里没有图片或视频文件";
        return;
    }
    mediaPool = items;
    mediaSourceName = "手动选择的文件夹";
    byId("media-status").textContent = `激励素材：已加载 ${items.length} 个（${mediaSourceName}）`;
    byId("media-picker-row").hidden = true;
}
async function initMediaPicker() {
    if (!mediaConfig.enabled) return;
    const status = byId("media-status");
    if (mediaPool) { status.textContent = `激励素材：已加载 ${mediaPool.length} 个（${mediaSourceName}）`; return; }
    const items = await discoverMedia();
    if (Array.isArray(items) && items.length) {
        mediaPool = items;
        status.textContent = `激励素材：已加载 ${items.length} 个（${mediaSourceName}）`;
        return;
    }
    status.textContent = "激励素材：未发现，可把素材放 media/ 文件夹，或点「⚙️ 玩法设置」→ 选择素材文件夹";
    byId("media-picker-row").hidden = false;
}

// ---------- 防息屏 / 全屏 ----------
async function requestWakeLock() {
    if (!mediaConfig.keepAwake || !("wakeLock" in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { wakeLock = null; }
}
function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && session && !wakeLock) requestWakeLock();
});
function tryFullscreen() {
    if (!mediaConfig.fullscreenOnStart) return;
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}

// ---------- 结果展示 ----------
// 跨轮累计统计（轮数/任务数/累计用时），localStorage 持久化
function loadTotalStats() {
    try {
        const s = JSON.parse(localStorage.getItem(KEYS.stats) || "null");
        if (s && typeof s === "object") return {
            runs: Math.max(0, Number(s.runs) || 0),
            tasks: Math.max(0, Number(s.tasks) || 0),
            ms: Math.max(0, Number(s.ms) || 0)
        };
    } catch (e) { /* 存储不可用则忽略 */ }
    return { runs: 0, tasks: 0, ms: 0 };
}
function saveTotalStats(s) { try { localStorage.setItem(KEYS.stats, JSON.stringify(s)); } catch (e) {} }
function displayResult(result) {
    resetRun();
    document.body.classList.toggle("success-theme", result === "success");
    byId("ending-heading").textContent = result === "success"
        ? rewardConfig.completedTitle : "很抱歉，你本轮未能获得射出的机会";
    const endingHeading = byId("ending-heading");
    endingHeading.classList.toggle("failure-heading", result !== "success");
    if (result !== "success") {
        const detail = endingHeading.textContent.replace(/^很抱歉[，,]?\s*/, "");
        const firstLine = document.createElement("span");
        firstLine.textContent = "很抱歉";
        firstLine.style.display = "block";
        const secondLine = document.createElement("span");
        secondLine.textContent = detail;
        secondLine.style.display = "block";
        endingHeading.replaceChildren(firstLine, secondLine);
    }
    byId("ending-summary").textContent = result === "success"
        ? rewardConfig.completedMessage : "再接再厉，下次继续挑战！";
    // 跨轮累计统计（localStorage 持久化：轮数/任务数/累计用时）
    const total = loadTotalStats();
    total.runs += 1; total.tasks += runStats.tasks; total.ms += runStats.elapsed;
    saveTotalStats(total);
    // 本轮统计：只统计训练阶段（不含奖励），暂停时间不计入
    const min = Math.floor(runStats.elapsed / 60000);
    const sec = Math.round((runStats.elapsed % 60000) / 1000);
    const timeTxt = min > 0 ? `${min} 分 ${String(sec).padStart(2, "0")} 秒` : `${sec} 秒`;
    const hrs = Math.floor(total.ms / 3600000);
    const tmin = Math.round((total.ms % 3600000) / 60000);
    const totalTxt = hrs > 0 ? `${hrs} 小时 ${tmin} 分` : `${tmin} 分钟`;
    const statsEl = byId("ending-stats");
    if (statsEl) statsEl.textContent = `本轮做了 ${runStats.tasks} 条任务 · 实际用时 ${timeTxt}\n累计 ${total.runs} 轮 · ${total.tasks} 条任务 · 约 ${totalTxt}`;
    const resetBtn = byId("stats-reset-button");
    if (resetBtn) { resetBtn.hidden = total.runs <= 1; resetBtn.textContent = "清零累计统计"; resetBtn.disabled = false; }
    showPage("ending-page", "ending-heading");
}
// 结束页「清零累计统计」（仅清 stats；设置/指令不动）
byId("stats-reset-button").addEventListener("click", () => {
    if (!window.confirm("确定清零累计统计？（只清轮数/任务数/用时，不影响其他设置）")) return;
    saveTotalStats({ runs: 0, tasks: 0, ms: 0 });
    const statsEl = byId("ending-stats");
    if (statsEl) statsEl.textContent = statsEl.textContent.split("\n")[0];   // 只留本轮行
    const btn = byId("stats-reset-button");
    btn.textContent = "已清零";
    btn.disabled = true;
});

// ---------- 奖励阶段 ----------
let rewardVideoTimer = null;         // 奖励视频超时定时器
let _preloadedReward = null;         // 下次奖励素材的预加载（视频 metadata/src 已就绪，切换更顺）
// 预加载下一个奖励素材到隐藏元素，供「换一个」/连播自动切换时秒用
function preloadNextReward() {
    _preloadedReward = pickRewardMedia();
    if (!_preloadedReward) return;
    const pv = byId("reward-prefetch"), pi = byId("reward-prefetch-img");
    if (_preloadedReward.kind === "video") {
        pi.hidden = true;
        pv.hidden = false;
        pv.src = _preloadedReward.src; pv.load();
    } else {
        pv.removeAttribute("src"); pv.hidden = true;
        pi.hidden = false; pi.src = _preloadedReward.src;
    }
}
function takePreloadedReward() {
    const p = _preloadedReward;
    _preloadedReward = null;
    byId("reward-prefetch").removeAttribute("src");
    byId("reward-prefetch").hidden = true;
    byId("reward-prefetch-img").hidden = true;
    return p;
}
function updateRewardCounter() {
    const el = byId("reward-counter");
    if (!el) return;
    el.textContent = (REWARD_CHAIN > 1 && reward)
        ? `奖励素材：第 ${reward.showIndex}/${REWARD_CHAIN} 个 · 还剩 ${reward.remaining} 个`
        : "";
}
// 显示第 showIndex 个奖励素材，重置该素材的计时/进度，并预加载下一个
function rewardShowItem(item, showIndex) {
    const isVideo = item && item.kind === "video";
    reward.startsAt = Date.now();
    reward.waitVideo = isVideo;
    reward.duration = isVideo ? REWARD_VIDEO_MAX_MS : REWARD_IMAGE_MS;
    reward.showIndex = showIndex;
    byId("reward-progress").value = 0;
    byId("reward-progress").hidden = false;   // 任务卡进度条常驻（视频模式由 ontimeupdate 驱动）
    byId("reward-sound-btn").hidden = true;
    lastBeepSecond = -1;
    updateRewardCounter();
    if (item) showRewardMedia(item);
    preloadNextReward();
}
// 连播推进：消耗一个名额；名额用尽才结算成功，否则自动播下一个（用预加载好的）
function rewardAdvance() {
    if (!reward) return;
    reward.remaining--;
    if (reward.remaining <= 0) { displayResult("success"); return; }
    const p = takePreloadedReward();
    rewardShowItem(p ? p : pickRewardMedia(), reward.showIndex + 1);
}
function startReward() {
    resetRun();
    reward = { startsAt: Date.now(), duration: REWARD_IMAGE_MS, waitVideo: false, remaining: REWARD_CHAIN, showIndex: 1 };
    document.body.classList.toggle("success-theme", true);
    byId("reward-heading").textContent = rewardConfig.title;
    byId("reward-task").textContent = rewardConfig.task;
    byId("reward-progress").value = 0;
    lastBeepSecond = -1;
    const item = pickRewardMedia();
    reward.waitVideo = item && item.kind === "video";
    reward.duration = reward.waitVideo ? REWARD_VIDEO_MAX_MS : REWARD_IMAGE_MS;
    byId("reward-progress").hidden = false;   // 任务卡进度条常驻
    showPage("reward-page", "reward-heading");
    updateRewardCounter();
    if (item) showRewardMedia(item);
    preloadNextReward();
    armLoop();
    armUiAutoHide();
}
// 「换一个」：不喜欢的素材直接换（不消耗连播名额）
function nextRewardMedia() {
    if (!reward) return;
    const p = takePreloadedReward();
    const item = p ? p : pickRewardMedia();
    if (!item) return;
    rewardShowItem(item, reward.showIndex);
}

// ---------- 主循环 ----------
function animate() {
    lastFrameAt = Date.now();
    animationFrameId = null;
    if (pauseState) { if (session || reward) armLoop(); return; }   // 暂停：冻结所有计时
    const now = Date.now();
    if (session) {
        if (now >= session.endsAt && now >= session.taskEndsAt) {
            stopBackgroundMedia();  // 训练结束，停止背景轮播
            runStats.elapsed = now - runStats.startedAt;  // 实际用时（不含暂停）
            if (Math.random() < SUCCESS_CHANCE) startReward();
            else displayResult("failure");
            return;
        }
        if (now >= session.taskEndsAt) nextTask(now);
        const elapsed = now - session.taskStartedAt;
        const duration = session.taskEndsAt - session.taskStartedAt;
        byId("task-progress").value = Math.max(0, Math.min(100, elapsed / duration * 100));
        updateGameSummary();
        maybeTick(session.taskEndsAt, now);
    } else if (reward) {
        if (reward.waitVideo) {
            // 视频：任务卡进度条由视频 ontimeupdate 驱动（不隐藏）
        } else {
            const fraction = (now - reward.startsAt) / reward.duration;
            byId("reward-progress").value = Math.max(0, Math.min(100, fraction * 100));
            maybeTick(reward.startsAt + reward.duration, now);
            if (fraction >= 1) { rewardAdvance(); return; }
        }
    }
    if (session || reward) armLoop();
}

// ---------- 事件绑定 ----------
difficultyButtons.forEach(button => button.addEventListener("click", () => {
    selectedDifficulty = button.dataset.difficulty;
    difficultyButtons.forEach(option => option.setAttribute("aria-pressed", String(option === button)));
    byId("difficulty-status").textContent = `已选择难度：${difficultyLabels[selectedDifficulty]}`;
    updateStartButton();
    saveSelection();
}));
byId("duration-select").addEventListener("change", () => { updateStartButton(); saveSelection(); });
byId("start-button").addEventListener("click", () => {
    const minutes = Number(byId("duration-select").value);
    if (!selectedDifficulty || ![5, 10, 15, 20].includes(minutes) || !hasAnyTasks()) return;
    lastRun = { difficulty: selectedDifficulty, minutes };
    startSession(minutes);
});
function startSession(minutes) {
    saveSelection();
    ensureAudio();
    resetRun();
    tryFullscreen();
    requestWakeLock();
    startBackgroundMedia();
    runStats = { tasks: 0, startedAt: Date.now(), elapsed: 0 };
    const now = Date.now();
    session = { difficulty: selectedDifficulty, endsAt: now + minutes * 60000, startsAt: now, task: null, phase: "warmup" };
    nextTask(now);
    showPage("game-page", "task-text");
    armLoop();
    armUiAutoHide();
}
// 训练中暂停/继续（冻结倒计时与背景视频）
function togglePause() {
    if (!session) return;
    const overlay = byId("pause-overlay");
    const pb = byId("pause-button");
    if (pauseState) {
        const d = Date.now() - pauseState.at;
        session.startsAt += d; session.endsAt += d;
        session.taskStartedAt += d; session.taskEndsAt += d;
        pauseState = null;
        document.body.classList.remove("paused");
        if (overlay) overlay.hidden = true;
        if (pb) pb.textContent = "⏸";
        if (bgVidEl) bgVidEl.play().catch(() => {});
        armLoop();
    } else {
        pauseState = { at: Date.now() };
        document.body.classList.add("paused");
        if (overlay) overlay.hidden = false;
        if (pb) pb.textContent = "▶";
        if (bgVidEl) bgVidEl.pause();
    }
}
function updateMuteButton() {
    const b = byId("mute-button");
    if (b) b.textContent = (timing.bgMuted !== false) ? "🔇" : "🔊";
}
function toggleBgMute() {
    timing.bgMuted = timing.bgMuted !== false ? false : true;
    try { localStorage.setItem(KEYS.timing, JSON.stringify(timing)); } catch (e) {}
    applyTiming();
    updateMuteButton();
    updatePlaySummary();
    const cb = byId("bg-muted"); if (cb) cb.checked = timing.bgMuted !== false;
    if (bgVidEl) bgVidEl.muted = timing.bgMuted !== false;
}

// ---------- 训练快捷键 ----------
// 空格=暂停/继续（训练中）；N=换奖励素材；M=背景声音开关。
// ←/→=活跃视频快退/快进 10s；↑/↓=活跃音量 ±10%（奖励时调奖励、训练时调背景）。
// 输入框/文本域聚焦时不拦截，避免误触。
// 当前活跃视频：奖励阶段用奖励视频，否则用背景视频
function activeVideo() {
    const rv = byId("reward-video");
    if (reward && rv && !rv.hidden) return rv;
    return (bgVidEl && !bgVidEl.hidden) ? bgVidEl : null;
}
// 音量快捷键同步：改 timing + 持久化 + 应用到活跃视频 + 刷新滑杆 UI
function nudgeActiveVolume(dv) {
    const isReward = !!(reward && !byId("reward-video").hidden);
    const key = isReward ? "rewardVolume" : "bgVolume";
    timing[key] = vol01((Number(timing[key]) || 0) + dv);
    saveTimingLocal();
    const v = activeVideo();
    if (v) v.volume = timing[key];
    const slider = byId(isReward ? "reward-volume" : "bg-volume");
    if (slider) slider.value = Math.round(timing[key] * 100);
}
function seekActiveVideo(deltaSec) {
    const v = activeVideo();
    if (!v || !isFinite(v.duration) || v.duration <= 0) return;
    try { v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + deltaSec)); } catch (e) { /* 不支持 seek 时忽略 */ }
}
document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    switch (e.code) {
        case "Space":
            if (session) { e.preventDefault(); togglePause(); }
            break;
        case "KeyN":
            if (reward) nextRewardMedia();
            break;
        case "KeyM":
            toggleBgMute();
            break;
        case "ArrowLeft":
            e.preventDefault(); seekActiveVideo(-10);
            break;
        case "ArrowRight":
            e.preventDefault(); seekActiveVideo(10);
            break;
        case "ArrowUp":
            e.preventDefault(); nudgeActiveVolume(0.1);
            break;
        case "ArrowDown":
            e.preventDefault(); nudgeActiveVolume(-0.1);
            break;
    }
});

// ---------- 全屏/训练时鼠标不动自动隐藏底部按钮与进度（更沉浸） ----------
let uiHideTimer = null;
function armUiAutoHide() {
    disarmUiAutoHide();
    uiHideTimer = setTimeout(() => document.body.classList.add("ui-idle"), 2600);
}
function disarmUiAutoHide() {
    if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
    document.body.classList.remove("ui-idle");
}
document.addEventListener("pointermove", () => {
    if (!session && !reward) { disarmUiAutoHide(); return; }
    disarmUiAutoHide(); armUiAutoHide();
});
// 启动页显示当前生效的玩法设置（从已保存的 timing 读，保存/切换时同步）
function updatePlaySummary() {
    const el = byId("play-summary");
    if (!el) return;
    const fit = timing.fitMode === "cover" ? "铺满裁切" : "完整显示";
    const sound = (timing.bgMuted !== false) ? "背景静音" : "背景有声";
    const chainTxt = (timing.rewardChain && timing.rewardChain > 1) ? ` · 连播 ${timing.rewardChain} 个` : "";
    const rndTxt = timing.rewardStartRandom ? " · 随机起点" : "";
    const spd = rewardSpeedValue();
    const spdTxt = (spd !== 1) ? ` · 速度 ${spd}x` : "";
    el.textContent = `当前玩法：成功概率 ${timing.successChancePct}% · 任务 ${timing.taskMinSeconds}~${timing.taskMaxSeconds}s · 奖励图片 ${timing.rewardImageSeconds}s · ${fit} · ${sound}${chainTxt}${rndTxt}${spdTxt}`;
}
byId("pause-button").addEventListener("click", togglePause);
byId("mute-button").addEventListener("click", () => {
    timing = { ...timing, bgMuted: !(timing.bgMuted !== false) };
    try { localStorage.setItem(KEYS.timing, JSON.stringify(timing)); } catch (e) {}
    applyTiming(); updateMuteButton(); loadPlayInputs(); updatePlaySummary();
});
byId("reward-skip-button").addEventListener("click", nextRewardMedia);
byId("replay-button").addEventListener("click", () => {
    if (!lastRun) { showStartPage(); return; }
    selectedDifficulty = lastRun.difficulty;
    difficultyButtons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.difficulty === lastRun.difficulty)));
    byId("difficulty-status").textContent = `已选择难度：${difficultyLabels[selectedDifficulty]}`;
    byId("duration-select").value = String(lastRun.minutes);
    startSession(lastRun.minutes);
});
byId("settings-button").addEventListener("click", showStartPage);
byId("settings-open-button").addEventListener("click", showSettingsPage);
byId("settings-back-button").addEventListener("click", showStartPage);
byId("reward-back-button").addEventListener("click", showStartPage);
byId("restart-button").addEventListener("click", showStartPage);

// ---------- 自定义媒体文件夹（showDirectoryPicker + IndexedDB 记住目录） ----------
let mediaDirButton = byId("media-picker-button");

function idbOpen() {
    return new Promise((res, rej) => {
        const rq = indexedDB.open(KEYS.mediaDirDB, 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore("kv"); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
    });
}
async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
        const tx = db.transaction("kv", "readonly");
        const rq = tx.objectStore("kv").get(key);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
    });
}
async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
function isDirHandle(h) {
    return h && typeof h === "object" && typeof h.queryPermission === "function"
        && typeof h.values === "function" && typeof h.name === "string";
}
// 读目录句柄 → 素材数组（不改 mediaPool、不碰 UI，由调用方决定）
async function loadFromDirHandle(handle) {
    const items = [];
    try {
        const iter = handle.values();
        let r = await iter.next();
        while (!r.done) {
            const entry = r.value;
            if (entry && entry.kind === "file") {
                const kind = kindOf(entry.name);
                if (kind) {
                    try {
                        const f = await entry.getFile();
                        items.push({ src: URL.createObjectURL(f), kind, name: entry.name });
                        if (items.length >= 300) break;
                    } catch (e) { /* 跳过读失败的文件 */ }
                }
            }
            r = await iter.next();
        }
    } catch (e) { /* 目录读取失败则忽略 */ }
    return items.length ? items : null;
}
async function pickAndRememberDir() {
    if (!window.showDirectoryPicker) {
        byId("media-file-input").click();   // 老浏览器回退
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({ id: "cwm-media-dir", mode: "read" });
        await idbSet(KEYS.mediaDirKey, handle);
        rememberedDirHandle = handle;
        const items = await loadFromDirHandle(handle);
        if (items) {
            mediaPool = items;
            mediaSourceName = "选择的目录：" + handle.name;
            byId("media-status").textContent = `激励素材：已加载 ${items.length} 个（${mediaSourceName}）`;
        } else {
            byId("media-status").textContent = "所选文件夹里没有图片或视频文件";
        }
    } catch (e) {
        if (e && e.name === "AbortError") return;   // 用户取消
        byId("media-status").textContent = "选择目录失败：" + (e && e.message ? e.message : e);
    }
}
// 标记：记住的目录权限已失效（prompt），等用户点一次「选择素材文件夹」自动重新授权并恢复
let _pendingDirAuth = false;
async function restoreRememberedDir() {
    if (!window.showDirectoryPicker) return;
    let handle;
    try { handle = await idbGet(KEYS.mediaDirKey); } catch (e) { return; }
    if (!isDirHandle(handle)) return;
    rememberedDirHandle = handle;   // 交给 discoverMedia 统一加载
    try {
        const perm = await handle.queryPermission({ mode: "read" });
        if (perm !== "granted") {
            // 权限未授予：boot 阶段无用户手势不能直接 showDirectoryPicker (会被拦)。
            // 置标记，等用户点「选择素材文件夹」按钮时自动弹窗重新授权并恢复（见下方监听）。
            _pendingDirAuth = true;
            byId("media-status").textContent = "已记住素材目录「" + handle.name + "」，点📁按钮重新授权即可";
        }
    } catch (e) { /* 句柄失效则忽略 */ }
}

// 记住目录的恢复只在 boot() 里做（file:// 下 await，保证 discoverMedia 用得到句柄）
if (window.showDirectoryPicker) {
    mediaDirButton.addEventListener("click", async () => {
        // 有记住的目录但权限失效：自动弹窗重新授权并恢复，浏览器会定位到上次的文件夹(id 复用)
        if (_pendingDirAuth && isDirHandle(rememberedDirHandle)) {
            try {
                const perm = await rememberedDirHandle.queryPermission({ mode: "read" });
                if (perm === "granted") {
                    _pendingDirAuth = false;
                    const items = await loadFromDirHandle(rememberedDirHandle);
                    if (items) {
                        mediaPool = items;
                        mediaSourceName = "记住的目录：" + rememberedDirHandle.name;
                        byId("media-status").textContent = `激励素材：已加载 ${items.length} 个（${mediaSourceName}）`;
                        byId("media-picker-row").hidden = true;
                    }
                    return;
                }
            } catch (e) { /* 走正常选择流程 */ }
            // 权限仍是 prompt：弹授权框（带同 id，浏览器自动回到上次文件夹），点允许即恢复
            try {
                const handle = await window.showDirectoryPicker({ id: "cwm-media-dir", mode: "read" });
                await idbSet(KEYS.mediaDirKey, handle);
                rememberedDirHandle = handle;
                _pendingDirAuth = false;
                const items = await loadFromDirHandle(handle);
                if (items) {
                    mediaPool = items;
                    mediaSourceName = "记住的目录：" + handle.name;
                    byId("media-status").textContent = `激励素材：已加载 ${items.length} 个（${mediaSourceName}）`;
                    byId("media-picker-row").hidden = true;
                } else {
                    byId("media-status").textContent = "所选文件夹里没有图片或视频文件";
                }
            } catch (e) {
                if (e && e.name === "AbortError") return;
                byId("media-status").textContent = "选择目录失败：" + (e && e.message ? e.message : e);
            }
        } else {
            pickAndRememberDir();
        }
    });
} else {
    mediaDirButton.addEventListener("click", () => byId("media-file-input").click());
}
byId("media-file-input").addEventListener("change", e => {
    handleMediaFiles(e.target.files);
    e.target.value = "";
});

// ---------- 自定义指令 ----------
function saveTasksLocal(lib) {
    try {
        if (lib) localStorage.setItem(KEYS.tasks, JSON.stringify(lib));
        else localStorage.removeItem(KEYS.tasks);
    } catch (e) { /* 存储不可用则忽略 */ }
}
function loadTasksLocal() {
    try {
        const raw = localStorage.getItem(KEYS.tasks);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}
function refreshTasksUI() {
    const el = byId("custom-tasks-input");
    if (el) el.value = tasksToText();
    byId("tasks-save-status").textContent = "";
}
function applyCustomLibrary(lib) {
    if (lib && typeof lib === "object" && !Array.isArray(lib) && Object.keys(lib).length) {
        window.__customLibrary = lib;
    } else if (Array.isArray(lib) && lib.length) {
        // 旧格式数组 → 转全难度全阶段（兼容旧版保存）
        const n = {};
        for (const t of lib) for (const d of DIFF_KEYS) for (const p of PHASE_KEYS) {
            (n[d] = n[d] || {})[p] = (n[d][p] || []).concat([t]);
        }
        window.__customLibrary = n;
    } else {
        window.__customLibrary = null;
    }
}
byId("save-tasks-button").addEventListener("click", async () => {
    const lib = parseCustomTasks(byId("custom-tasks-input").value);
    if (!Object.keys(lib).length) {
        flashStatus("tasks-save-status", "❌ 至少要有 1 条指令");
        return;
    }
    applyCustomLibrary(lib);
    saveTasksLocal(lib);   // 纯 HTML / 网页版都用 localStorage 持久化
    const count = Object.values(lib).reduce((a, d) => a + Object.values(d).reduce((x, arr) => x + (arr ? arr.length : 0), 0), 0);
    flashStatus("tasks-save-status", `✅ 已保存 ${count} 条指令`);
});
byId("reset-tasks-button").addEventListener("click", async () => {
    applyCustomLibrary(null);
    saveTasksLocal(null);   // 同步清除 localStorage
    refreshTasksUI();
    flashStatus("tasks-save-status", "↩ 已恢复默认指令");
});

// ---------- 媒体时长设置（可配置，localStorage 持久化） ----------
// 保存反馈：显示后 3 秒自动淡出（避免一直挂着不动）
function flashStatus(id, text) {
    const el = byId(id);
    if (!el) return;
    el.textContent = text;
    if (el._t) clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ""; }, 3000);
}
function loadTimingInputs() {
    byId("bg-img-seconds").value = timing.bgImgSeconds;
    byId("bg-video-minutes").value = timing.bgVideoMinutes;
    byId("reward-video-minutes").value = timing.rewardVideoMinutes;
}
function saveTiming() {
    const imgSec = Math.max(1, Math.min(600, Number(byId("bg-img-seconds").value) || 10));
    const bgMin = Math.max(0, Math.min(60, Number(byId("bg-video-minutes").value) || 0));
    const rwMin = Math.max(0, Math.min(60, Number(byId("reward-video-minutes").value) || 0));
    timing = { ...timing, bgImgSeconds: imgSec, bgVideoMinutes: bgMin, rewardVideoMinutes: rwMin };
    try { localStorage.setItem(KEYS.timing, JSON.stringify(timing)); } catch (e) {}
    applyTiming();
    byId("bg-img-seconds").value = imgSec;
    byId("bg-video-minutes").value = bgMin;
    byId("reward-video-minutes").value = rwMin;
    flashStatus("timing-save-status", `✅ 已保存：背景图 ${imgSec}s / 背景视频 ${bgMin > 0 ? bgMin + "min" : "不限"} / 奖励视频 ${rwMin > 0 ? rwMin + "min" : "不限"}`);
}
byId("save-timing-button").addEventListener("click", saveTiming);
loadTimingInputs();

// ---------- 玩法设置（成功概率/任务时长/奖励图时长/声音/画面填充） ----------
function loadPlayInputs() {
    if (!byId("success-chance-pct")) return;
    byId("success-chance-pct").value = timing.successChancePct;
    byId("reward-image-seconds").value = timing.rewardImageSeconds;
    byId("task-min-seconds").value = timing.taskMinSeconds;
    byId("task-max-seconds").value = timing.taskMaxSeconds;
    byId("fit-mode").value = timing.fitMode === "cover" ? "cover" : "contain";
    if (byId("reward-chain-select")) byId("reward-chain-select").value = String(timing.rewardChain || 1);
    byId("bg-muted").checked = timing.bgMuted !== false;
    const rsr = byId("reward-start-random");
    if (rsr) rsr.checked = !!timing.rewardStartRandom;
    updateMuteButton();
}
function savePlay() {
    const pct = Math.max(0, Math.min(100, Number(byId("success-chance-pct").value)));
    const ris = Math.max(1, Math.min(600, Number(byId("reward-image-seconds").value) || 10));
    let tmin = Math.max(3, Math.min(120, Number(byId("task-min-seconds").value) || 5));
    let tmax = Math.max(3, Math.min(300, Number(byId("task-max-seconds").value) || 15));
    if (tmax < tmin) { const t = tmin; tmin = tmax; tmax = t; }
    const fit = byId("fit-mode").value === "cover" ? "cover" : "contain";
    const muted = byId("bg-muted").checked;
    const chain = Math.max(1, Math.min(5, Number(byId("reward-chain-select") ? byId("reward-chain-select").value : 1) || 1));
    const startRandom = byId("reward-start-random") ? byId("reward-start-random").checked : false;
    timing = { ...timing, successChancePct: Number.isNaN(pct) ? 70 : pct, rewardImageSeconds: ris, taskMinSeconds: tmin, taskMaxSeconds: tmax, fitMode: fit, bgMuted: muted, rewardChain: chain, rewardStartRandom: startRandom };
    try { localStorage.setItem(KEYS.timing, JSON.stringify(timing)); } catch (e) {}
    applyTiming();
    loadTimingInputs();
    loadPlayInputs();
    updatePlaySummary();
    flashStatus("play-save-status", `✅ 已保存：成功概率 ${timing.successChancePct}% / 任务 ${tmin}~${tmax}s / 奖励图片 ${ris}s` + (chain > 1 ? ` / 连播 ${chain} 个` : ""));
}
byId("save-play-button").addEventListener("click", savePlay);
loadPlayInputs();

// ---------- 视频进度条可拖动（seek） ----------
function attachSeek(el, getVideo) {
    if (!el) return;
    let dragging = false;
    const seekTo = (clientX) => {
        const v = getVideo();
        if (!v || !isFinite(v.duration) || v.duration <= 0) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0) return;
        const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        try { v.currentTime = f * v.duration; } catch (e) { /* 不支持 seek 时忽略 */ }
    };
    el.style.pointerEvents = "auto";
    el.style.cursor = "pointer";
    el.addEventListener("pointerdown", e => {
        dragging = true;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        seekTo(e.clientX);
        e.preventDefault();
    });
    el.addEventListener("pointermove", e => { if (dragging) seekTo(e.clientX); });
    const end = e => { dragging = false; try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
}
attachSeek(byId("bg-video-progress"), () => bgVidEl);
attachSeek(byId("reward-video-progress"), () => byId("reward-video"));

// ---------- 音量滑杆 / 奖励播放速度 ----------
function initVolumeSliders() {
    const bg = byId("bg-volume"), rw = byId("reward-volume");
    if (bg) {
        bg.value = Math.round(vol01(timing.bgVolume) * 100);
        bg.addEventListener("input", () => {
            timing.bgVolume = Number(bg.value) / 100;
            saveTimingLocal();
            // 拖动音量 = 想要声音：静音状态下自动取消静音
            if (timing.bgMuted) {
                timing.bgMuted = false;
                updateMuteButton(); updatePlaySummary();
                const cb = byId("bg-muted"); if (cb) cb.checked = false;
            }
            if (bgVidEl) bgVidEl.volume = vol01(timing.bgVolume);
        });
    }
    if (rw) {
        rw.value = Math.round(vol01(timing.rewardVolume) * 100);
        rw.addEventListener("input", () => {
            timing.rewardVolume = Number(rw.value) / 100;
            saveTimingLocal();
            const v = byId("reward-video");
            if (v && !v.hidden) {
                v.volume = vol01(timing.rewardVolume);
                if (v.muted) { v.muted = false; byId("reward-sound-btn").hidden = true; }
            }
        });
    }
}
initVolumeSliders();
byId("reward-speed-button").addEventListener("click", () => {
    const cur = rewardSpeedValue();
    const next = SPEED_STEPS[(SPEED_STEPS.indexOf(cur) + 1) % SPEED_STEPS.length];
    timing.rewardSpeed = next;
    saveTimingLocal();
    applyRewardSpeed();
});

// ---------- 任务卡可拖动（拖动手柄；位置 localStorage 持久化，双击手柄复位） ----------
function loadTaskCardPos() {
    try {
        const s = JSON.parse(localStorage.getItem(KEYS.taskCardPos) || "null");
        return s && typeof s === "object" ? s : {};
    } catch (e) { return {}; }
}
function saveTaskCardPos(key, x, y) {
    const all = loadTaskCardPos();
    all[key] = { x, y };
    try { localStorage.setItem(KEYS.taskCardPos, JSON.stringify(all)); } catch (e) {}
}
function clearTaskCardPos(key) {
    const all = loadTaskCardPos();
    delete all[key];
    try { localStorage.setItem(KEYS.taskCardPos, JSON.stringify(all)); } catch (e) {}
}
// 恢复记忆位置：卡片转成 left/top 定位（清掉居中的 translateX(-50%)）
function applyTaskCardPos(card, pos) {
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
        // 无记忆：回到 CSS 默认（居中底部）
        card.style.left = ""; card.style.top = ""; card.style.right = "";
        card.style.bottom = ""; card.style.transform = "";
        return;
    }
    card.style.left = pos.x + "px";
    card.style.top = pos.y + "px";
    card.style.right = "auto";
    card.style.bottom = "auto";
    card.style.transform = "none";
}
function makeTaskCardDraggable(card, key) {
    if (!card) return;
    const handle = document.createElement("div");
    handle.className = "card-handle";
    handle.setAttribute("aria-label", "拖动任务卡（双击复位）");
    handle.title = "拖动调整位置 · 双击复位";
    card.prepend(handle);
    applyTaskCardPos(card, loadTaskCardPos()[key]);
    // 整卡可拖：按住卡片任意空白处即可拖动（卡片内无按钮/输入框，无误触风险）
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
    const begin = (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        const r = card.getBoundingClientRect();
        origX = r.x; origY = r.y;
        card.style.left = r.x + "px"; card.style.top = r.y + "px";
        card.style.right = "auto"; card.style.bottom = "auto";
        card.style.transform = "none";
        try { card.setPointerCapture(e.pointerId); } catch (err) {}
    };
    card.addEventListener("pointerdown", begin);
    card.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = card.offsetWidth, h = card.offsetHeight;
        const x = Math.max(4 - w, Math.min(vw - 4, origX + (e.clientX - startX)));
        const y = Math.max(4, Math.min(vh - 4, origY + (e.clientY - startY)));
        card.style.left = x + "px"; card.style.top = y + "px";
    });
    const end = () => {
        if (!dragging) return;
        dragging = false;
        try { card.releasePointerCapture(card.pointerId); } catch (err) {}
        const r = card.getBoundingClientRect();
        saveTaskCardPos(key, Math.round(r.x), Math.round(r.y));
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
    // 手柄双击复位（整卡拖动时双击卡片任意处也可复位）
    const reset = (e) => {
        e.stopPropagation();
        clearTaskCardPos(key);
        applyTaskCardPos(card, null);
    };
    handle.addEventListener("dblclick", reset);
    card.addEventListener("dblclick", reset);
}
makeTaskCardDraggable(byId("game-task-card"), "game");
makeTaskCardDraggable(byId("reward-task-card"), "reward");

// ---------- 年龄确认门（首次访问显示一次） ----------
function initAgeGate() {
    const gate = byId("age-gate");
    if (!gate) return;
    let verified = false;
    try { verified = localStorage.getItem(KEYS.age) === "1"; } catch (e) {}
    if (verified) { gate.hidden = true; return; }
    gate.hidden = false;
    byId("age-enter").addEventListener("click", () => {
        try { localStorage.setItem(KEYS.age, "1"); } catch (e) {}
        gate.hidden = true;
    });
    byId("age-leave").addEventListener("click", () => {
        // 未满 18：替换页面为退出提示
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:24px;"><div><h1>⚠️ 你已选择离开</h1><p style="color:#aaa;line-height:1.8;">本程序仅限 18 周岁及以上用户使用。<br>请关闭此页面。</p></div></div>';
    });
}

async function boot() {
    // 年龄门：首次访问先确认，未确认前遮挡全部内容
    initAgeGate();
    // 加载配置：localStorage 优先（纯 HTML / 网页版通用），Electron config 兜底
    const lsTasks = loadTasksLocal();
    if (lsTasks) applyCustomLibrary(lsTasks);
    refreshTasksUI();
    applyTiming();
    loadPlayInputs();
    updatePlaySummary();
    restoreSelection();
    // file:// 下先恢复记住的目录（让 discoverMedia 能用到句柄）
    if (location.protocol === "file:" && typeof restoreRememberedDir === "function") {
        await restoreRememberedDir();
    }
    initMediaPicker();
    ensureAudio();
    showStartPage();
}
// file:// 双击打开时：标记本地模式（无记住目录时 initMediaPicker 会自动显示选目录按钮）
if (location.protocol === "file:") {
    window.__fileMode = true;
}
boot();

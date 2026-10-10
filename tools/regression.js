// 主回归测试（CDP headless + 本地静态服务）
// 前置：cd 项目根 && python3 -m http.server 8451（须在项目根，否则 js 404）
//       CDP Chrome 已在 9222 端口（见 tools/README.md）
// 用法：node tools/regression.js [BASE_URL]   （默认 http://127.0.0.1:8451）
const BASE = process.argv[2] || process.env.CWM_BASE || 'http://127.0.0.1:8451';
// 测视频功能用的长素材（>30s 才触发随机起点；短素材播完立即结算，用例全挂）
const LONG_VIDEO = 'media/gvp_087.mp4';

async function newPage() {
  const t = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {}; const events = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } if (m.method) events.push(m); };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  return { t, ws, send, events, close: async () => { try { ws.close(); } catch (e) {} try { await fetch('http://127.0.0.1:9222/json/close/' + t.id); } catch (e) {} } };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 轮询等页面就绪（boot 完成、媒体池加载）——固定 sleep 在多标签/大素材下不可靠
async function waitReady(p, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await evalAsync(p, 'typeof loadFromDirHandle === "function" && typeof _objURLs === "object" && mediaPool && mediaPool.length > 0');
    if (ok === true) return true;
    await sleep(300);
  }
  return false;
}
function evalAsync(page, expr) {
  return new Promise(async (resolve) => {
    const res = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res && res.exceptionDetails) {
      const d = res.exceptionDetails;
      const desc = (d.exception && d.exception.description) || '';
      console.error('  [page exception] ' + d.text + ' ' + desc.split('\n')[0] + ' (line ' + (d.lineNumber + 1) + ')');
    }
    resolve(res && res.result ? res.result.value : undefined);
  });
}
// 模拟真实用户开始一局（选难度+时长+点开始）
async function startRun(p) {
  await evalAsync(p, `(() => { document.querySelector('[data-difficulty="Easy"]').click(); return true; })()`);
  await evalAsync(p, `(() => { const s = document.getElementById('duration-select'); s.value='5'; s.dispatchEvent(new Event('change')); document.getElementById('start-button').click(); return true; })()`);
}

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

  // ========== T1: 启动 + 清单加载 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(2500);
    const errs = p.events.filter(e => e.method === 'Runtime.exceptionThrown').length;
    check('T1 启动无 JS 异常', errs === 0, errs ? errs + ' exceptions' : '');
    const pool = await evalAsync(p, 'typeof mediaPool !== "undefined" && mediaPool ? mediaPool.length : 0');
    // manifest 209 条 - README.md 被扩展名过滤 = 208（若素材变动，请同步更新此预期值）
    check('T1 素材池加载', pool === 208, 'pool=' + pool);
    await p.close();
  }

  // ========== T2: 训练页剩余时间 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(2000);
    await evalAsync(p, `(() => { localStorage.setItem('cwm-last-selection-v1', JSON.stringify({difficulty:'Easy',minutes:5})); location.reload(); return true; })()`);
    await sleep(2000);
    await startRun(p);
    await sleep(1500);
    const s1 = await evalAsync(p, 'document.getElementById("game-summary").textContent');
    check('T2 训练页显示剩余时间', /剩余\s*\d+:\d\d/.test(s1 || ''), s1);
    await sleep(2100);
    const s2 = await evalAsync(p, 'document.getElementById("game-summary").textContent');
    const m1 = (s1.match(/剩余\s*(\d+):(\d\d)/) || []).slice(1).map(Number);
    const m2 = (s2.match(/剩余\s*(\d+):(\d\d)/) || []).slice(1).map(Number);
    const dec = (m1[0]*60+m1[1]) - (m2[0]*60+m2[1]);
    check('T2 剩余时间递减', dec >= 1 && dec <= 4, `${s1} -> ${s2}`);
    await p.close();
  }

  // ========== T3: 结束页累计统计 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(1800);
    await evalAsync(p, `(() => {
      localStorage.setItem('cwm-total-stats-v1', JSON.stringify({runs:3, tasks:57, ms:3600000}));
      const t = JSON.parse(localStorage.getItem('cwm-timing-v1') || '{}');
      t.successChancePct = 0; localStorage.setItem('cwm-timing-v1', JSON.stringify(t));
      localStorage.setItem('cwm-last-selection-v1', JSON.stringify({difficulty:'Easy',minutes:5}));
      location.reload(); return true; })()`);
    await sleep(2000);
    await startRun(p);
    await sleep(1200);
    // 注意：endsAt 必须比 taskEndsAt 先到（顺序反了 nextTask 会重置 taskEndsAt，永远不结算）
    await evalAsync(p, `(() => { session.endsAt = Date.now() + 300; session.taskEndsAt = Date.now() + 600; return true; })()`);
    await sleep(4000);
    const stats = await evalAsync(p, 'document.getElementById("ending-stats").textContent');
    check('T3 结束页含累计统计', /累计\s*4\s*轮/.test(stats || ''), stats);
    const saved = await evalAsync(p, 'localStorage.getItem("cwm-total-stats-v1")');
    check('T3 累计数据持久化', /"runs":4/.test(saved || ''), saved);
    await p.close();
  }

  // ========== T4: 奖励视频随机起点 + 速度 + 音量（直接构造奖励场景） ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(2000);
    await evalAsync(p, `(() => {
      // 直接改运行时 timing（boot 后改 localStorage 不生效）
      timing.rewardStartRandom = true; timing.rewardVideoMinutes = 0; timing.rewardSpeed = 1;
      applyTiming(); saveTimingLocal();
      // 拦截 currentTime setter（http.server 无 Range，seek 不真生效，验证请求值）
      const v = document.getElementById('reward-video');
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(v, 'currentTime', {
        set(x) { window.__seekReq = x; desc.set.call(this, x); },
        get() { return desc.get.call(this); }
      });
      // 固定单素材直接进奖励（绕过训练与随机抽取的不确定性）
      mediaPool = [{ src: '${LONG_VIDEO}', kind: 'video' }];
      startReward();
      return true; })()`);
    let isVideo = false, seekReq;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      isVideo = await evalAsync(p, '!document.getElementById("reward-video").hidden');
      seekReq = await evalAsync(p, 'window.__seekReq');
      if (isVideo && typeof seekReq === 'number') break;
    }
    check('T4 进入奖励（视频）', isVideo === true, 'isVideo=' + isVideo);
    const dur = await evalAsync(p, 'const v=document.getElementById("reward-video"); (isFinite(v.duration)?v.duration:0)');
    check('T4 视频时长可读（>30s 才随机）', typeof dur === 'number' && dur > 0, 'duration=' + dur);
    check('T4 随机起点已请求 seek', typeof seekReq === 'number' && seekReq > 0, `seekReq=${seekReq} dur=${dur}`);
    if (typeof seekReq === 'number' && dur > 30) {
      check('T4 随机起点在 0~80% 区间', seekReq >= 0 && seekReq <= dur * 0.8 + 0.5, `seekReq=${seekReq.toFixed(1)} dur=${dur}`);
    } else {
      check('T4 随机起点在 0~80% 区间', true, '（短视频未触发，跳过区间检查）');
    }
    const btnVis = await evalAsync(p, '!document.getElementById("reward-speed-button").hidden');
    check('T4 速度按钮可见', btnVis === true);
    const rate0 = await evalAsync(p, 'document.getElementById("reward-video").playbackRate');
    await evalAsync(p, 'document.getElementById("reward-speed-button").click()');
    const rate = await evalAsync(p, 'document.getElementById("reward-video").playbackRate');
    const btnTxt = await evalAsync(p, 'document.getElementById("reward-speed-button").textContent');
    check('T4 速度切换 1→1.25x', Math.abs(rate0 - 1) < 0.01 && Math.abs(rate - 1.25) < 0.01 && /1\.25x/.test(btnTxt), `rate0=${rate0} rate=${rate} btn=${btnTxt}`);
    await evalAsync(p, `(() => { const r = document.getElementById('reward-volume'); r.value = 40; r.dispatchEvent(new Event('input')); return true; })()`);
    const vol = await evalAsync(p, 'document.getElementById("reward-video").volume');
    const savedVol = await evalAsync(p, 'JSON.parse(localStorage.getItem("cwm-timing-v1")).rewardVolume');
    check('T4 奖励音量滑杆生效并持久化', Math.abs(vol - 0.4) < 0.01 && Math.abs(savedVol - 0.4) < 0.01, `vol=${vol} saved=${savedVol}`);
    await p.close();
  }

  // ========== T5: 背景音量滑杆 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(1800);
    await evalAsync(p, `(() => {
      timing.bgMuted = false; saveTimingLocal();
      localStorage.setItem('cwm-last-selection-v1', JSON.stringify({difficulty:'Easy',minutes:5}));
      location.reload(); return true; })()`);
    await sleep(2000);
    await startRun(p);
    await sleep(4500);
    await evalAsync(p, `(() => { const r = document.getElementById('bg-volume'); r.value = 25; r.dispatchEvent(new Event('input')); return true; })()`);
    const savedVol = await evalAsync(p, 'JSON.parse(localStorage.getItem("cwm-timing-v1")).bgVolume');
    const hasVideo = await evalAsync(p, 'typeof bgVidEl !== "undefined" && bgVidEl ? bgVidEl.volume : "no-video"');
    check('T5 背景音量持久化', Math.abs(savedVol - 0.25) < 0.01, `saved=${savedVol}`);
    check('T5 背景视频音量已应用', hasVideo === 0.25 || hasVideo === 'no-video', `vol=${hasVideo}`);
    await p.close();
  }

  // ========== T6: 设置页快捷键说明 + 随机起点复选框 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(2000);
    await evalAsync(p, `(() => { document.getElementById('settings-open-button').click(); return true; })()`);
    const txt = await evalAsync(p, 'document.getElementById("settings-page").innerText');
    check('T6 快捷键说明存在', /空格.*暂停.*N.*换奖励素材.*M/.test(txt || ''), '');
    const hasCk = await evalAsync(p, '!!document.getElementById("reward-start-random")');
    check('T6 随机起点复选框存在', hasCk === true);
    await evalAsync(p, `(() => { document.getElementById('reward-start-random').checked = true;
      document.getElementById('save-play-button').click(); return true; })()`);
    const summary = await evalAsync(p, 'document.getElementById("play-summary").textContent');
    check('T6 摘要显示随机起点', /随机起点/.test(summary || ''), summary);
    await p.close();
  }

  // ========== T7: loadFromDirHandle 契约（mock 目录句柄） ==========
  // 防「重复定义覆盖」与「职责混杂」回归：纯查找，不改 mediaPool，blob URL 已登记
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await waitReady(p);
    const r = await evalAsync(p, `(async () => {
      const mk = (name, type) => ({ kind: 'file', name, getFile: async () => new File([new Uint8Array(4)], name, { type }) });
      const mockHandle = {
        name: 'mockdir',
        queryPermission: async () => 'granted',
        values: () => (async function* () { yield mk('a.mp4','video/mp4'); yield mk('b.jpg','image/jpeg'); yield mk('c.txt','text/plain'); })()
      };
      const before = _objURLs.size;
      const poolBefore = mediaPool;
      const items = await loadFromDirHandle(mockHandle);
      return JSON.stringify({
        n: items ? items.length : 0,
        kinds: items ? items.map(x => x.kind).join(',') : '',
        urls: _objURLs.size - before,
        pooled: mediaPool === poolBefore,
        startsBlob: !!(items && items.length && items[0].src.startsWith('blob:'))
      });
    })()`);
    let s = {};
    try { s = JSON.parse(r || '{}'); } catch (e) {}
    check('T7 过滤非媒体文件（2/3）', s.n === 2, 'n=' + s.n);
    check('T7 kind 判定正确', s.kinds === 'video,image', s.kinds);
    check('T7 blob URL 已登记', s.urls === 2, 'urls=' + s.urls);
    check('T7 不改 mediaPool（纯查找）', s.pooled === true);
    check('T7 返回 blob: 地址', s.startsBlob === true);
    await p.close();
  }

  // ========== T8: 播放快捷键（←/→ seek，↑/↓ 音量；dispatch 必须在 document） ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await waitReady(p);
    await evalAsync(p, `(() => {
      timing.rewardStartRandom = false; timing.rewardVideoMinutes = 0; timing.rewardVolume = 0.5;
      applyTiming(); saveTimingLocal();
      const v = document.getElementById('reward-video');
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(v, 'currentTime', {
        set(x) { window.__seekReq = x; desc.set.call(this, x); },
        get() { return 50; }   // mock 固定值：无 Range 时真实 getter 恒 0，seek 断言无意义
      });
      mediaPool = [{ src: '${LONG_VIDEO}', kind: 'video' }];
      startReward();
      return true; })()`);
    // 等 metadata 就绪（!hidden 不够：duration 可能仍为 NaN，seekActiveVideo 的防御会直接 return）
    for (let i = 0; i < 24; i++) {
      const dur = await evalAsync(p, '(() => { const v = document.getElementById("reward-video"); return (isFinite(v.duration) && v.duration > 0) ? v.duration : 0; })()');
      if (typeof dur === 'number' && dur > 0) break;
      await sleep(500);
    }
    await evalAsync(p, 'document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true })); true');
    const req1 = await evalAsync(p, 'window.__seekReq');
    check('T8 → 快进 10s', req1 === 60, 'seekReq=' + req1);
    await evalAsync(p, 'document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true })); true');
    const req2 = await evalAsync(p, 'window.__seekReq');
    check('T8 ← 快退 10s', req2 === 40, 'seekReq=' + req2);   // mock getter 固定 50，-10 = 40
    await evalAsync(p, 'document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true })); true');
    const volUp = await evalAsync(p, `JSON.stringify({ v: document.getElementById('reward-video').volume, s: document.getElementById('reward-volume').value, t: JSON.parse(localStorage.getItem('cwm-timing-v1')).rewardVolume })`);
    check('T8 ↑ 音量 +10%（同步滑杆+持久化）', (() => { const s = JSON.parse(volUp || '{}'); return Math.abs(s.v - 0.6) < 0.01 && Number(s.s) === 60 && Math.abs(s.t - 0.6) < 0.01; })(), volUp);
    await evalAsync(p, 'document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown", bubbles: true })); true');
    const volDn = await evalAsync(p, 'JSON.parse(localStorage.getItem("cwm-timing-v1")).rewardVolume');
    check('T8 ↓ 音量 -10%', Math.abs(volDn - 0.5) < 0.01, 'saved=' + volDn);
    await p.close();
  }

  // ========== T9: 奖励图片淡入（data URL 图，断言 revealed class） ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await waitReady(p);
    await evalAsync(p, `(() => {
      timing.rewardVideoMinutes = 5;
      mediaPool = [{ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', kind: 'image' }];
      startReward();
      return true; })()`);
    let revealed = false;
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      revealed = await evalAsync(p, '(() => { const im = document.getElementById("reward-img"); return !im.hidden && im.classList.contains("revealed") && im.src.startsWith("data:image"); })()');
      if (revealed === true) break;
    }
    check('T9 奖励图片淡入 revealed', revealed === true);
    const prog = await evalAsync(p, '!document.getElementById("reward-progress").hidden');
    check('T9 图片模式任务进度条可见', prog === true);
    await p.close();
  }

  // ========== T10: 结束页清零累计统计 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await sleep(1800);
    await evalAsync(p, `(() => {
      localStorage.setItem('cwm-total-stats-v1', JSON.stringify({runs:5, tasks:99, ms:7200000}));
      const t = JSON.parse(localStorage.getItem('cwm-timing-v1') || '{}');
      t.successChancePct = 0; localStorage.setItem('cwm-timing-v1', JSON.stringify(t));
      localStorage.setItem('cwm-last-selection-v1', JSON.stringify({difficulty:'Easy',minutes:5}));
      location.reload(); return true; })()`);
    await sleep(2000);
    await startRun(p);
    await sleep(1200);
    await evalAsync(p, `(() => { session.endsAt = Date.now() + 300; session.taskEndsAt = Date.now() + 600; return true; })()`);
    await sleep(4000);
    const btnVis = await evalAsync(p, '!document.getElementById("stats-reset-button").hidden');
    check('T10 清零按钮可见（累计>1 轮）', btnVis === true);
    await evalAsync(p, `(() => { window.confirm = () => true; document.getElementById('stats-reset-button').click(); return true; })()`);
    const cleared = await evalAsync(p, 'localStorage.getItem("cwm-total-stats-v1")');
    const btnTxt = await evalAsync(p, 'document.getElementById("stats-reset-button").textContent');
    const statsLine = await evalAsync(p, 'document.getElementById("ending-stats").textContent');
    check('T10 点击后统计清零', /"runs":0/.test(cleared || ''), cleared);
    check('T10 按钮变已清零', /已清零/.test(btnTxt || ''), btnTxt);
    check('T10 结束页只留本轮行', !/累计/.test(statsLine || ''), statsLine);
    await p.close();
  }

  // ========== T11: 奖励视频模式任务卡进度条不隐藏且同步视频进度 ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await waitReady(p);
    await evalAsync(p, `(() => {
      timing.rewardStartRandom = false; timing.rewardVideoMinutes = 0;
      applyTiming(); saveTimingLocal();
      mediaPool = [{ src: '${LONG_VIDEO}', kind: 'video' }];
      startReward(); return true; })()`);
    // 等 metadata 就绪
    for (let i = 0; i < 24; i++) {
      const dur = await evalAsync(p, '(() => { const v = document.getElementById("reward-video"); return (isFinite(v.duration) && v.duration > 0) ? v.duration : 0; })()');
      if (typeof dur === 'number' && dur > 0) break;
      await sleep(500);
    }
    // mock currentTime 50/118.8，触发 timeupdate，验证任务卡进度条同步
    await evalAsync(p, `(() => {
      const v = document.getElementById('reward-video');
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(v, 'currentTime', { set(x) { desc.set.call(this, x); }, get() { return 50; } });
      v.dispatchEvent(new Event('timeupdate'));
      return true; })()`);
    const rpHidden = await evalAsync(p, 'document.getElementById("reward-progress").hidden');
    const rpVal = await evalAsync(p, 'document.getElementById("reward-progress").value');
    check('T11 任务卡进度条可见（视频模式）', rpHidden === false);
    check('T11 任务卡进度条同步视频进度', rpVal > 30 && rpVal < 55, 'value=' + rpVal + '（50/118.8≈42）');
    const vpVal = await evalAsync(p, 'document.getElementById("reward-video-progress").value');
    check('T11 与底部条同值', Math.abs(rpVal - vpVal) < 0.01, `rp=${rpVal} vp=${vpVal}`);
    await p.close();
  }

  // ========== T12: 任务卡拖动（手柄 pointer 拖拽 → left/top 变化 + 持久化 + 恢复） ==========
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=reg' + Date.now() });
    await waitReady(p);
    await evalAsync(p, `(() => {
      localStorage.setItem('cwm-last-selection-v1', JSON.stringify({difficulty:'Easy',minutes:5}));
      mediaPool = [{ src: 'media/gvp_087.mp4', kind: 'video' }];
      selectedDifficulty = 'Easy'; startSession(5); return true; })()`);
    await sleep(2500);
    const before = await evalAsync(p, `(() => { const r = document.getElementById('game-task-card').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    check('T12 默认位置居中底部', before.x > 200 && before.x < 400, JSON.stringify(before));
    // 整卡拖动（直接拖卡片主体空白处，pointerdown → move → up）
    await evalAsync(p, `(() => {
      const c = document.getElementById('game-task-card');
      const opts = (x, y) => ({ bubbles: true, pointerId: 7, clientX: x, clientY: y, button: 0 });
      c.dispatchEvent(new PointerEvent('pointerdown', opts(500, 600)));
      c.dispatchEvent(new PointerEvent('pointermove', opts(700, 300)));
      c.dispatchEvent(new PointerEvent('pointerup', opts(700, 300)));
      return true; })()`);
    await sleep(300);
    const after = await evalAsync(p, `(() => { const r = document.getElementById('game-task-card').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    check('T12 拖动后位置变化', Math.abs(after.x - before.x) > 100 && Math.abs(after.y - before.y) > 100, `before ${before.x},${before.y} -> after ${after.x},${after.y}`);
    const saved = await evalAsync(p, 'localStorage.getItem("cwm-task-card-pos-v1")');
    check('T12 位置已持久化', /"game":\{"x":\d+,"y":\d+\}/.test(saved || ''), saved);
    // 刷新后恢复
    await evalAsync(p, 'location.reload(); true');
    await sleep(2500);
    await evalAsync(p, `(() => {
      localStorage.setItem('cwm-last-selection-v1', JSON.stringify({difficulty:'Easy',minutes:5}));
      mediaPool = [{ src: 'media/gvp_087.mp4', kind: 'video' }];
      selectedDifficulty = 'Easy'; startSession(5); return true; })()`);
    await sleep(1500);
    const restored = await evalAsync(p, `(() => { const r = document.getElementById('game-task-card').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    check('T12 刷新后位置恢复', Math.abs(restored.x - after.x) < 3 && Math.abs(restored.y - after.y) < 3, `after ${after.x},${after.y} -> restored ${restored.x},${restored.y}`);
    // 双击手柄复位
    await evalAsync(p, `(() => { const h = document.querySelector('#game-task-card .card-handle'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
    await sleep(300);
    const reset = await evalAsync(p, `(() => { const r = document.getElementById('game-task-card').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
    check('T12 双击复位回默认', Math.abs(reset.x - before.x) < 3 && Math.abs(reset.y - before.y) < 3, `reset ${reset.x},${reset.y} vs before ${before.x},${before.y}`);
    await p.close();
  }

  const pass = results.filter(r => r.ok).length;
  console.log(`\n===== ${pass}/${results.length} PASS =====`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });

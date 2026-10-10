const BASE = 'http://127.0.0.1:8451';
async function newPage() {
  const t = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  return { send, close: async () => { try { ws.close(); } catch (e) {} try { await fetch('http://127.0.0.1:9222/json/close/' + t.id); } catch (e) {} } };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = (p, expr) => p.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }).then(r => {
  if (r.exceptionDetails) console.error('  [page exc]', r.exceptionDetails.text);
  return r.result ? r.result.value : undefined;
});
const rect = id => `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; })()`;
const overlap = (a, b) => a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
(async () => {
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

  // ---- 奖励页 ----
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=lay' + Date.now() });
    await sleep(400);
    await ev(p, "(() => { localStorage.setItem('cwm-age-verified-v1','1'); location.reload(); return true; })()");
    for (let i = 0; i < 30; i++) { const ok = await ev(p, 'typeof startReward === "function" && mediaPool && mediaPool.length > 0'); if (ok) break; await sleep(300); }
    await ev(p, `(() => { timing.rewardStartRandom = false; timing.rewardVideoMinutes = 0; timing.rewardChain = 3; applyTiming();
      mediaPool = [{ src: 'media/gvp_087.mp4', kind: 'video' }]; startReward(); return true; })()`);
    for (let i = 0; i < 24; i++) { const d = await ev(p, 'const v=document.getElementById("reward-video"); (isFinite(v.duration)&&v.duration>0)?v.duration:0'); if (d > 0) break; await sleep(500); }
    const speed = await ev(p, rect('reward-speed-button'));
    const vol = await ev(p, `(() => { const r = document.querySelector('.reward-vol-row').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; })()`);
    const skip = await ev(p, rect('reward-skip-button'));
    const counter = await ev(p, rect('reward-counter'));
    const card = await ev(p, `(() => { const r = document.querySelector('#reward-media').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
    check('奖励:速度按钮在卡片右上', speed.y - card.y < 60 && card.r - speed.r < 100, JSON.stringify({ card, speed }));
    check('奖励:音量行在卡片右下', card.b - vol.b < 60 && card.r - vol.r < 130, JSON.stringify({ card, vol }));
    check('奖励:换一个在卡片左下', card.b - skip.b < 60 && skip.x - card.x < 130, JSON.stringify({ card, skip }));
    check('奖励:计数在卡片顶部中', counter.y - card.y < 60 && Math.abs((counter.x + counter.w / 2) - (card.x + card.w / 2)) < 120, JSON.stringify({ card, counter }));
    check('奖励:换一个↔计数不重叠', !overlap(skip, counter));
    check('奖励:计数↔音量行不重叠', !overlap(counter, vol));
    check('奖励:计数↔速度按钮不重叠', !overlap(counter, speed));
    check('奖励:速度↔返回键不重叠', !(await ev(p, `(() => { const a = document.querySelector('#reward-page .game-back').getBoundingClientRect(); const b = document.getElementById('reward-speed-button').getBoundingClientRect(); return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom; })()`)));
    await p.close();
  }
  // ---- 训练页 ----
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=lay' + Date.now() });
    await sleep(400);
    await ev(p, "(() => { localStorage.setItem('cwm-age-verified-v1','1'); location.reload(); return true; })()");
    for (let i = 0; i < 30; i++) { const ok = await ev(p, 'typeof startSession === "function" && mediaPool && mediaPool.length > 0'); if (ok) break; await sleep(300); }
    await ev(p, `(() => { mediaPool = [{ src: 'media/gvp_087.mp4', kind: 'video' }]; selectedDifficulty = 'Easy'; startSession(5); return true; })()`);
    await sleep(4000);
    const ctl = await ev(p, `(() => { const r = document.querySelector('.game-controls').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; })()`);
    const summary = await ev(p, rect('game-summary'));
    check('训练:控件组右上', ctl.y < 80 && ctl.r > ctl.vw - 130, JSON.stringify(ctl));
    check('训练:控件组含滑杆+2按钮宽度合理', ctl.w > 180 && ctl.w < 320, 'w=' + ctl.w);
    check('训练:剩余时间胶囊顶部中间', summary.y < 80 && summary.x > 200 && summary.r < summary.vw - 200, JSON.stringify(summary));
    await p.close();
  }
  // ---- 结束页 ----
  {
    const p = await newPage();
    await p.send('Page.navigate', { url: BASE + '/index.html?v=lay' + Date.now() });
    await sleep(400);
    await ev(p, "(() => { localStorage.setItem('cwm-age-verified-v1','1'); location.reload(); return true; })()");
    for (let i = 0; i < 30; i++) { const ok = await ev(p, 'typeof displayResult === "function"'); if (ok) break; await sleep(300); }
    await ev(p, `(() => { localStorage.setItem('cwm-total-stats-v1', JSON.stringify({runs:12, tasks:203, ms:45600000}));
      runStats = { tasks: 18, startedAt: Date.now() - 300000, elapsed: 300000 }; displayResult('success'); return true; })()`);
    await sleep(400);
    const stats = await ev(p, `(() => { const el = document.getElementById('ending-stats'); const r = el.getBoundingClientRect(); return { txt: el.textContent, h: r.height, vis: !el.hidden && r.height >= 38 }; })()`);
    const btn = await ev(p, rect('stats-reset-button'));
    check('结束:统计两行(高度≥38)', stats.vis === true && stats.h >= 38 && /累计/.test(stats.txt), JSON.stringify(stats));
    check('结束:清零按钮可见居中', btn.w > 40 && btn.x > 400 && btn.r < btn.vw - 400, JSON.stringify(btn));
    await p.close();
  }
  console.log(fails === 0 ? '===== 布局 15/15 PASS =====' : `===== 布局有 ${fails} 项 FAIL =====`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });

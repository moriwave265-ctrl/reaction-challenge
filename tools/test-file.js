// file:// 双击场景验证：桌面单文件版 + media 软链 + 相对路径素材
// 前置：python3 tools/build_single.py --copy-desktop 已执行；CDP 9222
// 用法：node tools/test-file.js [file://路径]（默认 ~/桌面/反应挑战.html）
const TARGET = process.argv[2] || 'file://' + process.env.HOME + '/桌面/反应挑战.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
(async () => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };
  const p = await newPage();
  await p.send('Page.navigate', { url: TARGET });
  await sleep(2500);
  const errs = p.events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  check('F1 file:// 启动无异常', errs === 0, errs ? errs + ' exceptions' : '');
  const pool = await new Promise(async r => { const res = await p.send('Runtime.evaluate', { expression: 'typeof mediaPool !== "undefined" && mediaPool ? mediaPool.length : 0', returnByValue: true }); r(res.result.value); });
  check('F2 file:// 内嵌清单加载', pool === 208, 'pool=' + pool);
  // 真实视频可播（file:// 直读，支持 seek，比 http.server 强）
  await p.send('Runtime.evaluate', { expression: `(() => {
    timing.rewardStartRandom = false; applyTiming();
    mediaPool = [{ src: 'media/gvp_087.mp4', kind: 'video' }];
    startReward(); return true; })()`, returnByValue: true });
  await sleep(4000);
  const st = await new Promise(async r => { const res = await p.send('Runtime.evaluate', { expression: `JSON.stringify({
    hidden: document.getElementById('reward-video').hidden,
    rs: document.getElementById('reward-video').readyState,
    dur: isFinite(document.getElementById('reward-video').duration) ? document.getElementById('reward-video').duration : -1 })`, returnByValue: true }); r(res.result.value); });
  const s = JSON.parse(st);
  check('F3 file:// 视频可加载播放', s.rs >= 2 && s.dur > 0, st);
  await p.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`===== file:// 场景 ${pass}/${results.length} PASS =====`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

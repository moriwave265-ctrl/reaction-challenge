// 单文件版验证（http 模式）：challenge.html 内嵌清单 + 功能冒烟
// 前置：python3 tools/build_single.py 已构建；静态服务 8451 在项目根；CDP 9222
// 用法：node tools/test-single.js [BASE_URL]
const BASE = process.argv[2] || 'http://127.0.0.1:8451';
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
  await p.send('Page.navigate', { url: BASE + '/challenge.html?v=' + Date.now() });
  await sleep(2500);
  const errs = p.events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  check('S1 单文件版启动无 JS 异常', errs === 0, errs ? errs + ' exceptions' : '');
  const pool = await new Promise(async r => { const res = await p.send('Runtime.evaluate', { expression: 'typeof mediaPool !== "undefined" && mediaPool ? mediaPool.length : 0', returnByValue: true }); r(res.result.value); });
  check('S2 内嵌清单生效（208 素材）', pool === 208, 'pool=' + pool);
  const src = await new Promise(async r => { const res = await p.send('Runtime.evaluate', { expression: 'mediaSourceName', returnByValue: true }); r(res.result.value); });
  check('S3 素材源名称', /内嵌清单/.test(src || ''), src);
  await p.send('Runtime.evaluate', { expression: `(() => {
    timing.rewardStartRandom = false; timing.rewardSpeed = 1; applyTiming();
    mediaPool = [{ src: 'media/gvp_087.mp4', kind: 'video' }];
    startReward(); return true; })()`, returnByValue: true });
  await sleep(4000);
  const vis = await new Promise(async r => { const res = await p.send('Runtime.evaluate', { expression: '!document.getElementById("reward-video").hidden && !document.getElementById("reward-speed-button").hidden', returnByValue: true }); r(res.result.value); });
  check('S4 奖励视频+速度按钮正常', vis === true);
  const volRow = await new Promise(async r => { const res = await p.send('Runtime.evaluate', { expression: '!!document.querySelector(".reward-vol-row .vol-slider")', returnByValue: true }); r(res.result.value); });
  check('S5 奖励音量滑杆存在', volRow === true);
  await p.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`===== 单文件版 ${pass}/${results.length} PASS =====`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

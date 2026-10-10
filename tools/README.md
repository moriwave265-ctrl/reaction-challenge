# 开发与测试

## 测试环境

```bash
# 1) 静态服务（必须 cd 到项目根，否则 js 404、media 拿不到）
cd <项目根> && python3 -m http.server 8451

# 2) CDP headless Chrome（9222 端口；临时 profile 即可，不需要登录态）
/opt/google/chrome/chrome --remote-debugging-port=9222 \
  --user-data-dir=/tmp/cdp-cwm-test --no-first-run --no-default-browser-check \
  --headless=new --window-size=1280,800 about:blank &
```

服务与 Chrome 都是长驻进程，测试完记得关。

## 跑测试

```bash
node tools/regression.js            # 主回归 41 项（功能全量）
python3 tools/build_single.py       # 构建单文件版 challenge.html
node tools/test-single.js           # 单文件版（http）5 项
node tools/layout.js                # 布局验收 15 项（控件位置/不重叠；bump CSS 版本后跑）
python3 tools/build_single.py --copy-desktop   # 构建并拷贝桌面 + 建 media 软链
node tools/test-file.js             # file:// 双击场景 3 项（默认验 ~/桌面/反应挑战.html）
```

## 已知坑（写用例前必读，都是踩过的）

1. **http.server 无 Range** → `video.currentTime = x` 赋值不生效（seekable 为空）。测 seek 用 `Object.defineProperty` 拦截 currentTime setter，验证「请求的目标值」。
2. **测视频功能选长素材**（>30s，如 `gvp_087.mp4`）。`gcf_033.mp4` 只有 1.3 秒：播完立即连播→结算→页面隐藏，用例全挂。
3. **快速结算 hack 的时序**：`session.endsAt` 必须比 `taskEndsAt` **先**到。顺序反了 taskEndsAt 先到期会被 nextTask 重置成 +5~15s，「双到点」条件永远凑不齐。
4. **boot 后改 localStorage 不影响已加载的运行时 timing** → 用例里直接改运行时变量：`timing.xxx = ...; applyTiming(); saveTimingLocal();`（或 preset 后 reload）。
5. **UI 操作走真实控件**：`select.value = '5'` 不触发 change；要么 `dispatchEvent(new Event('change'))`，要么点真实按钮。
6. **合成键盘事件** dispatch 在 `document`（监听在 document；从 target 向上冒泡，不会向下）。
7. **改前端必须 bump `index.html` 的 `?v=`**（style.css / script.js 各一处），否则浏览器磁盘缓存命中旧文件。
8. **exec/终端里 `nohup cmd &` 的进程会随 shell 退出被杀** → 长驻服务用受管的后台机制起。

## 改动 checklist

1. `node --check script.js`
2. 起服务 + CDP，`node tools/regression.js` 全绿
3. 涉及单文件版：`python3 tools/build_single.py --copy-desktop` + `node tools/test-single.js` + `node tools/test-file.js`
4. 提交推送（`media/` 与 `challenge.html` 已 gitignore，不入库）

## 架构速查

见 `script.js` 顶部注释（文件结构 / 分区 / 不变式）。核心不变式：

- `mediaPool` 只经 `setMediaPool()` 替换（blob URL 统一登记/回收）
- `timing` 是唯一设置来源；改后必 `applyTiming()` + `saveTimingLocal()`
- 暂停 = 时间戳平移（`togglePause`），新增计时字段要同步平移

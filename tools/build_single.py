#!/usr/bin/env python3
"""构建单文件版 challenge.html：内联 CSS/JS + 注入内嵌素材清单。

产物：challenge.html（项目根目录）。与 media/ 文件夹放在一起即可双击使用
（素材相对路径直引，无需选目录）。清单来自 media/manifest.json。

用法：
    python3 tools/build_single.py                 # 构建到项目根
    python3 tools/build_single.py --copy-desktop  # 构建并拷贝到 ~/桌面/反应挑战.html
                                                  # （桌面无 media 链接时自动创建软链）
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESKTOP = os.path.join(os.path.expanduser("~"), "桌面")


def build():
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fp:
        html = fp.read()
    with open(os.path.join(ROOT, "style.css"), encoding="utf-8") as fp:
        css = fp.read()
    with open(os.path.join(ROOT, "script.js"), encoding="utf-8") as fp:
        js = fp.read()

    # 内嵌素材清单（media/manifest.json，字符串数组）
    mpath = os.path.join(ROOT, "media", "manifest.json")
    items = []
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as fp:
            raw = json.load(fp)
        items = [x for x in raw if isinstance(x, str)]
    embed = "window.__EMBEDDED_MEDIA = " + json.dumps(items, ensure_ascii=False) + ";"

    # 安全检查：内联内容不能包含闭合标签
    for name, content in (("style.css", css), ("script.js", js)):
        closing = "</style>" if name == "style.css" else "</script>"
        if closing in content:
            sys.exit(f"错误：{name} 含 {closing}，不能直接内联")

    # 1) 去掉 head 里的外链
    html = re.sub(r'<link rel="stylesheet" href="style\.css[^"]*">',
                  "<style>\n" + css + "\n</style>", html)
    html = re.sub(r'<script src="script\.js[^"]*" defer></script>', "", html)

    # 2) body 末尾注入内嵌清单 + 脚本（原 defer 语义：DOM 就绪后执行）
    inline = "<script>\n" + embed + "\n" + js + "\n</script>\n</body>"
    if "</body>" not in html:
        sys.exit("错误：index.html 缺少 </body>")
    html = html.replace("</body>", inline, 1)

    out = os.path.join(ROOT, "challenge.html")
    with open(out, "w", encoding="utf-8") as fp:
        fp.write(html)
    print(f"✅ 构建 {out}（{len(html) // 1024} KB，内嵌 {len(items)} 条素材清单）")
    return out


def copy_desktop(src):
    os.makedirs(DESKTOP, exist_ok=True)
    dst = os.path.join(DESKTOP, "反应挑战.html")
    shutil.copy2(src, dst)
    # 桌面 media 软链（素材不拷贝，931MB 用软链共享）
    dmedia = os.path.join(DESKTOP, "media")
    if not os.path.exists(dmedia):
        os.symlink(os.path.join(ROOT, "media"), dmedia)
        print(f"✅ 创建桌面软链 {dmedia} → {ROOT}/media")
    print(f"✅ 已拷贝到 {dst}（旁边的 media/ 软链已就绪）")


if __name__ == "__main__":
    out = build()
    if "--copy-desktop" in sys.argv:
        copy_desktop(out)

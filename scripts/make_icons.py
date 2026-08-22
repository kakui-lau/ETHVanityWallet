#!/usr/bin/env python3
"""从 Logo 源（public/logo_source.png，缺失则用 public/logo_source.svg 转 PNG）生成完整图标组。
优先级：
  1. public/logo_source.png 存在 → 直接用
  2. 否则 public/logo_source.svg 存在 → 用 svg2png.py 先转 1024 再缩放
  3. 否则报错（让用户放 logo_source.png）
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
SRC_PNG = ROOT / "public" / "logo_source.png"
SRC_SVG = ROOT / "public" / "logo_source.svg"
SCRIPT_SRC_PNG = SCRIPTS / "public" / "logo_source.png"
OUT = ROOT / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC = ROOT / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)

# 1) 选定最终要用到的 1024 源 PNG
TMP = Path(tempfile.mkdtemp(prefix="vanity-icon-"))
src_1024_png = TMP / "__icon_1024_source__.png"

if SCRIPT_SRC_PNG.exists():
    shutil.copyfile(SCRIPT_SRC_PNG, SRC_PNG)
    shutil.copyfile(SCRIPT_SRC_PNG, src_1024_png)
    print(f"[SRC] 使用脚本目录 PNG 源并同步到 public: {SCRIPT_SRC_PNG}")
elif SRC_PNG.exists():
    shutil.copyfile(SRC_PNG, src_1024_png)
    print(f"[SRC] 使用 PNG 源: {SRC_PNG}")
elif SRC_SVG.exists():
    print(f"[SRC] logo_source.png 缺失，尝试把 {SRC_SVG} 转成 1024×1024 PNG…")
    r = subprocess.run(
        [sys.executable, str(SCRIPTS / "svg2png.py"), str(SRC_SVG), str(src_1024_png), "1024"],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not src_1024_png.exists():
        print(
            f"[ERR] SVG→PNG 转换失败。请把你那张霓虹 Logo 另存为 PNG 放到：\n"
            f"      {SRC_PNG}\n"
            f"      或安装 Pillow/cairosvg/librsvg 之一后重试。\n"
            f"      详情：{r.stdout}{r.stderr}",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"[OK] 已通过 SVG 生成 1024 源图。")
else:
    print(
        f"[ERR] 未找到任何 Logo 源文件。\n"
        f"      请把你的霓虹 Logo PNG 放到：\n"
        f"          {SRC_PNG}\n"
        f"      （或 SVG 放到 {SRC_SVG}）",
        file=sys.stderr,
    )
    sys.exit(1)

# 2) 把 gen_icons_from_logo.py 的核心逻辑调一下：我们直接调用它，但把源图路径改成 src_1024_png。
#    为了最小改动，这里临时把 src_1024_png 拷贝到 public/logo_source.png 的位置（仅当用户原始 PNG 不存在时）。
cleanup_png_after = False
if not SRC_PNG.exists():
    shutil.copyfile(src_1024_png, SRC_PNG)
    cleanup_png_after = True
    print(f"[TMP] 已把生成的 1024 PNG 暂存为 logo_source.png 供 gen_icons_from_logo.py 使用")

try:
    r = subprocess.run(
        [sys.executable, str(SCRIPTS / "gen_icons_from_logo.py")],
        text=True,
        cwd=str(ROOT),
    )
    if r.returncode != 0:
        sys.exit(r.returncode)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

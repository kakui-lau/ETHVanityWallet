#!/usr/bin/env python3
"""把 src/components/icons/VanityLogo.tsx 里导出的 VANITY_LOGO_SVG_STRING 提取出来，
写入 public/logo_source.svg 作为图标生成的默认源；并提供给其他脚本复用。
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "components" / "icons" / "VanityLogo.tsx"
PUBLIC = ROOT / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)

if not SRC.exists():
    print(f"[ERR] 找不到 {SRC}，先把 VanityLogo.tsx 文件准备好再运行", file=sys.stderr)
    sys.exit(1)

text = SRC.read_text(encoding="utf-8")
m = re.search(r"VANITY_LOGO_SVG_STRING\s*=\s*`([\s\S]*?)`;", text)
if not m:
    print("[ERR] 未在 VanityLogo.tsx 里找到 VANITY_LOGO_SVG_STRING 的模板字符串", file=sys.stderr)
    sys.exit(2)

svg = m.group(1).strip()
dst_svg = PUBLIC / "logo_source.svg"
dst_svg.write_text(svg, encoding="utf-8")
print(f"[OK] 已把内嵌 Logo SVG 写出到: {dst_svg}  ({len(svg)} bytes)")

# 同步拷贝一个 logo.svg 别名，给其他地方调用方便
(PUBLIC / "logo.svg").write_text(svg, encoding="utf-8")
print(f"[OK] 已复制别名: public/logo.svg")

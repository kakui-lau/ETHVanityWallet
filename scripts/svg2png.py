#!/usr/bin/env python3
"""SVG → PNG 光栅化（macOS 自带 rsvg-convert / cairosvg / ImageMagick 均无则用 sips 的
   SVG -> PNG fallback via `qlmanage -t`（macOS 自带 Quick Look 转换器）。
   提供给 gen_icons_from_logo.py 在无 Pillow + logo_source.png 缺失但有 logo_source.svg 时使用。
"""
from __future__ import annotations
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _try_cairosvg(svg: Path, dst: Path, size: int) -> bool:
    try:
        import cairosvg  # type: ignore
    except Exception:
        return False
    cairosvg.svg2png(
        bytestring=svg.read_bytes(),
        write_to=str(dst),
        output_width=size,
        output_height=size,
    )
    return True


def _try_rsvg(svg: Path, dst: Path, size: int) -> bool:
    exe = shutil.which("rsvg-convert")
    if not exe:
        return False
    subprocess.check_call(
        [exe, "-w", str(size), "-h", str(size), "-o", str(dst), str(svg)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return True


def _try_magick(svg: Path, dst: Path, size: int) -> bool:
    exe = shutil.which("magick") or shutil.which("convert")
    if not exe:
        return False
    subprocess.check_call(
        [exe, "-density", "400", "-resize", f"{size}x{size}", "-background", "none", str(svg), str(dst)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return True


def _try_qlmanage(svg: Path, dst: Path, size: int) -> bool:
    """macOS 自带 Quick Look 生成缩略图，对 SVG 有基本支持（无任何外部依赖）。
    输出文件名是 <name>.png.png，需要二次改名 & 再用 sips 缩放到精确 size。"""
    if sys.platform != "darwin":
        return False
    exe = shutil.which("qlmanage")
    if not exe:
        return False
    with tempfile.TemporaryDirectory(prefix="qlsvg-") as td:
        td = Path(td)
        work_svg = td / "vanity.svg"
        work_svg.write_bytes(svg.read_bytes())
        try:
            subprocess.check_call(
                [exe, "-t", "-s", str(max(size, 512)), "-o", str(td), str(work_svg)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            return False
        out = td / "vanity.svg.png"
        if not out.exists():
            # macOS 某些版本命名为 vanity.png
            alt = td / "vanity.png"
            if alt.exists():
                out = alt
            else:
                return False
        # sips 精确到目标 size
        if shutil.which("sips"):
            subprocess.check_call(
                ["sips", "-z", str(size), str(size), "--padToHeightWidth", str(size), str(size),
                 "--setProperty", "format", "png", str(out), "--out", str(dst)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        else:
            shutil.copyfile(out, dst)
    return dst.exists() and dst.stat().st_size > 0


def svg2png(svg: Path, dst: Path, size: int) -> bool:
    """尝试多种 SVG→PNG 方式；返回 True 代表成功。"""
    for fn in (_try_cairosvg, _try_rsvg, _try_magick, _try_qlmanage):
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if fn(svg, dst, size):
                if dst.exists() and dst.stat().st_size > 0:
                    return True
        except Exception:
            continue
    return False


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("usage: svg2png.py INPUT.svg OUTPUT.png SIZE", file=sys.stderr)
        sys.exit(2)
    src = Path(sys.argv[1]).expanduser().resolve()
    dst = Path(sys.argv[2]).expanduser().resolve()
    s = int(sys.argv[3])
    ok = svg2png(src, dst, s)
    if not ok:
        print(f"[FAIL] 无法把 {src} 转为 {dst} ({s}x{s})。请安装 Pillow 或 cairosvg 或 librsvg 后重试。", file=sys.stderr)
        sys.exit(1)
    print(f"[OK] {dst}  {s}x{s}")

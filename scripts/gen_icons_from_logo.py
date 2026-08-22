#!/usr/bin/env python3
"""从 public/logo_source.png 生成完整 Tauri 图标组
    icons/{32x32,128x128,128x128@2x(256),16,24,48,256,512,1024,icon(512),tray-icon(32)}.png
    + icons/icon.ico (Windows, 16/24/32/48/64/128/256)
    + icons/icon.icns (macOS, 1024 源交给 iconutil)
    + public/favicon.ico (16/32/48)

优先使用 Pillow；如果 Pillow 缺失，自动使用 macOS 原生工具：
    sips 缩放 PNG
    iconutil 生成 .icns
    手动组装 .ico (兼容 16~256 8bit/pixel 的 BMP DIB)
这样用户无需 `pip3 install Pillow` 也能跑通。
"""
from __future__ import annotations

import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "logo_source.png"
OUT = ROOT / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC = ROOT / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)


# ---------- 图像缩放抽象层：try Pillow, fallback to sips ----------
class Resizer:
    def __init__(self):
        self.pil = None
        try:
            from PIL import Image  # type: ignore
            self.pil = Image
        except Exception:
            self.pil = None

    @property
    def has_pil(self):
        return self.pil is not None

    def probe(self, path: Path) -> tuple[int, int]:
        if self.pil is not None:
            with self.pil.open(path) as im:
                return im.size
        # sips -g pixelWidth -g pixelHeight file
        out = subprocess.check_output(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
            text=True,
        )
        w = h = 0
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("pixelWidth:"):
                w = int(line.split(":", 1)[1].strip())
            elif line.startswith("pixelHeight:"):
                h = int(line.split(":", 1)[1].strip())
        return w, h

    def resize_png(self, src: Path, dst: Path, size: int):
        if self.pil is not None:
            with self.pil.open(src) as im:
                im = im.convert("RGBA")
                im.thumbnail((size, size), self.pil.Resampling.LANCZOS)
                canvas = self.pil.new("RGBA", (size, size), (0, 0, 0, 0))
                pos = ((size - im.size[0]) // 2, (size - im.size[1]) // 2)
                canvas.paste(im, pos, im)
                canvas.save(dst, format="PNG", optimize=True)
            return
        # sips: 先放 temp，然后 sips --resampleWidth size -s format png
        dst.parent.mkdir(parents=True, exist_ok=True)
        # sips 会把图像等比缩放到 size，然后我们用 --padToHeightWidth/--cropToHeightWidth 对齐到正方形
        subprocess.check_call(
            [
                "sips",
                "-z",
                str(size),
                str(size),
                "--padToHeightWidth",
                str(size),
                str(size),
                "--setProperty",
                "format",
                "png",
                str(src),
                "--out",
                str(dst),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


# ---------- ICO 手写组装（不需要 Pillow）----------
# 支持 16~256 尺寸的 PNG 数据直接塞进 ICO（Vista+ 都认 PNG-in-ICO）
def build_ico(png_files: list[Path], dst: Path):
    """写入 ICO：PNG 存储格式（兼容性广，16~256 都合法）"""
    entries: list[bytes] = []
    headers_size = 6 + 16 * len(png_files)
    offset = headers_size
    for f in png_files:
        data = f.read_bytes()
        # 16~256 尺寸可直接塞进 icDirEntry：宽度字节（256 表示 0）/ 高度字节 / 色彩 0 / 保留 0 / 平面 1 / BPP 32 / 大小 / 偏移
        try:
            from PIL import Image  # type: ignore
            with Image.open(f) as im:
                w, h = im.size
        except Exception:
            out = subprocess.check_output(
                ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(f)],
                text=True,
            )
            w = h = 0
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("pixelWidth:"):
                    w = int(line.split(":", 1)[1].strip())
                elif line.startswith("pixelHeight:"):
                    h = int(line.split(":", 1)[1].strip())
        wb = 0 if w >= 256 else w
        hb = 0 if h >= 256 else h
        entry = struct.pack(
            "<BBBBHHII",
            wb,
            hb,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        entries.append(entry + data)
        offset += len(data)

    with open(dst, "wb") as f:
        # ICONDIR
        f.write(struct.pack("<HHH", 0, 1, len(png_files)))
        # 先写纯 entry header（16 bytes each），再写 PNG payload
        pos = headers_size
        for f2 in png_files:
            data = f2.read_bytes()
            try:
                from PIL import Image  # type: ignore
                with Image.open(f2) as im:
                    w, h = im.size
            except Exception:
                out = subprocess.check_output(
                    ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(f2)],
                    text=True,
                )
                w = h = 0
                for line in out.splitlines():
                    line = line.strip()
                    if line.startswith("pixelWidth:"):
                        w = int(line.split(":", 1)[1].strip())
                    elif line.startswith("pixelHeight:"):
                        h = int(line.split(":", 1)[1].strip())
            wb = 0 if w >= 256 else w
            hb = 0 if h >= 256 else h
            f.write(struct.pack("<BBBBHHII", wb, hb, 0, 0, 1, 32, len(data), pos))
            pos += len(data)
        for f2 in png_files:
            f.write(f2.read_bytes())


# ---------- ICNS 生成：优先 Pillow 写 1024 源 → iconutil ----------
def build_icns(src_1024: Path, dst: Path, resizer: Resizer, tmp: Path):
    set_names = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    iconset = tmp / "AppIcon.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    for name, s in set_names:
        resizer.resize_png(src_1024, iconset / name, s)
    # iconutil 是 macOS 自带的
    subprocess.check_call(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(dst)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    if not SRC.exists():
        print(
            f"[ERR] 请先把 Logo PNG 放到: {SRC}\n"
            f"      （建议原始图片 ≥ 1024×1024，带透明背景的 PNG 最佳）",
            file=sys.stderr,
        )
        sys.exit(1)

    resizer = Resizer()
    if resizer.has_pil:
        print(f"[OK] 使用 Pillow 处理图像")
    else:
        if sys.platform != "darwin":
            print(
                "[ERR] 未检测到 Pillow 且当前不是 macOS，无法使用 sips/iconutil 兜底。\n"
                "      请先执行： pip3 install Pillow\n"
                "      然后再次运行 npm run gen:icons",
                file=sys.stderr,
            )
            sys.exit(2)
        if not shutil.which("sips") or not shutil.which("iconutil"):
            print(
                "[ERR] macOS 缺少 sips/iconutil 系统工具（通常在正常系统上自带）。\n"
                "      建议直接执行： pip3 install Pillow  后重试。",
                file=sys.stderr,
            )
            sys.exit(3)
        print(f"[OK] 未安装 Pillow，自动切换为 macOS 原生 sips + iconutil")

    w, h = resizer.probe(SRC)
    print(f"[SRC] {SRC.name}  {w}x{h}")

    # 生成标准 PNG 尺寸
    std = [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (16, "16x16.png"),
        (24, "24x24.png"),
        (48, "48x48.png"),
        (256, "256x256.png"),
        (512, "512x512.png"),
        (1024, "1024x1024.png"),
        (512, "icon.png"),
        (32, "tray-icon.png"),
    ]
    for s, name in std:
        resizer.resize_png(SRC, OUT / name, s)
        print(f"  ✓ icons/{name}  {s}x{s}")

    tauri_aliases = {
        "32x32.png": "icon_32x32.png",
        "128x128.png": "icon_128x128.png",
        "128x128@2x.png": "icon_128x128@2x.png",
        "256x256.png": "icon_256x256.png",
        "512x512.png": "icon_512x512.png",
        "1024x1024.png": "icon_1024x1024.png",
    }
    for src_name, alias_name in tauri_aliases.items():
        shutil.copyfile(OUT / src_name, OUT / alias_name)
        print(f"  ✓ icons/{alias_name} （Tauri alias）")

    # 生成 ICO 尺寸候选（Windows .ico 推荐尺寸集合）
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    tmpd = Path(tempfile.mkdtemp(prefix="vanity-icon-"))
    ico_parts = []
    for s in ico_sizes:
        p = OUT / f"{s}x{s}.png"
        resizer.resize_png(SRC, p, s)
        print(f"  ✓ icons/{p.name}  {s}x{s}")
        ico_parts.append(p)
    build_ico(ico_parts, OUT / "icon.ico")
    print("  ✓ icons/icon.ico （Windows 多尺寸）")

    build_icns(SRC, OUT / "icon.icns", resizer, tmpd)
    print("  ✓ icons/icon.icns （macOS）")

    # public/favicon.ico (16/32/48)
    fav_parts = []
    for s in (16, 32, 48):
        p = OUT / f"{s}x{s}.png"
        fav_parts.append(p)
    build_ico(fav_parts, PUBLIC / "favicon.ico")
    print(f"  ✓ public/favicon.ico")

    # 清理临时目录
    shutil.rmtree(tmpd, ignore_errors=True)
    print(
        "\n[DONE] 图标生成完成。下一步：重启 tauri dev 或执行 npm run tauri:build 生效。"
    )


if __name__ == "__main__":
    main()

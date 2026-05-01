import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "assets" / "brand" / "tcger-icon.svg"
APP_ICON_DIR = REPO_ROOT / "mobile-apps" / "ios" / "TCGer" / "TCGer" / "Assets.xcassets" / "AppIcon.appiconset"

SVG_TARGETS = [
    REPO_ROOT / "frontend" / "public" / "logo.svg",
    REPO_ROOT / "frontend" / "public" / "favicon.svg",
    REPO_ROOT / "frontend" / "app" / "icon.svg",
    REPO_ROOT / "docs" / "logo.svg",
    REPO_ROOT / "marketing-site" / "public" / "logo.svg",
    REPO_ROOT / "marketing-site" / "dist" / "logo.svg",
]

PNG_TARGETS = {
    APP_ICON_DIR / "app-icon-1024.png": 1024,
    APP_ICON_DIR / "icon-512.png": 512,
    APP_ICON_DIR / "icon-256.png": 256,
    APP_ICON_DIR / "icon-128.png": 128,
    APP_ICON_DIR / "icon-64.png": 64,
    APP_ICON_DIR / "icon-32.png": 32,
    APP_ICON_DIR / "icon-16.png": 16,
    REPO_ROOT / "frontend" / "app" / "icon.png": 32,
}

APP_ICON_PADDING = 176


def render_svg(source: Path, size: int, padding: int = APP_ICON_PADDING) -> Image.Image:
    qlmanage = shutil.which("qlmanage")
    if not qlmanage:
        raise RuntimeError("qlmanage is required to rasterize SVG app icons on macOS.")

    art_size = size - (padding * 2)
    if art_size <= 0:
        raise ValueError("padding leaves no drawable area")

    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp)
        subprocess.run(
            [qlmanage, "-t", "-s", str(art_size), "-o", str(output_dir), str(source)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        rendered = output_dir / f"{source.name}.png"
        if not rendered.exists():
            matches = list(output_dir.glob("*.png"))
            if not matches:
                raise RuntimeError(f"qlmanage did not produce a PNG for {source}")
            rendered = matches[0]

        image = Image.open(rendered).convert("RGBA")

    image.thumbnail((art_size, art_size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    canvas.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))

    # Xcode app icons should be opaque. Keep a white backing for transparent SVG regions.
    background = Image.new("RGBA", canvas.size, (255, 255, 255, 255))
    background.alpha_composite(canvas)
    return background.convert("RGB")


def sync_svg(source: Path) -> None:
    svg = source.read_text()
    for target in SVG_TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(svg)


def sync_pngs(source: Path) -> None:
    largest = render_svg(source, 1024)
    for target, size in PNG_TARGETS.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        image = largest if size == 1024 else largest.resize((size, size), Image.Resampling.LANCZOS)
        image.save(target)


def sync_contents_json() -> None:
    contents_path = APP_ICON_DIR / "Contents.json"
    contents = json.loads(contents_path.read_text())

    for image in contents.get("images", []):
        size = image.get("size")
        scale = image.get("scale", "1x")
        filename = None
        if size == "1024x1024":
            filename = "app-icon-1024.png"
        elif size == "16x16" and scale == "1x":
            filename = "icon-16.png"
        elif size == "16x16" and scale == "2x":
            filename = "icon-32.png"
        elif size == "32x32" and scale == "1x":
            filename = "icon-32.png"
        elif size == "32x32" and scale == "2x":
            filename = "icon-64.png"
        elif size == "128x128" and scale == "1x":
            filename = "icon-128.png"
        elif size == "128x128" and scale == "2x":
            filename = "icon-256.png"
        elif size == "256x256" and scale == "1x":
            filename = "icon-256.png"
        elif size == "256x256" and scale == "2x":
            filename = "icon-512.png"
        elif size == "512x512" and scale == "1x":
            filename = "icon-512.png"
        elif size == "512x512" and scale == "2x":
            filename = "app-icon-1024.png"

        if filename:
            image["filename"] = filename

    contents_path.write_text(json.dumps(contents, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync the TCGer SVG brand icon across platform assets.")
    parser.add_argument("source", nargs="?", default=DEFAULT_SOURCE, type=Path)
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    if not source.exists():
        raise FileNotFoundError(source)

    sync_svg(source)
    sync_pngs(source)
    sync_contents_json()


if __name__ == "__main__":
    main()

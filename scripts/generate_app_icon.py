import math
import os
import zlib
import struct
import json

OUTPUT_DIR = "mobile-apps/ios/TCGer/TCGer/Assets.xcassets/AppIcon.appiconset"
SVG_VIEWBOX_WIDTH = 443.18
SVG_VIEWBOX_HEIGHT = 514.29
CANVAS_SIZE = 1024
MARGIN = 120
COLOR_BLACK = (0, 0, 0)
COLOR_WHITE = (255, 255, 255)

polygons = [
    [
        (0.0, 404.88),
        (0.0, 131.31),
        (225.66, 0.0),
        (418.56, 110.75),
        (194.25, 243.47),
        (194.25, 514.29),
        (0.0, 404.88)
    ],
    [
        (246.16, 508.73),
        (246.16, 276.28),
        (443.18, 158.67),
        (443.18, 300.92),
        (341.94, 358.37),
        (341.94, 454.11),
        (246.16, 508.73)
    ]
]

polyline = [
    (246.16, 508.73),
    (194.25, 514.29),
    (194.25, 243.47),
    (315.64, 171.64),
    (333.25, 225.03)
]

def transform_point(x, y, scale, offset_x, offset_y):
    return (
        offset_x + x * scale,
        offset_y + y * scale
    )

def point_in_polygon(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if ((y1 > y) != (y2 > y)):
            x_intersect = (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1
            if x < x_intersect:
                inside = not inside
    return inside

def draw_polygon(buffer, poly, color, scale, offset_x, offset_y):
    transformed = [transform_point(px, py, scale, offset_x, offset_y) for px, py in poly]
    xs = [p[0] for p in transformed]
    ys = [p[1] for p in transformed]
    min_x = max(int(math.floor(min(xs))) - 1, 0)
    max_x = min(int(math.ceil(max(xs))) + 1, CANVAS_SIZE - 1)
    min_y = max(int(math.floor(min(ys))) - 1, 0)
    max_y = min(int(math.ceil(max(ys))) + 1, CANVAS_SIZE - 1)

    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            hits = 0
            for dy in (0.25, 0.75):
                for dx in (0.25, 0.75):
                    px = x + dx
                    py = y + dy
                    if point_in_polygon(px, py, transformed):
                        hits += 1
            if hits:
                t = hits / 4.0
                r = int((1 - t) * buffer[y][x][0] + t * color[0])
                g = int((1 - t) * buffer[y][x][1] + t * color[1])
                b = int((1 - t) * buffer[y][x][2] + t * color[2])
                buffer[y][x] = [r, g, b]

def draw_polyline(buffer, line_points, color, thickness, scale, offset_x, offset_y):
    transformed = [transform_point(px, py, scale, offset_x, offset_y) for px, py in line_points]
    radius = thickness / 2.0
    radius_sq = radius * radius
    for i in range(len(transformed) - 1):
        x1, y1 = transformed[i]
        x2, y2 = transformed[i + 1]
        min_x = max(int(math.floor(min(x1, x2) - radius)), 0)
        max_x = min(int(math.ceil(max(x1, x2) + radius)), CANVAS_SIZE - 1)
        min_y = max(int(math.floor(min(y1, y2) - radius)), 0)
        max_y = min(int(math.ceil(max(y1, y2) + radius)), CANVAS_SIZE - 1)
        dx = x2 - x1
        dy = y2 - y1
        length_sq = dx * dx + dy * dy + 1e-12
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                t = ((x - x1) * dx + (y - y1) * dy) / length_sq
                t = max(0.0, min(1.0, t))
                proj_x = x1 + t * dx
                proj_y = y1 + t * dy
                dist_sq = (proj_x - x) ** 2 + (proj_y - y) ** 2
                if dist_sq <= radius_sq:
                    buffer[y][x] = list(color)

def create_canvas():
    return [[[COLOR_WHITE[0], COLOR_WHITE[1], COLOR_WHITE[2]] for _ in range(CANVAS_SIZE)] for _ in range(CANVAS_SIZE)]

def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw_data = bytearray()
    for row in pixels:
        raw_data.append(0)
        for r, g, b in row:
            raw_data.extend([r, g, b])
    compressed = zlib.compress(bytes(raw_data))

    def chunk(chunk_type, data):
        return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', compressed))
        f.write(chunk(b'IEND', b''))

def resize_image(pixels, new_size):
    src_h = len(pixels)
    src_w = len(pixels[0])
    dst_w, dst_h = new_size
    result = [[[255, 255, 255] for _ in range(dst_w)] for _ in range(dst_h)]
    scale_x = src_w / dst_w
    scale_y = src_h / dst_h
    for y in range(dst_h):
        src_y = (y + 0.5) * scale_y - 0.5
        y0 = int(math.floor(src_y))
        y1 = min(y0 + 1, src_h - 1)
        wy = src_y - y0
        for x in range(dst_w):
            src_x = (x + 0.5) * scale_x - 0.5
            x0 = int(math.floor(src_x))
            x1 = min(x0 + 1, src_w - 1)
            wx = src_x - x0
            c00 = pixels[y0][x0]
            c10 = pixels[y0][x1]
            c01 = pixels[y1][x0]
            c11 = pixels[y1][x1]
            r = (1-wx)*(1-wy)*c00[0] + wx*(1-wy)*c10[0] + (1-wx)*wy*c01[0] + wx*wy*c11[0]
            g = (1-wx)*(1-wy)*c00[1] + wx*(1-wy)*c10[1] + (1-wx)*wy*c01[1] + wx*wy*c11[1]
            b = (1-wx)*(1-wy)*c00[2] + wx*(1-wy)*c10[2] + (1-wx)*wy*c01[2] + wx*wy*c11[2]
            result[y][x] = [int(round(r)), int(round(g)), int(round(b))]
    return result

def main():
    scale = min((CANVAS_SIZE - 2 * MARGIN) / SVG_VIEWBOX_WIDTH, (CANVAS_SIZE - 2 * MARGIN) / SVG_VIEWBOX_HEIGHT)
    offset_x = (CANVAS_SIZE - SVG_VIEWBOX_WIDTH * scale) / 2
    offset_y = (CANVAS_SIZE - SVG_VIEWBOX_HEIGHT * scale) / 2

    canvas = create_canvas()
    for poly in polygons:
        draw_polygon(canvas, poly, COLOR_BLACK, scale, offset_x, offset_y)
    draw_polyline(canvas, polyline, COLOR_BLACK, thickness=12, scale=scale, offset_x=offset_x, offset_y=offset_y)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    base_path = os.path.join(OUTPUT_DIR, "app-icon-1024.png")
    write_png(base_path, canvas)

    sizes = {
        "icon-16.png": (16, 16),
        "icon-32.png": (32, 32),
        "icon-64.png": (64, 64),
        "icon-128.png": (128, 128),
        "icon-256.png": (256, 256),
        "icon-512.png": (512, 512)
    }

    for filename, size in sizes.items():
        resized = resize_image(canvas, size)
        write_png(os.path.join(OUTPUT_DIR, filename), resized)

    contents_path = os.path.join(OUTPUT_DIR, "Contents.json")
    with open(contents_path, "r") as f:
        contents = json.load(f)

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

    with open(contents_path, "w") as f:
        json.dump(contents, f, indent=2)

if __name__ == "__main__":
    main()

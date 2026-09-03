/* Pure preview/selection math. This is a labeling aid, not a release rectifier. */
(function (root) {
  "use strict";

  const PROFILES = {
    standard: {label: "Standard · 63 × 88 mm", width: 252, height: 352},
    small: {label: "Small · 59 × 86 mm", width: 236, height: 344},
    pipeline: {label: "Scanner crop · 720 × 1000 px", width: 252, height: 350},
  };

  function defaultProfile(game) {
    return ["yugioh", "yu-gi-oh", "ygo"].includes(String(game).toLowerCase()) ? "small" : "standard";
  }

  function cycleCard(index, count, direction) {
    return count ? ((index + direction) % count + count) % count : 0;
  }

  // The caller supplies screen-space coordinates. Hidden handles never hit.
  function nearestActiveHandle(quads, activeCard, point, radius) {
    let result = null;
    let distance = radius * radius;
    (quads[activeCard] || []).forEach(([x, y], corner) => {
      const candidate = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (candidate <= distance) {
        result = [activeCard, corner];
        distance = candidate;
      }
    });
    return result;
  }

  function validQuad(quad) {
    if (!quad || quad.length !== 4 || quad.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v)))) {
      return "A card needs four finite corners";
    }
    const crosses = quad.map((a, i) => {
      const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    });
    if (crosses.some(v => Math.abs(v) < 1e-5)) return "Corners are too close to a line";
    if (!(crosses.every(v => v > 0) || crosses.every(v => v < 0))) return "Corners cross";
    return null;
  }

  // Map a rectified unit square back into the source quad: true projective
  // homography, not a bilinear deformation. Source coordinates are image-edge.
  function squareToQuad(quad) {
    const error = validQuad(quad);
    if (error) throw new Error(error);
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const determinant = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(determinant) < 1e-12) throw new Error("Degenerate perspective transform");
    const g = (dx3 * dy2 - dx2 * dy3) / determinant;
    const h = (dx1 * dy3 - dx3 * dy1) / determinant;
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
      y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
  }

  function project(matrix, u, v) {
    const [a, b, c, d, e, f, g, h] = matrix;
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  }

  function rectify(source, quad, width, height) {
    if (width < 2 || height < 2) throw new Error("Preview dimensions must be at least two pixels");
    const matrix = squareToQuad(quad);
    const data = new Uint8ClampedArray(width * height * 4);
    let outside = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const [nx, ny] = project(matrix, col / (width - 1), row / (height - 1));
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || ny < 0 || nx > 1 || ny > 1) {
          outside++;
          continue; // transparent => checkerboard, never invented image content
        }
        const x = Math.min(source.width - 1, nx * source.width);
        const y = Math.min(source.height - 1, ny * source.height);
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const x1 = Math.min(x0 + 1, source.width - 1), y1 = Math.min(y0 + 1, source.height - 1);
        const fx = x - x0, fy = y - y0, dst = (row * width + col) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const p00 = source.data[(y0 * source.width + x0) * 4 + channel];
          const p10 = source.data[(y0 * source.width + x1) * 4 + channel];
          const p01 = source.data[(y1 * source.width + x0) * 4 + channel];
          const p11 = source.data[(y1 * source.width + x1) * 4 + channel];
          data[dst + channel] = (1 - fy) * ((1 - fx) * p00 + fx * p10)
            + fy * ((1 - fx) * p01 + fx * p11);
        }
        data[dst + 3] = 255;
      }
    }
    return {data, width, height, outsideFraction: outside / (width * height)};
  }

  const api = {PROFILES, defaultProfile, cycleCard, nearestActiveHandle, validQuad, squareToQuad, project, rectify};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CardEditorGeometry = api;
})(typeof window !== "undefined" ? window : {});

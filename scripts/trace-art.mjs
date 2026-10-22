// Rebuilds the traced SVGs listed in data/traced-art.json from their source PNGs.
//
//   npm install --no-save --no-package-lock sharp@0.35 svgo@4   (potrace must be on PATH)
//   node scripts/trace-art.mjs            # every entry
//   node scripts/trace-art.mjs 660 825    # just these dex numbers
//
// Pipeline per image: crop to the opaque bounds, upscale, binarize alpha (the silhouette stays
// exact), quantize colors with k-means in CIELAB, smooth region borders, fold small specks into
// their neighbours, then trace each color as its own potrace layer and optimize with svgo.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { optimize } from "svgo";

const dataDir = new URL("../data/", import.meta.url);
const svgDir = new URL("../assets/svg/", import.meta.url);
const maxBytes = 150 * 1024;
const settings = [
  { long: 1600, colors: 40, merge: 7, mode: 1, minArea: 30, opttolerance: 0.6 },
  // Busy artwork that ends up over maxBytes gets a coarser second pass.
  { long: 1300, colors: 40, merge: 7, mode: 1, minArea: 30, opttolerance: 0.8 },
];

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const toLab = (r, g, b) => {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const nearestOf = (centers) => (p) => {
  let best = 0, bd = Infinity;
  for (let c = 0; c < centers.length; c++) { const d = d2(p, centers[c]); if (d < bd) { bd = d; best = c; } }
  return best;
};

// Returns RGBA pixels where every opaque pixel holds one of a few flat colors.
const flatten = async (png, opt) => {
  const full = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < full.info.height; y++) for (let x = 0; x < full.info.width; x++) {
    if (full.data[(y * full.info.width + x) * 4 + 3] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const crop = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const scale = opt.long / Math.max(crop.width, crop.height);
  const W = Math.round(crop.width * scale), H = Math.round(crop.height * scale);
  const { data } = await sharp(full.data, { raw: full.info }).extract(crop)
    .resize(W, H, { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });

  const opaque = [];
  for (let p = 0; p < W * H; p++) {
    if (data[p * 4 + 3] >= 128) { data[p * 4 + 3] = 255; opaque.push(p); }
    else data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = data[p * 4 + 3] = 0;
  }

  // Seeded PRNG so a re-run produces the same SVG.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const sample = [], sampleRgb = [];
  const step = Math.max(1, Math.floor(opaque.length / 40000));
  for (let j = 0; j < opaque.length; j += step) {
    const i = opaque[j] * 4;
    sample.push(toLab(data[i], data[i + 1], data[i + 2]));
    sampleRgb.push([data[i], data[i + 1], data[i + 2]]);
  }

  let centers = [sample[Math.floor(rand() * sample.length)].slice()];
  const dist = sample.map((p) => d2(p, centers[0]));
  while (centers.length < Math.min(opt.colors, sample.length)) {
    const total = dist.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let r = rand() * total, idx = 0;
    while (r > dist[idx] && idx < dist.length - 1) { r -= dist[idx]; idx++; }
    centers.push(sample[idx].slice());
    for (let s = 0; s < sample.length; s++) dist[s] = Math.min(dist[s], d2(sample[s], centers[centers.length - 1]));
  }
  for (let iter = 0; iter < 25; iter++) {
    const near = nearestOf(centers);
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of sample) { const c = near(p); sum[c][0] += p[0]; sum[c][1] += p[1]; sum[c][2] += p[2]; sum[c][3]++; }
    let moved = 0;
    centers = centers.map((c, i) => {
      if (!sum[i][3]) return c;
      const n = [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]];
      moved += d2(n, c);
      return n;
    });
    if (moved < 0.5) break;
  }

  // Merge clusters closer than `merge` dE; each keeps the mean sRGB of its members.
  let clusters = centers.map((c) => ({ lab: c, rgb: [0, 0, 0], n: 0 }));
  {
    const near = nearestOf(centers);
    sample.forEach((p, s) => {
      const c = clusters[near(p)];
      c.rgb[0] += sampleRgb[s][0]; c.rgb[1] += sampleRgb[s][1]; c.rgb[2] += sampleRgb[s][2]; c.n++;
    });
    clusters = clusters.filter((c) => c.n > 0).map((c) => ({ ...c, rgb: c.rgb.map((v) => v / c.n) }));
  }
  for (;;) {
    let bi = -1, bj = -1, bd = opt.merge ** 2;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const d = d2(clusters[i].lab, clusters[j].lab);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    if (bi < 0) break;
    const a = clusters[bi], b = clusters[bj], n = a.n + b.n;
    clusters[bi] = { lab: a.lab.map((v, k) => (v * a.n + b.lab[k] * b.n) / n), rgb: a.rgb.map((v, k) => (v * a.n + b.rgb[k] * b.n) / n), n };
    clusters.splice(bj, 1);
  }
  const K = clusters.length;
  const near = nearestOf(clusters.map((c) => c.lab));
  const rgbOut = clusters.map((c) => c.rgb.map(Math.round));

  let labels = new Int16Array(W * H).fill(-1);
  const cache = new Map();
  for (const p of opaque) {
    const i = p * 4, key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let ci = cache.get(key);
    if (ci === undefined) { ci = near(toLab(data[i], data[i + 1], data[i + 2])); cache.set(key, ci); }
    labels[p] = ci;
  }

  // Majority filter over opaque neighbours: drops anti-aliasing fringes, leaves alpha alone.
  const counts = new Uint32Array(K);
  for (let pass = 0; pass < opt.mode; pass++) {
    const next = labels.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (labels[p] < 0) continue;
      counts.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
        const l = labels[yy * W + xx];
        if (l >= 0) counts[l]++;
      }
      let best = labels[p];
      for (let c = 0; c < K; c++) if (counts[c] > counts[best]) best = c;
      next[p] = best;
    }
    labels = next;
  }

  // Fold regions smaller than minArea px into the neighbour they share the longest border with.
  for (let round = 0; round < 3; round++) {
    const seen = new Uint8Array(W * H);
    let changed = 0;
    for (const start of opaque) {
      if (seen[start]) continue;
      const l = labels[start], comp = [start], border = new Map();
      seen[start] = 1;
      for (let q = 0; q < comp.length; q++) {
        const p = comp[q], x = p % W, y = (p - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const n = yy * W + xx, nl = labels[n];
          if (nl === l) { if (!seen[n]) { seen[n] = 1; comp.push(n); } }
          else if (nl >= 0) border.set(nl, (border.get(nl) ?? 0) + 1);
        }
      }
      if (comp.length >= opt.minArea || border.size === 0) continue;
      let target = -1, tc = -1;
      for (const [nl, c] of border) if (c > tc) { tc = c; target = nl; }
      for (const p of comp) labels[p] = target;
      changed++;
    }
    if (!changed) break;
  }

  for (let p = 0; p < W * H; p++) {
    if (labels[p] < 0) continue;
    const c = rgbOut[labels[p]];
    data[p * 4] = c[0]; data[p * 4 + 1] = c[1]; data[p * 4 + 2] = c[2];
  }
  return { data, W, H };
};

// One potrace layer per color, darkest first. The darkest color covers the whole silhouette,
// so the alpha shape stays exact and smoothing slivers read as outline. Every other layer is its
// own pixels grown 2px into the colors drawn above it, so layers overlap and leave no seams.
const traceLayers = ({ data, W, H }, opttolerance) => {
  const grow = 2;
  const index = new Map(), colors = [], label = new Int16Array(W * H).fill(-1);
  for (let p = 0; p < W * H; p++) {
    if (data[p * 4 + 3] < 128) continue;
    const key = (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2];
    let i = index.get(key);
    if (i === undefined) { i = colors.length; index.set(key, i); colors.push({ key, count: 0 }); }
    colors[i].count++;
    label[p] = i;
  }
  const lum = (k) => 0.2126 * (k >> 16) + 0.7152 * ((k >> 8) & 255) + 0.0722 * (k & 255);
  const darkest = colors.reduce((a, c, i) => (lum(c.key) < lum(colors[a].key) ? i : a), 0);
  const order = [darkest, ...colors.map((_, i) => i).filter((i) => i !== darkest).sort((a, b) => lum(colors[a].key) - lum(colors[b].key))];
  const rank = new Int16Array(colors.length);
  order.forEach((ci, r) => (rank[ci] = r));

  const rowBytes = Math.ceil(W / 8);
  const header = Buffer.from(`P4\n${W} ${H}\n`);
  const layers = [];
  for (let r = 0; r < order.length; r++) {
    const bits = Buffer.alloc(rowBytes * H);
    let any = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const l = label[y * W + x];
      if (l < 0 || rank[l] < r) continue;
      let on = r === 0 || rank[l] === r;
      for (let dy = -grow; dy <= grow && !on; dy++) for (let dx = -grow; dx <= grow && !on; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && xx >= 0 && yy < H && xx < W && label[yy * W + xx] >= 0 && rank[label[yy * W + xx]] === r) on = true;
      }
      if (on) { bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7); any = true; }
    }
    if (!any) continue;
    const svg = execFileSync("potrace", ["-b", "svg", "-u", "4", "-t", "4", "-a", "1.0", "-O", String(opttolerance), "--flat", "-o", "-", "-"], {
      input: Buffer.concat([header, bits]),
      maxBuffer: 64 << 20,
    }).toString();
    const d = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]).join(" ");
    if (!d) continue;
    const hex = "#" + colors[order[r]].key.toString(16).padStart(6, "0");
    layers.push(`<path fill="${hex}" transform="translate(0 ${H}) scale(0.25 -0.25)" d="${d}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${layers.join("")}</svg>\n`;
};

const traceOne = async (png) => {
  let svg;
  for (const opt of settings) {
    const raw = traceLayers(await flatten(png, opt), opt.opttolerance);
    svg = optimize(raw, { multipass: true, floatPrecision: 0, plugins: ["preset-default", "removeDimensions"] }).data;
    if (Buffer.byteLength(svg) <= maxBytes) break;
  }
  return svg;
};

const download = async (url) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { headers: { "User-Agent": "pokemon-svg-picker" } });
    if (response.ok && (response.headers.get("content-type") ?? "").startsWith("image/")) {
      return Buffer.from(await response.arrayBuffer());
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
  }
  throw new Error(`Could not download ${url}`);
};

const entries = JSON.parse(await readFile(new URL("traced-art.json", dataDir), "utf8"));
const only = new Set(process.argv.slice(2).map(Number));
for (const entry of entries.filter((e) => only.size === 0 || only.has(e.dex))) {
  const svg = await traceOne(await download(entry.sourceUrl));
  await writeFile(new URL(`${entry.dex}.svg`, svgDir), svg);
  console.log(`${entry.dex} ${entry.name} ${(Buffer.byteLength(svg) / 1024).toFixed(1)}KB`);
}

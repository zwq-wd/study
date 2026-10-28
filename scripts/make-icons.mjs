import { deflateSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

// 生成一套纯色 + 简单图形的图标，避免依赖任何图像库。
// 图形：深色底 + 居中三条渐短的横线（像「一叠卡片」）。
const OUT = process.argv[2] ?? ".";

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const bg = [23, 26, 33];       // #171a21
  const fg = [232, 196, 106];    // 暖金色
  const px = Buffer.alloc(size * size * 4);

  const pad = Math.round(size * 0.18);
  const barH = Math.max(2, Math.round(size * 0.085));
  const gap = Math.max(2, Math.round(size * 0.115));
  const widths = [1.0, 0.78, 0.56];
  const totalH = barH * 3 + gap * 2;
  const startY = Math.round((size - totalH) / 2);
  const radius = Math.max(1, Math.round(size * 0.09));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b] = bg;
      // 圆角外裁成透明
      const rx = Math.min(x, size - 1 - x);
      const ry = Math.min(y, size - 1 - y);
      let inside = true;
      if (rx < radius && ry < radius) {
        const dx = radius - rx;
        const dy = radius - ry;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      if (!inside) {
        px[(y * size + x) * 4 + 3] = 0;
        continue;
      }
      widths.forEach((w, i) => {
        const top = startY + i * (barH + gap);
        const len = Math.round((size - pad * 2) * w);
        const left = Math.round((size - len) / 2);
        if (y >= top && y < top + barH && x >= left && x < left + len) {
          [r, g, b] = fg;
        }
      });
      const o = (y * size + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(pngs) {
  // ICO 允许直接内嵌 PNG（Vista+）
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

fs.mkdirSync(OUT, { recursive: true });

const sizes = { "32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512 };
for (const [name, size] of Object.entries(sizes)) {
  fs.writeFileSync(path.join(OUT, name), makePng(size));
}
fs.writeFileSync(
  path.join(OUT, "icon.ico"),
  makeIco([
    { size: 32, buf: makePng(32) },
    { size: 64, buf: makePng(64) },
    { size: 256, buf: makePng(256) },
  ]),
);
console.log("icons ->", OUT);

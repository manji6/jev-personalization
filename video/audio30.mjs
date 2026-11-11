// 30秒版のサウンドトラック: コードで合成した音楽・効果音に、ナレーションを文ごとに配置して重ねる。
// 使い方: node video/audio30.mjs out.wav narration.f32(mono 48kHz float) "0,3.35,8.15,12.1,17.65,20.6"
//   3つ目の引数は、ナレーション素材の中で各文が始まるおおよその位置（秒）。
import fs from "node:fs";

const SR = 48000, DUR = 30, N = SR * DUR;
const L = new Float32Array(N), Rr = new Float32Array(N), SL = new Float32Array(N), SRr = new Float32Array(N);
let seed = 3;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const put = (i, v, pan = 0, send = 0.25) => {
  if (i < 0 || i >= N) return;
  const l = v * Math.cos(((pan + 1) * Math.PI) / 4), r = v * Math.sin(((pan + 1) * Math.PI) / 4);
  L[i] += l; Rr[i] += r; SL[i] += l * send; SRr[i] += r * send;
};
function pad(freqs, t0, t1, gain, cut0 = 700, cut1 = 1400) {
  const a = 0.7, rel = 1.0, n0 = Math.floor(t0 * SR), n1 = Math.min(N, Math.floor((t1 + rel) * SR));
  freqs.forEach((f, k) => [-0.07, 0, 0.08].forEach((det, d) => {
    let ph = Math.abs(rnd()), y1 = 0, y2 = 0; const inc = (f * Math.pow(2, det / 12)) / SR, pan = ((k % 3) - 1) * 0.5 + (d - 1) * 0.3;
    for (let i = n0; i < n1; i++) {
      const t = i / SR, x = (t - t0) / (t1 - t0); ph += inc; if (ph >= 1) ph -= 1;
      const al = 1 - Math.exp((-2 * Math.PI * (cut0 + (cut1 - cut0) * Math.min(1, Math.max(0, x)))) / SR);
      y1 += al * (2 * ph - 1 - y1); y2 += al * (y1 - y2);
      put(i, y2 * Math.min(1, (t - t0) / a) * Math.min(1, Math.max(0, (t1 + rel - t) / rel)) * gain, pan, 0.4);
    }
  }));
}
function pluck(f, t0, gain, pan, dec = 9) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(0.6 * SR);
  for (let j = 0; j < len; j++) { const t = j / SR, e = Math.exp(-t * dec) * Math.min(1, t * 400);
    put(n0 + j, (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 14) + 0.2 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 22)) * e * gain, pan, 0.55); }
}
function bass(f, t0, gain) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(0.3 * SR);
  for (let j = 0; j < len; j++) { const t = j / SR; put(n0 + j, (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 10)) * Math.exp(-t * 7) * Math.min(1, t * 300) * gain, 0, 0.05); }
}
function bell(f, t0, gain, pan, dec = 3.2) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(2.4 * SR);
  for (let j = 0; j < len; j++) { const t = j / SR;
    put(n0 + j, (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * dec) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * dec * 2.4) + 0.18 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * dec * 4)) * Math.min(1, t * 900) * gain, pan, 0.7); }
}
function kick(t0, gain, f0 = 130, f1 = 44, dec = 9) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(0.7 * SR); let ph = 0;
  for (let j = 0; j < len; j++) { const t = j / SR; ph += (f1 + (f0 - f1) * Math.exp(-t * 28)) / SR; put(n0 + j, Math.sin(2 * Math.PI * ph) * Math.exp(-t * dec) * Math.min(1, t * 600) * gain, 0, 0.05); }
}
function noise(t0, t1, gain, c0, c1, shape, pan0 = 0, pan1 = 0, send = 0.4) {
  const n0 = Math.floor(t0 * SR), n1 = Math.floor(t1 * SR); let lo = 0, hi = 0;
  for (let i = n0; i < n1; i++) { const x = (i - n0) / (n1 - n0), c = c0 * Math.pow(c1 / c0, x);
    const a1 = 1 - Math.exp((-2 * Math.PI * c) / SR), a2 = 1 - Math.exp((-2 * Math.PI * c * 0.35) / SR); const w = rnd(); lo += a1 * (w - lo); hi += a2 * (lo - hi);
    put(i, (lo - hi) * shape(x) * gain, pan0 + (pan1 - pan0) * x, send); }
}
function tick(t0, gain, pan) { const n0 = Math.floor(t0 * SR); let prev = 0; for (let j = 0; j < 500; j++) { const w = rnd(); const v = w - prev; prev = w; put(n0 + j, v * Math.exp(-j / 70) * gain, pan, 0.4); } }

// ---- コード進行 ----
const Bm = [123.47, 185.0, 220.0, 277.18, 293.66], G = [98.0, 146.83, 185.0, 220.0, 246.94], Am = [110.0, 164.81, 220.0, 277.18, 329.63];
const D = [73.42, 110.0, 146.83, 185.0, 220.0, 329.63], Dh = [146.83, 220.0, 293.66, 369.99, 440.0], Em = [82.41, 123.47, 196.0, 293.66, 369.99];
const prog = [[0, 4, Bm, 380, 1300], [4, 6.5, G, 800, 1800], [6.5, 9, Am, 900, 2000], [9, 12.5, Bm, 900, 2200], [12.5, 16, G, 1000, 2600], [16, 19, Dh, 1200, 2800], [19, 21.5, Am, 1200, 2600], [21.5, 24.4, Em, 500, 1500], [24.5, 29.0, D, 2400, 900]];
for (const [a, b, ch, c0, c1] of prog) {
  pad(ch, a, b - 0.1, 0.042, c0, c1);
  const root = ch[0] < 100 ? ch[0] : ch[0] / 2;
  for (let i = Math.floor(a * SR); i < Math.floor((b + 0.4) * SR) && i < N; i++) { const t = i / SR; put(i, Math.sin(2 * Math.PI * root * t) * Math.min(1, (t - a) / 0.25) * Math.min(1, Math.max(0, (b + 0.4 - t) / 0.4)) * 0.12, 0, 0); }
  if (a >= 4 && b <= 21.5) { let k = 0; for (let t = a; t < b - 0.01; t += 0.25, k++) { pluck(ch[[1, 3, 2, 4, 3, 1, 4, 2][k % 8]] * (k % 4 === 3 ? 4 : 2), t, (a >= 9 ? 0.085 : 0.07) * (k % 2 ? 0.75 : 1), k % 2 ? 0.55 : -0.55); if (a >= 9 && k % 2) bass(root * 2, t, 0.16); } }
  if (a === 21.5) for (let t = a, k = 0; t < b; t += 0.5, k++) pluck(ch[[2, 4, 3, 4][k % 4]] * 2, t, 0.06, k % 2 ? 0.5 : -0.5, 5);
  if (a === 24.5) for (let t = 25, k = 0; t < 28.4; t += 0.25, k++) pluck(D[[2, 4, 3, 5, 4, 2, 5, 3][k % 8]] * 2, t, 0.045, k % 2 ? 0.6 : -0.6);
}
for (let t = 4; t < 21.49; t += 0.5) kick(t, t < 9 ? 0.36 : 0.5);
for (let t = 9.25; t < 21.49; t += 0.5) noise(t, t + 0.05, 0.15, 9000, 7000, (x) => Math.exp(-x * 5), 0.2, 0.2, 0.15);
for (let t = 9; t < 21.49; t += 2) noise(t + 1.0, t + 1.12, 0.2, 2500, 1800, (x) => Math.exp(-x * 4), -0.1, -0.1, 0.5); // 軽いスネア

// ---- 効果音（映像の動きに合わせる）----
const T1 = [0, 0.24, 0.32, 0.64, 0.96, 1.04, 1.24, 1.44, 1.52, 1.6, 1.84, 2.16, 2.32, 2.43, 2.53, 2.64, 2.76, 2.88];
T1.forEach((x, i) => { tick(0.58 + x, 0.09, i % 2 ? 0.4 : -0.4); pluck([587.33, 739.99, 880, 1108.73][i % 4], 0.58 + x, 0.028, i % 2 ? 0.5 : -0.5); });
noise(3.4, 4.0, 0.5, 400, 6000, (x) => x * x, -0.7, 0.7);
for (let t = 4.35; t < 5.95; t += 0.068) tick(t + rnd() * 0.012, 0.07, rnd() * 0.5);
noise(6.1, 6.5, 0.3, 600, 5000, (x) => Math.sin(x * Math.PI), 0.5, -0.5);
[880, 1108.73, 1318.51].forEach((f, i) => bell(f, 7.1 + i * 0.3, 0.09, 0.5));
noise(8.55, 9.0, 0.45, 500, 7000, (x) => x * x, 0.7, -0.7);
for (let t = 9.75; t < 11.25; t += 0.075) tick(t + rnd() * 0.012, 0.085, rnd() * 0.4);
[[11.4, 440], [11.5, 587.33], [11.7, 659.26], [11.9, 739.99]].forEach(([t, f]) => pluck(f, t, 0.1, 0, 14));
[[12.15, 12.5], [12.75, 13.1], [13.2, 13.45]].forEach(([a, b]) => { noise(a, b, 0.22, 900, 4200, (x) => Math.sin(x * Math.PI), -0.3, 0.3, 0.3); tick(b, 0.16, 0); pluck(1318.51, b, 0.07, 0.2, 16); });
tick(14.2, 0.3, 0.3); kick(14.2, 0.3, 200, 80, 22);
[[14.3, 880], [14.65, 1108.73], [14.95, 1318.51]].forEach(([t, f]) => pluck(f, t, 0.09, 0.3, 10));
bell(1760, 15.02, 0.13, 0.4); bell(2217.46, 15.1, 0.08, 0.6);
noise(15.55, 16.0, 0.45, 500, 7000, (x) => x * x, -0.7, 0.7);
bell(1174.66, 17.8, 0.16, -0.3); bell(1760, 17.86, 0.11, -0.1); kick(17.8, 0.3, 90, 50, 14);
noise(17.9, 18.4, 0.3, 600, 5000, (x) => Math.sin(x * Math.PI), -0.5, 0.5);
bell(1479.98, 19.55, 0.13, 0.4); bell(2217.46, 19.61, 0.08, 0.6);
noise(21.1, 21.5, 0.4, 500, 6000, (x) => x * x, 0.6, -0.6);
kick(21.5, 0.8, 100, 38, 5);
[22.5, 22.66, 22.82].forEach((t) => { tick(t, 0.2, 0.4); pluck(196, t, 0.07, 0.4, 18); });
noise(23.2, 24.5, 0.75, 300, 9000, (x) => x * x * x);
noise(24.5, 26.0, 0.5, 9000, 500, (x) => Math.exp(-x * 4), 0, 0, 0.8);
kick(24.5, 1.0, 110, 36, 4.2);
[[587.33, 24.5], [880, 24.62], [1174.66, 24.74], [1479.98, 24.86], [1318.51, 26.08], [1760, 26.33]].forEach(([f, t], i) => bell(f, t, 0.12, i % 2 ? 0.4 : -0.4, 2.2));
kick(27.87, 0.6, 100, 40, 5); [[587.33, 27.87], [880, 27.87], [1174.66, 27.93], [1760, 28.01]].forEach(([f, t], i) => bell(f, t, 0.12, i % 2 ? 0.35 : -0.35, 1.8));

function reverb(x, combs, fb) {
  const out = new Float32Array(N);
  for (const d of combs) { const buf = new Float32Array(d); let k = 0, lp = 0; for (let i = 0; i < N; i++) { const y = buf[k]; lp = y * 0.72 + lp * 0.28; buf[k] = x[i] + lp * fb; out[i] += y * 0.25; if (++k >= d) k = 0; } }
  for (const d of [556, 441]) { const buf = new Float32Array(d); let k = 0; for (let i = 0; i < N; i++) { const b = buf[k], v = out[i] + b * 0.5; buf[k] = v; out[i] = b - v * 0.5; if (++k >= d) k = 0; } }
  return out;
}

// ---- ナレーション: 文ごとに切り出し、発話の頭を決めた時刻へ合わせる ----
const SLOTS = [0.7, 4.3, 9.3, 16.1, 21.7, 24.7];
const V = new Float32Array(N);
if (process.argv[3]) {
  const raw = fs.readFileSync(process.argv[3]), src = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  let pk = 0; for (const v of src) pk = Math.max(pk, Math.abs(v));
  const rms = (i, n) => { let s = 0; for (let j = i; j < i + n && j < src.length; j++) s += src[j] * src[j]; return Math.sqrt(s / n); };
  const cuts = process.argv[4].split(",").map(Number).map((c, k) => { if (!k) return 0; let best = c, bv = 1e9; for (let x = c - 0.15; x <= c + 0.15; x += 0.005) { const v = rms(Math.floor(x * SR), 960); if (v < bv) { bv = v; best = x; } } return Math.floor(best * SR); });
  cuts.push(src.length);
  SLOTS.forEach((slot, k) => {
    let a = cuts[k], b = cuts[k + 1], on = a; while (on < b && rms(on, 480) < pk * 0.03) on += 120;
    let end = b; while (end > on && rms(end - 480, 480) < pk * 0.02) end -= 120;
    const dst = Math.floor(slot * SR) - (on - a), fade = 1200;
    for (let i = a; i < b; i++) { const j = dst + (i - a); if (j < 0 || j >= N) continue; V[j] += (src[i] / pk) * Math.min(1, (i - a) / fade, (b - i) / fade); }
    console.log(`文${k + 1}: ${slot.toFixed(2)}s → ${(slot + (end - on) / SR).toFixed(2)}s`);
  });
}
// 声の包絡線で音楽を下げる
const env = new Float32Array(N); { let e = 0; for (let i = 0; i < N; i++) { const x = Math.abs(V[i]); e += (x > e ? 0.002 : 0.00006) * (x - e); env[i] = e; } }
const look = Math.floor(0.12 * SR);

const wl = reverb(SL, [1693, 1759, 1621, 1547], 0.86), wr = reverb(SRr, [1717, 1783, 1645, 1571], 0.86);
let mp = 0; for (let i = 0; i < N; i++) { L[i] += wl[i] * 0.9; Rr[i] += wr[i] * 0.9; mp = Math.max(mp, Math.abs(L[i]), Math.abs(Rr[i])); }
const hasV = !!process.argv[3], mg = (hasV ? 0.62 : 0.9) / mp;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const t = i / SR, m = Math.min(1, t / 0.04) * Math.min(1, Math.max(0, (DUR - t) / 0.8));
  const duck = 1 - 0.5 * Math.min(1, env[Math.min(N - 1, i + look)] * 9);
  const v = Math.tanh(V[i] * 1.5) * 0.8;
  const l = Math.tanh(L[i] * mg * duck + v) * m, r = Math.tanh(Rr[i] * mg * duck + v) * m;
  pcm.writeInt16LE(Math.round(l * 31000), 44 + i * 4); pcm.writeInt16LE(Math.round(r * 31000), 46 + i * 4);
}
fs.writeFileSync(process.argv[2] ?? "soundtrack30.wav", pcm);
console.log("wrote", process.argv[2] ?? "soundtrack30.wav");

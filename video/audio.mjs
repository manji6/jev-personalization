// ティザー用のサウンドトラックをコードだけで合成する（120BPM・Dメジャー・10秒）。
// 使い方: node video/audio.mjs out.wav
import fs from "node:fs";

const SR = 48000, DUR = 10, N = SR * DUR;
const L = new Float32Array(N), Rr = new Float32Array(N); // dry
const SL = new Float32Array(N), SRr = new Float32Array(N); // reverb send
let seed = 3;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const put = (i, v, pan = 0, send = 0.25) => {
  if (i < 0 || i >= N) return;
  const l = v * Math.cos(((pan + 1) * Math.PI) / 4), r = v * Math.sin(((pan + 1) * Math.PI) / 4);
  L[i] += l; Rr[i] += r; SL[i] += l * send; SRr[i] += r * send;
};

function pad(freqs, t0, t1, gain, cut0 = 700, cut1 = 1400) {
  const a = 0.7, rel = 1.0, n0 = Math.floor(t0 * SR), n1 = Math.min(N, Math.floor((t1 + rel) * SR));
  freqs.forEach((f, k) => {
    [-0.07, 0, 0.08].forEach((det, d) => {
      let ph = Math.abs(rnd()), y1 = 0, y2 = 0;
      const inc = (f * Math.pow(2, det / 12)) / SR, pan = ((k % 3) - 1) * 0.5 + (d - 1) * 0.3;
      for (let i = n0; i < n1; i++) {
        const t = i / SR, x = (t - t0) / (t1 - t0);
        ph += inc; if (ph >= 1) ph -= 1;
        const cut = cut0 + (cut1 - cut0) * Math.min(1, Math.max(0, x));
        const al = 1 - Math.exp((-2 * Math.PI * cut) / SR);
        y1 += al * (2 * ph - 1 - y1); y2 += al * (y1 - y2);
        const env = Math.min(1, (t - t0) / a) * Math.min(1, Math.max(0, (t1 + rel - t) / rel));
        put(i, y2 * env * gain, pan, 0.4);
      }
    });
  });
}
function pluck(f, t0, gain, pan) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(0.6 * SR);
  for (let j = 0; j < len; j++) {
    const t = j / SR, e = Math.exp(-t * 9) * Math.min(1, t * 400);
    const v = Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 14) + 0.2 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 22);
    put(n0 + j, v * e * gain, pan, 0.55);
  }
}
function bell(f, t0, gain, pan, dec = 3.2) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(2.4 * SR);
  for (let j = 0; j < len; j++) {
    const t = j / SR, a = Math.min(1, t * 900);
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * dec) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * dec * 2.4) + 0.18 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * dec * 4);
    put(n0 + j, v * a * gain, pan, 0.7);
  }
}
function kick(t0, gain, f0 = 130, f1 = 44, dec = 9) {
  const n0 = Math.floor(t0 * SR), len = Math.floor(0.7 * SR); let ph = 0;
  for (let j = 0; j < len; j++) {
    const t = j / SR, f = f1 + (f0 - f1) * Math.exp(-t * 28);
    ph += f / SR;
    put(n0 + j, Math.sin(2 * Math.PI * ph) * Math.exp(-t * dec) * Math.min(1, t * 600) * gain, 0, 0.05);
  }
}
// 帯域を動かすノイズ（ライザー／スウッシュ）
function noise(t0, t1, gain, c0, c1, shape, pan0 = 0, pan1 = 0, send = 0.4) {
  const n0 = Math.floor(t0 * SR), n1 = Math.floor(t1 * SR); let lo = 0, hi = 0;
  for (let i = n0; i < n1; i++) {
    const x = (i - n0) / (n1 - n0), c = c0 * Math.pow(c1 / c0, x);
    const a1 = 1 - Math.exp((-2 * Math.PI * c) / SR), a2 = 1 - Math.exp((-2 * Math.PI * c * 0.35) / SR);
    const w = rnd(); lo += a1 * (w - lo); hi += a2 * (lo - hi);
    put(i, (lo - hi) * shape(x) * gain, pan0 + (pan1 - pan0) * x, send);
  }
}
function tick(t0, gain, pan) {
  const n0 = Math.floor(t0 * SR); let prev = 0;
  for (let j = 0; j < 500; j++) { const w = rnd(); const v = w - prev; prev = w; put(n0 + j, v * Math.exp(-j / 70) * gain, pan, 0.5); }
}

// ---- 進行: Bm9 → (Bm9) → Gmaj9 → Dadd9 ----
const Bm = [123.47, 185.0, 220.0, 277.18, 293.66], G = [98.0, 146.83, 185.0, 220.0, 246.94], D = [73.42, 110.0, 146.83, 185.0, 220.0, 329.63];
pad(Bm, 0, 4.9, 0.04, 380, 1500);
pad(G, 5.0, 7.4, 0.045, 900, 2600);
pad(D, 7.5, 9.6, 0.05, 2400, 1100);
// サブ
for (const [f, a, b] of [[61.74, 0.2, 4.9], [49.0, 5.0, 7.45], [73.42, 7.5, 9.6]]) {
  for (let i = Math.floor(a * SR); i < Math.floor((b + 0.5) * SR) && i < N; i++) {
    const t = i / SR, env = Math.min(1, (t - a) / 0.3) * Math.min(1, Math.max(0, (b + 0.5 - t) / 0.5));
    put(i, Math.sin(2 * Math.PI * f * t) * env * 0.13, 0, 0);
  }
}
// 文字が現れる音（冒頭）
[0.28, 0.4, 0.51, 0.63, 0.74, 1.03, 1.15, 1.26, 1.38].forEach((t, i) => { tick(t, 0.11, (i % 2 ? 0.4 : -0.4)); pluck([587.33, 739.99, 880, 1108.73][i % 4] , t, 0.035, i % 2 ? 0.5 : -0.5); });
// アルペジオ（8分）
const arp = (ch, t0, t1, g) => { let k = 0; for (let t = t0; t < t1 - 0.01; t += 0.25, k++) { const f = ch[[1, 3, 2, 4, 3, 1, 4, 2][k % 8]] * (k % 4 === 3 ? 4 : 2); pluck(f, t, g * (k % 2 ? 0.75 : 1), k % 2 ? 0.55 : -0.55); } };
arp(Bm, 2.5, 5.0, 0.085); arp(G, 5.0, 7.5, 0.095);
// キック（4つ打ち）とハット
for (let t = 2.5; t < 7.49; t += 0.5) kick(t, 0.5);
for (let t = 2.75; t < 7.49; t += 0.5) noise(t, t + 0.05, 0.16, 9000, 7000, (x) => Math.exp(-x * 5), 0.2, 0.2, 0.15);
// トランジション
noise(1.9, 2.5, 0.5, 400, 6000, (x) => x * x, -0.7, 0.7);
noise(4.55, 5.0, 0.45, 500, 7000, (x) => x * x, 0.7, -0.7);
noise(6.3, 7.5, 0.75, 300, 9000, (x) => x * x * x, 0, 0);
noise(7.5, 9.0, 0.5, 9000, 500, (x) => Math.exp(-x * 4), 0, 0, 0.8);
// 判定 YES（4.5s）
bell(1174.66, 4.5, 0.16, 0.25); bell(1760, 4.56, 0.11, 0.45); kick(4.5, 0.35, 90, 50, 14);
// オファー表示（6.5s）
bell(1479.98, 6.5, 0.12, 0.4); bell(2217.46, 6.56, 0.07, 0.6);
// ロゴ（7.5s）
kick(7.5, 1.0, 110, 36, 4.2);
[[587.33, 7.5], [880, 7.62], [1174.66, 7.74], [1479.98, 7.86], [1318.51, 8.35], [1760, 8.6]].forEach(([f, t], i) => bell(f, t, 0.13, i % 2 ? 0.4 : -0.4, 2.2));

// ---- リバーブ（櫛形×4 + オールパス×2）----
function reverb(x, combs, fb) {
  const out = new Float32Array(N);
  for (const d of combs) { const buf = new Float32Array(d); let k = 0, lp = 0; for (let i = 0; i < N; i++) { const y = buf[k]; lp = y * 0.72 + lp * 0.28; buf[k] = x[i] + lp * fb; out[i] += y * 0.25; if (++k >= d) k = 0; } }
  for (const d of [556, 441]) { const buf = new Float32Array(d); let k = 0; for (let i = 0; i < N; i++) { const b = buf[k], v = out[i] + b * 0.5; buf[k] = v; out[i] = b - v * 0.5; if (++k >= d) k = 0; } }
  return out;
}
const wl = reverb(SL, [1693, 1759, 1621, 1547], 0.86), wr = reverb(SRr, [1717, 1783, 1645, 1571], 0.86);

const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const t = i / SR, m = Math.min(1, t / 0.04) * Math.min(1, Math.max(0, (DUR - t) / 0.9));
  const l = Math.tanh((L[i] + wl[i] * 0.9) * 1.5) * m, r = Math.tanh((Rr[i] + wr[i] * 0.9) * 1.5) * m;
  pcm.writeInt16LE(Math.round(l * 30000), 44 + i * 4); pcm.writeInt16LE(Math.round(r * 30000), 46 + i * 4);
}
fs.writeFileSync(process.argv[2] ?? "soundtrack.wav", pcm);
console.log("wrote", process.argv[2] ?? "soundtrack.wav");

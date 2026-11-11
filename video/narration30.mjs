// 30秒版ナレーションの組み立て（mono 48kHz f32）。
//   元テイク + 「タグ」の音程を直した区間 + 録り直した最終文（届けたい相手を、言葉で書くだけ。ジェブセンス。）
// 使い方: node video/narration30.mjs sarah.f32 tag.f32 end.f32 out.f32
//   sarah.f32 = assets/narration-sarah.mp3, tag.f32 = assets/narration-sarah-tag-fixed.wav（元テイクの3.4秒から4.6秒ぶん）,
//   end.f32 = assets/narration-sarah-ending-v2.mp3 を ffmpeg -ac 1 -ar 48000 -f f32le で変換したもの。
import fs from "node:fs";
const SR = 48000, rd = (f) => { const b = fs.readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const [a, tag, end] = process.argv.slice(2, 5).map(rd), s = (t) => Math.round(t * SR);
a.set(tag, s(3.4));
const rms = (x, t0, t1) => { let e = 0, n = 0; for (let i = s(t0); i < s(t1); i++) if (Math.abs(x[i]) > 0.01) { e += x[i] * x[i]; n++; } return Math.sqrt(e / n); };
const g = rms(a, 20.7, 25.5) / rms(end, 3.3, 7.0); // 旧最終文と音量をそろえる
const PAUSE = 0.35; // 「ジェブセンス」の前の間を少し足す
const parts = [a.subarray(0, s(20.56)), end.subarray(s(3.2), s(5.95)).map((v) => v * g), new Float32Array(s(PAUSE)), end.subarray(s(5.95), s(7.15)).map((v) => v * g)];
const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
fs.writeFileSync(process.argv[5], Buffer.from(out.buffer));
console.log("gain", g.toFixed(3), "length", (out.length / SR).toFixed(2) + "s");

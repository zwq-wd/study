/**
 * 游戏模式 · 音效
 *
 * 两套并存：
 * 1) Web Audio 现场合成（振荡器 + 噪声），用于「打饭掉勺」「装满」「答错」这些
 *    短促反馈 —— 零文件、零版权风险。
 * 2) 桌宠自带的 wav（public/pet/*.wav），用于「开新局」「吞屏」这类要一点分量的。
 *    这几个文件来自 D:\dsh-pet-standalone-webm-chat，见 public/pet/NOTICE.md。
 *
 * AudioContext 必须在用户手势之后才能 resume（浏览器策略），
 * 所以 resume 只在「点了开始 / 点了选项」时触发，不在 useEffect 里自动跑。
 */

let ctx: AudioContext | null = null;
/** 已解码的文件音效；null = 解码失败或还没解码 */
const files = new Map<string, AudioBuffer | null>();
let loading: Promise<void> | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** 在用户手势里调用：把上下文唤醒。失败就算了，音效是可有可无的。 */
export function unlockAudio(): void {
  const c = context();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
}

/** 预载文件音效。第一次 unlockAudio 之后调用；失败不抛。 */
export function preloadSfx(): void {
  if (loading !== null) return;
  const c = context();
  if (!c) return;
  const names = ["click", "bowl", "error", "start"] as const;
  loading = (async () => {
    await Promise.all(
      names.map(async (n) => {
        try {
          const res = await fetch(`/pet/${n}.wav`);
          if (!res.ok) {
            files.set(n, null);
            return;
          }
          const buf = await res.arrayBuffer();
          files.set(n, await c.decodeAudioData(buf));
        } catch {
          files.set(n, null);
        }
      }),
    );
  })();
}

/** 播音效文件；没解码好就静默跳过（合成的那个兜底音已经先响了）。 */
function playFile(name: string, gainValue = 0.35): boolean {
  const c = context();
  if (!c) return false;
  const buf = files.get(name);
  if (!buf) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = gainValue;
  src.connect(gain);
  gain.connect(c.destination);
  src.start();
  return true;
}

interface BlipOptions {
  type: OscillatorType;
  from: number;
  to: number;
  durationMs: number;
  gain: number;
  delayMs?: number;
}

function blip(o: BlipOptions): void {
  const c = context();
  if (!c) return;
  const now = c.currentTime + (o.delayMs ?? 0) / 1000;
  const dur = o.durationMs / 1000;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, now);
  if (o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), now + dur);

  // 起手 0 → 峰值 8ms，然后指数衰减到 0.0001（避免爆音）
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.gain), now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

/** 白噪声缓冲，给「吞掉屏幕」用 */
function noiseBurst(durationMs: number, fromHz: number, toHz: number, gainValue: number): void {
  const c = context();
  if (!c) return;
  const dur = durationMs / 1000;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(fromHz, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), c.currentTime + dur);

  const gain = c.createGain();
  gain.gain.setValueAtTime(gainValue, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start();
  src.stop(c.currentTime + dur + 0.02);
}

/** 掉一勺饭进碗：一声短的「噗」，像湿饭落在碗里 */
export function sfxScoop(): void {
  noiseBurst(120, 1800, 320, 0.07);
  blip({ type: "sine", from: 320, to: 180, durationMs: 90, gain: 0.05 });
}

/** 一碗装满：三连上滑「叮叮叮」 */
export function sfxBowl(): void {
  blip({ type: "sine", from: 988, to: 988, durationMs: 110, gain: 0.1 });
  blip({ type: "sine", from: 1319, to: 1319, durationMs: 120, gain: 0.09, delayMs: 90 });
  blip({ type: "sine", from: 1760, to: 1760, durationMs: 200, gain: 0.07, delayMs: 190 });
}

/** 吃一碗：先放桌宠自带的碗声，再叠一个合成咕噜兜底 */
export function sfxEat(): void {
  const ok = playFile("bowl", 0.34);
  if (!ok) {
    blip({ type: "sine", from: 880, to: 1320, durationMs: 90, gain: 0.12 });
  }
  blip({ type: "triangle", from: 180, to: 120, durationMs: 160, gain: 0.1 });
}

/** 答错：一声短促的方波「噗」 */
export function sfxWrong(): void {
  blip({ type: "square", from: 160, to: 90, durationMs: 110, gain: 0.07 });
}

/** 饿到 0 进入宽限期：两声紧迫的「嘀」 */
export function sfxGrace(): void {
  blip({ type: "square", from: 620, to: 620, durationMs: 90, gain: 0.06 });
  blip({ type: "square", from: 520, to: 520, durationMs: 110, gain: 0.06, delayMs: 130 });
}

/** 吞掉屏幕：白噪声 + 低通扫频 */
export function sfxSwallow(): void {
  noiseBurst(620, 900, 80, 0.18);
  blip({ type: "sawtooth", from: 90, to: 40, durationMs: 500, gain: 0.1 });
}

/** 开新局 */
export function sfxStart(): void {
  const ok = playFile("start", 0.3);
  if (!ok) {
    blip({ type: "sine", from: 440, to: 660, durationMs: 140, gain: 0.1 });
    blip({ type: "sine", from: 660, to: 880, durationMs: 140, gain: 0.08, delayMs: 120 });
  }
}
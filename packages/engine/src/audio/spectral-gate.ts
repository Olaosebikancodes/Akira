/**
 * Reduces steady background hiss with spectral gating, the classic
 * non-AI technique behind most studio denoisers.
 *
 * Audio is cut into overlapping windowed frames and transformed with an FFT.
 * Each frequency bin estimates its noise with "minimum statistics": it
 * lightly smooths its power and follows the quietest level seen recently,
 * which works because hiss is always there while speech and music come and
 * go. The minimum sits below the true average, so it's scaled back up. Gains
 * come from spectral subtraction, are limited to a maximum reduction, and
 * are smoothed across neighbouring bins and over time so the result doesn't
 * "warble". The frames are then overlap-added back into audio.
 *
 * The class is fully self-contained, with no imports or outside helpers,
 * because its source is also loaded into an AudioWorklet as text. For the
 * same reason its methods never name the class itself: a production build
 * may rename it, and the worklet copy would break.
 */
export class SpectralGate {
  static readonly FRAME = 1024;
  static readonly HOP = 256;
  /** Samples of delay between input and output: one frame, less the sample being written. */
  static readonly LATENCY = 1023;

  private readonly size = 1024;
  private readonly hop = 256;

  /** 0 leaves audio untouched; 1 removes as much hiss as it safely can. */
  strength: number;

  private readonly window: Float32Array;
  private readonly input: Float32Array;
  private readonly output: Float32Array;
  private readonly real: Float32Array;
  private readonly imag: Float32Array;
  private readonly level: Float32Array;
  private readonly floor: Float32Array;
  private readonly targets: Float32Array;
  private readonly gains: Float32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly reversed: Uint16Array;
  /** Samples gathered towards the next frame. */
  private filled = 0;
  /** Frames seen so far; the floor needs a short run-in before it can be trusted. */
  private frames = 0;
  /** Samples of finished output not yet handed out. */
  private ready = 0;

  constructor(strength: number) {
    const size = this.size;
    this.strength = strength;
    this.window = new Float32Array(size);
    // A periodic Hann window at 75% overlap sums to a constant, so analysis and resynthesis are lossless.
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    this.input = new Float32Array(size);
    this.output = new Float32Array(size);
    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
    this.level = new Float32Array(size / 2 + 1);
    this.floor = new Float32Array(size / 2 + 1).fill(Number.POSITIVE_INFINITY);
    this.targets = new Float32Array(size / 2 + 1);
    this.gains = new Float32Array(size / 2 + 1).fill(1);
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.reversed = new Uint16Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }

  /**
   * Filters `samples` in place. Output lags input by `LATENCY` samples, the
   * price of looking at whole frames; callers start the audio that much early.
   */
  process(samples: Float32Array): void {
    const hop = this.hop;
    for (let i = 0; i < samples.length; i++) {
      this.input[this.filled + (this.size - hop)] = samples[i]!;
      this.filled++;
      if (this.filled === hop) {
        this.analyse();
        this.filled = 0;
        this.ready = hop;
      }
      // Hand out finished samples in step with what comes in.
      samples[i] = this.ready > 0 ? this.output[hop - this.ready--]! : 0;
    }
  }

  private analyse(): void {
    const size = this.size;
    const hop = this.hop;
    const { real, imag, window, input } = this;
    for (let i = 0; i < size; i++) {
      real[i] = input[i]! * window[i]!;
      imag[i] = 0;
    }
    this.transform(false);
    this.frames++;

    const bins = size / 2 + 1;
    const { level, floor, targets, gains } = this;
    // The floor falls instantly to quieter levels and rises about 2 dB a
    // second, so a held note is never mistaken for noise.
    const rise = 1.0025;
    // Minimum-statistics bias: measured on white noise, the tracked minimum
    // sits at about 15% of the true noise power, so scale it back up.
    const bias = 6.5;
    // Stronger settings subtract more and allow deeper cuts (up to 24 dB).
    const oversubtract = 1 + 2 * this.strength;
    const deepest = Math.pow(10, (-24 * this.strength) / 20);

    for (let bin = 0; bin < bins; bin++) {
      const power = real[bin]! * real[bin]! + imag[bin]! * imag[bin]!;
      const first = this.frames === 1;
      // Raw frame power flickers so much that noise alone would keep opening
      // the gate; a light average steadies it while still recovering within
      // the short pauses between words.
      level[bin] = first ? power : 0.5 * level[bin]! + 0.5 * power;
      // The first frames still hold the zeros the buffer started with; they'd drag the floor to nothing.
      if (this.frames > this.size / this.hop + 4) {
        floor[bin] = Math.max(1e-12, Math.min(level[bin]!, floor[bin]! * rise));
      }
      const noise = floor[bin]! * bias;
      targets[bin] =
        Number.isFinite(floor[bin]!) && this.strength > 0
          ? Math.max(deepest, 1 - (oversubtract * noise) / Math.max(level[bin]!, 1e-12))
          : 1;
    }

    for (let bin = 0; bin < bins; bin++) {
      // Blending with neighbours stops isolated bins flickering on and off.
      const target =
        (targets[Math.max(0, bin - 1)]! + 2 * targets[bin]! + targets[Math.min(bins - 1, bin + 1)]!) / 4;
      // Open quickly so speech onsets aren't clipped; close slowly so tails don't flutter.
      const previous = gains[bin]!;
      const gain = previous + (target - previous) * (target > previous ? 0.7 : 0.25);
      gains[bin] = gain;
      real[bin] = real[bin]! * gain;
      imag[bin] = imag[bin]! * gain;
      if (bin > 0 && bin < size / 2) {
        real[size - bin] = real[bin]!;
        imag[size - bin] = -imag[bin]!;
      }
    }

    this.transform(true);
    // Overlap-add. The first hop of the buffer is now final and is handed out
    // next; Hann at 75% overlap sums to 1.5, so scale it back down.
    const output = this.output;
    output.copyWithin(0, hop);
    output.fill(0, size - hop);
    for (let i = 0; i < size; i++) output[i] = output[i]! + (real[i]! * window[i]!) / 1.5;
    input.copyWithin(0, hop);
  }

  /** In-place radix-2 FFT of `real` + i·`imag`; the inverse is scaled by 1/n. */
  private transform(inverse: boolean): void {
    const size = this.size;
    const { real, imag, reversed } = this;
    for (let i = 0; i < size; i++) {
      const j = reversed[i]!;
      if (j > i) {
        const r = real[i]!;
        real[i] = real[j]!;
        real[j] = r;
        const m = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = m;
      }
    }
    for (let length = 2; length <= size; length *= 2) {
      const half = length / 2;
      const step = size / length;
      for (let start = 0; start < size; start += length) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step]!;
          const s = inverse ? -this.sin[k * step]! : this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = real[b]! * c - imag[b]! * s;
          const ti = real[b]! * s + imag[b]! * c;
          real[b] = real[a]! - tr;
          imag[b] = imag[a]! - ti;
          real[a] = real[a]! + tr;
          imag[a] = imag[a]! + ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < size; i++) {
        real[i] = real[i]! / size;
        imag[i] = imag[i]! / size;
      }
    }
  }
}

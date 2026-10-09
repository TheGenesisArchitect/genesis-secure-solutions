// Helix Live microphone processor: downsamples the mic to 16 kHz mono and posts 16-bit PCM chunks (~40 ms)
// to the page, which streams them to the Live API. Runs on the audio thread.
class HelixMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.buf = new Int16Array(640);
    this.n = 0;
    this.level = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (Math.abs(v) > peak) peak = Math.abs(v);
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const s = Math.max(-1, Math.min(1, v));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage({ pcm: this.buf.buffer, level: peak }, [this.buf.buffer]);
          this.buf = new Int16Array(640);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('helix-mic', HelixMic);

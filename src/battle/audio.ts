import * as THREE from 'three';
import type { SfxEvent } from './battleSim';

/**
 * Procedural battle audio (WebAudio, no assets). Sounds are synthesised on the fly,
 * attenuated by distance from the camera and panned by screen position.
 */
export class BattleAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: { gain: GainNode; osc: OscillatorNode; src: AudioBufferSourceNode } | null = null;
  private recent: number[] = [];   // timestamps of recent one-shots, for rate limiting
  muted = false;
  private camPos = new THREE.Vector3();
  private camRight = new THREE.Vector3(1, 0, 0);
  private camDist = 120;

  /** Must be called from a user gesture (click/key/touch) so the browser lets audio start. */
  enable(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.startHum();
    } catch { this.ctx = null; }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  setListener(camera: THREE.Camera, distance: number): void {
    this.camPos.copy(camera.position);
    this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.camDist = distance;
    if (this.hum && this.ctx) {
      // engine hum swells as you zoom in
      const g = 0.02 + 0.06 * Math.max(0, 1 - distance / 300);
      this.hum.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.2);
    }
  }

  private startHum(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 48;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    osc.connect(lp).connect(gain);
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 220;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    src.connect(nlp).connect(ng).connect(gain);
    gain.connect(this.master!);
    osc.start(); src.start();
    this.hum = { gain, osc, src };
  }

  play(ev: SfxEvent): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.master) return;
    const now = ctx.currentTime;
    // rate limit: at most 10 one-shots per 100 ms
    this.recent = this.recent.filter(t => now - t < 0.1);
    if (this.recent.length >= 10 && ev.type !== 'explode') return;
    this.recent.push(now);

    const d = this.camPos.distanceTo(ev.pos);
    const att = 1 / (1 + d / 140);
    const pan = Math.max(-1, Math.min(1, ev.pos.clone().sub(this.camPos).dot(this.camRight) / (this.camDist * 0.8)));
    const out = ctx.createGain();
    out.gain.value = att;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.master);

    const emp = ev.side === 'empire';
    switch (ev.type) {
      case 'fire': this.fire(ctx, out, now, ev.kind ?? 'laser', emp); break;
      case 'hit': ev.shield ? this.shieldHit(ctx, out, now) : this.hullHit(ctx, out, now); break;
      case 'explode': this.explode(ctx, out, now, ev.size ?? 1); break;
      case 'jump': this.jump(ctx, out, now); break;
    }
  }

  private env(ctx: AudioContext, out: AudioNode, t0: number, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(out);
    return g;
  }

  private tone(ctx: AudioContext, out: AudioNode, t0: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    o.connect(this.env(ctx, out, t0, peak, 0.005, dur));
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(ctx: AudioContext, out: AudioNode, t0: number, f0: number, f1: number, dur: number, peak: number, type: BiquadFilterType = 'lowpass'): void {
    const s = ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    s.connect(f).connect(this.env(ctx, out, t0, peak, 0.01, dur));
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  private fire(ctx: AudioContext, out: AudioNode, t0: number, kind: string, emp: boolean): void {
    const jitter = 0.9 + Math.random() * 0.2;
    switch (kind) {
      case 'laser': this.tone(ctx, out, t0, emp ? 'square' : 'sawtooth', (emp ? 1500 : 950) * jitter, emp ? 420 : 260, 0.09, 0.09); break;
      case 'turbo': this.tone(ctx, out, t0, 'sawtooth', 380 * jitter, 130, 0.24, 0.16); this.noiseBurst(ctx, out, t0, 1800, 300, 0.12, 0.05); break;
      case 'ion': this.tone(ctx, out, t0, 'sine', 620 * jitter, 590, 0.3, 0.12); this.tone(ctx, out, t0, 'sine', 648 * jitter, 600, 0.3, 0.1); break;
      case 'torpedo': this.noiseBurst(ctx, out, t0, 900, 180, 0.4, 0.14, 'bandpass'); this.tone(ctx, out, t0, 'sine', 220, 70, 0.4, 0.1); break;
    }
  }
  private shieldHit(ctx: AudioContext, out: AudioNode, t0: number): void {
    this.tone(ctx, out, t0, 'sine', 900 + Math.random() * 200, 560, 0.14, 0.07);
    this.noiseBurst(ctx, out, t0, 3000, 900, 0.06, 0.03, 'highpass');
  }
  private hullHit(ctx: AudioContext, out: AudioNode, t0: number): void {
    this.noiseBurst(ctx, out, t0, 500, 90, 0.1, 0.12);
  }
  private explode(ctx: AudioContext, out: AudioNode, t0: number, size: number): void {
    const dur = 0.45 + size * 0.28;
    this.noiseBurst(ctx, out, t0, 1400, 60, dur, Math.min(0.9, 0.25 + size * 0.15));
    this.tone(ctx, out, t0, 'sine', 110, 28, dur * 0.9, Math.min(0.7, 0.2 + size * 0.12));
  }
  private jump(ctx: AudioContext, out: AudioNode, t0: number): void {
    this.tone(ctx, out, t0, 'sine', 180, 1400, 0.45, 0.12);
    this.noiseBurst(ctx, out, t0, 300, 4000, 0.4, 0.06, 'bandpass');
  }

  dispose(): void {
    if (this.hum) { try { this.hum.osc.stop(); this.hum.src.stop(); } catch { /* already stopped */ } this.hum = null; }
    if (this.ctx) { void this.ctx.close(); this.ctx = null; }
  }
}

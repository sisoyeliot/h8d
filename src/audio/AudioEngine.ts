export type AudioResourceInfo = {
  id: number;
  name: string;
  duration: number;
};

type AudioResource = AudioResourceInfo & {
  buffer: AudioBuffer;
  originalBuffer: ArrayBuffer;
};

type AudioNodeState = {
  pannerNode: PannerNode;
  gainNode: GainNode;
  analyserNode: AnalyserNode;
  frequencyData: Uint8Array;
  activeSources: Set<AudioBufferSourceNode>;
  clips: any[];
  volume: number;
  muted: boolean;
};

export class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _resources: Map<number, AudioResource> = new Map();
  private _nextResourceId: number = 1;
  private _nodes: Map<number, AudioNodeState> = new Map();

  private _masterGain: GainNode | null = null;
  private _mixerGain: GainNode | null = null;
  private _analyserNode: AnalyserNode | null = null;
  private _frequencyData: Uint8Array | null = null;

  private _isPlaying: boolean = false;
  private _startedAt: number = 0;
  private _pauseOffset: number = 0;
  private _activeSources: number = 0;
  private _onEndedCallback?: () => void;

  private _initContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 1.0;
    this._masterGain.connect(this._ctx.destination);

    this._analyserNode = this._ctx.createAnalyser();
    this._analyserNode.fftSize = 256;
    this._analyserNode.smoothingTimeConstant = 0.8;
    this._analyserNode.connect(this._masterGain);
    this._frequencyData = new Uint8Array(this._analyserNode.frequencyBinCount);

    this._mixerGain = this._ctx.createGain();
    this._mixerGain.gain.value = 1.0;
    this._mixerGain.connect(this._analyserNode);

    const L = this._ctx.listener;
    if (L.positionX) {
      L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0;
      L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(0, 0, 0);
      L.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }



  async addResource(file: File): Promise<AudioResourceInfo> {
    const arrayBuffer = await file.arrayBuffer();
    return this.addResourceFromBuffer(this._nextResourceId++, file.name, arrayBuffer);
  }

  async addResourceFromBuffer(id: number, name: string, arrayBuffer: ArrayBuffer): Promise<AudioResourceInfo> {
    this._initContext();
    if (this._ctx!.state === 'suspended') await this._ctx!.resume();

    const originalBuffer = arrayBuffer.slice(0);
    const buffer = await this._ctx!.decodeAudioData(arrayBuffer);
    
    if (id >= this._nextResourceId) this._nextResourceId = id + 1;

    this._resources.set(id, {
      id,
      name,
      duration: buffer.duration,
      buffer,
      originalBuffer,
    });

    return { id, name, duration: buffer.duration };
  }

  clearResources(): void {
    this.stop();
    this._resources.clear();
    for (const [nodeId] of this._nodes) {
      this.assignTrack(nodeId, null);
    }
  }

  removeResource(id: number): void {
    this._resources.delete(id);
    for (const [, node] of this._nodes) {
      node.clips = node.clips.filter(c => c.resourceId !== id);
    }
  }

  getResources(): AudioResourceInfo[] {
    const list: AudioResourceInfo[] = [];
    for (const [id, r] of this._resources) {
      list.push({ id, name: r.name, duration: r.duration });
    }
    return list;
  }

  getRawResources(): { id: number, name: string, buffer: ArrayBuffer }[] {
    const list: { id: number, name: string, buffer: ArrayBuffer }[] = [];
    for (const [id, r] of this._resources) {
      list.push({ id, name: r.name, buffer: r.originalBuffer });
    }
    return list;
  }

  createNode(nodeId: number): void {
    this._initContext();

    const pannerNode = this._ctx!.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 50;
    pannerNode.rolloffFactor = 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;
    pannerNode.coneOuterGain = 0;

    const gainNode = this._ctx!.createGain();
    gainNode.gain.value = 1.0;

    const analyserNode = this._ctx!.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.8;
    const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);

    // Chain: source -> panner -> gain -> analyser -> mixer
    pannerNode.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(this._mixerGain!);

    this._nodes.set(nodeId, {
      pannerNode,
      gainNode,
      analyserNode,
      frequencyData,
      activeSources: new Set(),
      clips: [],
      volume: 1.0,
      muted: false,
    });
  }

  setNodeClips(nodeId: number, clips: any[]) {
    const node = this._nodes.get(nodeId);
    if (node) {
      node.clips = clips;
    }
  }

  removeNode(nodeId: number): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;

    for (const source of node.activeSources) {
      source.onended = null;
      try { source.stop(); } catch (_) { }
    }
    node.activeSources.clear();

    node.pannerNode.disconnect();
    node.gainNode.disconnect();
    node.analyserNode.disconnect();
    this._nodes.delete(nodeId);
  }

  assignTrack(_nodeId: number, _resourceId: number | null): void {
    // Legacy support disabled, use setNodeClips
  }

  setNodePosition(nodeId: number, x: number, y: number, z: number): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    const p = node.pannerNode;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  setNodeVolume(nodeId: number, volume: number): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    node.volume = volume;
    if (!node.muted) {
      node.gainNode.gain.setTargetAtTime(volume, this._ctx!.currentTime, 0.02);
    }
  }

  setNodeMuted(nodeId: number, muted: boolean): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    node.muted = muted;
    const val = muted ? 0 : node.volume;
    node.gainNode.gain.setTargetAtTime(val, this._ctx!.currentTime, 0.02);
  }

  play(): void {
    if (this._isPlaying) return;
    this._initContext();
    if (this._ctx!.state === 'suspended') this._ctx!.resume();

    this._activeSources = 0;

    for (const [nodeId, node] of this._nodes) {
      for (const clip of node.clips) {
        if (clip.start + clip.duration > this._pauseOffset) {
          this._scheduleClip(nodeId, clip);
        }
      }
    }

    if (this._activeSources >= 0) { // always play
      this._startedAt = this._ctx!.currentTime - this._pauseOffset;
      this._isPlaying = true;
    }
  }

  private _scheduleClip(nodeId: number, clip: any): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;

    const resource = this._resources.get(clip.resourceId);
    if (!resource) return;

    let offset = clip.offset;
    let duration = clip.duration;
    let delay = clip.start - this._pauseOffset;

    if (delay < 0) {
      offset += Math.abs(delay);
      duration -= Math.abs(delay);
      delay = 0;
    }

    if (duration <= 0) return;

    const source = this._ctx!.createBufferSource();
    source.buffer = resource.buffer;
    source.connect(node.pannerNode);

    source.onended = () => {
      node.activeSources.delete(source);
      this._activeSources--;
      if (this._activeSources <= 0 && this._isPlaying) {
        this._isPlaying = false;
        this._pauseOffset = 0;
        this._onEndedCallback?.();
      }
    };

    source.start(this._ctx!.currentTime + delay, offset, duration);
    node.activeSources.add(source);
    this._activeSources++;
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._pauseOffset = this._ctx!.currentTime - this._startedAt;

    for (const [, node] of this._nodes) {
      for (const source of node.activeSources) {
        source.onended = null;
        try { source.stop(); } catch (_) { }
      }
      node.activeSources.clear();
    }
    this._activeSources = 0;
    this._isPlaying = false;
  }

  stop(): void {
    for (const [, node] of this._nodes) {
      for (const source of node.activeSources) {
        source.onended = null;
        try { source.stop(); } catch (_) { }
      }
      node.activeSources.clear();
    }
    this._activeSources = 0;
    this._isPlaying = false;
    this._pauseOffset = 0;
  }

  seek(time: number): void {
    const wasPlaying = this._isPlaying;
    this.stop();
    this._pauseOffset = Math.max(0, Math.min(time, this.maxDuration));
    if (wasPlaying) this.play();
  }

  onEnded(fn: () => void): void {
    this._onEndedCallback = fn;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get currentTime(): number {
    if (this._isPlaying) {
      return Math.min(this._ctx!.currentTime - this._startedAt, this.maxDuration);
    }
    return this._pauseOffset;
  }

  get maxDuration(): number {
    let max = 0;
    for (const [, node] of this._nodes) {
      for (const clip of node.clips) {
        const end = clip.start + clip.duration;
        if (end > max) max = end;
      }
    }
    return max;
  }

  get hasAssignedTracks(): boolean {
    for (const [, node] of this._nodes) {
      if (node.clips.length > 0) return true;
    }
    return false;
  }

  get hasResources(): boolean {
    return this._resources.size > 0;
  }

  getFrequencyData(): Uint8Array | null {
    if (!this._analyserNode || !this._frequencyData) return null;
    this._analyserNode.getByteFrequencyData(this._frequencyData as any);
    return this._frequencyData;
  }

  getNodeFrequencyData(nodeId: number): Uint8Array | null {
    const node = this._nodes.get(nodeId);
    if (!node) return null;
    node.analyserNode.getByteFrequencyData(node.frequencyData as any);
    return node.frequencyData;
  }

  async exportToWav(options: { nodeMovements: any[]; onProgress?: (p: number) => void }): Promise<Blob> {
    this._initContext();
    let maxDuration = 0;
    let sampleRate = 44100;
    const validMovements: any[] = [];

    for (const nm of options.nodeMovements) {
      for (const clip of nm.clips) {
        const r = this._resources.get(clip.resourceId);
        if (!r) continue;
        const end = clip.start + clip.duration;
        if (end > maxDuration) maxDuration = end;
        sampleRate = r.buffer.sampleRate;
        validMovements.push({ ...nm, clip, buffer: r.buffer, duration: clip.duration });
      }
    }

    if (maxDuration === 0) throw new Error('No audio to export');

    const length = Math.ceil(maxDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, length, sampleRate);

    for (const nm of validMovements) {
      const source = offlineCtx.createBufferSource();
      source.buffer = nm.buffer;

      const panner = offlineCtx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 50;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;

      const gain = offlineCtx.createGain();
      source.connect(panner);
      panner.connect(gain);
      gain.connect(offlineCtx.destination);

      if (nm.keyframes && nm.keyframes.length > 0 && panner.positionX) {
        const stepsPerSec = 10;
        const totalSteps = Math.ceil(nm.clip.duration * stepsPerSec);

        for (let i = 0; i <= totalSteps; i++) {
          const t = nm.clip.start + (i / totalSteps) * nm.clip.duration;
          const state = this._interpolateKfs(nm.keyframes, t);
          const rad = state.angle * Math.PI / 180;
          const x = Math.sin(rad) * state.distance;
          const z = Math.cos(rad) * state.distance;
          const timeToSet = (nm.clip.start + (i / totalSteps) * nm.clip.duration) || 0.001;
          panner.positionX.linearRampToValueAtTime(x, timeToSet);
          panner.positionY.linearRampToValueAtTime(state.height, timeToSet);
          panner.positionZ.linearRampToValueAtTime(z, timeToSet);
          gain.gain.linearRampToValueAtTime(state.muted ? 0 : state.volume, timeToSet);
        }
      } else if (nm.initialState) {
        // Apply static spatial position from initialState
        const s = nm.initialState;
        const rad = s.angle * Math.PI / 180;
        const x = Math.sin(rad) * s.distance;
        const z = Math.cos(rad) * s.distance;
        if (panner.positionX) {
          panner.positionX.value = x;
          panner.positionY.value = s.height;
          panner.positionZ.value = z;
        } else {
          panner.setPosition(x, s.height, z);
        }
        gain.gain.value = s.muted ? 0 : s.volume;
      }

      source.start(nm.clip.start, nm.clip.offset, nm.clip.duration);
    }

    let progressInterval: number | undefined;
    if (options.onProgress) {
      let est = 0;
      progressInterval = window.setInterval(() => {
        est = Math.min(0.95, est + 0.03);
        options.onProgress!(est);
      }, 200);
    }

    const rendered = await offlineCtx.startRendering();
    if (progressInterval) clearInterval(progressInterval);
    options.onProgress?.(1.0);

    return this._encodeWav(rendered);
  }

  private _interpolateKfs(kfs: any[], t: number): any {
    if (kfs.length === 0) return { angle: 0, distance: 3, height: 0, volume: 1, muted: false };
    if (kfs.length === 1 || t <= kfs[0].time) return { ...kfs[0] };
    if (t >= kfs[kfs.length - 1].time) return { ...kfs[kfs.length - 1] };

    let idx = 0;
    for (let i = 0; i < kfs.length - 1; i++) {
      if (t >= kfs[i].time && t <= kfs[i + 1].time) { idx = i; break; }
    }

    const p1 = kfs[idx], p2 = kfs[idx + 1];
    const frac = (t - p1.time) / (p2.time - p1.time || 1);
    const p0 = kfs[Math.max(0, idx - 1)];
    const p3 = kfs[Math.min(kfs.length - 1, idx + 2)];

    const cr = (t: number, a: number, b: number, c: number, d: number) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };

    const uw = (ref: number, a: number) => { let d = a - ref; while (d > 180) d -= 360; while (d < -180) d += 360; return ref + d; };
    const ua0 = uw(p1.angle, p0.angle);
    const ua2 = uw(p1.angle, p2.angle);
    const ua3 = uw(ua2, p3.angle);

    return {
      angle: ((cr(frac, ua0, p1.angle, ua2, ua3) % 360) + 360) % 360,
      distance: Math.max(0.5, cr(frac, p0.distance, p1.distance, p2.distance, p3.distance)),
      height: cr(frac, p0.height, p1.height, p2.height, p3.height),
      volume: p1.volume + (p2.volume - p1.volume) * frac,
      muted: frac < 0.5 ? p1.muted : p2.muted,
    };
  }

  private _encodeWav(audioBuffer: AudioBuffer): Blob {
    const numCh = audioBuffer.numberOfChannels;
    const sr = audioBuffer.sampleRate;
    const len = audioBuffer.length;
    const bps = 16;
    const bytesPer = bps / 8;
    const channels = [];
    for (let i = 0; i < numCh; i++) channels.push(audioBuffer.getChannelData(i));

    const dataSize = len * numCh * bytesPer;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    let o = 0;
    const ws = (s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o++, s.charCodeAt(i)); };

    ws('RIFF');
    v.setUint32(o, 36 + dataSize, true); o += 4;
    ws('WAVE'); ws('fmt ');
    v.setUint32(o, 16, true); o += 4;
    v.setUint16(o, 1, true); o += 2;
    v.setUint16(o, numCh, true); o += 2;
    v.setUint32(o, sr, true); o += 4;
    v.setUint32(o, sr * numCh * bytesPer, true); o += 4;
    v.setUint16(o, numCh * bytesPer, true); o += 2;
    v.setUint16(o, bps, true); o += 2;
    ws('data');
    v.setUint32(o, dataSize, true); o += 4;

    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, channels[ch][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  previewTrack(resourceId: number): { stop: () => void } | null {
    if (!this._ctx) this._initContext();
    const res = this._resources.get(resourceId);
    if (!res) return null;
    
    const source = this._ctx!.createBufferSource();
    source.buffer = res.buffer;
    source.connect(this._ctx!.destination);
    source.start(0);
    
    return {
      stop: () => {
        try { source.stop(); } catch (_) {}
      }
    };
  }
}

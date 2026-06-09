
export class AudioEngine {
  constructor() {
    this._ctx = null;

    this._resources = new Map();
    this._nextResourceId = 1;

    this._nodes = new Map();


    this._masterGain = null;
    this._mixerGain = null;
    this._analyserNode = null;
    this._frequencyData = null;


    this._isPlaying = false;
    this._startedAt = 0;
    this._pauseOffset = 0;
    this._activeSources = 0;
  }

  _initContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();


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

  async addResource(file) {
    this._initContext();
    if (this._ctx.state === 'suspended') await this._ctx.resume();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = await this._ctx.decodeAudioData(arrayBuffer);
    const id = this._nextResourceId++;

    this._resources.set(id, {
      name: file.name,
      duration: buffer.duration,
      buffer,
    });

    return { id, name: file.name, duration: buffer.duration };
  }


  removeResource(id) {
    this._resources.delete(id);
    for (const [nodeId, node] of this._nodes) {
      if (node.resourceId === id) {
        this.assignTrack(nodeId, null);
      }
    }
  }


  getResources() {
    const list = [];
    for (const [id, r] of this._resources) {
      list.push({ id, name: r.name, duration: r.duration });
    }
    return list;
  }

  createNode(nodeId) {
    this._initContext();


    const pannerNode = this._ctx.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 50;
    pannerNode.rolloffFactor = 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;
    pannerNode.coneOuterGain = 0;


    const gainNode = this._ctx.createGain();
    gainNode.gain.value = 1.0;


    pannerNode.connect(gainNode);
    gainNode.connect(this._mixerGain);

    this._nodes.set(nodeId, {
      pannerNode,
      gainNode,
      sourceNode: null,
      resourceId: null,
      volume: 1.0,
      muted: false,
    });
  }


  removeNode(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node) return;


    if (node.sourceNode) {
      node.sourceNode.onended = null;
      try { node.sourceNode.stop(); } catch (_) { }
    }

    node.pannerNode.disconnect();
    node.gainNode.disconnect();
    this._nodes.delete(nodeId);
  }

  assignTrack(nodeId, resourceId) {
    const node = this._nodes.get(nodeId);
    if (!node) return;


    if (node.sourceNode) {
      node.sourceNode.onended = null;
      try { node.sourceNode.stop(); } catch (_) { }
      node.sourceNode = null;
    }

    node.resourceId = resourceId;


    if (this._isPlaying && resourceId) {
      this._startNodeSource(nodeId);
    }
  }

  setNodePosition(nodeId, x, y, z) {
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


  setNodeVolume(nodeId, volume) {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    node.volume = volume;
    if (!node.muted) {
      node.gainNode.gain.setTargetAtTime(volume, this._ctx.currentTime, 0.02);
    }
  }


  setNodeMuted(nodeId, muted) {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    node.muted = muted;
    const val = muted ? 0 : node.volume;
    node.gainNode.gain.setTargetAtTime(val, this._ctx.currentTime, 0.02);
  }

  play() {
    if (this._isPlaying) return;
    this._initContext();
    if (this._ctx.state === 'suspended') this._ctx.resume();

    this._activeSources = 0;

    for (const [nodeId] of this._nodes) {
      this._startNodeSource(nodeId);
    }

    if (this._activeSources > 0) {
      this._startedAt = this._ctx.currentTime - this._pauseOffset;
      this._isPlaying = true;
    }
  }


  _startNodeSource(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node || !node.resourceId) return;

    const resource = this._resources.get(node.resourceId);
    if (!resource) return;

    const offset = Math.min(this._pauseOffset, resource.duration);
    if (offset >= resource.duration) return;

    const source = this._ctx.createBufferSource();
    source.buffer = resource.buffer;
    source.connect(node.pannerNode);

    source.onended = () => {
      node.sourceNode = null;
      this._activeSources--;
      if (this._activeSources <= 0 && this._isPlaying) {
        this._isPlaying = false;
        this._pauseOffset = 0;
        this._onEndedCallback?.();
      }
    };

    source.start(0, offset);
    node.sourceNode = source;
    this._activeSources++;
  }

  pause() {
    if (!this._isPlaying) return;
    this._pauseOffset = this._ctx.currentTime - this._startedAt;

    for (const [, node] of this._nodes) {
      if (node.sourceNode) {
        node.sourceNode.onended = null;
        try { node.sourceNode.stop(); } catch (_) { }
        node.sourceNode = null;
      }
    }
    this._activeSources = 0;
    this._isPlaying = false;
  }

  stop() {
    for (const [, node] of this._nodes) {
      if (node.sourceNode) {
        node.sourceNode.onended = null;
        try { node.sourceNode.stop(); } catch (_) { }
        node.sourceNode = null;
      }
    }
    this._activeSources = 0;
    this._isPlaying = false;
    this._pauseOffset = 0;
  }

  seek(time) {
    const wasPlaying = this._isPlaying;
    this.stop();
    this._pauseOffset = Math.max(0, Math.min(time, this.maxDuration));
    if (wasPlaying) this.play();
  }

  onEnded(fn) { this._onEndedCallback = fn; }


  get isPlaying() { return this._isPlaying; }

  get currentTime() {
    if (this._isPlaying) {
      return Math.min(this._ctx.currentTime - this._startedAt, this.maxDuration);
    }
    return this._pauseOffset;
  }


  get maxDuration() {
    let max = 0;
    for (const [, node] of this._nodes) {
      if (!node.resourceId) continue;
      const r = this._resources.get(node.resourceId);
      if (r && r.duration > max) max = r.duration;
    }
    return max;
  }


  get hasAssignedTracks() {
    for (const [, node] of this._nodes) {
      if (node.resourceId) return true;
    }
    return false;
  }

  get hasResources() { return this._resources.size > 0; }

  getFrequencyData() {
    if (!this._analyserNode || !this._frequencyData) return null;
    this._analyserNode.getByteFrequencyData(this._frequencyData);
    return this._frequencyData;
  }

  async exportToWav({ nodeMovements, onProgress }) {

    let maxDuration = 0;
    let sampleRate = 44100;
    const validMovements = [];

    for (const nm of nodeMovements) {
      if (!nm.resourceId) continue;
      const r = this._resources.get(nm.resourceId);
      if (!r) continue;
      if (r.duration > maxDuration) maxDuration = r.duration;
      sampleRate = r.buffer.sampleRate;
      validMovements.push({ ...nm, buffer: r.buffer, duration: r.duration });
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


      if (nm.keyframes && nm.keyframes.length > 0 && panner.positionX) {
        const stepsPerSec = 60;
        const totalSteps = Math.ceil(nm.duration * stepsPerSec);
        const gain = offlineCtx.createGain();
        source.connect(panner);
        panner.connect(gain);
        gain.connect(offlineCtx.destination);

        for (let i = 0; i <= totalSteps; i++) {
          const t = (i / totalSteps) * nm.duration;
          const state = this._interpolateKfs(nm.keyframes, t);
          const rad = state.angle * Math.PI / 180;
          const x = Math.sin(rad) * state.distance;
          const z = Math.cos(rad) * state.distance;
          panner.positionX.linearRampToValueAtTime(x, t || 0.001);
          panner.positionY.linearRampToValueAtTime(state.height, t || 0.001);
          panner.positionZ.linearRampToValueAtTime(z, t || 0.001);
          gain.gain.linearRampToValueAtTime(state.muted ? 0 : state.volume, t || 0.001);
        }

        source.start(0);
      } else {
        source.connect(panner);
        panner.connect(offlineCtx.destination);
        source.start(0);
      }
    }


    let progressInterval;
    if (onProgress) {
      let est = 0;
      progressInterval = setInterval(() => {
        est = Math.min(0.95, est + 0.03);
        onProgress(est);
      }, 200);
    }

    const rendered = await offlineCtx.startRendering();
    if (progressInterval) clearInterval(progressInterval);
    onProgress?.(1.0);

    return this._encodeWav(rendered);
  }

  _interpolateKfs(kfs, t) {
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

    const cr = (t, a, b, c, d) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };


    const uw = (ref, a) => { let d = a - ref; while (d > 180) d -= 360; while (d < -180) d += 360; return ref + d; };
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


  _encodeWav(audioBuffer) {
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
    const ws = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(o++, s.charCodeAt(i)); };

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
}

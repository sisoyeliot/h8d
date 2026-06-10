import { store } from './store/StateStore';
import { AudioEngine } from './audio/AudioEngine';
import { Visualizer, NODE_COLORS } from './visualizer/Visualizer';
import { Timeline } from './ui/Timeline';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { ResourcePanel } from './ui/ResourcePanel';
import { radialToCartesian, catmullRom, unwrapAngle, formatTime } from './utils';

const audio = new AudioEngine();
const viz = new Visualizer(document.getElementById('scene-canvas') as HTMLCanvasElement);
new Timeline(document.getElementById('timeline-canvas') as HTMLCanvasElement, audio);
new PropertiesPanel(audio);
new ResourcePanel(audio);

let lastFrameTime = performance.now();

function interpolateNode(node: any, time: number) {
  const init = node.initialState;
  const kfs = node.keyframes;

  if (kfs.length === 0) return { ...init };
  if (time <= 0) return { ...init };

  if (time < kfs[0].time) {
    const frac = time / kfs[0].time;
    const ua = unwrapAngle(init.angle, kfs[0].angle);
    return {
      angle: ((init.angle + (ua - init.angle) * frac) % 360 + 360) % 360,
      distance: Math.max(0.5, init.distance + (kfs[0].distance - init.distance) * frac),
      height: init.height + (kfs[0].height - init.height) * frac,
      volume: Math.max(0, Math.min(1, init.volume + (kfs[0].volume - init.volume) * frac)),
      muted: frac < 0.5 ? init.muted : kfs[0].muted,
    };
  }

  if (time >= kfs[kfs.length - 1].time) return { ...kfs[kfs.length - 1] };

  if (kfs.length === 1) return { ...kfs[0] };

  let idx = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time <= kfs[i + 1].time) { idx = i; break; }
  }

  const p1 = kfs[idx];
  const p2 = kfs[idx + 1];
  const frac = (time - p1.time) / (p2.time - p1.time || 1);

  const p0 = idx > 0 ? kfs[idx - 1] : init;
  const p3 = kfs[Math.min(kfs.length - 1, idx + 2)];

  const ua0 = unwrapAngle(p1.angle, p0.angle);
  const ua2 = unwrapAngle(p1.angle, p2.angle);
  const ua3 = unwrapAngle(ua2, p3.angle);

  return {
    angle: ((catmullRom(frac, ua0, p1.angle, ua2, ua3) % 360) + 360) % 360,
    distance: Math.max(0.5, catmullRom(frac, p0.distance, p1.distance, p2.distance, p3.distance)),
    height: catmullRom(frac, p0.height, p1.height, p2.height, p3.height),
    volume: Math.max(0, Math.min(1, p1.volume + (p2.volume - p1.volume) * frac)),
    muted: frac < 0.5 ? p1.muted : p2.muted,
  };
}

function syncNodePosition(id: number, time: number) {
  const node = store.nodes.get(id);
  if (!node) return;
  const s = interpolateNode(node, time);
  const c = radialToCartesian(s.angle, s.distance, s.height);
  viz.updateNodePosition(id, c.x, c.y, c.z);
  audio.setNodePosition(id, c.x, c.y, c.z);
  audio.setNodeVolume(id, s.volume);
  audio.setNodeMuted(id, s.muted);
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  let time = store.currentTime;
  if (store.isPlaying) {
    time = audio.currentTime;
    store.setTime(time);
    
    document.getElementById('time-current')!.textContent = formatTime(time);
    if (time >= store.projectDuration || !audio.isPlaying) {
      store.setPlaying(false);
      audio.stop();
      store.setTime(0);
      document.getElementById('time-current')!.textContent = '0:00';
    }
  }

  const activeIds = new Set<number>();
  for (const [id, node] of store.nodes) {
    syncNodePosition(id, time);
    if (node.resourceId && store.isPlaying) {
      activeIds.add(id);
    }
  }

  const fq = audio.getFrequencyData();
  let b = 0, m = 0;
  if (fq) {
    b = (fq[1] + fq[2] + fq[3]) / 3 / 255;
    m = (fq[10] + fq[15] + fq[20]) / 3 / 255;
  }
  
  viz.render(dt, b, m, activeIds);
}

const renderedNodes = new Set<number>();

store.on('nodesChanged', () => {
  document.getElementById('time-total')!.textContent = formatTime(store.projectDuration);
  document.getElementById('btn-export')!.toggleAttribute('disabled', !audio.hasAssignedTracks);
  
  const currentIds = new Set(store.nodes.keys());

  for (const id of currentIds) {
    if (!renderedNodes.has(id)) {
      const node = store.nodes.get(id);
      if (node) {
        viz.addNode(id, NODE_COLORS[node.colorIndex % NODE_COLORS.length]);
        audio.createNode(id);
        renderedNodes.add(id);
      }
    }
    const node = store.nodes.get(id);
    if (node) {
      audio.setNodeClips(id, node.clips);
    }
  }

  for (const id of renderedNodes) {
    if (!currentIds.has(id)) {
      viz.removeNode(id);
      audio.removeNode(id);
      renderedNodes.delete(id);
    }
  }
});

store.on('selectionChanged', (id) => {
  viz.setSelectedNode(id);
});

store.on('playbackChanged', (playing) => {
  const btn = document.getElementById('btn-play')!;
  const p = document.getElementById('icon-play')!;
  const pp = document.getElementById('icon-pause')!;
  if (playing) {
    p.classList.add('hidden');
    pp.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    p.classList.remove('hidden');
    pp.classList.add('hidden');
    btn.classList.remove('active');
  }
});

store.on('durationChanged', (d) => {
  document.getElementById('time-total')!.textContent = formatTime(d);
});

store.on('timeUpdate', (t) => {
  document.getElementById('time-current')!.textContent = formatTime(t);
  for (const [id] of store.nodes) {
    syncNodePosition(id, t);
  }
});

document.getElementById('btn-play')!.addEventListener('click', () => {
  if (store.isPlaying) {
    audio.pause();
    store.setPlaying(false);
  } else {
    if (store.currentTime >= store.projectDuration) {
      store.setTime(0);
      audio.seek(0);
    } else {
      audio.seek(store.currentTime);
    }
    audio.play();
    store.setPlaying(true);
  }
});

window.addEventListener('keydown', (e) => {
  // Ignore if user is typing in an input field
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.code === 'Space') {
    e.preventDefault();
    document.getElementById('btn-play')!.click();
  }

  if (e.code === 'KeyK' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (store.selectedNodeId === null) return;
    const node = store.nodes.get(store.selectedNodeId);
    if (!node) return;
    
    const t = store.currentTime;
    let changed = false;
    for (let i = 0; i < node.clips.length; i++) {
      const clip = node.clips[i];
      if (t > clip.start && t < clip.start + clip.duration) {
        const diff = t - clip.start;
        const newClip = {
          id: Date.now() + i, // ensure unique
          resourceId: clip.resourceId,
          start: t,
          duration: clip.duration - diff,
          offset: clip.offset + diff
        };
        clip.duration = diff;
        node.clips.push(newClip);
        changed = true;
      }
    }
    if (changed) store.emit('nodesChanged');
  }
});

document.getElementById('btn-export')!.addEventListener('click', () => {
  if (!audio.hasAssignedTracks) return;
  document.getElementById('export-choice-modal')!.hidden = false;
});

document.getElementById('btn-export-choice-cancel')!.addEventListener('click', () => {
  document.getElementById('export-choice-modal')!.hidden = true;
});

document.getElementById('btn-export-choice-project')!.addEventListener('click', async () => {
  document.getElementById('export-choice-modal')!.hidden = true;
  
  try {
    const rawResources = audio.getRawResources();
    const state = {
      nodes: Array.from(store.nodes.entries()),
      duration: store.projectDuration,
      resources: rawResources.map(r => ({ id: r.id, name: r.name, length: r.buffer.byteLength }))
    };

    const headerStr = JSON.stringify(state);
    const headerBytes = new TextEncoder().encode(headerStr);
    
    // Calculate total size: 4 bytes (header length) + header + buffers
    let totalSize = 4 + headerBytes.byteLength;
    for (const r of rawResources) totalSize += r.buffer.byteLength;

    const outBuf = new ArrayBuffer(totalSize);
    const view = new DataView(outBuf);
    const outArr = new Uint8Array(outBuf);

    view.setUint32(0, headerBytes.byteLength, true);
    outArr.set(headerBytes, 4);

    let offset = 4 + headerBytes.byteLength;
    for (const r of rawResources) {
      outArr.set(new Uint8Array(r.buffer), offset);
      offset += r.buffer.byteLength;
    }

    const blob = new Blob([outBuf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Project_${new Date().toISOString().replace(/[:.]/g, '-')}.h8d`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert('Project export failed');
  }
});

document.getElementById('btn-export-choice-audio')!.addEventListener('click', async () => {
  document.getElementById('export-choice-modal')!.hidden = true;
  
  const modal = document.getElementById('export-modal')!;
  const fill = document.getElementById('export-progress-bar')!;
  const text = document.getElementById('export-progress-text')!;
  
  modal.hidden = false;
  fill.style.width = '0%';
  text.textContent = '0%';

  const mvs = Array.from(store.nodes.values()).map(n => ({
    clips: n.clips,
    duration: store.projectDuration,
    keyframes: n.keyframes
  }));

  try {
    const blob = await audio.exportToWav({
      nodeMovements: mvs,
      onProgress: (p) => {
        const pct = Math.round(p * 100);
        fill.style.width = `${pct}%`;
        text.textContent = `${pct}%`;
      }
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `H8D_Export_${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    a.click();
  } catch (err) {
    console.error(err);
    alert('Export failed');
  } finally {
    modal.hidden = true;
  }
});

loop();

const ob = new MutationObserver(() => {
  const btn = document.getElementById('btn-play') as HTMLButtonElement;
  if (btn && audio.hasAssignedTracks) {
    btn.disabled = false;
  }
});
ob.observe(document.body, { childList: true, subtree: true });

document.getElementById('btn-open-project')!.addEventListener('click', () => document.getElementById('file-input-project')!.click());
document.getElementById('btn-welcome-import')!.addEventListener('click', () => document.getElementById('file-input-project')!.click());

function startApp() {
  document.getElementById('welcome-overlay')!.classList.add('fade-out');
  setTimeout(() => { document.getElementById('welcome-overlay')!.hidden = true; }, 400);
  document.getElementById('left-panel')!.hidden = false;
  document.getElementById('timeline-panel')!.hidden = false;
  const gh = document.querySelector('.github-corner') as HTMLElement;
  if(gh) gh.hidden = true;
  // Trigger resize on timeline since it was hidden
  window.dispatchEvent(new Event('resize'));
}

document.getElementById('btn-welcome-new')!.addEventListener('click', () => {
  store.nodes.clear();
  audio.clearResources();
  store.emit('nodesChanged');
  startApp();
});

document.getElementById('btn-new-project')!.addEventListener('click', () => {
  if (confirm("Are you sure you want to clear the current project?")) {
    store.nodes.clear();
    audio.clearResources();
    store.emit('nodesChanged');
  }
});

document.getElementById('file-input-project')!.addEventListener('change', async (e: any) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const view = new DataView(arrayBuffer);
    const headerLength = view.getUint32(0, true);
    
    const headerBytes = new Uint8Array(arrayBuffer, 4, headerLength);
    const headerStr = new TextDecoder().decode(headerBytes);
    const state = JSON.parse(headerStr);
    
    store.nodes.clear();
    audio.clearResources();
    
    let offset = 4 + headerLength;
    for (const res of state.resources) {
      const resBuffer = arrayBuffer.slice(offset, offset + res.length);
      offset += res.length;
      await audio.addResourceFromBuffer(res.id, res.name, resBuffer);
    }
    
    for (const [id, node] of state.nodes) {
      store.nodes.set(id, node);
    }
    
    store.emit('nodesChanged');
    
    store.emit('nodesChanged');
    startApp();
    
  } catch (err) {
    console.error(err);
    alert('Failed to open project file.');
  }
});

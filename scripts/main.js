import { AudioEngine } from './audio-engine.js';
import { Visualizer, NODE_COLORS } from './visualizer.js';
import { Timeline } from './timeline.js';
import { catmullRom, unwrapAngle, radialToCartesian, formatTime } from './utilities.js';


const audio = new AudioEngine();
const canvas = document.getElementById('scene-canvas');
const viz = new Visualizer(canvas);

const $ = (id) => document.getElementById(id);

const $fileInput = $('file-input');
const $btnLoad = $('btn-load');
const $btnPlay = $('btn-play');
const $iconPlay = $('icon-play');
const $iconPause = $('icon-pause');
const $btnExport = $('btn-export');
const $timeCurrent = $('time-current');
const $timeTotal = $('time-total');
const $timelinePanel = $('timeline-panel');
const $controlsPanel = $('controls-panel');
const $welcomeOverlay = $('welcome-overlay');
const $exportModal = $('export-modal');
const $exportProgress = $('export-progress-bar');
const $exportText = $('export-progress-text');

const $nodeList = $('node-list');
const $nodeListEmpty = $('node-list-empty');
const $btnAddNode = $('btn-add-node');

const $nodePanelTitle = $('node-panel-title');
const $btnTrackSelect = $('btn-track-select');
const $trackSelectLabel = $('track-select-label');
const $sliderAngle = $('slider-angle');
const $sliderDistance = $('slider-distance');
const $sliderHeight = $('slider-height');
const $sliderVolume = $('slider-volume');
const $valAngle = $('val-angle');
const $valDistance = $('val-distance');
const $valHeight = $('val-height');
const $valVolume = $('val-volume');
const $toggleMute = $('toggle-mute');
const $kfSectionTitle = $('kf-section-title');
const $keyframeProps = $('keyframe-props');
const $noKfMsg = $('no-kf-msg');
const $btnAddKeyframe = $('btn-add-keyframe');
const $btnDeleteKf = $('btn-delete-keyframe');
const $valKfTime = $('val-kf-time');

const $resourcePicker = $('resource-picker');
const $resourceList = $('resource-list');
const $btnClosePicker = $('btn-close-picker');
const $btnLoadResource = $('btn-load-resource');

/* ── Timeline ── */
const timelineCanvas = $('timeline-canvas');
const timeline = new Timeline(timelineCanvas, {
  onSelect: onTimelineSelect,
  onAdd: onTimelineAdd,
  onMove: onTimelineMove,
  onDelete: onTimelineDelete,
  onSeek: onTimelineSeek,
});


/**
 * nodes: Map<nodeId, {
 *   resourceId,
 *   colorIndex,
 *   keyframes: [{ time, angle, distance, height, volume, muted }]
 * }>
 */
const nodes = new Map();
let selectedNodeId = null;
let selectedKfIndex = -1;  // -1 = no keyframe selected
let nextNodeId = 1;
let nodeColorIndex = 0;

let lastFrameTime = performance.now();
let welcomeDismissed = false;

function interpolateKeyframes(keyframes, time) {
  if (keyframes.length === 0) return { angle: 0, distance: 3, height: 0, volume: 1, muted: false };
  if (keyframes.length === 1 || time <= keyframes[0].time) return { ...keyframes[0] };
  if (time >= keyframes[keyframes.length - 1].time) return { ...keyframes[keyframes.length - 1] };

  let idx = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (time >= keyframes[i].time && time <= keyframes[i + 1].time) { idx = i; break; }
  }

  const p1 = keyframes[idx];
  const p2 = keyframes[idx + 1];
  const frac = (time - p1.time) / (p2.time - p1.time || 1);

  const p0 = keyframes[Math.max(0, idx - 1)];
  const p3 = keyframes[Math.min(keyframes.length - 1, idx + 2)];

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

function computeSpawnPosition() {
  const goldenAngle = 137.508;
  const index = nextNodeId;
  const distanceTiers = [3, 4.5, 6, 2.5, 5];
  const heightOptions = [0, 1, -1, 0.5, -0.5];

  let angle = (index * goldenAngle) % 360;
  let distance = distanceTiers[index % distanceTiers.length];
  let height = heightOptions[index % heightOptions.length];

  const MIN_DIST = 2.0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const { x, y, z } = radialToCartesian(angle, distance, height);
    let collision = false;
    for (const [, node] of nodes) {
      if (node.keyframes.length === 0) continue;
      const kf0 = node.keyframes[0];
      const nc = radialToCartesian(kf0.angle, kf0.distance, kf0.height);
      const dx = x - nc.x, dy = y - nc.y, dz = z - nc.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < MIN_DIST) { collision = true; break; }
    }
    if (!collision) break;
    angle = (angle + 40) % 360;
    distance += 0.4;
  }
  return { angle, distance, height };
}

function dismissWelcome() {
  if (welcomeDismissed) return;
  welcomeDismissed = true;
  $welcomeOverlay.classList.add('fade-out');
  setTimeout(() => { $welcomeOverlay.hidden = true; }, 400);
  $timelinePanel.hidden = false;
  requestAnimationFrame(() => timeline.resize());
}

async function handleFileLoad(files) {
  for (const file of files) {
    try {
      const info = await audio.addResource(file);
      addResourceToPickerList(info);
      dismissWelcome();
      $btnAddNode.disabled = false;
      $btnAddNode.title = 'Add a new spatial node';
      updateTransportState();
    } catch (err) {
      console.error('Failed to load:', file.name, err);
    }
  }
}

function addResourceToPickerList(info) {
  const btn = document.createElement('button');
  btn.className = 'resource-item';
  btn.dataset.resourceId = info.id;
  btn.innerHTML = `
    <span class="resource-item__icon">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </span>
    <span class="resource-item__name">${info.name}</span>
    <span class="resource-item__duration">${formatTime(info.duration)}</span>
  `;
  btn.addEventListener('click', () => pickResource(info.id));
  const noneBtn = $resourceList.querySelector('.resource-item--none');
  noneBtn.after(btn);
}

$btnLoad.addEventListener('click', () => $fileInput.click());
$btnLoadResource.addEventListener('click', () => $fileInput.click());
$fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFileLoad(e.target.files);
  e.target.value = '';
});

document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
document.addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/'));
  if (files.length) handleFileLoad(files);
});


function openResourcePicker() {
  if (selectedNodeId === null) return;
  const node = nodes.get(selectedNodeId);
  $resourceList.querySelectorAll('.resource-item').forEach((el) => {
    const rid = el.dataset.resourceId;
    el.classList.toggle('active',
      (rid === '' && !node.resourceId) || (rid !== '' && parseInt(rid) === node.resourceId)
    );
  });
  $resourcePicker.hidden = false;
}

function closeResourcePicker() { $resourcePicker.hidden = true; }

function pickResource(resourceId) {
  if (selectedNodeId === null) return;
  const node = nodes.get(selectedNodeId);
  node.resourceId = resourceId || null;
  audio.assignTrack(selectedNodeId, node.resourceId);

  const resources = audio.getResources();
  const r = resources.find(r => r.id === resourceId);
  $trackSelectLabel.textContent = r ? r.name : 'None';

  const listItem = $nodeList.querySelector(`[data-node-id="${selectedNodeId}"]`);
  if (listItem) {
    const trackLabel = listItem.querySelector('.node-item__track');
    if (trackLabel) trackLabel.textContent = r ? r.name.replace(/\.[^.]+$/, '') : '';
  }

  updateTransportState();
  closeResourcePicker();
}

$resourceList.querySelector('.resource-item--none').addEventListener('click', () => pickResource(null));
$btnTrackSelect.addEventListener('click', openResourcePicker);
$btnClosePicker.addEventListener('click', closeResourcePicker);
$resourcePicker.addEventListener('click', (e) => { if (e.target === $resourcePicker) closeResourcePicker(); });


function addNode() {
  if (!audio.hasResources) return;

  const id = nextNodeId++;
  const color = NODE_COLORS[nodeColorIndex % NODE_COLORS.length];
  const colorIdx = nodeColorIndex++;
  const spawn = computeSpawnPosition();

  const nodeState = {
    resourceId: null,
    colorIndex: colorIdx,
    keyframes: [{
      time: 0,
      angle: spawn.angle,
      distance: spawn.distance,
      height: spawn.height,
      volume: 1,
      muted: false,
    }],
  };

  nodes.set(id, nodeState);

  audio.createNode(id);
  viz.addNode(id, color);

  const cart = radialToCartesian(spawn.angle, spawn.distance, spawn.height);
  viz.updateNodePosition(id, cart.x, cart.y, cart.z);
  audio.setNodePosition(id, cart.x, cart.y, cart.z);

  createNodeListItem(id, color);
  selectNode(id);
  $nodeListEmpty.hidden = true;
  syncTimeline();
}

function removeNode(id) {
  audio.removeNode(id);
  viz.removeNode(id);
  nodes.delete(id);

  const el = $nodeList.querySelector(`[data-node-id="${id}"]`);
  if (el) el.remove();

  if (selectedNodeId === id) {
    const remaining = [...nodes.keys()];
    if (remaining.length > 0) selectNode(remaining[remaining.length - 1]);
    else { selectedNodeId = null; selectedKfIndex = -1; $controlsPanel.hidden = true; viz.setSelectedNode(null); }
  }

  $nodeListEmpty.hidden = nodes.size > 0;
  updateTransportState();
  syncTimeline();
}

function selectNode(id) {
  if (!nodes.has(id)) return;
  selectedNodeId = id;
  selectedKfIndex = -1; // deselect keyframe when switching nodes

  $nodeList.querySelectorAll('.node-item').forEach((el) => {
    el.classList.toggle('active', parseInt(el.dataset.nodeId) === id);
  });
  viz.setSelectedNode(id);

  $controlsPanel.hidden = false;
  $nodePanelTitle.textContent = `Node ${id}`;

  const node = nodes.get(id);
  const resources = audio.getResources();
  const r = resources.find(r => r.id === node.resourceId);
  $trackSelectLabel.textContent = r ? r.name : 'None';

  showKeyframePanel();
}

function createNodeListItem(id, color) {
  const div = document.createElement('div');
  div.className = 'node-item';
  div.dataset.nodeId = id;
  div.innerHTML = `
    <span class="node-color-dot" style="color:${color}; background:${color}"></span>
    <span class="node-item__name">Node ${id}</span>
    <span class="node-item__track"></span>
    <button class="node-item__delete" aria-label="Delete node">×</button>
  `;
  div.addEventListener('click', (e) => {
    if (!e.target.classList.contains('node-item__delete')) selectNode(id);
  });
  div.querySelector('.node-item__delete').addEventListener('click', (e) => {
    e.stopPropagation(); removeNode(id);
  });
  $nodeList.insertBefore(div, $nodeListEmpty);
}

$btnAddNode.addEventListener('click', addNode);


function showKeyframePanel() {
  if (selectedNodeId === null) return;
  const node = nodes.get(selectedNodeId);

  if (selectedKfIndex >= 0 && selectedKfIndex < node.keyframes.length) {
    $keyframeProps.hidden = false;
    $noKfMsg.hidden = true;
    $kfSectionTitle.textContent = `Keyframe ${selectedKfIndex + 1}/${node.keyframes.length}`;

    const kf = node.keyframes[selectedKfIndex];
    $valKfTime.textContent = `${kf.time.toFixed(1)}s`;
    $sliderAngle.value = kf.angle;
    $sliderDistance.value = kf.distance;
    $sliderHeight.value = kf.height;
    $sliderVolume.value = kf.volume;
    $valAngle.textContent = `${Math.round(kf.angle)}°`;
    $valDistance.textContent = kf.distance.toFixed(1);
    $valHeight.textContent = kf.height.toFixed(1);
    $valVolume.textContent = `${Math.round(kf.volume * 100)}%`;
    $toggleMute.checked = kf.muted;
  } else {
    $keyframeProps.hidden = true;
    $noKfMsg.hidden = false;
    $kfSectionTitle.textContent = 'Keyframe';
  }
}

function updateSelectedKeyframe(field, value) {
  if (selectedNodeId === null || selectedKfIndex < 0) return;
  const node = nodes.get(selectedNodeId);
  if (!node || selectedKfIndex >= node.keyframes.length) return;
  node.keyframes[selectedKfIndex][field] = value;
  syncTimeline();
  syncNodeFromKeyframes(selectedNodeId, audio.currentTime);
}

$sliderAngle.addEventListener('input', () => {
  const v = parseFloat($sliderAngle.value);
  $valAngle.textContent = `${Math.round(v)}°`;
  updateSelectedKeyframe('angle', v);
});
$sliderDistance.addEventListener('input', () => {
  const v = parseFloat($sliderDistance.value);
  $valDistance.textContent = v.toFixed(1);
  updateSelectedKeyframe('distance', v);
});
$sliderHeight.addEventListener('input', () => {
  const v = parseFloat($sliderHeight.value);
  $valHeight.textContent = v.toFixed(1);
  updateSelectedKeyframe('height', v);
});
$sliderVolume.addEventListener('input', () => {
  const v = parseFloat($sliderVolume.value);
  $valVolume.textContent = `${Math.round(v * 100)}%`;
  updateSelectedKeyframe('volume', v);
});
$toggleMute.addEventListener('change', () => {
  updateSelectedKeyframe('muted', $toggleMute.checked);
});

$btnAddKeyframe.addEventListener('click', () => {
  if (selectedNodeId === null) return;
  addKeyframeForNode(selectedNodeId, audio.currentTime);
});

$btnDeleteKf.addEventListener('click', () => {
  if (selectedNodeId === null || selectedKfIndex < 0) return;
  const node = nodes.get(selectedNodeId);
  if (node.keyframes.length <= 1) return;
  node.keyframes.splice(selectedKfIndex, 1);
  selectedKfIndex = -1;
  showKeyframePanel();
  syncTimeline();
});

function addKeyframeForNode(nodeId, time) {
  const node = nodes.get(nodeId);
  if (!node) return;

  const state = interpolateKeyframes(node.keyframes, time);

  const newKf = {
    time: Math.round(time * 10) / 10,
    angle: Math.round(state.angle),
    distance: Math.round(state.distance * 10) / 10,
    height: Math.round(state.height * 10) / 10,
    volume: Math.round(state.volume * 100) / 100,
    muted: state.muted,
  };

  const existing = node.keyframes.findIndex(kf => Math.abs(kf.time - newKf.time) < 0.05);
  if (existing >= 0) {
    selectedKfIndex = existing;
  } else {
    node.keyframes.push(newKf);
    node.keyframes.sort((a, b) => a.time - b.time);
    selectedKfIndex = node.keyframes.indexOf(newKf);
  }

  showKeyframePanel();
  syncTimeline();
}

function onTimelineSelect(nodeId, kfIndex) {
  if (nodeId !== null) {
    if (selectedNodeId !== nodeId) selectNode(nodeId);
    selectedKfIndex = kfIndex;
    showKeyframePanel();
  } else {
    selectedKfIndex = -1;
    showKeyframePanel();
  }
}

function onTimelineAdd(nodeId, time) {
  if (selectedNodeId !== nodeId) selectNode(nodeId);
  addKeyframeForNode(nodeId, time);
}

function onTimelineMove(nodeId, kfIndex, newTime) {
  const node = nodes.get(nodeId);
  if (!node) return;
  node.keyframes[kfIndex].time = newTime;
}

function onTimelineDelete(nodeId, kfIndex) {
  const node = nodes.get(nodeId);
  if (!node || node.keyframes.length <= 1) return;
  node.keyframes.splice(kfIndex, 1);
  if (selectedNodeId === nodeId && selectedKfIndex === kfIndex) {
    selectedKfIndex = -1;
    showKeyframePanel();
  }
  syncTimeline();
}

function onTimelineSeek(time) {
  audio.seek(time);
  $timeCurrent.textContent = formatTime(time);
}

function syncTimeline() {
  const tracks = [];
  for (const [id, node] of nodes) {
    const color = NODE_COLORS[node.colorIndex % NODE_COLORS.length];
    tracks.push({
      id,
      name: `N${id}`,
      color,
      keyframes: node.keyframes,
    });
  }
  timeline.setTracks(tracks);
  timeline.setDuration(audio.maxDuration || 60);

  if (selectedNodeId !== null && selectedKfIndex >= 0) {
    const trackIdx = tracks.findIndex(t => t.id === selectedNodeId);
    timeline.selectKeyframe(trackIdx, selectedKfIndex);
  } else {
    timeline.deselectKeyframe();
  }
}

function syncNodeFromKeyframes(nodeId, time) {
  const node = nodes.get(nodeId);
  if (!node) return;

  const state = interpolateKeyframes(node.keyframes, time);
  const cart = radialToCartesian(state.angle, state.distance, state.height);

  viz.updateNodePosition(nodeId, cart.x, cart.y, cart.z);
  audio.setNodePosition(nodeId, cart.x, cart.y, cart.z);
  audio.setNodeVolume(nodeId, state.volume);
  audio.setNodeMuted(nodeId, state.muted);
}

function updatePlayPauseIcon() {
  $iconPlay.classList.toggle('hidden', audio.isPlaying);
  $iconPause.classList.toggle('hidden', !audio.isPlaying);
}

function updateTransportState() {
  const hasTracks = audio.hasAssignedTracks;
  $btnPlay.disabled = !hasTracks;
  $btnExport.disabled = !hasTracks;

  const dur = audio.maxDuration;
  $timeTotal.textContent = formatTime(dur);
  timeline.setDuration(dur || 60);
}

$btnPlay.addEventListener('click', () => {
  if (audio.isPlaying) audio.pause();
  else audio.play();
  updatePlayPauseIcon();
});

audio.onEnded(() => {
  updatePlayPauseIcon();
  $timeCurrent.textContent = '0:00';
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && audio.hasAssignedTracks && e.target === document.body) {
    e.preventDefault();
    $btnPlay.click();
  }
  if ((e.code === 'Delete' || e.code === 'Backspace') && selectedKfIndex >= 0 && e.target === document.body) {
    $btnDeleteKf.click();
  }
  if (e.code === 'KeyK' && selectedNodeId !== null && e.target === document.body) {
    $btnAddKeyframe.click();
  }
});


$btnExport.addEventListener('click', async () => {
  if (!audio.hasAssignedTracks) return;
  $exportModal.hidden = false;
  $exportProgress.style.width = '0%';
  $exportText.textContent = '0%';

  try {
    const nodeMovements = [];
    for (const [, node] of nodes) {
      nodeMovements.push({
        resourceId: node.resourceId,
        keyframes: node.keyframes,
      });
    }

    const wavBlob = await audio.exportToWav({
      nodeMovements,
      onProgress: (p) => {
        const pct = Math.round(p * 100);
        $exportProgress.style.width = `${pct}%`;
        $exportText.textContent = `${pct}%`;
      },
    });

    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url; a.download = 'halo_8D_export.wav';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export failed:', err);
  } finally {
    setTimeout(() => { $exportModal.hidden = true; }, 600);
  }
});

function animate(now) {
  requestAnimationFrame(animate);

  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  const currentTime = audio.currentTime;

  const activeNodeIds = new Set();

  for (const [id, node] of nodes) {
    const state = interpolateKeyframes(node.keyframes, currentTime);
    const cart = radialToCartesian(state.angle, state.distance, state.height);

    viz.updateNodePosition(id, cart.x, cart.y, cart.z);
    audio.setNodePosition(id, cart.x, cart.y, cart.z);
    audio.setNodeVolume(id, state.volume);
    audio.setNodeMuted(id, state.muted);

    if (node.resourceId && !state.muted && state.volume > 0) {
      activeNodeIds.add(id);
    }
  }

  let bassEnergy = 0, midEnergy = 0;
  const freqData = audio.getFrequencyData();
  if (freqData && freqData.length > 0) {
    const bassEnd = Math.floor(freqData.length * 0.1);
    for (let i = 0; i < bassEnd; i++) bassEnergy += freqData[i];
    bassEnergy = (bassEnergy / bassEnd) / 255;
    const midStart = bassEnd, midEnd = Math.floor(freqData.length * 0.4);
    for (let i = midStart; i < midEnd; i++) midEnergy += freqData[i];
    midEnergy = (midEnergy / (midEnd - midStart)) / 255;
  }

  viz.render(deltaTime, bassEnergy, midEnergy, activeNodeIds);
  timeline.setPlayhead(currentTime);
  timeline.render();

  if (audio.isPlaying) {
    $timeCurrent.textContent = formatTime(currentTime);
  }
}

requestAnimationFrame(animate);

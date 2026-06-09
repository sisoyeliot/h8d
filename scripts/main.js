/* ═══════════════════════════════════════════════════════════
   H8D — Main Entry Point v4

   • Initial-state model (no t=0 keyframe)
   • Resource panel with preview playback
   • Keyframe selection bug fix
   • Adjustable project duration
   ═══════════════════════════════════════════════════════════ */

import { AudioEngine } from './audio-engine.js';
import { Visualizer, NODE_COLORS } from './visualizer.js';
import { Timeline } from './timeline.js';
import { catmullRom, unwrapAngle, radialToCartesian, formatTime } from './utilities.js';


/* ══════════════════════════════
   Init
   ══════════════════════════════ */

const audio = new AudioEngine();
const canvas = document.getElementById('scene-canvas');
const viz = new Visualizer(canvas);

const $ = (id) => document.getElementById(id);

/* ── DOM refs ── */
const $fileInput        = $('file-input');
const $fileInputWelcome = $('file-input-welcome');
const $btnUpload        = $('btn-upload');
const $btnPlay          = $('btn-play');
const $iconPlay         = $('icon-play');
const $iconPause        = $('icon-pause');
const $btnExport        = $('btn-export');
const $timeCurrent      = $('time-current');
const $timeTotal        = $('time-total');
const $inputDuration    = $('input-duration');
const $timelinePanel    = $('timeline-panel');
const $controlsPanel    = $('controls-panel');
const $welcomeOverlay   = $('welcome-overlay');
const $btnWelcomeUpload = $('btn-welcome-upload');
const $exportModal      = $('export-modal');
const $exportProgress   = $('export-progress-bar');
const $exportText       = $('export-progress-text');

const $resourceList     = $('resource-list');
const $resourceEmpty    = $('resource-empty');

const $nodeList         = $('node-list');
const $nodeListEmpty    = $('node-list-empty');
const $btnAddNode       = $('btn-add-node');

const $nodePanelTitle   = $('node-panel-title');
const $btnTrackSelect   = $('btn-track-select');
const $trackSelectLabel = $('track-select-label');

// Initial state sliders
const $sInitAngle    = $('slider-init-angle');
const $sInitDistance = $('slider-init-distance');
const $sInitHeight   = $('slider-init-height');
const $sInitVolume   = $('slider-init-volume');
const $vInitAngle    = $('val-init-angle');
const $vInitDistance = $('val-init-distance');
const $vInitHeight   = $('val-init-height');
const $vInitVolume   = $('val-init-volume');
const $tInitMute     = $('toggle-init-mute');

// Keyframe sliders
const $kfSectionTitle = $('kf-section-title');
const $keyframeProps   = $('keyframe-props');
const $noKfMsg         = $('no-kf-msg');
const $btnAddKeyframe  = $('btn-add-keyframe');
const $btnDeleteKf     = $('btn-delete-keyframe');
const $valKfTime       = $('val-kf-time');
const $sKfAngle    = $('slider-kf-angle');
const $sKfDistance = $('slider-kf-distance');
const $sKfHeight   = $('slider-kf-height');
const $sKfVolume   = $('slider-kf-volume');
const $vKfAngle    = $('val-kf-angle');
const $vKfDistance = $('val-kf-distance');
const $vKfHeight   = $('val-kf-height');
const $vKfVolume   = $('val-kf-volume');
const $tKfMute     = $('toggle-kf-mute');

// Resource picker
const $resourcePicker  = $('resource-picker');
const $pickerList      = $('picker-list');
const $btnClosePicker  = $('btn-close-picker');
const $btnPickerLoad   = $('btn-picker-load');

/* ── Timeline ── */
const timelineCanvas = $('timeline-canvas');
const timeline = new Timeline(timelineCanvas, {
  onSelect:  onTimelineSelect,
  onAdd:     onTimelineAdd,
  onMove:    onTimelineMove,
  onDelete:  onTimelineDelete,
  onSeek:    onTimelineSeek,
});


/* ══════════════════════════════
   State
   ══════════════════════════════ */

/**
 * Node data model:
 * {
 *   resourceId: number|null,
 *   colorIndex: number,
 *   initialState: { angle, distance, height, volume, muted },
 *   keyframes: [{ time, angle, distance, height, volume, muted }]  // empty by default
 * }
 */
const nodes = new Map();
let selectedNodeId = null;
let selectedKfIndex = -1;
let nextNodeId = 1;
let nodeColorIndex = 0;
let projectDuration = 60; // seconds, adjustable by user

let lastFrameTime = performance.now();
let welcomeDismissed = false;

// Preview playback state
let previewSource = null;
let previewResourceId = null;


/* ══════════════════════════════
   Interpolation (initial state aware)
   ══════════════════════════════ */

function interpolateNode(node, time) {
  const init = node.initialState;
  const kfs = node.keyframes;

  if (kfs.length === 0) return { ...init };

  // Before first keyframe → interpolate from initial state
  if (time <= 0) return { ...init };

  if (time < kfs[0].time) {
    const frac = time / kfs[0].time;
    return lerpState(init, kfs[0], frac);
  }

  // After last keyframe
  if (time >= kfs[kfs.length - 1].time) return { ...kfs[kfs.length - 1] };

  // Between keyframes — Catmull-Rom
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

function lerpState(a, b, t) {
  const ua = unwrapAngle(a.angle, b.angle);
  return {
    angle: ((a.angle + (ua - a.angle) * t) % 360 + 360) % 360,
    distance: Math.max(0.5, a.distance + (b.distance - a.distance) * t),
    height: a.height + (b.height - a.height) * t,
    volume: Math.max(0, Math.min(1, a.volume + (b.volume - a.volume) * t)),
    muted: t < 0.5 ? a.muted : b.muted,
  };
}


/* ══════════════════════════════
   Spawn
   ══════════════════════════════ */

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
      const nc = radialToCartesian(node.initialState.angle, node.initialState.distance, node.initialState.height);
      const dx = x - nc.x, dy = y - nc.y, dz = z - nc.z;
      if (Math.sqrt(dx*dx + dy*dy + dz*dz) < MIN_DIST) { collision = true; break; }
    }
    if (!collision) break;
    angle = (angle + 40) % 360;
    distance += 0.4;
  }
  return { angle, distance, height };
}


/* ══════════════════════════════
   Welcome
   ══════════════════════════════ */

function dismissWelcome() {
  if (welcomeDismissed) return;
  welcomeDismissed = true;
  $welcomeOverlay.classList.add('fade-out');
  setTimeout(() => { $welcomeOverlay.hidden = true; }, 400);
  $timelinePanel.hidden = false;
  requestAnimationFrame(() => timeline.resize());
}


/* ══════════════════════════════
   Resource Management
   ══════════════════════════════ */

async function handleFileLoad(files) {
  for (const file of files) {
    try {
      const info = await audio.addResource(file);
      addResourceToUI(info);
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

function addResourceToUI(info) {
  $resourceEmpty.hidden = true;

  const div = document.createElement('div');
  div.className = 'resource-item';
  div.dataset.resourceId = info.id;
  div.innerHTML = `
    <span class="resource-item__icon">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </span>
    <span class="resource-item__name">${info.name}</span>
    <span class="resource-item__duration">${formatTime(info.duration)}</span>
    <button class="resource-item__preview" title="Preview" data-action="preview">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>
    </button>
    <button class="resource-item__delete" title="Remove" data-action="delete">×</button>
  `;

  // Preview
  div.querySelector('[data-action="preview"]').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePreview(info.id, div.querySelector('[data-action="preview"]'));
  });

  // Delete
  div.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
    e.stopPropagation();
    removeResource(info.id);
    div.remove();
    if ($resourceList.querySelectorAll('.resource-item').length === 0) {
      $resourceEmpty.hidden = false;
    }
  });

  $resourceList.appendChild(div);
}

function addResourceToPickerList(info) {
  const btn = document.createElement('button');
  btn.className = 'picker-item';
  btn.dataset.resourceId = info.id;
  btn.innerHTML = `
    <span class="picker-item__icon">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </span>
    <span class="picker-item__name">${info.name}</span>
    <span class="picker-item__duration">${formatTime(info.duration)}</span>
  `;
  btn.addEventListener('click', () => pickResource(info.id));
  $pickerList.appendChild(btn);
}

function removeResource(id) {
  audio.removeResource(id);
  // Remove from picker
  const pickerItem = $pickerList.querySelector(`[data-resource-id="${id}"]`);
  if (pickerItem) pickerItem.remove();
  // Unassign from any nodes
  for (const [nodeId, node] of nodes) {
    if (node.resourceId === id) {
      node.resourceId = null;
      const listItem = $nodeList.querySelector(`[data-node-id="${nodeId}"]`);
      if (listItem) {
        const trackLabel = listItem.querySelector('.node-item__track');
        if (trackLabel) trackLabel.textContent = '';
      }
    }
  }
  if (selectedNodeId !== null) {
    const node = nodes.get(selectedNodeId);
    if (node && !node.resourceId) $trackSelectLabel.textContent = 'None';
  }
  updateTransportState();
}

// Preview playback (separate from spatial pipeline)
function togglePreview(resourceId, btn) {
  if (previewSource && previewResourceId === resourceId) {
    stopPreview();
    return;
  }
  stopPreview();
  const resources = audio.getResources();
  const r = resources.find(r => r.id === resourceId);
  if (!r) return;

  audio._initContext();
  const source = audio._ctx.createBufferSource();
  const res = audio._resources.get(resourceId);
  if (!res) return;
  source.buffer = res.buffer;
  source.connect(audio._ctx.destination);
  source.onended = () => { stopPreview(); };
  source.start(0);
  previewSource = source;
  previewResourceId = resourceId;
  btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';
}

function stopPreview() {
  if (previewSource) {
    try { previewSource.stop(); } catch (_) {}
    previewSource = null;
  }
  // Reset all preview buttons
  document.querySelectorAll('.resource-item__preview').forEach(btn => {
    btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>';
  });
  previewResourceId = null;
}

// File input bindings
$btnUpload.addEventListener('click', () => $fileInput.click());
$btnWelcomeUpload.addEventListener('click', () => $fileInputWelcome.click());
$btnPickerLoad.addEventListener('click', () => $fileInput.click());

$fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFileLoad(e.target.files);
  e.target.value = '';
});
$fileInputWelcome.addEventListener('change', (e) => {
  if (e.target.files.length) handleFileLoad(e.target.files);
  e.target.value = '';
});

// Drag & drop
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
document.addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/'));
  if (files.length) handleFileLoad(files);
});


/* ══════════════════════════════
   Resource Picker
   ══════════════════════════════ */

function openResourcePicker() {
  if (selectedNodeId === null) return;
  const node = nodes.get(selectedNodeId);
  $pickerList.querySelectorAll('.picker-item').forEach((el) => {
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

$pickerList.querySelector('.picker-item--none').addEventListener('click', () => pickResource(null));
$btnTrackSelect.addEventListener('click', openResourcePicker);
$btnClosePicker.addEventListener('click', closeResourcePicker);
$resourcePicker.addEventListener('click', (e) => { if (e.target === $resourcePicker) closeResourcePicker(); });


/* ══════════════════════════════
   Node Management
   ══════════════════════════════ */

function addNode() {
  if (!audio.hasResources) return;

  const id = nextNodeId++;
  const color = NODE_COLORS[nodeColorIndex % NODE_COLORS.length];
  const colorIdx = nodeColorIndex++;
  const spawn = computeSpawnPosition();

  const nodeState = {
    resourceId: null,
    colorIndex: colorIdx,
    initialState: {
      angle: spawn.angle,
      distance: spawn.distance,
      height: spawn.height,
      volume: 1,
      muted: false,
    },
    keyframes: [], // empty — no initial keyframe
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
  const isNewSelection = selectedNodeId !== id;
  selectedNodeId = id;
  if (isNewSelection) selectedKfIndex = -1;

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

  // Populate initial state sliders
  const init = node.initialState;
  $sInitAngle.value = init.angle;
  $sInitDistance.value = init.distance;
  $sInitHeight.value = init.height;
  $sInitVolume.value = init.volume;
  $vInitAngle.textContent = `${Math.round(init.angle)}°`;
  $vInitDistance.textContent = init.distance.toFixed(1);
  $vInitHeight.textContent = init.height.toFixed(1);
  $vInitVolume.textContent = `${Math.round(init.volume * 100)}%`;
  $tInitMute.checked = init.muted;

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


/* ══════════════════════════════
   Initial State Sliders
   ══════════════════════════════ */

function updateInitialState(field, value) {
  if (selectedNodeId === null) return;
  const node = nodes.get(selectedNodeId);
  if (!node) return;
  node.initialState[field] = value;
  syncTimeline();
  syncNodePosition(selectedNodeId, audio.currentTime);
}

$sInitAngle.addEventListener('input', () => {
  const v = parseFloat($sInitAngle.value);
  $vInitAngle.textContent = `${Math.round(v)}°`;
  updateInitialState('angle', v);
});
$sInitDistance.addEventListener('input', () => {
  const v = parseFloat($sInitDistance.value);
  $vInitDistance.textContent = v.toFixed(1);
  updateInitialState('distance', v);
});
$sInitHeight.addEventListener('input', () => {
  const v = parseFloat($sInitHeight.value);
  $vInitHeight.textContent = v.toFixed(1);
  updateInitialState('height', v);
});
$sInitVolume.addEventListener('input', () => {
  const v = parseFloat($sInitVolume.value);
  $vInitVolume.textContent = `${Math.round(v * 100)}%`;
  updateInitialState('volume', v);
});
$tInitMute.addEventListener('change', () => {
  updateInitialState('muted', $tInitMute.checked);
});


/* ══════════════════════════════
   Keyframe Panel
   ══════════════════════════════ */

function showKeyframePanel() {
  if (selectedNodeId === null) return;
  const node = nodes.get(selectedNodeId);

  if (selectedKfIndex >= 0 && selectedKfIndex < node.keyframes.length) {
    $keyframeProps.hidden = false;
    $noKfMsg.hidden = true;
    $kfSectionTitle.textContent = `Keyframe ${selectedKfIndex + 1}/${node.keyframes.length}`;

    const kf = node.keyframes[selectedKfIndex];
    $valKfTime.textContent = `${kf.time.toFixed(1)}s`;
    $sKfAngle.value = kf.angle;
    $sKfDistance.value = kf.distance;
    $sKfHeight.value = kf.height;
    $sKfVolume.value = kf.volume;
    $vKfAngle.textContent = `${Math.round(kf.angle)}°`;
    $vKfDistance.textContent = kf.distance.toFixed(1);
    $vKfHeight.textContent = kf.height.toFixed(1);
    $vKfVolume.textContent = `${Math.round(kf.volume * 100)}%`;
    $tKfMute.checked = kf.muted;
  } else {
    $keyframeProps.hidden = true;
    $noKfMsg.hidden = false;
    $kfSectionTitle.textContent = 'Keyframe';
  }
}


/* ══════════════════════════════
   Keyframe Sliders
   ══════════════════════════════ */

function updateSelectedKeyframe(field, value) {
  if (selectedNodeId === null || selectedKfIndex < 0) return;
  const node = nodes.get(selectedNodeId);
  if (!node || selectedKfIndex >= node.keyframes.length) return;
  node.keyframes[selectedKfIndex][field] = value;
  syncTimeline();
  syncNodePosition(selectedNodeId, audio.currentTime);
}

$sKfAngle.addEventListener('input', () => {
  const v = parseFloat($sKfAngle.value);
  $vKfAngle.textContent = `${Math.round(v)}°`;
  updateSelectedKeyframe('angle', v);
});
$sKfDistance.addEventListener('input', () => {
  const v = parseFloat($sKfDistance.value);
  $vKfDistance.textContent = v.toFixed(1);
  updateSelectedKeyframe('distance', v);
});
$sKfHeight.addEventListener('input', () => {
  const v = parseFloat($sKfHeight.value);
  $vKfHeight.textContent = v.toFixed(1);
  updateSelectedKeyframe('height', v);
});
$sKfVolume.addEventListener('input', () => {
  const v = parseFloat($sKfVolume.value);
  $vKfVolume.textContent = `${Math.round(v * 100)}%`;
  updateSelectedKeyframe('volume', v);
});
$tKfMute.addEventListener('change', () => {
  updateSelectedKeyframe('muted', $tKfMute.checked);
});

$btnAddKeyframe.addEventListener('click', () => {
  if (selectedNodeId === null) return;
  addKeyframeForNode(selectedNodeId, audio.currentTime);
});

$btnDeleteKf.addEventListener('click', () => {
  if (selectedNodeId === null || selectedKfIndex < 0) return;
  const node = nodes.get(selectedNodeId);
  node.keyframes.splice(selectedKfIndex, 1);
  selectedKfIndex = -1;
  showKeyframePanel();
  syncTimeline();
});


/* ══════════════════════════════
   Keyframe Operations
   ══════════════════════════════ */

function addKeyframeForNode(nodeId, time) {
  const node = nodes.get(nodeId);
  if (!node) return;

  const state = interpolateNode(node, time);

  const newKf = {
    time: Math.round(Math.max(0.1, time) * 10) / 10,
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


/* ══════════════════════════════
   Timeline Callbacks (bugfix: don't deselect on same-node click)
   ══════════════════════════════ */

function onTimelineSelect(nodeId, kfIndex) {
  if (nodeId !== null) {
    // Only call selectNode if changing nodes (avoids resetting kfIndex)
    if (selectedNodeId !== nodeId) {
      selectedNodeId = nodeId;
      selectedKfIndex = kfIndex;
      // Update node list highlight
      $nodeList.querySelectorAll('.node-item').forEach((el) => {
        el.classList.toggle('active', parseInt(el.dataset.nodeId) === nodeId);
      });
      viz.setSelectedNode(nodeId);
      $controlsPanel.hidden = false;
      $nodePanelTitle.textContent = `Node ${nodeId}`;
      const node = nodes.get(nodeId);
      const resources = audio.getResources();
      const r = resources.find(r => r.id === node.resourceId);
      $trackSelectLabel.textContent = r ? r.name : 'None';
      // Populate initial state
      const init = node.initialState;
      $sInitAngle.value = init.angle;
      $sInitDistance.value = init.distance;
      $sInitHeight.value = init.height;
      $sInitVolume.value = init.volume;
      $vInitAngle.textContent = `${Math.round(init.angle)}°`;
      $vInitDistance.textContent = init.distance.toFixed(1);
      $vInitHeight.textContent = init.height.toFixed(1);
      $vInitVolume.textContent = `${Math.round(init.volume * 100)}%`;
      $tInitMute.checked = init.muted;
    } else {
      selectedKfIndex = kfIndex;
    }
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
  node.keyframes[kfIndex].time = Math.max(0.1, newTime); // Prevent keyframe at t=0
}

function onTimelineDelete(nodeId, kfIndex) {
  const node = nodes.get(nodeId);
  if (!node) return;
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


/* ══════════════════════════════
   Timeline Sync
   ══════════════════════════════ */

function syncTimeline() {
  const tracks = [];
  for (const [id, node] of nodes) {
    const color = NODE_COLORS[node.colorIndex % NODE_COLORS.length];
    tracks.push({
      id,
      name: `N${id}`,
      color,
      hasInitial: true,
      keyframes: node.keyframes,
    });
  }
  timeline.setTracks(tracks);
  timeline.setDuration(projectDuration);

  if (selectedNodeId !== null && selectedKfIndex >= 0) {
    const trackIdx = tracks.findIndex(t => t.id === selectedNodeId);
    timeline.selectKeyframe(trackIdx, selectedKfIndex);
  } else {
    timeline.deselectKeyframe();
  }
}


/* ══════════════════════════════
   Sync Node Position
   ══════════════════════════════ */

function syncNodePosition(nodeId, time) {
  const node = nodes.get(nodeId);
  if (!node) return;
  const state = interpolateNode(node, time);
  const cart = radialToCartesian(state.angle, state.distance, state.height);
  viz.updateNodePosition(nodeId, cart.x, cart.y, cart.z);
  audio.setNodePosition(nodeId, cart.x, cart.y, cart.z);
  audio.setNodeVolume(nodeId, state.volume);
  audio.setNodeMuted(nodeId, state.muted);
}


/* ══════════════════════════════
   Transport
   ══════════════════════════════ */

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
  // Auto-extend project duration if audio is longer
  if (dur > projectDuration) {
    projectDuration = Math.ceil(dur) + 5;
    $inputDuration.value = projectDuration;
  }
  timeline.setDuration(projectDuration);
}

$btnPlay.addEventListener('click', () => {
  stopPreview(); // Stop any resource preview
  if (audio.isPlaying) audio.pause();
  else audio.play();
  updatePlayPauseIcon();
});

audio.onEnded(() => {
  updatePlayPauseIcon();
  $timeCurrent.textContent = '0:00';
});

// Duration input
$inputDuration.addEventListener('change', () => {
  const v = Math.max(1, Math.min(600, parseInt($inputDuration.value) || 60));
  projectDuration = v;
  $inputDuration.value = v;
  timeline.setDuration(v);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Space' && audio.hasAssignedTracks) {
    e.preventDefault();
    $btnPlay.click();
  }
  if ((e.code === 'Delete' || e.code === 'Backspace') && selectedKfIndex >= 0) {
    $btnDeleteKf.click();
  }
  if (e.code === 'KeyK' && selectedNodeId !== null) {
    $btnAddKeyframe.click();
  }
});


/* ══════════════════════════════
   Export
   ══════════════════════════════ */

$btnExport.addEventListener('click', async () => {
  if (!audio.hasAssignedTracks) return;
  $exportModal.hidden = false;
  $exportProgress.style.width = '0%';
  $exportText.textContent = '0%';

  try {
    const nodeMovements = [];
    for (const [, node] of nodes) {
      // Build keyframes including initial state as t=0 for export
      const exportKfs = [
        { time: 0, ...node.initialState },
        ...node.keyframes,
      ];
      nodeMovements.push({
        resourceId: node.resourceId,
        keyframes: exportKfs,
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
    a.href = url; a.download = 'h8d_export.wav';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export failed:', err);
  } finally {
    setTimeout(() => { $exportModal.hidden = true; }, 600);
  }
});


/* ══════════════════════════════
   Animation Loop
   ══════════════════════════════ */

function animate(now) {
  requestAnimationFrame(animate);

  const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  const currentTime = audio.currentTime;

  // Sync all nodes
  const activeNodeIds = new Set();

  for (const [id, node] of nodes) {
    const state = interpolateNode(node, currentTime);
    const cart = radialToCartesian(state.angle, state.distance, state.height);

    viz.updateNodePosition(id, cart.x, cart.y, cart.z);
    audio.setNodePosition(id, cart.x, cart.y, cart.z);
    audio.setNodeVolume(id, state.volume);
    audio.setNodeMuted(id, state.muted);

    if (node.resourceId && !state.muted && state.volume > 0) {
      activeNodeIds.add(id);
    }
  }

  // Audio energy
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

  // Render
  viz.render(deltaTime, bassEnergy, midEnergy, activeNodeIds);
  timeline.setPlayhead(currentTime);
  timeline.render();

  if (audio.isPlaying) {
    $timeCurrent.textContent = formatTime(currentTime);
  }
}

requestAnimationFrame(animate);

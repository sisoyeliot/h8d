import { store } from '../store/StateStore';
import { AudioEngine } from '../audio/AudioEngine';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export class PropertiesPanel {
  private _panel = $('controls-panel');
  private _title = $('node-panel-title');
  private _trackSelect = $('track-select') as HTMLSelectElement;
  
  private _sInitAngle = $('slider-init-angle') as HTMLInputElement;
  private _sInitDistance = $('slider-init-distance') as HTMLInputElement;
  private _sInitHeight = $('slider-init-height') as HTMLInputElement;
  private _sInitVolume = $('slider-init-volume') as HTMLInputElement;
  private _vInitAngle = $('val-init-angle');
  private _vInitDistance = $('val-init-distance');
  private _vInitHeight = $('val-init-height');
  private _vInitVolume = $('val-init-volume');
  private _tInitMute = $('toggle-init-mute') as HTMLInputElement;

  private _kfSectionTitle = $('kf-section-title');
  private _keyframeProps = $('keyframe-props');
  private _noKfMsg = $('no-kf-msg');
  private _valKfTime = $('val-kf-time');
  
  private _sKfAngle = $('slider-kf-angle') as HTMLInputElement;
  private _sKfDistance = $('slider-kf-distance') as HTMLInputElement;
  private _sKfHeight = $('slider-kf-height') as HTMLInputElement;
  private _sKfVolume = $('slider-kf-volume') as HTMLInputElement;
  private _vKfAngle = $('val-kf-angle');
  private _vKfDistance = $('val-kf-distance');
  private _vKfHeight = $('val-kf-height');
  private _vKfVolume = $('val-kf-volume');
  private _tKfMute = $('toggle-kf-mute') as HTMLInputElement;

  constructor(private audio: AudioEngine) {
    this._bindEvents();
    
    store.on('selectionChanged', () => this.update());
    store.on('nodesChanged', () => this.update());
  }

  private _bindEvents() {
    this._trackSelect.addEventListener('change', () => {
      if (store.selectedNodeId === null) return;
      const node = store.nodes.get(store.selectedNodeId);
      if (!node) return;

      const ridStr = this._trackSelect.value;
      if (ridStr === '') {
        node.resourceId = null;
        node.clips = [];
      } else {
        const id = parseInt(ridStr);
        const r = this.audio.getResources().find(x => x.id === id);
        node.resourceId = id;
        if (r && node.clips.length === 0) {
          node.clips.push({
            id: Date.now(),
            resourceId: id,
            start: 0,
            duration: r.duration,
            offset: 0
          });
        }
      }
      store.emit('nodesChanged');
    });
    this._sInitAngle.addEventListener('input', () => {
      const v = parseFloat(this._sInitAngle.value);
      this._vInitAngle.textContent = `${Math.round(v)}°`;
      this._updateInitialState('angle', v);
    });
    this._sInitDistance.addEventListener('input', () => {
      const v = parseFloat(this._sInitDistance.value);
      this._vInitDistance.textContent = v.toFixed(1);
      this._updateInitialState('distance', v);
    });
    this._sInitHeight.addEventListener('input', () => {
      const v = parseFloat(this._sInitHeight.value);
      this._vInitHeight.textContent = v.toFixed(1);
      this._updateInitialState('height', v);
    });
    this._sInitVolume.addEventListener('input', () => {
      const v = parseFloat(this._sInitVolume.value);
      this._vInitVolume.textContent = `${Math.round(v * 100)}%`;
      this._updateInitialState('volume', v);
    });
    this._tInitMute.addEventListener('change', () => {
      this._updateInitialState('muted', this._tInitMute.checked);
    });

    this._sKfAngle.addEventListener('input', () => {
      const v = parseFloat(this._sKfAngle.value);
      this._vKfAngle.textContent = `${Math.round(v)}°`;
      this._updateKeyframeState('angle', v);
    });
    this._sKfDistance.addEventListener('input', () => {
      const v = parseFloat(this._sKfDistance.value);
      this._vKfDistance.textContent = v.toFixed(1);
      this._updateKeyframeState('distance', v);
    });
    this._sKfHeight.addEventListener('input', () => {
      const v = parseFloat(this._sKfHeight.value);
      this._vKfHeight.textContent = v.toFixed(1);
      this._updateKeyframeState('height', v);
    });
    this._sKfVolume.addEventListener('input', () => {
      const v = parseFloat(this._sKfVolume.value);
      this._vKfVolume.textContent = `${Math.round(v * 100)}%`;
      this._updateKeyframeState('volume', v);
    });
    this._tKfMute.addEventListener('change', () => {
      this._updateKeyframeState('muted', this._tKfMute.checked);
    });

    $('btn-add-keyframe').addEventListener('click', () => {
      if (store.selectedNodeId === null) return;
      const node = store.nodes.get(store.selectedNodeId);
      if (!node) return;
      
      const t = store.currentTime;
      node.keyframes.push({
        time: Math.round(Math.max(0.1, t) * 10) / 10,
        angle: parseFloat(this._sInitAngle.value),
        distance: parseFloat(this._sInitDistance.value),
        height: parseFloat(this._sInitHeight.value),
        volume: parseFloat(this._sInitVolume.value),
        muted: this._tInitMute.checked
      });
      node.keyframes.sort((a, b) => a.time - b.time);
      
      const idx = node.keyframes.findIndex(k => Math.abs(k.time - Math.round(Math.max(0.1, t) * 10) / 10) < 0.05);
      store.selectNode(store.selectedNodeId, idx);
      store.emit('nodesChanged');
    });

    $('btn-delete-keyframe').addEventListener('click', () => {
      if (store.selectedNodeId === null || store.selectedKfIndex < 0) return;
      const node = store.nodes.get(store.selectedNodeId);
      if (node) {
        node.keyframes.splice(store.selectedKfIndex, 1);
        store.selectNode(store.selectedNodeId, -1);
        store.emit('nodesChanged');
      }
    });
  }

  private _updateInitialState(field: string, value: any) {
    if (store.selectedNodeId === null) return;
    const node = store.nodes.get(store.selectedNodeId);
    if (node) {
      (node.initialState as any)[field] = value;
      store.emit('nodesChanged');
    }
  }

  private _updateKeyframeState(field: string, value: any) {
    if (store.selectedNodeId === null || store.selectedKfIndex < 0) return;
    const node = store.nodes.get(store.selectedNodeId);
    if (node && node.keyframes[store.selectedKfIndex]) {
      (node.keyframes[store.selectedKfIndex] as any)[field] = value;
      store.emit('nodesChanged');
    }
  }

  update() {
    if (store.selectedNodeId === null) {
      this._panel.hidden = true;
      return;
    }
    
    const node = store.nodes.get(store.selectedNodeId);
    if (!node) return;

    this._panel.hidden = false;
    this._title.textContent = `Node ${store.selectedNodeId}`;

    const resources = this.audio.getResources();
    this._trackSelect.innerHTML = '<option value="">None</option>';
    resources.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id.toString();
      opt.textContent = r.name;
      this._trackSelect.appendChild(opt);
    });
    
    if (node.resourceId !== null) {
      this._trackSelect.value = node.resourceId.toString();
    } else {
      this._trackSelect.value = '';
    }

    const init = node.initialState;
    this._sInitAngle.value = init.angle.toString();
    this._sInitDistance.value = init.distance.toString();
    this._sInitHeight.value = init.height.toString();
    this._sInitVolume.value = init.volume.toString();
    this._vInitAngle.textContent = `${Math.round(init.angle)}°`;
    this._vInitDistance.textContent = init.distance.toFixed(1);
    this._vInitHeight.textContent = init.height.toFixed(1);
    this._vInitVolume.textContent = `${Math.round(init.volume * 100)}%`;
    this._tInitMute.checked = init.muted;

    if (store.selectedKfIndex >= 0 && store.selectedKfIndex < node.keyframes.length) {
      this._keyframeProps.hidden = false;
      this._noKfMsg.hidden = true;
      this._kfSectionTitle.textContent = `Keyframe ${store.selectedKfIndex + 1}/${node.keyframes.length}`;

      const kf = node.keyframes[store.selectedKfIndex];
      this._valKfTime.textContent = `${kf.time.toFixed(1)}s`;
      this._sKfAngle.value = kf.angle.toString();
      this._sKfDistance.value = kf.distance.toString();
      this._sKfHeight.value = kf.height.toString();
      this._sKfVolume.value = kf.volume.toString();
      this._vKfAngle.textContent = `${Math.round(kf.angle)}°`;
      this._vKfDistance.textContent = kf.distance.toFixed(1);
      this._vKfHeight.textContent = kf.height.toFixed(1);
      this._vKfVolume.textContent = `${Math.round(kf.volume * 100)}%`;
      this._tKfMute.checked = kf.muted;
    } else {
      this._keyframeProps.hidden = true;
      this._noKfMsg.hidden = false;
      this._kfSectionTitle.textContent = 'Keyframe';
    }
  }
}

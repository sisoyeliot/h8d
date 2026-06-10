import { store } from '../store/StateStore';
import { AudioEngine } from '../audio/AudioEngine';

export class Timeline {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _dpr: number;

  private _rulerH = 28;
  private _trackH = 48;
  private _nameW = 90;
  private _kfR = 4;
  private _width = 0;
  private _height = 0;

  private _isDragging = false;
  private _isSeekDrag = false;
  private _dragClip: { trackIdx: number; clipIdx: number; startX: number; origStart: number } | null = null;
  private _dragKf: { trackIdx: number; kfIdx: number } | null = null;
  private _hoveredKf: { trackIdx: number; kfIdx: number } | null = null;
  private _tracks: any[] = [];
  
  private _zoom = 1;
  private _scrollX = 0;
  
  private _waveformDataCache: Map<number, Float32Array> = new Map();

  constructor(canvas: HTMLCanvasElement, private audio: AudioEngine) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d')!;
    this._dpr = Math.min(window.devicePixelRatio, 2);

    this._bindEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    store.on('nodesChanged', () => {
      this._syncTracks();
      this.render();
    });
    
    store.on('selectionChanged', () => this.render());
    store.on('durationChanged', () => this.render());
    store.on('timeUpdate', () => this.render());
  }

  private _syncTracks() {
    this._tracks = [];
    const colors = ['#a78bfa', '#6ee7b7', '#f9a8d4', '#fbbf24', '#67e8f9', '#fb923c', '#a3e635', '#f87171'];
    
    for (const [id, node] of store.nodes) {
      this._tracks.push({
        id,
        name: node.name,
        color: colors[node.colorIndex % colors.length],
        muted: node.initialState.muted,
        clips: node.clips,
        keyframes: node.keyframes,
      });
      
      for (const clip of node.clips) {
        if (!this._waveformDataCache.has(clip.resourceId)) {
          this._generateWaveform(clip.resourceId);
        }
      }
    }
  }

  private _generateWaveform(resId: number) {
    const r = this.audio.getResources().find(x => x.id === resId);
    if (!r) return;
    
    const engine = this.audio as any;
    const resource = engine._resources.get(resId);
    if (!resource || !resource.buffer) return;

    const buffer = resource.buffer as AudioBuffer;
    const channelData = buffer.getChannelData(0);
    const step = Math.ceil(channelData.length / 1000);
    const peaks = new Float32Array(1000);
    
    for (let i = 0; i < 1000; i++) {
      let max = 0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx < channelData.length) {
          const val = Math.abs(channelData[idx]);
          if (val > max) max = val;
        }
      }
      peaks[i] = max;
    }
    this._waveformDataCache.set(resId, peaks);
  }

  resize() {
    const parent = this._canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;
    this._canvas.width = this._width * this._dpr;
    this._canvas.height = this._height * this._dpr;
    this._canvas.style.width = this._width + 'px';
    this._canvas.style.height = this._height + 'px';
    this.render();
  }

  render() {
    const ctx = this._ctx;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this._width, this._height);

    if (this._tracks.length === 0) {
      this._drawEmpty(ctx);
    } else {
      this._drawRuler(ctx);
      this._drawTracks(ctx);
      this._drawPlayhead(ctx);
    }
    ctx.restore();
  }

  private _drawEmpty(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '13px var(--font)';
    ctx.textAlign = 'center';
    ctx.fillText('Add nodes to see timeline tracks', this._width / 2, this._height / 2);
  }

  private _drawRuler(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(this._nameW, 0, this._width - this._nameW, this._rulerH);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this._rulerH - 0.5);
    ctx.lineTo(this._width, this._rulerH - 0.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '600 10px var(--font)';
    ctx.textAlign = 'left';
    ctx.fillText('TRACKS', 10, this._rulerH / 2 + 3);

    ctx.save();
    ctx.beginPath();
    ctx.rect(this._nameW, 0, this._width - this._nameW, this._height);
    ctx.clip();

    const tick = this._tickInterval();
    ctx.textAlign = 'center';
    ctx.font = '11px var(--font)';

    for (let t = 0; t <= store.projectDuration; t += tick) {
      const x = this._t2x(t);
      if (x < this._nameW - 5) continue;

      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(x, this._rulerH - 7);
      ctx.lineTo(x, this._rulerH);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText(this._fmtRuler(t), x, this._rulerH - 10);
    }
    
    ctx.restore();
  }

  private _drawTracks(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < this._tracks.length; i++) {
      const track = this._tracks[i];
      const y = this._rulerH + i * this._trackH;

      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(0, y, this._width, this._trackH);

      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(0, y + this._trackH - 0.5);
      ctx.lineTo(this._width, y + this._trackH - 0.5);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(this._nameW - 0.5, y);
      ctx.lineTo(this._nameW - 0.5, y + this._trackH);
      ctx.stroke();

      const trackColor = track.muted ? '#555555' : track.color;

      ctx.fillStyle = trackColor;
      ctx.beginPath();
      ctx.arc(14, y + this._trackH / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = track.muted ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)';
      ctx.font = '12px var(--font)';
      ctx.textAlign = 'left';
      ctx.fillText(track.name, 24, y + this._trackH / 2 + 4);

      ctx.save();
      ctx.beginPath();
      ctx.rect(this._nameW, y, this._width - this._nameW, this._trackH);
      ctx.clip();

      // Draw Clips
      for (const clip of track.clips) {
        const x = this._t2x(clip.start);
        const w = this._t2x(clip.start + clip.duration) - x;
        const clipY = y + 4;
        const clipH = this._trackH - 8;

        ctx.fillStyle = trackColor;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x, clipY, w, clipH);
        
        ctx.strokeStyle = trackColor;
        ctx.globalAlpha = 0.4;
        ctx.strokeRect(x, clipY, w, clipH);
        
        ctx.globalAlpha = 1.0;

        // Waveform
        const peaks = this._waveformDataCache.get(clip.resourceId);
        if (peaks) {
          ctx.fillStyle = trackColor;
          ctx.globalAlpha = 0.6;
          const totalResourceD = this.audio.getResources().find(r => r.id === clip.resourceId)?.duration || 1;
          const startPx = (clip.offset / totalResourceD) * 1000;
          const endPx = ((clip.offset + clip.duration) / totalResourceD) * 1000;
          
          const samples = endPx - startPx;
          const stepW = w / samples;
          
          for (let p = 0; p < samples; p++) {
            const idx = Math.floor(startPx + p);
            if (idx >= 0 && idx < 1000) {
              const h = peaks[idx] * clipH * 0.8;
              ctx.fillRect(x + p * stepW, clipY + (clipH - h) / 2, stepW + 0.5, h);
            }
          }
          ctx.globalAlpha = 1.0;
        }
      }

      // Draw Automation (Keyframes) on top of clips
      const cy = y + this._trackH - 8;
      const kfs = track.keyframes;

      if (kfs.length > 1) {
        ctx.save();
        ctx.strokeStyle = trackColor;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let j = 0; j < kfs.length; j++) {
          const x = this._t2x(kfs[j].time);
          j === 0 ? ctx.moveTo(x, cy) : ctx.lineTo(x, cy);
        }
        ctx.stroke();
        ctx.restore();
      }

      for (let j = 0; j < kfs.length; j++) {
        const x = this._t2x(kfs[j].time);
        ctx.fillStyle = trackColor;
        ctx.beginPath();
        ctx.arc(x, cy, this._kfR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private _drawPlayhead(ctx: CanvasRenderingContext2D) {
    const x = this._t2x(store.currentTime);
    if (x < this._nameW) return;

    const trackBottom = this._rulerH + this._tracks.length * this._trackH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this._nameW, 0, this._width - this._nameW, this._height);
    ctx.clip();

    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, this._rulerH);
    ctx.lineTo(x, Math.max(trackBottom, this._height));
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 5, this._rulerH);
    ctx.lineTo(x + 5, this._rulerH);
    ctx.lineTo(x, this._rulerH + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private _t2x(t: number) {
    const tW = this._width - this._nameW;
    return this._nameW + (t / store.projectDuration) * tW * this._zoom - this._scrollX;
  }
  
  private _x2t(x: number) {
    const tW = this._width - this._nameW;
    const offset = x - this._nameW + this._scrollX;
    return Math.max(0, Math.min(store.projectDuration, (offset / (tW * this._zoom)) * store.projectDuration));
  }
  
  private _tickInterval() {
    const d = store.projectDuration / this._zoom;
    if (d <= 5) return 0.5;
    if (d <= 10) return 1;
    if (d <= 30) return 5;
    if (d <= 90) return 10;
    if (d <= 300) return 30;
    return 60;
  }
  
  private _fmtRuler(t: number) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  private _hitKf(mx: number, my: number) {
    for (let i = 0; i < this._tracks.length; i++) {
      const cy = this._rulerH + i * this._trackH + this._trackH - 8;
      for (let j = 0; j < this._tracks[i].keyframes.length; j++) {
        const x = this._t2x(this._tracks[i].keyframes[j].time);
        const dx = mx - x, dy = my - cy;
        if (Math.sqrt(dx * dx + dy * dy) < this._kfR + 4) {
          return { trackIdx: i, kfIdx: j, nodeId: this._tracks[i].id };
        }
      }
    }
    return null;
  }

  private _hitClip(mx: number, my: number) {
    for (let i = 0; i < this._tracks.length; i++) {
      const y = this._rulerH + i * this._trackH + 4;
      const h = this._trackH - 8;
      if (my >= y && my <= y + h) {
        for (let j = 0; j < this._tracks[i].clips.length; j++) {
          const clip = this._tracks[i].clips[j];
          const x = this._t2x(clip.start);
          const w = this._t2x(clip.start + clip.duration) - x;
          if (mx >= x && mx <= x + w) {
            return { trackIdx: i, clipIdx: j, nodeId: this._tracks[i].id };
          }
        }
      }
    }
    return null;
  }

  private _hitTrack(my: number) {
    const idx = Math.floor((my - this._rulerH) / this._trackH);
    return (idx >= 0 && idx < this._tracks.length) ? idx : -1;
  }

  private _bindEvents() {
    const c = this._canvas;
    const getPos = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { mx: e.clientX - r.left, my: e.clientY - r.top };
    };

    c.addEventListener('mousedown', (e) => {
      const { mx, my } = getPos(e);

      if (e.button === 2) return; // Right click handled by context menu

      if (my < this._rulerH && mx >= this._nameW) {
        this._isSeekDrag = true;
        store.setTime(this._x2t(mx));
        return;
      }

      const hitKf = this._hitKf(mx, my);
      if (hitKf) {
        store.selectNode(hitKf.nodeId, hitKf.kfIdx);
        this._isDragging = true;
        this._dragKf = hitKf;
        return;
      }

      const hitClip = this._hitClip(mx, my);
      if (hitClip) {
        store.selectNode(hitClip.nodeId, -1);
        this._isDragging = true;
        this._dragClip = {
          trackIdx: hitClip.trackIdx,
          clipIdx: hitClip.clipIdx,
          startX: mx,
          origStart: this._tracks[hitClip.trackIdx].clips[hitClip.clipIdx].start
        };
        return;
      }

      const ti = this._hitTrack(my);
      if (ti >= 0) {
        store.selectNode(this._tracks[ti].id, -1);
      } else {
        store.selectNode(null, -1);
      }
    });

    c.addEventListener('mousemove', (e) => {
      const { mx, my } = getPos(e);

      if (this._isSeekDrag) {
        store.setTime(this._x2t(mx));
        return;
      }

      if (this._isDragging && this._dragKf) {
        const t = Math.round(this._x2t(mx) * 10) / 10;
        const track = this._tracks[this._dragKf.trackIdx];
        if (track) {
          const node = store.nodes.get(track.id);
          if (node) {
            node.keyframes[this._dragKf.kfIdx].time = t;
            store.emit('nodesChanged');
          }
        }
        return;
      }

      if (this._isDragging && this._dragClip) {
        const dt = this._x2t(mx) - this._x2t(this._dragClip.startX);
        const track = this._tracks[this._dragClip.trackIdx];
        if (track) {
          const node = store.nodes.get(track.id);
          if (node) {
            const clip = node.clips[this._dragClip.clipIdx];
            let newStart = Math.max(0, this._dragClip.origStart + dt);
            
            // Snapping logic
            const snapThreshold = 0.2; // seconds
            for (const otherClip of track.clips) {
              if (otherClip === clip) continue;
              
              // Snap moving start to other end
              if (Math.abs(newStart - (otherClip.start + otherClip.duration)) < snapThreshold) {
                newStart = otherClip.start + otherClip.duration;
                break;
              }
              // Snap moving end to other start
              if (Math.abs((newStart + clip.duration) - otherClip.start) < snapThreshold) {
                newStart = otherClip.start - clip.duration;
                break;
              }
              // Snap moving start to other start (alignment)
              if (Math.abs(newStart - otherClip.start) < snapThreshold) {
                newStart = otherClip.start;
                break;
              }
            }
            
            clip.start = newStart;
            store.emit('nodesChanged');
          }
        }
        return;
      }

      this._hoveredKf = this._hitKf(mx, my);
      const inRuler = my < this._rulerH && mx >= this._nameW;
      const hitClip = this._hitClip(mx, my);
      c.style.cursor = this._hoveredKf || hitClip ? 'grab' : (inRuler ? 'col-resize' : 'default');
      
      if (this._hoveredKf || inRuler || hitClip) {
          this.render();
      }
    });

    const onUp = () => {
      if (this._isDragging && this._dragKf) {
        const track = this._tracks[this._dragKf.trackIdx];
        if (track) {
          const node = store.nodes.get(track.id);
          if (node) {
              node.keyframes.sort((a, b) => a.time - b.time);
              store.emit('nodesChanged');
              
              // const newIdx = node.keyframes.findIndex(k => Math.abs(k.time - Math.round(this._x2t(getPos(event as MouseEvent).mx) * 10) / 10) < 0.05);
              // if (newIdx >= 0) store.selectNode(track.id, newIdx);
          }
        }
      }
      this._isDragging = false;
      this._isSeekDrag = false;
      this._dragKf = null;
      this._dragClip = null;
    };

    c.addEventListener('mouseup', onUp);
    c.addEventListener('mouseleave', () => {
      this._hoveredKf = null;
      if (this._isSeekDrag) onUp();
      this.render();
    });

    c.addEventListener('dblclick', (e) => {
      const { mx, my } = getPos(e);
      if (my < this._rulerH) return;
      if (this._hitKf(mx, my)) return;

      const ti = this._hitTrack(my);
      if (ti < 0) return;

      const t = Math.round(this._x2t(mx) * 10) / 10;
      const trackId = this._tracks[ti].id;
      
      const node = store.nodes.get(trackId);
      if (!node) return;
      
      node.keyframes.push({
          time: Math.max(0.1, t),
          angle: 0,
          distance: 3,
          height: 0,
          volume: 1,
          muted: false
      });
      node.keyframes.sort((a, b) => a.time - b.time);
      store.emit('nodesChanged');
    });

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { mx, my } = getPos(e);
      const hitClip = this._hitClip(mx, my);
      if (hitClip) {
        const node = store.nodes.get(hitClip.nodeId);
        if (node) {
          const menu = document.createElement('div');
          menu.style.position = 'fixed';
          menu.style.left = `${e.clientX}px`;
          menu.style.top = `${e.clientY}px`;
          menu.style.background = 'var(--color-bg)';
          menu.style.border = '1px solid var(--color-glass-border)';
          menu.style.padding = '4px 0';
          menu.style.borderRadius = 'var(--r-sm)';
          menu.style.zIndex = '9999';
          menu.style.boxShadow = 'var(--shadow-panel)';

          const splitBtn = document.createElement('button');
          splitBtn.textContent = 'Split at cursor (Ctrl+K)';
          splitBtn.style.display = 'block';
          splitBtn.style.width = '100%';
          splitBtn.style.padding = '8px 16px';
          splitBtn.style.background = 'transparent';
          splitBtn.style.border = 'none';
          splitBtn.style.color = 'var(--color-text)';
          splitBtn.style.textAlign = 'left';
          splitBtn.style.cursor = 'pointer';
          splitBtn.style.fontFamily = 'var(--font)';
          splitBtn.style.fontSize = 'var(--text-sm)';
          
          splitBtn.addEventListener('mouseenter', () => splitBtn.style.background = 'var(--color-surface-hover)');
          splitBtn.addEventListener('mouseleave', () => splitBtn.style.background = 'transparent');

          const deleteBtn = document.createElement('button');
          deleteBtn.textContent = 'Delete clip';
          deleteBtn.style.display = 'block';
          deleteBtn.style.width = '100%';
          deleteBtn.style.padding = '8px 16px';
          deleteBtn.style.background = 'transparent';
          deleteBtn.style.border = 'none';
          deleteBtn.style.color = 'var(--color-danger)';
          deleteBtn.style.textAlign = 'left';
          deleteBtn.style.cursor = 'pointer';
          deleteBtn.style.fontFamily = 'var(--font)';
          deleteBtn.style.fontSize = 'var(--text-sm)';
          
          deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = 'var(--color-surface-hover)');
          deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = 'transparent');

          splitBtn.addEventListener('click', () => {
            document.body.removeChild(menu);
            const clip = node.clips[hitClip.clipIdx];
            const splitTime = this._x2t(mx);
            
            if (splitTime > clip.start && splitTime < clip.start + clip.duration) {
              const diff = splitTime - clip.start;
              const newClip = {
                id: Date.now(),
                resourceId: clip.resourceId,
                start: splitTime,
                duration: clip.duration - diff,
                offset: clip.offset + diff
              };
              clip.duration = diff;
              node.clips.push(newClip);
              store.emit('nodesChanged');
            }
          });

          deleteBtn.addEventListener('click', () => {
            document.body.removeChild(menu);
            node.clips.splice(hitClip.clipIdx, 1);
            store.emit('nodesChanged');
          });

          menu.appendChild(splitBtn);
          menu.appendChild(deleteBtn);
          document.body.appendChild(menu);

          const closeMenu = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
              document.body.removeChild(menu);
              document.removeEventListener('click', closeMenu);
            }
          };
          setTimeout(() => document.addEventListener('click', closeMenu), 0);
        }
        return;
      }
      const hitKf = this._hitKf(mx, my);
      if (hitKf) {
        const node = store.nodes.get(hitKf.nodeId);
        if (node) {
          node.keyframes.splice(hitKf.kfIdx, 1);
          if (store.selectedNodeId === hitKf.nodeId && store.selectedKfIndex === hitKf.kfIdx) {
              store.selectNode(null, -1);
          }
          store.emit('nodesChanged');
        }
      }
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const r = c.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const t = this._x2t(mx); // time at cursor before zoom
        
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        this._zoom = Math.max(1, Math.min(this._zoom * zoomDelta, 50));
        
        const tW = this._width - this._nameW;
        this._scrollX = (t / store.projectDuration) * tW * this._zoom - (mx - this._nameW);
        this._scrollX = Math.max(0, this._scrollX);
      } else {
        // Pan
        this._scrollX += e.deltaX || e.deltaY;
        this._scrollX = Math.max(0, this._scrollX);
        const tW = this._width - this._nameW;
        const maxScroll = tW * this._zoom - tW;
        if (maxScroll > 0) {
           this._scrollX = Math.min(this._scrollX, maxScroll);
        } else {
           this._scrollX = 0;
        }
      }
      this.render();
    }, { passive: false });
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
  }
}

/* ═══════════════════════════════════════════════════════════
   H8D — Timeline Editor (canvas-based)
   v4: white playhead, initial-state diamond, Outfit font
   ═══════════════════════════════════════════════════════════ */

export class Timeline {
  constructor(canvas, callbacks = {}) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._dpr = Math.min(window.devicePixelRatio, 2);

    this._duration = 60;
    this._playheadTime = 0;
    this._tracks = []; // { id, name, color, hasInitial, keyframes }
    this._selectedKf = null;
    this._hoveredKf = null;

    this._rulerH = 28;
    this._trackH = 34;
    this._nameW = 72;
    this._kfR = 5;
    this._width = 0;
    this._height = 0;

    this._isDragging = false;
    this._isSeekDrag = false;
    this._dragKf = null;

    this._cb = {
      onSelect: callbacks.onSelect || (() => {}),
      onAdd:    callbacks.onAdd    || (() => {}),
      onMove:   callbacks.onMove   || (() => {}),
      onDelete: callbacks.onDelete || (() => {}),
      onSeek:   callbacks.onSeek   || (() => {}),
    };

    this._bindEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ═══════ Public API ═══════ */

  setTracks(tracks) { this._tracks = tracks; }
  setDuration(d) { this._duration = Math.max(0.5, d); }
  setPlayhead(t) { this._playheadTime = t; }

  selectKeyframe(trackIdx, kfIdx) {
    this._selectedKf = (trackIdx !== null && kfIdx >= 0) ? { trackIdx, kfIdx } : null;
  }
  deselectKeyframe() { this._selectedKf = null; }
  get selectedKeyframe() { return this._selectedKf; }

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
  }

  /* ═══════ Render ═══════ */

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

  _drawEmpty(ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add nodes to see timeline tracks', this._width / 2, this._height / 2);
  }

  /* ── Ruler ── */
  _drawRuler(ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(this._nameW, 0, this._width - this._nameW, this._rulerH);

    // Bottom border
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this._rulerH - 0.5);
    ctx.lineTo(this._width, this._rulerH - 0.5);
    ctx.stroke();

    // Header
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '600 10px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('TRACKS', 10, this._rulerH / 2 + 3);

    // Ticks
    const tick = this._tickInterval();
    ctx.textAlign = 'center';
    ctx.font = '11px Outfit, sans-serif';

    for (let t = 0; t <= this._duration; t += tick) {
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

    // Sub-ticks
    const subTick = tick / 4;
    if (subTick >= 0.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      for (let t = 0; t <= this._duration; t += subTick) {
        const x = this._t2x(t);
        if (x < this._nameW) continue;
        ctx.beginPath();
        ctx.moveTo(x, this._rulerH - 3);
        ctx.lineTo(x, this._rulerH);
        ctx.stroke();
      }
    }
  }

  /* ── Tracks ── */
  _drawTracks(ctx) {
    for (let i = 0; i < this._tracks.length; i++) {
      const track = this._tracks[i];
      const y = this._rulerH + i * this._trackH;

      // Lane bg
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(0, y, this._width, this._trackH);

      // Bottom border
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(0, y + this._trackH - 0.5);
      ctx.lineTo(this._width, y + this._trackH - 0.5);
      ctx.stroke();

      // Name column separator
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(this._nameW - 0.5, y);
      ctx.lineTo(this._nameW - 0.5, y + this._trackH);
      ctx.stroke();

      // Color dot
      ctx.fillStyle = track.color;
      ctx.beginPath();
      ctx.arc(14, y + this._trackH / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      // Name
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '12px Outfit, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(track.name, 24, y + this._trackH / 2 + 4);

      const cy = y + this._trackH / 2;
      const kfs = track.keyframes;

      // Initial-state diamond at t=0
      if (track.hasInitial) {
        const ix = this._t2x(0);
        ctx.save();
        ctx.translate(ix, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.strokeStyle = track.color;
        ctx.lineWidth = 1;
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.strokeRect(-3.5, -3.5, 7, 7);
        ctx.restore();
      }

      // Interpolation line between keyframes
      if (kfs.length > 1) {
        ctx.save();
        ctx.strokeStyle = track.color;
        ctx.globalAlpha = 0.12;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let j = 0; j < kfs.length; j++) {
          const x = this._t2x(kfs[j].time);
          j === 0 ? ctx.moveTo(x, cy) : ctx.lineTo(x, cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Line from initial state to first keyframe
      if (track.hasInitial && kfs.length > 0) {
        ctx.save();
        ctx.strokeStyle = track.color;
        ctx.globalAlpha = 0.08;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(this._t2x(0), cy);
        ctx.lineTo(this._t2x(kfs[0].time), cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Keyframe dots
      for (let j = 0; j < kfs.length; j++) {
        this._drawKfDot(ctx, track, i, j, cy);
      }
    }
  }

  _drawKfDot(ctx, track, trackIdx, kfIdx, cy) {
    const kf = track.keyframes[kfIdx];
    const x = this._t2x(kf.time);
    const sel = this._selectedKf &&
      this._selectedKf.trackIdx === trackIdx && this._selectedKf.kfIdx === kfIdx;
    const hov = this._hoveredKf &&
      this._hoveredKf.trackIdx === trackIdx && this._hoveredKf.kfIdx === kfIdx;
    const r = hov ? this._kfR + 2 : this._kfR;

    // Selection ring
    if (sel) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, cy, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(x, cy + 1, r, 0, Math.PI * 2);
    ctx.fill();

    // Main circle
    if (kf.muted) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    } else {
      ctx.fillStyle = track.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    }
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Highlight
    ctx.fillStyle = kf.muted ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x, cy - 1, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Mute X
    if (kf.muted) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 3, cy - 3); ctx.lineTo(x + 3, cy + 3);
      ctx.moveTo(x + 3, cy - 3); ctx.lineTo(x - 3, cy + 3);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Volume indicator
    if (!kf.muted && kf.volume !== undefined && kf.volume < 1) {
      const barH = 6, barW = 2, volH = barH * kf.volume;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x - barW / 2, cy + r + 2, barW, barH);
      ctx.fillStyle = track.color;
      ctx.fillRect(x - barW / 2, cy + r + 2 + (barH - volH), barW, volH);
    }
  }

  /* ── Playhead ── */
  _drawPlayhead(ctx) {
    const x = this._t2x(this._playheadTime);
    if (x < this._nameW) return;

    const trackBottom = this._rulerH + this._tracks.length * this._trackH;

    // White line
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, this._rulerH);
    ctx.lineTo(x, Math.max(trackBottom, this._height));
    ctx.stroke();
    ctx.lineWidth = 1;

    // Top triangle
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.moveTo(x - 5, this._rulerH);
    ctx.lineTo(x + 5, this._rulerH);
    ctx.lineTo(x, this._rulerH + 6);
    ctx.closePath();
    ctx.fill();
  }

  /* ═══════ Coordinate Helpers ═══════ */

  _t2x(t) {
    const tW = this._width - this._nameW;
    return this._nameW + (t / this._duration) * tW;
  }
  _x2t(x) {
    const tW = this._width - this._nameW;
    return Math.max(0, Math.min(this._duration, ((x - this._nameW) / tW) * this._duration));
  }
  _tickInterval() {
    if (this._duration <= 10) return 1;
    if (this._duration <= 30) return 5;
    if (this._duration <= 90) return 10;
    if (this._duration <= 300) return 30;
    return 60;
  }
  _fmtRuler(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  }

  /* ═══════ Hit Detection ═══════ */

  _hitKf(mx, my) {
    for (let i = 0; i < this._tracks.length; i++) {
      const tY = this._rulerH + i * this._trackH;
      const cy = tY + this._trackH / 2;
      for (let j = 0; j < this._tracks[i].keyframes.length; j++) {
        const x = this._t2x(this._tracks[i].keyframes[j].time);
        const dx = mx - x, dy = my - cy;
        if (Math.sqrt(dx * dx + dy * dy) < this._kfR + 5) {
          return { trackIdx: i, kfIdx: j };
        }
      }
    }
    return null;
  }

  _hitTrack(my) {
    const idx = Math.floor((my - this._rulerH) / this._trackH);
    return (idx >= 0 && idx < this._tracks.length) ? idx : -1;
  }

  /* ═══════ Events ═══════ */

  _bindEvents() {
    const c = this._canvas;
    const getPos = (e) => {
      const r = c.getBoundingClientRect();
      return { mx: e.clientX - r.left, my: e.clientY - r.top };
    };

    c.addEventListener('mousedown', (e) => {
      const { mx, my } = getPos(e);

      // Ruler click → seek
      if (my < this._rulerH && mx >= this._nameW) {
        this._isSeekDrag = true;
        this._cb.onSeek(this._x2t(mx));
        return;
      }

      // Keyframe hit
      const hit = this._hitKf(mx, my);
      if (hit) {
        this._selectedKf = hit;
        this._isDragging = true;
        this._dragKf = hit;
        this._cb.onSelect(this._tracks[hit.trackIdx].id, hit.kfIdx);
        return; // Prevent fallthrough
      }

      // Click on empty track area
      const ti = this._hitTrack(my);
      if (ti >= 0) {
        this._selectedKf = null;
        this._cb.onSelect(this._tracks[ti].id, -1);
      } else {
        this._selectedKf = null;
        this._cb.onSelect(null, -1);
      }
    });

    c.addEventListener('mousemove', (e) => {
      const { mx, my } = getPos(e);

      if (this._isSeekDrag) { this._cb.onSeek(this._x2t(mx)); return; }

      if (this._isDragging && this._dragKf) {
        const t = Math.round(this._x2t(mx) * 10) / 10;
        const track = this._tracks[this._dragKf.trackIdx];
        if (track) {
          track.keyframes[this._dragKf.kfIdx].time = t;
          this._cb.onMove(track.id, this._dragKf.kfIdx, t);
        }
        return;
      }

      this._hoveredKf = this._hitKf(mx, my);
      const inRuler = my < this._rulerH && mx >= this._nameW;
      c.style.cursor = this._hoveredKf ? 'grab' : (inRuler ? 'col-resize' : 'default');
    });

    const onUp = () => {
      if (this._isDragging && this._dragKf) {
        const track = this._tracks[this._dragKf.trackIdx];
        if (track) {
          track.keyframes.sort((a, b) => a.time - b.time);
        }
      }
      this._isDragging = false;
      this._isSeekDrag = false;
      this._dragKf = null;
    };

    c.addEventListener('mouseup', onUp);
    c.addEventListener('mouseleave', () => {
      this._hoveredKf = null;
      if (this._isSeekDrag) onUp();
    });

    // Double-click → add keyframe
    c.addEventListener('dblclick', (e) => {
      const { mx, my } = getPos(e);
      if (my < this._rulerH) return;
      if (this._hitKf(mx, my)) return;

      const ti = this._hitTrack(my);
      if (ti < 0) return;

      const t = Math.round(this._x2t(mx) * 10) / 10;
      this._cb.onAdd(this._tracks[ti].id, t);
    });

    // Right-click → delete keyframe
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { mx, my } = getPos(e);
      const hit = this._hitKf(mx, my);
      if (!hit) return;

      this._cb.onDelete(this._tracks[hit.trackIdx].id, hit.kfIdx);
      if (this._selectedKf &&
        this._selectedKf.trackIdx === hit.trackIdx &&
        this._selectedKf.kfIdx === hit.kfIdx) {
        this._selectedKf = null;
        this._cb.onSelect(null, -1);
      }
    });
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
  }
}

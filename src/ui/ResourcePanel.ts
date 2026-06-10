import { store } from '../store/StateStore';
import { AudioEngine } from '../audio/AudioEngine';
import { formatTime } from '../utils';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export class ResourcePanel {
  private _list = $('resource-list');
  private _empty = $('resource-empty');
  private _nodeList = $('node-list');
  private _nodeEmpty = $('node-list-empty');
  private _btnAddNode = $('btn-add-node') as HTMLButtonElement;
  
  private _previewSource: { stop: () => void } | null = null;
  private _previewResourceId: number | null = null;

  constructor(private audio: AudioEngine) {
    this._bindEvents();
    
    store.on('nodesChanged', () => {
      this._renderNodes();
    });

    store.on('selectionChanged', () => {
      this._renderNodes();
    });
  }

  private _bindEvents() {
    $('btn-upload').addEventListener('click', () => $('file-input').click());

    $('file-input').addEventListener('change', (e: any) => {
      if (e.target.files.length) this._handleFiles(e.target.files);
      e.target.value = '';
    });

    document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
    document.addEventListener('drop', (e) => {
      e.preventDefault(); document.body.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files) {
        const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('audio/'));
        if (files.length) this._handleFiles(files);
      }
    });

    this._btnAddNode.addEventListener('click', () => {
      const state = {
        name: `Node ${store.nextNodeId}`,
        resourceId: null,
        clips: [],
        colorIndex: store.nodeColorIndex,
        initialState: {
          angle: (store.nextNodeId * 137.508) % 360,
          distance: 3,
          height: 0,
          volume: 1,
          muted: false
        },
        keyframes: []
      };
      const id = store.addNode(state);
      store.selectNode(id, -1);
    });
  }

  private async _handleFiles(files: FileList | File[]) {
    for (const file of files) {
      try {
        const info = await this.audio.addResource(file as File);
        this._addResourceToUI(info);
        
        this._btnAddNode.disabled = false;
        this._btnAddNode.title = 'Add a new spatial node';
      } catch (err) {
        console.error('Load failed:', err);
      }
    }
  }

  private _addResourceToUI(info: any) {
    this._empty.hidden = true;
    const div = document.createElement('div');
    div.className = 'resource-item';
    div.dataset.resourceId = info.id.toString();
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

    div.querySelector('[data-action="preview"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePreview(info.id, e.currentTarget as HTMLElement);
    });

    div.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.removeResource(info.id);
      div.remove();
      
      if (this._list.querySelectorAll('.resource-item').length === 0) {
        this._empty.hidden = false;
      }
      store.emit('nodesChanged');
    });

    this._list.appendChild(div);
  }



  private _togglePreview(id: number, btn: HTMLElement) {
    if (this._previewSource && this._previewResourceId === id) {
      this._stopPreview();
      return;
    }
    this._stopPreview();
    const source = this.audio.previewTrack(id);
    if (source) {
      this._previewSource = source;
      this._previewResourceId = id;
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';
    }
  }

  private _stopPreview() {
    if (this._previewSource) {
      this._previewSource.stop();
      this._previewSource = null;
    }
    this._previewResourceId = null;
    document.querySelectorAll('.resource-item__preview').forEach(btn => {
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>';
    });
  }



  private _renderNodes() {
    const colors = ['#a78bfa', '#6ee7b7', '#f9a8d4', '#fbbf24', '#67e8f9', '#fb923c', '#a3e635', '#f87171'];
    
    Array.from(this._nodeList.children).forEach(c => {
      if (c.id !== 'node-list-empty') c.remove();
    });

    if (store.nodes.size === 0) {
      this._nodeEmpty.hidden = false;
      return;
    }

    this._nodeEmpty.hidden = true;
    for (const [id, node] of store.nodes) {
      const color = colors[node.colorIndex % colors.length];
      const div = document.createElement('div');
      div.className = `node-item ${id === store.selectedNodeId ? 'active' : ''}`;
      div.dataset.nodeId = id.toString();
      
      const r = this.audio.getResources().find(x => x.id === node.resourceId);
      const trackName = r ? r.name.replace(/\.[^.]+$/, '') : '';

      div.innerHTML = `
        <span class="node-color-dot" style="color:${color}; background:${color}"></span>
        <span class="node-item__name">${node.name}</span>
        <span class="node-item__track">${trackName}</span>
        <button class="node-item__delete" aria-label="Delete node">×</button>
      `;

      div.addEventListener('click', (e: any) => {
        if (!e.target.classList.contains('node-item__delete')) store.selectNode(id, -1);
      });

      div.addEventListener('contextmenu', (e: any) => {
        e.preventDefault();
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

        const renameBtn = document.createElement('button');
        renameBtn.textContent = 'Rename';
        renameBtn.style.display = 'block';
        renameBtn.style.width = '100%';
        renameBtn.style.padding = '8px 16px';
        renameBtn.style.background = 'transparent';
        renameBtn.style.border = 'none';
        renameBtn.style.color = 'var(--color-text)';
        renameBtn.style.textAlign = 'left';
        renameBtn.style.cursor = 'pointer';

        renameBtn.addEventListener('mouseenter', () => renameBtn.style.background = 'var(--color-surface-hover)');
        renameBtn.addEventListener('mouseleave', () => renameBtn.style.background = 'transparent');

        renameBtn.addEventListener('click', () => {
          document.body.removeChild(menu);
          const nameSpan = div.querySelector('.node-item__name') as HTMLElement;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = node.name;
          input.style.width = '100%';
          input.style.background = 'var(--color-surface)';
          input.style.color = 'var(--color-text)';
          input.style.border = '1px solid var(--color-glass-border)';
          input.style.borderRadius = 'var(--r-sm)';
          input.style.padding = '2px 4px';
          input.style.outline = 'none';
          input.style.fontFamily = 'var(--font)';
          input.style.fontSize = 'var(--text-sm)';

          nameSpan.replaceWith(input);
          input.focus();
          input.select();

          const save = () => {
            if (input.parentElement) {
              node.name = input.value.trim() || `Node ${id}`;
              input.replaceWith(nameSpan);
              store.emit('nodesChanged');
            }
          };

          input.addEventListener('blur', save);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              input.replaceWith(nameSpan);
            }
          });
        });

        menu.appendChild(renameBtn);
        document.body.appendChild(menu);

        const closeMenu = (e: MouseEvent) => {
          if (!menu.contains(e.target as Node)) {
            document.body.removeChild(menu);
            document.removeEventListener('click', closeMenu);
          }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      });

      div.querySelector('.node-item__delete')!.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeNode(id);
      });

      this._nodeList.appendChild(div);
    }
  }
}

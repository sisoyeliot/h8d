export type Keyframe = {
  time: number;
  angle: number;
  distance: number;
  height: number;
  volume: number;
  muted: boolean;
};

export type AudioClip = {
  id: number;
  resourceId: number;
  start: number;
  duration: number;
  offset: number;
};

export type NodeState = {
  name: string;
  resourceId: number | null; // Keep for fallback/legacy logic temporarily
  clips: AudioClip[];
  colorIndex: number;
  initialState: Omit<Keyframe, 'time'>;
  keyframes: Keyframe[];
};

type StateEvents = {
  nodesChanged: () => void;
  selectionChanged: (nodeId: number | null, kfIndex: number) => void;
  playbackChanged: (isPlaying: boolean) => void;
  durationChanged: (duration: number) => void;
  timeUpdate: (time: number) => void;
  resourcesChanged: () => void;
};

export class StateStore {
  public nodes: Map<number, NodeState> = new Map();
  public selectedNodeId: number | null = null;
  public selectedKfIndex: number = -1;
  public projectDuration: number = 60;
  public nextNodeId: number = 1;
  public nodeColorIndex: number = 0;
  public isPlaying: boolean = false;
  public currentTime: number = 0;

  private listeners: { [K in keyof StateEvents]?: Array<StateEvents[K]> } = {};

  on<K extends keyof StateEvents>(event: K, listener: StateEvents[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);
  }

  emit<K extends keyof StateEvents>(event: K, ...args: Parameters<StateEvents[K]>): void {
    if (event === 'nodesChanged') {
      this._updateDuration();
    }
    if (this.listeners[event]) {
      this.listeners[event]!.forEach((listener: any) => listener(...args));
    }
  }

  private _updateDuration(): void {
    let max = 10;
    for (const [, node] of this.nodes) {
      for (const clip of node.clips) {
        const end = clip.start + clip.duration;
        if (end > max) max = end;
      }
      for (const kf of node.keyframes) {
        if (kf.time > max) max = kf.time;
      }
    }
    const newDur = Math.ceil(max + 2); // 2s padding
    if (this.projectDuration !== newDur) {
      this.projectDuration = newDur;
      this.emit('durationChanged', this.projectDuration);
    }
  }

  addNode(state: NodeState): number {
    const id = this.nextNodeId++;
    this.nodeColorIndex++;
    this.nodes.set(id, state);
    this.emit('nodesChanged');
    return id;
  }

  removeNode(id: number): void {
    this.nodes.delete(id);
    if (this.selectedNodeId === id) {
      this.selectNode(null, -1);
    }
    this.emit('nodesChanged');
  }

  selectNode(id: number | null, kfIndex: number = -1): void {
    this.selectedNodeId = id;
    this.selectedKfIndex = kfIndex;
    this.emit('selectionChanged', id, kfIndex);
  }

  setDuration(): void {
    // Disabled manual duration updates
  }

  setPlaying(playing: boolean): void {
    this.isPlaying = playing;
    this.emit('playbackChanged', playing);
  }

  setTime(time: number): void {
    this.currentTime = time;
    this.emit('timeUpdate', time);
  }
}

export const store = new StateStore();

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const NODE_COLORS = [
  '#a78bfa', '#6ee7b7', '#f9a8d4', '#fbbf24',
  '#67e8f9', '#fb923c', '#a3e635', '#f87171',
];

type NodeVisuals = {
  group: THREE.Group;
  orb: THREE.Mesh;
  glow: THREE.Mesh;
  glow2: THREE.Mesh;
  light: THREE.PointLight;
  ring: THREE.Mesh;
  color: THREE.Color;
  colorHex: string;
};

export class Visualizer {

  private _renderer: THREE.WebGLRenderer;
  private _scene: THREE.Scene;
  private _camera: THREE.PerspectiveCamera;
  private _controls: OrbitControls;
  private _nodes: Map<number, NodeVisuals> = new Map();
  private _selectedNodeId: number | null = null;
  private _particles!: THREE.Points;
  private _headGroup!: THREE.Group;
  private _isSnappingBack: boolean = false;
  private _initialCameraPos = new THREE.Vector3(0, 0, 12);
  private _onResize: () => void;

  constructor(canvas: HTMLCanvasElement) {

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.1;
    this._renderer.setSize(window.innerWidth, window.innerHeight);

    this._scene = new THREE.Scene();
    this._scene.fog = new THREE.FogExp2(0x0a0a14, 0.025);

    const grid = new THREE.GridHelper(100, 100, 0x3b3b55, 0x1a1a2e);
    grid.position.y = -5;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.15;
    this._scene.add(grid);

    this._camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.1, 100
    );
    this._camera.position.set(0, 0, 12);
    this._camera.lookAt(0, 0, 0);

    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableRotate = true;
    this._controls.enablePan = false;
    this._controls.enableZoom = true;
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.06;
    this._controls.minDistance = 5;
    this._controls.maxDistance = 30;
    this._controls.autoRotate = false;
    this._controls.target.set(0, 0, 0);
    this._controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };

    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) {
        this._isSnappingBack = true;
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this._isSnappingBack = false;
      }
    });

    this._createLights();
    this._createHead();
    this._createParticles();
    this._createOrientationLabels();

    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  private _createLights() {
    this._scene.add(new THREE.AmbientLight(0x443366, 1.2));

    const dir = new THREE.DirectionalLight(0xff66bb, 1.5);
    dir.position.set(5, 10, 8);
    this._scene.add(dir);

    const rim = new THREE.DirectionalLight(0x44ccff, 2.0);
    rim.position.set(-5, -2, -5);
    this._scene.add(rim);
    
    const fill = new THREE.DirectionalLight(0xffaa44, 0.8);
    fill.position.set(0, -5, 5);
    this._scene.add(fill);
  }

  private _createHead() {
    this._headGroup = new THREE.Group();

    const headGeo = new THREE.IcosahedronGeometry(1.1, 2);
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0.1, roughness: 0.8,
      transparent: true, opacity: 0.08, side: THREE.DoubleSide,
      depthWrite: false,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    this._headGroup.add(head);

    const wireGeo = new THREE.IcosahedronGeometry(1.15, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, wireframe: true, transparent: true, opacity: 0.05,
    });
    const headWire = new THREE.Mesh(wireGeo, wireMat);
    this._headGroup.add(headWire);

    const coreGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.1,
    });
    const headCore = new THREE.Mesh(coreGeo, coreMat);
    this._headGroup.add(headCore);

    this._scene.add(this._headGroup);
  }

  private _createParticles() {
    const count = 400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 10 + Math.random() * 28;
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8888aa, size: 0.08, transparent: true, opacity: 0.3,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._particles = new THREE.Points(geo, mat);
    this._scene.add(this._particles);
  }

  private _createOrientationLabels() {
    const arrowDefs = [
      { color: 0x67e8f9, pos: [-2.8, 0, 0], rot: [0, 0, Math.PI / 2] },
      { color: 0xfb923c, pos: [2.8, 0, 0],  rot: [0, 0, -Math.PI / 2] },
      { color: 0x6ee7b7, pos: [0, 2.8, 0],  rot: [0, 0, 0] },
      { color: 0xa78bfa, pos: [0, -2.8, 0], rot: [Math.PI, 0, 0] },
    ];

    for (const def of arrowDefs) {
      const group = new THREE.Group();
      const c = new THREE.Color(def.color);

      const coneGeo = new THREE.ConeGeometry(0.1, 0.3, 8);
      const coneMat = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.45,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.set(def.rot[0], def.rot[1], def.rot[2]);
      cone.position.set(def.pos[0], def.pos[1], def.pos[2]);
      group.add(cone);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(def.pos[0] * 0.45, def.pos[1] * 0.45, def.pos[2] * 0.45),
        new THREE.Vector3(def.pos[0] * 0.9, def.pos[1] * 0.9, def.pos[2] * 0.9),
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: c, transparent: true, opacity: 0.12,
      });
      group.add(new THREE.Line(lineGeo, lineMat));

      const glowGeo = new THREE.SphereGeometry(0.15, 12, 12);
      const glowMat = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(def.pos[0], def.pos[1], def.pos[2]);
      group.add(glow);

      this._scene.add(group);
    }
  }

  addNode(id: number, colorHex: string) {
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();

    const orbGeo = new THREE.SphereGeometry(0.15, 32, 32);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    group.add(orb);

    const glowGeo = new THREE.SphereGeometry(0.4, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.15,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    const glow2Geo = new THREE.SphereGeometry(0.7, 32, 32);
    const glow2Mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow2 = new THREE.Mesh(glow2Geo, glow2Mat);
    group.add(glow2);

    const light = new THREE.PointLight(color, 1.5, 12, 2);
    group.add(light);

    const ringGeo = new THREE.TorusGeometry(0.35, 0.015, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    this._scene.add(group);
    this._nodes.set(id, { group, orb, glow, glow2, light, ring, color, colorHex });
  }

  removeNode(id: number) {
    const node = this._nodes.get(id);
    if (!node) return;
    this._scene.remove(node.group);
    node.group.traverse((child: any) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this._nodes.delete(id);
    if (this._selectedNodeId === id) this._selectedNodeId = null;
  }

  updateNodePosition(id: number, x: number, y: number, z: number) {
    const node = this._nodes.get(id);
    if (node) node.group.position.set(x, y, z);
  }

  setSelectedNode(id: number | null) {
    if (this._selectedNodeId !== null) {
      const prev = this._nodes.get(this._selectedNodeId);
      if (prev) (prev.ring.material as THREE.Material).opacity = 0;
    }
    this._selectedNodeId = id;
    if (id !== null) {
      const node = this._nodes.get(id);
      if (node) (node.ring.material as THREE.Material).opacity = 0.5;
    }
  }

  render(deltaTime: number, bassEnergy = 0, _midEnergy = 0, activeNodeIds = new Set<number>(), nodeEnergies = new Map<number, { bass: number; mid: number }>()) {
    if (this._headGroup) {
      this._headGroup.rotation.y += deltaTime * 0.1;
      this._headGroup.rotation.x += deltaTime * 0.05;
      const s = 1 + bassEnergy * 0.2;
      this._headGroup.scale.set(s, s, s);
    }

    if (this._particles) {
      this._particles.rotation.y += deltaTime * 0.02;
    }

    if (this._isSnappingBack) {
      this._camera.position.lerp(this._initialCameraPos, deltaTime * 5);
      if (this._camera.position.distanceTo(this._initialCameraPos) < 0.05) {
        this._camera.position.copy(this._initialCameraPos);
        this._isSnappingBack = false;
      }
    }

    for (const [id, node] of this._nodes) {
      const isSelected = (id === this._selectedNodeId);
      const isActive = activeNodeIds.has(id);

      const energy = nodeEnergies.get(id);
      const bass = energy ? energy.bass : 0;
      const mid  = energy ? energy.mid  : 0;

      const scale = 1 + bass * 0.5;
      node.orb.scale.setScalar(scale);
      node.glow.scale.setScalar(1 + bass * 0.8);
      (node.glow.material as THREE.Material).opacity = isActive ? (0.12 + bass * 0.12) : 0.04;
      node.glow2.scale.setScalar(1 + bass * 0.5);
      (node.glow2.material as THREE.Material).opacity = isActive ? 0.05 : 0.015;

      node.light.intensity = isActive
        ? ((isSelected ? 4 : 2) + bass * 4)
        : (isSelected ? 1.5 : 0.8);

      const lightColor = new THREE.Color();
      lightColor.copy(node.color).lerp(new THREE.Color(0xffffff), mid * 0.4);
      node.light.color.copy(lightColor);
      (node.orb.material as THREE.MeshBasicMaterial).color.copy(lightColor).lerp(new THREE.Color(0xffffff), isActive ? 0.8 : 0.3);
      (node.orb.material as THREE.Material).opacity = isActive ? 1.0 : 0.6;

      if (isSelected) {
        node.ring.rotation.z += deltaTime * 0.6;
      }
    }

    this._controls.update();
    this._renderer.render(this._scene, this._camera);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this._controls.dispose();
    this._renderer.dispose();
    this._scene.traverse((child: any) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose());
        else child.material.dispose();
      }
    });
  }
}

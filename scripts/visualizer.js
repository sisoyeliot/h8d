import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';


export const NODE_COLORS = [
  '#a78bfa',
  '#6ee7b7',
  '#f9a8d4',
  '#fbbf24',
  '#67e8f9',
  '#fb923c',
  '#a3e635',
  '#f87171',
];

export class Visualizer {
  constructor(canvas) {
    this._canvas = canvas;


    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.2;
    this._renderer.setSize(window.innerWidth, window.innerHeight);


    this._scene = new THREE.Scene();
    this._scene.fog = new THREE.FogExp2(0x0a0a0f, 0.025);


    this._camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.1, 100
    );
    this._camera.position.set(0, 3.5, 9);
    this._camera.lookAt(0, 0, 0);


    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.05;
    this._controls.enablePan = false;
    this._controls.minDistance = 4;
    this._controls.maxDistance = 25;
    this._controls.maxPolarAngle = Math.PI * 0.85;
    this._controls.autoRotate = false;


    this._nodes = new Map();
    this._selectedNodeId = null;


    this._createLights();
    this._createHead();
    this._createParticles();
    this._createOrientationLabels();


    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  _createLights() {
    this._scene.add(new THREE.AmbientLight(0x1a1a3e, 0.6));

    const dir = new THREE.DirectionalLight(0x4a4a8a, 0.4);
    dir.position.set(5, 10, 5);
    this._scene.add(dir);

    const rim = new THREE.DirectionalLight(0x6ee7b7, 0.15);
    rim.position.set(-3, 2, -5);
    this._scene.add(rim);
  }

  _createHead() {

    const headGeo = new THREE.IcosahedronGeometry(1.1, 2);
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0x14142a, metalness: 0.3, roughness: 0.7,
      transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });
    this._head = new THREE.Mesh(headGeo, headMat);
    this._scene.add(this._head);


    const wireGeo = new THREE.IcosahedronGeometry(1.15, 1);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa, wireframe: true, transparent: true, opacity: 0.08,
    });
    this._headWire = new THREE.Mesh(wireGeo, wireMat);
    this._scene.add(this._headWire);


    const coreGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa, transparent: true, opacity: 0.12,
    });
    this._headCore = new THREE.Mesh(coreGeo, coreMat);
    this._scene.add(this._headCore);
  }

  _createParticles() {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 8 + Math.random() * 25;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x6e6e9e, size: 0.08, transparent: true, opacity: 0.5,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._particles = new THREE.Points(geo, mat);
    this._scene.add(this._particles);
  }

  _createOrientationLabels() {
    const arrowDefs = [

      { color: 0x67e8f9, pos: [-2.8, 0, 0], rot: [0, 0, Math.PI / 2] },
      { color: 0xfb923c, pos: [2.8, 0, 0], rot: [0, 0, -Math.PI / 2] },
      { color: 0x6ee7b7, pos: [0, 2.8, 0], rot: [0, 0, 0] },
      { color: 0xa78bfa, pos: [0, -2.8, 0], rot: [Math.PI, 0, 0] },
    ];

    for (const def of arrowDefs) {
      const group = new THREE.Group();
      const c = new THREE.Color(def.color);


      const coneGeo = new THREE.ConeGeometry(0.1, 0.3, 8);
      const coneMat = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.55,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.set(...def.rot);
      cone.position.set(...def.pos);
      group.add(cone);


      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(def.pos[0] * 0.45, def.pos[1] * 0.45, def.pos[2] * 0.45),
        new THREE.Vector3(def.pos[0] * 0.9, def.pos[1] * 0.9, def.pos[2] * 0.9),
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: c, transparent: true, opacity: 0.2,
      });
      group.add(new THREE.Line(lineGeo, lineMat));


      const glowGeo = new THREE.SphereGeometry(0.2, 12, 12);
      const glowMat = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(...def.pos);
      group.add(glow);

      this._scene.add(group);
    }
  }

  addNode(id, colorHex) {
    const color = new THREE.Color(colorHex);
    const group = new THREE.Group();


    const orbGeo = new THREE.SphereGeometry(0.15, 32, 32);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
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


  removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) return;

    this._scene.remove(node.group);


    node.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });

    this._nodes.delete(id);
    if (this._selectedNodeId === id) this._selectedNodeId = null;
  }


  updateNodePosition(id, x, y, z) {
    const node = this._nodes.get(id);
    if (node) node.group.position.set(x, y, z);
  }


  setSelectedNode(id) {

    if (this._selectedNodeId !== null) {
      const prev = this._nodes.get(this._selectedNodeId);
      if (prev) {
        prev.ring.material.opacity = 0;
      }
    }

    this._selectedNodeId = id;


    if (id !== null) {
      const node = this._nodes.get(id);
      if (node) {
        node.ring.material.opacity = 0.5;
      }
    }
  }


  getNodePosition(id) {
    const node = this._nodes.get(id);
    if (!node) return { x: 0, y: 0, z: 0 };
    const p = node.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  render(deltaTime, bassEnergy = 0, midEnergy = 0, activeNodeIds = new Set()) {
    for (const [id, node] of this._nodes) {
      const isSelected = (id === this._selectedNodeId);
      const isActive = activeNodeIds.has(id);


      const bass = isActive ? bassEnergy : 0;
      const mid = isActive ? midEnergy : 0;


      const scale = 1 + bass * 0.6;
      node.orb.scale.setScalar(scale);
      node.glow.scale.setScalar(1 + bass * 1.0);
      node.glow.material.opacity = isActive ? (0.1 + bass * 0.15) : 0.04;
      node.glow2.scale.setScalar(1 + bass * 0.6);
      node.glow2.material.opacity = isActive ? 0.06 : 0.02;


      node.light.intensity = isActive
        ? ((isSelected ? 2 : 1.2) + bass * 3)
        : (isSelected ? 0.8 : 0.3);


      const lightColor = new THREE.Color();
      lightColor.copy(node.color).lerp(new THREE.Color(0xffffff), mid * 0.3);
      node.light.color.copy(lightColor);
      node.orb.material.color.copy(lightColor).lerp(new THREE.Color(0xffffff), isActive ? 0.5 : 0.2);
      node.orb.material.opacity = isActive ? 1.0 : 0.4;


      if (isSelected) {
        node.ring.rotation.z += deltaTime * 0.8;
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
    this._scene.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }
}

/**
 * Lanyard — vanilla Three.js 挂牌彩蛋
 * 复现 React Bits <Lanyard /> 的核心效果：挂绳 + 卡片 + 物理摆动 + 可拖拽。
 * 零新增依赖（复用项目已有的 three，走 importmap）。
 *
 * 全屏覆盖（跟浏览器窗口一样大），挂牌从屏幕左上角垂下，可拖到全屏任意位置。
 * 用 window 捕获阶段监听 + 命中检测，命中卡片才拖拽，不挡 3D 球交互。
 *
 * 用法：
 *   import { createLanyard } from './components/Lanyard/Lanyard.js';
 *   const lanyard = createLanyard({ onReady: ... });
 *   lanyard.trigger();   // 挂牌从左上角掉落挂起
 *   lanyard.destroy();
 */
import * as THREE from 'three';

const SEGMENTS = 7;         // 绳子 verlet 分段数
const SCALE = 0.8;          // 整体缩放
const ROPE_LENGTH = 3.1 * SCALE;    // 绳长（世界单位）
const ROPE_RADIUS = 0.055 * SCALE;  // 绳子截面半径
const CARD_W = 1.7 * SCALE;         // 卡片宽
const CARD_H = 1.06 * SCALE;        // 卡片高（横向工牌比例）

export function createLanyard(options = {}) {
  const opts = {
    zIndex: 80,
    ...options,
  };

  // ── Canvas（全屏覆盖，跟浏览器窗口一样大）──
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:' + opts.zIndex +
    ';pointer-events:none;opacity:0;transition:opacity 0.5s ease;';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);

  // 灯光
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd8c3a5, 0.8);
  rim.position.set(-3, -1, 4);
  scene.add(rim);

  // ── 卡片纹理（canvas 绘制工牌）──
  function makeCardTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 320;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#171310';
    ctx.fillRect(0, 0, 512, 320);
    ctx.strokeStyle = '#D8C3A5';
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 18, 476, 284);
    ctx.fillStyle = '#D8C3A5';
    ctx.fillRect(200, 18, 112, 3);
    ctx.fillStyle = '#E8DCC8';
    ctx.font = '600 54px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ELVERE & LUNE', 256, 150);
    ctx.fillStyle = 'rgba(216,195,165,0.75)';
    ctx.font = '300 22px Georgia, serif';
    ctx.fillText('NATURAL CRYSTALS', 256, 210);
    ctx.fillStyle = 'rgba(216,195,165,0.5)';
    ctx.font = '300 14px Georgia, serif';
    ctx.fillText('SINCE  ·  MMXXV', 256, 270);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const cardMat = new THREE.MeshStandardMaterial({
    map: makeCardTexture(),
    roughness: 0.45,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const card = new THREE.Mesh(cardGeo, cardMat);

  // 卡片顶部的小金属夹
  const clampGeo = new THREE.BoxGeometry(CARD_W * 0.5, 0.06 * SCALE, 0.05 * SCALE);
  const clampMat = new THREE.MeshStandardMaterial({ color: 0x8a755c, roughness: 0.35, metalness: 0.7 });
  const clamp = new THREE.Mesh(clampGeo, clampMat);
  clamp.position.y = CARD_H / 2 + 0.03 * SCALE;

  const cardGroup = new THREE.Group();
  cardGroup.add(card);
  cardGroup.add(clamp);
  scene.add(cardGroup);

  // ── 绳子（TubeGeometry，每帧沿 verlet 点重建）──
  let ropeMesh = null;
  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0xd8c3a5, roughness: 0.6, metalness: 0.1,
  });

  // ── Verlet 物理 ──
  const anchor = new THREE.Vector3();
  const segLen = ROPE_LENGTH / SEGMENTS;
  const pts = [];

  // 布局：根据屏幕宽高动态设置相机距离和锚点，让挂牌大小自适应、锚在屏幕左上角
  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;

    // 目标卡片屏幕宽度（px），随屏宽缩放，clamp 到 130~200px 保证手机/桌面都合适
    const cardScreenW = Math.min(200, Math.max(130, W * 0.16));
    const halfFovTan = Math.tan((camera.fov * Math.PI / 180) / 2);
    // 反推相机距离：卡片世界宽 CARD_W 投影为 cardScreenW 像素
    const z = (CARD_W * H) / (2 * halfFovTan * cardScreenW);
    camera.position.set(0, 0, z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const halfH = halfFovTan * z;
    const halfW = halfH * camera.aspect;
    // 锚点在屏幕顶部、偏左（卡片左边缘留一点边距）
    anchor.set(-halfW + CARD_W * 0.5 + CARD_W * 0.2, halfH, 0);

    // 重建 verlet 点（绳子从锚点垂直垂下）
    pts.length = 0;
    for (let i = 0; i <= SEGMENTS; i++) {
      const p = new THREE.Vector3(anchor.x, anchor.y - i * segLen, 0);
      pts.push({ pos: p.clone(), prev: p.clone(), fixed: i === 0 });
    }
  }
  layout();
  window.addEventListener('resize', layout);

  // 状态
  let triggered = false;
  let dragging = false;
  let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragOffset = new THREE.Vector3();
  let lastCardPos = new THREE.Vector3();
  let cardVel = new THREE.Vector3();
  const clock = new THREE.Clock();
  let rafId = null;
  let destroyed = false;

  // 屏幕坐标 → 世界坐标（在 z≈0 平面，相对相机）
  function screenToWorld(clientX, clientY, out) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(dragPlane, out || new THREE.Vector3());
  }

  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(card, false).length > 0;
  }

  // ── 指针交互（window 捕获阶段，命中卡片才拦截，不挡 3D 球）──
  function onPointerDown(e) {
    if (!triggered || destroyed) return;
    if (!hitTest(e.clientX, e.clientY)) return;
    dragging = true;
    e.stopPropagation();
    e.preventDefault();
    document.body.style.cursor = 'grabbing';
    const w = screenToWorld(e.clientX, e.clientY);
    const cardPos = pts[SEGMENTS].pos;
    lastCardPos.copy(cardPos);
    dragOffset.copy(cardPos).sub(w);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    e.stopPropagation();
    const w = screenToWorld(e.clientX, e.clientY);
    w.add(dragOffset);
    const cardPos = pts[SEGMENTS].pos;
    cardVel.copy(cardPos).sub(lastCardPos);
    lastCardPos.copy(cardPos);
    cardPos.copy(w);
    pts[SEGMENTS].prev.copy(cardPos);
  }
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    e.stopPropagation();
    document.body.style.cursor = '';
    // 松手给一点抛掷速度
    pts[SEGMENTS].prev.copy(pts[SEGMENTS].pos).sub(cardVel.clone().multiplyScalar(0.85));
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);

  // ── 物理步进 ──
  function step(dt) {
    const sdt = Math.min(dt, 1 / 30);
    for (let i = 0; i <= SEGMENTS; i++) {
      const p = pts[i];
      if (p.fixed) continue;
      const vx = (p.pos.x - p.prev.x) * DAMP;
      const vy = (p.pos.y - p.prev.y) * DAMP;
      p.prev.x = p.pos.x;
      p.prev.y = p.pos.y;
      p.pos.x += vx;
      p.pos.y += vy + GRAV * sdt * sdt;
    }
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        let d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const diff = (d - segLen) / d;
        const ax = dx * diff * 0.5;
        const ay = dy * diff * 0.5;
        if (!a.fixed) { a.pos.x += ax; a.pos.y += ay; }
        if (!b.fixed) { b.pos.x -= ax; b.pos.y -= ay; }
      }
    }
    pts[0].pos.copy(anchor);
    pts[0].prev.copy(anchor);
  }

  // ── 渲染 ──
  function buildRope() {
    const curvePts = [];
    for (let i = 0; i <= SEGMENTS; i++) curvePts.push(pts[i].pos.clone());
    const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.5);
    const geo = new THREE.TubeGeometry(curve, SEGMENTS * 6, ROPE_RADIUS, 8, false);
    if (ropeMesh) {
      scene.remove(ropeMesh);
      ropeMesh.geometry.dispose();
    }
    ropeMesh = new THREE.Mesh(geo, ropeMat);
    scene.add(ropeMesh);
  }

  function updateCard() {
    const tail = pts[SEGMENTS].pos;
    const prev = pts[SEGMENTS - 1].pos;
    const dir = new THREE.Vector3().subVectors(tail, prev).normalize();
    cardGroup.position.copy(tail);
    const angle = Math.atan2(dir.x, -dir.y);
    cardGroup.rotation.z = angle;
  }

  function render() {
    rafId = requestAnimationFrame(render);
    if (destroyed) return;
    const dt = clock.getDelta();
    if (triggered) step(dt);
    updateCard();
    buildRope();
    renderer.render(scene, camera);
  }
  render();

  // ── API ──
  function trigger() {
    if (destroyed) return;
    triggered = true;
    canvas.style.opacity = '1';
    // 给一点初始摆动
    pts[SEGMENTS].prev.x = pts[SEGMENTS].pos.x + 0.35;
    if (opts.onReady) opts.onReady();
  }

  function destroy() {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', layout);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    document.body.style.cursor = '';
    cardGeo.dispose();
    cardMat.dispose();
    cardMat.map && cardMat.map.dispose();
    clampGeo.dispose();
    clampMat.dispose();
    ropeMat.dispose();
    if (ropeMesh) ropeMesh.geometry.dispose();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { trigger, destroy, canvas };
}

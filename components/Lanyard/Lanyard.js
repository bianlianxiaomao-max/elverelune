/**
 * Lanyard — vanilla Three.js 挂牌彩蛋
 * 复现 React Bits <Lanyard /> 的核心效果：挂绳 + 卡片 + 物理摆动 + 可拖拽。
 * 零新增依赖（复用项目已有的 three，走 importmap）。
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

  // ── Canvas（固定在左上角区域）──
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;left:0;top:0;width:420px;height:640px;z-index:' + opts.zIndex +
    ';pointer-events:none;opacity:0;transition:opacity 0.5s ease;';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(420, 640, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 420 / 640, 0.1, 50);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, -0.6, 0);

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
    // 背景
    ctx.fillStyle = '#171310';
    ctx.fillRect(0, 0, 512, 320);
    // 内边框
    ctx.strokeStyle = '#D8C3A5';
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 18, 476, 284);
    // 顶部小装饰线
    ctx.fillStyle = '#D8C3A5';
    ctx.fillRect(200, 18, 112, 3);
    // 标题
    ctx.fillStyle = '#E8DCC8';
    ctx.font = '600 54px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ELVERE & LUNE', 256, 150);
    // 副标题
    ctx.fillStyle = 'rgba(216,195,165,0.75)';
    ctx.font = '300 22px Georgia, serif';
    ctx.fillText('NATURAL CRYSTALS', 256, 210);
    // 底部小字
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
  const anchor = new THREE.Vector3(0, 2.9, 0); // 固定点（屏幕上方）
  const segLen = ROPE_LENGTH / SEGMENTS;
  const pts = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = new THREE.Vector3(0, anchor.y - i * segLen, 0);
    pts.push({ pos: p.clone(), prev: p.clone(), fixed: i === 0 });
  }
  const GRAV = -14;
  const DAMP = 0.985;

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

  // ── 指针交互 ──
  function onPointerDown(e) {
    if (!triggered || destroyed) return;
    if (!hitTest(e.clientX, e.clientY)) return;
    dragging = true;
    canvas.style.cursor = 'grabbing';
    const w = screenToWorld(e.clientX, e.clientY);
    const cardPos = pts[SEGMENTS].pos;
    dragOffset.copy(cardPos).sub(w);
    // 拖拽时解除约束
    pts[SEGMENTS].fixed = false;
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const w = screenToWorld(e.clientX, e.clientY);
    w.add(dragOffset);
    const cardPos = pts[SEGMENTS].pos;
    // 记录速度
    cardVel.copy(cardPos).sub(lastCardPos);
    lastCardPos.copy(cardPos);
    cardPos.copy(w);
    // 拖拽时同步 prev 让卡片跟随
    pts[SEGMENTS].prev.copy(cardPos);
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    // 松手给一点抛掷速度
    pts[SEGMENTS].prev.copy(pts[SEGMENTS].pos).sub(cardVel.multiplyScalar(0.85));
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

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
    // 距离约束（多次迭代更稳）
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
    // 锚点保持
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
    // 卡片方向：沿绳子末端方向
    const dir = new THREE.Vector3().subVectors(tail, prev).normalize();
    cardGroup.position.copy(tail);
    // 让卡片平面垂直于绳子方向，且朝向相机（简单做法：绕 Z 轴旋转）
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
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'grab';
    // 给一点初始摆动
    pts[SEGMENTS].prev.x = pts[SEGMENTS].pos.x + 0.35;
    if (opts.onReady) opts.onReady();
  }

  function destroy() {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
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

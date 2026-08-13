/* ============================================================
   ELVERE & LUNE — 椭圆照片环
   - 开场：图片堆叠在中心一张，然后展开成倾斜椭圆
   - 滚轮：顺时针旋转切换
   - hover：当前图向前放大，其他图变黑白
   ============================================================ */

(function () {
  'use strict';

  var ring = document.getElementById('ring');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var N = cards.length;
  if (!ring || !N) return;

  // ── 尺寸参数 ──
  var CW = Math.min(200, window.innerWidth * 0.34); // 卡片宽
  var RADIUS = Math.max(240, Math.min(420, window.innerWidth * 0.36)); // 椭圆半径
  document.documentElement.style.setProperty('--cw', CW + 'px');

  var rotation = 0;       // 当前环旋转（弧度）
  var velocity = 0;       // 惯性
  var opened = false;
  var hoverIdx = -1;

  var baseAngle = (Math.PI * 2) / N;

  // ── 每张卡的基础朝向：绕 Y 轴转 θ，再沿 Z 推出半径 ──
  function baseTransform(i) {
    var a = i * baseAngle;
    return 'rotateY(' + a + 'rad) translateZ(' + RADIUS + 'px)';
  }

  // ── 定位所有卡片 ──
  function layout(progress) {
    // progress: 0=堆叠在中心，1=完全展开
    var p = progress === undefined ? 1 : progress;
    cards.forEach(function (card, i) {
      var a = i * baseAngle;
      // 展开时半径从 0 → RADIUS，角度从 0 → a（让所有图从中心一张散开）
      var r = RADIUS * p;
      var ang = a * p;
      card.style.transform =
        'rotateY(' + ang + 'rad) translateZ(' + r + 'px)';
      card.style.opacity = p > 0.02 ? 1 : 0;
    });
  }

  // ── 开场动画：中心一张 → 展开成椭圆 ──
  function openIntro() {
    var start = performance.now();
    var dur = 1600;
    function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      layout(e);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        opened = true;
        layout(1);
      }
    }
    requestAnimationFrame(tick);
  }

  // ── 主循环：滚轮惯性 ──
  var lastT = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(32, now - lastT);
    lastT = now;
    if (opened) {
      rotation += velocity * dt;
      velocity *= 0.94;
      if (Math.abs(velocity) < 0.0005) velocity = 0;
      ring.style.transform = 'rotateY(' + rotation + 'rad)';
    }
  }

  // ── 滚轮 ──
  window.addEventListener('wheel', function (e) {
    if (!opened) return;
    e.preventDefault();
    velocity += (e.deltaY > 0 ? 1 : -1) * 0.0009;
    // 限速
    velocity = Math.max(-0.004, Math.min(0.004, velocity));
  }, { passive: false });

  // ── hover 检测：判断指针命中的是当前最前面的卡 ──
  function onPointerMove(e) {
    if (!opened) return;
    // 计算当前朝向相机的卡片索引（-rotation / baseAngle 归一到最前）
    var frontRaw = (-rotation / baseAngle) % N;
    var front = Math.round(frontRaw);
    front = ((front % N) + N) % N;

    // 用元素命中检测更稳：让浏览器判断 hover 在哪张卡上
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    var idx = card ? cards.indexOf(card) : -1;

    if (idx !== hoverIdx) {
      hoverIdx = idx;
      cards.forEach(function (c, i) {
        c.classList.toggle('is-front', i === idx);
        c.classList.toggle('is-dim', idx !== -1 && i !== idx);
      });
    }
  }

  window.addEventListener('pointermove', onPointerMove);

  // ── 触摸：滑动旋转（手机） ──
  var touchX = 0, touchLastX = 0;
  window.addEventListener('touchstart', function (e) {
    if (!opened) return;
    touchX = touchLastX = e.touches[0].clientX;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (!opened) return;
    var x = e.touches[0].clientX;
    var dx = x - touchLastX;
    touchLastX = x;
    rotation += dx * 0.004;
  }, { passive: true });

  // ── resize ──
  window.addEventListener('resize', function () {
    CW = Math.min(200, window.innerWidth * 0.34);
    RADIUS = Math.max(240, Math.min(420, window.innerWidth * 0.36));
    document.documentElement.style.setProperty('--cw', CW + 'px');
    if (opened) layout(1);
  });

  // ── 启动 ──
  layout(0);
  requestAnimationFrame(loop);
  // 稍等一帧后展开
  setTimeout(openIntro, 100);
})();

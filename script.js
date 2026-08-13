/* ============================================================
   ELVERE & LUNE — 平面椭圆照片环（2D）
   - 图片沿椭圆轨道，带随机微旋转角度，有间距
   - 环自动缓慢旋转（旋转动画），滚轮/滑动可叠加加速
   - hover：当前图向前放大
   - 开场：中心一张 → 展开成椭圆
   ============================================================ */

(function () {
  'use strict';

  var carousel = document.getElementById('carousel');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var N = cards.length;
  if (!carousel || !N) return;

  var rotation = 0;       // 全局旋转（弧度）
  var velocity = 0;       // 滚轮叠加速度
  var opened = false;
  var hoverIdx = -1;
  var baseAngle = (Math.PI * 2) / N;

  // 每张照片的固定随机微旋转角度（-8° ~ 8°）
  var randRot = cards.map(function () {
    return (Math.random() * 2 - 1) * 8;
  });

  // ── 参数 ──
  var CW, RX, RY, TILT, SHIFT_X, SHIFT_Y;

  function computeLayout() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var isMobile = w < 640;

    CW = isMobile ? Math.min(100, w * 0.26) : Math.min(160, w * 0.12);

    // 正圆（参考图），半径保证照片之间有间距
    var R = isMobile ? Math.max(140, w * 0.40) : Math.max(280, w * 0.21);
    RX = R;
    RY = R;

    TILT = isMobile ? 18 : 22;
    SHIFT_X = isMobile ? -w * 0.03 : -w * 0.13;
    SHIFT_Y = isMobile ? h * 0.04 : h * 0.07;

    document.documentElement.style.setProperty('--cw', CW + 'px');
    carousel.style.transform =
      'translate(' + SHIFT_X + 'px,' + SHIFT_Y + 'px) rotate(' + TILT + 'deg)';
  }

  // ── 每张卡的椭圆轨道坐标 + 深度排序 + 随机微旋转 ──
  function placeCards() {
    var info = cards.map(function (card, i) {
      var a = i * baseAngle + rotation;
      var x = RX * Math.cos(a);
      var y = RY * Math.sin(a);
      return { card: card, a: a, x: x, y: y, sin: Math.sin(a) };
    });

    var sorted = info.slice().sort(function (p, q) { return p.sin - q.sin; });

    info.forEach(function (it, i) {
      // 位置 + 随机微旋转
      it.card.style.transform =
        'translate(' + it.x + 'px,' + it.y + 'px) rotate(' + randRot[i] + 'deg)';
    });
    sorted.forEach(function (it, idx) {
      it.card.style.zIndex = 10 + idx;
    });
  }

  // ── 开场动画：中心一张 → 展开成椭圆 ──
  function openIntro() {
    var start = performance.now();
    var dur = 1600;
    var finalAngles = cards.map(function (_, i) { return i * baseAngle; });

    function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      var info = cards.map(function (card, i) {
        var a = finalAngles[i] * e;
        var x = RX * e * Math.cos(a);
        var y = RY * e * Math.sin(a);
        return { card: card, a: a, x: x, y: y, sin: Math.sin(a) };
      });
      var sorted = info.slice().sort(function (p, q) { return p.sin - q.sin; });
      info.forEach(function (it, i) {
        it.card.style.transform =
          'translate(' + it.x + 'px,' + it.y + 'px) rotate(' + randRot[i] * e + 'deg)';
        it.card.style.opacity = e > 0.02 ? 1 : 0;
      });
      sorted.forEach(function (it, idx) { it.card.style.zIndex = 10 + idx; });

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        opened = true;
        placeCards();
      }
    }
    requestAnimationFrame(tick);
  }

  // ── 主循环：自动缓慢旋转 + 滚轮惯性 ──
  var lastT = performance.now();
  var AUTO_SPEED = 0.00012; // 每秒弧度（缓慢自转）
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(32, now - lastT);
    lastT = now;
    if (opened) {
      rotation += AUTO_SPEED * dt + velocity * dt;
      velocity *= 0.94;
      if (Math.abs(velocity) < 0.0005) velocity = 0;
      placeCards();
    }
  }

  // ── 滚轮：叠加旋转速度 ──
  window.addEventListener('wheel', function (e) {
    if (!opened) return;
    e.preventDefault();
    velocity += (e.deltaY > 0 ? 1 : -1) * 0.0009;
    velocity = Math.max(-0.006, Math.min(0.006, velocity));
  }, { passive: false });

  // ── hover：命中检测（放大当前图） ──
  function onPointerMove(e) {
    if (!opened) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    var idx = card ? cards.indexOf(card) : -1;
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      cards.forEach(function (c, i) {
        c.classList.toggle('is-front', i === idx);
      });
    }
  }
  window.addEventListener('pointermove', onPointerMove);

  // ── 触摸：滑动旋转 ──
  var touchLastX = 0;
  window.addEventListener('touchstart', function (e) {
    if (!opened) return;
    touchLastX = e.touches[0].clientX;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (!opened) return;
    var x = e.touches[0].clientX;
    var dx = x - touchLastX;
    touchLastX = x;
    rotation += dx * 0.005;
  }, { passive: true });

  // ── resize ──
  window.addEventListener('resize', function () {
    computeLayout();
    if (opened) placeCards();
  });

  // ── 启动 ──
  computeLayout();
  cards.forEach(function (c) { c.style.opacity = 0; });
  requestAnimationFrame(loop);
  setTimeout(openIntro, 100);
})();

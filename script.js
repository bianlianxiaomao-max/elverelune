/* ============================================================
   ELVERE & LUNE — 平面照片环（2D）
   - 照片端正、正圆环、有间距，缓慢旋转
   - 开场：照片一张一张出现
   - 点击照片：旋转放大，聚焦到只显示弧段（中间大、两边小）
   - 滚轮/滑动：旋转浏览
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

  // 聚焦状态
  var zoom = 1;           // 1 = 完整环，>1 = 聚焦放大
  var targetZoom = 1;
  var focusIdx = -1;      // 聚焦的照片索引，-1 = 未聚焦

  // ── 参数 ──
  var CW, RX, RY, SHIFT_X, SHIFT_Y;

  function computeLayout() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var isMobile = w < 640;

    CW = isMobile ? Math.min(100, w * 0.26) : Math.min(160, w * 0.12);
    var R = isMobile ? Math.max(140, w * 0.40) : Math.max(280, w * 0.21);
    RX = R;
    RY = R;

    SHIFT_X = isMobile ? -w * 0.03 : -w * 0.13;
    SHIFT_Y = isMobile ? h * 0.04 : h * 0.07;

    document.documentElement.style.setProperty('--cw', CW + 'px');
    carousel.style.transform =
      'translate(' + SHIFT_X + 'px,' + SHIFT_Y + 'px)';
  }

  // ── 每张照片：轨道坐标 + 聚焦缩放 ──
  function placeCards() {
    var info = cards.map(function (card, i) {
      var a = i * baseAngle + rotation;
      var x = RX * Math.cos(a);
      var y = RY * Math.sin(a);
      return { card: card, a: a, x: x, y: y, sin: Math.sin(a), cos: Math.cos(a) };
    });

    // 聚焦缩放：前方照片大、两侧照片小（zoom 越大差异越明显）
    var sorted = info.slice().sort(function (p, q) { return p.sin - q.sin; });

    info.forEach(function (it) {
      var cos = it.cos;
      // zoom=1 时所有照片等大；zoom 越大，只有正前方（cos≈1）放大，两侧衰减
      var s = 1 + (zoom - 1) * Math.pow(Math.max(0, cos), 3);
      // 半径也随 zoom 放大，让环散开、只留前方弧段
      var rScale = zoom;
      var x = RX * rScale * it.cos;
      var y = RY * rScale * it.sin;
      it.card.style.transform =
        'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    });
    sorted.forEach(function (it, idx) {
      it.card.style.zIndex = 10 + idx;
    });
  }

  // ── 开场动画：照片一张一张出现 ──
  function openIntro() {
    var start = performance.now();
    var per = 130;   // 每张间隔 ms
    var dur = 700;   // 单张出现时长 ms
    var total = per * (N - 1) + dur;

    function tick(now) {
      var t = now - start;
      cards.forEach(function (card, i) {
        var begin = per * i;
        var local = Math.min(1, Math.max(0, (t - begin) / dur));
        // easeOutBack 轻微回弹，更自然
        var e = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
        var a = i * baseAngle;
        var x = RX * e * Math.cos(a);
        var y = RY * e * Math.sin(a);
        card.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + e + ')';
        card.style.opacity = local > 0 ? Math.min(1, local * 2) : 0;
      });
      if (t < total) {
        requestAnimationFrame(tick);
      } else {
        opened = true;
        placeCards();
      }
    }
    requestAnimationFrame(tick);
  }

  // ── 主循环：自动旋转 + 滚轮惯性 + zoom 平滑 ──
  var lastT = performance.now();
  var AUTO_SPEED = 0.0001;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(32, now - lastT);
    lastT = now;
    if (opened) {
      rotation += AUTO_SPEED * dt + velocity * dt;
      velocity *= 0.94;
      if (Math.abs(velocity) < 0.0005) velocity = 0;
      // zoom 平滑过渡
      zoom += (targetZoom - zoom) * 0.08;
      if (Math.abs(targetZoom - zoom) < 0.005) zoom = targetZoom;
      placeCards();
    }
  }

  // ── 滚轮：旋转（聚焦时也旋转浏览） ──
  window.addEventListener('wheel', function (e) {
    if (!opened) return;
    e.preventDefault();
    velocity += (e.deltaY > 0 ? 1 : -1) * 0.0009;
    velocity = Math.max(-0.006, Math.min(0.006, velocity));
  }, { passive: false });

  // ── 点击照片：聚焦放大 / 再点空白返回 ──
  function onClick(e) {
    if (!opened) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    var idx = card ? cards.indexOf(card) : -1;

    if (idx >= 0) {
      // 聚焦：目标照片转到最前方（cos 最大 → a=0），并放大
      if (focusIdx === idx && targetZoom > 1) {
        // 再次点击同一张 → 返回完整环
        targetZoom = 1;
        focusIdx = -1;
      } else {
        focusIdx = idx;
        targetZoom = 2.8;
      }
    } else {
      // 点击空白 → 返回完整环
      targetZoom = 1;
      focusIdx = -1;
    }
  }
  window.addEventListener('click', onClick);

  // ── hover：命中检测（轻微放大） ──
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

/* ============================================================
   ELVERE & LUNE — 倾斜椭圆照片环（2D）
   - 照片端正（不旋转），沿倾斜椭圆轨道排列
   - 整个椭圆倾斜 20-30°（只旋转位置坐标，照片保持端正）
   - 开场：照片在原地一张一张放大出现
   - 点击照片：聚焦放大到只显示一个弧段（中间大、两边小）
   - 滚轮/滑动：旋转浏览
   ============================================================ */

(function () {
  'use strict';

  var carousel = document.getElementById('carousel');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var N = cards.length;
  if (!carousel || !N) return;

  var rotation = 0;
  var velocity = 0;
  var opened = false;
  var hoverIdx = -1;
  var baseAngle = (Math.PI * 2) / N;

  var zoom = 1;
  var targetZoom = 1;
  var focusIdx = -1;

  var CW, RX, RY, TILT, SHIFT_X, SHIFT_Y;
  var TILT_RAD = 0;

  function computeLayout() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var isMobile = w < 640;

    // 椭圆：横向长轴 RX，纵向短轴 RY（RX > RY 形成椭圆）
    RX = isMobile ? Math.min(w * 0.34, 132) : Math.min(w * 0.19, 285);
    RY = RX * 0.62;
    // 照片宽：根据弧长反推，让 15 张照片之间有明显而均匀的间距
    CW = RX * 0.28;

    TILT = 22;                    // 椭圆倾斜角度（只倾斜位置，照片端正）
    TILT_RAD = TILT * Math.PI / 180;
    SHIFT_X = isMobile ? -w * 0.04 : -w * 0.10;  // 左下偏移
    SHIFT_Y = isMobile ? h * 0.03 : h * 0.04;

    document.documentElement.style.setProperty('--cw', CW + 'px');
    // 容器只做平移偏移，不 rotate（照片保持端正）
    carousel.style.transform =
      'translate(' + SHIFT_X + 'px,' + SHIFT_Y + 'px)';
  }

  // ── 椭圆坐标 + 倾斜（只倾斜位置，照片不旋转） ──
  function ellipsePos(a) {
    var ex = RX * Math.cos(a);
    var ey = RY * Math.sin(a);
    var c = Math.cos(TILT_RAD);
    var s = Math.sin(TILT_RAD);
    return { x: ex * c - ey * s, y: ex * s + ey * c };
  }

  // ── 每张照片：椭圆轨道坐标 + 聚焦缩放 ──
  function placeCards() {
    var info = cards.map(function (card, i) {
      var a = i * baseAngle + rotation;
      var p = ellipsePos(a);
      return { card: card, x: p.x, y: p.y, sin: Math.sin(a), cos: Math.cos(a) };
    });

    var sorted = info.slice().sort(function (p, q) { return p.sin - q.sin; });

    // 聚焦过渡系数 t：0 = 完整环（等大），1 = 聚焦弧段
    var t = Math.min(1, Math.max(0, (zoom - 1) / 1.8));

    info.forEach(function (it) {
      // 完整环：所有照片等大 s=1
      // 聚焦：前方(cos≈1)放大、两侧递减、后方(cos<0)缩到几乎看不见
      var w = Math.max(0, it.cos);
      var sFocus = Math.pow(w, 2) * 2.0 + 0.15;
      var s = 1 + t * (sFocus - 1);
      it.card.style.transform =
        'translate(' + it.x + 'px,' + it.y + 'px) scale(' + s + ')';
    });
    sorted.forEach(function (it, idx) { it.card.style.zIndex = 10 + idx; });
  }

  // ── 开场：照片在原地一张一张放大出现 ──
  function openIntro() {
    var start = performance.now();
    var per = 130, dur = 700;
    var total = per * (N - 1) + dur;

    function tick(now) {
      var t = now - start;
      cards.forEach(function (card, i) {
        var begin = per * i;
        var local = Math.min(1, Math.max(0, (t - begin) / dur));
        var e = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
        var p = ellipsePos(i * baseAngle);
        card.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) scale(' + e + ')';
        card.style.opacity = local > 0 ? Math.min(1, local * 2.5) : 0;
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

  // ── 主循环 ──
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
      zoom += (targetZoom - zoom) * 0.08;
      if (Math.abs(targetZoom - zoom) < 0.005) zoom = targetZoom;
      placeCards();
    }
  }

  // ── 滚轮 ──
  window.addEventListener('wheel', function (e) {
    if (!opened) return;
    e.preventDefault();
    velocity += (e.deltaY > 0 ? 1 : -1) * 0.0009;
    velocity = Math.max(-0.006, Math.min(0.006, velocity));
  }, { passive: false });

  // ── 点击聚焦 / 再点返回 ──
  function onClick(e) {
    if (!opened) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    var idx = card ? cards.indexOf(card) : -1;
    if (idx >= 0) {
      if (focusIdx === idx && targetZoom > 1) {
        targetZoom = 1; focusIdx = -1;
      } else {
        focusIdx = idx; targetZoom = 2.8;
      }
    } else {
      targetZoom = 1; focusIdx = -1;
    }
  }
  window.addEventListener('click', onClick);

  // ── hover ──
  function onPointerMove(e) {
    if (!opened) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    var idx = card ? cards.indexOf(card) : -1;
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      cards.forEach(function (c, i) { c.classList.toggle('is-front', i === idx); });
    }
  }
  window.addEventListener('pointermove', onPointerMove);

  // ── 触摸 ──
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

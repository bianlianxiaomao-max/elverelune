/* ============================================================
   ELVERE & LUNE — 倾斜椭圆轮盘（固定轨道版）
   - 固定数学轨道：radiusX / radiusY / orbitRotation / orbitCenter
   - 每张照片 angle = i * baseAngle + orbitOffset
   - 位置 = 椭圆坐标，再整体旋转（照片端正，不旋转）
   - 滚轮只改 orbitOffset，轨道参数永不漂移
   - 开场：照片从中心沿椭圆一张张散开（扑克牌展开）
   - 点击：镜头靠近轮盘（zoom 放大），不重排布局
   - hover：当前图轻微放大，其他图降饱和
   ============================================================ */

(function () {
  'use strict';

  var carousel = document.getElementById('carousel');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var N = cards.length;
  if (!carousel || !N) return;

  var baseAngle = (Math.PI * 2) / N;

  // ── 固定轨道参数 ──
  var radiusX, radiusY, orbitRotation, cardW, shiftX, shiftY;

  // ── 动态状态 ──
  var orbitOffset = 0;   // 滚轮唯一改动的量（轨道角偏移）
  var velocity = 0;      // 滚轮惯性
  var opened = false;
  var hoverIdx = -1;
  var zoom = 1;          // Explore 镜头缩放
  var targetZoom = 1;

  function computeLayout() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var isMobile = w < 640;

    // 水平扁椭圆：长轴水平（radiusX > radiusY）
    radiusX = isMobile ? Math.min(w * 0.36, 155) : Math.min(w * 0.24, 340);
    radiusY = radiusX * 0.62;
    // 图片宽：保证 16 张明显重叠
    cardW = radiusX * 0.42;
    // 椭圆整体倾斜（约 20°）
    orbitRotation = 20 * Math.PI / 180;

    shiftX = 0;
    shiftY = isMobile ? h * 0.02 : 0;

    document.documentElement.style.setProperty('--cw', cardW + 'px');
    carousel.style.transform =
      'translate(' + shiftX + 'px,' + shiftY + 'px)';
  }

  // ── 椭圆坐标 + 整体倾斜（只旋转位置，照片端正） ──
  function orbitPos(angle, z) {
    var ex = radiusX * Math.cos(angle);
    var ey = radiusY * Math.sin(angle);
    var c = Math.cos(orbitRotation);
    var s = Math.sin(orbitRotation);
    return {
      x: (ex * c - ey * s) * z,
      y: (ex * s + ey * c) * z
    };
  }

  // ── 每张照片：固定轨道 + 重叠 + z-index 随纵深变化 ──
  function placeCards() {
    var items = cards.map(function (card, i) {
      var a = i * baseAngle + orbitOffset;
      var p = orbitPos(a, zoom);
      // 纵深：旋转后 y 越大越靠前（屏幕下方靠前）
      return { card: card, x: p.x, y: p.y, depth: p.y };
    });
    items.sort(function (p, q) { return p.depth - q.depth; });
    items.forEach(function (it, idx) {
      var z = 100 + idx;
      if (cards.indexOf(it.card) === hoverIdx) z = 1000;
      it.card.style.transform =
        'translate(' + it.x + 'px,' + it.y + 'px) scale(' + zoom + ')';
      it.card.style.zIndex = z;
    });
  }

  // ── 开场：照片从中心沿椭圆一张张散开（扑克牌展开） ──
  function openIntro() {
    var start = performance.now();
    var per = 110, dur = 650;
    var total = per * (N - 1) + dur;

    function tick(now) {
      var t = now - start;
      cards.forEach(function (card, i) {
        var begin = per * i;
        var local = Math.min(1, Math.max(0, (t - begin) / dur));
        var e = local < 1 ? 1 - Math.pow(1 - local, 3) : 1; // easeOutCubic
        var a = i * baseAngle;
        var p = orbitPos(a, e);       // 半径因子 0→1 散开
        var sc = 0.3 + 0.7 * e;       // scale 从小变大
        card.style.transform =
          'translate(' + p.x + 'px,' + p.y + 'px) scale(' + sc + ')';
        card.style.opacity = local > 0 ? 1 : 0;
        card.style.zIndex = 10 + i;
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

  // ── 主循环：滚轮惯性沿固定轨道移动 ──
  var lastT = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(32, now - lastT);
    lastT = now;
    if (opened) {
      orbitOffset += velocity;
      velocity *= 0.95;
      if (Math.abs(velocity) < 0.0004) velocity = 0;
      zoom += (targetZoom - zoom) * 0.08;
      if (Math.abs(targetZoom - zoom) < 0.005) zoom = targetZoom;
      placeCards();
    }
  }

  // ── 滚轮：向下 = 顺时针 = 沿固定轨道连续移动 ──
  window.addEventListener('wheel', function (e) {
    if (!opened) return;
    e.preventDefault();
    velocity += -e.deltaY * 0.0004;
    velocity = Math.max(-0.01, Math.min(0.01, velocity));
  }, { passive: false });

  // ── 触摸滑动：沿轨道移动 ──
  var touchLastY = 0;
  window.addEventListener('touchstart', function (e) {
    if (!opened) return;
    touchLastY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (!opened) return;
    var y = e.touches[0].clientY;
    var dy = y - touchLastY;
    touchLastY = y;
    orbitOffset += dy * 0.0006;
  }, { passive: true });

  // ── 点击：镜头靠近轮盘（zoom 放大，不重排） ──
  function onClick(e) {
    if (!opened) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    if (card) {
      targetZoom = targetZoom > 1.5 ? 1 : 2.1;
    } else {
      targetZoom = 1;
    }
  }
  window.addEventListener('click', onClick);

  // ── hover：当前图放大、其他图降饱和 ──
  function onPointerMove(e) {
    if (!opened) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var card = el && el.closest ? el.closest('.card') : null;
    var idx = card ? cards.indexOf(card) : -1;
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      cards.forEach(function (c, i) {
        c.classList.toggle('is-front', i === idx);
        c.classList.toggle('is-dim', idx >= 0 && i !== idx);
      });
      placeCards();
    }
  }
  window.addEventListener('pointermove', onPointerMove);

  // ── resize：重算固定轨道 ──
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

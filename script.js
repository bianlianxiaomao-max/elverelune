/* ============================================================
   ELVERE & LUNE — 倾斜椭圆照片环（2D）
   - 照片端正，沿椭圆轨道排列，间距紧凑（参考图 5-10%）
   - 开场：照片一张一张原地放大出现，出现 5 张后环缓慢旋转
   - 点击照片：聚焦成竖排三张（中间大、上下小）充满窗口
   - 聚焦后滚动：一帧一帧切换中间照片（iPhone 计时器滚轮感）
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

  var CW, RX, RY, CW_FOCUS, TILT, SHIFT_X, SHIFT_Y;
  var TILT_RAD = 0;

  function computeLayout() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var isMobile = w < 640;

    // 环：接近正圆的椭圆（弧长均匀）+ 紧凑间距（参考图 5-10%）
    RX = isMobile ? Math.min(w * 0.36, 150) : Math.min(w * 0.21, 320);
    RY = RX * 0.95;
    CW = RX * 0.38;

    // 聚焦照片宽（竖排三张充满窗口，只留文字）
    CW_FOCUS = isMobile ? Math.min(w * 0.9, 350) : Math.min(h * 0.42, 420);

    TILT = 22;
    TILT_RAD = TILT * Math.PI / 180;
    SHIFT_X = isMobile ? -w * 0.04 : -w * 0.10;
    SHIFT_Y = isMobile ? h * 0.03 : h * 0.04;

    document.documentElement.style.setProperty('--cw', CW + 'px');
    carousel.style.transform =
      'translate(' + SHIFT_X + 'px,' + SHIFT_Y + 'px)';
  }

  function ellipsePos(a) {
    var ex = RX * Math.cos(a);
    var ey = RY * Math.sin(a);
    var c = Math.cos(TILT_RAD);
    var s = Math.sin(TILT_RAD);
    return { x: ex * c - ey * s, y: ex * s + ey * c };
  }

  // ── 每张照片：环布局 ↔ 竖排聚焦布局 插值 ──
  function placeCards() {
    var t = Math.min(1, Math.max(0, (zoom - 1) / 1.8));
    var cw = CW + t * (CW_FOCUS - CW);
    document.documentElement.style.setProperty('--cw', cw + 'px');

    var info = cards.map(function (card, i) {
      var a = i * baseAngle + rotation;
      var ep = ellipsePos(a);

      // 环布局
      var ringX = ep.x, ringY = ep.y, ringS = 1;

      // 竖排聚焦布局（相对 focusIdx，带圆柱面弧度）
      var rel = ((i - focusIdx) % N + N) % N;
      if (rel > N / 2) rel -= N;
      var gap = cw * 0.16;
      var focusX = 0;
      var focusY = rel * (cw * 0.75 + gap);
      var focusS = rel === 0 ? 1 : (Math.abs(rel) === 1 ? 0.7 : 0);
      // 弧度：上方照片向上仰起（顶部向后），下方照片向下俯冲（底部向后）
      var focusRX = rel === 0 ? 0 : (rel < 0 ? 32 : -32);

      var x = ringX + (focusX - ringX) * t;
      var y = ringY + (focusY - ringY) * t;
      var s = ringS + (focusS - ringS) * t;
      var rx = focusRX * t;

      return { card: card, x: x, y: y, s: s, rx: rx, sin: Math.sin(a) };
    });

    info.sort(function (p, q) {
      if (p.s !== q.s) return p.s - q.s;
      return p.sin - q.sin;
    });
    info.forEach(function (it, idx) {
      it.card.style.transform =
        'translate(' + it.x + 'px,' + it.y + 'px) perspective(900px) rotateX(' + it.rx + 'deg) scale(' + it.s + ')';
      it.card.style.zIndex = 10 + idx;
    });
  }

  // ── 开场：照片一张一张原地放大出现，出现 5 张后环缓慢旋转 ──
  function openIntro() {
    var start = performance.now();
    var per = 130, dur = 700;
    var total = per * (N - 1) + dur;

    function tick(now) {
      var t = now - start;
      if (t > per * 4) rotation += 0.0008;
      cards.forEach(function (card, i) {
        var begin = per * i;
        var local = Math.min(1, Math.max(0, (t - begin) / dur));
        var e = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
        var p = ellipsePos(i * baseAngle + rotation);
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
      if (focusIdx >= 0 && targetZoom > 1) {
        // 聚焦：不自动旋转，滚动切换由 focusIdx 驱动
        velocity = 0;
      } else {
        rotation += AUTO_SPEED * dt + velocity * dt;
        velocity *= 0.94;
        if (Math.abs(velocity) < 0.0005) velocity = 0;
      }
      zoom += (targetZoom - zoom) * 0.08;
      if (Math.abs(targetZoom - zoom) < 0.005) zoom = targetZoom;
      placeCards();
    }
  }

  // ── 滚轮：非聚焦 = 自由旋转；聚焦 = 一帧一帧切换 ──
  var lastWheelT = 0;
  window.addEventListener('wheel', function (e) {
    if (!opened) return;
    e.preventDefault();
    if (focusIdx >= 0 && targetZoom > 1) {
      var now = performance.now();
      if (now - lastWheelT > 220) {
        focusIdx = (focusIdx + (e.deltaY > 0 ? 1 : -1) + N) % N;
        lastWheelT = now;
      }
    } else {
      velocity += (e.deltaY > 0 ? 1 : -1) * 0.0009;
      velocity = Math.max(-0.006, Math.min(0.006, velocity));
    }
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

  // ── 触摸：非聚焦 = 水平滑动旋转；聚焦 = 上下滑动切换中心照片 ──
  var touchLastX = 0;
  var touchLastY = 0;
  var touchAccum = 0;
  window.addEventListener('touchstart', function (e) {
    if (!opened) return;
    touchLastX = e.touches[0].clientX;
    touchLastY = e.touches[0].clientY;
    touchAccum = 0;
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (!opened) return;
    var x = e.touches[0].clientX;
    var y = e.touches[0].clientY;
    var dx = x - touchLastX;
    var dy = y - touchLastY;
    touchLastX = x;
    touchLastY = y;
    if (focusIdx >= 0 && targetZoom > 1) {
      // 竖排：上下滑动切换（上滑=下一张，下滑=上一张）
      touchAccum += dy;
      if (touchAccum > 40) { focusIdx = (focusIdx - 1 + N) % N; touchAccum = 0; }
      else if (touchAccum < -40) { focusIdx = (focusIdx + 1 + N) % N; touchAccum = 0; }
    } else {
      rotation += dx * 0.005;
    }
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

// ============================================================
// ELVERE & LUNE — SCRIPT
// Hero reveal / Card-deal snap / Explore mode / Orbit rotation
// ============================================================

(function () {
  'use strict';

  // ----------------------------------------------------------
  // 1. CONSTANTS
  // ----------------------------------------------------------

  var ITEM_COUNT = 10;
  var DEG2RAD = Math.PI / 180;

  var orbitRadius = 280;
  var exploreRadius = 650;
  var exploreOffsetX = 0;
  var exploreOffsetY = 0;
  var activeRadius = 280;
  var focusAngle = 0;

  var EASING = 0.08;
  var WHEEL_SENSITIVITY = 0.6;
  var DRAG_SENSITIVITY = 0.35;
  var INERTIA_DECAY = 0.94;
  var INERTIA_MIN = 0.03;

  // ----------------------------------------------------------
  // 2. STATE
  // ----------------------------------------------------------

  var currentRotation = 0;
  var targetRotation = 0;
  var isExploring = false;
  var savedRotation = 0;
  var animFrameId = null;
  var savedScrollY = 0;

  var isDragging = false;
  var dragLastX = 0;
  var inertiaVelocity = 0;

  var cardDealPlayed = false;

  // active-index tracking for haptic feedback
  var lastActiveIndex = -1;

  // pointer touch interaction (mobile — strict direction locking)
  var pointerStartX = 0;
  var pointerStartY = 0;
  var pointerMoved = false;
  var TAP_THRESHOLD = 10;
  var gestureDirection = 'none';   // 'none' | 'horizontal' | 'vertical'
  var GESTURE_THRESHOLD = 12;       // px of movement before direction locks

  // Mobile step-rotation (vertical swipe → stepped orbit like iPhone timer wheel)
  var isMobileDevice = false;
  var mobileOrbitState = { rotation: 0 };
  var mobileAnimating = false;
  var mobilePointerActive = false;
  var mobileStartY = 0;
  var mobileLastY = 0;
  var mobileLastTime = 0;
  var mobileVelocity = 0;        // px/ms
  var mobileTotalDy = 0;
  var MOBILE_STEP_THRESHOLD = 40; // px of vertical movement → one step

  // ----------------------------------------------------------
  // 3. DOM REFERENCES
  // ----------------------------------------------------------

  var orbitEl = document.getElementById('orbit');
  var orbitWrapper = document.getElementById('orbitWrapper');
  var orbitCenter = document.getElementById('orbitCenter');
  var exploreHint = document.getElementById('exploreHint');
  var exploreExit = document.getElementById('exploreExit');
  var bodyEl = document.body;

  var items = [];

  // ----------------------------------------------------------
  // 4. RESPONSIVE RADIUS
  // ----------------------------------------------------------

  function getNormalRadius() {
    var w = window.innerWidth;
    if (w <= 380)       return 115;
    else if (w <= 600)  return 145;
    else if (w <= 1024) return 220;
    else                return 280;
  }

  function updateRadius() {
    orbitRadius = getNormalRadius();
    var imgW = Math.round(orbitRadius * 0.38);
    var imgH = Math.round(imgW * 1.35);
    items.forEach(function (item) {
      item.style.width = imgW + 'px';
      item.style.height = imgH + 'px';
    });
    if (!isExploring) {
      activeRadius = orbitRadius;
    }
  }

  // ----------------------------------------------------------
  // 5. EXPLORE MODE PARAMS
  // ----------------------------------------------------------

  function getExploreParams() {
    var w = window.innerWidth;
    if (w <= 380)       exploreRadius = 260;
    else if (w <= 600)  exploreRadius = 340;
    else if (w <= 1024) exploreRadius = 500;
    else                exploreRadius = 650;

    exploreOffsetX = exploreRadius;
    exploreOffsetY = Math.round(exploreRadius * 0.12);  // near vertical centre, slight bias
  }

  // ----------------------------------------------------------
  // 6. FOCUS ANGLE
  // ----------------------------------------------------------

  function computeFocusAngle() {
    if (!orbitEl || !orbitWrapper) return 0;
    var wrapperRect = orbitWrapper.getBoundingClientRect();
    var vpCenterX = wrapperRect.width / 2;
    var vpCenterY = wrapperRect.height / 2;
    var dx = vpCenterX - orbitEl.offsetLeft;
    var dy = vpCenterY - orbitEl.offsetTop;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  function angularDist(a, b) {
    var d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  // Returns which item index is closest to the focus angle
  function getSnappedIndex(rotationDeg) {
    var fa = computeFocusAngle();
    var bestDist = Infinity;
    var bestIdx = 0;
    for (var k = 0; k < ITEM_COUNT; k++) {
      var ak = (k * 36 + rotationDeg) % 360;
      if (ak < 0) ak += 360;
      var dk = angularDist(ak, fa);
      if (dk < bestDist) { bestDist = dk; bestIdx = k; }
    }
    return bestIdx;
  }

  // ----------------------------------------------------------
  // 7. BUILD ORBIT ITEMS
  // ----------------------------------------------------------

  function buildOrbit() {
    if (!orbitEl) return;
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < ITEM_COUNT; i++) {
      var item = document.createElement('div');
      item.className = 'orbit-item';
      item.setAttribute('data-index', i);
      var img = document.createElement('img');
      img.className = 'orbit-item__img';
      img.src = 'images/product' + String(i + 1).padStart(2, '0') + '.jpg';
      img.alt = 'Product ' + String(i + 1).padStart(2, '0');
      img.draggable = false;
      img.loading = 'lazy';
      item.style.opacity = '0';  // hidden until card-deal animation fires
      item.appendChild(img);
      fragment.appendChild(item);
    }
    orbitEl.appendChild(fragment);
    items = Array.from(orbitEl.querySelectorAll('.orbit-item'));
  }

  // ----------------------------------------------------------
  // 8. UPDATE ORBIT TRANSFORM
  // ----------------------------------------------------------

  function updateOrbitTransform(rotationDeg) {
    if (!orbitEl) return;

    var r = activeRadius;
    var baseW = Math.round(r * 0.38);
    var baseH = Math.round(baseW * 1.35);

    if (isExploring) {
      focusAngle = computeFocusAngle();

      // Snap focus to the nearest item's exact angle + haptic detection.
      // This guarantees ONE image is always at dist=0 → blur=0, opacity=1, scale=max.
      // Without snap, focusAngle is an arbitrary value (e.g. -14°) and NO item
      // ever lands exactly on it, making ALL images blurry.
      var bestDist = Infinity;
      var snappedIdx = 0;
      for (var k = 0; k < ITEM_COUNT; k++) {
        var ak = (k * 36 + rotationDeg) % 360;
        if (ak < 0) ak += 360;
        var dk = angularDist(ak, focusAngle);
        if (dk < bestDist) { bestDist = dk; snappedIdx = k; }
      }
      // Snap to that item's exact angle: dist=0 for one image every frame
      focusAngle = (snappedIdx * 36 + rotationDeg) % 360;
      if (focusAngle < 0) focusAngle += 360;

      // Haptic feedback: brief vibration when centre image switches
      if (snappedIdx !== lastActiveIndex && lastActiveIndex !== -1) {
        if ('vibrate' in navigator) {
          try { navigator.vibrate(10); } catch (_) { /* silent */ }
        }
      }
      lastActiveIndex = snappedIdx;
    }

    var angle, rad, x, y, dist, t, scale, opacity, z, blur;

    for (var i = 0; i < items.length; i++) {
      angle = (i * 36 + rotationDeg) % 360;
      if (angle < 0) angle += 360;
      rad = angle * DEG2RAD;
      x = Math.cos(rad) * r;
      y = Math.sin(rad) * r;

      if (isExploring) {
        dist = angularDist(angle, focusAngle);
        t = dist / 180;                // 0 = center, 1 = opposite side
        var st = Math.sqrt(t);         // sqrt curve: steep near center, gentle at far
        scale = 0.25 + 1.3 * (1 - st); // 1.55 center → 0.97(36°) → 0.73(72°) → 0.25 far
        opacity = 1.0 - st * 0.85;     // 1.0 center → 0.62(36°) → 0.40(72°) → 0.15 far
        z = Math.round((1 - st) * 100); // 100 center → 55(36°) → 37(72°) → 0 far
        blur = st * 5;                 // 0px center → 2.2px(36°) → 3.2px(72°) → 5px far

        items[i].style.transform =
          'translate(calc(' + x.toFixed(2) + 'px - 50%), ' +
                      'calc(' + y.toFixed(2) + 'px - 50%)) ' +
          'scale(' + scale.toFixed(3) + ')';
        items[i].style.opacity = opacity.toFixed(3);
        items[i].style.zIndex = z;
        items[i].style.filter = 'blur(' + blur.toFixed(1) + 'px)';
      } else {
        items[i].style.transform =
          'translate(calc(' + x.toFixed(2) + 'px - 50%), ' +
                      'calc(' + y.toFixed(2) + 'px - 50%))';
        // Show only after card-deal animation has played (or GSAP fallback)
        items[i].style.opacity = cardDealPlayed ? '1' : '0';
        items[i].style.zIndex = '0';
        items[i].style.filter = 'blur(0px)';
      }

      items[i].style.width = baseW + 'px';
      items[i].style.height = baseH + 'px';
    }
  }

  // ----------------------------------------------------------
  // 9. ANIMATION LOOP (rAF)
  // ----------------------------------------------------------

  function startAnimationLoop() {
    if (animFrameId) return;

    function loop() {
      // During mobile step animation, GSAP drives currentRotation — rAF hands off.
      if (mobileAnimating) {
        animFrameId = requestAnimationFrame(loop);
        return;
      }

      if (!isDragging && Math.abs(inertiaVelocity) > INERTIA_MIN) {
        targetRotation += inertiaVelocity;
        inertiaVelocity *= INERTIA_DECAY;
      } else if (!isDragging && Math.abs(inertiaVelocity) <= INERTIA_MIN) {
        inertiaVelocity = 0;
      }

      // Magnetic snap toward nearest 36° slot when coasting in explore mode.
      // Creates tactile "frame feel" — not smooth carousel, not jarring detent.
      if (!isDragging && isExploring && Math.abs(inertiaVelocity) < 0.01) {
        var nearestSlot = Math.round(targetRotation / 36) * 36;
        var snapDelta = nearestSlot - targetRotation;
        if (Math.abs(snapDelta) > 0.03) {
          targetRotation += snapDelta * 0.07; // gentle pull — "magnetic"
        }
      }

      // During drag: instant 1:1 tracking (no lerp lag).
      // After release: smooth lerp into inertia decay.
      // updateOrbitTransform is only called when state actually changes —
      // this prevents it from overwriting the card-deal GSAP animation.
      if (isDragging) {
        currentRotation = targetRotation;
        updateOrbitTransform(currentRotation);
      } else {
        var diff = targetRotation - currentRotation;
        if (Math.abs(diff) > 0.005 || isExploring) {
          currentRotation += diff * EASING;
          if (Math.abs(diff) < 0.01 && !isExploring) {
            currentRotation = targetRotation;
          }
          updateOrbitTransform(currentRotation);
        }
      }

      animFrameId = requestAnimationFrame(loop);
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // ----------------------------------------------------------
  // 10. EXPLORE MODE — ENTER / EXIT
  // ----------------------------------------------------------

  function enterExploreMode() {
    if (isExploring) return;
    if (!orbitWrapper) return;

    isExploring = true;

    savedRotation = currentRotation;
    targetRotation = currentRotation;

    savedScrollY = window.scrollY || window.pageYOffset;
    bodyEl.style.position = 'fixed';
    bodyEl.style.top = '-' + savedScrollY + 'px';
    bodyEl.style.width = '100%';
    bodyEl.classList.add('exploring');

    getExploreParams();

    if (typeof gsap !== 'undefined') {
      gsap.to({ val: activeRadius }, {
        val: exploreRadius,
        duration: 0.55,
        ease: 'power3.out',
        onUpdate: function () {
          activeRadius = this.targets()[0].val;
          updateOrbitTransform(currentRotation);
        }
      });
      gsap.to(orbitEl, {
        left: 'calc(50% - ' + exploreOffsetX + 'px)',
        top: 'calc(50% + ' + exploreOffsetY + 'px)',
        duration: 0.55,
        ease: 'power3.out'
      });
    } else {
      activeRadius = exploreRadius;
      orbitEl.style.left = 'calc(50% - ' + exploreOffsetX + 'px)';
      orbitEl.style.top = 'calc(50% + ' + exploreOffsetY + 'px)';
      updateOrbitTransform(currentRotation);
    }

    orbitWrapper.classList.add('exploring');
  }

  function exitExploreMode() {
    if (!isExploring) return;
    if (!orbitWrapper) return;

    var fromRadius = activeRadius;
    isExploring = false;
    isDragging = false;
    inertiaVelocity = 0;

    // Kill any in-flight mobile step animation
    if (mobileAnimating) {
      gsap.killTweensOf(mobileOrbitState);
      mobileAnimating = false;
      mobilePointerActive = false;
    }

    var normalRadius = getNormalRadius();
    orbitWrapper.classList.remove('exploring');

    if (typeof gsap !== 'undefined') {
      gsap.to(orbitEl, {
        left: '50%',
        top: '50%',
        duration: 0.5,
        ease: 'power3.inOut'
      });
      gsap.to({ val: fromRadius }, {
        val: normalRadius,
        duration: 0.5,
        ease: 'power3.inOut',
        onUpdate: function () {
          activeRadius = this.targets()[0].val;
          updateOrbitTransform(currentRotation);
        },
        onComplete: function () {
          activeRadius = normalRadius;
          updateRadius();
          updateOrbitTransform(currentRotation);
        }
      });
    } else {
      activeRadius = normalRadius;
      orbitEl.style.left = '50%';
      orbitEl.style.top = '50%';
      updateRadius();
      updateOrbitTransform(currentRotation);
    }

    bodyEl.classList.remove('exploring');
    bodyEl.style.position = '';
    bodyEl.style.top = '';
    bodyEl.style.width = '';
    window.scrollTo(0, savedScrollY);
  }

  // ----------------------------------------------------------
  // 10b. MOBILE ANIMATION — single smooth tween, subtle magnetic landing
  // ----------------------------------------------------------

  function animateMobileToTarget(targetRot, duration) {
    mobileOrbitState.rotation = currentRotation;
    mobileAnimating = true;

    gsap.to(mobileOrbitState, {
      rotation: targetRot,
      duration: duration,
      ease: 'power2.out',            // smooth deceleration — natural "settling" feel
      overwrite: 'auto',
      onUpdate: function () {
        currentRotation = mobileOrbitState.rotation;
        updateOrbitTransform(currentRotation);
      },
      onComplete: function () {
        currentRotation = targetRot;
        targetRotation = targetRot;
        mobileAnimating = false;
        updateOrbitTransform(currentRotation);

        // Very subtle haptic — just a whisper at final landing
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(5); } catch (_) { /* silent */ }
        }
      }
    });
  }

  // ----------------------------------------------------------
  // 11. EVENT HANDLERS
  // ----------------------------------------------------------

  // --- WHEEL (desktop: rotate orbit in explore mode) ---

  function onWheel(e) {
    if (!isExploring) return;
    e.preventDefault();
    e.stopPropagation();
    inertiaVelocity = 0;
    // 1 mouse-wheel tick (≈100px deltaY) → one 36° image slot
    // Snap in rAF loop will fine-tune to the exact slot after wheel stops.
    targetRotation += e.deltaY * 0.36;
  }

  // --- MOUSE DOWN (desktop: enter explore + drag start) ---

  function onMouseDown(e) {
    // only left button
    if (e.button !== 0) return;

    // exit text
    if (exploreExit && exploreExit.contains(e.target)) {
      e.preventDefault();
      exitExploreMode();
      return;
    }
    // hint text
    if (exploreHint && exploreHint.contains(e.target)) {
      e.preventDefault();
      enterExploreMode();
      return;
    }
    // orbit area click → enter
    if (orbitWrapper && orbitWrapper.contains(e.target) && !isExploring) {
      if (orbitEl && (e.target === orbitEl || orbitEl.contains(e.target) ||
          e.target === orbitWrapper || e.target === orbitCenter ||
          (orbitCenter && orbitCenter.contains(e.target)))) {
        e.preventDefault();
        enterExploreMode();
        return;
      }
    }
    // drag start (explore mode)
    if (isExploring && orbitWrapper && orbitWrapper.contains(e.target) &&
        !(exploreExit && exploreExit.contains(e.target))) {
      e.preventDefault();
      inertiaVelocity = 0;
      isDragging = true;
      dragLastX = e.clientX;
    }
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    var dx = e.clientX - dragLastX;
    dragLastX = e.clientX;
    targetRotation += dx * DRAG_SENSITIVITY;
    inertiaVelocity = dx * DRAG_SENSITIVITY;
  }

  function onMouseUp(e) {
    isDragging = false;
  }

  // --- KEYBOARD ---

  function onKeyDown(e) {
    if (e.key === 'Escape' && isExploring) {
      e.preventDefault();
      exitExploreMode();
    }
  }

  // --- POINTER EVENTS (mobile: vertical swipe → stepped orbit rotation like iPhone timer) ---

  function onPointerDown(e) {
    // mouse is handled separately by mousedown/mousemove/mouseup
    if (e.pointerType === 'mouse') return;
    if (!orbitWrapper) return;

    // Exit text tap
    if (exploreExit && exploreExit.contains(e.target)) {
      exitExploreMode();
      return;
    }

    // Explore mode: prepare for vertical swipe tracking
    if (isExploring && orbitWrapper.contains(e.target)) {
      // Interrupt any in-flight step animation
      if (mobileAnimating) {
        gsap.killTweensOf(mobileOrbitState);
        mobileAnimating = false;
      }

      mobilePointerActive = true;
      mobileStartY = e.clientY;
      mobileLastY = e.clientY;
      mobileLastTime = performance.now();
      mobileVelocity = 0;
      mobileTotalDy = 0;

      e.preventDefault();
      return;
    }

    // Normal mode: record position for tap-to-enter detection
    // Do NOT preventDefault — browser handles scroll natively.
    if (!isExploring && orbitWrapper.contains(e.target)) {
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      pointerMoved = false;
    }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'mouse') return;

    // Explore mode: track vertical movement for step calculation
    if (mobilePointerActive) {
      var now = performance.now();
      var dy = e.clientY - mobileLastY;
      var dt = now - mobileLastTime;

      mobileTotalDy = e.clientY - mobileStartY;
      mobileLastY = e.clientY;
      mobileLastTime = now;

      // Weighted rolling velocity (px/ms)
      if (dt > 0) {
        mobileVelocity = mobileVelocity * 0.5 + (dy / dt) * 0.5;
      }

      e.preventDefault();
      return;
    }

    // Normal mode: detect if finger moved enough to cancel tap
    if (!isExploring && !pointerMoved) {
      var tdx = Math.abs(e.clientX - pointerStartX);
      var tdy = Math.abs(e.clientY - pointerStartY);
      if (tdx > TAP_THRESHOLD || tdy > TAP_THRESHOLD) {
        pointerMoved = true;
      }
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'mouse') return;
    if (!orbitWrapper) return;

    // Explore mode: finish swipe → calculate steps & animate
    if (mobilePointerActive) {
      mobilePointerActive = false;

      var totalDy = mobileTotalDy;
      var absDy = Math.abs(totalDy);

      // Steps from distance
      var stepsFromDistance = Math.floor(absDy / MOBILE_STEP_THRESHOLD);

      // Steps from velocity (fast flick → extra steps)
      var velocityPxPerSec = Math.abs(mobileVelocity) * 1000; // px/s
      var stepsFromVelocity = 0;
      if (velocityPxPerSec > 600)  stepsFromVelocity = 1;
      if (velocityPxPerSec > 1200) stepsFromVelocity = 2;
      if (velocityPxPerSec > 2000) stepsFromVelocity = 3;

      var steps = Math.max(stepsFromDistance, stepsFromVelocity);

      // At least one step if there was meaningful movement
      if (steps === 0 && absDy > MOBILE_STEP_THRESHOLD * 0.35) {
        steps = 1;
      }

      if (steps > 0) {
        steps = Math.min(steps, 4);

        // Direction: upward (negative dy) → advance to next product
        var direction = totalDy < 0 ? 1 : -1;

        // Calculate final target — single smooth tween, no per-step chaining
        var currentIdx = getSnappedIndex(currentRotation);
        var newIdx = (currentIdx + direction * steps + ITEM_COUNT) % ITEM_COUNT;
        var fa = computeFocusAngle();
        var targetRot = fa - newIdx * 36;

        // Normalise: shortest continuous path from currentRotation
        var diff = targetRot - currentRotation;
        diff = ((diff % 360) + 540) % 360 - 180;
        targetRot = currentRotation + diff;

        // Duration scales subtly with distance — longer sweep = slightly more time
        var duration = 0.50 + steps * 0.06;
        if (duration > 0.74) duration = 0.74;

        animateMobileToTarget(targetRot, duration);
      }
      return;
    }

    // Normal mode: tap (no drag) on orbit → enter explore mode
    if (!isExploring && !pointerMoved && orbitWrapper.contains(e.target) &&
        !(exploreExit && exploreExit.contains(e.target))) {
      enterExploreMode();
    }
  }

  // --- RESIZE ---

  var resizeTimeout;
  function onResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function () {
      updateRadius();
      if (isExploring) {
        getExploreParams();
        activeRadius = exploreRadius;
        orbitEl.style.left = 'calc(50% - ' + exploreOffsetX + 'px)';
        orbitEl.style.top = 'calc(50% + ' + exploreOffsetY + 'px)';
      }
      updateOrbitTransform(currentRotation);
    }, 150);
  }

  // --- CLICK (backup) ---

  function onClick(e) {
    if (exploreExit && exploreExit.contains(e.target) && isExploring) {
      e.preventDefault();
      exitExploreMode();
    }
    if (exploreHint && exploreHint.contains(e.target) && !isExploring) {
      e.preventDefault();
      enterExploreMode();
    }
  }

  // --- CONTEXT MENU (prevent on orbit images) ---

  function onContextMenu(e) {
    if (orbitWrapper && orbitWrapper.contains(e.target)) {
      e.preventDefault();
    }
  }

  function attachEvents() {
    // desktop wheel
    window.addEventListener('wheel', onWheel, { passive: false });
    // desktop mouse
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    // keyboard
    window.addEventListener('keydown', onKeyDown);
    // mobile pointer (unified touch)
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // click backup
    window.addEventListener('click', onClick);
    // resize
    window.addEventListener('resize', onResize);
    // prevent context menu on orbit
    window.addEventListener('contextmenu', onContextMenu);
  }

  // ----------------------------------------------------------
  // 12. HERO TEXT ANIMATION
  // ----------------------------------------------------------

  function animateHero() {
    if (typeof gsap === 'undefined') {
      var chars = document.querySelectorAll('.hero__char, .hero__amp');
      for (var c = 0; c < chars.length; c++) {
        chars[c].style.opacity = '1';
        chars[c].style.filter = 'blur(0px)';
      }
      var label = document.querySelector('.hero__label');
      var sub = document.querySelector('.hero__subtitle');
      var scroll = document.querySelector('.hero__scroll');
      if (label) label.style.opacity = '1';
      if (sub) { sub.style.opacity = '1'; sub.style.filter = 'blur(0px)'; sub.style.transform = 'translateY(0)'; }
      if (scroll) scroll.style.opacity = '1';
      return;
    }

    var tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

    tl.to('.hero__label', {
      opacity: 1,
      duration: 1.2
    }, 0);

    var chars = document.querySelectorAll('.hero__char, .hero__amp');
    tl.to(chars, {
      opacity: 1,
      filter: 'blur(0px)',
      duration: 0.9,
      stagger: 0.08,
      ease: 'power2.out'
    }, 0.3);

    tl.to('.hero__subtitle', {
      opacity: 1,
      filter: 'blur(0px)',
      y: 0,
      duration: 1.2
    }, 1.0);

    tl.to('.hero__scroll', {
      opacity: 1,
      duration: 1.0,
      onComplete: function () {
        var el = document.querySelector('.hero__scroll');
        if (el) el.classList.add('hero__scroll--breathing');
      }
    }, 1.5);
  }

  // ----------------------------------------------------------
  // 13. CARD-DEAL ANIMATION — slow, snap, one-by-one
  // ----------------------------------------------------------

  function playCardDeal() {
    if (cardDealPlayed) return;
    if (typeof gsap === 'undefined') return;
    if (items.length === 0) return;

    cardDealPlayed = true;

    var r = activeRadius;
    var baseW = Math.round(r * 0.38);
    var baseH = Math.round(baseW * 1.35);

    // origin: where the "deck" sits — top of the visible arc
    var originAngle = 320;
    var originRad = originAngle * DEG2RAD;
    var originX = Math.cos(originRad) * r;
    var originY = Math.sin(originRad) * r;

    // hide all items
    items.forEach(function (item) {
      item.style.opacity = '0';
      item.style.filter = 'blur(8px)';
      item.style.width = baseW + 'px';
      item.style.height = baseH + 'px';
    });

    // stagger deal: each card fans from the deck along the arc
    // slow: 0.9s per card, 0.15s stagger → ~2.2s total
    items.forEach(function (item, i) {
      var itemAngle = (i * 36 + currentRotation) % 360;
      if (itemAngle < 0) itemAngle += 360;
      var rad = itemAngle * DEG2RAD;
      var finalX = Math.cos(rad) * r;
      var finalY = Math.sin(rad) * r;

      gsap.fromTo(item,
        {
          opacity: 0,
          filter: 'blur(8px)',
          scale: 0.8,
          x: originX,
          y: originY
        },
        {
          opacity: 1,
          filter: 'blur(0px)',
          scale: 1,
          x: finalX,
          y: finalY,
          duration: 0.9,
          ease: 'back.out(1.08)',     // magnetic snap — gentle attraction
          delay: 0.4 + i * 0.14,      // 0.4s pause then stagger
          immediateRender: false,      // keep item at its current state during delay
          onUpdate: function () {
            var el = this.targets()[0];
            var gsX = gsap.getProperty(el, 'x');
            var gsY = gsap.getProperty(el, 'y');
            var gsScale = gsap.getProperty(el, 'scale');
            el.style.transform =
              'translate(calc(' + gsX.toFixed(2) + 'px - 50%), ' +
                          'calc(' + gsY.toFixed(2) + 'px - 50%)) ' +
              'scale(' + gsScale.toFixed(3) + ')';
          },
          onComplete: function () {
            updateOrbitTransform(currentRotation);
          }
        }
      );
    });
  }

  // ----------------------------------------------------------
  // 14. COLLECTION SCROLL-TRIGGERED ENTRANCE
  // ----------------------------------------------------------

  function initCollectionEntrance() {
    if (typeof gsap === 'undefined' || !gsap.registerPlugin) return;

    var collectionSection = document.getElementById('collection');
    var collectionHeader = document.querySelector('.collection__header');
    if (!collectionHeader) return;

    // header: fades in when collection is 35% visible
    gsap.set(collectionHeader, { y: 24 });
    gsap.to(collectionHeader, {
      opacity: 1,
      y: 0,
      duration: 1.4,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: collectionSection,
        start: 'top 65%',     // 35% visible
        once: true
      }
    });

    // card-deal: triggers after header, at ~40% visible
    if (orbitWrapper) {
      ScrollTrigger.create({
        trigger: collectionSection,
        start: 'top 60%',     // 40% visible
        once: true,
        onEnter: playCardDeal
      });
    }
  }

  // ----------------------------------------------------------
  // 15. INIT
  // ----------------------------------------------------------

  function init() {
    if (!orbitEl || !orbitWrapper) {
      console.error('ELVERE & LUNE: critical elements missing');
      return;
    }

    // Detect mobile device (for potential future mobile-only branches)
    isMobileDevice = ('ontouchstart' in window) ||
                     (navigator.maxTouchPoints > 0) ||
                     (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    buildOrbit();
    updateRadius();
    updateOrbitTransform(currentRotation);
    attachEvents();
    startAnimationLoop();

    if (typeof gsap !== 'undefined' && gsap.registerPlugin) {
      gsap.registerPlugin(ScrollTrigger);
      animateHero();
      initCollectionEntrance();
    } else {
      animateHero();
      cardDealPlayed = true;
      updateOrbitTransform(currentRotation);
      var ch = document.querySelector('.collection__header');
      if (ch) ch.style.opacity = '1';
    }

    console.log('ELVERE & LUNE — ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

/* ============================================================
   ELVERE & LUNE — SCRIPT
   Floating Oval Gallery
   ============================================================ */

import { createGhostCursor } from './components/GhostCursor/GhostCursor.js';
import { createLanyard } from './components/Lanyard/Lanyard.js';

(function() {
  'use strict';

  // ============================================================
  // 1. CONSTANTS
  // ============================================================

  var COLLECTION_ITEMS = [
    { image: 'images/product01.jpg', link: '#', title: 'Lune Pendant', description: 'Silver moonstone' },
    { image: 'images/product02.jpg', link: '#', title: 'Solar Band', description: 'Golden sunstone' },
    { image: 'images/product03.jpg', link: '#', title: 'Terra Bracelet', description: 'Earth-toned agate' },
    { image: 'images/product04.jpg', link: '#', title: 'Nova Ring', description: 'Starlight quartz' },
    { image: 'images/product05.jpg', link: '#', title: 'Ocean Drop', description: 'Deep blue lapis' },
    { image: 'images/product06.jpg', link: '#', title: 'Forest Talisman', description: 'Green malachite' },
    { image: 'images/product07.jpg', link: '#', title: 'Ember Earrings', description: 'Fire opal glow' },
    { image: 'images/product08.jpg', link: '#', title: 'Silk Strand', description: 'Pearl lustre' },
    { image: 'images/product09.jpg', link: '#', title: 'Dusk Choker', description: 'Twilight amethyst' },
    { image: 'images/product10.jpg', link: '#', title: 'Dawn Cuff', description: 'Rose quartz glow' }
  ];

  // Hero
  var HERO_AUTO_SPEED = 0.08;
  var HERO_TILT_LERP = 0.05;
  var HERO_TILT_MAX_X = 15;
  var HERO_TILT_MAX_Y = 8;
  var HERO_PARTICLE_COUNT_DESKTOP = 30;
  var HERO_PARTICLE_COUNT_MOBILE = 15;

  // ============================================================
  // 2. STATE
  // ============================================================

  var floatTime = 0;
  var lastFrameTime = 0;

  var infiniteMenu = null;

  // Hero
  var heroAutoAngle = 0;
  var heroTiltX = 0;
  var heroTiltY = 0;
  var heroTiltXCurr = 0;
  var heroTiltYCurr = 0;
  var heroParticlePool = [];
  var heroParticleCanvas = null;
  var heroParticleCtx = null;
  var heroRAF = null;
  var particleText = null;
  var particleBackground = null;
  var ghostCursor = null;
  var textType = null;
  var transitionBlack = null;
  var heroTransitioned = false;
  var currentSection = 0; // 0=hero, 1=guide, 2=collection
  var isTransitioning = false;
  var guideMistStarted = false;
  var guideTransitioned = false;
  var lanyard = null;
  var lanyardTriggered = false;

  // ============================================================
  // 3. DOM REFERENCES
  // ============================================================

  var infiniteMenuWrapper;
  var collectionHeader;
  var hero3d, heroProduct, heroProductImg, heroParticles, heroBrand, heroScroll;
  var guideSection, guideBg, guideText, collectionSection;

  // ============================================================
  // 4. INITIALIZATION
  // ============================================================

  function init() {
    collectionHeader = document.querySelector('.collection__header');

    hero3d = document.getElementById('hero3d');
    heroProduct = document.getElementById('heroProduct');
    heroProductImg = document.querySelector('.hero-3d__img');
    heroParticles = document.getElementById('heroParticles');
    heroBrand = document.getElementById('heroBrand');
    heroScroll = document.getElementById('heroScroll');
    guideSection = document.getElementById('guide');
    guideBg = document.getElementById('guideBg');
    guideText = document.getElementById('guideText');
    collectionSection = document.getElementById('collection');
    transitionBlack = document.getElementById('transitionBlack');

    initInfiniteMenu();

    initHero3D();
    initParticles();

    lastFrameTime = performance.now();
    startAnimationLoop();
    bindEvents();
    bindTransition();

    initParticleText();
    initGuide();

    if (typeof gsap !== 'undefined') {
      initGSAPAnimations();
    } else {
      showAllFallback();
    }
  }

  // ============================================================
  // 5. INFINITE MENU
  // ============================================================

  function initInfiniteMenu() {
    var wrapper = document.getElementById('infiniteMenuWrapper');
    if (!wrapper || typeof InfiniteMenu === 'undefined') return;
    infiniteMenuWrapper = wrapper;

    infiniteMenu = new InfiniteMenu({
      container: wrapper,
      items: COLLECTION_ITEMS,
      scale: 1.0
    });
  }

  // ============================================================
  // 6. rAF LOOP
  // ============================================================

  function startAnimationLoop() {
    function loop(now) {
      animateRAF = requestAnimationFrame(loop);
      floatTime += 0.016;
      var dt = now - (lastFrameTime || now);
      lastFrameTime = now;
      updateHeroProduct();
      // InfiniteMenu runs its own render loop;
    }
    var animateRAF = requestAnimationFrame(loop);
  }

  // ============================================================
  // 7. EVENT BINDING
  // ============================================================

  function bindEvents() {
    // Hero mouse/touch tilt
    hero3d.addEventListener('mousemove', onHeroMouseMove, { passive: true });
    hero3d.addEventListener('touchmove', onHeroTouchMove, { passive: true });
    hero3d.addEventListener('mouseleave', onHeroMouseLeave);
    hero3d.addEventListener('touchend', onHeroTouchEnd);

    // 第三页滚轮 → 触发挂牌彩蛋
    window.addEventListener('wheel', onWheel, { passive: true });

    // Resize
    var resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function() {
        if (particleText && particleText.resize) {
          particleText.resize();
        }
        if (particleBackground && particleBackground.resize) {
          particleBackground.resize();
        }
      }, 150);
    });
  }

  // ============================================================
  // 8. HERO 3D — TILT & AUTO-ROTATION
  // ============================================================

  function initHero3D() {
    // rAF drives rotation + tilt lerp
  }

  function updateHeroProduct() {
    if (!heroProduct) return;

    heroAutoAngle += HERO_AUTO_SPEED;
    if (heroAutoAngle > 360) heroAutoAngle -= 360;

    heroTiltXCurr += (heroTiltX - heroTiltXCurr) * HERO_TILT_LERP;
    heroTiltYCurr += (heroTiltY - heroTiltYCurr) * HERO_TILT_LERP;

    heroProduct.style.transform =
      'rotateY(' + heroAutoAngle.toFixed(1) + 'deg) ' +
      'rotateX(' + heroTiltXCurr.toFixed(1) + 'deg) ' +
      'rotateY(' + heroTiltYCurr.toFixed(1) + 'deg)';
  }

  function onHeroMouseMove(e) {
    var rect = hero3d.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var nx = (e.clientX - cx) / (rect.width / 2);
    var ny = (e.clientY - cy) / (rect.height / 2);
    nx = Math.max(-1, Math.min(1, nx));
    ny = Math.max(-1, Math.min(1, ny));
    heroTiltX = -ny * HERO_TILT_MAX_X;
    heroTiltY = nx * HERO_TILT_MAX_Y;
  }

  function onHeroTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    var touch = e.touches[0];
    var rect = hero3d.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var nx = (touch.clientX - cx) / (rect.width / 2);
    var ny = (touch.clientY - cy) / (rect.height / 2);
    nx = Math.max(-1, Math.min(1, nx));
    ny = Math.max(-1, Math.min(1, ny));
    heroTiltX = -ny * HERO_TILT_MAX_X;
    heroTiltY = nx * HERO_TILT_MAX_Y;
  }

  function onHeroMouseLeave() {
    heroTiltX = 0;
    heroTiltY = 0;
  }

  function onHeroTouchEnd() {
    heroTiltX = 0;
    heroTiltY = 0;
  }

  // ── 第三页滚轮彩蛋：触发左上角挂牌 ──
  function onWheel(e) {
    // 只在第三页（collection）触发
    if (currentSection !== 2) return;
    if (lanyardTriggered) return;
    lanyardTriggered = true;
    if (!lanyard) {
      lanyard = createLanyard({});
    }
    lanyard.trigger();
  }

  // ============================================================
  // 9. PARTICLE CANVAS
  // ============================================================

  function initParticles() {
    heroParticleCanvas = heroParticles;
    if (!heroParticleCanvas) return;
    heroParticleCtx = heroParticleCanvas.getContext('2d');
    resizeParticleCanvas();

    var count = window.innerWidth <= 600
      ? HERO_PARTICLE_COUNT_MOBILE
      : HERO_PARTICLE_COUNT_DESKTOP;

    heroParticlePool = [];
    for (var i = 0; i < count; i++) {
      heroParticlePool.push(spawnParticle(true));
    }
  }

  function resizeParticleCanvas() {
    if (!heroParticleCanvas) return;
    var rect = heroParticleCanvas.parentElement.getBoundingClientRect();
    heroParticleCanvas.width = rect.width;
    heroParticleCanvas.height = rect.height;
  }

  function spawnParticle(randomY) {
    var w = heroParticleCanvas ? heroParticleCanvas.width : 400;
    var h = heroParticleCanvas ? heroParticleCanvas.height : 600;
    return {
      x: Math.random() * w,
      y: randomY ? Math.random() * h : h + 10,
      size: Math.random() * 1.8 + 0.4,
      speed: Math.random() * 0.3 + 0.06,
      opacity: Math.random() * 0.5 + 0.15,
      life: Math.random() * 0.6 + 0.4
    };
  }

  function updateParticles() {
    if (!heroParticleCanvas) return;
    var h = heroParticleCanvas.height;
    for (var i = 0; i < heroParticlePool.length; i++) {
      var p = heroParticlePool[i];
      p.y -= p.speed;
      p.life -= 0.002;
      if (p.y < -10 || p.life <= 0) {
        heroParticlePool[i] = spawnParticle(false);
      }
    }
  }

  function drawParticles() {
    if (!heroParticleCtx || !heroParticleCanvas) return;
    var ctx = heroParticleCtx;
    var w = heroParticleCanvas.width;
    var h = heroParticleCanvas.height;
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < heroParticlePool.length; i++) {
      var p = heroParticlePool[i];
      if (p.y < -10 || p.y > h + 10) continue;
      if (p.x < -10 || p.x > w + 10) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (p.opacity * Math.max(0, p.life)).toFixed(2) + ')';
      ctx.fill();
    }
  }

  // ============================================================
  // 10. GSAP ANIMATIONS
  // ============================================================

  function initGSAPAnimations() {
    if (typeof ScrollTrigger !== 'undefined') {
      gsap.registerPlugin(ScrollTrigger);
    }

    animateHeroBrand();

    // Collection header 由球入场动画结束后（onIntroDone）触发显示，此处不再用 ScrollTrigger
  }

  function animateHeroBrand() {
    if (!heroBrand) return;

    var label = heroBrand.querySelector('.hero-3d__label');
    var subtitle = heroBrand.querySelector('.hero-3d__subtitle');
    // Note: .hero-3d__title is handled by ParticleText — do NOT animate it here

    var tl = gsap.timeline({
      onComplete: function() {
        if (heroScroll) {
          gsap.to(heroScroll, { opacity: 1, duration: 1.0, ease: 'power2.out',
            onComplete: function() {
              heroScroll.classList.add('hero-3d__scroll--breathing');
            }
          });
        }
      }
    });

    // Label appears first (particles are scattering during this time)
    if (label) {
      tl.fromTo(label, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power2.out' });
    }
    // Subtitle appears as particles near full gather (~1.5s in)
    if (subtitle) {
      tl.fromTo(subtitle,
        { opacity: 0, filter: 'blur(4px)', y: 12 },
        { opacity: 1, filter: 'blur(0px)', y: 0, duration: 1.2, ease: 'power2.out' },
        '-=0.3');
    }
  }

  // ----------------------------------------------------------
  // ParticleText initialization
  // ----------------------------------------------------------

  function initParticleText() {
    if (!heroBrand || typeof ParticleText === 'undefined') return;

    // Init background crystal-dust particles (z-index: 2)
    if (typeof ParticleBackground !== 'undefined') {
      particleBackground = new ParticleBackground({
        container: hero3d,
        zIndex: 2,
        particleCountDesktop: 350,
        particleCountMobile: 150,
        repelRadius: 180,
        repelStrength: 30
      });
    }

    // Init brand text particles (z-index: 3 via component default)
    // fontSize auto-calculated by component: 240 desktop / 85 mobile
    particleText = new ParticleText({
      container: hero3d,
      text: 'ELVERE & LUNE',
      particleSize: 2,
      density: 3,
      color: '#EDE1CF',
      highlightColor: '#E5D9C5',
      scatter: 300,
      gatherDuration: 2000,
      stagger: 600,
      pointerRepel: 40,
      repelRadius: 120,
      idleDrift: 0.7,
      fontSize: 'clamp(3rem, 12vw, 8rem)',
      fontWeight: 800,
      fontFamily: 'Cormorant Garamond, Georgia, Times New Roman, serif',
      glow: true
    });
  }

  function initGuide() {
    if (!guideSection || !guideBg || !guideText) return;

    // ── GhostCursor mist — created later via startGuideMist() (2s after transition) ──
    // (Fragment shader: domain-warped FBM blob + trail ring buffer + UnrealBloomPass.)

    // ── TextType — sequential two-line English typing (started after mist fades in) ──
    if (typeof TextType !== 'undefined') {
      textType = new TextType({
        container: guideText,
        text: ['Welcome to ELVERE & LUNE', 'click to begin...'],
        typingSpeed: 100,
        initialDelay: 500,
        pauseDuration: 800,
        sequential: true,
        loop: false,
        showCursor: true,
        cursorCharacter: '|',
        autoStart: false,
        onComplete: function() { showGuideHint(); }
      });
    }

    // Text is static dark metal — no cursor interaction, no glow
  }

  // ============================================================
  // Transition — hero → guide (left click)
  // ============================================================

  function bindTransition() {
    if (!hero3d) return;
    hero3d.addEventListener('click', onHeroClick);
  }

  function onHeroClick() {
    if (isTransitioning || heroTransitioned) return;
    transitionToGuide();
  }

  function transitionToGuide() {
    isTransitioning = true;
    heroTransitioned = true;

    // 1. Background gradually → black (CSS transition 1s)
    if (transitionBlack) {
      transitionBlack.style.opacity = '1';
    }

    // 1.5 品牌文字上下两句（label + subtitle）先虚化消失
    fadeOutBrandLines();

    var finish = function() {
      // 2. 切换：隐藏 hero，显示 guide（黑屏遮罩下完成）
      if (hero3d) hero3d.style.visibility = 'hidden';
      if (guideSection) guideSection.style.visibility = 'visible';
      currentSection = 1;
      isTransitioning = false;

      // 3. Reveal guide's black background
      setTimeout(function() {
        if (transitionBlack) transitionBlack.style.opacity = '0';
      }, 300);

      // 4. Mist appears 2s later
      setTimeout(startGuideMist, 2000);
    };

    // 2. 虚化完成后，粒子再下落（fall() runs ~2.2s then calls finish）
    setTimeout(function() {
      if (particleText && particleText.fall) {
        particleText.fall(finish);
      } else {
        setTimeout(finish, 1200);
      }
    }, 550);
  }

  function fadeOutBrandLines() {
    if (!heroBrand) return;
    var label = heroBrand.querySelector('.hero-3d__label');
    var subtitle = heroBrand.querySelector('.hero-3d__subtitle');
    [label, subtitle].forEach(function(el) {
      if (!el) return;
      el.style.transition = 'opacity 0.6s ease, filter 0.6s ease';
      el.style.opacity = '0';
      el.style.filter = 'blur(6px)';
    });
  }

  function startGuideMist() {
    if (guideMistStarted) return;
    guideMistStarted = true;
    if (typeof createGhostCursor !== 'undefined' && !ghostCursor) {
      ghostCursor = createGhostCursor(guideBg, {
        color: '#B497CF',
        brightness: 1.5,
        bloomStrength: 0.3,
        bloomRadius: 1.5,
        bloomThreshold: 0.01,
        fadeInDuration: 2500
      });
      // Start typing after the mist has faded in
      setTimeout(function() {
        if (textType && !textType._started) {
          textType.start(500);
        }
      }, 2600);
    }
  }

  function showGuideHint() {
    if (!guideText || guideText.classList.contains('guide__text--clickable')) return;
    guideText.classList.add('guide__text--clickable');
    // 绑定点击（打完后允许点击文字触发切换）
    if (!guideText._bound) {
      guideText._bound = true;
      guideText.addEventListener('click', onGuideHintClick);
    }
  }

  function onGuideHintClick() {
    if (isTransitioning || guideTransitioned) return;
    guideTransitioned = true;
    isTransitioning = true;

    // 1. 光标光（迷雾）逐渐消失
    if (ghostCursor && ghostCursor.fadeOut) {
      ghostCursor.fadeOut(1200);
    }

    // 2. 黑屏
    if (transitionBlack) {
      transitionBlack.style.opacity = '1';
    }

    // 3. 切到 collection：隐藏 guide，显示 collection
    setTimeout(function() {
      if (guideSection) guideSection.style.visibility = 'hidden';
      if (collectionSection) collectionSection.style.visibility = 'visible';
      currentSection = 2;
      isTransitioning = false;

      // 4. 黑屏淡出
      setTimeout(function() {
        if (transitionBlack) transitionBlack.style.opacity = '0';
      }, 300);

      // 5. 3D 球照片逐张出现 → 旋转 → 最后回调显示标题
      if (infiniteMenu && infiniteMenu.startSequence) {
        infiniteMenu.startSequence(showCollectionHeader);
      } else {
        showCollectionHeader();
      }
    }, 1400);
  }

  function showCollectionHeader() {
    if (!collectionHeader) return;
    if (typeof gsap !== 'undefined') {
      gsap.to(collectionHeader, { opacity: 1, y: 0, duration: 1.2, ease: 'power2.out', overwrite: 'auto' });
    } else {
      collectionHeader.style.opacity = '1';
      collectionHeader.style.transform = 'none';
    }
  }

  function showAllFallback() {
    // No GSAP — show everything immediately (title managed by ParticleText)
    if (heroBrand) {
      var label = heroBrand.querySelector('.hero-3d__label');
      var subtitle = heroBrand.querySelector('.hero-3d__subtitle');
      // .hero-3d__title is hidden by ParticleText — don't reveal it
      if (label) label.style.opacity = '1';
      if (subtitle) { subtitle.style.opacity = '1'; subtitle.style.filter = 'none'; subtitle.style.transform = 'none'; }
    }
    if (heroScroll) {
      heroScroll.style.opacity = '1';
      heroScroll.classList.add('hero-3d__scroll--breathing');
    }
    if (collectionHeader) {
      collectionHeader.style.opacity = '1';
      collectionHeader.style.transform = 'none';
    }
    // Gallery items visible by default — no orbit transform needed
  }

  // ============================================================
  // 11. STARTUP
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

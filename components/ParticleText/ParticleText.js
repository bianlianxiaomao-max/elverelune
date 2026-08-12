/**
 * ParticleText — ReactBits original + fullscreen ambient-particle layer.
 *
 * Two-layer particle system on one Canvas:
 *   Layer 1: Text particles → sampled from text glyphs, scatter→gather→idle
 *   Layer 2: Ambient particles → distributed across full viewport, gentle drift
 * Both layers respond to pointer repel independently.
 *
 * Usage:
 *   var pt = new ParticleText({
 *     container: document.getElementById('hero3d'),
 *     text: 'ELVERE & LUNE',
 *     color: '#D8C3A5',
 *     highlightColor: '#C9B896',
 *     scatter: 300,           // min scatter px (scales with viewport)
 *     gatherDuration: 2000,
 *     stagger: 600,
 *   });
 */
(function(global) {
  'use strict';

  function hexToRgb(hex) {
    var clean = hex.replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  function mixRgb(from, to, amount) {
    return {
      r: Math.round(from.r + (to.r - from.r) * amount),
      g: Math.round(from.g + (to.g - from.g) * amount),
      b: Math.round(from.b + (to.b - from.b) * amount)
    };
  }

  function rgbToCss(rgb) { return 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')'; }
  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  var DEFAULTS = {
    text: 'ELVERE & LUNE',
    particleSize: 2,
    density: 4,
    color: '#D8C3A5',
    highlightColor: '#C9B896',
    ambientColor: '#E8D9C5',
    scatter: 300,
    gatherDuration: 2000,
    stagger: 600,
    pointerRepel: 40,
    repelRadius: 120,
    idleDrift: 0.7,
    glow: true,
    fontSize: 'clamp(3rem, 12vw, 8rem)',
    fontWeight: 800,
    fontFamily: 'Cormorant Garamond, Georgia, Times New Roman, serif',
    ambientCountDesktop: 200,
    ambientCountMobile: 80
  };

  function ParticleText(options) {
    var self = this;
    if (!options || !options.container) return;

    self.opts = {};
    Object.keys(DEFAULTS).forEach(function(k) {
      self.opts[k] = (options[k] !== undefined) ? options[k] : DEFAULTS[k];
    });

    self.container = options.container;
    self.particles = [];
    self.af = null;
    self.destroyed = false;
    self.gathering = false;
    self.gatherStart = 0;
    self.width = 0;
    self.height = 0;
    self.dpr = 1;
    self.buildId = 0;

    self.pointer = { active: false, x: 0, y: 0, smoothX: 0, smoothY: 0 };
    self.falling = false;
    self.fallStart = 0;
    self.paused = false;
    self._onFallComplete = null;
    self.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    self._isMobile = window.innerWidth <= 600;
    self.fontScale = 1;
    self.effParticleSize = self.opts.particleSize;

    // ── DOM ──
    self.wrapper = document.createElement('div');
    self.wrapper.className = 'particle-text';
    self.wrapper.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden;';

    self.canvas = document.createElement('canvas');
    self.canvas.className = 'particle-text__canvas';
    self.canvas.setAttribute('aria-hidden', 'true');
    self.canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:auto;';
    self.wrapper.appendChild(self.canvas);

    self.container.style.position = self.container.style.position || 'relative';
    self.container.appendChild(self.wrapper);

    self.ctx = self.canvas.getContext('2d', { willReadFrequently: true });
    if (!self.ctx) return;

    // ── Events ──
    self._onPointerMove = function(e) {
      var rect = self.canvas.getBoundingClientRect();
      self.pointer.x = e.clientX - rect.left;
      self.pointer.y = e.clientY - rect.top;
      self.pointer.active = true;
    };
    self._onPointerLeave = function() { self.pointer.active = false; };
    self.canvas.addEventListener('pointermove', self._onPointerMove);
    self.canvas.addEventListener('pointerleave', self._onPointerLeave);

    self._sample();
    self._ro = new ResizeObserver(function() { self._sample(); });
    self._ro.observe(self.container);
  }

  // ─────────────────────────────────────────────────────────────
  // _sample — text sampling + ambient particle generation
  // ─────────────────────────────────────────────────────────────

  ParticleText.prototype._sample = function() {
    var self = this;
    var buildId = ++self.buildId;
    var rect = self.container.getBoundingClientRect();
    self.width = Math.floor(rect.width);
    self.height = Math.floor(rect.height);
    if (self.width <= 0 || self.height <= 0) return;

    self.dpr = Math.min(window.devicePixelRatio || 1, 3);
    self.canvas.width = Math.max(1, Math.floor(self.width * self.dpr));
    self.canvas.height = Math.max(1, Math.floor(self.height * self.dpr));
    self.ctx.setTransform(self.dpr, 0, 0, self.dpr, 0, 0);

    self._isMobile = window.innerWidth <= 600;

    // ── Dynamic scatter (viewport-aware, min 300px) ──
    var viewportDiagonal = Math.sqrt(self.width * self.width + self.height * self.height);
    var dynamicScatter = Math.max(self.opts.scatter, viewportDiagonal * 0.35);
    var scatter = self.reducedMotion ? 0 : dynamicScatter;

    var family = self.opts.fontFamily;
    var fontWeight = self.opts.fontWeight;
    var fontSizeStr = self.opts.fontSize;
    var fontSize = typeof fontSizeStr === 'number' ? fontSizeStr : 96;

    if (typeof fontSizeStr === 'string') {
      var probe = document.createElement('span');
      probe.textContent = 'M';
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;font-size:' + fontSizeStr + ';font-weight:' + fontWeight + ';font-family:' + family;
      self.container.appendChild(probe);
      fontSize = parseFloat(window.getComputedStyle(probe).fontSize) || 96;
      probe.remove();
    }

    var font = fontWeight + ' ' + fontSize + 'px ' + family;

    // ── Offscreen text sampling ──
    var off = document.createElement('canvas');
    var offCtx = off.getContext('2d', { willReadFrequently: true });
    var content = String(self.opts.text || ' ');
    var maxW = self.width * 0.92;
    offCtx.font = font;
    var metrics = offCtx.measureText(content);
    var measuredW = Math.max(1, metrics.width);
    if (measuredW > maxW) {
      fontSize = Math.max(18, fontSize * (maxW / measuredW));
      font = fontWeight + ' ' + fontSize + 'px ' + family;
      offCtx.font = font;
      metrics = offCtx.measureText(content);
    }

    // 字号缩放因子：PC 基准 128px，手机字号小则等比缩小粒子尺寸/采样步长/光晕，保证视觉一致
    self.fontScale = Math.max(0.3, Math.min(1.2, fontSize / 128));
    self.effParticleSize = self.opts.particleSize * self.fontScale;

    var left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
    var right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width);
    var ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSize * 0.78);
    var descent = Math.ceil(metrics.actualBoundingBoxDescent || fontSize * 0.22);
    var pad = Math.max(12, Math.ceil(fontSize * 0.08));
    var textW = Math.max(1, left + right);
    var textH = Math.max(1, ascent + descent);

    off.width = textW + pad * 2;
    off.height = textH + pad * 2;
    offCtx.clearRect(0, 0, off.width, off.height);
    offCtx.font = font;
    offCtx.textAlign = 'left';
    offCtx.textBaseline = 'alphabetic';
    offCtx.fillStyle = '#ffffff';
    offCtx.fillText(content, pad - left, pad + ascent);

    var img = offCtx.getImageData(0, 0, off.width, off.height);
    var targets = [];
    // 采样步长随字号等比缩放：PC 3px @128px 字号 ≈ 手机 1px @47px 字号
    var step = Math.max(1, Math.round(Math.max(2, Math.floor(self.opts.density)) * self.fontScale));
    for (var y = 0; y < off.height; y += step) {
      for (var x = 0; x < off.width; x += step) {
        var a = img.data[(y * off.width + x) * 4 + 3];
        if (a > 40) {
          targets.push({
            x: self.width / 2 - off.width / 2 + x,
            y: self.height / 2 - off.height / 2 + y,
            alpha: a / 255
          });
        }
      }
    }

    // ── Text particles ──
    var maxParticles = Math.max(900, Math.min(5200, Math.floor((self.width * self.height) / 90)));
    var stride = Math.max(1, Math.ceil(targets.length / maxParticles));
    var baseRgb = hexToRgb(self.opts.color) || { r: 216, g: 195, b: 165 };
    var highlightRgb = hexToRgb(self.opts.highlightColor) || { r: 201, g: 184, b: 150 };
    var selected = targets.filter(function(_, i) { return i % stride === 0; });

    var textParticles = selected.map(function(t, i) {
      var seed = Math.random();
      var depth = 0.3 + Math.random() * 0.7;
      var blend = clamp(t.x / Math.max(1, self.width) + (seed - 0.5) * 0.35, 0, 1);
      var pColor = rgbToCss(mixRgb(baseRgb, highlightRgb, blend));
      var angle = seed * Math.PI * 2;
      var dist = scatter * (0.35 + depth * 0.75);
      var sx = t.x + Math.cos(angle) * dist + (seed - 0.5) * scatter * 0.45;
      var sy = t.y + Math.sin(angle) * dist + (depth - 0.9) * scatter * 0.45;

      // Add jitter to target so text particles don't sit on a sampling grid（随字号缩放）
      var jitterAmp = 5 * self.fontScale;
      var jitterX = (Math.random() - 0.5) * jitterAmp;
      var jitterY = (Math.random() - 0.5) * jitterAmp;

      return {
        x: sx, y: sy, startX: sx, startY: sy,
        targetX: t.x + jitterX, targetY: t.y + jitterY,
        size: Math.max(0.5, self.effParticleSize * (0.8 + Math.random() * 1.6)),
        color: pColor, seed: seed, depth: depth,
        delay: Math.random() * self.opts.stagger,
        isAmbient: false
      };
    });

    // ── Ambient particles — full-viewport starfield ──
    var ambientRgb = hexToRgb(self.opts.ambientColor) || baseRgb;
    var ambientCount = self._isMobile
      ? self.opts.ambientCountMobile
      : self.opts.ambientCountDesktop;
    // Scale count by viewport area so it always looks dense enough
    var areaFactor = Math.min(2, Math.max(0.6, (self.width * self.height) / (1440 * 900)));
    ambientCount = Math.round(ambientCount * areaFactor);

    var ambientParticles = [];
    for (var ai = 0; ai < ambientCount; ai++) {
      // Use Math.random() for organic, non-grid-like distribution
      var aseed = Math.random();
      var adepth = 0.08 + Math.random() * 0.35;
      var ax = Math.random() * self.width;
      var ay = Math.random() * self.height;
      var aColor = rgbToCss(mixRgb(ambientRgb, highlightRgb, 0.1 + Math.random() * 0.5));

      // Start from a slightly scattered position, gently float
      var sx = ax + (Math.random() - 0.5) * 120;
      var sy = ay + (Math.random() - 0.5) * 120;

      ambientParticles.push({
        x: sx, y: sy,
        startX: sx, startY: sy,
        targetX: ax, targetY: ay,
        size: self.effParticleSize * (0.7 + Math.random() * 2.0),
        color: aColor,
        seed: aseed,
        depth: adepth,
        delay: Math.random() * self.opts.stagger * 0.3,
        isAmbient: true
      });
    }

    // ── Combine ──
    self.particles = textParticles.concat(ambientParticles);

    self.pointer.x = self.width / 2;
    self.pointer.y = self.height / 2;
    self.pointer.smoothX = self.pointer.x;
    self.pointer.smoothY = self.pointer.y;

    // Dramatic initial gather from scatter positions
    self._startGather(true);

    if (self.buildId !== buildId) return;
    self._ensureLoop();
  };

  // ─────────────────────────────────────────────────────────────
  // _startGather — scatter→gather for all particles
  // ─────────────────────────────────────────────────────────────

  ParticleText.prototype._startGather = function(fromScatter) {
    var self = this;
    if (!self.particles.length) return;
    var now = performance.now();
    var rect = self.container.getBoundingClientRect();
    var vpDiagonal = Math.sqrt(rect.width * rect.width + rect.height * rect.height);
    var dynamicScatter = Math.max(self.opts.scatter, vpDiagonal * 0.35);
    var scatter = self.reducedMotion ? 0 : dynamicScatter;

    self.particles.forEach(function(p) {
      if (fromScatter && !p.isAmbient) {
        // Only scatter text particles — ambient stay at home
        var angle = p.seed * Math.PI * 2;
        var dist = scatter * (0.35 + p.depth * 0.75);
        p.x = p.targetX + Math.cos(angle) * dist + (p.depth - 0.5) * scatter * 0.55;
        p.y = p.targetY + Math.sin(angle) * dist + (p.seed - 0.5) * scatter * 0.55;
      }
      p.startX = p.x;
      p.startY = p.y;
      // Ambient particles: no delay, appear instantly
      p.delay = p.isAmbient ? 0 : (self.reducedMotion ? 0 : p.seed * self.opts.stagger);
    });
    self.gatherStart = now;
    self.gathering = true;
  };

  // ─────────────────────────────────────────────────────────────
  // Loop helpers
  // ─────────────────────────────────────────────────────────────

  ParticleText.prototype._ensureLoop = function() {
    var self = this;
    if (self.af === null) {
      self.af = requestAnimationFrame(self._render.bind(self));
    }
  };

  // ─────────────────────────────────────────────────────────────
  // _render — two-layer: text particles gather + ambient drift
  // ─────────────────────────────────────────────────────────────

  ParticleText.prototype._render = function(now) {
    var self = this;
    if (self.destroyed) return;
    self.af = requestAnimationFrame(self._render.bind(self));

    // ── Falling transition (gravity drop + fade) — added, does not touch normal flow ──
    if (self.falling) {
      self._renderFall(now);
      return;
    }

    self.ctx.clearRect(0, 0, self.width, self.height);

    if (self.opts.glow && !self.reducedMotion) {
      self.ctx.shadowBlur = self.effParticleSize * 3;
      self.ctx.shadowColor = self.opts.highlightColor;
    } else {
      self.ctx.shadowBlur = 0;
    }

    self.pointer.smoothX += (self.pointer.x - self.pointer.smoothX) * 0.18;
    self.pointer.smoothY += (self.pointer.y - self.pointer.smoothY) * 0.18;

    var complete = true;
    var repel = self.opts.pointerRepel;
    var radius = self.opts.repelRadius;
    var t = now * 0.001;

    // ═══ Draw ambient particles first (subtle glow, organic drift) ═══
    // Save + reduce blur for ambient (softer background)
    var savedBlur = self.ctx.shadowBlur;
    self.ctx.shadowBlur = self.effParticleSize * 1.5;
    for (var ai = 0; ai < self.particles.length; ai++) {
      var pa = self.particles[ai];
      if (!pa.isAmbient) continue;

      var abx = pa.targetX;
      var aby = pa.targetY;

      // Ambient gather (shorter duration, or skip if already gathered)
      if (self.gathering) {
        var alocal = (now - self.gatherStart - pa.delay) / Math.max(1, self.reducedMotion ? 1 : self.opts.gatherDuration * 1.5);
        var aprogress = clamp(alocal, 0, 1);
        if (aprogress < 1) complete = false; // ambient contributes to gather complete
        var aeased = easeOutCubic(aprogress);
        abx = pa.startX + (pa.targetX - pa.startX) * aeased;
        aby = pa.startY + (pa.targetY - pa.startY) * aeased;
      } else if (!self.reducedMotion) {
        // Gentle cosmic drift
        abx += Math.sin(t * 0.35 + pa.seed * 9) * self.opts.idleDrift * 0.6 * pa.depth;
        aby += Math.cos(t * 0.28 + pa.depth * 9) * self.opts.idleDrift * 0.6 * pa.depth;
      }

      // Mouse repel (ambient responds too, but softer)
      if (self.pointer.active && !self.reducedMotion && repel > 0 && radius > 0) {
        var adx = abx - self.pointer.smoothX;
        var ady = aby - self.pointer.smoothY;
        var adist = Math.sqrt(adx * adx + ady * ady);
        if (adist > 0 && adist < radius) {
          var aforce = Math.pow(1 - adist / radius, 2) * repel;
          abx += (adx / adist) * aforce;
          aby += (ady / adist) * aforce;
        }
      }

      var afollow = self.reducedMotion ? 1 : 0.15;
      pa.x += (abx - pa.x) * afollow;
      pa.y += (aby - pa.y) * afollow;

      // Ambient alpha: subtle, depth-driven
      self.ctx.globalAlpha = clamp(0.06 + pa.depth * 0.18, 0.04, 0.25);

      drawParticle(self.ctx, pa);
    }

    // ═══ Draw text particles on top (boosted blur for soft fusion) ═══
    self.ctx.shadowBlur = self.effParticleSize * 8;
    for (var ti = 0; ti < self.particles.length; ti++) {
      var p = self.particles[ti];
      if (p.isAmbient) continue;

      var bx = p.targetX;
      var by = p.targetY;
      var progress = 1;

      if (self.gathering) {
        var local = (now - self.gatherStart - p.delay) / Math.max(1, self.reducedMotion ? 1 : self.opts.gatherDuration);
        progress = clamp(local, 0, 1);
        var eased = easeOutCubic(progress);
        bx = p.startX + (p.targetX - p.startX) * eased;
        by = p.startY + (p.targetY - p.startY) * eased;
        if (progress < 1) complete = false;
      } else if (!self.reducedMotion && self.opts.idleDrift > 0) {
        var dt = t;
        // Increased drift amplitude for organic feel, different freq for text
        bx += Math.sin(dt * 0.6 + p.seed * 10) * self.opts.idleDrift * 1.5 * p.depth;
        by += Math.cos(dt * 0.5 + p.depth * 10) * self.opts.idleDrift * 1.5 * p.depth;
      }

      // Mouse repel — text particles respond
      if (self.pointer.active && !self.reducedMotion && repel > 0 && radius > 0) {
        var dx = bx - self.pointer.smoothX;
        var dy = by - self.pointer.smoothY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0 && dist < radius) {
          var force = Math.pow(1 - dist / radius, 2) * repel;
          bx += (dx / dist) * force;
          by += (dy / dist) * force;
        }
      }

      var follow = self.reducedMotion ? 1 : 0.22;
      p.x += (bx - p.x) * follow;
      p.y += (by - p.y) * follow;

      // Text alpha: unified with ambient — subtle, depth-driven
      self.ctx.globalAlpha = clamp(0.08 + progress * 0.22 + p.depth * 0.10, 0.06, 0.35);

      drawParticle(self.ctx, p);
    }

    self.ctx.globalAlpha = 1;
    self.ctx.shadowBlur = savedBlur;

    if (self.gathering && complete) {
      self.gathering = false;
    }
  };

  // ─────────────────────────────────────────────────────────────
  // drawParticle — small rect or circle
  // ─────────────────────────────────────────────────────────────

  function drawParticle(ctx, p) {
    if (p.size <= 2.1) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  ParticleText.prototype.resize = function() {
    this._sample();
  };

  // Gravity fall transition — particles drop down and fade out
  ParticleText.prototype.fall = function(onComplete) {
    var self = this;
    if (self.falling || self.destroyed) return;
    self.falling = true;
    self.fallStart = performance.now();
    self._onFallComplete = onComplete || null;
    self.gathering = false;
    // Give each particle a fall velocity + gravity (stored on particle)
    self.particles.forEach(function(p) {
      p.vy = Math.random() * 0.4;                  // gentle initial downward velocity
      p.gravity = 0.03 + Math.random() * 0.025;    // slow acceleration — long graceful fall
      p.vx = (Math.random() - 0.5) * 0.5;          // slight horizontal drift
    });
    self._ensureLoop();
  };

  ParticleText.prototype._renderFall = function(now) {
    var self = this;
    var elapsed = now - self.fallStart;
    var progress = Math.min(1, elapsed / 4200);

    self.ctx.clearRect(0, 0, self.width, self.height);
    self.ctx.shadowBlur = 0;

    var allGone = true;
    for (var i = 0; i < self.particles.length; i++) {
      var p = self.particles[i];
      p.vy += p.gravity;
      p.y += p.vy;
      p.x += p.vx;
      if (p.y < self.height + 80) allGone = false;
      // Fade out as they fall
      var alpha = Math.max(0, 1 - progress);
      self.ctx.globalAlpha = alpha * (p.isAmbient ? 0.2 : 0.35);
      drawParticle(self.ctx, p);
    }
    self.ctx.globalAlpha = 1;

    if (allGone || progress >= 1) {
      self.falling = false;
      self.ctx.clearRect(0, 0, self.width, self.height);
      if (self._onFallComplete) {
        var cb = self._onFallComplete;
        self._onFallComplete = null;
        cb();
      }
    }
  };

  ParticleText.prototype.pause = function() {
    var self = this;
    self.paused = true;
    if (self.af) { cancelAnimationFrame(self.af); self.af = null; }
  };

  ParticleText.prototype.resume = function() {
    var self = this;
    if (!self.paused || self.destroyed) return;
    self.paused = false;
    self._ensureLoop();
  };

  ParticleText.prototype.destroy = function() {
    var self = this;
    self.destroyed = true;
    self.buildId += 1;
    if (self.af) cancelAnimationFrame(self.af);
    self._ro.disconnect();
    self.canvas.removeEventListener('pointermove', self._onPointerMove);
    self.canvas.removeEventListener('pointerleave', self._onPointerLeave);
    if (self.wrapper.parentNode) self.wrapper.parentNode.removeChild(self.wrapper);
  };

  // ─────────────────────────────────────────────────────────────
  // Export
  // ─────────────────────────────────────────────────────────────

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParticleText;
  } else {
    global.ParticleText = ParticleText;
  }
})(typeof window !== 'undefined' ? window : this);

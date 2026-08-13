/* ============================================================
   ParticleBackground — Luxury Crystal-Dust Background
   ELVERE & LUNE

   Canvas-based floating particle system with Z-depth parallax,
   mouse-repel interaction, and warm champagne-toned glow.

   Reference: Cartier jewelry cinematography, spatial depth,
   crystal-fragment light scattering. NOT tech-SaaS sparkles.

   Usage:
     var bg = new ParticleBackground({
       container: document.getElementById('hero3d'),
       zIndex: 2,
       particleCountDesktop: 250,
       particleCountMobile: 120,
       repelRadius: 180,
       repelStrength: 30
     });
   ============================================================ */

(function(global) {
  'use strict';

  // ----------------------------------------------------------
  // Default configuration
  // ----------------------------------------------------------

  var DEFAULTS = {
    zIndex: 2,
    particleCountDesktop: 250,
    particleCountMobile: 120,
    repelRadius: 180,         // px — mouse repel influence radius
    repelStrength: 30,        // px — max push force
    depthLayers: 3,           // number of parallax depth layers
    // Depth-layer particle distribution (far / mid / near)
    depthDistribution: [0.55, 0.30, 0.15],
    // Color palette — warm champagne / ivory / soft gold only
    colors: [
      '#F5EEDC',  // warm cream
      '#D8C3A5',  // champagne gold
      '#E8D9C5',  // soft warm beige
      '#C9B896',  // aged gold
      '#F0E8DA'   // light cream
    ]
  };

  // ----------------------------------------------------------
  // Constructor
  // ----------------------------------------------------------

  function ParticleBackground(options) {
    var self = this;

    self.opts = {};
    Object.keys(DEFAULTS).forEach(function(key) {
      self.opts[key] = (options && options[key] !== undefined) ? options[key] : DEFAULTS[key];
    });

    self.container = options && options.container;
    if (!self.container) {
      console.warn('ParticleBackground: container element required');
      return;
    }

    // State
    self.canvas = null;
    self.ctx = null;
    self.dpr = 1;
    self.displayW = 0;
    self.displayH = 0;
    self.particles = [];
    self.animId = null;
    self.destroyed = false;
    self.paused = false;
    self._resizeObserver = null;

    // Mouse state
    self._mouseX = -1000;
    self._mouseY = -1000;
    self._mouseActive = false;

    // Detect device
    self._isMobile = window.innerWidth <= 600;

    // Pre-rendered glow texture (created after canvas)
    self._glowTex = null;

    self._init();
  }

  // ----------------------------------------------------------
  // Init sequence
  // ----------------------------------------------------------

  ParticleBackground.prototype._init = function() {
    var self = this;

    self._createCanvas();
    self._createGlowTexture();
    self._spawnParticles();
    self._bindEvents();
    self._startLoop();
    self._setupVisibility();
  };

  // ----------------------------------------------------------
  // Canvas setup
  // ----------------------------------------------------------

  ParticleBackground.prototype._createCanvas = function() {
    var self = this;
    var canvas = document.createElement('canvas');
    canvas.className = 'particle-bg__canvas';
    canvas.setAttribute('aria-hidden', 'true');

    canvas.style.cssText = [
      'position: absolute;',
      'left: 0;',
      'top: 0;',
      'width: 100%;',
      'height: 100%;',
      'z-index: ' + self.opts.zIndex + ';',
      'pointer-events: none;',
      'user-select: none;',
      '-webkit-user-select: none;'
    ].join(' ');

    // Ensure container can hold absolute children
    var containerPos = window.getComputedStyle(self.container).position;
    if (containerPos === 'static') {
      self.container.style.position = 'relative';
    }

    self.container.appendChild(canvas);
    self.canvas = canvas;
    self.ctx = canvas.getContext('2d');
    self._resizeCanvas();
  };

  ParticleBackground.prototype._resizeCanvas = function() {
    var self = this;
    if (!self.canvas) return;

    var rect = self.container.getBoundingClientRect();
    self.dpr = Math.min(window.devicePixelRatio || 1, 2);

    self.canvas.width = Math.max(1, Math.floor(rect.width * self.dpr));
    self.canvas.height = Math.max(1, Math.floor(rect.height * self.dpr));
    // 关键：把 ctx 坐标缩放到 DPR，否则粒子只画在左上角 1/dpr 区域
    self.ctx.setTransform(self.dpr, 0, 0, self.dpr, 0, 0);

    self.displayW = rect.width;
    self.displayH = rect.height;
  };

  // ----------------------------------------------------------
  // Pre-rendered glow texture — soft radial gradient
  // ----------------------------------------------------------

  ParticleBackground.prototype._createGlowTexture = function() {
    var self = this;
    var size = 40;
    var tex = document.createElement('canvas');
    tex.width = size;
    tex.height = size;
    var tCtx = tex.getContext('2d');

    var gradient = tCtx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0,    'rgba(245, 238, 220, 1.0)');
    gradient.addColorStop(0.08, 'rgba(245, 238, 220, 0.75)');
    gradient.addColorStop(0.25, 'rgba(232, 217, 197, 0.30)');
    gradient.addColorStop(0.50, 'rgba(216, 195, 165, 0.06)');
    gradient.addColorStop(1,    'rgba(216, 195, 165, 0)');

    tCtx.fillStyle = gradient;
    tCtx.fillRect(0, 0, size, size);

    self._glowTex = tex;
  };

  // ----------------------------------------------------------
  // Particle spawning — distributed across depth layers
  // ----------------------------------------------------------

  ParticleBackground.prototype._spawnParticles = function() {
    var self = this;
    var count = self._isMobile
      ? self.opts.particleCountMobile
      : self.opts.particleCountDesktop;

    var dist = self.opts.depthDistribution;
    var w = self.displayW || self.container.clientWidth || 800;
    var h = self.displayH || self.container.clientHeight || 600;

    self.particles = [];

    for (var i = 0; i < count; i++) {
      // Assign to depth layer based on distribution
      var rand = Math.random();
      var layerIdx = 0;
      var accum = 0;
      for (var l = 0; l < dist.length; l++) {
        accum += dist[l];
        if (rand <= accum) { layerIdx = l; break; }
      }

      // Depth value within this layer (0 = far, 1 = near)
      var layerDepth = layerIdx / Math.max(dist.length - 1, 1);
      var depth = layerDepth + ((Math.random() - 0.5) * 0.25);
      depth = Math.max(0.05, Math.min(1, depth));

      // Home position — random within canvas
      var homeX = Math.random() * w;
      var homeY = Math.random() * h;

      // Color index
      var colorIdx = Math.floor(Math.random() * self.opts.colors.length);

      // Visual properties driven by depth
      var baseSize = 1.0 + depth * 3.5;          // 1-4.5px
      var baseOpacity = 0.15 + depth * 0.50;     // 0.15-0.65
      var driftSpeed = 0.08 + depth * 0.35;      // rad/s base

      self.particles.push({
        x: homeX,
        y: homeY,
        homeX: homeX,
        homeY: homeY,
        vx: 0,
        vy: 0,
        depth: depth,
        size: baseSize,
        opacity: baseOpacity,
        colorIdx: colorIdx,
        // Drift oscillator
        driftAmp: (0.3 + Math.random() * 0.9) * (0.4 + depth * 0.6),
        driftSpeed: driftSpeed * (0.5 + Math.random() * 0.5),
        driftPhaseX: Math.random() * Math.PI * 2,
        driftPhaseY: Math.random() * Math.PI * 2
      });
    }
  };

  // ----------------------------------------------------------
  // Animation loop
  // ----------------------------------------------------------

  ParticleBackground.prototype._startLoop = function() {
    var self = this;

    function loop(now) {
      if (self.destroyed) return;
      self.animId = requestAnimationFrame(loop);

      if (!self.paused) {
        self._update(now);
        self._draw();
      }
    }

    self.animId = requestAnimationFrame(loop);
  };

  // ----------------------------------------------------------
  // Update — drift + mouse repel + spring return
  // ----------------------------------------------------------

  ParticleBackground.prototype._update = function(now) {
    var self = this;
    var dt = Math.min(32, now - (self._lastTime || now)) / 16.67; // normalized delta
    self._lastTime = now;

    var mx = self._mouseX;
    var my = self._mouseY;
    var active = self._mouseActive;
    var radius = self.opts.repelRadius;
    var strength = self.opts.repelStrength;
    var t = now * 0.001; // seconds for drift oscillation

    for (var i = 0; i < self.particles.length; i++) {
      var p = self.particles[i];
      var d = p.depth;

      // ── Drift — sinusoidal floating ──
      var driftX = Math.sin(t * p.driftSpeed + p.driftPhaseX) * p.driftAmp;
      var driftY = Math.cos(t * p.driftSpeed * 0.7 + p.driftPhaseY) * p.driftAmp;

      // ── Mouse repel ──
      var pushX = 0, pushY = 0;
      if (active) {
        var dx = p.x - mx;
        var dy = p.y - my;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < radius && dist > 0.5) {
          // Quadratic falloff — soft, not snappy
          var falloff = 1 - dist / radius;
          var force = strength * falloff * falloff * d * dt;
          var nx = dx / dist;
          var ny = dy / dist;
          pushX = nx * force;
          pushY = ny * force;
        }
      }

      // ── Spring return toward home ──
      var springK = 0.0025;
      var returnX = (p.homeX - p.x) * springK * dt;
      var returnY = (p.homeY - p.y) * springK * dt;

      // ── Apply forces ──
      p.vx += driftX * 0.015 + pushX + returnX;
      p.vy += driftY * 0.015 + pushY + returnY;

      // Damping
      var damping = 0.93;
      p.vx *= damping;
      p.vy *= damping;

      // Clamp velocity
      var maxV = 3.0;
      var speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > maxV) {
        var scale = maxV / speed;
        p.vx *= scale;
        p.vy *= scale;
      }

      // Update position
      p.x += p.vx;
      p.y += p.vy;

      // Wrap around edges (seamless)
      var w = self.displayW;
      var h = self.displayH;
      var margin = 30;
      if (p.x < -margin) { p.x += w + margin * 2; p.homeX += w + margin * 2; }
      if (p.x > w + margin) { p.x -= w + margin * 2; p.homeX -= w + margin * 2; }
      if (p.y < -margin) { p.y += h + margin * 2; p.homeY += h + margin * 2; }
      if (p.y > h + margin) { p.y -= h + margin * 2; p.homeY -= h + margin * 2; }
    }
  };

  // ----------------------------------------------------------
  // Draw — depth-aware glow rendering
  // ----------------------------------------------------------

  ParticleBackground.prototype._draw = function() {
    var self = this;
    var ctx = self.ctx;
    var dpr = self.dpr;
    var tex = self._glowTex;
    var colors = self.opts.colors;

    if (!ctx || !tex) return;

    ctx.clearRect(0, 0, self.displayW, self.displayH);

    // Sort by depth for painter's algorithm (far → near)
    // Fast in-place sort (particle count is capped, ~250 max)
    var sorted = self.particles.slice().sort(function(a, b) {
      return a.depth - b.depth;
    });

    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      if (p.opacity <= 0.01) continue;

      // Depth-driven visual scaling
      var d = p.depth;
      var drawSize = p.size * (6 + d * 10);  // glow radius: far=6px, near=16px
      var alpha = p.opacity;

      // Off-screen culling
      if (p.x < -drawSize || p.x > self.displayW + drawSize) continue;
      if (p.y < -drawSize || p.y > self.displayH + drawSize) continue;

      // Use the warm champagne palette, alpha-tinted
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        tex,
        p.x - drawSize / 2,
        p.y - drawSize / 2,
        drawSize,
        drawSize
      );
    }

    ctx.globalAlpha = 1;
  };

  // ----------------------------------------------------------
  // Mouse & touch interaction
  // ----------------------------------------------------------

  ParticleBackground.prototype._bindEvents = function() {
    var self = this;

    // Mouse move — update mouse position
    self.container.addEventListener('mousemove', function(e) {
      var rect = self.canvas.getBoundingClientRect();
      self._mouseX = e.clientX - rect.left;
      self._mouseY = e.clientY - rect.top;
      self._mouseActive = true;
    }, { passive: true });

    // Mouse leave — disable repel
    self.container.addEventListener('mouseleave', function() {
      self._mouseActive = false;
    });

    // Touch — track single finger
    self.container.addEventListener('touchmove', function(e) {
      if (!e.touches || !e.touches.length) return;
      var rect = self.canvas.getBoundingClientRect();
      self._mouseX = e.touches[0].clientX - rect.left;
      self._mouseY = e.touches[0].clientY - rect.top;
      self._mouseActive = true;
    }, { passive: true });

    self.container.addEventListener('touchend', function() {
      self._mouseActive = false;
    });

    // Resize — ResizeObserver for container size changes
    if (typeof ResizeObserver !== 'undefined') {
      self._resizeObserver = new ResizeObserver(function() {
        if (self.destroyed) return;
        var wasMobile = self._isMobile;
        self._isMobile = window.innerWidth <= 600;
        self._resizeCanvas();

        // Re-spawn if mobile/desktop boundary crossed
        if (wasMobile !== self._isMobile) {
          self._spawnParticles();
        } else {
          // Update home positions proportionally
          var w = self.displayW;
          var h = self.displayH;
          for (var i = 0; i < self.particles.length; i++) {
            var p = self.particles[i];
            p.homeX = Math.min(w - 1, Math.max(0, (p.homeX / (w || 1)) * w));
            p.homeY = Math.min(h - 1, Math.max(0, (p.homeY / (h || 1)) * h));
          }
        }
      });
      self._resizeObserver.observe(self.container);
    }
  };

  // ----------------------------------------------------------
  // Visibility — pause when page not visible
  // ----------------------------------------------------------

  ParticleBackground.prototype._setupVisibility = function() {
    var self = this;

    document.addEventListener('visibilitychange', function() {
      self.paused = document.hidden;
    });
  };

  // ----------------------------------------------------------
  // Public: resize
  // ----------------------------------------------------------

  ParticleBackground.prototype.pause = function() {
    this.paused = true;
  };

  ParticleBackground.prototype.resume = function() {
    this.paused = false;
  };

  ParticleBackground.prototype.resize = function() {
    var self = this;
    if (self.destroyed || !self.canvas) return;
    self._resizeCanvas();
  };

  // ----------------------------------------------------------
  // Public: destroy
  // ----------------------------------------------------------

  ParticleBackground.prototype.destroy = function() {
    var self = this;
    self.destroyed = true;

    if (self.animId) {
      cancelAnimationFrame(self.animId);
      self.animId = null;
    }

    if (self._resizeObserver) {
      self._resizeObserver.disconnect();
      self._resizeObserver = null;
    }

    if (self.canvas && self.canvas.parentNode) {
      self.canvas.parentNode.removeChild(self.canvas);
    }
    self.canvas = null;
    self.ctx = null;
    self.particles = [];
    self._glowTex = null;
  };

  // ============================================================
  // Export
  // ============================================================

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParticleBackground;
  } else {
    global.ParticleBackground = ParticleBackground;
  }

})(typeof window !== 'undefined' ? window : this);

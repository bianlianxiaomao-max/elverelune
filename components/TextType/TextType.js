/* ============================================================
   TextType — Vanilla JS Character-by-Character Typing Effect
   Faithful recreation of React Bits TextType for ELVERE & LUNE

   Usage:
     var tt = new TextType({
       container: document.getElementById('guideText'),
       text: ['Welcome to ELVERE & LUNE'],
       typingSpeed: 100,
       initialDelay: 500,
       pauseDuration: 2000,
       deletingSpeed: 30,
       loop: false,
       showCursor: true,
       cursorCharacter: '|'
     });
   ============================================================ */

(function(global) {
  'use strict';

  var DEFAULTS = {
    text: [''],
    typingSpeed: 100,        // ms per character when typing
    initialDelay: 500,       // ms before typing starts (used by start() if no delay passed)
    pauseDuration: 2000,     // ms pause between lines (sequential mode) or before deleting (loop mode)
    deletingSpeed: 30,       // ms per character when deleting
    loop: false,
    sequential: false,       // if true: type line 1 → pause → type line 2 below (no deletion, all visible)
    showCursor: true,
    cursorCharacter: '|',
    cursorBlinkRate: 530,    // ms per blink cycle
    autoStart: true,         // if false, typing waits for external start() call
    onLineComplete: null,    // callback fired after each line finishes typing
    onComplete: null         // callback when all typing finishes
  };

  function TextType(options) {
    var self = this;

    self.opts = {};
    Object.keys(DEFAULTS).forEach(function(key) {
      self.opts[key] = (options && options[key] !== undefined) ? options[key] : DEFAULTS[key];
    });

    self.container = options && options.container;
    if (!self.container) {
      console.warn('TextType: container element required');
      return;
    }

    // Normalize text to array
    var textInput = self.opts.text;
    if (typeof textInput === 'string') {
      self._lines = [textInput];
    } else if (Array.isArray(textInput)) {
      self._lines = textInput.slice();
    } else {
      self._lines = [''];
    }
    self._lineIndex = 0;

    // State
    self._displayEl = null;
    self._cursorEl = null;
    self._currentText = '';
    self._charIndex = 0;
    self._phase = 'waiting';   // 'waiting' | 'typing' | 'pausing' | 'deleting' | 'done'
    self._timeouts = [];
    self._blinkInterval = null;
    self._destroyed = false;
    self._started = false;

    self._init();
  }

  TextType.prototype._init = function() {
    var self = this;

    // Create text display element
    self._displayEl = document.createElement('span');
    self._displayEl.className = 'text-type__text';
    self._displayEl.textContent = '';

    // Create cursor element
    self._cursorEl = document.createElement('span');
    self._cursorEl.className = 'text-type__cursor';
    self._cursorEl.textContent = self.opts.showCursor ? self.opts.cursorCharacter : '';
    self._cursorEl.style.opacity = '0';

    // Clear container and insert
    self.container.innerHTML = '';
    self.container.appendChild(self._displayEl);
    self.container.appendChild(self._cursorEl);

    // Start cursor blink (always on, even before typing)
    if (self.opts.showCursor) {
      self._startCursorBlink();
    }

    // If autoStart, begin typing after initialDelay
    if (self.opts.autoStart) {
      self._startAfterDelay(self.opts.initialDelay);
    }
    // Otherwise, wait for external start() call
  };

  TextType.prototype._startTyping = function() {
    var self = this;
    if (self._destroyed) return;
    self._phase = 'typing';
    self._started = true;

    // Show cursor
    if (self._cursorEl) {
      self._cursorEl.style.opacity = '1';
    }

    self._typeNextChar();
  };

  TextType.prototype._typeNextChar = function() {
    var self = this;
    if (self._destroyed || self._phase !== 'typing') return;

    var line = self._lines[self._lineIndex] || '';
    self._charIndex++;

    if (self._charIndex > line.length) {
      // Typing complete for this line
      self._onTypingComplete();
      return;
    }

    // Update displayed text
    self._currentText = line.substring(0, self._charIndex);

    // In sequential mode, wrap EVERY line in its class span — even the
    // one currently being typed. Prevents font-size jump when a line
    // transitions from "typing" to "completed and wrapped."
    if (self.opts.sequential) {
      var display = '';
      for (var i = 0; i < self._lineIndex; i++) {
        display += '<span class="text-type__line text-type__line--' + i + '">' + self._lines[i] + '</span><br>';
      }
      // Current in-progress line — also wrapped so it has correct font-size from frame 0
      display += '<span class="text-type__line text-type__line--' + self._lineIndex + '">' + self._currentText + '</span>';
      if (self._displayEl) {
        self._displayEl.innerHTML = display;
      }
    } else {
      if (self._displayEl) {
        self._displayEl.textContent = self._currentText;
      }
    }

    // Schedule next character
    var speed = self.opts.typingSpeed;
    // Add slight randomness for natural feel (90-110% of base speed)
    speed = speed * (0.9 + Math.random() * 0.2);
    var t = setTimeout(function() {
      self._typeNextChar();
    }, speed);
    self._timeouts.push(t);
  };

  TextType.prototype._onTypingComplete = function() {
    var self = this;
    if (self._destroyed) return;

    // Fire per-line callback
    if (typeof self.opts.onLineComplete === 'function') {
      self.opts.onLineComplete(self._lineIndex, self._lines[self._lineIndex]);
    }

    // Sequential mode: type next line below (no deletion)
    if (self.opts.sequential && self._lineIndex < self._lines.length - 1) {
      self._phase = 'pausing';
      // All completed lines wrapped — no size jump during pause
      if (self._displayEl) {
        var fullDisplay = '';
        for (var i = 0; i <= self._lineIndex; i++) {
          fullDisplay += '<span class="text-type__line text-type__line--' + i + '">' + self._lines[i] + '</span>';
          if (i < self._lineIndex) fullDisplay += '<br>';
        }
        self._displayEl.innerHTML = fullDisplay;
      }
      var t = setTimeout(function() {
        if (self._destroyed) return;
        // Advance to next line
        self._lineIndex++;
        self._charIndex = 0;
        self._currentText = '';
        self._startTyping();
      }, self.opts.pauseDuration);
      self._timeouts.push(t);
      return;
    }

    // Fire final callback
    if (typeof self.opts.onComplete === 'function') {
      self.opts.onComplete();
    }

    if (self.opts.sequential && self._lineIndex >= self._lines.length - 1) {
      // All lines done — wrap each in its span for CSS targeting, no trailing <br>
      if (self._displayEl) {
        var doneDisplay = '';
        for (var j = 0; j < self._lines.length; j++) {
          doneDisplay += '<span class="text-type__line text-type__line--' + j + '">' + self._lines[j] + '</span>';
          if (j < self._lines.length - 1) doneDisplay += '<br>';
        }
        self._displayEl.innerHTML = doneDisplay;
      }
      self._phase = 'done';
    } else if (self.opts.loop) {
      // Pause, then delete, then type next line
      self._phase = 'pausing';
      var t2 = setTimeout(function() {
        self._startDeleting();
      }, self.opts.pauseDuration);
      self._timeouts.push(t2);
    } else {
      // Stay showing the text, keep cursor blinking
      self._phase = 'done';
    }
  };

  TextType.prototype._startDeleting = function() {
    var self = this;
    if (self._destroyed) return;
    self._phase = 'deleting';
    self._deleteNextChar();
  };

  TextType.prototype._deleteNextChar = function() {
    var self = this;
    if (self._destroyed || self._phase !== 'deleting') return;

    self._charIndex--;

    if (self._charIndex <= 0) {
      self._currentText = '';
      if (self._displayEl) {
        self._displayEl.textContent = '';
      }
      // Move to next line
      self._lineIndex = (self._lineIndex + 1) % self._lines.length;
      self._phase = 'waiting';
      var t = setTimeout(function() {
        self._startTyping();
      }, self.opts.initialDelay);
      self._timeouts.push(t);
      return;
    }

    var line = self._lines[self._lineIndex] || '';
    self._currentText = line.substring(0, self._charIndex);
    if (self._displayEl) {
      self._displayEl.textContent = self._currentText;
    }

    var speed = self.opts.deletingSpeed;
    var t = setTimeout(function() {
      self._deleteNextChar();
    }, speed);
    self._timeouts.push(t);
  };

  TextType.prototype._startCursorBlink = function() {
    var self = this;
    if (!self._cursorEl) return;

    var visible = true;
    self._blinkInterval = setInterval(function() {
      if (self._destroyed) return;
      visible = !visible;
      // After typing is done, blink more subtly
      if (self._phase === 'done') {
        self._cursorEl.style.opacity = visible ? '0.45' : '0.08';
      } else {
        self._cursorEl.style.opacity = visible ? '1' : '0';
      }
    }, self.opts.cursorBlinkRate);
  };

  // ----------------------------------------------------------
  // Internal: start typing after a delay
  // ----------------------------------------------------------

  TextType.prototype._startAfterDelay = function(delayMs) {
    var self = this;
    if (self._destroyed || self._started) return;
    self._started = true;
    var t = setTimeout(function() {
      self._startTyping();
    }, delayMs);
    self._timeouts.push(t);
  };

  // ----------------------------------------------------------
  // Public: start — trigger typing externally (e.g. IntersectionObserver)
  //   delayMs: override the default initialDelay (optional)
  // ----------------------------------------------------------

  TextType.prototype.start = function(delayMs) {
    var self = this;
    if (self._destroyed || self._started) return;
    var d = (delayMs !== undefined) ? delayMs : self.opts.initialDelay;
    self._startAfterDelay(d);
  };

  // ----------------------------------------------------------
  // Public: destroy
  // ----------------------------------------------------------

  TextType.prototype.destroy = function() {
    var self = this;
    self._destroyed = true;

    // Clear all timeouts
    for (var i = 0; i < self._timeouts.length; i++) {
      clearTimeout(self._timeouts[i]);
    }
    self._timeouts = [];

    // Clear blink interval
    if (self._blinkInterval) {
      clearInterval(self._blinkInterval);
      self._blinkInterval = null;
    }

    // Remove elements
    if (self._displayEl && self._displayEl.parentNode) {
      self._displayEl.parentNode.removeChild(self._displayEl);
    }
    if (self._cursorEl && self._cursorEl.parentNode) {
      self._cursorEl.parentNode.removeChild(self._cursorEl);
    }

    self._displayEl = null;
    self._cursorEl = null;
  };

  // ============================================================
  // Export
  // ============================================================

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextType;
  } else {
    global.TextType = TextType;
  }

})(typeof window !== 'undefined' ? window : this);

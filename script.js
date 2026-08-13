/* ============================================================
   ELVERE & LUNE — 白底极简
   开场动画时序：品牌浮现 → 产品带出 → 进入商品
   ============================================================ */

(function () {
  'use strict';

  var intro = document.getElementById('intro');

  // 约 2 秒后关闭开场层，进入商品
  if (intro) {
    setTimeout(function () {
      intro.classList.add('is-done');
      // 动画结束后彻底移除，避免挡住交互
      setTimeout(function () {
        if (intro.parentNode) intro.parentNode.removeChild(intro);
      }, 800);
    }, 2200);
  }
})();

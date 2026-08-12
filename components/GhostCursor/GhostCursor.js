/**
 * GhostCursor — ReactBits FBM domain-warped shader
 * Integrated from verified standalone test page
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createGhostCursor(parentEl, options = {}) {
  const opts = {
    color: '#B497CF', brightness: 1,
    trailLength: 30, inertia: 0.3,
    bloomStrength: 0.15, bloomRadius: 1.3, bloomThreshold: 0.02,
    grainIntensity: 0.05,
    zIndex: 0,
    fadeInDuration: 0,
    ...options,
  };

  let active = true;
  const maxTrail = Math.max(1, Math.floor(opts.trailLength));
  const trailBuf = Array.from({ length: maxTrail }, () => new THREE.Vector2(0.5, 0.5));
  const baseColor = new THREE.Color(opts.color);
  const initialOpacity = opts.fadeInDuration > 0 ? 0 : 1;

  // Renderer
  const renderer = new THREE.WebGLRenderer({ alpha: true, depth: false, stencil: false, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText =
    `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;`;
  parentEl.appendChild(renderer.domElement);

  // Shader
  const fs = `
    uniform float iTime;varying vec2 vUv;
    uniform vec3 iResolution,iBaseColor;
    uniform vec2 iMouse,iPrevMouse[${maxTrail}];
    uniform float iOpacity,iScale,iBrightness;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);return mix(mix(hash(i+vec2(0.,0.)),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
    float fbm(vec2 p){float v=0.;float a=.5;mat2 m=mat2(cos(.5),sin(.5),-sin(.5),cos(.5));for(int i=0;i<5;i++){v+=a*noise(p);p=m*p*2.;a*=.5;}return v;}
    vec3 tint1(vec3 b){return mix(b,vec3(1.),.15);}vec3 tint2(vec3 b){return mix(b,vec3(.8,.9,1.),.25);}
    vec4 blob(vec2 p,vec2 mp,float intensity,float activity){
      vec2 q=vec2(fbm(p*iScale+iTime*.1),fbm(p*iScale+vec2(5.2,1.3)+iTime*.1));
      vec2 r=vec2(fbm(p*iScale+q*1.5+iTime*.15),fbm(p*iScale+q*1.5+vec2(8.3,2.8)+iTime*.15));
      float smoke=fbm(p*iScale+r*.8);float rad=.5+.3*(1./iScale);
      float df=1.-smoothstep(0.,rad*activity,length(p-mp));
      float alpha=pow(smoke,2.5)*df;
      vec3 c1=tint1(iBaseColor),c2=tint2(iBaseColor);
      return vec4(mix(c1,c2,sin(iTime*.5)*.5+.5)*alpha*intensity,alpha*intensity);
    }
    void main(){
      vec2 uv=(gl_FragCoord.xy/iResolution.xy*2.-1.)*vec2(iResolution.x/iResolution.y,1.);
      vec2 mouse=(iMouse*2.-1.)*vec2(iResolution.x/iResolution.y,1.);
      vec3 ca=vec3(0.);float aa=0.;
      vec4 b=blob(uv,mouse,1.,iOpacity);ca+=b.rgb;aa+=b.a;
      for(int i=0;i<${maxTrail};i++){
        vec2 pm=(iPrevMouse[i]*2.-1.)*vec2(iResolution.x/iResolution.y,1.);
        float ti=1.-float(i)/float(${maxTrail});ti=pow(ti,2.);
        if(ti>.01){vec4 bt=blob(uv,pm,ti*.8,iOpacity);ca+=bt.rgb;aa+=bt.a;}
      }
      gl_FragColor=vec4(ca*iBrightness,clamp(aa*iOpacity,0.,1.));
    }`;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      iTime:{value:0},iResolution:{value:new THREE.Vector3(1,1,1)},
      iMouse:{value:new THREE.Vector2(0.5,0.5)},
      iPrevMouse:{value:trailBuf.map(v=>v.clone())},
      iOpacity:{value:initialOpacity},iScale:{value:1},
      iBaseColor:{value:new THREE.Vector3(baseColor.r,baseColor.g,baseColor.b)},
      iBrightness:{value:opts.brightness},
    },
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}',
    fragmentShader:fs,transparent:true,depthTest:false,depthWrite:false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat));

  // Post-processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,new THREE.OrthographicCamera(-1,1,1,-1,0,1)));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1,1),opts.bloomStrength,opts.bloomRadius,opts.bloomThreshold);
  composer.addPass(bloom);

  // State
  let mx=0.5,my=0.5;
  let head=0,start=performance.now(),fadeStart=performance.now();
  let fadeOutStart=null,fadeOutDur=0,fadeOutCb=null,fadingOut=false;

  function teardown(){
    active=false;
    document.removeEventListener('pointermove',onMove);
    window.removeEventListener('resize',resize);
    scene.clear();mat.dispose();composer.dispose();renderer.dispose();renderer.forceContextLoss();
    if(renderer.domElement?.parentElement)renderer.domElement.parentElement.removeChild(renderer.domElement);
  }

  function resize(){
    if(!active)return;
    const w=renderer.domElement.clientWidth,h=renderer.domElement.clientHeight;
    if(w<=0||h<=0)return;
    // 手机端降低像素比以减轻 bloom 后处理负担，避免卡顿
    const isMobile = w < 768;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1, isMobile ? 1 : 1.5));
    renderer.setSize(w,h,false);
    composer.setSize(w,h);
    mat.uniforms.iResolution.value.set(w,h,1);
    mat.uniforms.iScale.value=Math.max(0.5,Math.min(2,Math.min(w,h)/600));
    bloom.setSize(w,h);
  }
  resize();
  window.addEventListener('resize',resize);

  // Events from document (bypasses z-index issues)
  const onMove = e => {
    const r = renderer.domElement.getBoundingClientRect();
    mx = Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    my = Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height));
  };
  document.addEventListener('pointermove',onMove);

  // Loop
  function loop(){
    if(!active)return;
    const t=(performance.now()-start)/1000;
    mat.uniforms.iMouse.value.set(mx,my);
    head=(head+1)%maxTrail;trailBuf[head].set(mx,my);
    for(let i=0;i<maxTrail;i++)mat.uniforms.iPrevMouse.value[i].copy(trailBuf[(head-i+maxTrail)%maxTrail]);
    mat.uniforms.iTime.value=t;
    if (fadingOut) {
      const f = Math.min(1, (performance.now() - fadeOutStart) / fadeOutDur);
      mat.uniforms.iOpacity.value = 1 - (f * f * (3 - 2 * f)); // smoothstep fade-out
      if (f >= 1) {
        const cb = fadeOutCb; fadeOutCb = null;
        teardown();
        if (cb) cb();
        return;
      }
    } else if (opts.fadeInDuration > 0) {
      const f = Math.min(1, (performance.now() - fadeStart) / opts.fadeInDuration);
      mat.uniforms.iOpacity.value = f * f * (3 - 2 * f); // smoothstep fade-in
    }
    composer.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    destroy(){ teardown(); },
    fadeOut(duration, onDone){
      if (fadingOut || !active) { if (onDone) onDone(); return; }
      fadeOutDur = duration || 800;
      fadeOutStart = performance.now();
      fadeOutCb = onDone || null;
      fadingOut = true;
    },
  };
}

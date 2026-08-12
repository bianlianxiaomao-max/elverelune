/**
 * InfiniteMenu — React Bits port to vanilla JS
 * 3D sphere disc menu with WebGL 2.0 + arcball rotation
 * 
 * Requires: gl-matrix 3.x CDN (exposes global glMatrix)
 */
(function(global) {
  'use strict';
  
  var gl = global.glMatrix;
  if (!gl || !gl.mat4) throw new Error('gl-matrix CDN required before InfiniteMenu.js');
  var mat4 = gl.mat4, quat2 = gl.quat, vec3 = gl.vec3, vec2 = gl.vec2;

  // ═══════════════════════════════════════════
  // SHADERS (WebGL 2.0 GLSL 300 es)
  // ═══════════════════════════════════════════
  var VERT = '#version 300 es\n' +
    'uniform mat4 uWorldMatrix;uniform mat4 uViewMatrix;uniform mat4 uProjectionMatrix;uniform vec4 uRotationAxisVelocity;uniform float uReveal;\n' +
    'in vec3 aModelPosition;in vec3 aModelNormal;in vec2 aModelUvs;in mat4 aInstanceMatrix;\n' +
    'out vec2 vUvs;out float vAlpha;out float vReveal;flat out int vInstanceId;\n' +
    '#define PI 3.141593\n' +
    'void main(){\n' +
    ' vec4 wp=uWorldMatrix*aInstanceMatrix*vec4(aModelPosition,1.);\n' +
    ' vec3 cp=(uWorldMatrix*aInstanceMatrix*vec4(0.,0.,0.,1.)).xyz;\n' +
    ' float r=length(cp.xyz);\n' +
    ' if(gl_VertexID>0){\n' +
    '  vec3 ax=uRotationAxisVelocity.xyz;float vl=min(.15,uRotationAxisVelocity.w*15.);\n' +
    '  vec3 sd=normalize(cross(cp,ax));\n' +
    '  vec3 rvp=normalize(wp.xyz-cp);\n' +
    '  float s=dot(sd,rvp);float inv=min(0.,abs(s)-1.);\n' +
    '  s=vl*sign(s)*abs(inv*inv*inv+1.);wp.xyz+=sd*s;\n' +
    ' }\n' +
    ' wp.xyz=r*normalize(wp.xyz);\n' +
    ' gl_Position=uProjectionMatrix*uViewMatrix*wp;\n' +
    ' vAlpha=smoothstep(0.5,1.,normalize(wp.xyz).z)*.9+.1;\n' +
    ' float order=normalize(cp).x*.5+.5;\n' +
    ' vReveal=smoothstep(order-0.14,order+0.14,uReveal);\n' +
    ' vUvs=aModelUvs;vInstanceId=gl_InstanceID;\n' +
    '}';

  var FRAG = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uTex;uniform int uItemCount;uniform int uAtlasSize;\n' +
    'out vec4 outColor;in vec2 vUvs;in float vAlpha;in float vReveal;flat in int vInstanceId;\n' +
    'void main(){\n' +
    ' int ix=vInstanceId%uItemCount;int cpr=uAtlasSize;\n' +
    ' int cx=ix%cpr;int cy=ix/cpr;\n' +
    ' vec2 cs=vec2(1.)/vec2(float(cpr));\n' +
    ' vec2 off=vec2(float(cx),float(cy))*cs;\n' +
    ' ivec2 ts=textureSize(uTex,0);\n' +
    ' float ia=float(ts.x)/float(ts.y);float ca=1.0;\n' +
    ' float sc=max(ia/ca,ca/ia);\n' +
    ' vec2 st=vec2(vUvs.x,1.-vUvs.y);\n' +
    ' st=(st-0.5)*sc+0.5;st=clamp(st,0.,1.);\n' +
    ' st=st*cs+off;\n' +
    ' outColor=texture(uTex,st);outColor.a*=vAlpha*vReveal;\n' +
    '}';

  // ═══════════════════════════════════════════
  // GEOMETRY
  // ═══════════════════════════════════════════
  function Face(a,b,c){this.a=a;this.b=b;this.c=c;}
  function Vertex(x,y,z){this.pos=vec3.fromValues(x,y,z);this.nrm=vec3.create();this.uv=vec2.create();}
  
  function Geometry(){this.verts=[];this.faces=[];}
  Geometry.prototype.addV=function(){for(var i=0;i<arguments.length;i+=3)this.verts.push(new Vertex(arguments[i],arguments[i+1],arguments[i+2]));return this;};
  Geometry.prototype.addF=function(){for(var i=0;i<arguments.length;i+=3)this.faces.push(new Face(arguments[i],arguments[i+1],arguments[i+2]));return this;};
  Object.defineProperty(Geometry.prototype,'lv',{get:function(){return this.verts[this.verts.length-1];}});
  
  Geometry.prototype.sub=function(n){var s=this,c={},f=s.faces;n=n||1;
    for(var d=0;d<n;++d){var nf=new Array(f.length*4);
      f.forEach(function(fc,k){var mAB=mp(s,fc.a,fc.b,c),mBC=mp(s,fc.b,fc.c,c),mCA=mp(s,fc.c,fc.a,c),j=k*4;
        nf[j]=new Face(fc.a,mAB,mCA);nf[j+1]=new Face(fc.b,mBC,mAB);nf[j+2]=new Face(fc.c,mCA,mBC);nf[j+3]=new Face(mAB,mBC,mCA);
      });f=nf;
    }s.faces=f;return s;};
    
  Geometry.prototype.sph=function(r){r=r||1;this.verts.forEach(function(v){vec3.normalize(v.nrm,v.pos);vec3.scale(v.pos,v.nrm,r);});return this;};
  
  function mp(s,a,b,c){var k=a<b?'k'+b+'_'+a:'k'+a+'_'+b;if(c.hasOwnProperty(k))return c[k];
    var pa=s.verts[a].pos,pb=s.verts[b].pos,ndx=s.verts.length;c[k]=ndx;s.addV((pa[0]+pb[0])*.5,(pa[1]+pb[1])*.5,(pa[2]+pb[2])*.5);return ndx;}
    
  Object.defineProperty(Geometry.prototype,'vd',{get:function(){return new Float32Array(this.verts.reduce(function(a,v){a.push(v.pos[0],v.pos[1],v.pos[2]);return a;},[]));}});
  Object.defineProperty(Geometry.prototype,'uvd',{get:function(){return new Float32Array(this.verts.reduce(function(a,v){a.push(v.uv[0],v.uv[1]);return a;},[]));}});
  Object.defineProperty(Geometry.prototype,'id',{get:function(){return new Uint16Array(this.faces.reduce(function(a,f){a.push(f.a,f.b,f.c);return a;},[]));}});
  Object.defineProperty(Geometry.prototype,'data',{get:function(){return{vertices:this.vd,indices:this.id,uvs:this.uvd};}});
  
  function IcoGeo(){Geometry.call(this);var t=Math.sqrt(5)*.5+.5;
    this.addV(-1,t,0,1,t,0,-1,-t,0,1,-t,0,0,-1,t,0,1,t,0,-1,-t,0,1,-t,t,0,-1,t,0,1,-t,0,-1,-t,0,1)
    .addF(0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1);
  }IcoGeo.prototype=Object.create(Geometry.prototype);IcoGeo.prototype.constructor=IcoGeo;IcoGeo.prototype.mp=mp;
  
  function DiscGeo(steps,radius){Geometry.call(this);steps=Math.max(4,steps||4);radius=radius||1;
    var a=(2*Math.PI)/steps;this.addV(0,0,0);this.lv.uv[0]=.5;this.lv.uv[1]=.5;
    for(var i=0;i<steps;++i){var x=Math.cos(a*i),y=Math.sin(a*i);this.addV(radius*x,radius*y,0);this.lv.uv[0]=x*.5+.5;this.lv.uv[1]=y*.5+.5;if(i>0)this.addF(0,i,i+1);}
    this.addF(0,steps,1);
  }DiscGeo.prototype=Object.create(Geometry.prototype);DiscGeo.prototype.constructor=DiscGeo;

  // ═══════════════════════════════════════════
  // WEBGL HELPERS
  // ═══════════════════════════════════════════
  function mkShader(gl,type,src){var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(gl.getShaderParameter(s,gl.COMPILE_STATUS))return s;console.error(gl.getShaderInfoLog(s));gl.deleteShader(s);return null;}
  function mkProg(gl,srcs,tfv,al){var p=gl.createProgram();[gl.VERTEX_SHADER,gl.FRAGMENT_SHADER].forEach(function(t,i){var s=mkShader(gl,t,srcs[i]);if(s)gl.attachShader(p,s);});if(tfv)gl.transformFeedbackVaryings(p,tfv,gl.SEPARATE_ATTRIBS);if(al)for(var a in al)if(al.hasOwnProperty(a))gl.bindAttribLocation(p,al[a],a);gl.linkProgram(p);if(gl.getProgramParameter(p,gl.LINK_STATUS))return p;console.error(gl.getProgramInfoLog(p));gl.deleteProgram(p);return null;}
  function mkVAO(gl,pairs,indices){var va=gl.createVertexArray();gl.bindVertexArray(va);for(var i=0;i<pairs.length;i++){var b=pairs[i][0],l=pairs[i][1],n=pairs[i][2];if(l===-1)continue;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,n,gl.FLOAT,false,0,0);}if(indices){var ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);}gl.bindVertexArray(null);return va;}
  function mkBuf(gl,data,usage){var b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,usage);gl.bindBuffer(gl.ARRAY_BUFFER,null);return b;}
  function mkTex(gl,mn,mg,ws,wt){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,ws);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wt);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mn);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,mg);return t;}
  function resizeCvs(c){var d=Math.min(2,window.devicePixelRatio||1),dw=Math.round(c.clientWidth*d),dh=Math.round(c.clientHeight*d),n=c.width!==dw||c.height!==dh;if(n){c.width=dw;c.height=dh;}return n;}

  // ═══════════════════════════════════════════
  // ARCBALL CONTROL
  // ═══════════════════════════════════════════
  function Arcball(canvas,cb){var s=this;s.cv=canvas;s.cb=cb||function(){};
    s.down=false;s.ori=quat2.create();s.pq=quat2.create();s.rv=0;s.ra=vec3.fromValues(1,0,0);s.sd=vec3.fromValues(0,0,-1);
    s.std=null;s.EPS=0.1;s.IQ=quat2.create();s.pp=vec2.create();s.ppp=vec2.create();s._rv=0;s._cq=quat2.create();
    canvas.addEventListener('pointerdown',function(e){vec2.set(s.pp,e.clientX,e.clientY);vec2.copy(s.ppp,s.pp);s.down=true;});
    canvas.addEventListener('pointerup',function(){s.down=false;});
    canvas.addEventListener('pointerleave',function(){s.down=false;});
    canvas.addEventListener('pointermove',function(e){if(s.down)vec2.set(s.pp,e.clientX,e.clientY);});
    canvas.style.touchAction='none';
  }
  
  Arcball.prototype.update=function(dt,tfd){tfd=tfd||16;var s=this,ts=dt/tfd+1e-5,af=ts,sr=quat2.create();
    if(s.down){var INT=0.3*ts,AMP=5/ts,mp=vec2.sub(vec2.create(),s.pp,s.ppp);vec2.scale(mp,mp,INT);
      if(vec2.sqrLen(mp)>s.EPS){vec2.add(mp,s.ppp,mp);var pp=prj(s,mp),pq=prj(s,s.ppp),a=vec3.normalize(vec3.create(),pp),b=vec3.normalize(vec3.create(),pq);
        vec2.copy(s.ppp,mp);af*=AMP;qvf(a,b,s.pq,af);}else{quat2.slerp(s.pq,s.pq,s.IQ,INT);}}
    else{var INT2=0.1*ts;quat2.slerp(s.pq,s.pq,s.IQ,INT2);
      if(s.std){var SI=0.2,a2=s.std,b2=s.sd,sq=vec3.squaredDistance(a2,b2),df=Math.max(0.1,1-sq*10);af*=SI*df;qvf(a2,b2,sr,af);}}
    var cq=quat2.multiply(quat2.create(),sr,s.pq);s.ori=quat2.multiply(quat2.create(),cq,s.ori);quat2.normalize(s.ori,s.ori);
    var RI=0.8*ts;quat2.slerp(s._cq,s._cq,cq,RI);quat2.normalize(s._cq,s._cq);
    var rad=Math.acos(s._cq[3])*2.0,ss=Math.sin(rad/2.0),rv2=0;if(ss>1e-6){rv2=rad/(2*Math.PI);s.ra[0]=s._cq[0]/ss;s.ra[1]=s._cq[1]/ss;s.ra[2]=s._cq[2]/ss;}
    var RVI=0.5*ts;s._rv+=(rv2-s._rv)*RVI;s.rv=s._rv/ts;s.cb(dt);};
    
  function qvf(a,b,out,af){af=af||1;var ax=vec3.cross(vec3.create(),a,b);vec3.normalize(ax,ax);var d=Math.max(-1,Math.min(1,vec3.dot(a,b))),an=Math.acos(d)*af;quat2.setAxisAngle(out,ax,an);}
  function prj(s,p){var r=2,w=s.cv.clientWidth,h=s.cv.clientHeight,sm=Math.max(w,h)-1,x=(2*p[0]-w-1)/sm,y=(2*p[1]-h-1)/sm,z=0,xys=x*x+y*y,rs=r*r;
    if(xys<=rs/2.0)z=Math.sqrt(rs-xys);else z=rs/Math.sqrt(xys);return vec3.fromValues(-x,y,z);}

  // ═══════════════════════════════════════════
  // INFINITE GRID MENU ENGINE
  // ═══════════════════════════════════════════
  function InfiniteGridMenu(canvas,items,onA,onM,onInit,scale){
    var s=this;s.cv=canvas;s.items=items||[];s.onA=onA||function(){};s.onM=onM||function(){};
    s.sf=scale||1;s.TFD=1000/60;s.SR=2;s._t=0;s._dt=0;s._df=0;s._fr=0;s.ma=false;s.srv=0;
    s.introDone=false;s.introStarted=false;s.introStart=0;s.introDuration=3200;s.introE=0;s.introEt=0;    s.introFromQ=quat2.create();s.introToQ=quat2.create();
    s.revealDone=false;s.revealStart=-1;s.revealDuration=1400;s.reveal=0;s.sequenceArmed=false;s.onIntroDone=null;
    s.paused=false;
    s.cam={matrix:mat4.create(),near:0.1,far:40,fov:Math.PI/4,aspect:1,pos:vec3.fromValues(0,0,3*s.sf),up:vec3.fromValues(0,1,0),mats:{view:mat4.create(),proj:mat4.create(),ip:mat4.create()}};
    s._init(onInit);
  }
  
  InfiniteGridMenu.prototype._init=function(onInit){var s=this,gl=s.cv.getContext('webgl2',{antialias:true,alpha:false});if(!gl)throw new Error('WebGL 2 not supported');s.gl=gl;s.vs=vec2.fromValues(s.cv.clientWidth,s.cv.clientHeight);
    s.dProg=mkProg(gl,[VERT,FRAG],null,{aModelPosition:0,aModelNormal:1,aModelUvs:2,aInstanceMatrix:3});
    s.dLocs={aMP:gl.getAttribLocation(s.dProg,'aModelPosition'),aMU:gl.getAttribLocation(s.dProg,'aModelUvs'),aIM:gl.getAttribLocation(s.dProg,'aInstanceMatrix'),
      uWM:gl.getUniformLocation(s.dProg,'uWorldMatrix'),uVM:gl.getUniformLocation(s.dProg,'uViewMatrix'),uPM:gl.getUniformLocation(s.dProg,'uProjectionMatrix'),
      uCP:gl.getUniformLocation(s.dProg,'uCameraPosition'),uRAV:gl.getUniformLocation(s.dProg,'uRotationAxisVelocity'),
      uTex:gl.getUniformLocation(s.dProg,'uTex'),uFr:gl.getUniformLocation(s.dProg,'uFrames'),uIC:gl.getUniformLocation(s.dProg,'uItemCount'),uAS:gl.getUniformLocation(s.dProg,'uAtlasSize'),uReveal:gl.getUniformLocation(s.dProg,'uReveal')};
    s.dGeo=new DiscGeo(56,1);s.dBuf=s.dGeo.data;
    s.dVAO=mkVAO(gl,[[mkBuf(gl,s.dBuf.vertices,gl.STATIC_DRAW),s.dLocs.aMP,3],[mkBuf(gl,s.dBuf.uvs,gl.STATIC_DRAW),s.dLocs.aMU,2]],s.dBuf.indices);
    s.iGeo=new IcoGeo();s.iGeo.sub(1).sph(s.SR);s.ip=s.iGeo.verts.map(function(v){return v.pos;});
    // 入场动画旋转：让第一个商品(instance 0)朝向相机 -z
    var _v0=vec3.normalize(vec3.create(),vec3.fromValues(s.ip[0][0],s.ip[0][1],s.ip[0][2]));
    quat2.rotationTo(s.introToQ,_v0,vec3.fromValues(0,0,-1));
    quat2.setAxisAngle(s.introFromQ,[0,1,0],1.9);
    s.DIC=s.iGeo.verts.length;s._idc(s.DIC);s.wm=mat4.create();s._it();
    s.ctrl=new Arcball(s.cv,function(dt){s._ocu(dt);});
    s._ucm();s._upm();s.resize();if(onInit)onInit(s);};
    
  InfiniteGridMenu.prototype._it=function(){var s=this,gl=s.gl,ic=Math.max(1,s.items.length);s.as=Math.ceil(Math.sqrt(ic));s.tex=mkTex(gl,gl.LINEAR,gl.LINEAR,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE);
    var c=document.createElement('canvas'),ctx=c.getContext('2d'),cs=512;c.width=s.as*cs;c.height=s.as*cs;
    Promise.all(s.items.map(function(item){return new Promise(function(resolve){var img=new Image();img.crossOrigin='anonymous';img.onload=function(){resolve(img)};
      img.onerror=function(){var fc=document.createElement('canvas');fc.width=cs;fc.height=cs;var fcx=fc.getContext('2d');fcx.fillStyle='#2a2a2a';fcx.fillRect(0,0,cs,cs);fcx.fillStyle='#999';fcx.font='36px serif';fcx.textAlign='center';fcx.fillText(item.title||'?',cs/2,cs/2+12);resolve(fc);};
      img.src=item.image;})})).then(function(images){images.forEach(function(img,i){var x=(i%s.as)*cs,y=Math.floor(i/s.as)*cs;ctx.drawImage(img,x,y,cs,cs);});
      gl.bindTexture(gl.TEXTURE_2D,s.tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);gl.generateMipmap(gl.TEXTURE_2D);});};
      
  InfiniteGridMenu.prototype._idc=function(n){var s=this,gl=s.gl;s.di={ma:new Float32Array(n*16),mats:[],buf:gl.createBuffer()};for(var i=0;i<n;++i){var im=new Float32Array(s.di.ma.buffer,i*16*4,16);im.set(mat4.create());s.di.mats.push(im);}
    gl.bindVertexArray(s.dVAO);gl.bindBuffer(gl.ARRAY_BUFFER,s.di.buf);gl.bufferData(gl.ARRAY_BUFFER,s.di.ma.byteLength,gl.DYNAMIC_DRAW);
    for(var j=0;j<4;++j){var loc=s.dLocs.aIM+j;gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,4,gl.FLOAT,false,64,j*16);gl.vertexAttribDivisor(loc,1);}gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindVertexArray(null);};
    
  InfiniteGridMenu.prototype._anim=function(dt){var s=this;
    if(!s.introDone){quat2.slerp(s.ctrl.ori,s.introFromQ,s.introToQ,s.introE);quat2.normalize(s.ctrl.ori,s.ctrl.ori);}
    else{s.ctrl.update(dt,s.TFD);}
    var pos=s.ip.map(function(p){return vec3.transformQuat(vec3.create(),p,s.ctrl.ori);});var sc=0.25,SI=0.6;
    pos.forEach(function(p,ndx){var ss=(Math.abs(p[2])/s.SR)*SI+(1-SI),fs=ss*sc,m=mat4.create();
      mat4.multiply(m,m,mat4.fromTranslation(mat4.create(),vec3.negate(vec3.create(),p)));
      mat4.multiply(m,m,mat4.targetTo(mat4.create(),[0,0,0],p,[0,1,0]));
      mat4.multiply(m,m,mat4.fromScaling(mat4.create(),[fs,fs,fs]));
      mat4.multiply(m,m,mat4.fromTranslation(mat4.create(),[0,0,-s.SR]));mat4.copy(s.di.mats[ndx],m);});
    var gl=s.gl;gl.bindBuffer(gl.ARRAY_BUFFER,s.di.buf);gl.bufferSubData(gl.ARRAY_BUFFER,0,s.di.ma);gl.bindBuffer(gl.ARRAY_BUFFER,null);s.srv=s.ctrl.rv;};
    
  InfiniteGridMenu.prototype._ren=function(){var s=this,gl=s.gl;gl.useProgram(s.dProg);gl.enable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(s.dLocs.uWM,false,s.wm);gl.uniformMatrix4fv(s.dLocs.uVM,false,s.cam.mats.view);gl.uniformMatrix4fv(s.dLocs.uPM,false,s.cam.mats.proj);
    gl.uniform3f(s.dLocs.uCP,s.cam.pos[0],s.cam.pos[1],s.cam.pos[2]);gl.uniform4f(s.dLocs.uRAV,s.ctrl.ra[0],s.ctrl.ra[1],s.ctrl.ra[2],s.srv*1.1);
    gl.uniform1i(s.dLocs.uIC,s.items.length);gl.uniform1i(s.dLocs.uAS,s.as);gl.uniform1f(s.dLocs.uFr,s._fr);gl.uniform1f(s.dLocs.uReveal,s.reveal);gl.uniform1i(s.dLocs.uTex,0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.tex);gl.bindVertexArray(s.dVAO);gl.drawElementsInstanced(gl.TRIANGLES,s.dBuf.indices.length,gl.UNSIGNED_SHORT,0,s.DIC);};
    
  InfiniteGridMenu.prototype._ucm=function(){mat4.targetTo(this.cam.matrix,this.cam.pos,[0,0,0],this.cam.up);mat4.invert(this.cam.mats.view,this.cam.matrix);};
  InfiniteGridMenu.prototype._upm=function(){var s=this,gl=s.gl;s.cam.aspect=gl.canvas.clientWidth/gl.canvas.clientHeight;
    var _h;
    if(s.introDone){_h=0.35;}
    else{_h=1.15-(1.15-0.35)*s.introE;}
    var h=s.SR*_h,d=s.cam.pos[2];if(s.cam.aspect>1)s.cam.fov=2*Math.atan(h/d);else s.cam.fov=2*Math.atan(h/s.cam.aspect/d);
    mat4.perspective(s.cam.mats.proj,s.cam.fov,s.cam.aspect,s.cam.near,s.cam.far);mat4.invert(s.cam.mats.ip,s.cam.mats.proj);};
    
  InfiniteGridMenu.prototype._ocu=function(dt){var s=this,ts=dt/s.TFD+1e-4,damp=5/ts,ctz=3*s.sf,im=s.ctrl.down||Math.abs(s.srv)>0.01;
    if(im!==s.ma){s.ma=im;s.onM(im);}
    if(!s.ctrl.down){var nvi=s._fnvi(),ii=nvi%Math.max(1,s.items.length);s.nvi=nvi;s.onA(ii);
      var sd=vec3.normalize(vec3.create(),s._gvwp(nvi));s.ctrl.std=sd;}else{ctz+=s.ctrl.rv*80+2.5;damp=7/ts;}
    s.cam.pos[2]+=(ctz-s.cam.pos[2])/damp;s._ucm();};
    
  InfiniteGridMenu.prototype._fnvi=function(){var s=this,n=s.ctrl.sd,io=quat2.conjugate(quat2.create(),s.ctrl.ori),nt=vec3.transformQuat(vec3.create(),n,io),md=-1,nvi;
    for(var i=0;i<s.ip.length;++i){var d=vec3.dot(nt,s.ip[i]);if(d>md){md=d;nvi=i;}}return nvi;};
  InfiniteGridMenu.prototype._gvwp=function(i){return vec3.transformQuat(vec3.create(),this.ip[i],this.ctrl.ori);};
  
  InfiniteGridMenu.prototype.run=function(t){var s=this;t=t||0;
    if(s.sequenceArmed){
      if(s.revealStart<0)s.revealStart=t;
      if(!s.revealDone){
        var _rv=(t-s.revealStart)/s.revealDuration;
        if(_rv>=1){_rv=1;s.revealDone=true;}
        s.reveal=_rv*_rv*(3-2*_rv);
      }
      if(s.revealDone && !s.introDone){
        if(!s.introStarted){s.introStarted=true;s.introStart=t;}
        var _et=(t-s.introStart)/s.introDuration;if(_et>=1){_et=1;s.introDone=true;if(s.onIntroDone)s.onIntroDone();}
        s.introEt=_et;
        var _a=0.375,_e2;if(_et<_a){var _u=_et/_a;_e2=_a*Math.pow(_u,2.5);}else{var _u2=(_et-_a)/(1-_a);_e2=_a+(1-_a)*(1-Math.pow(1-_u2,2.5));}
        s.introE=_e2;s._upm();
      }
    }
    s._dt=Math.min(32,t-s._t);s._t=t;s._df=s._dt/s.TFD;s._fr+=s._df;s._anim(s._dt);s._ren();s._rid=requestAnimationFrame(function(tt){s.run(tt);});};
  InfiniteGridMenu.prototype.startSequence=function(){var s=this;if(!s.sequenceArmed){s.sequenceArmed=true;s.revealStart=-1;}};
  InfiniteGridMenu.prototype.pause=function(){var s=this;s.paused=true;if(s._rid){cancelAnimationFrame(s._rid);s._rid=null;}};
  InfiniteGridMenu.prototype.resume=function(){var s=this;if(!s.paused)return;s.paused=false;if(!s._rid){s._rid=requestAnimationFrame(function(tt){s.run(tt);});}};
  InfiniteGridMenu.prototype.resize=function(){var s=this,gl=s.gl;s.vs=vec2.set(s.vs||vec2.create(),s.cv.clientWidth,s.cv.clientHeight);if(resizeCvs(gl.canvas))gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);s._upm();};
  InfiniteGridMenu.prototype.destroy=function(){if(this._rid)cancelAnimationFrame(this._rid);if(this.gl){var ext=this.gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();}};

  // ═══════════════════════════════════════════
  // PUBLIC InfiniteMenu WRAPPER
  // ═══════════════════════════════════════════
  function InfiniteMenu(options){
    var s=this;s.container=options.container;s.items=options.items||[];s.scale=options.scale||1;
    s.wrap=document.createElement('div');s.wrap.style.cssText='position:relative;width:100%;height:100%;';
    s.cvs=document.createElement('canvas');s.cvs.id='infinite-grid-menu-canvas';s.wrap.appendChild(s.cvs);
    s.tEl=document.createElement('h2');s.tEl.className='face-title inactive';s.wrap.appendChild(s.tEl);
    s.dEl=document.createElement('p');s.dEl.className='face-description inactive';s.wrap.appendChild(s.dEl);
    s.bEl=document.createElement('div');s.bEl.className='action-button inactive';
    s.bEl.innerHTML='<span class="action-button-icon">&#x2197;</span>';
    s.bEl.addEventListener('click',function(){if(s._ai&&s._ai.link&&s._ai.link!=='#')window.open(s._ai.link,'_blank');});
    s.wrap.appendChild(s.bEl);s.container.appendChild(s.wrap);
    s._ai=null;s._aii=-1;
    s.engine=new InfiniteGridMenu(s.cvs,s.items,function(i){var it=s.items[i%s.items.length];if(s._aii!==i){s._aii=i;s._ai=it;s.tEl.textContent=it.title||'';s.dEl.textContent=it.description||'';if(s.onActiveItemChange)s.onActiveItemChange(it,i);}},
      function(im){var c=im?'inactive':'active';s.tEl.className='face-title '+c;s.dEl.className='face-description '+c;s.bEl.className='action-button '+c;if(s.onMovementChange)s.onMovementChange(im);},
      function(sk){sk.run();},s.scale);
    s._rh=function(){s.resize();};window.addEventListener('resize',s._rh);s.resize();
  }
  InfiniteMenu.prototype.resize=function(){if(this.engine)this.engine.resize();};
  InfiniteMenu.prototype.pause=function(){if(this.engine)this.engine.pause();};
  InfiniteMenu.prototype.resume=function(){if(this.engine)this.engine.resume();};
  InfiniteMenu.prototype.startSequence=function(onDone){if(this.engine){this.engine.onIntroDone=onDone||null;this.engine.startSequence();}};
  InfiniteMenu.prototype.destroy=function(){if(this.engine)this.engine.destroy();window.removeEventListener('resize',this._rh);if(this.wrap.parentNode)this.wrap.parentNode.removeChild(this.wrap);};

  if(typeof module!=='undefined'&&module.exports)module.exports=InfiniteMenu;else global.InfiniteMenu=InfiniteMenu;
})(typeof window!=='undefined'?window:this);

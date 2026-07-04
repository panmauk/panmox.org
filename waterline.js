/* ═══════════════════════════════════════════════════════════════════
   PANMOX WATERLINE — two signature 3D threads running through the site.

   LEFT/RIGHT MIRRORED PAIR (both drift across the screen as you scroll,
   always on opposite sides of one another — they trade places mid-page
   and the water refracts the neon as they cross):

   · WATER — a true raymarched volume, no polygons on the surface:
       - the column is a Signed Distance Field: a generalized cylinder
         around the CPU spring-chain spine, f(p) = |p.xz − C(p.y)| − R(p),
         sphere-traced per fragment inside a tight bounding box that
         tracks the spine each frame (the march never pays for pixels
         the stream can't reach)
       - surface normals are the SDF gradient, N = normalize(∇f), via
         tetrahedral differences
       - TRIPLE-LAYER fBm displaces the boundary:
           tier 1 MACRO  (large/slow)  — heavy inertial weaving
           tier 2 MESO   (mid/variable) — shear waves that ELONGATE
                          along Y as scroll velocity rises
           tier 3 MICRO  (ultra-fine/fast) — capillary crinkles drifting
                          in opposing fractional offsets, applied as a
                          tangential normal perturbation to catch razor
                          speculars; amplitude/speed scale EXPONENTIALLY
                          with churn
       - Beer–Lambert absorption I = I₀·e^(−σ·d): the view-ray chord
         through the smooth column is solved analytically at the hit
         point (quadratic), so the core saturates deep and rich (with an
         interior noise term for volumetric micro-shadow) while the
         tensioned edges stay glass-clear
       - refraction: GLSL refract() at water's true IoR 1.333 bends the
         ray; its exit displacement warps a live scene buffer (neon +
         ambient glow field) with per-channel chromatic aberration, and
         per-channel IoRs (1.345/1.333/1.318) disperse the env cubemap.
         True magnification/inversion falls out of the thickness term.
       - strict Schlick fresnel F = F₀ + (1−F₀)(1−V·N)⁵, F₀ = 0.02:
         silver-mirror silhouette at grazing angles, refractive clarity
         face-on; anti-aliased silhouette via the march's min-distance
       - NEON AS A LINEAR LIGHT: the tube is a line segment; the shader
         finds the closest point on it to each reflection ray (two-line
         closest-point closed form) so a pink sheen genuinely dances
         across the capillary ripples with inverse-square falloff and
         the tube's live flicker
       - kinematics: scroll velocity → heavy mass-spring-damper. An
         underdamped stretch spring thins the column under acceleration
         (conservation of mass) and pools it wider than rest when the
         scroll stops dead
       - droplets shear off above a velocity/acceleration threshold,
         inherit the parent node's instantaneous velocity, deform
         aerodynamically (sphere → trailing teardrop aligned to their
         velocity vector), fall under 9.81 m/s² scaled, and evaporate
       - requires WebGL2 (dynamic uniform-array indexing in fragment
         shaders); on WebGL1 the water skips itself and the neon stays

       - alongside the WebGL layer, a CSS backdrop-filter band (SVG
         feTurbulence/feDisplacementMap) rides under the water and
         distorts the page's own live pixels — real DOM refraction,
         which WebGL cannot do (browsers never expose page pixels to
         shaders); displacement amplitude breathes with scroll momentum.
         Desktop only.

   · NEON — high-voltage glass tube, mirrored opposite:
       - concentric cylinders: white-hot plasma core (high-frequency 3D
         turbulence) inside a glass jacket (Schlick fresnel @ IoR 1.5,
         env reflections, razor analytic glints, dispersion rim)
       - selective bloom, Unreal algorithm hand-rolled: core alone via
         camera.layers → 3-level gaussian mip pyramid → weighted
         additive composite (the examples/jsm UnrealBloomPass needs an
         EffectComposer that destroys this overlay's transparent-canvas
         alpha; this is the same mip-pyramid math)
       - organic hum + slot-hashed dropouts + scroll-surge flicker

   Loaded as a classic script; Three.js core only from CDN (no addons,
   no import maps). Respects prefers-reduced-motion. Fails silently
   without WebGL.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  import('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js')
    .then(init)
    .catch(function () { /* offline or blocked — the site lives without it */ });

  function init(THREE) {

    // ── Renderer / scene / camera ─────────────────────────────────
    var canvas = document.createElement('canvas');
    canvas.id = 'waterline';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;mix-blend-mode:screen;';
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    document.body.appendChild(canvas);

    // raymarch cost scales with DPR² — 1.75 is indistinguishable on a glow overlay
    var DPR = Math.min(window.devicePixelRatio || 1, isCoarse ? 1.5 : 1.75);
    renderer.setPixelRatio(DPR);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;

    var isGL2 = renderer.capabilities.isWebGL2 !== false;

    var scene = new THREE.Scene();
    var FOV = 35, CAMZ = 14;
    var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAMZ);
    camera.lookAt(0, 0, 0);

    // render layers: 0 = base scene, 1 = bloom source (plasma core),
    // 2 = refraction-pass extras (glow backdrop; core+jacket join it)
    var BLOOM_LAYER = 1, REFR_LAYER = 2;
    var MASK_REFR = (1 << BLOOM_LAYER) | (1 << REFR_LAYER);

    var halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMZ; // world half-height at z=0
    var halfW = halfH;                                              // corrected on resize

    // ── Theme (phosphor mode flips cyan → jade; neon mirrors magenta → amber) ──
    var COLORS = {
      cyan: { edge: new THREE.Color(0x00e5ff), deep: new THREE.Color(0x00394d), spark: new THREE.Color(0x9ff4ff) },
      jade: { edge: new THREE.Color(0x00ff88), deep: new THREE.Color(0x00402a), spark: new THREE.Color(0xa8ffd4) }
    };
    var NEON = {
      cyan: { core: new THREE.Color(0xff2fc9), hot: new THREE.Color(0xffd9f2), tint: new THREE.Color(0x330022) },
      jade: { core: new THREE.Color(0xffab1f), hot: new THREE.Color(0xfff0d0), tint: new THREE.Color(0x3a2400) }
    };
    function phosphor() { return document.body.classList.contains('phosphor'); }
    function theme() { return phosphor() ? COLORS.jade : COLORS.cyan; }
    function neonTheme() { return phosphor() ? NEON.jade : NEON.cyan; }

    // ══════════════════════════════════════════════════════════════
    // SCROLL RIG — mass-spring-damper hydrodynamics, dt-correct.
    //
    //   raw scroll ─→ scrollVel   (sensor low-pass, τ ≈ 80 ms)
    //   scrollVel  ─→ momentum    (fluid-mass low-pass, τ ≈ 330 ms —
    //                              the water feels the scroll LATE)
    //   page depth ─→ anchorTarget (where the stream wants to hang)
    //   target     ─→ anchorX     (underdamped spring, ζ ≈ 0.55 —
    //                              lags, slides, OVERSHOOTS on stop,
    //                              wobbles back: liquid suspension)
    //
    // Nothing binds to the scroll value directly, and every per-frame
    // force on the rope is hard-capped — a scroll jump of any size is a
    // bounded impulse, never a teleport.
    // ══════════════════════════════════════════════════════════════
    var lastScroll = window.pageYOffset, scrollVel = 0, scrollMomentum = 0;
    var prevMomentum = 0, scrollAccel = 0;
    // FIXED TIMESTEP: all spring/rope physics advances in exact 1/60 s
    // substeps fed by an accumulator (see the main loop). No dt ever
    // enters an integrator — frame stutter can shorten how much sim
    // time a render frame covers (slow motion), but a single physics
    // step is always the same size: velocity injections are bounded by
    // construction and the explicit integrators are unconditionally
    // inside their stability region. This replaces the old fN clamp.
    var PHYS_STEP = 1 / 60, MAX_SUBSTEPS = 3, physAcc = 0, lastP = 0;
    // PIXELS NEVER ENTER THE PHYSICS: scroll deltas are normalized to
    // viewport-height units at the sensor boundary (×VH_REF keeps the
    // constants' historical tuning, which assumed an ~800px viewport).
    // A 4K-tall window now applies the same force as a laptop.
    var VH_REF = 800;
    // underdamped stretch spring: >0 the water is being pulled thin,
    // <0 it has stopped and is pooling back wider than rest (overshoot)
    var stretch = 0, stretchV = 0;
    // churn: smoothed kinetic energy driving turbulence amplitude/speed
    var churn = 0;
    function docHeight() {
      var b = document.body, e = document.documentElement;
      return Math.max(b.scrollHeight, e.scrollHeight) - window.innerHeight;
    }
    function stepScroll() {                      // one fixed 1/60 s step
      var sc = window.pageYOffset;
      var dvPx = sc - lastScroll; lastScroll = sc;
      // pixel → viewport-normalized units, THEN bounded: an anchor-link
      // teleport of any size is a finite impulse
      var dv = dvPx / Math.max(window.innerHeight, 1) * VH_REF;
      if (dv > 900) dv = 900; else if (dv < -900) dv = -900;

      // sensor low-pass (τ ≈ 90 ms at the fixed step)
      scrollVel += (dv - scrollVel) * 0.18;
      // fluid mass: velocity → momentum through the heavy low-pass
      prevMomentum = scrollMomentum;
      scrollMomentum += (scrollVel - scrollMomentum) * 0.05;
      scrollAccel = scrollMomentum - prevMomentum;

      // stretch spring: velocity elongation + momentum pooling.
      // Lateral slosh (|scrollVel|) stretches the column too.
      var stTarget = Math.min(Math.abs(scrollMomentum) * 0.040 + Math.abs(scrollVel) * 0.05, 0.55);
      stretchV += (stTarget - stretch) * 0.018;
      stretchV *= 0.91;
      stretch += stretchV;
      if (stretch > 0.70) stretch = 0.70;
      if (stretch < -0.22) stretch = -0.22;

      // turbulence energy: scroll speed + slosh speed
      var churnTarget = Math.min(Math.abs(scrollMomentum) * 0.030 + Math.abs(scrollVel) * 0.04, 1.0);
      churn += (churnTarget - churn) * 0.06;

      return docHeight() > 0 ? sc / docHeight() : 0;
    }

    // ══════════════════════════════════════════════════════════════
    // MOUSE ↔ FLUID COUPLING — the cursor never touches the mesh.
    // It injects force into a velocity field: a gaussian pressure zone
    // around each recent cursor sample (a decaying WAKE ring-buffer)
    // transfers momentum ∝ cursor velocity into the spring-mass rope,
    // which then propagates it as waves. A hard per-node force cap
    // means no stroke can ever snap the column — energy beyond the cap
    // breaks surface tension into droplets instead (see stepMouseFluid).
    // ══════════════════════════════════════════════════════════════
    var mwx = 1e6, mwy = 1e6;                    // cursor, WORLD coords (raycast-resolved)
    var pmx = 1e6, pmy = 1e6;                    // previous cursor
    var mvxW = 0, mvyW = 0;                      // smoothed cursor velocity (world/frame)
    var pMvxW = 0, pMvyW = 0, mAccW = 0;         // cursor acceleration
    var WAKE_N = 7;                              // trailing wake samples
    var wakeX = new Float32Array(WAKE_N), wakeY = new Float32Array(WAKE_N);
    var wakeVX = new Float32Array(WAKE_N), wakeVY = new Float32Array(WAKE_N);
    var wakeAge = new Float32Array(WAKE_N);      // 0 = empty slot
    var wakeHead = 0, wakeTimer = 0;
    var splashCool = 0;
    var SURF_TENSION = 0.18;                     // stress threshold: v × (v + a)
    // the cursor-rock: a heavy, eased obstacle that BIFURCATES the
    // stream (SDF subtraction in columnSDF) instead of deflecting it
    var obX = 0, obY = -100, obS = 0, prevObS = 0, obR = 0.3;
    var mSpeedSm = 0, beadTimer = 0;

    // ══════════════════════════════════════════════════════════════
    // MOUSE → WORLD: raycast, not a fixed-camera formula. `stepCamera`
    // below drifts camera.position toward the mouse for a parallax
    // effect (and re-aims with lookAt every frame) — so the screen↔world
    // mapping is CONSTANTLY changing and is never the static camera the
    // old `(clientX/innerWidth*2-1)*halfW` formula assumed. Once the
    // camera drifted even slightly, that formula silently pointed at the
    // wrong world position: the rock-obstacle would engage somewhere
    // other than where the cursor visually sat over the column — the
    // "splits when the cursor is outside, not inside" bug. Raycasting
    // the real NDC point through whatever the camera is doing THIS
    // frame is correct regardless of how far it has drifted.
    // ══════════════════════════════════════════════════════════════
    var mouseNdcX = 1e6, mouseNdcY = 1e6;        // raw NDC from the DOM event, cheap to store
    var mouseRay = new THREE.Raycaster();
    var mouseNdcV = new THREE.Vector2();
    var mouseHitPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);  // the column/rock's z≈0 plane
    var mouseHitPt = new THREE.Vector3();
    function resolveMouseWorld(ndcX, ndcY) {
      // always raycast through the CURRENT camera transform, not a
      // cached/assumed one — this is what actually fixes the bug
      camera.updateMatrixWorld();
      mouseNdcV.set(ndcX, ndcY);
      mouseRay.setFromCamera(mouseNdcV, camera);
      if (mouseRay.ray.intersectPlane(mouseHitPlane, mouseHitPt)) {
        return mouseHitPt;
      }
      return null;
    }
    function updateMouseWorld() {
      if (isCoarse || mouseNdcX > 1e5) { mwx = 1e6; mwy = 1e6; return; }
      var hit = resolveMouseWorld(mouseNdcX, mouseNdcY);
      if (hit) { mwx = hit.x; mwy = hit.y; }
    }

    if (!isCoarse) {
      window.addEventListener('mousemove', function (e) {
        mouseNdcX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseNdcY = -((e.clientY / window.innerHeight) * 2 - 1);
      }, { passive: true });
      document.addEventListener('mouseleave', function () {
        mouseNdcX = 1e6; mouseNdcY = 1e6; mwx = 1e6; mwy = 1e6;
      }, { passive: true });
      window.addEventListener('click', function (e) {
        var ndcX = (e.clientX / window.innerWidth) * 2 - 1;
        var ndcY = -((e.clientY / window.innerHeight) * 2 - 1);
        var hit = resolveMouseWorld(ndcX, ndcY);
        if (!hit) return;
        var cx = hit.x, cy = hit.y;
        var i = nearestNode(cy, WN);
        if (i >= 0 && Math.abs(wsx[i] - cx) < 1.8) {
          // a click is a sharp strike: a CAPPED force spike enters the
          // rope (and travels it as a wave), while the excess energy
          // rips droplets off along the strike direction + stream fall
          var dirX = wsx[i] > cx ? 1 : -1;
          for (var j = Math.max(0, i - 3); j <= Math.min(WN - 1, i + 3); j++) {
            var fall = 1 - Math.abs(j - i) / 4;
            wvx[j] += dirX * 0.05 * fall;
          }
          shearSplash(wsx[i], nodeY(i, WN), wsz[i], dirX * 0.5, 0.18, 1.6, 12);
        }
      }, { passive: true });
    }

    // per-frame cursor kinematics: velocity, acceleration, wake, and the
    // surface-tension break test  (velocity × acceleration > threshold)
    function stepMouseFluid(dt) {
      if (isCoarse) return;
      if (mwx > 1e5) {
        // cursor left the window: the rock dissolves out of the stream
        obS *= 0.94;
        waterUniforms.uObsK.value = obS;
        return;
      }
      if (pmx < 1e5) {
        mvxW += ((mwx - pmx) - mvxW) * 0.35;
        mvyW += ((mwy - pmy) - mvyW) * 0.35;
      }
      mAccW = Math.abs(mvxW - pMvxW) + Math.abs(mvyW - pMvyW);
      pMvxW = mvxW; pMvyW = mvyW;
      pmx = mwx; pmy = mwy;

      // record a wake sample every ~35 ms — the stroke's trailing history
      wakeTimer += dt;
      if (wakeTimer > 0.035) {
        wakeTimer = 0;
        wakeX[wakeHead] = mwx; wakeY[wakeHead] = mwy;
        wakeVX[wakeHead] = mvxW; wakeVY[wakeHead] = mvyW;
        wakeAge[wakeHead] = 0.0001;
        wakeHead = (wakeHead + 1) % WAKE_N;
      }
      for (var k = 0; k < WAKE_N; k++) if (wakeAge[k] > 0) wakeAge[k] += dt;

      var iN = nearestNode(mwy, WN);
      if (iN >= 0) {
        var dxc = wsx[iN] - mwx;
        var prox = Math.exp(-dxc * dxc * 1.2);       // how deep the stroke cuts
        // micro-eddies: lateral strokes through the column spin it
        wTwistV += mvxW * prox * 0.0016;

        // SURFACE-TENSION BREAK: stress = |v| × (|v| + |a|) at the column.
        // Slow strokes deform; fast, accelerating strikes shear droplets.
        var mSpeed = Math.sqrt(mvxW * mvxW + mvyW * mvyW);
        var stress = mSpeed * (mSpeed * 0.6 + mAccW * 2.2) * prox;
        if (stress > SURF_TENSION && splashCool <= 0) {
          splashCool = 0.06;
          var n = Math.min(3 + Math.floor(stress / SURF_TENSION * 3), 14);
          shearSplash(wsx[iN], nodeY(iN, WN), wsz[iN], mvxW, mvyW,
                      Math.min(stress / SURF_TENSION, 2.5), n);
        }
      }
      splashCool -= dt;

      // ── THE ROCK IN THE RIVER: eased obstacle → SDF bifurcation ──
      prevObS = obS;
      obX += (mwx - obX) * 0.22;                    // the rock has mass —
      obY += (mwy - obY) * 0.22;                    // it never teleports
      var mSp = Math.sqrt(mvxW * mvxW + mvyW * mvyW);
      mSpeedSm += (mSp - mSpeedSm) * 0.2;
      var iO = nearestNode(obY, WN);
      var eng = 0;
      if (iO >= 0) {
        var dxo = Math.abs(wsx[iO] - obX);
        var raw = Math.max(0, 1 - dxo / (radiusWorld * 2.4));
        eng = raw * raw * (3 - 2 * raw);            // smooth engagement
      }
      // eases in with fluid mass, releases even slower (cohesion)
      obS += (eng - obS) * (eng > obS ? 0.10 : 0.06);
      // the rock must be NARROWER than the stream — a river only parts
      // around an obstacle it can flow past; the venturi flare in the
      // SDF supplies the displaced volume to the two branches
      obR = radiusWorld * (0.66 + Math.min(mSpeedSm * 1.2, 0.34));
      waterUniforms.uObs.value.set(obX, obY, 0, obR);
      waterUniforms.uObsK.value = obS;

      // impact spray: slamming the rock into the stream launches
      // refractive droplets up + outward from the stagnation point,
      // carrying the strike vector against the downward flow
      if (obS - prevObS > 0.035 && obS > 0.25 && splashCool <= 0) {
        splashCool = 0.10;
        shearSplash(obX, obY + obR * 0.8, iO >= 0 ? wsz[iO] : 0,
                    mvxW * 0.8 + (Math.random() - 0.5) * 0.2,
                    0.55 + Math.abs(mvyW) * 0.5,
                    1.3 + mSpeedSm * 1.5, 10);
      }
      // vortex-street cavitation: while the rock sits in the stream, the
      // two trailing inner edges shed small short-lived fluid beads into
      // the low-pressure pocket before the branches merge downstream
      beadTimer -= dt;
      if (obS > 0.45 && beadTimer <= 0 && dPos.length < MAXD) {
        beadTimer = 0.05;
        var bFall = 1.6 + Math.min(Math.abs(scrollMomentum) * 0.06, 2.4);
        for (var b = 0; b < 2 && dPos.length < MAXD; b++) {
          var sideB = b === 0 ? 1 : -1;
          dPos.push(new THREE.Vector3(
            obX + sideB * obR * (0.55 + Math.random() * 0.35),
            obY - obR * (0.9 + Math.random() * 1.6),
            (iO >= 0 ? wsz[iO] : 0) + (Math.random() - 0.5) * 0.08));
          dVel.push(new THREE.Vector3(
            sideB * (0.2 + Math.random() * 0.5) + mvxW * 4.0,
            -bFall * (0.7 + Math.random() * 0.6),
            (Math.random() - 0.5) * 0.5));
          dLife.push(0.30 + Math.random() * 0.25);   // short-lived: they re-merge
          dSize.push(0.007 + Math.random() * 0.014); // tiny cavitation beads
        }
      }
    }

    var TOPY, BOTY;
    function spanY() { TOPY = halfH + 2.5; BOTY = -halfH - 2.5; }
    spanY();
    function nodeY(i, n) { return TOPY + (BOTY - TOPY) * (i / (n - 1)); }
    function nearestNode(y, n) {
      var t = (y - TOPY) / (BOTY - TOPY);
      if (t < -0.1 || t > 1.1) return -1;
      return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
    }

    var GLSL_NOISE = `
      vec3 phash(vec3 p){
        p = vec3(dot(p, vec3(127.1, 311.7,  74.7)),
                 dot(p, vec3(269.5, 183.3, 246.1)),
                 dot(p, vec3(113.5, 271.9, 124.6)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }
      float snoise(vec3 p){
        vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
        return mix(mix(mix(dot(phash(i+vec3(0,0,0)), f-vec3(0,0,0)), dot(phash(i+vec3(1,0,0)), f-vec3(1,0,0)), u.x),
                       mix(dot(phash(i+vec3(0,1,0)), f-vec3(0,1,0)), dot(phash(i+vec3(1,1,0)), f-vec3(1,1,0)), u.x), u.y),
                   mix(mix(dot(phash(i+vec3(0,0,1)), f-vec3(0,0,1)), dot(phash(i+vec3(1,0,1)), f-vec3(1,0,1)), u.x),
                       mix(dot(phash(i+vec3(0,1,1)), f-vec3(0,1,1)), dot(phash(i+vec3(1,1,1)), f-vec3(1,1,1)), u.x), u.y), u.z);
      }`;

    // ══════════════════════════════════════════════════════════════
    // PROCEDURAL DARK ENVIRONMENT CUBEMAP — reflections for both threads
    // ══════════════════════════════════════════════════════════════
    var cubeRT = new THREE.WebGLCubeRenderTarget(128);
    var cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
    function glint(sceneObj, color, pos, size) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color: color }));
      m.position.copy(pos);
      sceneObj.add(m);
    }
    function refreshEnv() {
      var c = theme(), nc = neonTheme();
      var envScene = new THREE.Scene();
      var skyGeo = new THREE.SphereGeometry(40, 20, 14);
      var pos = skyGeo.attributes.position;
      var colors = new Float32Array(pos.count * 3);
      var top = new THREE.Color(0x060a14), bot = new THREE.Color(0x000000);
      for (var i = 0; i < pos.count; i++) {
        var f = pos.getY(i) / 40 * 0.5 + 0.5;
        var col = bot.clone().lerp(top, Math.pow(f, 1.4));
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
      skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      envScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      glint(envScene, new THREE.Color(0xdff4ff), new THREE.Vector3(4, 22, 7), 2.4);   // key softbox
      glint(envScene, c.edge, new THREE.Vector3(11, 15, -18), 3.4);
      glint(envScene, c.spark, new THREE.Vector3(-17, 5, -9), 2.0);
      glint(envScene, nc.core, new THREE.Vector3(6, -12, 13), 2.8);
      cubeCam.update(renderer, envScene);
    }
    refreshEnv();

    // ══════════════════════════════════════════════════════════════
    // REFRACTION BUFFER — what the water bends. Holds the neon tube and
    // a procedural glow-field standing in for the page's own ambient
    // light, rendered from the live camera each frame at half res.
    // (Browsers never expose live DOM pixels to WebGL; the CSS
    // backdrop-filter band below is what bends the actual page.)
    // ══════════════════════════════════════════════════════════════
    var refrRT = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
    });

    var backUniforms = {
      uTime:   { value: 0 },
      uEdge:   { value: theme().edge.clone() },
      uNeon:   { value: neonTheme().core.clone() },
      uNeonI:  { value: 1 },
      uNeonX:  { value: -0.6 },   // NDC-ish x of the tube, so its wash tracks it
      uWaterX: { value: 0.6 }
    };
    var backMat = new THREE.ShaderMaterial({
      uniforms: backUniforms,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime, uNeonI, uNeonX, uWaterX;
        uniform vec3 uEdge, uNeon;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          vec3 c = vec3(0.004, 0.007, 0.011);
          // theme glows roaming near the water so the lens always has light to bend
          vec2 g1 = vec2(uWaterX + sin(uTime*0.05)*0.18, 0.35 + cos(uTime*0.04)*0.22);
          vec2 g2 = vec2(uWaterX * 0.8, -0.5 + sin(uTime*0.03)*0.18);
          c += uEdge * exp(-dot(p-g1, p-g1) * 2.0) * 0.17;
          c += uEdge * exp(-dot(p-g2, p-g2) * 2.8) * 0.11;
          // the neon's own atmospheric wash, flicker-linked
          vec2 g3 = vec2(uNeonX, 0.1);
          c += uNeon * exp(-dot(p-g3, p-g3) * 1.5) * 0.15 * uNeonI;
          // drifting aurora band — structure for the refraction to chew on
          float band = snoise(vec3(p.x*1.4, p.y*2.2 - uTime*0.05, uTime*0.04));
          c += mix(uEdge, uNeon, 0.35) * smoothstep(0.15, 0.75, band) * 0.05;
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    var backPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backMat);
    backPlane.position.z = -4;
    backPlane.layers.set(REFR_LAYER);
    backPlane.frustumCulled = false;
    scene.add(backPlane);
    function sizeBackPlane() {
      var dist = CAMZ + 4;
      var h = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * dist;
      backPlane.scale.set(h * camera.aspect, h, 1);
    }

    // ══════════════════════════════════════════════════════════════
    // WATER — spine physics (heavy / laggy). The CPU spring chain IS the
    // simulation pass: 48 spring-mass nodes, rope-coupled, twice-relaxed,
    // packed into a vec4 uniform array the SDF consumes per march step.
    // ══════════════════════════════════════════════════════════════
    var WN = 48;
    var wsx = new Float32Array(WN), wsz = new Float32Array(WN);
    var wvx = new Float32Array(WN), wvz = new Float32Array(WN);
    var wspd = new Float32Array(WN), wtw = new Float32Array(WN);
    var spinePack = new Float32Array(WN * 4);          // x, z, |v|, twist per node
    // wAnchorX is now the FIXED vertical line the stream hangs on — it no
    // longer scrolls. waveAmp is the live winding energy (eased from churn).
    var wAnchorX = 0, wAnchorTarget = 0, wTwist = 0, wTwistV = 0, wFlow = 0, waveAmp = 0;

    var W_KREST = 0.05, W_KROPE = 0.24, W_DAMP = 0.962;

    function stepWaterSpine(t, p) {              // one fixed 1/60 s step
      // The anchor line is FIXED (set on resize). The stream no longer
      // translates with scroll; instead its endpoints are pinned and a
      // travelling wave winds the body between them.
      var XR = wAnchorX;

      // twist: CAPPED — sustained hard scrolling once wound the noise
      // domain up to ~4 rad/frame and spun the surface like a drill.
      wTwistV += scrollMomentum * 0.00026;
      if (wTwistV > 0.04) wTwistV = 0.04; else if (wTwistV < -0.04) wTwistV = -0.04;
      wTwistV *= 0.94;
      wTwist += wTwistV;
      if (wTwist > 2.5) wTwist = 2.5; else if (wTwist < -2.5) wTwist = -2.5;

      // flow speeds up under load, from a slow viscous base
      wFlow += PHYS_STEP * (0.5 + Math.min(Math.abs(scrollMomentum) * 0.030 + Math.abs(scrollVel) * 0.04, 2.0));

      // WINDING ENERGY: a scroll impulse swells the travelling-wave
      // amplitude, which then eases back out — the "heavy fluid rope"
      // keeps snaking for a beat after the scroll stops.
      var waveTarget = Math.min(churn * 0.9 + Math.abs(scrollMomentum) * 0.012, 1.0);
      waveAmp += (waveTarget - waveAmp) * 0.06;

      var i;
      for (i = 0; i < WN; i++) {
        var v = i / (WN - 1);
        // ── PINNED BOUNDARY ENVELOPE ──
        // sin(π · screenV): exactly 0 where the stream crosses the top
        // and bottom SCREEN edges (entry/exit locked), rising to 1 at
        // mid-viewport. All lateral motion is multiplied by this, so the
        // fluid can only wind in the middle and tapers to zero at the
        // fixed source points.
        var sv = (halfH - nodeY(i, WN)) / (2.0 * halfH);
        sv = sv < 0 ? 0 : (sv > 1 ? 1 : sv);
        var env = Math.sin(Math.PI * sv);
        // ── ORGANIC RIVER WINDING ──  X = A·sin(k·v − ω·t), summed:
        // a slow idle snake always alive, plus faster/bigger waves whose
        // amplitude scales with the live scroll energy. Every term travels
        // DOWNWARD (−ω·t) so a bend births at the top and rolls to the
        // bottom like a rope loaded under gravity.
        var wind = Math.sin(v * 3.4 - t * 0.60)        * 0.050
                 + Math.sin(v * 6.1 - t * 0.90 + 1.7)  * 0.025
                 + Math.sin(v * 7.4 - t * 2.60)        * waveAmp * 0.110
                 + Math.sin(v * 11.0 - t * 3.90 + 0.6) * waveAmp * 0.055;
        var restX = XR + env * halfW * wind;
        wvx[i] += (restX - wsx[i]) * W_KREST;
        // z winds too (enveloped), for out-of-plane snake depth
        var restZ = env * (Math.sin(v * 4.4 - t * 0.5) * 0.30
                         + Math.sin(v * 8.0 - t * 1.1) * waveAmp * 0.45);
        wvz[i] += (restZ - wsz[i]) * W_KREST * 0.8;
        if (!isCoarse) {
          // ── fluid force injection from the cursor's wake field ──
          var fx = 0, fz = 0, ny = nodeY(i, WN);
          for (var k = 0; k < WAKE_N; k++) {
            if (wakeAge[k] <= 0 || wakeAge[k] > 0.6) continue;
            var wdx = wsx[i] - wakeX[k], wdy = ny - wakeY[k];
            var kern = Math.exp(-(wdx * wdx + wdy * wdy) * 1.3);   // gaussian pressure zone
            if (kern < 0.01) continue;
            var decay = Math.exp(-wakeAge[k] * 5.0);               // trailing wake dies out
            // momentum transfer: water is CARRIED along the stroke,
            // not shoved away from the cursor
            fx += wakeVX[k] * 0.14 * kern * decay;
            // pressure dipole: vertical strokes part the water
            // around the cursor's path (opposite signs above/below)
            fx += -wakeVY[k] * (wdy > 0 ? 1 : -1) * 0.05 * kern * decay;
            // displaced volume puffs toward the camera
            fz += (Math.abs(wakeVX[k]) + Math.abs(wakeVY[k])) * 0.05 * kern * decay;
          }
          // static pressure standoff: a hovering cursor gently dents
          // the stream — it can never fling it
          var sdx = wsx[i] - mwx, sdy = ny - mwy;
          var sd2 = sdx * sdx + sdy * sdy;
          if (sd2 < 2.6) {
            var sd = Math.sqrt(sd2) || 0.001;
            fx += (sdx / sd) * (1 - sd / 1.62) * 0.0065;
          }
          // fluid force cap — the physical illusion's guarantee: no
          // stroke can snap the column; the spring rope has to carry
          // everything as propagating waves. Excess energy became
          // droplets in stepMouseFluid's surface-tension break.
          if (fx > 0.05) fx = 0.05; else if (fx < -0.05) fx = -0.05;
          if (fz > 0.04) fz = 0.04;
          // while the rock is seated in the stream, sideways deflection
          // yields to BIFURCATION — the SDF carve parts the water around
          // the cursor instead of the whole column swinging away
          var obDamp = 1 - obS * 0.7;
          wvx[i] += fx * obDamp;
          wvz[i] += fz * obDamp;
        }
      }
      for (var pass = 0; pass < 2; pass++) {
        for (i = 0; i < WN; i++) {
          var l = i > 0 ? wsx[i - 1] : wsx[i], r = i < WN - 1 ? wsx[i + 1] : wsx[i];
          wvx[i] += ((l + r) * 0.5 - wsx[i]) * W_KROPE;
          var lz = i > 0 ? wsz[i - 1] : wsz[i], rz = i < WN - 1 ? wsz[i + 1] : wsz[i];
          wvz[i] += ((lz + rz) * 0.5 - wsz[i]) * W_KROPE;
        }
      }
      // ── integrate + THE BACKSTOP: whatever any upstream force does,
      // the rendered column is hard-bounded here. Velocity can never
      // exceed VCAP world/step (~20px/frame) and position can never
      // stray more than DEV (~12% of the half-viewport) from the
      // anchor — visual teleportation is structurally impossible.
      // ── integrate + ENVELOPED BACKSTOP: the max lateral excursion is
      // itself gated by sin(π·screenV), so it is ~0 at the pinned ends
      // and widest mid-viewport. Even a pathological force can't unpin
      // the top or bottom of the stream.
      var DEVMAX = halfW * 0.24, VCAP = 0.22;
      for (i = 0; i < WN; i++) {
        var sv2 = (halfH - nodeY(i, WN)) / (2.0 * halfH);
        sv2 = sv2 < 0 ? 0 : (sv2 > 1 ? 1 : sv2);
        var envc = Math.sin(Math.PI * sv2);
        wvx[i] *= W_DAMP; wvz[i] *= W_DAMP;
        if (wvx[i] > VCAP) wvx[i] = VCAP; else if (wvx[i] < -VCAP) wvx[i] = -VCAP;
        if (wvz[i] > VCAP) wvz[i] = VCAP; else if (wvz[i] < -VCAP) wvz[i] = -VCAP;
        wsx[i] += wvx[i]; wsz[i] += wvz[i];
        var dev = DEVMAX * envc + 0.002;
        if (wsx[i] > wAnchorX + dev) { wsx[i] = wAnchorX + dev; wvx[i] *= 0.4; }
        else if (wsx[i] < wAnchorX - dev) { wsx[i] = wAnchorX - dev; wvx[i] *= 0.4; }
        var zlim = 1.4 * envc + 0.02;
        if (wsz[i] > zlim) { wsz[i] = zlim; wvz[i] *= 0.4; }
        else if (wsz[i] < -zlim) { wsz[i] = -zlim; wvz[i] *= 0.4; }
        wspd[i] = Math.sqrt(wvx[i] * wvx[i] + wvz[i] * wvz[i]);
        wtw[i] = wTwist * (0.3 + 0.7 * v_frac(i));
        spinePack[i * 4]     = wsx[i];
        spinePack[i * 4 + 1] = wsz[i];
        spinePack[i * 4 + 2] = wspd[i];
        spinePack[i * 4 + 3] = wtw[i];
      }
      // ── STRICT DIRICHLET BOUNDARY CONDITION: nail the exact endpoints
      // to the fixed line. ΔX = 0 at the top and bottom source points,
      // no matter what the rope, mouse, or scroll did this step.
      wsx[0] = wAnchorX; wvx[0] = 0; wsz[0] = 0; wvz[0] = 0;
      wsx[WN - 1] = wAnchorX; wvx[WN - 1] = 0; wsz[WN - 1] = 0; wvz[WN - 1] = 0;
      spinePack[0] = wAnchorX; spinePack[1] = 0; spinePack[2] = 0; spinePack[3] = wtw[0];
      spinePack[(WN - 1) * 4] = wAnchorX; spinePack[(WN - 1) * 4 + 1] = 0;
      spinePack[(WN - 1) * 4 + 2] = 0; spinePack[(WN - 1) * 4 + 3] = wtw[WN - 1];
    }
    function v_frac(i) { return i / (WN - 1); }

    // ══════════════════════════════════════════════════════════════
    // THE VOLUME — raymarched SDF water column (WebGL2 only)
    // ══════════════════════════════════════════════════════════════
    var radiusWorld = halfH * 0.052;
    var MARCH_STEPS = isCoarse ? 28 : 44;

    var waterUniforms = {
      uSpine:   { value: spinePack },
      uObs:     { value: new THREE.Vector4(0, -100, 0, 0.3) },   // rock starts far offscreen
      uObsK:    { value: 0 },
      uTopY:    { value: TOPY }, uBotY: { value: BOTY },
      uRadius:  { value: radiusWorld },
      uStretch: { value: 0 }, uFlow: { value: 0 }, uTime: { value: 0 },
      uChurn:   { value: 0 }, uVel: { value: 0 },
      uRes:     { value: new THREE.Vector2(1, 1) },
      uBoxMin:  { value: new THREE.Vector3(-1, -1, -1) },
      uBoxMax:  { value: new THREE.Vector3(1, 1, 1) },
      uEdge:    { value: theme().edge.clone() },
      uDeep:    { value: theme().deep.clone() },
      uSpark:   { value: theme().spark.clone() },
      uEnv:     { value: cubeRT.texture },
      uRefr:    { value: refrRT.texture },
      uNeonCol: { value: neonTheme().core.clone() },
      uNeonPos: { value: new THREE.Vector3(-halfW * 0.55, 0, 0) },
      uNeonI:   { value: 1 }
    };

    var waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      vertexShader: `
        varying vec3 vWorld;
        void main(){
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: `
        uniform vec4 uSpine[${WN}];              // (x, z, |v|, twist), top → bottom
        uniform vec4 uObs;                       // the cursor-rock: (x, y, unused, radius)
        uniform float uObsK;                     // rock engagement 0..1 (eased, massive)
        uniform float uTopY, uBotY, uRadius, uStretch, uFlow, uTime, uChurn, uVel, uNeonI;
        uniform vec2 uRes;
        uniform vec3 uBoxMin, uBoxMax;
        uniform vec3 uEdge, uDeep, uSpark, uNeonCol, uNeonPos;
        uniform samplerCube uEnv;
        uniform sampler2D uRefr;
        varying vec3 vWorld;
        ${GLSL_NOISE}

        // spine sample at world height y — the SDF's moving centerline
        vec4 spineAt(float y){
          float u = clamp((uTopY - y) / (uTopY - uBotY), 0.0, 1.0);
          float fi = u * ${WN - 1}.0;
          int i0 = int(fi);
          int i1 = min(i0 + 1, ${WN - 1});
          return mix(uSpine[i0], uSpine[i1], fi - float(i0));
        }

        // smooth (noise-free) column radius at a node sample
        float smoothRadius(float y, float spd){
          float yn = clamp((uTopY - y) / (uTopY - uBotY), 0.0, 1.0);
          float taper = 0.82 + 0.18 * sin(yn * 3.14159);
          float pinch = (1.0 - min(spd * 1.6, 0.45)) * (1.0 - uStretch * 0.45);
          return uRadius * taper * pinch;
        }

        // f(p): generalized-cylinder SDF displaced by fBm tiers 1+2,
        // with the cursor-rock carved out of it by smooth CSG subtraction
        float columnSDF(vec3 p, out float spd){
          vec4 s = spineAt(p.y);
          spd = s.z;
          vec2 q = p.xz - s.xy;
          float ang = atan(q.y, q.x) + s.w;
          float yn = clamp((uTopY - p.y) / (uTopY - uBotY), 0.0, 1.0);
          float R = smoothRadius(p.y, spd);
          // exponential churn response: laminar glass → violent turbulence
          float turb = exp(uChurn * 1.2) - 1.0;

          // ── obstacle flow-field factors around the cursor-rock ──
          float dy = p.y - uObs.y;
          float ow = uObs.w;
          vec2  od = p.xy - uObs.xy;               // screen-plane offset from cursor
          // venturi channels squeezing past the rock's flanks…
          float chan = uObsK * exp(-(dy * dy) / (ow * ow * 1.44));
          // …and the low-pressure wake pocket directly beneath it
          float wake = dy < 0.0 ? uObsK * exp(dy / (ow * 2.6)) : 0.0;

          // TIER 1 — MACRO turbulence: large scale, slow; the heavy weave
          float n1 = snoise(vec3(cos(ang) * 1.6, sin(ang) * 1.6, yn * 9.0 - uFlow * 1.8));
          // TIER 2 — MESO shear: waves stretch along Y as velocity rises,
          // and stretch + accelerate further through the venturi channels
          float yFreq = mix(24.0, 7.0, min(uVel + uChurn * 0.5, 1.0)) / (1.0 + chan * 0.9);
          float n2 = snoise(vec3(cos(ang) * 4.0 + 3.7, sin(ang) * 4.0, yn * yFreq - uFlow * (3.2 + chan * 4.5)));
          // von Kármán vortex street: the wake's inner edges shred violently
          float vort = wake > 0.003
            ? snoise(vec3(p.x * 7.0, p.y * 9.0 - uFlow * 9.0, uTime * 2.5)) * wake
            : 0.0;
          // stagnation bow-wave: flow piles into a crest against the
          // rock's upstream face before parting around it
          // (squared manually — pow(negative, 2.0) is undefined in GLSL
          // and NaN-poisons the whole SDF on ANGLE)
          float bt = (dy - ow * 1.05) / (ow * 0.85);
          float bow = uObsK * exp(-bt * bt);
          // VENTURI VOLUME CONSERVATION: the water the rock displaces has
          // to go somewhere — the column BULGES outward around the cursor
          // (gaussian in y, centred on the cursor), fattening the two side
          // branches so they read as pressurised channels, not slivers.
          float bulge = uObsK * exp(-(dy * dy) / (ow * ow * 2.2));
          R *= 1.0 + n1 * 0.20 + n2 * (0.07 + 0.10 * turb) + bow * 0.28 + vort * 0.22 + bulge * 0.55;
          float d = length(q) - R;

          // ── TRUE BIFURCATION: f = smax(f_stream, −f_rock). The rock is
          // a solid cylinder along the VIEW AXIS (its distance uses only
          // the screen-plane offset od = p.xy − cursor, NO z term), so it
          // punches straight THROUGH the column depth — the hole is
          // visible head-on instead of being buried mid-stream. Its
          // cross-section is a teardrop: a rounded upstream shoulder and a
          // long tail downstream, where cohesive surface tension eases the
          // two branches back together into one column, leaving a hollow
          // air pocket directly beneath the cursor. ──
          if (uObsK > 0.01) {
            float k2 = max(uObsK, 0.001);
            float rx = ow * k2;                                  // half-width across the flow
            float ry = ow * k2 * (dy < 0.0 ? 3.2 : 1.15);       // long tail below, round top
            vec2  e  = vec2(od.x / rx, dy / ry);
            // approximate 2D ellipse SDF — large-positive outside the
            // teardrop (no spurious carve along the axis), negative inside
            float dObs = (length(e) - 1.0) * min(rx, ry);
            float kS = ow * 0.55;                                // smooth-blend width
            float h = clamp(0.5 + 0.5 * (d + dObs) / kS, 0.0, 1.0);
            d = mix(-dObs, d, h) + kS * h * (1.0 - h);           // smax(d, −dObs)
          }
          return d;
        }

        // TIER 3 — MICRO capillary field: opposing fractional drifts
        float microField(vec3 p, float sp){
          return snoise(p * 14.0 + vec3( 0.08, -0.12,  0.05) * uTime * 7.0 * sp)
           + 0.6 * snoise(p * 31.0 + vec3(-0.05,  0.09, -0.07) * uTime * 9.5 * sp);
        }

        vec2 boxHit(vec3 ro, vec3 rd, vec3 mn, vec3 mx){
          vec3 t1 = (mn - ro) / rd;
          vec3 t2 = (mx - ro) / rd;
          vec3 tn = min(t1, t2), tf = max(t1, t2);
          return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
        }

        void main(){
          vec3 ro = cameraPosition;
          vec3 rd = normalize(vWorld - ro);
          vec2 tt = boxHit(ro, rd, uBoxMin, uBoxMax);
          float t = max(tt.x, 0.0);
          float tEnd = tt.y;
          if (tEnd <= t) discard;

          // ── sphere-trace the SDF (relaxed: field is non-exact under
          //    bend + displacement, so under-step for safety)
          float spd = 0.0, d = 1e9, dMin = 1e9;
          bool hit = false;
          vec3 p = ro;
          for (int i = 0; i < ${MARCH_STEPS}; i++){
            p = ro + rd * t;
            d = columnSDF(p, spd);
            dMin = min(dMin, d);
            if (d < 0.0025) { hit = true; break; }
            t += d * 0.72;
            if (t > tEnd) break;
          }
          if (!hit){
            // anti-aliased silhouette: the march's closest approach
            // becomes a whisper-thin surface-tension halo
            float halo = smoothstep(0.045, 0.0, dMin);
            if (halo < 0.03) discard;
            gl_FragColor = vec4(uEdge * 0.25 * halo, halo * 0.16);
            return;
          }

          // ── N = normalize(∇f): tetrahedral gradient of the SDF
          float _s;
          vec2 eN = vec2(0.006, -0.006);
          vec3 N = normalize(
              eN.xyy * columnSDF(p + eN.xyy, _s) +
              eN.yyx * columnSDF(p + eN.yyx, _s) +
              eN.yxy * columnSDF(p + eN.yxy, _s) +
              eN.xxx * columnSDF(p + eN.xxx, _s));

          // ── obstacle flow factors at the hit point: venturi channels
          //    beside the rock, cavitating wake pocket beneath it
          float dyH = p.y - uObs.y;
          float wakeH = dyH < 0.0 ? uObsK * exp(dyH / (uObs.w * 2.6)) : 0.0;
          float chanH = uObsK * exp(-(dyH * dyH) / (uObs.w * uObs.w * 1.44));

          // ── micro-capillary crinkles → tangential normal perturbation;
          //    ripples speed up through the venturi, churn in the wake
          float msp = 1.0 + uChurn * 2.2 + chanH * 1.3;
          float m0 = microField(p, msp);
          float me = 0.02;
          vec3 mg = vec3(
            microField(p + vec3(me, 0.0, 0.0), msp) - m0,
            microField(p + vec3(0.0, me, 0.0), msp) - m0,
            microField(p + vec3(0.0, 0.0, me), msp) - m0) / me;
          vec3 mgT = mg - N * dot(mg, N);
          N = normalize(N + mgT * (0.035 + 0.045 * uChurn + 0.05 * wakeH));

          vec3 V = -rd;
          float cosNV = max(dot(N, V), 0.0);

          // ── Beer–Lambert depth: analytic chord of the view ray through
          //    the smooth column at the hit point (exact quadratic)
          vec4 sh = spineAt(p.y);
          vec2 q2 = p.xz - sh.xy;
          float R2 = smoothRadius(p.y, sh.z);
          float rl = length(rd.xz);
          vec2 rdn = rd.xz / max(rl, 1e-4);
          float bq = dot(q2, rdn);
          float cq = dot(q2, q2) - R2 * R2;
          float hq = bq * bq - cq;
          float thick = hq > 0.0 ? max(sqrt(hq) - bq, 0.0) / max(rl, 0.30) : 0.0;
          thick = min(thick, R2 * 4.0);
          // interior micro-shadow: a slow volumetric tone inside the core
          vec3 midP = p + rd * thick * 0.5;
          float inner = snoise(vec3(midP.x * 2.0, midP.y * 1.2 - uFlow * 1.5, midP.z * 2.0));
          vec3 sigma = vec3(3.0, 1.15, 0.52) * (1.0 + inner * 0.22);
          vec3 transmit = exp(-sigma * thick * 2.1);       // I = I₀·e^(−σd)

          // ── refraction @ IoR 1.333: refract() the actual ray, displace
          //    the scene-buffer lookup by the exit shift × thickness —
          //    magnification and inversion fall out naturally
          vec3 rf = refract(rd, N, 1.0 / 1.333);
          if (dot(rf, rf) < 1e-5) rf = reflect(rd, N);     // total internal reflection guard
          vec2 suv = gl_FragCoord.xy / uRes;
          vec2 shift = (rf.xy - rd.xy) * thick * 0.9 - N.xy * 0.05 * thick;
          vec3 refrCol;
          refrCol.r = texture2D(uRefr, suv + shift * 0.92).r;   // chromatic aberration:
          refrCol.g = texture2D(uRefr, suv + shift).g;          // per-channel lookup offsets
          refrCol.b = texture2D(uRefr, suv + shift * 1.08).b;
          refrCol = refrCol * 2.0 * transmit + uDeep * min(thick, 1.0) * 0.45;
          // world-behind dispersion: per-channel physical IoR through the cubemap
          vec3 rR = refract(rd, N, 1.0 / 1.345);
          vec3 rG = refract(rd, N, 1.0 / 1.333);
          vec3 rB = refract(rd, N, 1.0 / 1.318);
          refrCol += vec3(textureCube(uEnv, rR).r,
                          textureCube(uEnv, rG).g,
                          textureCube(uEnv, rB).b) * 0.40 * transmit;

          // ── strict Schlick fresnel, F₀ = ((1.333−1)/(1.333+1))² ≈ 0.02
          float F = 0.02 + 0.98 * pow(1.0 - cosNV, 5.0);
          float rim = pow(1.0 - cosNV, 3.0);

          // ── environment reflection + crisp analytic key strip
          vec3 Rv = reflect(rd, N);
          vec3 env = textureCube(uEnv, Rv).rgb;
          env += vec3(0.85, 0.93, 1.0) * pow(max(dot(Rv, normalize(vec3(0.30, 0.90, 0.32))), 0.0), 48.0) * 1.2;

          // ── key specular + razor glints riding the capillary tier
          vec3 L1 = normalize(vec3(0.5, 0.85, 0.65));
          float s1 = pow(max(dot(reflect(-L1, N), V), 0.0), 160.0);
          float glint = smoothstep(0.55, 0.95, m0) * s1 * 2.5 * (1.0 + chanH * 1.2);

          // ── NEON AS A LINEAR LIGHT: closest point on the tube's axis
          //    to the reflection ray (two-line closest-point, closed form)
          //    → the pink sheen tracks and dances across the ripples
          vec3 Aq = vec3(uNeonPos.x, 0.0, uNeonPos.z);
          vec3 w0 = p - Aq;
          float bL = Rv.y;                      // dot(Rv, axis), axis = +Y
          float dL = dot(Rv, w0);
          float eL = w0.y;
          float denomL = max(1.0 - bL * bL, 1e-4);
          float sLine = (eL - bL * dL) / denomL;
          sLine = clamp(sLine, uBotY, uTopY);
          vec3 Lp = vec3(Aq.x, sLine, Aq.z);
          vec3 Ld = normalize(Lp - p);
          float distL = length(vec2(p.x - Aq.x, p.z - Aq.z));
          float atten = 1.0 / (1.0 + distL * distL * 0.05);
          float nSpec = pow(max(dot(Rv, Ld), 0.0), 48.0);
          float nWash = max(dot(N, Ld), 0.0);
          vec3 neonTerm = uNeonCol * (nSpec * 1.4 + nWash * 0.05) * atten * uNeonI;

          vec3 col = refrCol * (1.0 - F)
                   + env * F * 1.9
                   + uEdge * rim * 0.26
                   + uSpark * (s1 * 1.2 + glint)
                   + neonTerm
                   + uEdge * min(spd * 1.6, 0.35);
          // spectral fringe hugging the silhouette
          col += vec3(pow(rim, 6.0), pow(rim, 4.0) * 0.5, pow(rim, 3.0)) * 0.10;

          // volumetric alpha: thickness carries the body, fresnel the rim;
          // grazing silhouette pushes toward the near-opaque silver mirror
          float alpha = clamp(0.15 + F * 0.62 + min(thick, 1.0) * 0.85 + s1 * 0.8, 0.0, 1.0);
          alpha = max(alpha, F * 0.95);
          gl_FragColor = vec4(col, alpha);
        }`
    });

    var waterVol = null;
    if (isGL2) {
      waterVol = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), waterMat);
      waterVol.frustumCulled = false;
      waterVol.renderOrder = 10;
      scene.add(waterVol);
    }

    // per-frame: shrink-wrap the march's bounding box around the spine
    function updateVolumeBox() {
      if (!waterVol) return;
      var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (var i = 0; i < WN; i++) {
        if (wsx[i] < minX) minX = wsx[i];
        if (wsx[i] > maxX) maxX = wsx[i];
        if (wsz[i] < minZ) minZ = wsz[i];
        if (wsz[i] > maxZ) maxZ = wsz[i];
      }
      var m = radiusWorld * 1.7 + 0.45;   // fBm displacement + halo margin
      var bmin = waterUniforms.uBoxMin.value.set(minX - m, BOTY, minZ - m);
      var bmax = waterUniforms.uBoxMax.value.set(maxX + m, TOPY, maxZ + m);
      waterVol.position.set((bmin.x + bmax.x) * 0.5, (bmin.y + bmax.y) * 0.5, (bmin.z + bmax.z) * 0.5);
      waterVol.scale.set(bmax.x - bmin.x, bmax.y - bmin.y, bmax.z - bmin.z);
    }

    // ── Droplets — molecular shear: refractive teardrops, dt-integrated ──
    var MAXD = 200;
    var dropUniforms = {
      uEdge: { value: theme().edge.clone() },
      uSpark: { value: theme().spark.clone() },
      uNeonCol: { value: neonTheme().core.clone() },
      uNeonPos: { value: waterUniforms.uNeonPos.value },
      uNeonI: { value: 1 },
      uRes: { value: waterUniforms.uRes.value },
      uRefr: { value: refrRT.texture }
    };
    var dropMat = new THREE.ShaderMaterial({
      uniforms: dropUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec4 wp = instanceMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = normalize(mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uEdge, uSpark, uNeonCol, uNeonPos;
        uniform float uNeonI;
        uniform vec2 uRes;
        uniform sampler2D uRefr;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 Nn = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          float cosNV = max(dot(Nn, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosNV, 5.0);
          // each droplet is a tiny lens on the refraction buffer
          vec2 suv = gl_FragCoord.xy / uRes;
          vec2 off = -Nn.xy * 0.05;
          vec3 refr;
          refr.r = texture2D(uRefr, suv + off*0.9).r;
          refr.g = texture2D(uRefr, suv + off).g;
          refr.b = texture2D(uRefr, suv + off*1.1).b;
          vec3 L = normalize(vec3(0.5, 0.85, 0.65));
          float sp = pow(max(dot(reflect(-L, Nn), V), 0.0), 60.0);
          vec3 Ln = normalize(uNeonPos - vW);
          float nsp = pow(max(dot(reflect(-Ln, Nn), V), 0.0), 50.0);
          vec3 col = refr * 1.5 + uEdge * (0.10 + F * 0.70) + uSpark * sp + uNeonCol * nsp * 0.6 * uNeonI;
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    var drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), dropMat, MAXD);
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    drops.frustumCulled = false;
    drops.renderOrder = 11;
    scene.add(drops);

    var dPos = [], dVel = [], dLife = [], dSize = [];
    // 9.81 m/s², scaled so ~1.2 scene units ≈ 1 metre — heavy, believable fall
    var G_WORLD = 9.81 * (halfH / 1.25);
    var dummy = new THREE.Object3D();
    var UP = new THREE.Vector3(0, 1, 0), axisV = new THREE.Vector3();

    // MASS-BASED SPLASH: no radial explosions. Droplets shear off the
    // strike's exit side in a cone around the strike vector, inheriting
    // the stroke's momentum COMBINED with the stream's downward flow —
    // every droplet then traces its own gravitational arc.
    function shearSplash(x, y, z, dvx, dvy, energy, count) {
      var dlen = Math.sqrt(dvx * dvx + dvy * dvy) || 1e-4;
      var dirX = dvx / dlen, dirY = dvy / dlen;
      var streamFall = 1.4 + Math.min(Math.abs(scrollMomentum) * 0.06, 2.6);
      for (var i = 0; i < count && dPos.length < MAXD; i++) {
        var spread = (Math.random() - 0.5) * 1.1;          // ~±30° shear cone
        var ca = Math.cos(spread), sa = Math.sin(spread);
        var vx2 = dirX * ca - dirY * sa, vy2 = dirX * sa + dirY * ca;
        var speed = (2.2 + Math.random() * 3.4) * energy * 2.4;   // units/s ∝ strike energy
        dPos.push(new THREE.Vector3(
          x + dirX * radiusWorld * 0.9 + (Math.random() - 0.5) * 0.06,
          y + (Math.random() - 0.5) * 0.30,
          z + (Math.random() - 0.5) * 0.10));
        dVel.push(new THREE.Vector3(
          vx2 * speed,
          vy2 * speed * 0.8 - streamFall * (0.5 + Math.random() * 0.7),
          (Math.random() - 0.5) * 0.9 * energy));
        dLife.push(0.7 + Math.random() * 0.3);
        dSize.push(0.012 + Math.random() * 0.030);
      }
    }
    function stepDrops(dt) {
      // detachment: surface tension breaks under shear — triggered by
      // scroll ACCELERATION (the yank), not merely by speed
      var yank = Math.abs(scrollAccel) > 0.28;
      var spawned = 0, cap = yank ? 6 : 3;
      for (var i = 2; i < WN - 2; i += 2) {
        if (spawned >= cap) break;
        var hard = wspd[i] > 0.085 || (yank && wspd[i] > 0.035);
        if (hard && Math.random() < (yank ? 0.30 : 0.16) && dPos.length < MAXD) {
          var side = wvx[i] > 0 ? 1 : -1;
          dPos.push(new THREE.Vector3(wsx[i] + side * radiusWorld, nodeY(i, WN), wsz[i]));
          // inherit the parent node's instantaneous velocity vector
          dVel.push(new THREE.Vector3(
            wvx[i] * 130 + side * 1.7,
            Math.random() * 2.6 + wspd[i] * 38,
            wvz[i] * 110 + (Math.random() - 0.5) * 2.1
          ));
          dLife.push(0.75 + Math.random() * 0.25);
          dSize.push(Math.min(0.014 + Math.random() * 0.03 + wspd[i] * 0.06, 0.052));
          spawned++;
        }
      }
      var drag = Math.exp(-dt * 0.45);
      var n = 0;
      for (var k = dPos.length - 1; k >= 0; k--) {
        var p = dPos[k], v = dVel[k];
        v.y -= G_WORLD * dt;
        v.multiplyScalar(drag);
        p.addScaledVector(v, dt);
        dLife[k] -= dt * 1.05;                     // surface-tension evaporation
        if (dLife[k] <= 0 || p.y < BOTY - 1) { dPos.splice(k, 1); dVel.splice(k, 1); dLife.splice(k, 1); dSize.splice(k, 1); }
      }
      for (var m = 0; m < dPos.length; m++) {
        var s = dSize[m] * Math.max(dLife[m], 0.001);
        dummy.position.copy(dPos[m]);
        // aerodynamic deformation: sphere → trailing teardrop along the
        // velocity vector, elongation proportional to airspeed
        var vv = dVel[m], vlen = vv.length();
        var el = Math.min(vlen * 0.06, 1.6);
        if (vlen > 0.001) {
          axisV.copy(vv).multiplyScalar(1 / vlen);
          dummy.quaternion.setFromUnitVectors(UP, axisV);
        } else {
          dummy.quaternion.identity();
        }
        dummy.scale.set(s / (1 + el * 0.30), s * (1 + el), s / (1 + el * 0.30));
        dummy.updateMatrix();
        drops.setMatrixAt(n++, dummy.matrix);
      }
      drops.count = n;
      drops.instanceMatrix.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════════
    // NEON — rigid stiff spine, mirrored on the opposite side
    // ══════════════════════════════════════════════════════════════
    var NN = 26;
    var nsx = new Float32Array(NN), nsz = new Float32Array(NN);
    var nvx = new Float32Array(NN), nvz = new Float32Array(NN);
    var NEON_X = 0;                              // fixed left-side line (set on resize)

    function stepNeonSpine() {
      // ABSOLUTE STATIC LOCK: the tube is rigid hardware. It is fully
      // decoupled from scroll velocity, momentum, and the water anchor —
      // every node is nailed to the fixed vertical line NEON_X with zero
      // velocity, so it can never inherit any lateral sway. A perfectly
      // vertical, immovable high-voltage cylinder.
      for (var i = 0; i < NN; i++) {
        nsx[i] = NEON_X; nsz[i] = 0; nvx[i] = 0; nvz[i] = 0;
      }
    }

    // three coaxial layers: razor-thin plasma filament (0.24×) inside an
    // ionized gas cloud (0.72×) inside the borosilicate jacket (1.0×)
    var neonRadius = halfH * 0.046;
    var neonUniforms = {
      uSpineX: { value: nsx }, uSpineZ: { value: nsz }, uTopY: { value: TOPY }, uBotY: { value: BOTY },
      uRadius: { value: neonRadius }, uEnv: { value: cubeRT.texture },
      uGlassTint: { value: neonTheme().tint.clone() },
      uCoreColor: { value: neonTheme().core.clone() },
      uFlicker: { value: 1 }
    };
    var coreUniforms = {
      uSpineX: { value: nsx }, uSpineZ: { value: nsz }, uTopY: { value: TOPY }, uBotY: { value: BOTY },
      uRadius: { value: neonRadius * 0.24 },
      uCoreColor: { value: neonTheme().core.clone() },
      uHotColor: { value: neonTheme().hot.clone() },
      uFlicker: { value: 1 }, uTime: { value: 0 }
    };
    var gasUniforms = {
      uSpineX: { value: nsx }, uSpineZ: { value: nsz }, uTopY: { value: TOPY }, uBotY: { value: BOTY },
      uRadius: { value: neonRadius * 0.72 },
      uCol: { value: neonTheme().core.clone() },
      uFlicker: { value: 1 }, uTime: { value: 0 }
    };

    function neonVertexShader() {
      return `
        uniform float uSpineX[${NN}];
        uniform float uSpineZ[${NN}];
        uniform float uTopY, uBotY, uRadius;
        varying vec3 vWorld; varying vec3 vNorm; varying vec2 vUvv;
        void main(){
          float t = uv.y;
          float fi = (1.0 - t) * ${NN - 1}.0;
          int i0 = int(floor(fi)); int i1 = i0 + 1; if (i1 > ${NN - 1}) i1 = ${NN - 1};
          float fr = fract(fi);
          float spX = mix(uSpineX[i0], uSpineX[i1], fr);
          float spZ = mix(uSpineZ[i0], uSpineZ[i1], fr);
          float wy = mix(uBotY, uTopY, t);
          float ang = atan(position.z, position.x);
          float taper = 0.92 + 0.08*sin(t*3.14159);
          float r = uRadius * taper;
          vec3 p = vec3(spX + cos(ang)*r, wy, spZ + sin(ang)*r);
          float spX2 = mix(uSpineX[i1], uSpineX[min(i1+1, ${NN - 1})], fr);
          float slope = (spX - spX2) * ${((NN - 1) / 2).toFixed(1)} / (uTopY - uBotY);
          vec3 nrm = normalize(vec3(cos(ang), -slope*0.4, sin(ang)));
          vWorld = p; vNorm = nrm; vUvv = vec2(ang, t);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`;
    }

    // — glass jacket: Schlick fresnel @ IoR 1.5, env reflections, sharp
    //   analytic glints, the core glowing through, dispersion on the rim —
    var neonJacketMat = new THREE.ShaderMaterial({
      uniforms: neonUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: neonVertexShader(),
      fragmentShader: `
        uniform vec3 uGlassTint, uCoreColor;
        uniform float uFlicker;
        uniform samplerCube uEnv;
        varying vec3 vWorld; varying vec3 vNorm; varying vec2 vUvv;
        ${GLSL_NOISE}
        void main(){
          vec3 Nn = normalize(vNorm); if (!gl_FrontFacing) Nn = -Nn;
          vec3 V = normalize(cameraPosition - vWorld);
          float cosNV = max(dot(Nn, V), 0.0);
          // strict Schlick @ borosilicate IoR 1.52 → F0 = ((0.52)/(2.52))² ≈ 0.0426
          float F = 0.0426 + 0.9574 * pow(1.0 - cosNV, 5.0);
          vec3 R = reflect(-V, Nn);
          vec3 env = textureCube(uEnv, R).rgb;
          // razor glints raking the outer surface — high specular gloss
          env += vec3(0.9, 0.95, 1.0) * pow(max(dot(R, normalize(vec3( 0.35, 0.85, 0.40))), 0.0), 320.0) * 1.9;
          env += vec3(0.6, 0.70, 0.9) * pow(max(dot(R, normalize(vec3(-0.55, -0.30, 0.66))), 0.0), 200.0) * 0.8;
          // refracted world through the glass wall
          vec3 refCol = textureCube(uEnv, refract(-V, Nn, 1.0/1.52)).rgb;
          // gas + core glowing through — strongest looking dead-through
          float through = pow(cosNV, 2.2);
          // faint vertical wipe marks on real tube glass
          float streak = smoothstep(0.6, 0.95, snoise(vec3(vUvv.x*24.0, vUvv.y*2.0, 4.1)));
          // inner-wall reflection ring: the far side of the glass wall
          // doubles the highlight at a fixed grazing band — the cue that
          // makes a tube read as SOLID glass, not a gradient
          float innerRing = smoothstep(0.30, 0.16, abs(cosNV - 0.30)) * 0.10;
          vec3 col = uGlassTint * 0.4
                   + refCol * 0.5
                   + env * F * 1.7 * (1.0 + streak * 0.5)
                   + vec3(0.9, 0.95, 1.0) * innerRing * (0.4 + uFlicker * 0.3)
                   + uCoreColor * through * uFlicker * 0.55
                   + uCoreColor * F * 0.20 * uFlicker;
          // dispersion fringe on the rim (glass CA)
          float rim = pow(1.0 - cosNV, 5.0);
          col.r += rim * 0.05; col.b += rim * 0.09;
          float alpha = clamp(F * 1.2 + through * 0.30, 0.0, 0.94);
          gl_FragColor = vec4(col, alpha);
        }`
    });

    // — plasma core: white-hot axis, high-frequency ionized-gas turbulence —
    var neonCoreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      vertexShader: neonVertexShader(),
      fragmentShader: `
        uniform vec3 uCoreColor, uHotColor;
        uniform float uFlicker, uTime;
        varying vec3 vWorld; varying vec3 vNorm; varying vec2 vUvv;
        ${GLSL_NOISE}
        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          float cosNV = max(dot(normalize(vNorm), V), 0.0);
          float axis = pow(cosNV, 3.0);                 // hottest along the visual axis
          // plasma turbulence: low amplitude, high frequency — the
          // microscopic swirl of ionized gas under high voltage
          float pl1 = snoise(vec3(vUvv.x*1.5, vUvv.y*110.0 - uTime*1.2, uTime*2.2));
          float pl2 = snoise(vec3(vUvv.y*260.0 - uTime*6.0, uTime*3.5, 2.2));
          float I = uFlicker * (1.0 + pl1*0.14 + pl2*0.07);
          vec3 col = mix(uCoreColor, uHotColor, axis*0.95) * (0.9 + axis*3.4) * I;
          gl_FragColor = vec4(col, 1.0);
        }`
    });

    // — ionized gas cloud: the saturated volumetric emission between the
    //   filament and the glass. Depth through the annulus comes from the
    //   view angle (chord integral), with slow ionization wisps curling
    //   through it. Additive, flicker-linked, and a bloom source so the
    //   scatter carries the gas's magenta, not just the core's white. —
    var neonGasMat = new THREE.ShaderMaterial({
      uniforms: gasUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      vertexShader: neonVertexShader(),
      fragmentShader: `
        uniform vec3 uCol;
        uniform float uFlicker, uTime;
        varying vec3 vWorld; varying vec3 vNorm; varying vec2 vUvv;
        ${GLSL_NOISE}
        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          float cosNV = max(dot(normalize(vNorm), V), 0.0);
          // chord through the gas annulus — the volumetric emission integral
          float depth = pow(cosNV, 1.35);
          // ionization wisps drifting inside the tube
          float w1 = snoise(vec3(vUvv.x * 2.0, vUvv.y * 55.0 - uTime * 0.9, uTime * 0.7));
          float w2 = snoise(vec3(vUvv.y * 140.0 - uTime * 2.6, uTime * 1.3, 5.8));
          float dens = depth * (0.75 + w1 * 0.30 + w2 * 0.12);
          vec3 col = uCol * dens * 1.35 * uFlicker;
          col += uCol * uCol * dens * dens * 0.8 * uFlicker;   // saturated hot center
          gl_FragColor = vec4(col, 1.0);
        }`
    });

    var neonJacket = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 90, true), neonJacketMat);
    var neonGas = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 60, true), neonGasMat);
    var neonCore = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 60, true), neonCoreMat);
    neonJacket.frustumCulled = false;
    neonGas.frustumCulled = false;
    neonCore.frustumCulled = false;
    neonCore.layers.enable(BLOOM_LAYER);        // normal pass AND bloom source
    neonCore.layers.enable(REFR_LAYER);         // the water refracts the tube
    neonGas.layers.enable(BLOOM_LAYER);         // gas joins the scatter…
    neonGas.layers.enable(REFR_LAYER);          // …and the refraction buffer
    neonJacket.layers.enable(REFR_LAYER);
    scene.add(neonJacket);
    scene.add(neonGas);
    scene.add(neonCore);

    // high-voltage flicker: NON-PERIODIC fractal 1D value noise (three
    // octaves) — no sine hum, no repeating pattern — plus slot-hashed
    // starvation dropouts and the scroll-triggered voltage surge
    var neonBurst = 0, neonSmooth = 1, neonI = 1;
    function jsHash(n) { var s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
    function vnoise1(x) {
      var ix = Math.floor(x), fx = x - ix;
      var u = fx * fx * (3 - 2 * fx);
      return jsHash(ix) * (1 - u) + jsHash(ix + 1) * u;
    }
    function stepNeonFlicker(t) {
      // plasma micro-flicker: fractal noise across three time scales
      var flick = (vnoise1(t * 11.0) * 0.55 + vnoise1(t * 43.0) * 0.30 + vnoise1(t * 167.0) * 0.15) - 0.5;
      // real tubes starve at random instants: hash a timeslot, sometimes dip
      var slot = Math.floor(t * 2.7);
      var target = jsHash(slot) < 0.08 ? 0.45 + jsHash(slot + 7) * 0.25 : 1.0;
      neonSmooth += (target - neonSmooth) * 0.30;
      neonBurst *= 0.90;
      if (Math.abs(scrollMomentum) > 1.0) neonBurst = Math.min(1, neonBurst + Math.abs(scrollMomentum) * 0.05);
      var dip = (neonBurst > 0.15 && Math.random() < neonBurst * 0.5) ? (0.35 + Math.random() * 0.4) : 0;
      neonI = Math.max(0.12, (neonSmooth + flick * 0.16 - dip) * (1.0 + neonBurst * 0.25));
      coreUniforms.uFlicker.value = neonI;
      gasUniforms.uFlicker.value = neonI;
      neonUniforms.uFlicker.value = neonI;
      waterUniforms.uNeonI.value = neonI;       // light linking: the water sees the flicker
      dropUniforms.uNeonI.value = neonI;
      backUniforms.uNeonI.value = neonI;
      coreUniforms.uTime.value = t;
      gasUniforms.uTime.value = t;
    }

    // ══════════════════════════════════════════════════════════════
    // SELECTIVE BLOOM — Unreal algorithm, hand-rolled: bright pass
    // (core only, via layers) → 3-level gaussian mip pyramid → weighted
    // additive composite. Tight radii dominate; the wide tail supplies
    // the atmospheric bleed.
    // ══════════════════════════════════════════════════════════════
    var LEVELS = 3;
    var rtBright, rtPing = [], rtPong = [];
    var blitGeo = new THREE.PlaneGeometry(2, 2);
    var blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var BLIT_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

    var rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    rtBright = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    for (var li = 0; li < LEVELS; li++) {
      rtPing.push(new THREE.WebGLRenderTarget(2, 2, rtOpts));
      rtPong.push(new THREE.WebGLRenderTarget(2, 2, rtOpts));
    }

    var blurUniforms = { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(1, 1) } };
    var blurMat = new THREE.ShaderMaterial({
      uniforms: blurUniforms, depthTest: false, depthWrite: false,
      vertexShader: BLIT_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uDir, uTexel;
        varying vec2 vUv;
        void main(){
          vec2 o1 = uDir * uTexel * 1.3846153846;
          vec2 o2 = uDir * uTexel * 3.2307692308;
          vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
          sum += texture2D(tDiffuse, vUv + o1) * 0.3162162162;
          sum += texture2D(tDiffuse, vUv - o1) * 0.3162162162;
          sum += texture2D(tDiffuse, vUv + o2) * 0.0702702703;
          sum += texture2D(tDiffuse, vUv - o2) * 0.0702702703;
          gl_FragColor = sum;
        }`
    });
    var blurMesh = new THREE.Mesh(blitGeo, blurMat);
    var blurScene = new THREE.Scene(); blurScene.add(blurMesh);

    var compUniforms = {
      tB0: { value: null }, tB1: { value: null }, tB2: { value: null },
      uStrength: { value: 1.25 }
    };
    var compMat = new THREE.ShaderMaterial({
      uniforms: compUniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: BLIT_VERT,
      fragmentShader: `
        uniform sampler2D tB0, tB1, tB2;
        uniform float uStrength;
        varying vec2 vUv;
        void main(){
          // Unreal-style weighted mip sum: tight radius hot, wide tail soft
          vec3 b = texture2D(tB0, vUv).rgb * 1.10
                 + texture2D(tB1, vUv).rgb * 0.70
                 + texture2D(tB2, vUv).rgb * 0.50;
          gl_FragColor = vec4(b * uStrength, 1.0);
        }`
    });
    var compMesh = new THREE.Mesh(blitGeo, compMat);
    var compScene = new THREE.Scene(); compScene.add(compMesh);

    function renderWithBloom() {
      // 1. refraction buffer: glow backdrop + neon tube, from the live camera
      camera.layers.mask = MASK_REFR;
      renderer.setRenderTarget(refrRT);
      renderer.clear();
      renderer.render(scene, camera);

      // 2. bright pass: the plasma core alone
      camera.layers.set(BLOOM_LAYER);
      renderer.setRenderTarget(rtBright);
      renderer.clear();
      renderer.render(scene, camera);

      // 3. gaussian mip pyramid: blur at each level, downsampling as we go
      var src = rtBright;
      for (var l = 0; l < LEVELS; l++) {
        blurUniforms.uTexel.value.set(1 / rtPing[l].width, 1 / rtPing[l].height);
        blurUniforms.tDiffuse.value = src.texture;
        blurUniforms.uDir.value.set(1, 0);
        renderer.setRenderTarget(rtPing[l]); renderer.clear();
        renderer.render(blurScene, blitCam);

        blurUniforms.tDiffuse.value = rtPing[l].texture;
        blurUniforms.uDir.value.set(0, 1);
        renderer.setRenderTarget(rtPong[l]); renderer.clear();
        renderer.render(blurScene, blitCam);
        src = rtPong[l];
      }

      // 4. base scene, straight to the canvas
      camera.layers.set(0);
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.render(scene, camera);

      // 5. weighted additive bloom composite on top
      compUniforms.tB0.value = rtPong[0].texture;
      compUniforms.tB1.value = rtPong[1].texture;
      compUniforms.tB2.value = rtPong[2].texture;
      renderer.autoClear = false;
      renderer.render(compScene, blitCam);
      renderer.autoClear = true;
    }

    // ══════════════════════════════════════════════════════════════
    // DOM/CSS refraction layer — real optical distortion of the page's
    // own background behind the water (WebGL can't read live DOM pixels,
    // backdrop-filter + SVG turbulence/displacement can). Desktop only.
    // Displacement amplitude breathes with scroll momentum.
    // ══════════════════════════════════════════════════════════════
    var glassEl = null, glassSupported = !isCoarse && window.CSS && CSS.supports &&
      (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
    var n1Off = 0, n2Off = 0;
    if (glassSupported) {
      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('style', 'position:fixed;width:0;height:0;overflow:hidden;');
      svg.innerHTML =
        '<filter id="pmx-glass-distort" x="-30%" y="-10%" width="160%" height="120%" color-interpolation-filters="sRGB">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.010 0.045" numOctaves="2" seed="7" result="n1"/>' +
        '<feOffset in="n1" id="pmx-n1off" dx="0" dy="0" result="n1"/>' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.035 0.09" numOctaves="2" seed="41" result="n2"/>' +
        '<feOffset in="n2" id="pmx-n2off" dx="0" dy="0" result="n2"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="n1" scale="16" xChannelSelector="R" yChannelSelector="G" result="d1" id="pmx-d1"/>' +
        '<feDisplacementMap in="d1" in2="n2" scale="7" xChannelSelector="R" yChannelSelector="G" result="dual"/>' +
        '<feDisplacementMap in="dual" in2="n1" scale="5" xChannelSelector="R" yChannelSelector="G" result="chR"/>' +
        '<feColorMatrix in="chR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chRred"/>' +
        '<feDisplacementMap in="dual" in2="n1" scale="-5" xChannelSelector="R" yChannelSelector="G" result="chB"/>' +
        '<feColorMatrix in="chB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chBblue"/>' +
        '<feColorMatrix in="dual" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chGgreen"/>' +
        '<feBlend in="chRred" in2="chGgreen" mode="screen" result="rg"/>' +
        '<feBlend in="rg" in2="chBblue" mode="screen" result="fringed"/>' +
        '<feGaussianBlur in="fringed" stdDeviation="0.5"/>' +
        '</filter>';
      document.body.appendChild(svg);
      var n1off = svg.querySelector('#pmx-n1off'), n2off = svg.querySelector('#pmx-n2off');
      var d1el = svg.querySelector('#pmx-d1');

      var style = document.createElement('style');
      style.textContent =
        '.pmx-water-glass{position:fixed;top:0;height:100%;width:210px;left:0;pointer-events:none;z-index:2;' +
        'will-change:transform;-webkit-backdrop-filter:url(#pmx-glass-distort) blur(2px) saturate(150%);' +
        'backdrop-filter:url(#pmx-glass-distort) blur(2px) saturate(150%);' +
        '-webkit-mask-image:linear-gradient(90deg,transparent,rgba(0,0,0,.9) 30%,rgba(0,0,0,.9) 70%,transparent);' +
        'mask-image:linear-gradient(90deg,transparent,rgba(0,0,0,.9) 30%,rgba(0,0,0,.9) 70%,transparent);}';
      document.head.appendChild(style);

      glassEl = document.createElement('div');
      glassEl.className = 'pmx-water-glass';
      glassEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(glassEl);

      var lastD1 = 16;
      var _updateGlassFlow = function (dt) {
        n1Off += dt * 6;
        n2Off -= dt * 11;
        if (n1off) n1off.setAttribute('dy', (n1Off % 1000).toFixed(2));
        if (n2off) { n2off.setAttribute('dx', (n2Off * 0.3 % 1000).toFixed(2)); n2off.setAttribute('dy', (n2Off % 1000).toFixed(2)); }
        // harder scroll → deeper displacement, easing back as it settles
        if (d1el) {
          var target = 16 + Math.min(Math.abs(scrollMomentum) * 0.55, 14);
          lastD1 += (target - lastD1) * 0.08;
          d1el.setAttribute('scale', lastD1.toFixed(1));
        }
      };
      window._pmxUpdateGlassFlow = _updateGlassFlow;
    }
    var projV = new THREE.Vector3();
    function updateGlassPosition() {
      if (!glassEl) return;
      projV.set(wAnchorX, 0, 0).project(camera);
      var sx = (projV.x * 0.5 + 0.5) * window.innerWidth;
      glassEl.style.transform = 'translateX(' + (sx - 105) + 'px)';
    }

    // ── Theme watcher (phosphor toggle) ───────────────────────────
    new MutationObserver(function () {
      var c = theme(), nc = neonTheme();
      waterUniforms.uEdge.value.copy(c.edge);
      waterUniforms.uDeep.value.copy(c.deep);
      waterUniforms.uSpark.value.copy(c.spark);
      waterUniforms.uNeonCol.value.copy(nc.core);
      dropUniforms.uEdge.value.copy(c.edge);
      dropUniforms.uSpark.value.copy(c.spark);
      dropUniforms.uNeonCol.value.copy(nc.core);
      neonUniforms.uGlassTint.value.copy(nc.tint);
      neonUniforms.uCoreColor.value.copy(nc.core);
      coreUniforms.uCoreColor.value.copy(nc.core);
      coreUniforms.uHotColor.value.copy(nc.hot);
      gasUniforms.uCol.value.copy(nc.core);
      backUniforms.uEdge.value.copy(c.edge);
      backUniforms.uNeon.value.copy(nc.core);
      refreshEnv();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // ── Resize ────────────────────────────────────────────────────
    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMZ;
      halfW = halfH * camera.aspect;
      spanY();
      radiusWorld = halfH * 0.052;
      // FIXED anchor lines — the water hangs on the right, the neon is
      // locked on the left. Neither moves with scroll any more.
      wAnchorX = halfW * 0.42;
      NEON_X = -halfW * 0.55;
      for (var ni = 0; ni < NN; ni++) { nsx[ni] = NEON_X; nsz[ni] = 0; }
      waterUniforms.uTopY.value = TOPY; waterUniforms.uBotY.value = BOTY;
      waterUniforms.uRadius.value = radiusWorld;
      neonUniforms.uTopY.value = TOPY; neonUniforms.uBotY.value = BOTY;
      coreUniforms.uTopY.value = TOPY; coreUniforms.uBotY.value = BOTY;
      gasUniforms.uTopY.value = TOPY; gasUniforms.uBotY.value = BOTY;
      neonUniforms.uRadius.value = halfH * 0.046;
      coreUniforms.uRadius.value = halfH * 0.046 * 0.24;
      gasUniforms.uRadius.value = halfH * 0.046 * 0.72;

      var db = renderer.getDrawingBufferSize(new THREE.Vector2());
      waterUniforms.uRes.value.copy(db);
      refrRT.setSize(Math.max(2, db.x >> 1), Math.max(2, db.y >> 1));

      // bloom pyramid: 1/4 → 1/8 → 1/16 of the viewport
      var bw = Math.max(64, Math.floor(w / 4)), bh = Math.max(64, Math.floor(h / 4));
      rtBright.setSize(bw, bh);
      for (var l = 0; l < LEVELS; l++) {
        var lw = Math.max(32, bw >> l), lh = Math.max(32, bh >> l);
        rtPing[l].setSize(lw, lh);
        rtPong[l].setSize(lw, lh);
      }
      sizeBackPlane();
    }
    window.addEventListener('resize', resize, { passive: true });
    resize();

    // ── Main loop ─────────────────────────────────────────────────
    var running = true, lastT = performance.now();
    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) { lastT = performance.now(); requestAnimationFrame(loop); }
    });

    function stepCamera(t) {
      var tx = isCoarse ? 0 : (mwx > 1e5 ? 0 : mwx * 0.03);
      var ty = isCoarse ? 0 : (mwy > 1e5 ? 0 : mwy * 0.03);
      camera.position.x += (tx - camera.position.x) * 0.03;
      camera.position.y += (ty + Math.sin(t * 0.3) * 0.15 - camera.position.y) * 0.03;
      camera.lookAt(wAnchorX * 0.2, 0, 0);
    }

    var projN = new THREE.Vector3();
    function loop(now) {
      if (!running) return;
      var dt = Math.min((now - lastT) / 1000, 0.1) || 0.016;
      lastT = now;
      var t = now / 1000;

      // ── FIXED-TIMESTEP ACCUMULATOR: the springs/ropes advance only in
      // exact 1/60 s substeps. A janky render frame runs at most
      // MAX_SUBSTEPS and DROPS the backlog (a blink of slow motion) —
      // so a single physics step larger than 1/60 s, and therefore a
      // single-frame velocity spike, is structurally impossible.
      // resolve mwx/mwy against THIS frame's camera transform before any
      // physics substep touches them — camera parallax drift means this
      // must happen every frame, not just on mousemove
      updateMouseWorld();

      physAcc += dt;
      var sub = 0;
      while (physAcc >= PHYS_STEP && sub < MAX_SUBSTEPS) {
        lastP = stepScroll();
        stepMouseFluid(PHYS_STEP);
        stepWaterSpine(t, lastP);
        stepNeonSpine();
        physAcc -= PHYS_STEP;
        sub++;
      }
      if (physAcc > PHYS_STEP) physAcc = PHYS_STEP;

      stepNeonFlicker(t);
      stepDrops(dt);
      stepCamera(t);
      updateVolumeBox();
      if (window._pmxUpdateGlassFlow) window._pmxUpdateGlassFlow(dt);
      updateGlassPosition();

      waterUniforms.uFlow.value = wFlow;
      waterUniforms.uTime.value = t;
      waterUniforms.uStretch.value = stretch;
      waterUniforms.uChurn.value = churn;
      // uVelocity: kinetic speed (scroll momentum + lateral slosh) → the
      // shader scales normal-map advection with it — laminar glass at
      // rest, churning turbulence under load
      waterUniforms.uVel.value = Math.min(Math.abs(scrollMomentum) * 0.02 + Math.abs(scrollVel) * 0.02, 1);
      waterUniforms.uSpine.value = spinePack;
      neonUniforms.uSpineX.value = nsx; neonUniforms.uSpineZ.value = nsz;
      coreUniforms.uSpineX.value = nsx; coreUniforms.uSpineZ.value = nsz;
      gasUniforms.uSpineX.value = nsx; gasUniforms.uSpineZ.value = nsz;

      // light linking: the water lights from the tube's live axis
      var mid = NN >> 1;
      waterUniforms.uNeonPos.value.set(nsx[mid], 0, nsz[mid]);

      // keep the backdrop's washes tracking both threads (NDC x)
      projN.set(nsx[mid], 0, 0).project(camera);
      backUniforms.uNeonX.value = projN.x;
      projN.set(wAnchorX, 0, 0).project(camera);
      backUniforms.uWaterX.value = projN.x;
      backUniforms.uTime.value = t;

      renderWithBloom();
      requestAnimationFrame(loop);
    }

    // greeting: a soft push so both threads announce themselves
    setTimeout(function () {
      for (var i = 8; i < 16; i++) wvx[i] += 0.05;
      shearSplash(wsx[12], nodeY(12, WN), 0, 0.4, 0.12, 1.2, 10);
      neonBurst = 1;
    }, 700);

    requestAnimationFrame(loop);
  }
})();

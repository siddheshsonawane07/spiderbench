// OWNER: sid (r4). Sky traffic + rooftop obstruction lights: things the skyline had none of.
//   helicopters  3, on one loop down the Hudson, round the Battery and up the East River (the real sightseeing / commuter
//                corridor), 80 m clear of anything built under the route
//   airliners    2, high and slow on straight tracks either side of the island
//   blimp        1, circling over Midtown above the tallest roof
//   lights       night only: red / green / white navigation lights and strobes on the aircraft, and a red obstruction
//                light on every roof over BEACON_H m (four more, steady, on the corners of the tallest)
// Cost: 4 draw calls by day (helicopter hulls, rotors, airliners, blimp), 5 at night (+ every light in ONE instanced
// quad mesh, nightOnly: no draw call by day). About 2,500 triangles by day and 3,600 at night (555 lights), 150 kB of buffers. No textures, no shadow casting, nothing in
// the river mirror. No collision: all of it is out of reach (the lowest helicopter is 80 m over the roofs below it), so
// nothing here is solid geometry (C4). Deterministic: positions are a function of time, phases come from a seeded rng.
//   buildSkyTraffic({ scene, footprints, buildings, raycast }) -> { update(dt, camera), stats }
// ?nosky disables it (A/B).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G, shoreX, mulberry32 } from './layout.js';
import { nightK, screenK, nightOnly } from '../render/daynight.js';

const BEACON_H = 120;   // roofs at least this high carry an obstruction light
const CORNER_H = 250;   // and these four steady corner lights as well
const HELI_Y = 230, HELI_CLEAR = 80, HELI_V = 42; // m, m over the roofs under the route, m/s
const LIGHT_GAIN = 9;   // light core radiance at night (x screenK, like the neon)

// ---- kits: boxes / ellipsoids with a vertex colour, +z = nose
function kitGeometry(parts) {
  const gs = parts.map(([geo, col]) => {
    const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(gs, false);
}
const box = (x0, y0, z0, x1, y1, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
// a wing: a box swept back (z falls by `sweep` per metre of span) on one side of the fuselage
const wing = (side, x0, x1, y0, y1, z0, z1, sweep) => box(Math.min(side * x0, side * x1), y0, z0, Math.max(side * x0, side * x1), y1, z1)
  .applyMatrix4(new THREE.Matrix4().makeShear(0, -side * sweep, 0, 0, 0, 0)); // z -= sweep * |x|

const WHITE = [0.82, 0.83, 0.84], DARK = [0.06, 0.07, 0.09], GREY = [0.3, 0.31, 0.33];
function heliKit() {
  const ell = (rx, ry, rz, x, y, z) => new THREE.SphereGeometry(1, 12, 8).scale(rx, ry, rz).translate(x, y, z);
  return kitGeometry([
    [ell(1.25, 1.2, 2.7, 0, 0, 1.0), WHITE],                                                          // cabin
    [ell(1.02, 0.78, 1.25, 0, 0.3, 2.55), DARK],                                                      // glazing, proud of the nose
    [new THREE.CylinderGeometry(0.15, 0.4, 6.6, 8).rotateX(-Math.PI / 2).translate(0, 0.45, -4.4), WHITE], // boom, thin end aft
    [box(-0.07, 0.3, -8.2, 0.07, 2.1, -7.2).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, -0.35, 0, 0)), WHITE], // fin
    [box(-1.35, -1.6, -1.4, -1.22, -1.48, 2.6), GREY], [box(1.22, -1.6, -1.4, 1.35, -1.48, 2.6), GREY], // skids
    [box(-1.3, -1.5, -0.6, -1.24, -0.7, -0.5), GREY], [box(1.24, -1.5, -0.6, 1.3, -0.7, -0.5), GREY],   // struts
    [box(-1.3, -1.5, 1.7, -1.24, -0.7, 1.8), GREY], [box(1.24, -1.5, 1.7, 1.3, -0.7, 1.8), GREY],
    [box(-0.16, 1.1, 0.1, 0.16, 1.65, 0.6), GREY],                                                   // mast
  ]);
}
function airlinerKit() {
  const tube = (r0, r1, len, z, y = 0, x = 0) => new THREE.CylinderGeometry(r1, r0, len, 10).rotateX(Math.PI / 2).translate(x, y, z); // r0 aft, r1 forward
  return kitGeometry([
    [tube(1.9, 1.9, 28, -1), WHITE], [tube(1.9, 0.35, 6, 16), WHITE], [tube(0.5, 1.9, 7, -18.5, 0.5), WHITE], // fuselage, nose, tail cone
    [wing(1, 1.7, 17, -0.9, -0.45, -3, 3.5, 0.5), WHITE], [wing(-1, 1.7, 17, -0.9, -0.45, -3, 3.5, 0.5), WHITE],
    [wing(1, 0.8, 6.5, 0.6, 0.9, -19, -16, 0.45), WHITE], [wing(-1, 0.8, 6.5, 0.6, 0.9, -19, -16, 0.45), WHITE], // tailplane
    [box(-0.18, 1.6, -19.5, 0.18, 7.2, -14.5).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, -0.55, 0, 0)), [0.16, 0.24, 0.42]], // fin
    [tube(0.75, 0.85, 4.2, -1.2, -1.7, 5.8), GREY], [tube(0.75, 0.85, 4.2, -1.2, -1.7, -5.8), GREY],    // engines
  ]);
}
function blimpKit() {
  const hull = new THREE.SphereGeometry(1, 20, 12).rotateX(Math.PI / 2).scale(7.6, 7.6, 29);
  return kitGeometry([
    [hull, [0.78, 0.79, 0.8]],
    [box(-1.4, -9.6, -5, 1.4, -7.2, 4), GREY],                                                       // gondola
    [box(-0.2, 2, -29, 0.2, 9.5, -19), [0.2, 0.3, 0.5]], [box(-0.2, -9.5, -29, 0.2, -2, -19), [0.2, 0.3, 0.5]], // fins
    [box(2, -0.2, -29, 9.5, 0.2, -19), [0.2, 0.3, 0.5]], [box(-9.5, -0.2, -29, -2, 0.2, -19), [0.2, 0.3, 0.5]],
  ]);
}

// ---- the helicopter route: a closed loop of [x, y, z] samples, y raised over whatever stands under it
function heliRoute(footprints) {
  const pts = [], zN = G.Z_MIN + 500, zS = G.Z_MAX + 260;
  const west = z => { const [w, e] = shoreX(z); return (w < e ? w : G.X_MIN + 300) - 240; };
  const east = z => { const [w, e] = shoreX(z); return (w < e ? e : G.X_MAX - 300) + 220; };
  for (let z = zN; z < zS; z += 60) pts.push([west(Math.min(z, G.Z_MAX)), 0, z]);              // down the Hudson
  const xa = pts[pts.length - 1][0], xb = east(G.Z_MAX), cx = (xa + xb) / 2, r = (xb - xa) / 2;
  for (let i = 1; i < 16; i++) { const a = Math.PI * i / 16; pts.push([cx - Math.cos(a) * r, 0, zS + Math.sin(a) * r * 0.8]); } // round the Battery
  for (let z = zS; z > zN; z -= 60) pts.push([east(Math.min(z, G.Z_MAX)), 0, z]);              // up the East River
  const xc = pts[pts.length - 1][0], xd = pts[0][0];
  for (let i = 1; i < 24; i++) pts.push([xc + (xd - xc) * i / 24, 0, zN - Math.sin(Math.PI * i / 24) * 160]); // across the north
  // smooth the plan (the shore is stepped), then clear the roofs within 160 m and smooth the height
  const n = pts.length, sm = (k, w) => { const src = pts.map(p => p[k]); for (let i = 0; i < n; i++) { let s = 0; for (let j = -w; j <= w; j++) s += src[(i + j + n) % n]; pts[i][k] = s / (2 * w + 1); } };
  sm(0, 5); sm(2, 2);
  for (const p of pts) {
    let h = 0;
    for (const f of footprints) if (f.h > h && p[0] > f.x0 - 160 && p[0] < f.x1 + 160 && p[2] > f.z0 - 160 && p[2] < f.z1 + 160) h = f.h;
    p[1] = Math.max(HELI_Y, h + HELI_CLEAR);
  }
  for (let i = 0; i < n; i++) { let m = 0; for (let j = -4; j <= 4; j++) m = Math.max(m, pts[(i + j + n) % n][1]); pts[i][3] = m; } // climb early, descend late
  for (let i = 0; i < n; i++) pts[i][1] = pts[i][3];
  sm(1, 6);
  const len = [0]; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; len.push(len[i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
  return { pts, len, total: len[n] };
}
function onRoute(R, s, out) { // distance along the loop -> position
  const n = R.pts.length; s = ((s % R.total) + R.total) % R.total;
  let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R.len[m] <= s) lo = m; else hi = m; }
  const a = R.pts[lo], b = R.pts[(lo + 1) % n], k = (s - R.len[lo]) / Math.max(1e-6, R.len[lo + 1] - R.len[lo]);
  return out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
}

export function buildSkyTraffic({ scene, footprints = [], buildings = [], raycast = null }) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosky')) return { update() {}, stats: { off: true } };
  const rnd = mulberry32(9151);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  const inst = (geo, n, name, m = mat) => {
    const o = new THREE.InstancedMesh(geo, m, n); o.name = name; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
    o.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(o); return o;
  };
  const hTop = footprints.reduce((a, f) => Math.max(a, f.h), 0);

  // ---- craft: { mesh, idx, kind, pos(t, out) -> heading written to c.h, bank to c.bank, lights: [[x, y, z, r, g, b, mode]] }
  const R = heliRoute(footprints);
  const helis = inst(heliKit(), 3, 'sky-helicopters');
  // two crossed blades, opaque: the pipeline composites the sky over every pixel that has no depth, so a translucent
  // rotor disc (or any glow that does not write depth) is invisible against the sky
  const rotors = inst(kitGeometry([[box(-5.4, 1.68, 0.21, 5.4, 1.74, 0.49), DARK], [box(-0.14, 1.68, -5.05, 0.14, 1.74, 5.75), DARK]]), 3, 'sky-rotors');
  const liners = inst(airlinerKit(), 2, 'sky-airliners');
  const blimp = inst(blimpKit(), 1, 'sky-blimp');
  const tint = new THREE.Color();
  [[0.9, 0.9, 0.92], [0.16, 0.24, 0.5], [0.95, 0.72, 0.1]].forEach((c, i) => helis.setColorAt(i, tint.setRGB(c[0], c[1], c[2])));
  const RED = [1, 0.05, 0.03], GREEN = [0.05, 1, 0.25], WHT = [1, 1, 1];
  const navH = [[-1.2, -0.2, 0.5, ...RED, 0], [1.2, -0.2, 0.5, ...GREEN, 0], [0, 1.2, -7.8, ...WHT, 2], [0, -1.0, 0.5, ...RED, 3]];
  const navL = [[-17, -0.6, -8, ...RED, 0], [17, -0.6, -8, ...GREEN, 0], [0, 2, -18, ...WHT, 2], [0, -2, 0, ...RED, 3], [-17, -0.6, -8.4, ...WHT, 2], [17, -0.6, -8.4, ...WHT, 2]];
  const navB = [[-7.6, 0, 0, ...RED, 0], [7.6, 0, 0, ...GREEN, 0], [0, -9.8, 0, ...RED, 3], [0, 0, -29, ...WHT, 2]];
  const craft = [];
  const P = new THREE.Vector3(), P2 = new THREE.Vector3();
  for (let i = 0; i < 3; i++) { // two with the loop, one against it and 60 m higher
    const dir = i === 2 ? -1 : 1, s0 = rnd() * R.total + (i === 1 ? R.total / 2 : 0), up = i === 2 ? 60 : 0;
    craft.push({ mesh: helis, idx: i, lights: navH, pitch: 0.07, ph: rnd(), at(t, out) {
      const s = s0 + dir * HELI_V * t; onRoute(R, s, out); onRoute(R, s + dir * 30, P2); out.y += up;
      this.h = Math.atan2(P2.x - out.x, P2.z - out.z);
      onRoute(R, s + dir * 90, P2); const h2 = Math.atan2(P2.x - out.x, P2.z - out.z);
      this.bank = THREE.MathUtils.clamp(Math.atan2(Math.sin(h2 - this.h), Math.cos(h2 - this.h)) * -1.4, -0.45, 0.45);
    } });
  }
  [[-2600, 2900, 0.32], [2900, 3400, Math.PI + 0.18]].forEach(([x, y, h], i) => { // either side of the island, opposite ways
    const L = 26000, v = 115, ph = rnd(), sx = Math.sin(h), cz = Math.cos(h);
    craft.push({ mesh: liners, idx: i, lights: navL, pitch: -0.03, ph: rnd(), at(t, out) {
      const s = ((v * t + ph * L) % L) - L / 2; out.set(x + sx * s, y, cz * s); this.h = h; this.bank = 0;
    } });
  });
  { // the blimp: an ellipse over Midtown, clear of the tallest roof on the island
    const cx = 60, cz = -500, rx = 900, rz = 1300, y = Math.max(560, hTop + 130), w = 9 / 1100, ph = rnd() * 6.28;
    craft.push({ mesh: blimp, idx: 0, lights: navB, pitch: 0, ph: rnd(), at(t, out) {
      const a = ph + w * t; out.set(cx + Math.cos(a) * rx, y + Math.sin(a * 3.1) * 6, cz + Math.sin(a) * rz);
      this.h = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz); this.bank = 0;
    } });
  }

  // ---- lights: one instanced camera-facing quad; aircraft lights first (rewritten every frame at night), roofs after
  const roof = [];
  const down = new THREE.Vector3(0, -1, 0);
  const topOf = (x, z, y) => { const hit = raycast?.(P.set(x, y + 60, z), down, 120); return hit ? Math.max(hit.point.y, y) : y; };
  for (const b of buildings) {
    if (!(b.H >= BEACON_H) || !b.masses?.length) continue;
    const m = b.masses.reduce((a, q) => (q.y1 > a.y1 ? q : a), b.masses[0]);
    const cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2;
    roof.push([cx, topOf(cx, cz, m.y1) + 1.6, cz, 1, 0.04, 0.02, 1, rnd()]);
    if (b.H >= CORNER_H) for (const [x, z] of [[m.x0 + 0.8, m.z0 + 0.8], [m.x1 - 0.8, m.z0 + 0.8], [m.x0 + 0.8, m.z1 - 0.8], [m.x1 - 0.8, m.z1 - 0.8]]) roof.push([x, m.y1 + 0.9, z, 1, 0.04, 0.02, 4, 0]);
  }
  const nAir = craft.reduce((a, c) => a + c.lights.length, 0), nL = nAir + roof.length;
  const iP = new THREE.InstancedBufferAttribute(new Float32Array(nL * 3), 3), iC = new THREE.InstancedBufferAttribute(new Float32Array(nL * 4), 4);
  iP.setUsage(THREE.DynamicDrawUsage);
  { let k = 0; for (const c of craft) for (const l of c.lights) { iC.setXYZW(k++, l[3], l[4], l[5], l[6] + c.ph * 0.99); } // w = mode + phase
    roof.forEach((r, j) => { iP.setXYZ(nAir + j, r[0], r[1], r[2]); iC.setXYZW(nAir + j, r[3], r[4], r[5], r[6] + r[7] * 0.99); }); }
  const lg = new THREE.InstancedBufferGeometry(); lg.index = new THREE.PlaneGeometry(2, 2).index;
  lg.setAttribute('position', new THREE.PlaneGeometry(2, 2).attributes.position);
  lg.setAttribute('iP', iP); lg.setAttribute('iC', iC); lg.instanceCount = nL;
  lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const uni = { uSkyK: nightK, uSkyS: screenK, uSkyT: { value: 0 }, uSkyPx: { value: 1 / 1080 } };
  // a small bright disc that WRITES depth (see the rotors: without depth the sky replaces it); the bloom pass makes the
  // glow. Not blended, alpha 0: the HDR target's alpha is the SSR weight (world/neon.js), and a light reflects nothing
  const lmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.NoBlending, depthWrite: true, fog: false });
  lmat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 iP; attribute vec4 iC; uniform float uSkyT, uSkyPx; varying vec2 vSkyQ; varying vec3 vSkyC;`)
      .replace('#include <begin_vertex>', `
      float sd = length(iP - cameraPosition), mode = floor(iC.w), ph = fract(iC.w);
      // a 0.45 m disc (0.65 of the quad), never under ~1.5 px: a far beacon stays a steady dot instead of flickering between pixels
      float sr = max(0.7, sd * uSkyPx * 2.4);
      vec3 transformed = iP + (vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]) * position.x + vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]) * position.y) * sr;
      float on = 1.0;                                                          // 0 steady
      if (mode > 3.5) on = 0.45;                                               // 4 steady, dim (roof corners)
      else if (mode > 2.5) on = step(fract(uSkyT * 0.9 + ph), 0.12);           // 3 red anti-collision beacon
      else if (mode > 1.5) on = step(fract(uSkyT * 0.95 + ph), 0.05) * 2.2;    // 2 white strobe
      else if (mode > 0.5) on = 0.15 + 0.85 * smoothstep(0.0, 1.0, sin((uSkyT * 0.42 + ph) * 6.2832) * 0.5 + 0.5); // 1 slow red pulse (roofs)
      vSkyQ = position.xy; vSkyC = iC.rgb * on * exp(-sd / 9000.0) * min(1.0, 0.7 / sr * 3.0 + 0.35);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vSkyQ; varying vec3 vSkyC; uniform float uSkyK, uSkyS;`)
      .replace('#include <map_fragment>', `
      float sq = dot(vSkyQ, vSkyQ);
      if (sq > 0.42) discard;
      diffuseColor = vec4(vSkyC * (1.0 - sq * 1.6) * ${LIGHT_GAIN.toFixed(1)} * uSkyS * uSkyK, 0.0);`);
  };
  lmat.customProgramCacheKey = () => 'sky-lights-2';
  const lights = new THREE.Mesh(lg, lmat); lights.name = 'sky-lights'; lights.frustumCulled = false; lights.renderOrder = 3;
  nightOnly(lights); scene.add(lights);

  // ---- per frame
  const m4 = new THREE.Matrix4(), mR = new THREE.Matrix4(), mR2 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), one = new THREE.Vector3(1, 1, 1), L = new THREE.Vector3();
  let t = 0;
  function step(dt, camera) {
    t += dt; uni.uSkyT.value = t;
    if (camera) uni.uSkyPx.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(1, typeof innerHeight === 'number' ? innerHeight : 1080));
    const night = nightK.value > 0.01;
    let k = 0;
    for (const c of craft) {
      c.at(t, P);
      q.setFromEuler(e.set(c.pitch, c.h, c.bank));
      c.mesh.setMatrixAt(c.idx, m4.compose(P, q, one));
      if (c.mesh === helis) rotors.setMatrixAt(c.idx, mR.makeRotationY(t * 9 + c.ph * 6).premultiply(mR2.makeTranslation(0, 0, 0.35)).multiply(mR2.makeTranslation(0, 0, -0.35)).premultiply(m4));
      if (night) for (const l of c.lights) { L.set(l[0], l[1], l[2]).applyMatrix4(m4); iP.setXYZ(k++, L.x, L.y, L.z); }
    }
    helis.instanceMatrix.needsUpdate = rotors.instanceMatrix.needsUpdate = liners.instanceMatrix.needsUpdate = blimp.instanceMatrix.needsUpdate = true;
    if (night) { iP.clearUpdateRanges(); iP.addUpdateRange(0, nAir * 3); iP.needsUpdate = true; }
  }
  step(0, null); iP.clearUpdateRanges(); iP.needsUpdate = true; // first upload: everything, roofs included
  return { update: (dt, camera) => step(Math.min(dt, 0.1), camera), stats: { helicopters: 3, airliners: 2, blimps: 1, roofLights: roof.length, lights: nL, routeKm: +(R.total / 1000).toFixed(1) }, craft, route: R };
}

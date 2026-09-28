// OWNER: systems engineer. Auto swing: Spider-Man swings through the city on his own and does not stop.
//   createAutoSwing(sys) -> { on, style, label, set(on, style?), toggle(), nextStyle(), nav, nodes (both for debugging) }
//   B switches it on / off, N picks the next style; ?auto or ?auto=<style> starts with it on.
//   While it is on ONLY B gives the controls back: the mouse still turns the camera, every other traversal key is ignored.
// It is a C5 control override (player.setControlOverride): it writes the input state a player would (swing button held /
// let go, Space, Q, E, C, the reel, stick direction) and reads player.state. Nothing in player/traversal/** knows it
// exists, so every rule of the swing (the three ways a web is let go, anchors on real surfaces) holds as it does for a
// person.
// Route: a walk over the roads (buildGraph below: they keep off the park, the rivers and the bridges), biased straight
// on and toward intersections not visited lately, so over time he covers the whole island.
// Crimes are switched off while it runs: a crime engages by distance, and a fight takes the control override.
import * as THREE from 'three';
import { roadGraph } from './route.js';
import { MAPS, mulberry32 } from '../../world/layout.js';

const clamp = THREE.MathUtils.clamp;
const KEYS = ['swing', 'jump', 'zip', 'drop', 'sprint', 'walk', 'quick', 'rope'];
// rel: the web is let go once his path climbs at this angle (rad): it is the elevation the launch leaves at
// jump: share of releases made with Space (the higher pop) · the next web is fired once he is falling faster than `grab`
// (m/s) AND is under `alt` m over the street: every release gains height, so without the ceiling a chain climbs out of
// the street canyon to the skyline (measured: 100-170 m up within a minute) · dive: head-first dive down to `alt`
// quick / flip / zip: chance per flight of a quick web boost (Q), a double-tap flip (Space Space), a web-zip launched
// off its point (E, then Space at the arrival) · reel: the manual reel held on the way down the arc (-1 = C, pay out)
// top: the speed he holds to (m/s). Webs fired back to back build the game's momentum chain (user r10g), which lifts
// its speed caps by up to 15 m/s: measured 54-57 m/s into corners, where a 90 deg turn needs a 33 m radius.
export const AUTO_STYLES = {
  cruise: { name: 'Cruise', rel: 0.5, jump: 0, grab: 1, alt: 45, top: 38, dive: false, quick: 0, flip: 0, zip: 0, reel: 0 },
  dive: { name: 'Dive', rel: 0.8, jump: 1, grab: -10, alt: 38, top: 50, dive: true, quick: 0, flip: 0, zip: 0, reel: 0 },
  acrobat: { name: 'Acrobat', rel: 0.62, jump: 0.5, grab: -4, alt: 60, top: 46, dive: false, quick: 0.45, flip: 0.5, zip: 0.2, reel: 0 },
  skim: { name: 'Skim', rel: 0.3, jump: 0, grab: -6, alt: 30, top: 44, dive: false, quick: 0, flip: 0, zip: 0, reel: -1 },
};
const ORDER = Object.keys(AUTO_STYLES);
// before a corner every style comes down to CORNER.top m/s, from CORNER.from m out: at 38 m/s and the swing's 1.7 rad/s
// the turn has a 22 m radius, which an avenue-to-street intersection holds. CHAIN = traversal's CHAIN_BUF, and a margin.
// WEB = the furthest the web itself may trail behind him (rad from straight down) whatever his path is doing
// A corner is taken ON A WEB. Measured over 58 corners: entered on a web about 4 in 5 came off, entered in the air
// about 1 in 2, because only a swing has the traversal's facade avoidance and corridor keeping, and because a release
// is followed by a trick: no web for 0.62 s and no air control for 0.35 s, which at 38 m/s is ~25 m straight on.
// So `near` m before the turn begins he lets go of the web he is on and fires the next at once: it is that one that
// turns, and it is let go at `rel` rad of path at the earliest, for `hold` s at most. (Simply holding the web he was
// on looped him over the top of 9-15 m ropes: 38 -> 16 m/s.)
const CORNER = { turn: 0.6, from: 140, top: 38, near: 20, rel: 0.9, hold: 2.5 }, CHAIN = 1.65, WEB = 1.1;

// The roads he follows -> [{x, z, adj: [index, ...]}]: the grid's intersections (route.js roadGraph) plus the junctions
// of the two authored street maps (layout.js MAPS: the Village, the Financial District), which the grid does not cover.
// Grid nodes INSIDE a street map are dropped: they pass route.js' road test by coincidence and form fragments (seven in
// the Financial District; he shuttled along one 650 m street making U-turns). Dead ends are then pruned until every
// node has a way on that is not the way back and not a hairpin (a bend over 1.9 rad with no other way on: one of
// 2.18 rad in the Financial District stopped him both times he met it), and only the largest connected part is kept.
function buildGraph() {
  let N = []; const grid = roadGraph().nodes, id = new Map();
  const inMap = (x, z) => MAPS.some(M => x > M.x0 + 1 && x < M.x1 - 1 && z > M.z0 + 1 && z < M.z1 - 1);
  const link = (a, b) => { if (a !== b && !N[a].adj.includes(b)) { N[a].adj.push(b); N[b].adj.push(a); } };
  grid.forEach((n, i) => { if (n.adj.length && !inMap(n.x, n.z)) { id.set(i, N.length); N.push({ x: n.x, z: n.z, adj: [] }); } });
  grid.forEach((n, i) => { if (id.has(i)) for (const [j] of n.adj) if (id.has(j)) link(id.get(i), id.get(j)); });
  const roads = []; N.forEach((n, a) => { for (const b of n.adj) if (a < b) roads.push({ a, b, on: [] }); });
  // a street-map junction: a node already there, or a new one, noted on the grid road it lies on
  const at = (x, z) => {
    let i = N.findIndex(n => Math.hypot(n.x - x, n.z - z) < 2); if (i >= 0) return i;
    i = N.length; N.push({ x, z, adj: [] });
    for (const r of roads) {
      const A = N[r.a], B = N[r.b];
      if ((Math.abs(A.x - B.x) < 1 && Math.abs(A.x - x) < 2 && (z - A.z) * (z - B.z) < 0) || (Math.abs(A.z - B.z) < 1 && Math.abs(A.z - z) < 2 && (x - A.x) * (x - B.x) < 0)) r.on.push(i);
    }
    return i;
  };
  for (const M of MAPS) for (const g of M.segs) link(at(g.ax, g.az), at(g.bx, g.bz));
  // a grid road with junctions on it becomes a chain through them, in order. (Joined to both ends instead, an end had
  // two neighbours lying the same way: it counted as a way on, and the route made a U-turn there.)
  for (const r of roads) {
    if (!r.on.length) continue;
    const A = N[r.a], chain = [r.a, ...r.on.sort((i, j) => Math.hypot(N[i].x - A.x, N[i].z - A.z) - Math.hypot(N[j].x - A.x, N[j].z - A.z)), r.b];
    A.adj = A.adj.filter(j => j !== r.b); N[r.b].adj = N[r.b].adj.filter(j => j !== r.a);
    for (let k = 1; k < chain.length; k++) link(chain[k - 1], chain[k]);
  }
  const keep = N.map(() => true);
  const stuck = i => {
    const a = N[i].adj.filter(j => keep[j]); if (a.length !== 2) return a.length < 2;
    const [P, Q] = [N[a[0]], N[a[1]]], ux = N[i].x - P.x, uz = N[i].z - P.z, wx = Q.x - N[i].x, wz = Q.z - N[i].z;
    return (ux * wx + uz * wz) / (Math.hypot(ux, uz) * Math.hypot(wx, wz)) < Math.cos(1.9);
  };
  for (let again = true; again;) { again = false; N.forEach((n, i) => { if (keep[i] && stuck(i)) { keep[i] = false; again = true; } }); }
  const part = new Int32Array(N.length).fill(-1), size = [];
  N.forEach((n, i) => {
    if (!keep[i] || part[i] >= 0) return;
    const st = [i]; part[i] = size.length; let c = 0;
    while (st.length) { c++; for (const j of N[st.pop()].adj) if (keep[j] && part[j] < 0) { part[j] = part[i]; st.push(j); } }
    size.push(c);
  });
  const big = size.indexOf(Math.max(...size)), to = new Map();
  N.forEach((n, i) => { if (part[i] === big) to.set(i, to.size); });
  N = N.filter((n, i) => to.has(i)); for (const n of N) n.adj = n.adj.filter(j => to.has(j)).map(j => to.get(j));
  return N;
}

export function createAutoSwing(sys) {
  const { ctx, ui, audio, save, flow } = sys;
  const P = ctx.player, s = P.state, T = P.traversal;
  const nodes = buildGraph();
  // ?autoseed=<n>: the same route every run, to compare one change against another. The route draws from its own
  // stream: sharing one with the per-swing draws, the route changed with the number of swings before each intersection
  const q = new URLSearchParams(location.search), seed = +q.get('autoseed') || 1;
  const rnd = q.has('autoseed') ? mulberry32(seed) : Math.random, rndRoute = q.has('autoseed') ? mulberry32(seed + 7919) : Math.random;
  // crimes = whether crimes go back on when it stops: they were on when it started, or the settings menu switched them on since
  let on = false, style = 'cruise', clock = 0, crimes = false;

  // ---------------------------------------------------------------- route
  // a = where this leg began, b = the intersection he is heading for, c = the one after it
  // left = metres to b, turn = how far the route turns there (rad), corner = seconds of the corner hold still to run
  const nav = { ax: 0, az: 0, ai: -1, b: -1, c: -1, left: 0, turn: 0, corner: 0, seen: new Float64Array(nodes.length).fill(-1e9), head: new THREE.Vector3(0, 0, 1) };
  function pick(fx, fz, fi, at) {
    const A = nodes[at], dx = A.x - fx, dz = A.z - fz, dl = Math.hypot(dx, dz) || 1;
    let best = -1, bs = -Infinity;
    for (const j of A.adj) {
      if (j === fi) continue; // (never back the way he came: every node has another way on)
      const B = nodes[j], ex = B.x - A.x, ez = B.z - A.z, el = Math.hypot(ex, ez) || 1;
      const straight = (dx * ex + dz * ez) / (dl * el);             // 1 straight on, 0 a turn, -1 back
      const age = Math.min(clock - nav.seen[j], 600) / 600;         // 0 just visited .. 1 not for ten minutes
      // (straight on at 0.6 turned him at most intersections: 58 corners in 24 minutes)
      const sc = 1.0 * straight + 1.4 * age - (straight < -0.3 ? 3 : 0) + rndRoute() * 0.8; // (a hairpin only when it is the one way on)
      if (sc > bs) { bs = sc; best = j; }
    }
    return best;
  }
  // from the nearest point of the nearest road, toward the end of it he is already moving to
  function start() {
    const p = s.pos; let bd = Infinity;
    nodes.forEach((A, a) => { for (const b of A.adj) {
      const B = nodes[b], ux = B.x - A.x, uz = B.z - A.z, L2 = ux * ux + uz * uz, t = clamp(((p.x - A.x) * ux + (p.z - A.z) * uz) / L2, 0, 0.9);
      const x = A.x + ux * t, z = A.z + uz * t, d = Math.hypot(p.x - x, p.z - z) - 0.3 * (s.vel.x * ux + s.vel.z * uz) / Math.sqrt(L2);
      if (d < bd) { bd = d; nav.ax = x; nav.az = z; nav.ai = a; nav.b = b; }
    } });
    nav.c = pick(nav.ax, nav.az, nav.ai, nav.b);
  }
  // The heading is toward a point on the route `la` m ahead of him, round the next corner if it is that near. On a
  // straight that eases him onto the centre line; at a corner the point slides round it, so the turn is an arc inside
  // the intersection. (Switching to the next leg's heading 12-40 m early sent him diagonally at the corner building:
  // corners dropped him to ~20 m/s, and one run went over a roof, another into a facade at 2 m/s.)
  function steer() {
    const p = s.pos;
    for (let k = 0; k < 2; k++) {
      const B = nodes[nav.b];
      let ux = B.x - nav.ax, uz = B.z - nav.az; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
      const along = (p.x - nav.ax) * ux + (p.z - nav.az) * uz, lat = (p.x - nav.ax) * uz - (p.z - nav.az) * ux;
      // far off the leg (fast travel, a teleport from the map, a bounce off the water): start again from here
      if (Math.abs(lat) > 150 || along < -150 || along > L + 150) { start(); continue; }
      if (along > L - 2) {
        nav.seen[nav.b] = clock;
        nav.ax = B.x; nav.az = B.z; nav.ai = nav.b; nav.b = nav.c; nav.c = pick(nav.ax, nav.az, nav.ai, nav.b);
        continue;
      }
      const la = clamp(Math.hypot(s.vel.x, s.vel.z) * 0.8, 18, 32), d = Math.max(along, 0) + la;
      const C = nodes[nav.c], wx = C.x - B.x, wz = C.z - B.z, wl = Math.hypot(wx, wz) || 1;
      let x = nav.ax + ux * d, z = nav.az + uz * d;
      if (d > L) { x = B.x + wx * (d - L) / wl; z = B.z + wz * (d - L) / wl; }
      nav.head.set(x - p.x, 0, z - p.z).normalize();
      nav.left = L - along; nav.turn = Math.acos(clamp((ux * wx + uz * wz) / wl, -1, 1));
      if (nav.turn > CORNER.turn && nav.left < la + CORNER.near) nav.corner = CORNER.hold;
      // past the corner and travelling along the new leg: the corner is done
      else if (nav.corner > 0 && s.vel.x * ux + s.vel.z * uz > 0.94 * Math.hypot(s.vel.x, s.vel.z)) nav.corner = 0;
      return;
    }
  }

  // ---------------------------------------------------------------- the input he would press
  const O = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, usingPad: false, ctrl: false, slingL: false, slingR: false, jumpHeld: 0, aimT: 99 };
  const prev = {};
  // F = this flight's plan (drawn at every web), hold = the swing button is down, taps = Space frames still to play
  let F = plan(), hold = false, modeWas = '', pulseT = 0;
  const taps = [], _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function plan() {
    const S = AUTO_STYLES[style];
    return { rel: S.rel + (rnd() - 0.5) * 0.2, jump: rnd() < S.jump, grab: S.grab, alt: S.alt, top: S.top, dive: S.dive, reel: S.reel,
      quick: rnd() < S.quick, flip: rnd() < S.flip, zip: rnd() < S.zip };
  }
  // held, let go for one frame every `period` s: each fresh press is a new attempt (hop into a swing, kick off a wall)
  const pulse = (dt, period) => { pulseT += dt; if (pulseT >= period) { pulseT = 0; return false; } return true; };

  function override(I, dt) {
    if (sys.crimes.enabled) { sys.crimes.enable(false); crimes = true; } // (the settings menu switched them on)
    clock += dt; nav.corner -= dt;
    const was = nav.corner > 0;
    steer(); avoid();
    const corner = nav.corner > 0;
    if (s.mode !== modeWas) { modeWas = s.mode; pulseT = 9; if (s.mode === 'swing') { F = plan(); hold = false; } }
    let swing = false, jump = false, zip = false, quick = false, drop = false, reel = 0, mag = 1;
    // up = over whatever is under him (a roof counts), street = over the street (the anchor finder's altitude band)
    const feet = s.pos.y - T.H, up = feet - T.floorAt(s.pos.x, s.pos.z, feet + 0.1), street = feet - ctx.world.groundHeight(s.pos.x, s.pos.z, 0.6);
    const fast = s.vel.length() > (nav.turn > CORNER.turn && nav.left < CORNER.from ? Math.min(F.top, CORNER.top) : F.top);
    if (taps.length) jump = taps.shift();
    if (s.kin) { /* a scripted move (vault, wall hop, corner wrap) plays out */ }
    else if (s.mode === 'swing') {
      const S = s.swing;
      swing = true;
      if (s.vel.y < 0) reel = F.reel;
      // Let go on the rising front of the arc, once his PATH climbs at the style's angle (over his speed: steeper, which
      // trades speed for height). Not swing.angle: it is stale for a frame after a web attaches, and a 0.3 s hold to
      // cover that let go of 4-5 m webs late (at 0.95 and 1.45 rad). The web to the REAL anchor bounds it: the arc is
      // about a raised virtual pivot (ropes of 60-90 m), so by 0.6 rad of path he is ~45 m past the anchor, where the
      // web cut through a building and wrapped (-11 m/s a time, and a launch nearly straight up).
      // A swing that never gets there (a wall kick) is let go at its apex.
      const past = (s.pos.x - S.anchor.x) * S.dir.x + (s.pos.z - S.anchor.z) * S.dir.z;
      const web = Math.atan2(past, Math.max(S.anchor.y - s.pos.y, 0.01)), path = Math.atan2(s.vel.y, Math.hypot(s.vel.x, s.vel.z));
      const rel = corner ? Math.max(F.rel, CORNER.rel) : F.rel + (fast ? 0.25 : 0);
      if (S.t > 0.12 && ((past > 0 && s.vel.y > 0 && (path > rel || web > WEB)) || S.apexed || S.t > 4)) { if (F.jump && !corner) jump = true; else swing = false; }
      // the web is about to cut through a building, where the traversal re-anchors or wraps it (-10 m/s a time): let go
      // first. Not in a corner: there he holds on and steers, and the traversal re-shoots the web as it needs to.
      else if (!corner && S.t > 0.3 && blocked(S.anchor)) swing = false;
      // a corner begins: the web he is on is let go, and the next one takes it
      else if (corner && !was && S.t > 0.4) swing = false;
      // over his speed and on his heading: a neutral stick, so the swing is a pendulum (no pump, no climb assist)
      if (fast && !corner && S.dir.x * nav.head.x + S.dir.z * nav.head.z > 0.99) mag = 0;
      // a swing that has stalled (hanging by a wall, under 10 m/s): a quick web boost along the route pulls him out of it
      // (at 6 m/s and 1 s, one that had kicked a wall hung for 3.8 s first)
      else if (S.t > 0.8 && s.vel.length() < 10) quick = !pulse(dt, 0.6);
    } else if (s.mode === 'air') {
      if (!hold && !(s.returnT > 0)) { // (returnT: the arc back from the water / a bridge limit is ballistic)
        const low = s.vel.y < 0 && up < 18 - 0.25 * s.vel.y; // near the floor: fire now
        // (over his speed he lets the momentum chain lapse before the next web)
        if ((s.vel.y < F.grab && street < F.alt && !(fast && s.sinceSwing < CHAIN)) || low || corner) hold = true;
        else if (F.flip && s.sub !== 'trick' && !s.airTrickUsed && s.relT > 0.3 && up > 12 && !taps.length) { taps.push(true, false, true); F.flip = false; }
        else if (F.quick && s.sub !== 'trick' && s.relT > 0.45 && s.vel.y < 4) { quick = true; F.quick = false; }
        else if (F.zip && s.zipCooldown <= 0 && zipAhead()) { zip = true; F.zip = false; }
        else if (F.dive && s.airT > 0.3 && s.vel.y < 3 && up > 30 && street > F.alt + 10) drop = true;
      }
      swing = hold;
      if (!drop && s.vel.y < -5) mag = 0.5; // (stick past half while falling = the W dive: he glides instead when no web can reach)
    } else if (s.mode === 'zip') {
      jump = s.sub !== 'zipFire' && (1 - s.zip.u) * s.zip.dur < 0.3; // launch off the point instead of perching on it
    } else if (s.mode === 'perch') {
      jump = !pulse(dt, 0.3); hold = false;
    } else if (s.mode === 'ground') {
      // the run is the parkour run; every fresh press hops into a swing when a web can reach, else charged jumps on the way
      swing = pulse(dt, 0.4); hold = true;
      if (s.modeT > 1 && s.modeT % 1.3 < 0.3) jump = true;
    } else if (s.mode === 'wall') {
      swing = pulse(dt, 0.4); hold = true; // kicks off the wall into a swing
    }
    // stick: the route heading in camera space (the camera turns with the mouse; applyLook runs after this)
    const yaw = P.cam.yaw - I.look.dx * P.cam.sens, h = nav.head;
    O.move.y = (h.x * Math.sin(yaw) + h.z * Math.cos(yaw)) * mag;
    O.move.x = (-h.x * Math.cos(yaw) + h.z * Math.sin(yaw)) * mag;
    O.look = I.look; O.aimT = I.aimT;
    Object.assign(O, { swing, jump, zip, quick, drop, reel, sprint: false, walk: false, rope: false });
    for (const k of KEYS) { O[k + 'Pressed'] = O[k] && !prev[k]; O[k + 'Released'] = !O[k] && !!prev[k]; prev[k] = O[k]; }
    O.jumpHeld = jump ? O.jumpHeld + dt : 0;
    return O;
  }
  // Never steer INTO a facade: with the stick into a wall the traversal takes it that he wants a wall run and gives him
  // one; with the stick along it he skips off the wall and keeps flying. The heading is turned onto the wall it meets.
  function avoid() {
    const h = nav.head, hit = ctx.world.raycast(s.pos, h, 14);
    if (!hit || Math.abs(hit.normal.y) > 0.5) return;
    const n = hit.normal, k = h.x * n.x + h.z * n.z, x = h.x - n.x * k, z = h.z - n.z * k;
    if (k < 0 && x * x + z * z > 0.04) h.set(x, 0, z).normalize();
  }
  // the straight line from where he will be in 0.2 s to the anchor runs through something (the test traversal's ropeWrap makes)
  function blocked(anchor) {
    const l = _d.copy(anchor).sub(_o.copy(s.pos).addScaledVector(s.vel, 0.2)).length(); if (l < 4) return false;
    const h = ctx.world.raycast(_o, _d.divideScalar(l), l - 1.5);
    return !!h && h.distance >= 1.5;
  }
  // the reticle's point lies along the route, within reach and not below him
  function zipAhead() {
    const t = P.zipTarget; if (!t || t.dist < 25 || t.dist > 80 || t.pos.y < s.pos.y - 4) return false;
    const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z, l = Math.hypot(dx, dz);
    return l > 1 && (dx * nav.head.x + dz * nav.head.z) / l > 0.8;
  }

  // ---------------------------------------------------------------- on / off
  const label = () => `${AUTO_STYLES[style].name} — B stops · N style`;
  function set(v, st) {
    if (AUTO_STYLES[st]) style = st;
    v = !!v; if (v === on) return;
    if (v && sys.inCombat?.()) { audio.sfx.deny?.(); return; } // the fight holds the control override
    on = v;
    if (on) {
      crimes = sys.crimes.enabled; sys.crimes.finish(false, 'expired'); sys.crimes.enable(false);
      for (const k of KEYS) prev[k] = false;
      taps.length = 0; hold = false; modeWas = ''; F = plan(); start();
      P.setControlOverride(override);
    } else {
      P.setControlOverride(null);
      sys.crimes.enable(crimes && save.state.settings.crimesOn !== false);
    }
    ui.toast({ title: on ? 'Auto Swing On' : 'Auto Swing Off', text: on ? label() : 'You have the controls', icon: 'swing', tone: 'cyan' });
  }
  function nextStyle() {
    style = ORDER[(ORDER.indexOf(style) + 1) % ORDER.length]; F = plan();
    ui.toast({ title: 'Auto Swing', text: label(), icon: 'swing', tone: 'cyan' });
  }
  flow.onKey((e, mode) => {
    if (mode !== 'play' || e.repeat) return false;
    if (e.code === 'KeyB') { set(!on); return true; }
    if (e.code === 'KeyN' && on) { nextStyle(); return true; }
    return false;
  });

  return {
    get on() { return on; }, get style() { return style; }, get label() { return label(); },
    set, toggle() { set(!on); }, nextStyle, nav, nodes,
  };
}

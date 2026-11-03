// routing.js: makes delivery routes from households with map points.
// Ported from monocoder77/table-route-packets (public/routing.js), algorithm unchanged.
//
// Pure functions, no DOM. lib/makeRoutes.js prepares the input and
// ui/routesCard.js runs build() in routeWorker.js so the page stays responsive.
// A route starts at TABLE, holds at most maxBags bags (one per child), and
// takes at most maxMinutes including the time at each door. Routes are open — drivers don't drive back to TABLE.
//
// Drive times are estimates from straight-line distance (no routing service,
// so nothing is sent anywhere and it costs nothing): roads wind (×1.3), town
// hops are slow, long rural legs faster, and every leg pays a minute to park.
function haversineMiles(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

// Doors in the same complex (under ~100 yards apart) are a short walk.
function legMinutes(a, b) {
  const road = haversineMiles(a, b) * 1.3;
  if (road < 0.06) return 0.5;
  const mph = 25 + 15 * Math.min(1, road / 10);
  return 1 + (60 * road) / mph;
}

// Minutes for a route driven in order: TABLE → first door → … → last door.
function routeMinutes(points, depot, stopMinutes) {
  let t = 0;
  let at = depot;
  for (const p of points) {
    t += legMinutes(at, p) + stopMinutes;
    at = p;
  }
  return t;
}

/* ------------------------------ the solver ------------------------------ */
// Ruin-and-recreate search after SISR ("Slack Induction by String Removals",
// Christiaens & Vanden Berghe, Transportation Science 2020). Goals in strict
// order: every limit kept; as few routes as possible (each is a volunteer);
// then the least total minutes. It starts from greedy nearest-neighbour
// routes, then alternates a fleet phase (close the emptiest route and
// ruin-and-recreate until its households fit elsewhere) with simulated
// annealing on minutes. Ruin cuts short strings of consecutive stops from a
// few routes near a random household; recreate puts them back one by one at
// the cheapest spot that keeps the limits, skipping ("blinking" past) a few
// spots at random. All randomness comes from a PRNG seeded with p.seed and
// the search length is an iteration count, never the clock, so the same
// households always give the same routes.
//
// p = {n, time, bags, service, maxBags, maxMinutes, seed}: time[i][j] is
// driving minutes (0 = TABLE, 1..n = households). Returns {routes: [[i, …]]}
// in driving order. A household that can't fit even alone rides alone.

// Search settings, tuned on fake weeks shaped like TABLE's (sizes, kids per
// household, town mix). Past 40,000 iterations, more search bought under
// 0.3% fewer minutes; this cap keeps a 533-household week to a few seconds.
const ROUTE_LNS = {
  avgRemoved: 10, // mean households removed per ruin (SISR "c-bar")
  maxString: 10, // longest string cut out of one route (SISR "L-max")
  splitRate: 0.5, // chance a cut keeps a few stops in the middle of the string
  splitDepth: 0.5, // chance of keeping one more stop in a split string
  blinkRate: 0.01, // chance recreate skips a candidate spot
  itersPerStop: 300, // search length grows with the number of households...
  minIters: 3000, //    ...but stays inside these bounds
  maxIters: 40000,
  fleetShare: 0.15, // budget of each fleet-reduction attempt (share of iters)
  tempStart: 0.5, // annealing temperature, as a multiple of the mean leg
  tempEnd: 0.01,
};

function solveRoutes(p) {
  const n = p.n | 0;
  const T = p.time;
  const bags = p.bags;
  const svc = p.service;
  const maxBags = p.maxBags;
  const maxMin = p.maxMinutes;
  // Seeded PRNG (Mulberry32), floats in [0, 1): the only source of randomness.
  let seedState = (Number.isFinite(p.seed) ? p.seed : 1) >>> 0;
  function rng() {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- Households that cannot fit even alone ride alone; the rest are routed.
  const alone = [];
  const active = [];
  for (let i = 1; i <= n; i++) {
    if (bags[i] > maxBags || T[0][i] + svc > maxMin) alone.push([i]);
    else active.push(i);
  }
  if (active.length <= 1) return { routes: active.length ? [active].concat(alone) : alone };

  // ---- Route state. A route is { stops, load, mins }; routeOf[i] is the route
  // object holding household i (null while it is removed or unplaced).
  let routes = [];
  const routeOf = new Array(n + 1).fill(null);
  let stamp = 0; // id of the current ruin-and-recreate step
  let saved = []; // undo log of routes changed in the current step

  function minutesOf(stops) {
    if (!stops.length) return 0;
    let t = T[0][stops[0]] + svc;
    for (let k = 1; k < stops.length; k++) t += T[stops[k - 1]][stops[k]] + svc;
    return t;
  }
  function refresh(r) {
    let load = 0;
    for (const c of r.stops) load += bags[c];
    r.load = load;
    r.mins = minutesOf(r.stops);
  }
  function makeRoute(stops) {
    const r = { stops, load: 0, mins: 0, mark: 0, ruined: 0 };
    refresh(r);
    for (const c of stops) routeOf[c] = r;
    return r;
  }
  const snapshot = () => routes.map((r) => r.stops.slice());
  function restore(snap) {
    routes = snap.map((s) => makeRoute(s.slice()));
  }
  function totalMinutes() {
    let t = 0;
    for (const r of routes) t += r.mins;
    return t;
  }

  // Undo log: remember a route the first time a step changes it.
  function begin() {
    stamp++;
    saved = [];
  }
  function touch(r) {
    if (r.mark === stamp) return;
    r.mark = stamp;
    saved.push({ r, stops: r.stops.slice(), load: r.load, mins: r.mins });
  }
  // Undo the current step. `moved` = every household the step picked up.
  function rollback(moved) {
    for (const c of moved) routeOf[c] = null;
    for (const s of saved) {
      s.r.stops = s.stops;
      s.r.load = s.load;
      s.r.mins = s.mins;
      for (const c of s.stops) routeOf[c] = s.r;
    }
  }
  const stepDelta = () => saved.reduce((d, s) => d + s.r.mins - s.mins, 0);

  // ---- Neighbour lists: for each household, all households by travel time
  // (itself first). Ties break by index so the order is deterministic.
  const near = new Array(n + 1);
  for (const c of active) {
    const row = T[c];
    near[c] = active
      .slice()
      .sort((a, b) => (a === c ? -1 : b === c ? 1 : row[a] - row[b] || a - b));
  }

  // ---- Lower bound on routes: by bags, and by minutes (each household is
  // reached over at least its cheapest incoming leg, plus its stop time).
  let bagSum = 0;
  let minuteSum = 0;
  for (const c of active) {
    bagSum += bags[c];
    let inLeg = T[0][c];
    for (const j of active) if (j !== c && T[j][c] < inLeg) inLeg = T[j][c];
    minuteSum += inLeg + svc;
  }
  const minRoutes = Math.max(
    1,
    Math.ceil(bagSum / Math.max(maxBags, 1e-9) - 1e-9),
    Math.ceil(minuteSum / Math.max(maxMin, 1e-9) - 1e-9)
  );

  // ---- Cheapest feasible spot for household c over all routes. Each spot is
  // skipped ("blinked") with probability `blink`; the coin is only tossed for
  // a spot that would beat the best so far, which picks from the same
  // distribution as tossing it for every spot, at a fraction of the cost.
  // Sets spotRoute (null if nothing fits) and spotPos.
  let spotRoute = null;
  let spotPos = 0;
  function cheapestSpot(c, blink) {
    const b = bags[c];
    const Tc = T[c];
    let bestD = Infinity;
    spotRoute = null;
    for (let ri = 0; ri < routes.length; ri++) {
      const r = routes[ri];
      if (r.load + b > maxBags) continue;
      const room = maxMin - r.mins - svc; // extra driving this route can absorb
      if (room < 0) continue;
      const st = r.stops;
      const len = st.length;
      let prev = 0;
      for (let k = 0; k <= len; k++) {
        const next = k < len ? st[k] : 0;
        // Open route: inserting after the last stop adds just one leg.
        const d = k < len ? Tc[prev] + Tc[next] - T[prev][next] : Tc[prev];
        if (d < bestD && d <= room && (blink === 0 || rng() >= blink)) {
          bestD = d;
          spotRoute = r;
          spotPos = k;
        }
        prev = next;
      }
    }
    return spotRoute;
  }
  function insertAt(r, pos, c) {
    touch(r);
    r.stops.splice(pos, 0, c);
    r.load += bags[c];
    r.mins = minutesOf(r.stops); // recomputed exactly, so limits never drift
    routeOf[c] = r;
  }

  // ---- Ruin: cut strings of consecutive stops from a few routes near a
  // random seed household (SISR). Returns the removed households.
  function ruin() {
    const removed = [];
    let routed = 0;
    let used = 0;
    for (const r of routes) {
      routed += r.stops.length;
      if (r.stops.length) used++;
    }
    const lsMax = Math.min(ROUTE_LNS.maxString, routed / Math.max(1, used));
    const ksMax = (4 * ROUTE_LNS.avgRemoved) / (1 + lsMax) - 1;
    const strings = 1 + Math.floor(rng() * ksMax);
    const list = near[active[Math.floor(rng() * active.length)]];
    let cut = 0;
    for (let a = 0; a < list.length && cut < strings; a++) {
      const c = list[a];
      const r = routeOf[c];
      if (r === null || r.ruined === stamp) continue;
      r.ruined = stamp;
      cut++;
      touch(r);
      const st = r.stops;
      const len = st.length;
      const l = Math.min(len, 1 + Math.floor(rng() * Math.min(len, lsMax)));
      // Split string: remove l stops from a window of l + m, keeping m in a row.
      let m = 0;
      let keepAt = 0;
      if (l < len && rng() < ROUTE_LNS.splitRate) {
        m = 1;
        while (l + m < len && rng() < ROUTE_LNS.splitDepth) m++;
        keepAt = Math.floor(rng() * (l + 1));
      }
      const w = l + m;
      const pos = st.indexOf(c);
      const lo = Math.max(0, pos - w + 1);
      const from = lo + Math.floor(rng() * (Math.min(pos, len - w) - lo + 1));
      const keep = [];
      for (let k = 0; k < len; k++) {
        const off = k - from;
        if (off < 0 || off >= w || (off >= keepAt && off < keepAt + m)) keep.push(st[k]);
        else {
          removed.push(st[k]);
          routeOf[st[k]] = null;
        }
      }
      r.stops = keep;
      refresh(r);
    }
    return removed;
  }

  // ---- Recreate: insert households one by one at their cheapest spot, in one
  // of four orders (random / most bags first / farthest / nearest first).
  // Households that fit nowhere go to `pool`; without a pool, fail at once.
  function recreate(list, pool) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    const order = rng() * 11; // weights 4 : 4 : 2 : 1 (stable sorts keep ties random)
    if (order >= 8 && order < 10) list.sort((a, b) => T[0][b] - T[0][a]);
    else if (order >= 10) list.sort((a, b) => T[0][a] - T[0][b]);
    else if (order >= 4) list.sort((a, b) => bags[b] - bags[a]);
    for (const c of list) {
      if (cheapestSpot(c, ROUTE_LNS.blinkRate)) insertAt(spotRoute, spotPos, c);
      else if (pool) pool.push(c);
      else return false;
    }
    return true;
  }

  const dropEmpty = () => {
    routes = routes.filter((r) => r.stops.length > 0);
  };

  // ---- Start: greedy nearest neighbour (fill a car, then start the next).
  {
    const left = new Set(active);
    while (left.size) {
      const stops = [];
      let at = 0;
      let load = 0;
      let mins = 0;
      for (;;) {
        let best = -1;
        let bestT = Infinity;
        for (const i of left) {
          const t = T[at][i];
          if (t < bestT && load + bags[i] <= maxBags && mins + t + svc <= maxMin) {
            best = i;
            bestT = t;
          }
        }
        if (best < 0) break;
        stops.push(best);
        left.delete(best);
        load += bags[best];
        mins += bestT + svc;
        at = best;
      }
      routes.push(makeRoute(stops));
    }
  }

  const totalIters = Math.round(
    Math.min(ROUTE_LNS.maxIters, Math.max(ROUTE_LNS.minIters, ROUTE_LNS.itersPerStop * active.length))
  );
  let itersLeft = totalIters;

  // ---- Fleet phase: close the emptiest route and ruin-and-recreate until
  // every household fits again. Candidate steps are accepted when they leave
  // fewer households unplaced, or when the ones left out have been left out
  // less often so far (SISR's absence counters, which rotate the hard cases).
  function fleetPhase(budget) {
    const absent = new Int32Array(n + 1);
    const absentSum = (list) => list.reduce((s, c) => s + absent[c], 0);
    let best = snapshot();
    while (routes.length > minRoutes && budget > 0) {
      let victim = routes[0];
      const fill = (r) => r.load / maxBags + r.mins / maxMin;
      for (const r of routes) if (fill(r) < fill(victim)) victim = r;
      let pool = victim.stops.slice();
      for (const c of pool) routeOf[c] = null;
      routes = routes.filter((r) => r !== victim);
      while (pool.length && budget > 0) {
        budget--;
        itersLeft--;
        begin();
        const moved = ruin();
        const list = moved.concat(pool);
        const next = [];
        recreate(list, next);
        if (next.length < pool.length || absentSum(next) < absentSum(pool)) pool = next;
        else rollback(list);
        for (const c of next) absent[c]++;
      }
      if (pool.length) break; // could not close it: keep the last full solution
      dropEmpty();
      best = snapshot();
    }
    restore(best);
  }

  // ---- Cost phase: simulated annealing over ruin-and-recreate steps. A step
  // that empties a route (one fewer driver) is always taken.
  let bestSnap = snapshot();
  let bestCount = routes.length;
  let bestCost = totalMinutes();
  function keepIfBest(cost) {
    if (routes.length < bestCount || (routes.length === bestCount && cost < bestCost - 1e-9)) {
      bestSnap = snapshot();
      bestCount = routes.length;
      bestCost = cost;
    }
  }
  function costPhase(iters, meanLeg) {
    const t0 = ROUTE_LNS.tempStart * meanLeg;
    const t1 = ROUTE_LNS.tempEnd * meanLeg;
    let cost = totalMinutes();
    for (let it = 0; it < iters; it++) {
      itersLeft--;
      const temp = t0 * Math.pow(t1 / t0, it / iters);
      begin();
      const moved = ruin();
      if (!recreate(moved, null)) {
        rollback(moved);
        continue;
      }
      const delta = stepDelta();
      const emptied = saved.some((s) => s.r.stops.length === 0);
      // Annealing test: accept if delta < T * -ln(U), U uniform in (0, 1].
      if (emptied || delta < -temp * Math.log(1 - rng())) {
        cost += delta;
        if (emptied) dropEmpty();
        keepIfBest(cost);
      } else rollback(moved);
    }
    restore(bestSnap);
  }

  const meanLeg = Math.max(0.1, (totalMinutes() - active.length * svc) / active.length);
  const fleetBudget = Math.round(totalIters * ROUTE_LNS.fleetShare);
  if (routes.length > minRoutes) fleetPhase(fleetBudget);
  keepIfBest(totalMinutes());
  costPhase(Math.floor(itersLeft * 0.45), meanLeg);
  if (routes.length > minRoutes) {
    fleetPhase(fleetBudget);
    keepIfBest(totalMinutes());
  }
  costPhase(Math.max(0, itersLeft), meanLeg);

  return { routes: bestSnap.filter((s) => s.length > 0).concat(alone) };
}

// Improve one open route in place (depot 0 → r[0] → … → r[last]): 2-opt
// reversals and or-opt moves of 1–3 stops, until nothing gets shorter.
function polishRoute(p, r) {
  const t = p.time;
  const n = r.length;
  if (n < 3) return r;
  const len = (arr) => arr.reduce((s, x, k) => s + t[k ? arr[k - 1] : 0][x], 0);
  let improved = true;
  for (let guard = 0; improved && guard < 200; guard++) {
    improved = false;
    // 2-opt: reverse r[i..j]. The tail after j may be empty (open route).
    for (let i = 0; i < n - 1; i++) {
      const a = i ? r[i - 1] : 0;
      for (let j = i + 1; j < n; j++) {
        const b = j + 1 < n ? r[j + 1] : -1;
        const before = t[a][r[i]] + (b >= 0 ? t[r[j]][b] : 0);
        const after = t[a][r[j]] + (b >= 0 ? t[r[i]][b] : 0);
        if (after < before - 1e-9) {
          for (let x = i, y = j; x < y; x++, y--) [r[x], r[y]] = [r[y], r[x]];
          improved = true;
        }
      }
    }
    // or-opt: lift a run of 1–3 stops and drop it (either way round) at
    // the cheapest other gap.
    for (let seg = 1; seg <= 3; seg++) {
      for (let i = 0; i + seg <= n; i++) {
        const base = len(r);
        const run = r.slice(i, i + seg);
        const rest = [...r.slice(0, i), ...r.slice(i + seg)];
        let best = null;
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          for (const piece of [run, [...run].reverse()]) {
            const cand = [...rest.slice(0, k), ...piece, ...rest.slice(k)];
            const c = len(cand);
            if (c < base - 1e-9 && (!best || c < best.c)) best = { cand, c };
          }
        }
        if (best) {
          r.splice(0, n, ...best.cand);
          improved = true;
        }
      }
    }
  }
  return r;
}

/* ------------------------------ public API ------------------------------ */

function matrixFor(points, depot) {
  const all = [depot, ...points];
  return all.map((a, i) => Float64Array.from(all, (b, j) => (i === j ? 0 : legMinutes(a, b))));
}

// households: [{id, lat, lng, bags}] → {routes: [[id, …], …]} in driving order.
function build(households, opts) {
  const depot = opts.depot;
  const p = {
    n: households.length,
    time: matrixFor(households, depot),
    bags: [0, ...households.map((h) => Math.max(0, h.bags || 0))],
    service: opts.stopMinutes,
    maxBags: opts.maxBags,
    maxMinutes: opts.maxMinutes,
    seed: opts.seed ?? 1,
  };
  const { routes } = solveRoutes(p);
  return { routes: routes.map((r) => r.map((i) => households[i - 1].id)) };
}

// Where a new door slots into an existing route most cheaply — the index to
// insert at, and the minutes it adds.
function bestInsertion(points, point, depot, stopMinutes) {
  let best = { index: points.length, added: Infinity };
  for (let k = 0; k <= points.length; k++) {
    const prev = k === 0 ? depot : points[k - 1];
    const next = points[k];
    const added =
      legMinutes(prev, point) + stopMinutes + (next ? legMinutes(point, next) - legMinutes(prev, next) : 0);
    if (added < best.added) best = { index: k, added };
  }
  return best;
}

// A better driving order for one route (open path from TABLE): or-opt moves
// and 2-opt reversals until nothing improves. Returns indexes into points.
function improveOrder(points, depot, stopMinutes) {
  const n = points.length;
  if (n < 3) return points.map((_, i) => i);
  const time = matrixFor(points, depot);
  const p = { time, service: stopMinutes };
  const order = points.map((_, i) => i + 1);
  polishRoute(p, order);
  return order.map((i) => i - 1);
}

export { build, solveRoutes, bestInsertion, improveOrder, routeMinutes, legMinutes, haversineMiles };

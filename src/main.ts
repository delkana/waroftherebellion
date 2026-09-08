import * as THREE from 'three';
import { Overlay } from './core/overlay';
import { GalaxyView, type GalaxySelection } from './galaxy/galaxyView';
import { BattleSim } from './battle/battleSim';
import { BattleView } from './battle/battleView';
import { Hud, type TargetMode } from './ui/hud';
import { generateGalaxy } from './sim/galaxyGen';
import { applyBattleResult, autoResolve, gatherBattle, type BattleSetup } from './sim/combat';
import { cancelBuild, enqueueBuild, buildOptions, orderInvade, orderMerge, orderMission, orderMove, orderSplit, orderStop, step, transferTroops, log, missionProblem, assignGovernor, assignCommander, relieve } from './sim/sim';
import { findPath } from './sim/pathfinding';
import type { FactionId, GameState } from './sim/types';

// ------------------------------------------------------------------ setup
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x020408);
const overlay = new Overlay(overlayCanvas);

type Mode = 'menu' | 'galaxy' | 'battle';
let mode: Mode = 'menu';
let state: GameState | null = null;
let galaxy: GalaxyView | null = null;
let battle: { sim: BattleSim; view: BattleView; setup: BattleSetup; speed: number; acc: number; resultShown: boolean } | null = null;
let sel: GalaxySelection | null = null;
let target: TargetMode = null;
let lastSpeed = 1;
let promptShown = false;
let gameOverShown = false;

function resize(): void {
  overlay.resize();
  renderer.setSize(overlay.width, overlay.height, false);
  galaxy?.resize();
  battle?.view.resize();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ galaxy helpers
function setSelection(next: GalaxySelection | null): void {
  sel = next;
  if (galaxy) galaxy.selection = next;
}
function selectedFleet() {
  if (!state || sel?.kind !== 'fleet') return null;
  return state.fleets.find(f => f.id === sel!.id) ?? null;
}
function setTarget(t: TargetMode): void {
  target = t;
  if (galaxy) galaxy.targetMode = !!t;
  overlayCanvas.classList.toggle('target', !!t);
  if (t && state) {
    const ch = state.characters.find(c => c.id === t.charId)!;
    hud.setStatus(`${ch.title} ${ch.name}: choose a target planet for ${t.type}`);
  } else hud.setStatus(null);
}
function setSpeed(n: number): void {
  if (!state) return;
  if (state.pendingBattle || state.winner) { state.speed = 0; return; }
  state.speed = n;
  if (n > 0) lastSpeed = n;
}

const galaxyCallbacks = {
  onClickPlanet(id: number) {
    if (!state) return;
    if (target) {
      const ch = state.characters.find(c => c.id === target!.charId);
      if (ch) {
        const problem = missionProblem(state, ch, target.type, id);
        if (problem) { log(state, `${ch.title} ${ch.name}: ${problem}`, 'bad', state.player, id); return; }
        if (orderMission(state, ch, target.type, id)) log(state, `${ch.title} ${ch.name} dispatched: ${target.type} on ${state.planets[id].name}`, 'info', state.player, id);
      }
      setTarget(null);
      return;
    }
    setSelection({ kind: 'planet', id });
  },
  onClickFleet(id: number) { setSelection({ kind: 'fleet', id }); },
  onClickEmpty() { if (target) setTarget(null); else setSelection(null); },
  onRightClickPlanet(id: number) {
    if (!state) return;
    const f = selectedFleet();
    if (f && f.faction === state.player && !state.observer) {
      if (orderMove(state, f, id)) log(state, `${f.name} ordered to ${state.planets[id].name}`, 'info', state.player, id);
    } else galaxy?.focusPlanet(id);
  },
  onDoubleClickPlanet(id: number) { galaxy?.focusPlanet(id, 60); setSelection({ kind: 'planet', id }); },
};

// ------------------------------------------------------------------ battles
function startTacticalBattle(): void {
  if (!state || !state.pendingBattle || !galaxy) return;
  const setup = gatherBattle(state, state.pendingBattle);
  const sim = new BattleSim(setup, state.player, !!state.observer);
  const view = new BattleView(renderer, overlay, sim, state.planets[setup.planet].type);
  const speeds = [0, 0.5, 1, 2];
  view.onSpeedKey = code => {
    if (!battle) return;
    const i = speeds.indexOf(battle.speed);
    if (code === 'Space') battle.speed = battle.speed === 0 ? 1 : 0;
    else if (code === 'Minus' || code === 'NumpadSubtract') battle.speed = speeds[Math.max(0, i - 1)];
    else if (code === 'Equal' || code === 'NumpadAdd') battle.speed = speeds[Math.min(speeds.length - 1, i + 1)];
  };
  galaxy.detach();
  view.attach();
  battle = { sim, view, setup, speed: 1, acc: 0, resultShown: false };
  mode = 'battle';
  hud.hideModal();
  hud.showBattle();
  promptShown = false;
}

function finishBattle(): void {
  if (!state || !battle || !galaxy || !battle.sim.result) return;
  applyBattleResult(state, battle.setup, battle.sim.result);
  battle.view.detach();
  battle.view.dispose();
  const planet = battle.setup.planet;
  battle = null;
  mode = 'galaxy';
  galaxy.attach();
  hud.showGalaxy();
  galaxy.focusPlanet(planet);
  setSelection({ kind: 'planet', id: planet });
  if (!state.pendingBattle) setSpeed(lastSpeed);
}

// ------------------------------------------------------------------ HUD actions
const hud = new Hud(document.getElementById('hud')!, {
  setSpeed,
  togglePause() { if (state) setSpeed(state.speed === 0 ? lastSpeed : 0); },
  selectPlanet(id) { setSelection({ kind: 'planet', id }); galaxy?.focusPlanet(id); },
  selectFleet(id) { setSelection({ kind: 'fleet', id }); galaxy?.focusFleet(id); },
  focusPlanet(id) { galaxy?.focusPlanet(id); setSelection({ kind: 'planet', id }); },
  build(planetId, kind, cls) {
    if (!state) return;
    const p = state.planets[planetId];
    const item = buildOptions(state, p).find(o => o.kind === kind && (kind !== 'ship' || o.cls === cls));
    if (item) enqueueBuild(state, p, item);
  },
  cancelBuild(planetId, idx) { if (state) cancelBuild(state, state.planets[planetId], idx); },
  startMission(charId, type) {
    if (state?.observer) return;
    if (target && target.charId === charId && target.type === type) setTarget(null);
    else setTarget({ kind: 'mission', charId, type });
  },
  cancelTarget() { setTarget(null); },
  govern(charId) { if (state && !state.observer) { const c = state.characters.find(x => x.id === charId); if (c) assignGovernor(state, c); } },
  board(charId, fleetId) { if (state && !state.observer) { const c = state.characters.find(x => x.id === charId); const f = state.fleets.find(x => x.id === fleetId); if (c && f) assignCommander(state, c, f); } },
  relieve(charId) { if (state && !state.observer) { const c = state.characters.find(x => x.id === charId); if (c) relieve(state, c); } },
  invade(fleetId) { if (state) { const f = state.fleets.find(x => x.id === fleetId); if (f) orderInvade(state, f); } },
  merge(intoId, fromId) {
    if (!state) return;
    const a = state.fleets.find(x => x.id === intoId), b = state.fleets.find(x => x.id === fromId);
    if (a && b) orderMerge(state, a, b);
  },
  troops(fleetId, n) { if (state) { const f = state.fleets.find(x => x.id === fleetId); if (f) transferTroops(state, f, n); } },
  detach(fleetId, cls) {
    if (!state) return;
    const f = state.fleets.find(x => x.id === fleetId);
    if (!f) return;
    const nf = orderSplit(state, f, f.ships.filter(sh => sh.cls === cls).map(sh => sh.id), 0);
    if (nf) setSelection({ kind: 'fleet', id: nf.id });
  },
  stopFleet(fleetId) { if (state) { const f = state.fleets.find(x => x.id === fleetId); if (f) orderStop(state, f); } },
  fightBattle: startTacticalBattle,
  watchBattle: startTacticalBattle,
  toggleAutoBattles() { if (state) state.autoBattles = !state.autoBattles; },
  autoResolve() {
    if (!state || !state.pendingBattle) return;
    const setup = gatherBattle(state, state.pendingBattle);
    const result = autoResolve(setup);
    const logStart = state.log.length;
    applyBattleResult(state, setup, result);
    // leader fates and other consequences logged during resolution become the report's notes
    const notes = state.log.slice(logStart).filter(e => !e.text.startsWith('Battle of')).map(e => e.text);
    promptShown = false;
    setSelection({ kind: 'planet', id: setup.planet });
    hud.showBattleSummary(state, setup, result, notes);
  },
  closeSummary() {
    if (!state) return;
    if (!state.pendingBattle) setSpeed(lastSpeed);
  },
  newGame(faction: FactionId | 'observer', seed: number) {
    const observer = faction === 'observer';
    state = generateGalaxy({ seed, player: observer ? 'empire' : faction, observer });
    if (observer) log(state, 'Observer mode: both sides are commanded by the AI.', 'info');
    else log(state, faction === 'empire' ? 'The Rebel base hides somewhere in the Outer Rim. Find it and crush it.' : 'The Empire does not know where our base is. Keep it that way.', 'info', faction);
    beginGalaxy();
  },
  loadGame() {
    const raw = localStorage.getItem('wotr-save');
    if (!raw) return false;
    try { state = JSON.parse(raw) as GameState; } catch { return false; }
    state.speed = 0;
    beginGalaxy();
    return true;
  },
  saveGame() {
    if (!state) return;
    localStorage.setItem('wotr-save', JSON.stringify(state));
    log(state, 'Game saved', 'info', state.player);
  },
  toMenu() {
    if (battle) { battle.view.detach(); battle = null; }
    galaxy?.detach();
    mode = 'menu';
    hud.showMenu();
  },
  battleSpeed(n) { if (battle) battle.speed = n; },
  battleRetreat() { if (battle) battle.sim.cmdRetreat(battle.sim.playerSide); },
  battleSelectClass(cls) { if (battle) battle.view.selectUnits(battle.sim.alive(battle.sim.playerSide).filter(u => u.cls.id === cls)); },
  battleSelectAll() { if (battle) battle.view.selectUnits(battle.sim.alive(battle.sim.playerSide)); },
  battleFormation(f) { if (battle) battle.view.setFormation(f); },
  battleMute() { if (battle) { battle.view.audio.enable(); battle.view.toggleMute(); } },
  battleReturn: finishBattle,
});

function beginGalaxy(): void {
  if (!state) return;
  if (!galaxy) galaxy = new GalaxyView(renderer, overlay, state, galaxyCallbacks);
  else galaxy.setState(state);
  resize();
  setSelection(null);
  setTarget(null);
  promptShown = false; gameOverShown = false;
  mode = 'galaxy';
  galaxy.attach();
  hud.showGalaxy();
  state.speed = 1; lastSpeed = 1;
}

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', e => {
  if (mode !== 'galaxy' || !state) return;
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); setSpeed(state.speed === 0 ? lastSpeed : 0); break;
    case 'Digit1': setSpeed(1); break;
    case 'Digit2': setSpeed(2); break;
    case 'Digit3': setSpeed(4); break;
    case 'Digit4': setSpeed(8); break;
    case 'Escape': if (target) setTarget(null); else setSelection(null); break;
    case 'KeyF': if (sel?.kind === 'planet') galaxy?.focusPlanet(sel.id); else if (sel?.kind === 'fleet') galaxy?.focusFleet(sel.id); break;
    case 'KeyH': galaxy?.focusPlanet(state.factions[state.player].hq); break;
  }
});

// ------------------------------------------------------------------ main loop
const STEP = 1 / 60;
/** Game hours per real second at 1x speed (2 real seconds = 1 game hour). */
const HOURS_PER_REAL_SECOND = 0.5;
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}
function tick(dt: number): void {
  // catch layout changes that arrive without a resize event (e.g. a tab that loaded while hidden)
  const cw = overlayCanvas.clientWidth, chh = overlayCanvas.clientHeight;
  if (cw > 0 && chh > 0 && (cw !== overlay.width || chh !== overlay.height)) resize();
  if (mode === 'galaxy' && state && galaxy) {
    if (!state.pendingBattle && !state.winner) step(state, dt * state.speed * HOURS_PER_REAL_SECOND);
    if (state.pendingBattle && state.observer && state.autoBattles) {
      const setup = gatherBattle(state, state.pendingBattle);
      applyBattleResult(state, setup, autoResolve(setup));
      if (!state.pendingBattle) state.speed = lastSpeed;
    }
    if (state.pendingBattle && !promptShown) { promptShown = true; state.speed = 0; hud.showBattlePrompt(state, gatherBattle(state, state.pendingBattle)); }
    if (state.winner && !gameOverShown) { gameOverShown = true; state.speed = 0; hud.showGameOver(state); }
    // route preview while a fleet is selected and hovering a planet
    const f = selectedFleet();
    if (f && f.faction === state.player && galaxy.hoverPlanet !== null && !target) {
      const origin = f.at ?? f.travel!.to;
      galaxy.preview = findPath(state.lanes, origin, galaxy.hoverPlanet);
    } else galaxy.preview = null;
    galaxy.update(dt);
    galaxy.render();
    galaxy.drawOverlay();
    hud.update(state, sel, target);
  } else if (mode === 'battle' && battle && state) {
    battle.acc += dt * battle.speed * (battle.sim.slowMo > 0 ? 0.3 : 1);
    let n = 0;
    while (battle.acc >= STEP && n < 8) { battle.sim.step(STEP); battle.acc -= STEP; n++; }
    if (battle.acc > STEP * 8) battle.acc = 0;
    battle.view.update(dt);
    battle.view.render();
    battle.view.drawOverlay();
    hud.updateBattle(battle.sim, battle.view.selected, battle.speed, state.planets[battle.setup.planet].name, battle.view.formation, battle.view.audio.muted);
    if (battle.sim.over && !battle.resultShown) { battle.resultShown = true; hud.showBattleResult(battle.sim, state.planets[battle.setup.planet].name); }
  } else {
    renderer.clear();
    overlay.begin();
  }
}

resize();
hud.showMenu();
requestAnimationFrame(frame);

// Debug hooks (console): wotr.state(), wotr.forceBattle(), wotr.hud
(window as unknown as { wotr: unknown }).wotr = {
  state: () => state,
  battle: () => battle,
  galaxy: () => galaxy,
  overlay,
  hud,
  tick(seconds: number) { for (let i = 0; i < seconds * 30; i++) tick(1 / 30); },
  forceBattle() {
    if (!state) return;
    const enemy = state.fleets.find(f => f.faction !== state!.player);
    if (!enemy) return;
    enemy.at = state.factions[state.player].hq; enemy.travel = null;
    state.pendingBattle = { planet: enemy.at, attacker: enemy.faction };
    state.speed = 0;
  },
};

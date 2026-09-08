import type { BattleSetup } from '../sim/combat';
import { alignment, buildCost, buildOptions, canInvade, charactersAt, factionName, fleetStrength, fleetTroopCap, fleetsAt, MISSION_DESC, MISSION_LABEL, planetIncomePerDay } from '../sim/sim';
import { shipClass } from '../sim/ships';
import { fmtTime, type Character, type FactionId, type Fleet, type GameState, type MissionType, type Planet } from '../sim/types';
import { canSeeDetails, canSeeFleet, knowsHq } from '../sim/visibility';
import type { GalaxySelection } from '../galaxy/galaxyView';
import type { BattleSim, BUnit, Formation } from '../battle/battleSim';
import { travelHours } from '../sim/ai';

export type TargetMode = { kind: 'mission'; charId: number; type: MissionType } | null;

export interface HudActions {
  setSpeed(n: number): void;
  togglePause(): void;
  selectPlanet(id: number): void;
  selectFleet(id: number): void;
  focusPlanet(id: number): void;
  build(planetId: number, kind: string, cls?: string): void;
  cancelBuild(planetId: number, idx: number): void;
  startMission(charId: number, type: MissionType): void;
  cancelTarget(): void;
  invade(fleetId: number): void;
  merge(intoId: number, fromId: number): void;
  troops(fleetId: number, n: number): void;
  detach(fleetId: number, cls: string): void;
  stopFleet(fleetId: number): void;
  fightBattle(): void;
  autoResolve(): void;
  newGame(faction: FactionId, seed: number): void;
  loadGame(): boolean;
  saveGame(): void;
  toMenu(): void;
  battleSpeed(n: number): void;
  battleRetreat(): void;
  battleSelectClass(cls: string): void;
  battleSelectAll(): void;
  battleFormation(f: Formation): void;
  battleMute(): void;
  battleReturn(): void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fac = (f: FactionId | null) => f ? `<span class="${f}">${factionName(f)}</span>` : '<span class="neutral">Neutral</span>';
const hrs = (h: number) => h < 24 ? `${Math.ceil(h)}h` : `${Math.floor(h / 24)}d ${Math.ceil(h % 24)}h`;

export class Hud {
  private root: HTMLElement;
  private lastSide = '';
  private lastLog = '';
  private lastTop = '';
  private lastBattleSel = '';
  private lastBattleForces = '';
  private menuFaction: FactionId = 'rebellion';

  constructor(root: HTMLElement, private a: HudActions) {
    this.root = root;
    root.innerHTML = `
      <div id="menu"></div>
      <div id="topbar"></div>
      <div id="objectives" class="panel"></div>
      <div id="status" class="panel"></div>
      <div id="side" class="panel"></div>
      <div id="log" class="panel"></div>
      <div id="help" class="panel"></div>
      <div id="btop"></div>
      <div id="bhud"></div>
      <div id="bresult" class="panel"></div>
      <div id="modal"></div>`;
    root.addEventListener('click', e => this.onClick(e));
  }

  private el(id: string): HTMLElement { return this.root.querySelector('#' + id)!; }

  private onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!t) return;
    const d = t.dataset;
    const num = (k: string) => Number(d[k]);
    switch (d.action) {
      case 'speed': this.a.setSpeed(num('speed')); break;
      case 'pause': this.a.togglePause(); break;
      case 'selectPlanet': this.a.selectPlanet(num('id')); break;
      case 'selectFleet': this.a.selectFleet(num('id')); break;
      case 'focusPlanet': this.a.focusPlanet(num('id')); break;
      case 'build': this.a.build(num('planet'), d.kind!, d.cls); break;
      case 'cancel': this.a.cancelBuild(num('planet'), num('idx')); break;
      case 'mission': this.a.startMission(num('char'), d.type as MissionType); break;
      case 'cancelTarget': this.a.cancelTarget(); break;
      case 'invade': this.a.invade(num('fleet')); break;
      case 'merge': this.a.merge(num('into'), num('from')); break;
      case 'troops': this.a.troops(num('fleet'), num('n')); break;
      case 'detach': this.a.detach(num('fleet'), d.cls!); break;
      case 'stop': this.a.stopFleet(num('fleet')); break;
      case 'fight': this.a.fightBattle(); break;
      case 'auto': this.a.autoResolve(); break;
      case 'menuFaction': this.menuFaction = d.faction as FactionId; this.renderMenu(); break;
      case 'newGame': { const seedEl = this.root.querySelector('#seed') as HTMLInputElement; const seed = Number(seedEl?.value) || Math.floor(Math.random() * 1e6); this.a.newGame(this.menuFaction, seed); break; }
      case 'load': if (!this.a.loadGame()) alert('No saved game found'); break;
      case 'save': this.a.saveGame(); break;
      case 'menu': this.a.toMenu(); break;
      case 'bspeed': this.a.battleSpeed(num('speed')); break;
      case 'retreat': this.a.battleRetreat(); break;
      case 'bclass': this.a.battleSelectClass(d.cls!); break;
      case 'bselectall': this.a.battleSelectAll(); break;
      case 'bform': this.a.battleFormation(d.form as Formation); break;
      case 'bmute': this.a.battleMute(); break;
      case 'breturn': this.a.battleReturn(); break;
      case 'closeModal': this.hideModal(); break;
    }
  }

  // ------------------------------------------------------------ visibility
  private show(ids: string[]): void {
    for (const id of ['menu', 'topbar', 'objectives', 'status', 'side', 'log', 'help', 'btop', 'bhud', 'bresult', 'modal']) {
      const el = this.el(id);
      el.style.display = ids.includes(id) ? '' : 'none';
    }
  }
  showMenu(): void { this.show(['menu']); this.renderMenu(); }
  showGalaxy(): void { this.show(['topbar', 'objectives', 'status', 'side', 'log', 'help']); this.lastSide = this.lastTop = this.lastLog = ''; this.el('status').classList.remove('show'); this.el('modal').classList.remove('show'); this.el('modal').style.display = ''; }
  showBattle(): void { this.show(['btop', 'bhud', 'bresult']); this.el('bresult').classList.remove('show'); this.lastBattleSel = this.lastBattleForces = ''; }

  private renderMenu(): void {
    const hasSave = !!localStorage.getItem('wotr-save');
    this.el('menu').innerHTML = `
      <div class="box panel">
        <h1>War of the <b>Rebellion</b></h1>
        <p>Real-time galactic conquest along the hyperlanes. Choose your side.</p>
        <div class="sides">
          <div class="side empire ${this.menuFaction === 'empire' ? 'selected' : ''}" data-action="menuFaction" data-faction="empire">
            <h3>Galactic Empire</h3>
            <p>The industry of the Core Worlds and the throne on Coruscant. Find and crush the hidden Rebel base before the Outer Rim turns against you.</p>
          </div>
          <div class="side rebellion ${this.menuFaction === 'rebellion' ? 'selected' : ''}" data-action="menuFaction" data-faction="rebellion">
            <h3>Rebel Alliance</h3>
            <p>A hidden base and a few loyal worlds. Win hearts with diplomacy, raid Imperial shipping, and take Coruscant itself.</p>
          </div>
        </div>
        <div><label>Galaxy seed</label><input id="seed" value="${Math.floor(Math.random() * 100000)}" /></div>
        <button class="primary start" data-action="newGame">Begin the war</button>
        ${hasSave ? '<button class="start" data-action="load">Continue saved game</button>' : ''}
      </div>`;
  }

  setStatus(text: string | null): void {
    const el = this.el('status');
    if (text) { el.innerHTML = `${esc(text)} &nbsp; <button class="small" data-action="cancelTarget">Cancel (Esc)</button>`; el.classList.add('show'); }
    else el.classList.remove('show');
  }

  // ------------------------------------------------------------ galaxy update
  update(s: GameState, sel: GalaxySelection | null, target: TargetMode): void {
    const me = s.player;
    const f = s.factions[me];
    const top = `
      <span class="faction ${me}">${factionName(me)}</span>
      <span class="stat">Credits <b>${Math.floor(f.credits)}</b></span>
      <span class="stat">Income <b>${s.dayIncome[me].toFixed(0)}</b>/day</span>
      <span class="stat">Worlds <b>${s.planets.filter(p => p.owner === me).length}</b> / ${s.planets.length}</span>
      <span class="spacer"></span>
      <span class="speed">
        <button data-action="speed" data-speed="0" class="${s.speed === 0 ? 'active' : ''}">❚❚</button>
        <button data-action="speed" data-speed="1" class="${s.speed === 1 ? 'active' : ''}">1×</button>
        <button data-action="speed" data-speed="2" class="${s.speed === 2 ? 'active' : ''}">2×</button>
        <button data-action="speed" data-speed="4" class="${s.speed === 4 ? 'active' : ''}">4×</button>
        <button data-action="speed" data-speed="8" class="${s.speed === 8 ? 'active' : ''}">8×</button>
      </span>
      <span class="time">${fmtTime(s.hours)}</span>
      <button class="small" data-action="save">Save</button>
      <button class="small" data-action="menu">Menu</button>`;
    if (top !== this.lastTop) { this.el('topbar').innerHTML = top; this.lastTop = top; }

    // objectives
    const rebHq = s.planets[s.factions.rebellion.hq];
    const obj = me === 'empire'
      ? `<b>Objective:</b> locate and capture the hidden Rebel headquarters. ${s.factions.empire.knowsEnemyHq ? `Intelligence places it on <b>${rebHq.name}</b>.` : 'Use espionage on Rebel worlds to find it.'}<br><b>Defend</b> ${esc(s.planets[s.factions.empire.hq].name)} at all costs.`
      : `<b>Objective:</b> capture <b>${esc(s.planets[s.factions.empire.hq].name)}</b>, the Imperial capital.<br><b>Protect</b> the Alliance headquarters on <b>${rebHq.name}</b> — the Empire ${s.factions.empire.knowsEnemyHq ? '<span class="bad">knows its location!</span>' : 'has not found it yet.'}`;
    const objEl = this.el('objectives');
    if (objEl.innerHTML !== obj) objEl.innerHTML = obj;

    // side panel
    let side = '';
    if (sel?.kind === 'planet') side = this.renderPlanet(s, s.planets[sel.id], target);
    else if (sel?.kind === 'fleet') { const fl = s.fleets.find(x => x.id === sel.id); side = fl ? this.renderFleet(s, fl) : ''; }
    else side = this.renderOverview(s);
    if (side !== this.lastSide) { this.el('side').innerHTML = side; this.lastSide = side; }

    // log
    const entries = s.log.filter(e => e.faction === 'all' || e.faction === me).slice(-9);
    const logHtml = entries.map(e => `<div class="entry ${e.kind}" ${e.planet !== undefined ? `data-action="focusPlanet" data-id="${e.planet}"` : ''}><span class="t">${fmtTime(e.time).replace('  ', ' ')}</span>${esc(e.text)}</div>`).join('');
    if (logHtml !== this.lastLog) { this.el('log').innerHTML = logHtml; this.lastLog = logHtml; }

    const help = `<kbd>LMB</kbd> select · <kbd>RMB</kbd> send fleet / drag to orbit · <kbd>MMB</kbd> pan · <kbd>Wheel</kbd> zoom · <kbd>WASD</kbd> <kbd>QE</kbd> camera · <kbd>F</kbd> focus · <kbd>Space</kbd> pause · <kbd>1-4</kbd> speed · touch: drag pan · pinch zoom · two-finger drag orbit · hold planet to send fleet`;
    if (this.el('help').innerHTML !== help) this.el('help').innerHTML = help;
  }

  private renderOverview(s: GameState): string {
    const me = s.player;
    const fleets = s.fleets.filter(f => f.faction === me);
    const chars = s.characters.filter(c => c.faction === me);
    return `<h2>${factionName(me)} Command</h2>
      <div class="sub">Select a planet or fleet on the map. Right-click a planet with a fleet selected to send it there.</div>
      <h3>Fleets</h3>
      ${fleets.map(f => `<div class="row clickable" data-action="selectFleet" data-id="${f.id}"><span>${esc(f.name)}</span><span class="sub">${f.ships.length} ships · ${f.at !== null ? esc(s.planets[f.at].name) : '→ ' + esc(s.planets[f.travel!.to].name)}</span></div>`).join('') || '<div class="sub">No fleets</div>'}
      <h3>Leaders</h3>
      ${chars.map(c => this.charRow(s, c, null, false)).join('')}
      <h3>Worlds</h3>
      ${s.planets.filter(p => p.owner === me).sort((a, b) => b.production - a.production).map(p => `<div class="row clickable" data-action="selectPlanet" data-id="${p.id}"><span>${esc(p.name)}${p.shipyard ? ` <span class="sub">yard ${p.shipyard}</span>` : ''}</span><span class="sub">${planetIncomePerDay(s, p).toFixed(0)}/day${p.queue.length ? ` · building ${esc(p.queue[0].label)}` : ''}</span></div>`).join('')}`;
  }

  private charRow(s: GameState, c: Character, target: TargetMode, withButtons: boolean): string {
    let status = '';
    if (c.captured) status = `<span class="bad">captured on ${esc(s.planets[c.at].name)}</span>`;
    else if (c.mission) status = `<span class="sub">${MISSION_LABEL[c.mission.type]} ${c.mission.phase === 'travel' ? 'en route to' : 'on'} ${esc(s.planets[c.mission.target].name)} (${hrs(c.mission.hoursLeft)})</span>`;
    else status = `<span class="sub clickable" data-action="selectPlanet" data-id="${c.at}">${esc(s.planets[c.at].name)}</span>`;
    const skills = `<span class="sub" title="Diplomacy / Espionage / Sabotage / Leadership">D${c.diplomacy} E${c.espionage} S${c.sabotage} L${c.leadership}</span>`;
    let buttons = '';
    if (withButtons && !c.captured && !c.mission) {
      buttons = `<div class="missions">${(['diplomacy', 'espionage', 'sabotage', 'incite'] as MissionType[]).map(t =>
        `<button class="small ${target && target.charId === c.id && target.type === t ? 'active' : ''}" data-action="mission" data-char="${c.id}" data-type="${t}" title="${esc(MISSION_DESC[t])}">${MISSION_LABEL[t]}</button>`).join('')}</div>`;
    }
    return `<div class="row"><span><b>${esc(c.title)} ${esc(c.name)}</b> ${skills}</span>${status}</div>${buttons}`;
  }

  private renderPlanet(s: GameState, p: Planet, target: TargetMode): string {
    const me = s.player;
    const details = canSeeDetails(s, me, p);
    const mine = p.owner === me;
    const align = alignment(p, me);
    const hq = knowsHq(s, me, p.id);
    let html = `<h2>${esc(p.name)} ${hq ? `<span class="sub">— ${p.id === s.factions.empire.hq ? 'Imperial capital' : 'Rebel headquarters'}</span>` : ''}</h2>
      <div class="sub">${fac(p.owner)} · ${p.type} world · production ${p.production}/day${mine ? ` · income ${planetIncomePerDay(s, p).toFixed(1)}/day` : ''}</div>
      <h3>Loyalty</h3>
      <div class="loyalty"><i style="left:${((p.loyalty + 100) / 200 * 100).toFixed(1)}%"></i></div>
      <div class="row"><span class="empire">Empire</span><span class="sub">${align > 0 ? 'favours you' : align < 0 ? 'opposes you' : 'indifferent'} (${align > 0 ? '+' : ''}${align.toFixed(0)})</span><span class="rebellion">Rebellion</span></div>
      <h3>Status</h3>
      <div class="grid">
        <span class="sub">Shipyard</span><span>${p.shipyard ? `Level ${p.shipyard}` : 'None'}</span>
        <span class="sub">Defenses</span><span>${details ? `${p.defense} platform${p.defense === 1 ? '' : 's'}` : '?'}</span>
        <span class="sub">Garrison</span><span>${details ? `${p.garrison} regiment${p.garrison === 1 ? '' : 's'}` : '?'}</span>
        ${p.intel[me] > 0 && !mine ? `<span class="sub">Intel</span><span>${hrs(p.intel[me])} remaining</span>` : ''}
      </div>`;
    if (p.invasion) html += `<div class="row"><span class="${p.invasion.attacker === me ? 'good' : 'bad'}">${factionName(p.invasion.attacker)} invasion: ${p.invasion.troops} regiments</span><span class="sub">${hrs(p.invasion.hoursLeft)}</span></div>`;
    if (p.unrest > 24 && details) html += `<div class="row bad">Unrest is building (${Math.floor(p.unrest / 24)} days)</div>`;

    // build
    if (mine) {
      html += `<h3>Construction</h3><div class="queue">`;
      html += p.queue.map((q, i) => `<div class="item"><span>${esc(q.label)}</span><div class="bar"><i style="width:${(q.progress / q.total * 100).toFixed(0)}%;background:#7fd3ff"></i></div><span class="sub">${hrs(q.total - q.progress)}</span><span class="x" data-action="cancel" data-planet="${p.id}" data-idx="${i}" title="Cancel (75% refund)">✕</span></div>`).join('') || '<div class="sub">Queue empty</div>';
      html += `</div><div class="build">`;
      const credits = s.factions[me].credits;
      for (const o of buildOptions(s, p)) {
        const cost = buildCost(o, p);
        const cls = o.cls ? shipClass(o.cls) : null;
        html += `<button ${credits < cost ? 'disabled' : ''} data-action="build" data-planet="${p.id}" data-kind="${o.kind}" ${o.cls ? `data-cls="${o.cls}"` : ''} title="${cls ? esc(cls.role) : ''}">${esc(o.label)}<small>${cost} cr · ${hrs(o.total)}</small></button>`;
      }
      html += `</div>`;
      if (p.shipyard === 0) html += `<div class="hint">Build a shipyard to construct warships here.</div>`;
    }

    // fleets in orbit
    const fleets = fleetsAt(s, p.id).filter(f => canSeeFleet(s, me, f));
    if (fleets.length) {
      html += `<h3>Fleets in orbit</h3>` + fleets.map(f => `<div class="row clickable" data-action="selectFleet" data-id="${f.id}"><span class="${f.faction}">${esc(f.name)}</span><span class="sub">${f.ships.length} ships · str ${fleetStrength(f).toFixed(0)}${f.faction === me && f.troops ? ` · ${f.troops} troops` : ''}</span></div>`).join('');
    }

    // characters
    const chars = charactersAt(s, p.id).filter(c => c.faction === me || details);
    const captured = s.characters.filter(c => c.captured && c.at === p.id && (c.faction === me || details));
    if (chars.length || captured.length) {
      html += `<h3>Leaders present</h3>` + chars.map(c => this.charRow(s, c, target, c.faction === me)).join('') + captured.map(c => this.charRow(s, c, null, false)).join('');
    }
    if (!mine) html += `<div class="hint">${p.owner ? 'Select a fleet and right-click here to attack or blockade. Land troops from orbit to invade.' : 'Neutral worlds join a side at high loyalty, or can be taken by force.'}</div>`;
    return html;
  }

  private renderFleet(s: GameState, f: Fleet): string {
    const me = s.player;
    const mine = f.faction === me;
    const groups = new Map<string, { n: number; hull: number }>();
    for (const sh of f.ships) { const g = groups.get(sh.cls) ?? { n: 0, hull: 0 }; g.n++; g.hull += sh.hull; groups.set(sh.cls, g); }
    let where = '';
    if (f.at !== null) where = `In orbit of <span class="clickable" data-action="selectPlanet" data-id="${f.at}">${esc(s.planets[f.at].name)}</span>`;
    else {
      const dest = f.travel!.path.length ? f.travel!.path[f.travel!.path.length - 1] : f.travel!.to;
      const eta = travelHours(s, f, dest);
      where = `En route to <b>${esc(s.planets[dest].name)}</b>${eta !== null ? ` · ETA ${hrs(eta * (1 - (f.travel!.path.length ? 0 : f.travel!.progress)))}` : ''}`;
    }
    let html = `<h2 class="${f.faction}">${esc(f.name)}</h2>
      <div class="sub">${fac(f.faction)} · ${where}</div>
      <div class="grid"><span class="sub">Strength</span><span>${fleetStrength(f).toFixed(0)}</span>
      <span class="sub">Troops</span><span>${f.troops} / ${fleetTroopCap(f)}</span></div>
      <h3>Ships</h3><div class="ships">`;
    for (const [cls, g] of groups) {
      const c = shipClass(cls);
      html += `<div class="row"><span>${g.n}× ${esc(c.name)} <span class="sub">${c.role}</span></span><span class="sub">${(g.hull / g.n * 100).toFixed(0)}%${mine && f.at !== null && groups.size > 1 ? ` <button class="small" data-action="detach" data-fleet="${f.id}" data-cls="${cls}" title="Split these ships into a new fleet">split</button>` : ''}</span></div>`;
    }
    html += `</div>`;
    if (mine) {
      html += `<div class="actions">`;
      if (f.at !== null) {
        const inv = canInvade(s, f);
        const p = s.planets[f.at];
        if (p.owner !== me) html += `<button class="danger" ${inv.ok ? '' : 'disabled'} data-action="invade" data-fleet="${f.id}" title="${esc(inv.reason)}">Invade (${f.troops} regiments)</button>`;
        if (p.owner === me) {
          html += `<button class="small" data-action="troops" data-fleet="${f.id}" data-n="1" ${p.garrison > 0 && f.troops < fleetTroopCap(f) ? '' : 'disabled'}>Load troops</button>`;
          html += `<button class="small" data-action="troops" data-fleet="${f.id}" data-n="-1" ${f.troops > 0 ? '' : 'disabled'}>Unload troops</button>`;
        }
        for (const other of fleetsAt(s, f.at, me).filter(o => o.id !== f.id)) html += `<button class="small" data-action="merge" data-into="${f.id}" data-from="${other.id}">Merge ${esc(other.name)}</button>`;
        if (!inv.ok && p.owner !== me && f.troops > 0) html += `<div class="hint">Cannot invade: ${esc(inv.reason)}</div>`;
      } else html += `<button class="small" data-action="stop" data-fleet="${f.id}">Stop at next system</button>`;
      html += `</div><div class="hint">Right-click a planet to move this fleet along the hyperlanes.</div>`;
    }
    return html;
  }

  // ------------------------------------------------------------ modals
  showBattlePrompt(s: GameState, setup: BattleSetup): void {
    const p = s.planets[setup.planet];
    const side = (f: FactionId) => {
      const counts = new Map<string, number>();
      for (const u of setup.units.filter(u => u.faction === f)) counts.set(u.cls.name, (counts.get(u.cls.name) ?? 0) + 1);
      return [...counts].map(([n, k]) => `${k}× ${n}`).join('<br>') || '<i>no forces</i>';
    };
    this.el('modal').innerHTML = `<div class="box panel">
      <h2>Battle of ${esc(p.name)}</h2>
      <p>${factionName(setup.attacker)} forces have entered orbit${p.owner ? ` of a ${factionName(p.owner)} world` : ''}.</p>
      <div class="forces"><div><h4 class="${setup.attacker}">${factionName(setup.attacker)} (attacking)</h4><div>${side(setup.attacker)}</div></div>
      <div><h4 class="${setup.defender}">${factionName(setup.defender)} (defending)</h4><div>${side(setup.defender)}</div></div></div>
      <div class="buttons"><button data-action="auto">Auto-resolve</button><button class="primary" data-action="fight">Take command</button></div></div>`;
    this.el('modal').classList.add('show');
  }
  showGameOver(s: GameState): void {
    const won = s.winner === s.player;
    this.el('modal').innerHTML = `<div class="box panel"><h2>${won ? 'Victory' : 'Defeat'}</h2>
      <p>${esc(s.log[s.log.length - 1]?.text ?? '')}</p>
      <p>${fmtTime(s.hours)}</p>
      <div class="buttons"><button data-action="closeModal">Keep watching</button><button class="primary" data-action="menu">Main menu</button></div></div>`;
    this.el('modal').classList.add('show');
  }
  hideModal(): void { this.el('modal').classList.remove('show'); }

  // ------------------------------------------------------------ battle
  updateBattle(sim: BattleSim, selected: Set<BUnit>, speed: number, planetName: string, formation: Formation, muted: boolean): void {
    const me = sim.playerSide;
    const top = `<span class="faction ${me}" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em">Battle of ${esc(planetName)}</span>
      <span class="spacer"></span>
      <span class="speed" style="display:flex;gap:3px">
        <button data-action="bspeed" data-speed="0" class="${speed === 0 ? 'active' : ''}">❚❚</button>
        <button data-action="bspeed" data-speed="0.5" class="${speed === 0.5 ? 'active' : ''}">½×</button>
        <button data-action="bspeed" data-speed="1" class="${speed === 1 ? 'active' : ''}">1×</button>
        <button data-action="bspeed" data-speed="2" class="${speed === 2 ? 'active' : ''}">2×</button>
      </span>
      <span class="stat" style="color:#8a98a8">${sim.time.toFixed(0)}s</span>
      <button class="small" data-action="bmute" title="Toggle sound (M)">${muted ? 'Sound off' : 'Sound on'}</button>
      <button class="danger" data-action="retreat" ${sim.retreating[me] || sim.over ? 'disabled' : ''}>Retreat</button>`;
    const btop = this.el('btop');
    if (btop.innerHTML !== top) btop.innerHTML = top;

    const groups = new Map<string, { ships: number; squads: Set<number> }>();
    for (const u of selected) {
      const g = groups.get(u.cls.id) ?? { ships: 0, squads: new Set<number>() };
      g.ships++; if (u.squad) g.squads.add(u.squad.id);
      groups.set(u.cls.id, g);
    }
    const selHtml = [...groups].map(([cls, g]) => `<span class="chip" data-action="bclass" data-cls="${cls}">${g.squads.size ? `${g.squads.size} flight${g.squads.size > 1 ? 's' : ''} · ${g.ships}× ` : `${g.ships}× `}${esc(shipClass(cls).name)}<small>${shipClass(cls).role}</small></span>`).join('');
    const forms: Formation[] = ['none', 'wall', 'wedge', 'sphere'];
    const formHtml = forms.map(f => `<span class="chip ${formation === f ? 'active' : ''}" data-action="bform" data-form="${f}">${f === 'none' ? 'Free' : f[0].toUpperCase() + f.slice(1)}</span>`).join('');
    const forces = (['empire', 'rebellion'] as FactionId[]).map(f => {
      const alive = sim.alive(f);
      const counts = new Map<string, number>();
      for (const u of alive) counts.set(u.cls.name, (counts.get(u.cls.name) ?? 0) + 1);
      return `<div class="${f}"><b>${factionName(f)}</b> — ${alive.length} ships<br><span style="color:#8a98a8">${[...counts].map(([n, k]) => `${k}× ${n}`).join(', ') || '—'}</span></div>`;
    }).join('');
    const html = `<div class="col sel"><div class="title">Selection ${selected.size ? `(${selected.size})` : '— drag to box-select, right-click to move or attack, right-drag to set altitude'}</div><div class="selrow">${selHtml}<span class="chip" data-action="bselectall">Select all</span></div>
      <div class="title" style="margin-top:4px">Formation <span style="color:#5b6b7b">(Z / X / C / V)</span></div><div class="selrow">${formHtml}</div>
      <div style="font-size:11px;color:#8a98a8;margin-top:4px">MMB / Alt+LMB orbit · Wheel zoom · WASD pan · QE rotate · F focus · Ctrl+A all · Ctrl+1-9 assign group, 1-9 recall · Shift+S stop · Space pause · -/= speed · M sound · touch: drag pan · pinch zoom · two-finger orbit · tap select · hold to move / attack</div></div>
      <div class="col"><div class="title">Forces</div><div class="forces">${forces}</div></div>`;
    const key = html;
    if (key !== this.lastBattleSel) { this.el('bhud').innerHTML = html; this.lastBattleSel = key; }
  }

  showBattleResult(sim: BattleSim, planetName: string): void {
    const r = sim.result!;
    const me = sim.playerSide;
    const title = r.winner === me ? 'Victory' : r.winner ? 'Defeat' : 'Stalemate';
    const lost = (f: FactionId) => sim.units.filter(u => u.side === f && !u.alive).length;
    this.el('bresult').innerHTML = `<h2>${title} at ${esc(planetName)}</h2>
      <p>${r.retreated ? `${factionName(r.retreated)} forces withdrew to hyperspace.` : `${factionName(r.winner!)} forces hold the orbit.`}<br>
      Empire lost ${lost('empire')} · Rebellion lost ${lost('rebellion')}</p>
      <button class="primary" data-action="breturn">Return to galaxy map</button>`;
    this.el('bresult').classList.add('show');
  }
}

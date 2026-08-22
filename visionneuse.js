// visionneuse.js — la vue du match en direct, en 2D.
//
// ============================================================================
//  LE CONTRAT AVEC LA SIMULATION — à lire avant de toucher à l'un ou à l'autre
// ============================================================================
//
//  Ce fichier N'INVENTE RIEN. Il reçoit un rapport DÉJÀ RÉSOLU par `simulateMatch()` et le
//  rejoue. Précisément :
//
//    ENTRÉE   `watchMatch(report)` — un rapport complet : `report.res.gH`, `res.gA`,
//             `res.scorers` (chaque but avec sa minute et son auteur), `res.penalties`,
//             `res.wentOT`.
//
//    SORTIE   du pixel et du texte. RIEN d'autre. La visionneuse n'écrit jamais dans `G` :
//             ni budget, ni journée, ni points, ni moral, ni forme. Un contrôle du test le
//             vérifie en comparant une empreinte de l'état avant et après l'animation.
//
//    GARANTIE le compteur affiché à la fin égale exactement `res.gH` — `res.gA`.
//             `mvTriggerGoal()` est le SEUL endroit du fichier qui incrémente `mv.gH` /
//             `mv.gA`, et il refuse un événement vide.
//
//  Autrement dit : on peut retoucher la simulation sans toucher à l'affichage, et l'inverse.
//  C'est exactement ce que ce découpage sert à protéger.
//
//  `5-tests/test-visionneuse-fidele.mjs` fait tourner la vraie boucle jusqu'au coup de
//  sifflet et vérifie tout cela. Mesuré au moment du découpage : 240 matchs, 31
//  prolongations, zéro divergence.
//
// ============================================================================
//
// Chargé par un <script> CLASSIQUE, pas un module ES : ceux-ci sont bloqués par CORS sous
// file://, et le jeu doit pouvoir s'ouvrir par double-clic.
//
// Pièce CRITIQUE : sans elle, `watchMatch()` n'existe pas et `playDay()` échoue au premier
// match. Le jeu s'arrêterait de toute façon, mais sur une erreur incompréhensible.
//
// Ce que ce fichier emprunte au reste du jeu, et qui doit donc rester disponible :
//   `clampV`, `irnd`, `pick`, `escHtml`, `T`, `portraitFor`, `showReport`,
//   `PENALTY_LABEL`, `fauteLabel`, `overall`, `effOv`, `lineupOf`.
// Toutes sont appelées à l'exécution, jamais à l'analyse : l'ordre de chargement est donc
// sans importance pour elles.

// ---------------- Vue match en direct ----------------
const mv = {
  open: false, t: 0, speed: 2, report: null,
  gH: 0, gA: 0, events: [], nextEvt: 0, pens: [], nextPen: 0, activePP: null,
  puck: { x: 370, y: 210, vx: 0, vy: 0, owner: null, ownerCooldown: 0 },
  skaters: [], goalies: [], press: { home: 0, away: 0 },
  goalFlash: 0, lastFrame: 0, retarget: 0, flavor: 0, scriptedShot: null, faceoff: 0
};
// Le contexte est résolu à la PREMIÈRE utilisation, pas à l'analyse. Dans un fichier annexe
// chargé en tête de page, le <canvas> n'existe pas encore : `getContext` sur `null` casserait
// tout ce fichier, et avec lui la visionneuse entière.
let mvCanvas = null, mvCtx = null;
function mvInitCanvas() {
  if (mvCtx) return mvCtx;
  mvCanvas = document.getElementById('mvCanvas');
  mvCtx = mvCanvas ? mvCanvas.getContext('2d') : null;
  return mvCtx;
}
const MW = 740, MH = 420;
const mxMin = 20, mxMax = MW - 20, myMin = 20, myMax = MH - 20;
const mCORNER = 70, mGL_L = mxMin + 55, mGL_R = mxMax - 55;
const mCY = MH / 2, mGoalHalf = 45, mGoalDepth = 18;
// SLOT : zone de haut risque devant chaque cage (doc tactique Colomiers). Sert de repère à la défense de zone.
const mSLOT_L = mGL_L + 95, mSLOT_R = mGL_R - 95; // limite avant du slot de chaque camp
const mSLOT_HALF = 70; // demi-hauteur du slot
const MV_BODY_R = 10.5;

// Des indices, pas des phrases : le commentaire est tiré au sort à chaque passage et se
// compose à l'affichage, donc dans la langue du moment.
const FLAVOR_N = 9;

// Comme dans roller-hockey.html : le palet garde son élan (vitesse + friction + rebonds sur bande arrondie)
// une fois l'impulsion donnée, il n'a plus besoin d'être "tenu" par un joueur pour continuer à bouger.
function mvConstrain(x, y, r) {
  x = clampV(x, mxMin + r, mxMax - r);
  y = clampV(y, myMin + r, myMax - r);
  const isLeft = x < mxMin + mCORNER, isRight = x > mxMax - mCORNER;
  const isTop = y < myMin + mCORNER, isBottom = y > myMax - mCORNER;
  if ((isLeft || isRight) && (isTop || isBottom)) {
    const cx = isLeft ? mxMin + mCORNER : mxMax - mCORNER;
    const cy = isTop ? myMin + mCORNER : myMax - mCORNER;
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy) || 0.0001;
    const maxD = mCORNER - r;
    if (d > maxD) { x = cx + dx / d * maxD; y = cy + dy / d * maxD; }
  }
  return { x, y };
}

function mvDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function mvNorm(a) { while (a > Math.PI) a -= Math.PI*2; while (a < -Math.PI) a += Math.PI*2; return a; }

function mvKickPuck(tx, ty, power) {
  const dx = tx - mv.puck.x, dy = ty - mv.puck.y;
  const len = Math.hypot(dx, dy) || 1;
  mv.puck.vx = (dx / len) * power;
  mv.puck.vy = (dy / len) * power;
}

// Physique du palet quand personne ne le porte : friction + rebonds (identique à roller-hockey.html)
function mvTriggerGoal(e) {
  if (!e) return;
  if (e.side === 'home') mv.gH++; else mv.gA++;
  feedLine(`${Math.floor(mv.t)}' — <b>BUT !</b> ${e.nom} (${e.team})`
    + (e.pp ? ' <span class="tag">(supériorité numérique)</span>' : '')
    + (e.prolongation ? ' <span class="tag">(but en or)</span>' : ''), true);
  mv.goalFlash = 1.2;
  if (mv.activePP && mv.activePP.endsOnGoal && mv.activePP.against === (e.side === 'home' ? 'away' : 'home')) mv.activePP = null;
  mv.puck.x = MW/2; mv.puck.y = mCY; mv.puck.vx = 0; mv.puck.vy = 0;
  mv.puck.owner = null; mv.puck.ownerCooldown = 999; // personne ne touche le palet pendant la remise en place
  mv.scriptedShot = null;
  mv.retarget = 0.6;
  mv.nextEvt++;
  mv.faceoff = 1.6; mv.faceoffElapsed = 0; // phase de remise en place : chaque équipe regagne son côté avant la reprise
  updateMvHead();
}

// Prépare puis déclenche le tir qui marquera le but prévu par la simulation. Le buteur récupère le palet,
// le porte jusqu'au SLOT, puis tire un lancer puissant et visible vers la cage — le palet doit ensuite
// VRAIMENT franchir la ligne (checkMvGoalLine) pour valider le but.
function forceScriptedShot() {
  const nxt = mv.events[mv.nextEvt];
  if (!nxt) return;
  const ss = mv.scriptedShot;
  if (ss && ss.evtIdx === mv.nextEvt && ss.fired) return; // tir déjà parti
  if (nxt.minute - mv.t > 1.4) return; // pas encore l'heure d'armer l'action

  const goalX = nxt.side === 'home' ? mGL_R : mGL_L;
  const slotFront = nxt.side === 'home' ? mSLOT_R : mSLOT_L;

  // 1) désigne le buteur et lui confie le palet s'il ne l'a pas encore
  if (!ss || ss.evtIdx !== mv.nextEvt) {
    const shooter = [...mv.skaters].filter(s => s.team === nxt.side)
      .sort((a, b) => Math.abs(a.x - goalX) - Math.abs(b.x - goalX))[0];
    if (!shooter) return;
    mv.puck.owner = shooter;
    mv.scriptedShot = { side: nxt.side, evtIdx: mv.nextEvt, shooter, fired: false };
    return;
  }

  // 2) le buteur porte le palet ; on attend qu'il soit assez proche du slot pour armer un tir crédible
  const sh = ss.shooter;
  if (mv.puck.owner !== sh) mv.puck.owner = sh; // garde le palet malgré les contestations pendant l'action décisive
  const reachedSlot = nxt.side === 'home' ? sh.x > slotFront - 30 : sh.x < slotFront + 30;
  if (!reachedSlot) return;

  // 3) TIR : le palet part du buteur vers un coin de la cage, à grande vitesse (bien visible)
  const gk = mv.goalies.find(g => (nxt.side === 'home') ? g.x > MW / 2 : g.x < MW / 2);
  const aimY = mCY + (gk && gk.y > mCY ? -1 : 1) * rnd(14, 30); // vise à l'opposé du gardien
  mv.puck.x = sh.x; mv.puck.y = sh.y;
  mv.puck.owner = null;
  mvKickPuck(goalX + (nxt.side === 'home' ? 12 : -12), aimY, rnd(230, 290));
  mv.puck.ownerCooldown = 2.0; // tir cadré : personne ne l'intercepte en vol
  ss.fired = true;
  if (mv.report.home.human || mv.report.away.human) {
    feedLine(`${Math.floor(mv.t)}' — 🏒 Lancer de ${sh.p.nom} (${nxt.side === 'home' ? mv.report.home.short : mv.report.away.short}) depuis le slot !`);
  }
}

// Ligne de but réelle : un tir marque QUE s'il correspond au tir scripté (déjà "fired") ;
// sinon c'est un arrêt (rebond, comme un gardien ou un poteau). Le palet ne "traverse" jamais la ligne pour rien.
function checkMvGoalLine() {
  const p = mv.puck;
  const r = 5.5;
  const inMouth = p.y > mCY - mGoalHalf && p.y < mCY + mGoalHalf;
  const ss = mv.scriptedShot;

  if (p.x - r < mGL_L) {
    if (inMouth) {
      if (ss && ss.fired && ss.side === 'away' && p.x - r < mGL_L - 3) {
        mvTriggerGoal(mv.events[mv.nextEvt]);
        return true;
      }
      if (p.x - r < mGL_L - 8) { p.x = mGL_L - 8 + r; p.vx = Math.abs(p.vx) * 0.5; p.vy += rnd(-40, 40); }
    } else if (p.x - r < mxMin) { p.x = mxMin + r; p.vx *= -0.6; }
  }
  if (p.x + r > mGL_R) {
    if (inMouth) {
      if (ss && ss.fired && ss.side === 'home' && p.x + r > mGL_R + 3) {
        mvTriggerGoal(mv.events[mv.nextEvt]);
        return true;
      }
      if (p.x + r > mGL_R + 8) { p.x = mGL_R + 8 - r; p.vx = -Math.abs(p.vx) * 0.5; p.vy += rnd(-40, 40); }
    } else if (p.x + r > mxMax) { p.x = mxMax - r; p.vx *= -0.6; }
  }
  return false;
}

function updateMvPuckPhysics(simDt) {
  const p = mv.puck;
  p.x += p.vx * simDt;
  p.y += p.vy * simDt;
  const fastShot = Math.hypot(p.vx, p.vy) > 140;
  const fric = Math.max(0, 1 - (fastShot ? 0.35 : 1.1) * simDt);
  p.vx *= fric; p.vy *= fric;

  const r = 5.5;
  const isLeft = p.x < mxMin + mCORNER, isRight = p.x > mxMax - mCORNER;
  const isTop = p.y < myMin + mCORNER, isBottom = p.y > myMax - mCORNER;
  if ((isLeft || isRight) && (isTop || isBottom)) {
    const cx = isLeft ? mxMin + mCORNER : mxMax - mCORNER;
    const cy = isTop ? myMin + mCORNER : myMax - mCORNER;
    const dx = p.x - cx, dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 0.0001;
    const maxD = mCORNER - r;
    if (d > maxD) {
      const nx = dx / d, ny = dy / d;
      p.x = cx + nx * maxD; p.y = cy + ny * maxD;
      const dot = p.vx * nx + p.vy * ny;
      p.vx = (p.vx - 2 * dot * nx) * 0.65; p.vy = (p.vy - 2 * dot * ny) * 0.65;
    }
  } else {
    if (p.y - r < myMin) { p.y = myMin + r; p.vy *= -0.65; }
    if (p.y + r > myMax) { p.y = myMax - r; p.vy *= -0.65; }
    if (checkMvGoalLine()) return; // but validé, le palet vient d'être remis au centre
  }
}

// Le porteur du palet : sa vitesse et sa capacité à le conserver dépendent de ses vraies statistiques (Tir = maniement).
// Les tirs au but "réels" sont désormais gérés par forceScriptedShot() + checkMvGoalLine() ; ici on ne gère que
// le portage, la contestation (interception) et les passes classiques hors phase de tir décisif.
function updateMvPuck(simDt) {
  const p = mv.puck;

  if (p.owner) {
    const o = p.owner;
    p.x = o.x + Math.cos(o.heading) * (MV_BODY_R + 9);
    p.y = o.y + Math.sin(o.heading) * (MV_BODY_R + 9);
    p.vx = 0; p.vy = 0;

    // contestation : un adversaire proche peut lui reprendre le palet (def de l'adversaire vs tir/maniement du porteur)
    mv.skaters.forEach(s => {
      if (s.team === o.team || p.owner !== o) return;
      if (mvDist(s, o) < MV_BODY_R * 2 + 7) {
        const base = 0.42;
        const statDiff = (s.p.def - o.p.tir) / 150;
        const chance = clampV(base + statDiff, 0.10, 0.75); // probabilité de perte par seconde de contact
        if (Math.random() < chance * simDt) {
          p.owner = s;
          if (mv.report.home.human || mv.report.away.human) {
            const now = Math.floor(mv.t);
            if (now - (mv.lastTurnoverT || -99) >= 2) {
              feedLine(`${now}' — Interception de ${s.p.nom} (${s.team === 'home' ? mv.report.home.short : mv.report.away.short}) sur ${o.p.nom} !`);
              mv.lastTurnoverT = now;
            }
          }
        }
      }
    });

    // relâche le palet périodiquement : passe au coéquipier démarqué (le vrai tir décisif est géré ailleurs)
    mv.retarget -= simDt;
    if (mv.retarget <= 0 && p.owner && !(mv.scriptedShot && mv.scriptedShot.evtIdx === mv.nextEvt)) {
      const own = p.owner;
      const mate = mv.skaters.find(s => s.team === own.team && s.role === 'fwd' && s !== own);
      let tx, ty;
      if (mate && Math.random() < 0.72) { tx = mate.x; ty = mate.y; }
      else { tx = rnd(mxMin + 60, mxMax - 60); ty = rnd(myMin + 50, myMax - 50); }
      mvKickPuck(tx, ty, 95 + own.p.tir * 0.35);
      if (mate && (mv.report.home.human || mv.report.away.human)) {
        const now = Math.floor(mv.t);
        if (now - (mv.lastPassT || -99) >= 2) {
          feedLine(`${now}' — Passe de ${own.p.nom} vers ${mate.p.nom} (${own.team === 'home' ? mv.report.home.short : mv.report.away.short}).`);
          mv.lastPassT = now;
        }
      }
      p.owner = null; p.ownerCooldown = 0.28;
      mv.retarget = rnd(0.7, 1.4);
    }
  } else {
    updateMvPuckPhysics(simDt);
    if (p.ownerCooldown > 0) p.ownerCooldown -= simDt;
    if (p.ownerCooldown <= 0) {
      let closest = null, closestD = 999;
      mv.skaters.forEach(s => { const d = mvDist(s, p); if (d < closestD) { closestD = d; closest = s; } });
      if (closest && closestD < MV_BODY_R + 13) p.owner = closest;
    }
  }
}

// Ligne de champ affichée : les 2 meilleurs Tir jouent attaquants, les 2 meilleurs Déf jouent défenseurs
function mvPickLine(team) {
  const { gk, field } = lineupOf(team);
  const byTir = [...field].sort((a, b) => b.tir - a.tir);
  const fwds = byTir.slice(0, 2);
  const rest = field.filter(p => !fwds.includes(p));
  const defs = [...rest].sort((a, b) => b.def - a.def).slice(0, 2);
  return { gk, fwds, defs };
}

function initMvSkaters(report) {
  const hCol = report.home.human ? '#00ade9' : '#e9eef4';
  const aCol = report.away.human ? '#00ade9' : '#f0803a';
  const hLine = mvPickLine(report.home);
  const aLine = mvPickLine(report.away);
  function mk(p, team, role, idx, col, x, y) {
    return { x, y, homeX: x, homeY: y, heading: team === 'home' ? 0 : Math.PI, speed: 0, team, role, idx, col, p, isLead: false };
  }
  mv.skaters = [
    mk(hLine.fwds[0], 'home', 'fwd', 0, hCol, MW/2 - 34, mCY - 30),
    mk(hLine.fwds[1], 'home', 'fwd', 1, hCol, mGL_L + 175, mCY + 95),
    mk(hLine.defs[0], 'home', 'def', 2, hCol, mGL_L + 95, mCY - 70),
    mk(hLine.defs[1], 'home', 'def', 3, hCol, mGL_L + 80, mCY + 55),
    mk(aLine.fwds[0], 'away', 'fwd', 0, aCol, MW/2 + 34, mCY + 30),
    mk(aLine.fwds[1], 'away', 'fwd', 1, aCol, mGL_R - 175, mCY - 95),
    mk(aLine.defs[0], 'away', 'def', 2, aCol, mGL_R - 95, mCY + 70),
    mk(aLine.defs[1], 'away', 'def', 3, aCol, mGL_R - 80, mCY - 55)
  ];
  mv.goalies = [
    { x: mGL_L + 12, y: mCY, col: hCol, p: hLine.gk },
    { x: mGL_R - 12, y: mCY, col: aCol, p: aLine.gk }
  ];
}

// Vitesse max liée à la Vitesse (vit) du joueur ; virages et accélération limités comme sur des patins (inertie)
function mvMaxSpeed(p, carrying) {
  const base = 78 + (p.vit || 55) * 0.85;
  return carrying ? base * 0.9 : base;
}

function updateMvSkaters(simDt) {
  const p = mv.puck;
  const carrier = p.owner; // patineur porteur, ou null

  // équipe en possession (ou dernière équipe à récupérer un palet libre)
  const attackingTeam = carrier ? carrier.team : mv.lastTouchTeam || 'home';
  mv.lastTouchTeam = attackingTeam;

  // désigne, par équipe, quel avant est le "meneur" (presse le porteur adverse / porte le palet)
  // et quel avant est le "coupeur" (se démarque, coupe à la cage). Cf. « le non-porteur coupe à la cage ».
  ['home', 'away'].forEach(team => {
    const fwds = mv.skaters.filter(s => s.team === team && s.role === 'fwd');
    if (carrier && carrier.team === team && carrier.role === 'fwd') {
      fwds.forEach(s => { s.isLead = (s === carrier); });
      return;
    }
    const d0 = mvDist(fwds[0], p), d1 = mvDist(fwds[1], p);
    let lead = mv.press[team] ?? 0;
    if (lead === 0 && d1 < d0 - 30) lead = 1;
    else if (lead === 1 && d0 < d1 - 30) lead = 0;
    mv.press[team] = lead;
    fwds[0].isLead = lead === 0;
    fwds[1].isLead = lead === 1;
  });

  mv.skaters.forEach(s => {
    const ownGoalX = s.team === 'home' ? mGL_L : mGL_R;
    const attackGoalX = s.team === 'home' ? mGL_R : mGL_L;
    const forward = attackGoalX > ownGoalX ? 1 : -1; // sens de l'attaque (+1 = vers la droite)
    const attacking = s.team === attackingTeam;
    let tx, ty, maxSpeed, carrying = false, brake = false;

    if (carrier === s) {
      // ----- PORTEUR DU PALET : progresse vers le slot adverse, puis cherche le tir ou la passe -----
      carrying = true;
      const slotFront = s.team === 'home' ? mSLOT_R : mSLOT_L;
      const reachedSlot = forward > 0 ? s.x > slotFront - 20 : s.x < slotFront + 20;
      if (reachedSlot) {
        // dans le slot : on ralentit pour armer (le tir réel est déclenché par forceScriptedShot)
        tx = s.x + forward * 10; ty = mCY + (s.y - mCY) * 0.4; brake = true;
      } else {
        tx = s.x + forward * 120; ty = s.y + (mCY - s.y) * 0.06;
      }
      maxSpeed = mvMaxSpeed(s.p, true);

    } else if (attacking && s.role === 'fwd') {
      // ----- AVANT SANS PALET (équipe en attaque) -----
      if (s.isLead && (!carrier || carrier.role === 'def')) {
        // le meneur va chercher/soutenir le palet
        tx = p.x + forward * 30; ty = p.y;
      } else {
        // le coupeur : coupe à la cage adverse, décalé du côté opposé au palet (démarquage)
        const side = p.y >= mCY ? -1 : 1; // côté opposé au palet
        tx = attackGoalX - forward * 55;
        ty = mCY + side * 58;
      }
      maxSpeed = mvMaxSpeed(s.p, false);

    } else if (attacking && s.role === 'def') {
      // ----- ARRIÈRE (équipe en attaque) : reste en soutien vers la ligne médiane (jeu des arrières à l'attaque) -----
      const supportX = MW / 2 + forward * 25;
      tx = supportX + (p.x - supportX) * 0.3;
      ty = mCY + (s.idx === 2 ? -70 : 70) + (p.y - mCY) * 0.2;
      maxSpeed = mvMaxSpeed(s.p, false) * 0.9;

    } else if (!attacking && s.role === 'fwd') {
      // ----- AVANT EN DÉFENSE : pressing sur l'arrière/porteur adverse, oriente vers l'aile (« chien fou ») -----
      if (s.isLead) {
        // presse le porteur ; s'il est loin, se replie vers la ligne médiane de son côté
        const inOurHalf = forward > 0 ? p.x < MW / 2 : p.x > MW / 2;
        if (inOurHalf) { tx = p.x; ty = p.y; }
        else { tx = MW / 2 + forward * 10; ty = mCY + (s.idx === 0 ? -55 : 55); }
      } else {
        // l'autre avant bouche l'aile opposée / couvre la remontée
        tx = MW / 2 - forward * 15;
        ty = p.y >= mCY ? myMin + 70 : myMax - 70;
      }
      maxSpeed = mvMaxSpeed(s.p, false);

    } else {
      // ----- ARRIÈRE EN DÉFENSE : couverture de zone « en carré », protège le SLOT, ne le quitte pas -----
      const slotFront = s.team === 'home' ? mSLOT_L : mSLOT_R;
      // les deux arrières tiennent les deux moitiés (haut/bas) du slot
      const zoneY = s.idx === 2 ? mCY - 40 : mCY + 40;
      // suit légèrement le palet en Y mais reste ancré devant sa cage en X (n'entre pas dans le slot pour ne pas masquer le gardien)
      let targetX = slotFront - forward * 8;
      let targetY = zoneY + (p.y - mCY) * 0.35;

      // situation 2v1 / prise du non-porteur : l'arrière le plus proche va au porteur, l'autre prend le non-porteur adverse
      const puckInOurZone = forward > 0 ? p.x < mSLOT_L + 60 : p.x > mSLOT_R - 60;
      if (puckInOurZone) {
        const myDefs = mv.skaters.filter(d => d.team === s.team && d.role === 'def');
        const nearest = mvDist(myDefs[0], p) <= mvDist(myDefs[1], p) ? myDefs[0] : myDefs[1];
        if (s === nearest && carrier && carrier.team !== s.team) {
          // provoque la confrontation avant le slot (ralentit pour ne pas reculer dans le slot)
          targetX = clampV(p.x - forward * 18, Math.min(slotFront, p.x) - 40, Math.max(slotFront, p.x) + 40);
          targetY = p.y; brake = mvDist(s, p) < 45;
        } else {
          // l'autre arrière prend le non-porteur adverse le plus dangereux (celui qui coupe à la cage)
          const nonPorteur = mv.skaters
            .filter(a => a.team !== s.team && a.role === 'fwd' && a !== carrier)
            .sort((a, b) => Math.abs(a.x - ownGoalX) - Math.abs(b.x - ownGoalX))[0];
          if (nonPorteur) { targetX = (slotFront + nonPorteur.x) / 2; targetY = nonPorteur.y; }
        }
      }
      tx = targetX; ty = targetY;
      maxSpeed = mvMaxSpeed(s.p, false) * 0.9;
    }

    // ----- PATINAGE : inertie (virage limité), accélération/freinage progressifs -----
    const dx = tx - s.x, dy = ty - s.y;
    const dlen = Math.hypot(dx, dy) || 1;
    const desiredAngle = Math.atan2(dy, dx);
    const turnRate = (2.0 + (s.p.vit || 55) / 65) * simDt;
    const diff = mvNorm(desiredAngle - s.heading);
    s.heading += clampV(diff, -turnRate, turnRate);
    // freinage volontaire (les joueurs ont le droit de freiner) quand ils doivent temporiser/armer
    let desiredSpeed = Math.min(maxSpeed, dlen * 4.2);
    if (brake) desiredSpeed = Math.min(desiredSpeed, 28);
    // freinage à l'arrivée : sous une petite distance, on ralentit fort puis on s'arrête (plus de survol de la cible)
    if (dlen < 26) desiredSpeed = Math.min(desiredSpeed, dlen * 2.2);
    if (dlen < 6) desiredSpeed = 0;
    // ralentissement en virage serré : on ne peut pas tourner vite en gardant toute sa vitesse (physique des patins)
    const turnSharp = Math.abs(diff);
    if (turnSharp > 0.9) desiredSpeed *= 0.45;
    else if (turnSharp > 0.5) desiredSpeed *= 0.72;
    const maxAccel = (190 + (s.p.vit || 55) * 1.1) * simDt;
    // décélération plus mordante que l'accélération (patins qui crissent)
    const accel = desiredSpeed < s.speed ? maxAccel * 2.2 : maxAccel;
    s.speed += clampV(desiredSpeed - s.speed, -accel, accel);
    if (s.speed < 0) s.speed = 0;
    s.x += Math.cos(s.heading) * s.speed * simDt;
    s.y += Math.sin(s.heading) * s.speed * simDt;
    const c = mvConstrain(s.x, s.y, MV_BODY_R);
    s.x = c.x; s.y = c.y;
  });

  mv.goalies.forEach(g => {
    // le gardien fixe le porteur et ferme l'angle : suit le palet en Y
    const targetY = clampV(p.y, mCY - mGoalHalf + 12, mCY + mGoalHalf - 12);
    g.y += clampV(targetY - g.y, -120 * simDt, 120 * simDt);
  });

  // séparation des bustes : contact possible, jamais de superposition (pas de mise en échec)
  const bodies = [...mv.skaters, ...mv.goalies];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const minD = MV_BODY_R * 2;
        if (d < minD) {
          if (d < 0.01) d = 0.01;
          const nx = dx / d, ny = dy / d, push = (minD - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }
}

function watchMatch(report) {
  mvInitCanvas();          // seul endroit d'où le dessin peut partir : on résout ici
  mv.open = true; mv.report = report;
  mv.t = 0; mv.gH = 0; mv.gA = 0; mv.nextEvt = 0; mv.nextPen = 0; mv.activePP = null;
  mv.events = report.res.scorers;
  mv.pens = report.res.penalties || [];
  mv.puck = { x: MW/2, y: mCY, vx: 0, vy: 0, owner: null, ownerCooldown: 0.6 };
  initMvSkaters(report);
  mv.press = { home: 0, away: 0 };
  mv.goalFlash = 0; mv.retarget = 0.4; mv.flavor = irnd(4, 8); mv.prolongationAnnoncee = false;
  mv.scriptedShot = null; mv.lastTurnoverT = -99; mv.lastPassT = -99; mv.lastTouchTeam = 'home'; mv.faceoff = 0;
  document.getElementById('mvFeed').innerHTML =
    `<div>0' — Coup d'envoi ! ${report.home.name} reçoit ${report.away.name}.</div>`;
  document.getElementById('matchViewer').style.display = 'flex';
  updateMvHead();
  mv.lastFrame = performance.now();
  requestAnimationFrame(mvLoop);
}

function closeViewer() {
  mv.open = false;
  document.getElementById('matchViewer').style.display = 'none';
  showReport();
}

document.querySelectorAll('#mvCtrls [data-spd]').forEach(b => {
  b.addEventListener('click', () => {
    mv.speed = parseInt(b.dataset.spd);
    document.querySelectorAll('#mvCtrls [data-spd]').forEach(x => x.classList.toggle('on', x === b));
  });
});
document.getElementById('mvSkip').addEventListener('click', closeViewer);

function feedLine(html, isGoal) {
  const feed = document.getElementById('mvFeed');
  feed.innerHTML += `<div class="${isGoal ? 'goal' : ''}">${html}</div>`;
  feed.scrollTop = feed.scrollHeight;
}

function updateMvHead() {
  const r = mv.report;
  let ppTag = '';
  if (mv.activePP && mv.t < mv.activePP.until) {
    const teamShort = mv.activePP.against === 'home' ? r.away.short : r.home.short;
    ppTag = ` <span style="color:var(--tan);font-size:13px">— ${teamShort} en supériorité (${Math.ceil(mv.activePP.until - mv.t)}')</span>`;
  }
  document.getElementById('mvScore').innerHTML =
    `<span class="h">${r.home.short}</span> ${mv.gH} — ${mv.gA} <span class="a">${r.away.short}</span>${ppTag}`;
  document.getElementById('mvClock').textContent = Math.floor(mv.t) + "'";
}

function mvReposition(simDt) {
  // ramène chaque patineur vers sa position d'engagement (chacun de son côté) et renvoie true quand tout est en place.
  // Déplacement direct amorti : on vise la cible en ligne droite et on FREINE à l'approche — pas de cap+inertie
  // (qui faisait tourner les joueurs en rond autour de leur cible sans jamais s'arrêter).
  let allSet = true;
  mv.skaters.forEach(s => {
    const dx = s.homeX - s.x, dy = s.homeY - s.y;
    const d = Math.hypot(dx, dy);
    if (d > 3) {
      allSet = false;
      const maxSp = mvMaxSpeed(s.p, false);
      // vitesse cible proportionnelle à la distance (freine en approchant), plafonnée
      const targetSpeed = Math.min(maxSp, d * 5);
      s.speed += clampV(targetSpeed - s.speed, -420 * simDt, 300 * simDt);
      if (s.speed < 0) s.speed = 0;
      const step = Math.min(s.speed * simDt, d); // ne dépasse jamais la cible
      s.x += (dx / d) * step;
      s.y += (dy / d) * step;
      s.heading = Math.atan2(dy, dx); // regarde là où il va (pas de virage progressif ici)
    } else {
      s.x = s.homeX; s.y = s.homeY; s.speed = 0;
      s.heading = s.team === 'home' ? 0 : Math.PI; // orienté vers le camp adverse, prêt à l'engagement
    }
  });
  mv.goalies.forEach(g => {
    g.y += clampV(mCY - g.y, -120 * simDt, 120 * simDt);
  });
  return allSet;
}

function mvLoop(now) {
  if (!mv.open) return;
  const dtSec = Math.min((now - mv.lastFrame) / 1000, 0.1);
  mv.lastFrame = now;
  const simDt = dtSec * mv.speed; // vitesse d'affichage x1/x2/x4

  // Phase de remise en place après un but : chrono figé, chacun regagne son côté avant la reprise
  if (mv.faceoff > 0) {
    const inPlace = mvReposition(simDt);
    if (mv.goalFlash > 0) mv.goalFlash -= simDt;
    mv.faceoffElapsed = (mv.faceoffElapsed || 0) + simDt;
    mv.faceoff -= simDt;
    // reprise quand tout le monde est en place ET temporisation écoulée — ou après 5 s max (sécurité anti-blocage)
    if ((inPlace && mv.faceoff <= 0) || mv.faceoffElapsed > 5) {
      mv.faceoff = 0;
      mv.faceoffElapsed = 0;
      mv.puck.ownerCooldown = 0.4;
      mv.retarget = 0.4;
    } else if (mv.faceoff <= 0 && !inPlace) {
      mv.faceoff = 0.001; // en place imminente : on prolonge très légèrement
    }
    drawMvRink();
    updateMvHead();
    requestAnimationFrame(mvLoop);
    return;
  }

  mv.t += simDt; // 1 minute de jeu = 1 s réelle à x1

  // le but n'est validé QUE quand le palet franchit réellement la ligne (checkMvGoalLine, via forceScriptedShot)
  forceScriptedShot();
  // filet de sécurité : si un pépin physique empêche le tir scripté d'arriver à temps, on ne reste pas bloqué
  if (mv.nextEvt < mv.events.length && mv.t > mv.events[mv.nextEvt].minute + 2.2) {
    mvTriggerGoal(mv.events[mv.nextEvt]);
  }

  // événements de pénalité
  while (mv.nextPen < mv.pens.length && mv.t >= mv.pens[mv.nextPen].minute) {
    const p = mv.pens[mv.nextPen];
    const icon = PENALTY_LABEL[p.type];
    const typeLabel = T('penalite.' + p.type);
    feedLine(`${p.minute}' — ${icon} <b>${typeLabel}</b> — ${p.nom} (${p.team}) : ${fauteLabel(p.faute)}.${p.shorthand ? ` ${T('penalite.inferiorite', { n: p.dur })}` : ''}`);
    if (p.shorthand) mv.activePP = { against: p.side, until: mv.t + p.dur, endsOnGoal: p.endsOnGoal };
    mv.nextPen++;
  }

  // lignes d'ambiance
  if (mv.t >= mv.flavor) {
    feedLine(`${Math.floor(mv.t)}' — ${T('direct.ambiance.' + irnd(0, FLAVOR_N - 1))}`);
    mv.flavor += irnd(5, 9);
  }

  updateMvSkaters(simDt);
  updateMvPuck(simDt);
  if (mv.goalFlash > 0) mv.goalFlash -= simDt;

  drawMvRink();
  updateMvHead();

  // Fin du temps réglementaire. S'il y a eu prolongation, le match ne s'arrête PAS ici : le
  // but en or est daté 51'-55' depuis la v104, et l'animation le manquait complètement —
  // tableau 1–1 pour un rapport 2–1, un match sur cinq. Mesuré, pas supposé.
  const prolongation = !!(mv.report.res && mv.report.res.wentOT);
  if (mv.t >= 50 && prolongation && !mv.prolongationAnnoncee) {
    mv.prolongationAnnoncee = true;
    feedLine(`50' — <b>${T('direct.prolongation')}</b>`, true);
  }
  // Mort subite (Règlement sportif FFRS 5.4.3) : le match finit sur le but en or, donc dès
  // que tous les buts du script ont été joués. Le garde-fou à 56' évite qu'un pépin de
  // physique laisse l'animation tourner sans fin.
  const tousLesButs = mv.nextEvt >= mv.events.length;
  const fini = prolongation ? ((mv.t >= 50 && tousLesButs) || mv.t >= 56) : mv.t >= 50;
  if (fini) {
    // Un but daté des deux dernières minutes n'a pas toujours le temps d'être joué : le
    // filet de sécurité de `forceScriptedShot` ne le déclenche qu'à +2,2 min, c'est-à-dire
    // APRÈS le coup de sifflet. Mesuré : tableau 4–1 pour un rapport 5–2, sans prolongation.
    // Ces buts ont bel et bien eu lieu — on les inscrit au coup de sifflet plutôt que de les
    // perdre. Le score affiché prime sur l'esthétique du chrono.
    while (mv.nextEvt < mv.events.length) mvTriggerGoal(mv.events[mv.nextEvt]);
    // Le compteur AFFICHÉ, pas le score calculé : la ligne annonçait auparavant
    // `mv.report.res`, ce qui masquait toute divergence entre l'animation et la simulation.
    feedLine(`${Math.min(Math.round(mv.t), prolongation ? 55 : 50)}' — <b>${T('direct.finMatch')}</b> ${T('direct.scoreFinal', { a: mv.gH, b: mv.gA })}`, true);
    drawMvRink();
    mv.open = false;
    setTimeout(closeViewer, 1400);
    return;
  }
  requestAnimationFrame(mvLoop);
}

function mvRoundRect(x, y, w, h, r) {
  mvCtx.beginPath();
  mvCtx.moveTo(x+r, y); mvCtx.lineTo(x+w-r, y); mvCtx.arcTo(x+w, y, x+w, y+r, r);
  mvCtx.lineTo(x+w, y+h-r); mvCtx.arcTo(x+w, y+h, x+w-r, y+h, r);
  mvCtx.lineTo(x+r, y+h); mvCtx.arcTo(x, y+h, x, y+h-r, r);
  mvCtx.lineTo(x, y+r); mvCtx.arcTo(x, y, x+r, y, r);
  mvCtx.closePath();
}

function drawMvRink() {
  mvCtx.fillStyle = '#10141a';
  mvCtx.fillRect(0, 0, MW, MH);

  mvCtx.save();
  mvRoundRect(mxMin, myMin, mxMax-mxMin, myMax-myMin, mCORNER);
  mvCtx.clip();
  // dalles Stilmat bleues
  mvCtx.fillStyle = '#2563a8';
  mvCtx.fillRect(mxMin, myMin, mxMax-mxMin, myMax-myMin);
  const tile = 34;
  for (let ty = myMin; ty < myMax; ty += tile)
    for (let tx = mxMin; tx < mxMax; tx += tile) {
      const odd = (Math.round((tx-mxMin)/tile) + Math.round((ty-myMin)/tile)) % 2;
      mvCtx.fillStyle = odd ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.05)';
      mvCtx.fillRect(tx, ty, tile, tile);
    }
  // ligne centrale + cercle central
  mvCtx.strokeStyle = 'rgba(255,255,255,.9)'; mvCtx.lineWidth = 3;
  mvCtx.beginPath(); mvCtx.moveTo(MW/2, myMin); mvCtx.lineTo(MW/2, myMax); mvCtx.stroke();
  mvCtx.beginPath(); mvCtx.arc(MW/2, mCY, 42, 0, Math.PI*2); mvCtx.stroke();
  // 4 cercles d'engagement de zone (2 par moitié, haut et bas)
  const foXL = mGL_L + 95, foXR = mGL_R - 95;
  [[foXL, mCY-85],[foXL, mCY+85],[foXR, mCY-85],[foXR, mCY+85]].forEach(([fx,fy])=>{
    mvCtx.strokeStyle = 'rgba(255,255,255,.9)';
    mvCtx.beginPath(); mvCtx.arc(fx, fy, 30, 0, Math.PI*2); mvCtx.stroke();
    mvCtx.fillStyle = '#d92b2b';
    mvCtx.beginPath(); mvCtx.arc(fx, fy, 4, 0, Math.PI*2); mvCtx.fill();
  });
  mvCtx.fillStyle = '#d92b2b';
  mvCtx.beginPath(); mvCtx.arc(MW/2, mCY, 4, 0, Math.PI*2); mvCtx.fill();
  // lignes de but + zones
  mvCtx.strokeStyle = 'rgba(255,255,255,.85)'; mvCtx.lineWidth = 2;
  mvCtx.beginPath(); mvCtx.moveTo(mGL_L, myMin); mvCtx.lineTo(mGL_L, myMax); mvCtx.stroke();
  mvCtx.beginPath(); mvCtx.moveTo(mGL_R, myMin); mvCtx.lineTo(mGL_R, myMax); mvCtx.stroke();
  mvCtx.fillStyle = 'rgba(217,43,43,.30)'; mvCtx.strokeStyle = '#d92b2b';
  mvCtx.beginPath(); mvCtx.arc(mGL_L, mCY, 36, -Math.PI/2, Math.PI/2); mvCtx.fill(); mvCtx.stroke();
  mvCtx.beginPath(); mvCtx.arc(mGL_R, mCY, 36, Math.PI/2, -Math.PI/2); mvCtx.fill(); mvCtx.stroke();
  mvCtx.restore();

  // balustrade
  mvRoundRect(mxMin, myMin, mxMax-mxMin, myMax-myMin, mCORNER);
  mvCtx.lineWidth = 6; mvCtx.strokeStyle = '#1b2a4a'; mvCtx.stroke();
  mvCtx.lineWidth = 2; mvCtx.strokeStyle = '#f5f5f5'; mvCtx.stroke();

  // cages sur le terrain
  function mvGoal(x0, x1) {
    mvCtx.fillStyle = 'rgba(255,255,255,.15)';
    mvCtx.fillRect(x0, mCY-mGoalHalf, x1-x0, mGoalHalf*2);
    mvCtx.strokeStyle = '#d92b2b'; mvCtx.lineWidth = 3;
    mvCtx.strokeRect(x0, mCY-mGoalHalf, x1-x0, mGoalHalf*2);
  }
  mvGoal(mGL_L - mGoalDepth, mGL_L);
  mvGoal(mGL_R, mGL_R + mGoalDepth);

  // joueurs et palet : positions déjà mises à jour par updateMvSkaters()/updateMvPuck() dans mvLoop
  const px = mv.puck.x, py = mv.puck.y;
  const bodies = [...mv.skaters, ...mv.goalies];

  // crosses : peuvent librement se croiser entre elles et passer sur le buste adverse
  bodies.forEach(s => {
    const dx = px - s.x, dy = py - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const sx = s.x + (dx/len) * MV_BODY_R, sy = s.y + (dy/len) * MV_BODY_R;
    const ex = s.x + (dx/len) * (MV_BODY_R + 15), ey = s.y + (dy/len) * (MV_BODY_R + 15);
    mvCtx.beginPath(); mvCtx.moveTo(sx, sy); mvCtx.lineTo(ex, ey);
    mvCtx.strokeStyle = '#8a5a2b'; mvCtx.lineWidth = 2.5; mvCtx.stroke();
  });
  // bustes : dessinés après les crosses, jamais superposés entre eux (séparation gérée dans updateMvSkaters)
  bodies.forEach(s => {
    mvCtx.beginPath(); mvCtx.arc(s.x, s.y, MV_BODY_R, 0, Math.PI*2);
    mvCtx.fillStyle = s.col; mvCtx.fill();
    mvCtx.lineWidth = 2; mvCtx.strokeStyle = 'rgba(0,0,0,.55)'; mvCtx.stroke();
    mvCtx.beginPath(); mvCtx.arc(s.x, s.y, 3.5, 0, Math.PI*2);
    mvCtx.fillStyle = 'rgba(0,0,0,.45)'; mvCtx.fill();
  });

  // palet — avec traînée quand il file vite (tir visible)
  const pspeed = Math.hypot(mv.puck.vx, mv.puck.vy);
  if (pspeed > 90 && !mv.puck.owner) {
    const tlen = Math.min(pspeed * 0.16, 34);
    const ang = Math.atan2(mv.puck.vy, mv.puck.vx);
    const grad = mvCtx.createLinearGradient(px, py, px - Math.cos(ang) * tlen, py - Math.sin(ang) * tlen);
    grad.addColorStop(0, 'rgba(255,255,255,.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    mvCtx.strokeStyle = grad; mvCtx.lineWidth = 6; mvCtx.lineCap = 'round';
    mvCtx.beginPath();
    mvCtx.moveTo(px, py);
    mvCtx.lineTo(px - Math.cos(ang) * tlen, py - Math.sin(ang) * tlen);
    mvCtx.stroke();
    mvCtx.lineCap = 'butt';
  }
  mvCtx.beginPath(); mvCtx.arc(px, py, 5.5, 0, Math.PI*2);
  mvCtx.fillStyle = '#111'; mvCtx.fill();
  mvCtx.strokeStyle = '#666'; mvCtx.stroke();

  // flash de but
  if (mv.goalFlash > 0) {
    mvCtx.fillStyle = `rgba(243,207,149,${Math.min(mv.goalFlash, .6)})`;
    mvCtx.fillRect(0, 0, MW, MH);
    mvCtx.fillStyle = '#201503';
    mvCtx.font = 'bold 46px Tomorrow, sans-serif';
    mvCtx.textAlign = 'center'; mvCtx.textBaseline = 'middle';
    mvCtx.fillText('BUT !', MW/2, MH/2);
  }
}

// Témoin de chargement, lu par verifierPieces() en fin d'amorçage.
if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.visionneuse = true;

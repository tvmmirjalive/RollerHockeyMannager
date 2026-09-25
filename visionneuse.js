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
//   `PENALTY_LABEL`, `fauteLabel`, `overall`, `effOv`, `lineupOf`, `maillotDe`,
//   `numeroValide`, `numeroTexte`.
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
  if (mvCtx) {
    // La taille AFFICHÉE ne change pas : `#mvCanvas` est en `width: 100%; height: auto`, et
    // le rapport 740/420 est conservé. Seule la trame de dessin est plus fine.
    mvCanvas.width = MW * MV_FINESSE; mvCanvas.height = MH * MV_FINESSE;
    mvCtx.setTransform(MV_FINESSE, 0, 0, MV_FINESSE, 0, 0);
  }
  return mvCtx;
}
const MW = 740, MH = 420;
const mxMin = 20, mxMax = MW - 20, myMin = 20, myMax = MH - 20;
const mCORNER = 70, mGL_L = mxMin + 55, mGL_R = mxMax - 55;
// Cage : 56 px de bouche. Voir la visée de `forceScriptedShot`, qui en dépend.
const mCY = MH / 2, mGoalHalf = 28, mGoalDepth = 14;
// SLOT : zone de haut risque devant chaque cage (doc tactique Colomiers). Sert de repère à la défense de zone.
const mSLOT_L = mGL_L + 95, mSLOT_R = mGL_R - 95; // limite avant du slot de chaque camp
const mSLOT_HALF = 70; // demi-hauteur du slot
const MV_BODY_R = 10.5;
// L'échelle du dessin. La piste fait 700 px de long ; le règlement admet 40 à 60 m
// (Équipements 2.2.3.2 C). On retient 40 m : c'est la piste la plus courte, donc l'échelle
// la plus EXIGEANTE pour la distance de 1,5 m imposée à l'engagement.
const MV_PX_PAR_M = 17.5;
// Cercle d'engagement : 3 m de rayon, au centre comme en zone (Équipements 2.2.5.2 A et B).
const MV_RAYON_CERCLE = 3 * MV_PX_PAR_M;
// Les quatre points de zone : 6,10 m de la ligne de but, 6,70 m de l'axe longitudinal.
const MV_ZONE_DX = 6.10 * MV_PX_PAR_M, MV_ZONE_DY = 6.70 * MV_PX_PAR_M;
// Le canevas est dessiné à l'échelle 2 : sur un téléphone à 3 px par point, 740 px logiques
// étirés sur ~330 points donnaient des cercles baveux. Deux suffit — 1480 px pour 990 réels.
const MV_FINESSE = 2;
// Le casque du patineur vu de dessus. À 4,2 px Mirja l'a trouvé trop petit ; au-delà de 6 il
// recouvre le corps du maillot et le club bleu redevient blanc sur téléphone.
const MV_RAYON_CASQUE = 5.6;
// Les numéros ne se dessinent sur la piste que si le canevas AFFICHÉ fait au moins cette largeur.
// Sur un téléphone il en fait 330 et un patineur 10 : un numéro de 4 px n'est pas un numéro.
const MV_LARGEUR_NUMEROS = 560;
function mvNumerosVisibles() {
  return !!mvCanvas && mvCanvas.clientWidth >= MV_LARGEUR_NUMEROS;
}
// La palette de la crosse : son angle avec le manche, et sa longueur à l'écran.
const MV_COUDE_PALETTE = 55 * Math.PI / 180, MV_LONGUEUR_PALETTE = 8;
// Le temps que la formation reste IMMOBILE avant que le palet reparte. Une demi-minute de jeu,
// soit une demi-seconde à x1 : assez pour lire le placement, trop peu pour lasser à x4.
const MV_POSE_ENGAGEMENT = 0.5;
// Au-delà de ce temps de jeu, un palet libre et immobile est remis en mouvement. Deux
// minutes : assez long pour ne jamais interrompre une phase de jeu réelle — la relance
// naturelle par passe intervient toutes les 0,7 à 1,4 minute — assez court pour qu'un
// blocage ne soit jamais visible à l'écran.
const MV_PALET_DORT = 2.0;

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
  feedLine(`${Math.floor(mv.t)}' — <b>BUT !</b> ${numeroTexte(e)} ${escHtml(e.nom)} (${escHtml(e.team)})`
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
    const candidats = [...mv.skaters].filter(s => s.team === nxt.side);
    // Le buteur du rapport s'il est sur la piste ; sinon le plus proche de la cage, comme avant.
    const shooter = candidats.find(s => s.p && s.p.id === nxt.id)
      || candidats.sort((a, b) => Math.abs(a.x - goalX) - Math.abs(b.x - goalX))[0];
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
  // vise à l'opposé du gardien, et DANS la bouche : 9 px de marge pour le rayon du palet (5,5)
  // et la dérive du tir. L'ancienne borne de 30 px était écrite pour une cage de 45.
  const aimY = mCY + (gk && gk.y > mCY ? -1 : 1) * rnd(8, mGoalHalf - 9);
  mv.puck.x = sh.x; mv.puck.y = sh.y;
  mv.puck.owner = null;
  mvKickPuck(goalX + (nxt.side === 'home' ? 12 : -12), aimY, rnd(230, 290));
  mv.puck.ownerCooldown = 2.0; // tir cadré : personne ne l'intercepte en vol
  ss.fired = true;
  if (mv.report.home.human || mv.report.away.human) {
    feedLine(`${Math.floor(mv.t)}' — ${pictoHtml('jouer')} Lancer de ${escHtml(nxt.nom)} (${escHtml(nxt.side === 'home' ? mv.report.home.short : mv.report.away.short)}) depuis le slot !`);
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
              feedLine(`${now}' — Interception de ${escHtml(s.p.nom)} (${escHtml(s.team === 'home' ? mv.report.home.short : mv.report.away.short)}) sur ${escHtml(o.p.nom)} !`);
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
          feedLine(`${now}' — Passe de ${escHtml(own.p.nom)} vers ${escHtml(mate.p.nom)} (${escHtml(own.team === 'home' ? mv.report.home.short : mv.report.away.short)}).`);
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
    // Filet de sécurité. La correction ci-dessus supprime le point fixe CONNU ; elle ne
    // prouve pas qu'il n'en existe aucun autre. Un palet libre, immobile et que personne ne
    // ramasse depuis plus de MV_PALET_DORT minutes de jeu est remis en mouvement vers le
    // centre. Comme le garde-fou à 56' de la prolongation : il ne devrait jamais servir.
    if (!p.owner && Math.hypot(p.vx, p.vy) < 4) {
      p.dort = (p.dort || 0) + simDt;
      if (p.dort > MV_PALET_DORT) {
        mvKickPuck(rnd(mxMin + 70, mxMax - 70), rnd(myMin + 60, myMax - 60), 120);
        p.dort = 0;
        p.ownerCooldown = 0.2;
      }
    } else {
      p.dort = 0;
    }
  }
}

// Deux maillots se confondent quand leurs CORPS sont proches : c'est lui qu'on voit de loin.
// 110 sur 441 (la diagonale du cube RVB) sépare le bleu du club du bleu nuit, pas le rouge du
// bordeaux. Le visiteur retourne alors son maillot — épaules en corps — et, si cela ne suffit
// toujours pas, prend le blanc ou le noir, celui des deux qui est le plus loin du receveur.
const MV_ECART_MAILLOTS = 110;
function mvEcartCouleur(a, b) {
  const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = c(a), [r2, g2, b2] = c(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
function mvMaillotDistinct(receveur, visiteur) {
  if (mvEcartCouleur(receveur.corps, visiteur.corps) >= MV_ECART_MAILLOTS) return visiteur;
  if (mvEcartCouleur(receveur.corps, visiteur.epaules) >= MV_ECART_MAILLOTS)
    return { corps: visiteur.epaules, epaules: visiteur.corps };
  const blanc = mvEcartCouleur(receveur.corps, '#ffffff'), noir = mvEcartCouleur(receveur.corps, '#141414');
  return blanc >= noir ? { corps: '#ffffff', epaules: '#141414' } : { corps: '#141414', epaules: '#ffffff' };
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
  // Depuis la v176 chaque équipe a son maillot dans la sauvegarde : la visionneuse le LIT,
  // elle n'en invente pas un. Le receveur garde le sien ; c'est le visiteur qui change de jeu
  // de maillots quand les deux se confondent, comme sur une vraie feuille de match.
  const hM = maillotDe(report.home);
  const aM = mvMaillotDistinct(hM, maillotDe(report.away));
  const hCol = hM.corps, aCol = aM.corps;
  mv.maillots = { home: hM, away: aM };
  const hLine = mvPickLine(report.home);
  const aLine = mvPickLine(report.away);
  function mk(p, team, role, idx, col, x, y) {
    return { x, y, homeX: x, homeY: y, heading: team === 'home' ? 0 : Math.PI, speed: 0, team, role, idx, col,
      col2: mv.maillots[team].epaules, p, isLead: false };
  }
  // On construit autant de patineurs qu'il y a de JOUEURS, jamais huit par principe. Un
  // club réduit à trois joueurs de champ valides — une cascade de blessures suffit —
  // produisait sinon un patineur bâti sur `undefined`, et `mvMaxSpeed` plantait sur `p.vit`
  // dès la première image. On ne complète pas avec des doublons : voir deux fois le même
  // joueur serait plus déroutant que d'en voir un de moins.
  // L'engagement au point central, tel que le décrit le Règlement Sportif 9.3.1 E et F :
  //   · l'engageur SUR l'axe du point, dans son camp, face à l'autre. 15 px de chaque côté
  //     font 30 px entre les deux, soit 1,7 m : au-dessus du 1,5 m exigé, et assez près
  //     pour que les deux crosses se touchent presque au-dessus du palet ;
  //   · l'ailier sur le MÊME axe transversal, hors du cercle — 72 px de l'axe, soit 73,5 px
  //     du point pour un cercle de 52,5 et un corps de 10,5 ;
  //   · les deux défenseurs « en retrait vers leur camp » : l'un en demi-aile de l'autre
  //     côté, l'autre en couverture derrière l'engageur. C'est le losange qu'on voit en
  //     quatre contre quatre, pas une règle — la règle dit seulement « ou en retrait ».
  // Les deux équipes sont en MIROIR par rapport à la ligne médiane : chacun fait face à son
  // vis-à-vis. L'ancienne disposition était en symétrie CENTRALE, d'où des engageurs décalés
  // de ±30 px qui se croisaient en diagonale au lieu de se faire face.
  const ENGAGEMENT = [['fwd', 0, 15, 0], ['fwd', 1, 15, -72], ['def', 2, 58, 72], ['def', 3, 118, 0]];
  const places = [];
  ENGAGEMENT.forEach(([role, idx, recul, dy]) => {
    places.push(['home', role, idx, MW/2 - recul, mCY + dy]);
    places.push(['away', role, idx, MW/2 + recul, mCY + dy]);
  });
  mv.skaters = [];
  places.forEach(([team, role, idx, x, y]) => {
    const ligne = team === 'home' ? hLine : aLine;
    const joueur = (role === 'fwd' ? ligne.fwds : ligne.defs)[role === 'fwd' ? idx : idx - 2];
    if (!joueur) return;
    mv.skaters.push(mk(joueur, team, role, idx, team === 'home' ? hCol : aCol, x, y));
  });
  mv.goalies = [
    { x: mGL_L + 12, y: mCY, col: hCol, col2: hM.epaules, gardien: true, p: hLine.gk },
    { x: mGL_R - 12, y: mCY, col: aCol, col2: aM.epaules, gardien: true, p: aLine.gk }
  ].filter(g => g.p);
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
    // Une équipe peut n'avoir qu'un avant, ou aucun : la désignation du meneur ne peut pas
    // supposer qu'il y en a exactement deux.
    if (!fwds.length) return;
    if (fwds.length === 1) { fwds[0].isLead = true; mv.press[team] = 0; return; }
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
        // Avec un porteur, on se place en SOUTIEN devant lui : le décalage de 30 px a du
        // sens. Sans porteur, il faut aller SUR le palet — viser 30 px au-delà garait le
        // meneur entre 24 et 36 px, alors que le ramassage exige 23,5 px. Un demi-pixel
        // d'écart, et la piste se figeait jusqu'au coup de sifflet.
        if (carrier) { tx = p.x + forward * 30; ty = p.y; }
        else { tx = p.x; ty = p.y; }
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
        // Un seul arrière disponible : c'est lui le plus proche, il n'y a pas à comparer.
        const nearest = myDefs.length < 2
          ? myDefs[0]
          : (mvDist(myDefs[0], p) <= mvDist(myDefs[1], p) ? myDefs[0] : myDefs[1]);
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
          // Un gardien TIENT SA PLACE : c'est l'autre qui cède, de tout le chevauchement. Le
          // partage moitié-moitié le reculait à chaque contact, jusque derrière sa cage.
          const nx = dx / d, ny = dy / d, chevauchement = minD - d;
          const partA = a.gardien ? 0 : (b.gardien ? 1 : 0.5), partB = 1 - partA;
          if (a.gardien && b.gardien) continue;   // deux gardiens ne se rencontrent jamais
          a.x -= nx * chevauchement * partA; a.y -= ny * chevauchement * partA;
          b.x += nx * chevauchement * partB; b.y += ny * chevauchement * partB;
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
    `<div>0' — Coup d'envoi ! ${escHtml(report.home.name)} reçoit ${escHtml(report.away.name)}.</div>`;
  document.getElementById('matchViewer').style.display = 'flex';
  document.body.classList.add('direct-ouvert');   // cache le bouton « Jouer » (styles.css)
  updateMvHead();
  mv.lastFrame = performance.now();
  requestAnimationFrame(mvLoop);
}

function closeViewer() {
  mv.open = false;
  document.getElementById('matchViewer').style.display = 'none';
  document.body.classList.remove('direct-ouvert');
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
  // `innerHTML +=` reparsait TOUT le fil à chaque ligne — cent lignes en fin de match.
  feed.insertAdjacentHTML('beforeend', `<div class="${isGoal ? 'goal' : ''}">${html}</div>`);
  feed.scrollTop = feed.scrollHeight;
}

// La ligne de supériorité est créée ici plutôt que dans `index.html` : l'essai ne touche qu'à
// cette pièce et à la feuille de style. `aria-live` : c'est une annonce, un lecteur d'écran
// doit la dire sans qu'on aille la chercher.
function mvLigneSuperiorite() {
  let ligne = document.getElementById('mvSup');
  if (!ligne) {
    ligne = document.createElement('div');
    ligne.id = 'mvSup';
    ligne.setAttribute('aria-live', 'polite');
    document.getElementById('mvHead').appendChild(ligne);
  }
  return ligne;
}

function updateMvHead() {
  const r = mv.report;
  // La supériorité a sa propre ligne, TOUJOURS présente même vide : écrite à la suite du
  // score, elle le faisait passer à la ligne en 390 px et tout le cadre descendait de 5 px.
  let ppTag = '4 contre 4';
  if (mv.activePP && mv.t < mv.activePP.until) {
    const teamShort = mv.activePP.against === 'home' ? r.away.short : r.home.short;
    ppTag = `${teamShort} en supériorité (${Math.ceil(mv.activePP.until - mv.t)}')`;
  }
  const pastille = c => `<i class="mv-pastille" style="background:${c.corps};border-color:${c.epaules}"></i>`;
  const m = mv.maillots || { home: maillotDe(r.home), away: maillotDe(r.away) };
  document.getElementById('mvScore').innerHTML =
    `${pastille(m.home)}<span class="h">${r.home.short}</span> <b class="mv-marque">${mv.gH} — ${mv.gA}</b> <span class="a">${r.away.short}</span>${pastille(m.away)}`;
  const sup = mvLigneSuperiorite();
  sup.textContent = ppTag;
  sup.classList.toggle('actif', ppTag !== '4 contre 4');
  // Deux périodes de 25 minutes (Sportif 9.1.2), puis la mort subite.
  const periode = mv.t < 25 ? '1re' : mv.t < 50 ? '2e' : 'Prol.';
  document.getElementById('mvClock').textContent = `${periode} · ${Math.floor(mv.t)}'`;
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
    // Tout le monde en place NE SUFFIT PAS : il faut le rester un instant, c'est l'arbitre
    // qui lâche le palet, pas le dernier arrivé. La pose repart de zéro si quelqu'un bouge.
    mv.faceoffPose = inPlace ? (mv.faceoffPose || 0) + simDt : 0;
    if ((mv.faceoffPose >= MV_POSE_ENGAGEMENT && mv.faceoff <= 0) || mv.faceoffElapsed > 5) {
      mv.faceoff = 0;
      mv.faceoffElapsed = 0;
      mv.faceoffPose = 0;
      mv.puck.ownerCooldown = 0.4;
      mv.retarget = 0.4;
    } else if (mv.faceoff <= 0) {
      mv.faceoff = 0.001; // placement ou pose en cours : on prolonge très légèrement
    }
    drawMvPiste();
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
    feedLine(`${p.minute}' — ${icon} <b>${typeLabel}</b> — ${numeroTexte(p)} ${escHtml(p.nom)} (${escHtml(p.team)}) : ${fauteLabel(p.faute)}.${p.shorthand ? ` ${T('penalite.inferiorite', { n: p.dur })}` : ''}`);
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

  drawMvPiste();
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
    drawMvPiste();
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

function drawMvPiste() {
  mvCtx.fillStyle = '#0b0f15';
  mvCtx.fillRect(0, 0, MW, MH);
  const ROUGE = 'rgba(226,58,58,.92)';

  mvCtx.save();
  mvRoundRect(mxMin, myMin, mxMax-mxMin, myMax-myMin, mCORNER);
  mvCtx.clip();
  // Dalles de sport bleues : un ton uni, les joints fins des dalles, et la lumière de la
  // salle qui tombe au centre. L'ancien damier à deux tons se lisait comme un échiquier.
  const sol = mvCtx.createRadialGradient(MW/2, mCY, 40, MW/2, mCY, MW * 0.58);
  sol.addColorStop(0, '#2a5c9c'); sol.addColorStop(1, '#173a68');
  mvCtx.fillStyle = sol;
  mvCtx.fillRect(mxMin, myMin, mxMax-mxMin, myMax-myMin);
  mvCtx.strokeStyle = 'rgba(255,255,255,.045)'; mvCtx.lineWidth = 1;
  mvCtx.beginPath();
  for (let tx = mxMin; tx < mxMax; tx += MV_PX_PAR_M * 2) { mvCtx.moveTo(tx, myMin); mvCtx.lineTo(tx, myMax); }
  for (let ty = myMin; ty < myMax; ty += MV_PX_PAR_M * 2) { mvCtx.moveTo(mxMin, ty); mvCtx.lineTo(mxMax, ty); }
  mvCtx.stroke();

  // « Tous les marquages doivent être de couleur rouge » (Équipements 2.2.5 A).
  mvCtx.strokeStyle = ROUGE; mvCtx.fillStyle = ROUGE; mvCtx.lineWidth = 2.5;
  mvCtx.beginPath(); mvCtx.moveTo(MW/2, myMin); mvCtx.lineTo(MW/2, myMax); mvCtx.stroke();
  // Le point central et les quatre points de zone, chacun dans son cercle de 3 m (2.2.5.2).
  const points = [[MW/2, mCY],
    [mGL_L + MV_ZONE_DX, mCY - MV_ZONE_DY], [mGL_L + MV_ZONE_DX, mCY + MV_ZONE_DY],
    [mGL_R - MV_ZONE_DX, mCY - MV_ZONE_DY], [mGL_R - MV_ZONE_DX, mCY + MV_ZONE_DY]];
  points.forEach(([fx, fy]) => {
    mvCtx.beginPath(); mvCtx.arc(fx, fy, MV_RAYON_CERCLE, 0, Math.PI*2); mvCtx.stroke();
    mvCtx.beginPath(); mvCtx.arc(fx, fy, 4, 0, Math.PI*2); mvCtx.fill();
  });
  // La zone des arbitres (demi-cercle de 3 m contre la balustrade, 2.2.5.2) n'est PAS tracée :
  // sans table de marque à côté, Mirja y a vu « un arc de cercle qui sort de nulle part ».
  // Lignes de but.
  mvCtx.lineWidth = 2;
  mvCtx.beginPath(); mvCtx.moveTo(mGL_L, myMin); mvCtx.lineTo(mGL_L, myMax); mvCtx.stroke();
  mvCtx.beginPath(); mvCtx.moveTo(mGL_R, myMin); mvCtx.lineTo(mGL_R, myMax); mvCtx.stroke();
  // Zone de but : RECTANGULAIRE (2.2.5.1), et non le demi-disque qu'on dessinait. 2,45 m de
  // large pour des poteaux ancrés 30 cm à l'intérieur (2.2.5.1 B), donc une cage de 1,85 m :
  // la zone fait 1,32 fois la cage, et s'avance de 1,20 m, soit 0,49 fois sa propre largeur.
  // Ces RAPPORTS sont tenus ; la taille, elle, suit la cage dessinée — voir `mGoalHalf`.
  const zoneDemi = Math.round(mGoalHalf * 2.45 / 1.85), zoneProf = Math.round(zoneDemi * 2 * 1.20 / 2.45);
  mvCtx.fillStyle = 'rgba(226,58,58,.22)';
  [[mGL_L, 1], [mGL_R, -1]].forEach(([gx, sens]) => {
    const x0 = sens > 0 ? gx : gx - zoneProf;
    mvCtx.fillRect(x0, mCY - zoneDemi, zoneProf, zoneDemi * 2);
    mvCtx.strokeRect(x0, mCY - zoneDemi, zoneProf, zoneDemi * 2);
  });
  mvCtx.restore();

  // balustrade : un liseré clair sur une lisse sombre
  mvRoundRect(mxMin, myMin, mxMax-mxMin, myMax-myMin, mCORNER);
  mvCtx.lineWidth = 7; mvCtx.strokeStyle = '#0d1a30'; mvCtx.stroke();
  mvCtx.lineWidth = 2.5; mvCtx.strokeStyle = '#e8edf3'; mvCtx.stroke();

  // cages sur le terrain : le cadre rouge, et un filet suggéré par quelques mailles
  function mvGoal(x0, x1) {
    mvCtx.fillStyle = 'rgba(255,255,255,.10)';
    mvCtx.fillRect(x0, mCY-mGoalHalf, x1-x0, mGoalHalf*2);
    mvCtx.strokeStyle = 'rgba(255,255,255,.22)'; mvCtx.lineWidth = 1;
    mvCtx.beginPath();
    for (let y = mCY - mGoalHalf + 7; y < mCY + mGoalHalf; y += 7) { mvCtx.moveTo(x0, y); mvCtx.lineTo(x1, y); }
    mvCtx.moveTo((x0+x1)/2, mCY-mGoalHalf); mvCtx.lineTo((x0+x1)/2, mCY+mGoalHalf);
    mvCtx.stroke();
    mvCtx.strokeStyle = '#e23a3a'; mvCtx.lineWidth = 3;
    mvCtx.strokeRect(x0, mCY-mGoalHalf, x1-x0, mGoalHalf*2);
  }
  mvGoal(mGL_L - mGoalDepth, mGL_L);
  mvGoal(mGL_R, mGL_R + mGoalDepth);

  // joueurs et palet : positions déjà mises à jour par updateMvSkaters()/updateMvPuck() dans mvLoop
  const px = mv.puck.x, py = mv.puck.y;
  const bodies = [...mv.skaters, ...mv.goalies];

  // ombres portées : c'est ce qui pose les corps SUR la piste au lieu de les y coller
  mvCtx.fillStyle = 'rgba(0,0,0,.28)';
  bodies.forEach(s => {
    mvCtx.beginPath(); mvCtx.ellipse(s.x + 2, s.y + 4, MV_BODY_R + 1, MV_BODY_R - 2, 0, 0, Math.PI*2); mvCtx.fill();
  });

  // crosses : peuvent librement se croiser entre elles et passer sur le buste adverse
  mvCtx.lineCap = 'round';
  bodies.forEach(s => {
    const dx = px - s.x, dy = py - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const sx = s.x + (dx/len) * MV_BODY_R, sy = s.y + (dy/len) * MV_BODY_R;
    const ex = s.x + (dx/len) * (MV_BODY_R + 13), ey = s.y + (dy/len) * (MV_BODY_R + 13);
    mvCtx.beginPath(); mvCtx.moveTo(sx, sy); mvCtx.lineTo(ex, ey);
    mvCtx.strokeStyle = '#f0d29a'; mvCtx.lineWidth = 2.2; mvCtx.stroke();
    // La palette d'une crosse de hockey : COUDÉE au bout du manche, d'un seul côté, et presque
    // couchée vers l'avant. Un trait en travers, centré sur le manche, dessinait un maillet —
    // Mirja y a vu une batte de cricket. Le coude part à 55° du manche, toujours du même côté.
    const ca = Math.cos(MV_COUDE_PALETTE), sa = Math.sin(MV_COUDE_PALETTE);
    const bx = (dx/len) * ca - (dy/len) * sa, by = (dx/len) * sa + (dy/len) * ca;
    mvCtx.beginPath(); mvCtx.moveTo(ex, ey); mvCtx.lineTo(ex + bx * MV_LONGUEUR_PALETTE, ey + by * MV_LONGUEUR_PALETTE);
    mvCtx.strokeStyle = '#15171b'; mvCtx.lineWidth = 3.2; mvCtx.stroke();
  });
  mvCtx.lineCap = 'butt';
  // bustes : dessinés après les crosses, jamais superposés entre eux (séparation gérée dans updateMvSkaters).
  // Un patineur VU DE DESSUS — choisi par Mirja sur planche, parmi quatre, le 18 septembre 2026 :
  // les épaules, larges EN TRAVERS du sens de patinage, font le corps du maillot ; leurs deux
  // bouts portent la couleur des épaules ; le casque clair, grille vers l'avant, dit où il
  // regarde. Sur un téléphone le patineur fait 10 px : c'est le casque clair et le contour
  // sombre qui portent la lecture, le reste est pour la tablette et le bureau.
  // La physique ne change pas : le corps reste un disque de MV_BODY_R pour les contacts.
  bodies.forEach(s => {
    const cap = s.gardien ? (s.x < MW/2 ? 0 : Math.PI) : s.heading;
    const large = s.gardien ? 15 : 12.5, profond = s.gardien ? 10 : 8.5;
    mvCtx.save();
    mvCtx.translate(s.x, s.y); mvCtx.rotate(cap);
    mvCtx.beginPath(); mvCtx.ellipse(0, 0, profond, large, 0, 0, Math.PI*2);
    mvCtx.lineWidth = 4.5; mvCtx.strokeStyle = 'rgba(0,0,0,.62)'; mvCtx.stroke();
    mvCtx.fillStyle = s.col; mvCtx.fill();
    mvCtx.fillStyle = s.col2 || '#ffffff';
    [-1, 1].forEach(cote => {
      // des bouts d'épaules FINS : plus larges, ils mangeaient le corps du maillot et le club bleu paraissait blanc
      mvCtx.beginPath(); mvCtx.ellipse(0, cote * (large - 2.4), profond * 0.55, 2.3, 0, 0, Math.PI*2); mvCtx.fill();
    });
    if (s.gardien) {
      // les jambières, devant lui : c'est à elles qu'on reconnaît le gardien d'un coup d'œil
      mvCtx.lineWidth = 1; mvCtx.strokeStyle = 'rgba(0,0,0,.6)';
      [-13, 2].forEach(y => { mvRoundRect(4, y, 6, 11, 2); mvCtx.fill(); mvCtx.stroke(); });
    }
    mvCtx.beginPath(); mvCtx.arc(2, 0, MV_RAYON_CASQUE, 0, Math.PI*2);
    mvCtx.fillStyle = '#f4f6f8'; mvCtx.fill();
    mvCtx.lineWidth = 1.2; mvCtx.strokeStyle = 'rgba(0,0,0,.65)'; mvCtx.stroke();
    mvCtx.beginPath(); mvCtx.moveTo(2, 0); mvCtx.arc(2, 0, MV_RAYON_CASQUE, -0.7, 0.7); mvCtx.closePath();
    mvCtx.fillStyle = 'rgba(0,0,0,.55)'; mvCtx.fill();
    mvCtx.restore();
  });

  // Les numéros, SOUS le patineur : sur le casque ils feraient 6 px même au bureau. Clair sur
  // liseré sombre — « de couleur contrastée » (6.2.8 B), ici avec les dalles.
  if (mvNumerosVisibles()) {
    mvCtx.font = 'bold 10px Tomorrow, sans-serif';
    mvCtx.textAlign = 'center'; mvCtx.textBaseline = 'middle';
    mvCtx.lineJoin = 'round';
    bodies.forEach(s => {
      if (!s.p || !numeroValide(s.p.num)) return;
      const ty = s.y + MV_BODY_R + 11;
      mvCtx.lineWidth = 3; mvCtx.strokeStyle = 'rgba(0,0,0,.75)'; mvCtx.strokeText(String(s.p.num), s.x, ty);
      mvCtx.fillStyle = '#f4f6f8'; mvCtx.fillText(String(s.p.num), s.x, ty);
    });
  }

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
  // Un palet noir se perdait sur les dalles sombres ; l'orange est celui qu'on voit en salle.
  mvCtx.beginPath(); mvCtx.arc(px + 1, py + 2, 5.5, 0, Math.PI*2);
  mvCtx.fillStyle = 'rgba(0,0,0,.35)'; mvCtx.fill();
  mvCtx.beginPath(); mvCtx.arc(px, py, 5.5, 0, Math.PI*2);
  mvCtx.fillStyle = '#ff7a1a'; mvCtx.fill();
  mvCtx.lineWidth = 1.5; mvCtx.strokeStyle = '#7a2f00'; mvCtx.stroke();

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

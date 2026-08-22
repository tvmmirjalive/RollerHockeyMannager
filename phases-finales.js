// phases-finales.js — tout ce qui décide de la montée et de la descente.
//
// Sorti d'index.html au découpage (voir 4-outils/patch-decouper-phases-finales.py). Objectif
// déclaré par Mirja : pouvoir améliorer la simulation plus tard sans casser le reste.
//
// CE QU'IL Y A DEDANS
//   · les PLATEAUX, format fédéral des phases finales (Règlement particulier art. 4.5.1 B) :
//     quatre équipes, chacune rencontre les trois autres, nuls autorisés, barème 3/1/0 ;
//   · la PHASE D'ACCESSION Pré-Nationale → Nationale 3 (art. 9.3) et ses huit places
//     nationales ;
//   · les PLAYOFFS de division, séries au meilleur des 3 ;
//   · les ALERTES de la direction sur les travaux, et l'objectif de saison ;
//   · `endSeason()` — 17 Ko, la plus grosse fonction du jeu : montées, descentes, barrages,
//     play-downs, retraites, contrats, archives.
//
// CE QU'IL N'Y A PAS
//   `simulateMatch()` reste dans index.html : elle sert aussi au championnat et à la coupe.
//   La sortir la couperait de la moitié de ses appelants sans rien clarifier.
//
// POURQUOI CE DÉCOUPAGE EST SÛR
//   Ce fichier ne contient AUCUN code exécuté au chargement — que des `const` littérales et
//   des déclarations de fonction. Tout ce qu'il emprunte au reste du jeu (`simulateMatch`,
//   `myTeam`, `pushInbox`, `T`, `euros`, `DIVISIONS`…) est appelé à l'exécution, jamais à
//   l'analyse : l'ordre de chargement lui est indifférent. Un contrôle du patch le vérifie
//   ligne par ligne.
//
// Chargé par un <script> CLASSIQUE, pas un module ES : ceux-ci sont bloqués par CORS sous
// file://, et le jeu doit pouvoir s'ouvrir par double-clic.
//
// Pièce CRITIQUE : sans elle, aucune saison ne peut se terminer.

// ==================== Plateaux (format fédéral des phases finales) ====================
// Voir 4-outils/patch-plateau.py pour les articles cités.

const PLATEAU_PTS_VICTOIRE = 3;   // art. 11.3.1.1
const PLATEAU_PTS_NUL = 1;
const PLATEAU_PTS_DEFAITE = 0;

// Clé d'un duel, indépendante de l'ordre : le goal-average particulier se lit dans les deux
// sens (art. 11.3.2.2 B 1).
function clePlateauDuel(a, b) { return a < b ? a + '-' + b : b + '-' + a; }

function makePlateau(ids, label) {
  const table = {};
  ids.forEach(id => { table[id] = { pts: 0, bp: 0, bc: 0, j: 0 }; });
  return { label: label || '', ids: ids.slice(), table: table, duels: {}, matchs: [], fait: false };
}

// Enregistre un résultat déjà connu. Séparé de la simulation pour que le classement soit
// vérifiable sur des scores choisis, sans dépendre du hasard.
function enregistrerRencontrePlateau(pl, idA, idB, ga, gb) {
  const a = pl.table[idA], b = pl.table[idB];
  if (!a || !b) return;
  a.bp += ga; a.bc += gb; a.j++;
  b.bp += gb; b.bc += ga; b.j++;
  if (ga > gb) { a.pts += PLATEAU_PTS_VICTOIRE; b.pts += PLATEAU_PTS_DEFAITE; }
  else if (gb > ga) { b.pts += PLATEAU_PTS_VICTOIRE; a.pts += PLATEAU_PTS_DEFAITE; }
  else { a.pts += PLATEAU_PTS_NUL; b.pts += PLATEAU_PTS_NUL; }   // art. 5.4.1 B : le nul existe
  const cle = clePlateauDuel(idA, idB);
  const d = pl.duels[cle] || (pl.duels[cle] = {});
  d[idA] = (d[idA] || 0) + ga;
  d[idB] = (d[idB] || 0) + gb;
  pl.matchs.push({ a: idA, b: idB, ga: ga, gb: gb });
}

// Une rencontre de plateau : format standard, donc PAS de prolongation. On réutilise
// `butsAttendus()` du championnat — c'est la même simulation de jeu, seul le règlement de
// fin de match diffère. Aucune écriture sur les équipes : voir l'en-tête du patch.
function simulerRencontrePlateau(equipeA, equipeB) {
  const sa = teamStrength(equipeA), sb = teamStrength(equipeB);
  const fa = tacticFactor(equipeA), fb = tacticFactor(equipeB);
  sa.atk *= fa.atk; sa.def *= fa.def; sb.atk *= fb.atk; sb.def *= fb.def;
  // Terrain neutre : un plateau se joue chez un organisateur désigné, pas chez l'un des deux.
  return { ga: poisson(butsAttendus(sa.atk, sb.def, false)),
           gb: poisson(butsAttendus(sb.atk, sa.def, false)) };
}

// Joue toutes les rencontres non encore disputées. `resoudre(id)` rend l'équipe.
function resolvePlateau(pl, resoudre) {
  const trouve = resoudre || (typeof playoffTeam === 'function' ? playoffTeam : null);
  if (!trouve) return pl;
  for (let i = 0; i < pl.ids.length; i++) {
    for (let k = i + 1; k < pl.ids.length; k++) {
      const idA = pl.ids[i], idB = pl.ids[k];
      if (pl.duels[clePlateauDuel(idA, idB)]) continue;   // déjà joué
      const r = simulerRencontrePlateau(trouve(idA), trouve(idB));
      enregistrerRencontrePlateau(pl, idA, idB, r.ga, r.gb);
    }
  }
  pl.fait = true;
  return pl;
}

// Classement d'un plateau, art. 11.3.2.2 B. L'ordre des critères est celui du règlement, et
// il diffère du cas général (11.3.2.1) : ici le goal-average particulier passe AVANT les
// points de confrontation directe, qui n'existent pas dans ce cas de figure.
function classerPlateau(pl) {
  const ga = id => pl.table[id].bp - pl.table[id].bc;
  // Goal-average limité aux rencontres entre les équipes à départager (B 1 et B 2).
  const gaEntre = (id, groupe) => {
    let d = 0;
    groupe.forEach(autre => {
      if (autre === id) return;
      const duel = pl.duels[clePlateauDuel(id, autre)];
      if (duel) d += (duel[id] || 0) - (duel[autre] || 0);
    });
    return d;
  };
  const paquets = {};
  pl.ids.forEach(id => { (paquets[pl.table[id].pts] || (paquets[pl.table[id].pts] = [])).push(id); });
  const out = [];
  Object.keys(paquets).map(Number).sort((a, b) => b - a).forEach(pts => {
    const groupe = paquets[pts];
    groupe.sort((x, y) =>
      gaEntre(y, groupe) - gaEntre(x, groupe)     // B 1 et B 2
      || ga(y) - ga(x)                            // B 3 : goal-average général
      || pl.table[y].bp - pl.table[x].bp);        // B 4 : le plus de buts marqués
    out.push.apply(out, groupe);
  });
  return out;
}

// Remet toutes les équipes de la division au même niveau de forme avant les phases
// finales. Les blessés en cours restent blessés : une coupure repose, elle ne soigne pas.
function remettreEnForme() {
  const poules = (G.poules && G.poules.length) ? G.poules : [G.teams];
  poules.forEach(pou => pou.forEach(t => {
    if (!t || !t.players) return;
    t.players.forEach(p => { if (!p.injured) p.forme = irnd(88, 100); });
  }));
}

// ==================== Accession Pré-Nationale → Nationale 3 ====================
// Voir 4-outils/patch-accession-n3.py pour les articles cités.

const ACCESSION_PLACES = 8;        // art. 9.3 C : huit places pour toute la France
const ACCESSION_TOURNOIS = 4;      // « 2, 4 ou 8 tournois » — quatre de six, ici
const ACCESSION_PAR_TOURNOI = 6;

// Art. 9.3 B : deux clubs pour une ligue de huit équipes ou plus, un seul en dessous.
function ticketsDeLigue(taillePoule) { return taillePoule >= 8 ? 2 : 1; }

// Le club décroche-t-il un ticket ? Il faut finir dans les quatre premiers ET être dans le
// quota que sa ligue peut envoyer. Une poule bretonne de cinq n'emmène qu'un club ; une
// francilienne de neuf en emmène deux.
function aLeTicketDAccession(rang, taillePoule) {
  return rang >= 1 && rang <= 4 && rang <= ticketsDeLigue(taillePoule);
}

// Un adversaire du tournoi, au niveau attendu d'un qualifié de Pré-Nationale : le haut de
// la bande de sa division, puisque ce sont des premiers de ligue.
function adversaireAccession(i) {
  const bande = DIVISIONS[1].qual;
  const niveau = rnd(bande[1] - 4, bande[1] + 4);
  const eq = makeTeam({ name: `Vainqueur de ligue ${i}`, short: 'VL' + i, force: niveau }, 900 + i, bande);
  eq.tactic = { style: 'equilibre', pressing: 'moyen' };
  autoLineup(eq);
  return eq;
}

// Le tournoi d'accession. `rangPoule` sert à placer le club : un premier de ligue entre
// dans un tournoi plus relevé qu'un deuxième, comme la répartition fédérale le prévoit.
// Rend le détail plutôt qu'un simple booléen : le joueur a droit à savoir de combien il
// lui a manqué.
function jouerAccessionN3(rangPoule) {
  const me = myTeam();
  const participants = [];
  for (let i = 1; i <= ACCESSION_TOURNOIS * ACCESSION_PAR_TOURNOI - 1; i++) participants.push(adversaireAccession(i));

  // Le club rejoint l'un des tournois ; les autres sont résolus pour établir le classement
  // national. Art. 9.3 C : les tournois n'ont pas à désigner un vainqueur, seulement à
  // ordonner — d'où le classement de plateau plutôt qu'une élimination directe.
  const tousLesTournois = [];
  const pool = [me].concat(participants);
  const parTournoi = Math.ceil(pool.length / ACCESSION_TOURNOIS);
  const parId = {};
  pool.forEach(t => { parId[t.id] = t; });
  for (let k = 0; k < ACCESSION_TOURNOIS; k++) {
    const lot = pool.slice(k * parTournoi, (k + 1) * parTournoi);
    if (!lot.length) continue;
    const pl = makePlateau(lot.map(t => t.id), `Tournoi d'accession ${k + 1}`);
    resolvePlateau(pl, id => parId[id]);
    tousLesTournois.push(pl);
  }

  // Les places nationales se répartissent entre les tournois, par rang : tous les premiers,
  // puis tous les deuxièmes, jusqu'à huit.
  const qualifies = [];
  const classements = tousLesTournois.map(pl => classerPlateau(pl));
  const profondeur = Math.max.apply(null, classements.map(c => c.length).concat([0]));
  for (let rang = 0; rang < profondeur && qualifies.length < ACCESSION_PLACES; rang++) {
    classements.forEach(c => { if (c[rang] !== undefined && qualifies.length < ACCESSION_PLACES) qualifies.push(c[rang]); });
  }
  const rang = qualifies.indexOf(me.id) + 1;
  return {
    places: ACCESSION_PLACES,
    participants: pool,
    tours: tousLesTournois.length,
    rang: rang > 0 ? rang : null,
    monte: qualifies.indexOf(me.id) >= 0
  };
}

function startPlayoffs() {
  // garantie : la Coupe de France doit toujours être terminée avant les playoffs (donc bien avant les demies)
  if (G.cup && G.cup.season === G.season && !cupIsDone()) {
    cupAutoResolveRest();
    pushInbox('courrier.coupe.titre', 'courrier.coupe.auto',
      { vainqueur: cupTeam(G.cup.champion).name }, 'cup');
  }
  // La barre des playoffs s'adapte à la poule : les poules réelles vont de 4 à 11 équipes,
  // et un Top 8 figé sortait du tableau (seeds[7] indéfini) dans toute poule de moins de
  // 8 — la saison ne pouvait alors pas se terminer.
  // Coupure entre la qualification et les phases finales : tout le monde repart au même
  // niveau de forme. Sans cela, la poule du joueur — la seule dont l'usure est calculée —
  // affronterait sept poules restées fraîches. Voir 4-outils/patch-n3-federal.py.
  remettreEnForme();
  const seeds = qualifiesDivision(G.divIdx);
  const nQual = seeds.length;
  const seedRank = {};
  seeds.forEach((t, i) => { seedRank[t.id] = i; });
  // Composition des plateaux de quart, art. 4.5.2 A : la série i réunit le 1ᵉʳ d'une poule,
// le 2ᵉ de la suivante, le 3ᵉ de celle d'après et le 4ᵉ de la troisième — avec un décalage
// d'une place à chaque série, à l'intérieur de sa conférence.
// Conférence A : poules 0 à 3. Conférence B : poules 4 à 7.
function composerPlateauxQuarts(qualifies, def) {
  const parPouleRang = {};
  qualifies.forEach(q => { parPouleRang[q.poule + ':' + q.rang] = q.t; });
  const plateaux = [];
  const bases = [];
  for (let c = 0; c < def.conferences; c++) bases.push(c * 4);
  bases.forEach((base, iConf) => {
    for (let s = 0; s < 4; s++) {
      const ids = [];
      for (let rang = 0; rang < 4; rang++) {
        // +1 en N3, −1 en N2 : le modulo est écrit avec un « + 4 » pour rester positif.
        const poule = base + (((rang + def.sens * s) % 4 + 4) % 4);
        const eq = parPouleRang[poule + ':' + rang];
        if (eq) ids.push(eq.id);
      }
      const suffixe = def.conferences > 1 ? ` — conférence ${iConf === 0 ? 'A' : 'B'}` : '';
      plateaux.push(makePlateau(ids, `Quart de finale ${plateaux.length + 1}${suffixe}`));
    }
  });
  return plateaux;
}

let stage, quarts = null, demis = null, finale = null;
  const defPlateau = formatPhaseFinale(G.divIdx);
  if (defPlateau) {
    // Format fédéral : on ne construit aucune série, seulement des plateaux.
    const plateaux = composerPlateauxQuarts(qualifiesAvecRang(G.divIdx), defPlateau);
    G.playoff = { format: 'plateau', stage: 'quarts', plateaux: plateaux, def: defPlateau,
                  seedRank: seedRank, quarts: null, demis: null, finale: null,
                  champion: null, finalists: [], promus: [], humanOut: false, nQual: seeds.length };
    G.playoff.humanOut = !plateaux.some(pl => pl.ids.indexOf(myTeam().id) >= 0);
    renderAll();
    jouerMusique('playoffs');
    notify({
      title: "Place aux phases finales", ico: '🏒',
      html: `<p class="modal-note">Saison régulière terminée. Les <b>quatre premiers de chaque poule</b>
        sont qualifiés (art. 4.4 G) — <b>${seeds.length} clubs</b>, répartis en huit plateaux de quatre.</p>
        <p class="modal-note">Dans un plateau, chaque équipe rencontre les trois autres. Les
        <b>deux premières</b> passent en demi-finale ; le match nul y est possible (format standard).</p>
        <p class="modal-note">Les <b>quatre</b> clubs qui sortiront des demi-finales montent en
        ${escHtml(DIVISIONS[G.divIdx + 1] ? DIVISIONS[G.divIdx + 1].label : 'division supérieure')}.</p>`
    });
    return;
  }
  // Table des demi-finales, propre à chaque division. L'Élite apparie S1–S2 et S3–S4
  // (art. 1.8.1 G, compte tenu de l'ordre dans lequel ses quarts sont construits ici) ; la
  // N1 apparie S1–S3 et S2–S4 (art. 2.7.1 H).
  let tableDemies = [[0, 1], [2, 3]];

  // `IDX_N1` est déclaré localement dans endSeason() : on recalcule ici plutôt que de
  // déplacer une constante et d'élargir la portée d'un changement déjà délicat.
  const idxN1 = DIVISIONS.length - 2;
  if (nQual === 8 && G.divIdx === idxN1 && G.poules && G.poules.length === 2) {
    // Art. 2.7.1 G : les deux poules se croisent systématiquement — 1er P1 contre 4ème P2,
    // 2ème P1 contre 3ème P2, et ainsi de suite. Bâtir depuis un classement global laissait
    // 9 % des quarts opposer deux clubs de la même poule, ce que le règlement exclut.
    const tri = (a, b) => b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp;
    const p1 = [...G.poules[0]].sort(tri), p2 = [...G.poules[1]].sort(tri);
    quarts = [0, 1, 2, 3]
      .map(r => [p1[r], p2[3 - r]])
      .filter(([a, b]) => a && b)
      .map(([a, b], i) => makeSeries(a.id, b.id, { cle: 'playoffs.serie.quart', n: i + 1 }));
    tableDemies = [[0, 2], [1, 3]];
    stage = 'quarts';
  } else if (nQual === 8) {
    // bracket classique : 1v8, 4v5, 3v6, 2v7
    quarts = [[0, 7], [3, 4], [2, 5], [1, 6]]
      .map(([a, b], i) => makeSeries(seeds[a].id, seeds[b].id, { cle: 'playoffs.serie.quart', n: i + 1 }));
    stage = 'quarts';
  } else if (nQual === 4) {
    // 1v4 et 2v3, comme le règlement le prévoit en N3, N2 et N1 (art. 4.4 G, 3.5 E, 2.6 C)
    demis = [[0, 3], [1, 2]]
      .map(([a, b], i) => makeSeries(seeds[a].id, seeds[b].id, { cle: 'playoffs.serie.demi', n: i + 1 }));
    stage = 'demis';
  } else {
    finale = [makeSeries(seeds[0].id, seeds[1].id, { cle: 'playoffs.serie.finale' })];
    stage = 'finale';
  }
  G.playoff = { stage, seedRank, quarts, demis, finale, tableDemies, champion: null, finalists: [], humanOut: false, nQual };
  renderAll();
  const myId = myTeam().id;
  jouerMusique('playoffs');
  notify({
    title: "Place aux playoffs", ico: '🏒',
    html: `<p class="modal-note">Saison régulière terminée. Le Top ${seeds.length} est qualifié — séries au meilleur des 3 :
      aller, retour, et match d'appui si nécessaire.</p>
      <div class="modal-sub">Qualifiés</div>
      <ul class="modal-list">${seeds.map((t, i) =>
        `<li class="${t.id === myId ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${escHtml(t.name)}</span></li>`
      ).join('')}</ul>`
  });
}

function seriesNextGame(series) {
  const n = series.games.length;
  // match 1 (aller) : le mieux classé (home) reçoit ; match 2 (retour) : l'autre reçoit ; match 3 (appui) : home reçoit à nouveau
  const hostId = n === 1 ? series.away : series.home;
  const guestId = n === 1 ? series.home : series.away;
  return { hostId, guestId, gameNumber: n + 1 };
}

function runSeriesGame(series) {
  const { hostId, guestId, gameNumber } = seriesNextGame(series);
  const host = playoffTeam(hostId), guest = playoffTeam(guestId);
  const res = simulatePlayoffMatch(host, guest);
  const game = { home: hostId, away: guestId, res, num: gameNumber };
  series.games.push(game);
  const gameWinnerId = res.gH > res.gA ? hostId : guestId;
  if (gameWinnerId === series.home) series.winsHome++; else series.winsAway++;
  if (series.winsHome === 2) series.winner = series.home;
  else if (series.winsAway === 2) series.winner = series.away;
  return { home: host, away: guest, res, game };
}

// Plateau où figure le club du joueur, s'il en reste un.
function monPlateau() {
  const po = G.playoff;
  if (!po || !po.plateaux) return null;
  const moi = myTeam().id;
  return po.plateaux.find(pl => pl.ids.indexOf(moi) >= 0) || null;
}

// Fait avancer un tour de plateaux d'un cran : une rencontre du joueur, le reste d'un bloc.
function avancerPlateaux() {
  const po = G.playoff;
  const mien = monPlateau();
  if (mien && !mien.fait) {
    // Une rencontre à la fois pour le club du joueur, afin qu'il la voie.
    const moi = myTeam().id;
    let joue = null;
    for (const autre of mien.ids) {
      if (autre === moi) continue;
      if (pl_duelJoue(mien, moi, autre)) continue;
      const chezMoi = mien.ids.indexOf(moi) < mien.ids.indexOf(autre);
      const a = playoffTeam(moi), b = playoffTeam(autre);
      const r = simulerRencontrePlateau(chezMoi ? a : b, chezMoi ? b : a);
      const ga = chezMoi ? r.ga : r.gb, gb = chezMoi ? r.gb : r.ga;
      enregistrerRencontrePlateau(mien, moi, autre, ga, gb);
      joue = { adverse: autre, ga: ga, gb: gb };
      break;
    }
    if (joue) {
      const cl = classerPlateau(mien);
      const rang = cl.indexOf(moi) + 1;
      G.lastReport = { m: { home: moi, away: joue.adverse, score: [joue.ga, joue.gb] },
        res: { gH: joue.ga, gA: joue.gb, scorers: [], penalties: [], wentOT: false },
        home: playoffTeam(moi), away: playoffTeam(joue.adverse), playoff: true,
        title: `${mien.label} — ${playoffTeam(moi).name} ${joue.ga}–${joue.gb} ${playoffTeam(joue.adverse).name} · ${rang}ᵉ du plateau` };
      if (mien.ids.every(x => x === moi || pl_duelJoue(mien, moi, x))) resolvePlateau(mien, playoffTeam);
      renderAll(); showReport();
      return;
    }
  }
  // Plus rien à jouer pour le joueur : on résout tout le tour et on enchaîne.
  po.plateaux.forEach(pl => { if (!pl.fait) resolvePlateau(pl, playoffTeam); });
  buildNextRoundPlateau();
  renderAll();
}

function pl_duelJoue(pl, a, b) { return !!pl.duels[clePlateauDuel(a, b)]; }

// Tour suivant. Les quarts qualifient les DEUX premiers (art. 4.5.2 D), les demies le
// PREMIER seulement (art. 4.5.3 D) — la différence est dans le règlement, pas une erreur.
function buildNextRoundPlateau() {
  const po = G.playoff, def = po.def;
  if (po.stage === 'quarts') {
    // Table des demi-finales, art. 4.5.3 A (N3) et 3.6.3 A (N2) : par groupe de quatre
    // quarts, deux plateaux qui alternent premiers et deuxièmes. Le premier prend le 1ᵉʳ du
    // quart A, le 2ᵉ du quart B, le 1ᵉʳ du quart C, le 2ᵉ du quart D ; le second prend le
    // complément. Un plateau étant un mini-championnat, l'ordre des équipes n'y compte pas.
    const classes = po.plateaux.map(pl => classerPlateau(pl));
    po.plateaux = [];
    for (let g = 0; g < classes.length; g += 4) {
      const groupe = classes.slice(g, g + 4);
      if (groupe.length < 4) break;
      [0, 1].forEach(decalage => {
        const ids = groupe.map((cl, i) => cl[(i + decalage) % 2]).filter(x => x !== undefined);
        po.plateaux.push(makePlateau(ids, `Demi-finale ${po.plateaux.length + 1}`));
      });
    }
    po.stage = 'demis';
  } else if (po.stage === 'demis') {
    const finalistes = [];
    po.plateaux.forEach(pl => classerPlateau(pl).slice(0, def.passeDemies).forEach(id => finalistes.push(id)));
    po.plateaux = [makePlateau(finalistes, 'Tournoi final')];
    po.stage = 'finale';
  } else if (po.stage === 'finale') {
    const cl = classerPlateau(po.plateaux[0]);
    po.champion = cl[0];
    po.finalists = cl.slice(0, 2);
    // Les montées se lisent sur le classement du tournoi final : quatre en N3 (art. 4.7 A,
    // soit tous ses finalistes), deux en N2 (art. 3.8 A). Une seule règle, au bon endroit.
    po.promus = cl.slice(0, def.montees);
    po.stage = 'done';
  }
  po.humanOut = po.stage === 'done' || !monPlateau();
}

function currentRound() {
  const po = G.playoff;
  if (po.stage === 'quarts') return po.quarts;
  if (po.stage === 'demis') return po.demis;
  if (po.stage === 'finale') return po.finale;
  return null;
}

function humanInSeries(series) {
  return playoffTeam(series.home).human || playoffTeam(series.away).human;
}

function resolveSeriesFully(series) {
  while (series.winner === null) runSeriesGame(series);
}

// Construit le tour suivant une fois toutes les séries du tour actuel terminées
function buildNextRound() {
  const po = G.playoff;
  const roundArr = currentRound();
  if (po.stage === 'quarts') {
    const w = roundArr.map(s => s.winner);
    // La table dit quels vainqueurs s'affrontent. Sans elle, on supposait S1–S2 et S3–S4,
    // ce qui est juste en Élite et faux en N1 (art. 2.7.1 H : S1–S3 et S2–S4).
    // Les sauvegardes d'avant cette version n'en ont pas : on retombe sur l'ancien appariement.
    const table = po.tableDemies || [[0, 1], [2, 3]];
    po.demis = table.map(([a, b], i) =>
      makeSeries(betterSeed(w[a], w[b]), worseSeed(w[a], w[b]), { cle: 'playoffs.serie.demi', n: i + 1 }));
    po.stage = 'demis';
  } else if (po.stage === 'demis') {
    const w = roundArr.map(s => s.winner);
    po.finale = [makeSeries(betterSeed(w[0], w[1]), worseSeed(w[0], w[1]), { cle: 'playoffs.serie.finale' })];
    po.stage = 'finale';
  } else if (po.stage === 'finale') {
    po.champion = roundArr[0].winner;
    po.finalists = [roundArr[0].home, roundArr[0].away];
    po.stage = 'done';
  }
}

// Résout instantanément tout ce qu'il reste à jouer (utilisé une fois l'équipe du joueur éliminée)
function autoResolveRestOfPlayoffs() {
  const po = G.playoff;
  while (po.stage !== 'done') {
    const roundArr = currentRound();
    roundArr.forEach(s => { if (s.winner === null) resolveSeriesFully(s); });
    buildNextRound();
  }
}

function advancePlayoffs() {
  const po = G.playoff;
  if (po.format === 'plateau') {
    if (po.stage === 'done') return;
    if (po.humanOut) {
      // Club éliminé : on déroule tout le reste d'un coup, comme pour les séries.
      let garde = 0;
      while (po.stage !== 'done' && garde++ < 10) {
        po.plateaux.forEach(pl => { if (!pl.fait) resolvePlateau(pl, playoffTeam); });
        buildNextRoundPlateau();
      }
      G.lastReport = null;
      const boite = document.getElementById('matchReport');
      if (boite) boite.style.display = 'none';
      renderAll();
      return;
    }
    avancerPlateaux();
    return;
  }

  // équipe déjà éliminée : on ne rejoue plus match par match, tout se résout d'un coup
  if (po.humanOut) {
    autoResolveRestOfPlayoffs();
    G.lastReport = null;
    document.getElementById('matchReport').style.display = 'none';
    renderAll();
    return;
  }

  const roundArr = currentRound();
  if (!roundArr) return;

  // les séries qui ne concernent pas le joueur se résolvent instantanément en arrière-plan
  roundArr.forEach(s => { if (!humanInSeries(s) && s.winner === null) resolveSeriesFully(s); });

  const humanSeries = roundArr.find(s => humanInSeries(s));
  if (!humanSeries) { po.humanOut = true; autoResolveRestOfPlayoffs(); renderAll(); return; }

  if (humanSeries.winner === null) {
    const { home, away, res, game } = runSeriesGame(humanSeries);
    const scoreLine = T('playoffs.mene', { meneur: playoffTeam(humanSeries.home).name,
      a: humanSeries.winsHome, b: humanSeries.winsAway, adversaire: playoffTeam(humanSeries.away).name });
    G.lastReport = {
      m: game, res, home, away, playoff: true,
      title: `${serieLabel(humanSeries.label)} — ${T('playoffs.match', { n: game.num })}${humanSeries.winner ? ' ' + T('playoffs.serieRemportee') : ''} — ${scoreLine}`
    };
    if (humanSeries.winner !== null && humanSeries.winner !== myTeam().id) po.humanOut = true;

    // le tour est peut-être déjà complet (les autres séries étaient déjà résolues) : on enchaîne tout de suite
    if (roundArr.every(s => s.winner !== null)) buildNextRound();
    renderAll();
    if (home.human || away.human) watchMatch(G.lastReport); else showReport();
    return;
  }

  // sécurité : série déjà décidée mais tour pas encore construit
  if (roundArr.every(s => s.winner !== null)) buildNextRound();
  renderAll();
}


// ==================== Alertes de la direction sur les travaux ====================
// La salle conditionne la montée depuis la v65. Ces messages vont chercher le joueur au
// lieu d'attendre qu'il ouvre l'onglet Club — un refus de montée découvert en fin de
// saison serait vécu comme une punition arbitraire.

// Corps commun des alertes : ce qui manque, ce que ça coûte, et s'il reste un chantier.
// Les deux derniers chiffres comptent autant que le premier : une alerte qui dit quoi
// faire sans dire si c'est faisable ne sert à rien.
// Combien de saisons d'épargne pour atteindre une somme, au rythme de la saison en cours.
// `G.saisonDebut` est l'instantané posé en v84 pour le résumé de fin de saison : la
// différence avec le budget courant donne le gain réalisé jusqu'ici.
function saisonsDEpargne(cout) {
  const manque = cout - G.budget;
  if (manque <= 0) return 0;
  const depart = (G.saisonDebut && G.saisonDebut.budget) || 0;
  const gain = G.budget - depart;
  if (gain <= 0) return null;               // on ne gagne rien : impossible à estimer
  return Math.ceil(manque / gain);
}

// Rang à partir duquel la montée devient une perspective réelle. En N3 et en N2 les quatre
// premiers de chaque poule sont qualifiés pour les phases finales (art. 4.4 G et 3.5) ;
// ailleurs, seuls les deux premiers jouent quelque chose. Prévenir un 4e de N3 n'est donc
// pas du zèle : il est bel et bien en position de monter.
function rangQualifiantMontee() {
  return formatPhaseFinale(G.divIdx) ? 4 : 2;
}

function detailTravauxStade(divCible) {
  const req = classeRequise(divCible);
  const manque = req.stade - G.club.stade;
  const cout = upgradeCost('stade');
  const restants = MAX_UPGRADES_PER_SEASON - G.upgradesThisSeason;
  const plafond = infraLevelDivRequirement(G.club.stade + 1);
  const bloqueParDivision = G.divIdx < plafond;
  return `La ${escHtml(DIVISIONS[divCible].label)} exige une salle de <b>classe ${req.classe}</b>,
    soit un stade de niveau ${req.stade}. Le nôtre est au niveau ${G.club.stade} :
    <b>${manque} niveau${manque > 1 ? 'x' : ''}</b> à gagner.
    ${bloqueParDivision
      ? `Le niveau ${G.club.stade + 1} n'est pas autorisé avant la ${escHtml(DIVISIONS[plafond].label)} :
         il faudra d'abord monter, les travaux suivront.`
      : `Prochain chantier : ${euros(cout)}. Chantiers encore disponibles cette saison :
         <b>${restants}/${MAX_UPGRADES_PER_SEASON}</b>.`}`;
}

// L'étude d'équilibrage a montré qu'un club pouvait stagner dix saisons sans jamais
// comprendre pourquoi : son effectif était sous la bande de sa division, et rien ne le lui
// disait. Le classement ne le dit pas — on peut finir 5e avec un effectif condamné. Cette
// alerte nomme l'écart, et nomme le marché, qui est le seul levier immédiat : atteindre la
// bande N3 coûte ~33 000 € de transferts, une somme qu'un club a en caisse bien avant de
// pouvoir s'offrir le moindre bâtiment.
function alerterDirectionEffectif() {
  const me = myTeam();
  if (!me || !me.players.length) return;
  const force = Math.round(me.players.reduce((s, p) => s + overall(p), 0) / me.players.length);
  const bande = DIVISIONS[G.divIdx].qual;
  const milieu = Math.round((bande[0] + bande[1]) / 2);
  const ecart = force - milieu;
  if (ecart >= -2) return; // à niveau, ou au-dessus : rien à signaler
  const grave = ecart <= -6;
  pushInbox(grave ? 'courrier.effectif.grave.titre' : 'courrier.effectif.leger.titre',
    grave ? 'courrier.effectif.grave.corps' : 'courrier.effectif.leger.corps',
    { force: force, division: DIVISIONS[G.divIdx].label, milieu: milieu, ecart: Math.abs(ecart) },
    'contrat');
}

// Alerte de début de saison : informative, sans urgence.
function alerterDirectionDebutSaison() {
  const suiv = G.divIdx + 1;
  if (suiv >= DIVISIONS.length || stadeSuffisantPour(suiv)) return;
  const refus = G.refusStade || 0;
  const cout = upgradeCost('stade');
  const ans = saisonsDEpargne(cout);
  // Le chiffrage n'apparaît qu'à partir du premier refus : avant, le joueur a d'autres
  // priorités légitimes et l'assommer de calculs serait contre-productif.
  const chiffrage = refus === 0 ? '' :
    ' ' + (ans === 0 ? T('stade.chiffrage.pret', { montant: euros(cout) })
     : ans === null ? T('stade.chiffrage.rien', { montant: euros(cout) })
     : T('stade.chiffrage.epargne', { montant: euros(cout), n: ans }));

  if (refus === 0) {
    pushInbox('courrier.stade.point.titre', 'courrier.stade.point.corps',
      { detailHtml: detailTravauxStade(suiv) }, 'board');
    return;
  }
  if (refus === 1) {
    pushInbox('courrier.stade.refus1.titre', 'courrier.stade.refus1.corps',
      { detailHtml: detailTravauxStade(suiv), chiffrageHtml: chiffrage }, 'board');
  } else {
    pushInbox('courrier.stade.refusN.titre', 'courrier.stade.refusN.corps',
      { n: refus, detailHtml: detailTravauxStade(suiv), chiffrageHtml: chiffrage }, 'board');
  }
  G.tabNotify.club = true;
}

// Relance en cours de saison : seulement si la montée devient une perspective réelle.
// Une seule fois par saison, passé le tiers du calendrier, pour ne pas harceler.
function alerterDirectionSiMontee() {
  const suiv = G.divIdx + 1;
  if (suiv >= DIVISIONS.length || stadeSuffisantPour(suiv)) return;
  if (G.day < Math.floor(G.schedule.length / 3)) return;
  const rang = sortedTeams().indexOf(myTeam());
  // Le seuil suit la division : quatre premiers qualifiés en N3 et en N2, deux ailleurs.
  if (rang < 0 || rang >= rangQualifiantMontee()) return;

  // Un club déjà refusé est relancé deux fois dans la saison ; les autres une seule. On
  // insiste auprès de qui en a besoin, sans harceler celui qui découvre la contrainte.
  const relances = (G.refusStade || 0) > 0 ? 2 : 1;
  if (G.alerteStadeSaison !== G.season) { G.alerteStadeSaison = G.season; G.alerteStadeTour = 0; }
  if ((G.alerteStadeTour || 0) >= relances) return;
  G.alerteStadeTour = (G.alerteStadeTour || 0) + 1;

  const dejaRefuse = (G.refusStade || 0) > 0;
  pushInbox(dejaRefuse ? 'courrier.stade.encore.titre' : 'courrier.stade.insiste.titre',
    dejaRefuse ? 'courrier.stade.encore.corps' : 'courrier.stade.insiste.corps',
    { rang: rang + 1, ordinal: rang === 0 ? 'ᵉʳ' : 'ᵉ', detailHtml: detailTravauxStade(suiv),
      refus: G.refusStade || 0, n: G.schedule.length - G.day }, 'board');
  G.tabNotify.club = true;
}

// Confirmation : le jeu doit aussi savoir dire que c'est réglé.
function confirmerTravauxSuffisants(avant) {
  const suiv = G.divIdx + 1;
  if (suiv >= DIVISIONS.length) return;
  if (avant || !stadeSuffisantPour(suiv)) return;
  G.refusStade = 0;              // la contrainte est levée, le compteur repart à zéro
  pushInbox('courrier.stade.homologue.titre', 'courrier.stade.homologue.corps',
    { classe: classeActuelle(), division: DIVISIONS[suiv].label }, 'board');
}

// Libellé de l'objectif de saison. Repli sur l'ancien `label` : les parties en cours l'ont
// encore dans leur sauvegarde, et le leur retirer les laisserait sans objectif affiché.
function objectifLabel() {
  const o = G.boardObjective;
  if (!o) return '—';
  if (o.key) return T('objectif.' + o.key);
  return o.label || '—';
}

function assignBoardObjective() {
  const n = G.teams.length;
  const lastRank = G.lastSeasonRank;
  const atFloor = G.divIdx === 0; // Régional : plancher de la pyramide, la descente n'existe pas
  let objective;
  if (atFloor) {
    // en N3 il n'y a rien "en dessous" : viser le milieu de tableau puis les playoffs, jamais le maintien
    // Seul `key` est conservé : `label` était SAUVEGARDÉ, donc figé dans la langue du jour.
    // Troisième fois que ce défaut se présente — courrier, réponses, et maintenant l'objectif.
    if (lastRank === undefined || lastRank >= Math.floor(n / 2)) objective = { key: 'milieu' };
    else if (lastRank < 2) objective = { key: 'titre' };
    else objective = { key: 'playoffs' };
  } else if (lastRank === undefined) {
    objective = { key: 'maintien' };
  } else if (lastRank >= n - 3) {
    objective = { key: 'maintienDescente' };
  } else if (lastRank < 2) {
    objective = { key: 'titre' };
  } else {
    objective = { key: 'playoffs' };
  }
  G.boardObjective = objective;
  pushInbox('courrier.objectif.fixe.titre', 'courrier.objectif.fixe.corps',
    { division: DIVISIONS[G.divIdx].label, objectif: objectifLabel() }, 'board');
  alerterDirectionDebutSaison();
  alerterDirectionEffectif();
}

function evaluateBoardObjective(rank, iAmChampion, n) {
  if (!G.boardObjective) return;
  let met = false;
  if (G.boardObjective.key === 'maintien' || G.boardObjective.key === 'maintienDescente') met = rank < n - 2;
  else if (G.boardObjective.key === 'milieu') met = rank < Math.floor(n / 2);
  else if (G.boardObjective.key === 'playoffs') met = rank < 8;
  else if (G.boardObjective.key === 'titre') met = iAmChampion;
  G.boardConfidence = Math.round(clampV((G.boardConfidence ?? 60) + (met ? 10 : -8), 0, 100));
  const bonus = met ? Math.round(1500 * (1 + DIVISIONS[G.divIdx].prestige)) : 0;
  if (bonus) G.budget += bonus;
  pushInbox(met ? 'courrier.objectif.atteint.titre' : 'courrier.objectif.manque.titre',
    met ? 'courrier.objectif.atteint.corps' : 'courrier.objectif.manque.corps',
    { objectif: objectifLabel(), prime: euros(bonus), confiance: G.boardConfidence },
    'board');
}

function endSeason() {
  const ranking = sortedTeams();
  const rank = ranking.indexOf(myTeam());
  const n = G.teams.length;
  const div = DIVISIONS[G.divIdx];
  const basePrize = [3000, 2200, 1600, 1200, 900, 700, 500, 300][Math.min(rank, 7)] * (1 + div.prestige);
  G.budget += basePrize;

  const po = G.playoff;
  const iAmFinalist = po && po.finalists.includes(myTeam().id);
  const iAmChampion = po && po.champion === myTeam().id;
  let trophyMsg = "";
  if (iAmChampion) {
    const trophy = 5000 * (1 + div.prestige);
    G.budget += trophy;
    trophyMsg = `<div class="modal-flash good"><b>🏆 ${T('fin.champion', { division: escHtml(div.label) })}</b>${T('fin.primeTitre', { montant: euros(trophy) })}</div>`;
  } else if (iAmFinalist) {
    trophyMsg = `<div class="modal-flash warn"><b>🥈 ${T('fin.finaliste', { division: escHtml(div.label) })}</b>${T('fin.finaliste.note')}</div>`;
  }

  // ---- Barrage Élite/N1 (art. 1.8.2 et 2.10 A) ----
  // Le 9e d'Élite défend sa place contre le 2e de N1, sur le terrain du club de l'Élite.
  // Le champion de N1 monte directement ; le 10e d'Élite descend directement. Seule la
  // place charnière se dispute — c'est là qu'est la tension.
  const IDX_ELITE = DIVISIONS.length - 1, IDX_N1 = IDX_ELITE - 1;
  let barrageMsg = null, barrageGagne = null;

  function jouerBarrage(adverseDef, adverseDiv, aDomicile) {
    const adv = makeTeam({ name: adverseDef.name, short: adverseDef.short, force: adverseDef.force },
                         999, DIVISIONS[adverseDiv].qual);
    const moi = myTeam();
    const res = aDomicile ? simulatePlayoffMatch(moi, adv) : simulatePlayoffMatch(adv, moi);
    const mesButs = aDomicile ? res.gH : res.gA;
    const sesButs = aDomicile ? res.gA : res.gH;
    return { gagne: mesButs > sesButs, adv, mesButs, sesButs, ot: res.wentOT };
  }

  if (G.divIdx === IDX_ELITE && rank === n - 2) {
    // 9e d'Élite : barrage à domicile pour rester dans l'élite
    const advDef = [...(DIVISIONS[IDX_N1].teams || [])].sort((a, b) => (b.force || 0) - (a.force || 0))[0];
    if (advDef) {
      const b = jouerBarrage(advDef, IDX_N1, true);
      barrageGagne = b.gagne;
      barrageMsg = `<div class="modal-flash ${b.gagne ? 'good' : 'bad'}">
        <b>${b.gagne ? '🛡️ ' + T('fin.barrage.maintien') : '⚠️ ' + T('fin.barrage.descente')}</b>
        ${T('fin.barrage.recevait', { adversaire: escHtml(b.adv.name) })}
        ${T('fin.score', { mes: b.mesButs, ses: b.sesButs, prol: b.ot ? T('fin.apresProlongation') : '' })}</div>`;
    }
  } else if (G.divIdx === IDX_N1 && po && iAmFinalist && !iAmChampion) {
    // 2e de N1 : barrage à l'extérieur, chez le club de l'Élite
    const advDef = [...(DIVISIONS[IDX_ELITE].teams || [])].sort((a, b) => (a.force || 0) - (b.force || 0))[0];
    if (advDef) {
      const b = jouerBarrage(advDef, IDX_ELITE, false);
      barrageGagne = b.gagne;
      barrageMsg = `<div class="modal-flash ${b.gagne ? 'good' : 'warn'}">
        <b>${b.gagne ? '🎉 ' + T('fin.barrage.montee') : '🥈 ' + T('fin.barrage.maintienN1')}</b>
        ${T('fin.barrage.deplacait', { adversaire: escHtml(b.adv.name) })}
        ${T('fin.score', { mes: b.mesButs, ses: b.sesButs, prol: b.ot ? T('fin.apresProlongation') : '' })}</div>`;
    }
  }

  // ---- Play-down de Nationale 1 (art. 2.8) ----
  // Seule division où l'on joue pour ne pas descendre : 7ᵉ contre 8ᵉ, le perdant tombe en
  // N2. Le croisement réel entre les deux poules n'est pas simulable — le jeu n'en tient
  // qu'une — mais la mécanique tient : une place de barragiste n'est ni sauve ni perdue.
  let playdownMsg = null, playdownSauve = null;
  if (G.divIdx === IDX_N1 && n >= 4 && (rank === n - 2 || rank === n - 1)) {
    const adverse = ranking[rank === n - 2 ? n - 1 : n - 2];
    if (adverse && adverse !== myTeam()) {
      const jeRecois = rank === n - 2; // le mieux classé reçoit (art. 2.8 D)
      const res = jeRecois ? simulatePlayoffMatch(myTeam(), adverse)
                           : simulatePlayoffMatch(adverse, myTeam());
      const mes = jeRecois ? res.gH : res.gA, siens = jeRecois ? res.gA : res.gH;
      playdownSauve = mes > siens;
      playdownMsg = `<div class="modal-flash ${playdownSauve ? 'good' : 'bad'}">
        <b>${playdownSauve ? '🛡️ ' + T('fin.playdown.maintien') : '⚠️ ' + T('fin.playdown.descente')}</b>
        ${T(jeRecois ? 'fin.playdown.recevait' : 'fin.playdown.deplacait',
            { rang: rank + 1, adversaire: escHtml(adverse.name) })}
        ${T('fin.score', { mes: mes, ses: siens, prol: res.wentOT ? T('fin.apresProlongation') : '' })}</div>`;
    }
  }

  // la montée se joue aux playoffs ; en N1 le finaliste doit en plus gagner son barrage
  // Format fédéral : monte qui figure parmi les promus désignés par les demi-finales
  // (art. 4.7 A). Le champion de la saison régulière ne monte plus d'office — le règlement
  // ne le prévoit pas en N3, il faut sortir des plateaux.
  const promusPlateau = (po && G.playoff && G.playoff.format === 'plateau') ? (G.playoff.promus || []) : null;
  // Pré-Nationale : la montée ne s'obtient plus en gagnant sa poule. Il faut un ticket de
  // ligue (art. 9.3 B) puis sortir du tournoi national à huit places (art. 9.3 C).
  let accession = null;
  if (G.divIdx === 1) {
    accession = aLeTicketDAccession(rank + 1, n) ? jouerAccessionN3(rank + 1) : { monte: false, rang: null };
  }
  let promote = accession ? accession.monte
    : promusPlateau
    ? promusPlateau.indexOf(myTeam().id) >= 0
    : rank === 0 || (po ? iAmFinalist : rank < 2); // `let` : une salle non classée peut l'annuler
  if (G.divIdx === IDX_N1 && barrageGagne !== null) promote = barrageGagne || iAmChampion;
  let moveMsg = "";
  let wasPromoted = false, wasRelegated = false;
  // Art. 2.2.7.2 : sans installation classée pour la division visée, la montée est
  // refusée. Le club reste où il est — comme un club réel dont la salle n'est pas
  // qualifiée, qui doit faire les travaux avant de pouvoir accéder.
  let montreeRefusee = null;
  if (promote && G.divIdx < DIVISIONS.length - 1 && !stadeSuffisantPour(G.divIdx + 1)) {
    const req = classeRequise(G.divIdx + 1);
    montreeRefusee = `<div class="modal-flash bad"><b>⚠️ ${T('fin.montee.refusee')}</b>
      ${T('fin.montee.refusee.detail', { division: escHtml(DIVISIONS[G.divIdx + 1].label),
          classe: req.classe, requis: req.stade, niveau: G.club.stade })}</div>`;
    promote = false;
    // Compteur de refus : il gradue les alertes des saisons suivantes.
    G.refusStade = (G.refusStade || 0) + 1;
  }
  if (promote && G.divIdx < DIVISIONS.length - 1) {
    const oldDivIdx = G.divIdx;
    G.divIdx++;
    wasPromoted = true;
    const bonus = PROMOTION_BONUS[G.divIdx] + DIVISION_BASE_BUDGET[G.divIdx];
    G.budget += bonus;
    // rattrapage de niveau : sans ça, l'écart de qualité moyenne entre divisions (~+8 par palier)
    // surclasse immédiatement l'équipe promue, qui redescend aussitôt sans jamais consolider sa place.
    const oldAvg = (DIVISIONS[oldDivIdx].qual[0] + DIVISIONS[oldDivIdx].qual[1]) / 2;
    const newAvg = (DIVISIONS[G.divIdx].qual[0] + DIVISIONS[G.divIdx].qual[1]) / 2;
    const boost = Math.round((newAvg - oldAvg) * 0.7);
    if (boost > 0) {
      myTeam().players.forEach(p => {
        const cap = p.potentiel || 97;
        p.tir = Math.round(clampV(p.tir + boost, 30, cap));
        p.def = Math.round(clampV(p.def + boost, 30, cap));
        p.vit = Math.round(clampV(p.vit + boost, 30, cap));
        if (p.pos === 'G') p.gar = Math.round(clampV(p.gar + boost, 30, cap));
      });
    }
    moveMsg = `<div class="modal-flash good"><b>🎉 ${T('fin.montee', { division: escHtml(DIVISIONS[G.divIdx].label) })}</b>${T('fin.montee.detail', { montant: euros(bonus) })}</div>`;
  } else if (estRelegable(rank, n) && G.divIdx > 0
             && !(G.divIdx === IDX_ELITE && rank === n - 2 && barrageGagne === true)
             && !(G.divIdx === IDX_N1 && playdownSauve === true)) {
    // le 9e d'Élite vainqueur de son barrage conserve sa place (art. 1.10 A)
    G.divIdx--;
    wasRelegated = true;
    const quota = DESCENTES_DIVISION[G.divIdx + 1];
    const surDivision = quota && G.poules && G.poules.length > 1;
    const posNat = surDivision ? classementNational().findIndex(e => e.t === myTeam()) + 1 : 0;
    moveMsg = `<div class="modal-flash bad"><b>⚠️ ${T('fin.descente', { division: escHtml(DIVISIONS[G.divIdx].label) })}</b>
      ${surDivision
        ? T('fin.descente.division', { rang: posNat, total: classementNational().length, quota: quota })
        : T('fin.descente.simple')}</div>`;
  }

  if (wasPromoted || iAmChampion) jouerJingle('montee');
  else if (wasRelegated) jouerJingle('defaite');
  // On explique l'accession : sans cela, finir premier sans monter serait incompréhensible.
  if (accession) {
    const tickets = ticketsDeLigue(n);
    pushInbox(accession.monte ? 'courrier.accession.decrochee.titre' : 'courrier.accession.phase.titre',
      (accession.rang === null && !aLeTicketDAccession(rank + 1, n))
        ? 'courrier.accession.pasDeTicket'
        : (accession.monte ? 'courrier.accession.gagnee' : 'courrier.accession.perdue'),
      { rang: rank + 1, n: tickets, place: accession.rang, places: ACCESSION_PLACES },
      'board');
  }
  presenterResumeSaison({ rank: rank, n: n, basePrize: basePrize }, {
    title: T('fin.titre', { annees: seasonLabel(G.season) }), ico: '📅',
    html: `${trophyMsg}${barrageMsg || ''}${playdownMsg || ''}${montreeRefusee || ''}${moveMsg}
      <div class="modal-sub">${T('fin.bilanRegulier')}</div>
      <div class="modal-stat"><span>${T('intro.division')}</span><span>${escHtml(div.label)}</span></div>
      <div class="modal-stat"><span>${T('ecran.classement.label')}</span><span>${T('classement.rang', { n: rank + 1 })} ${T('resume.sur', { n: n })}</span></div>
      <div class="modal-stat"><span>${T('resume.prime')}</span><span>${euros(basePrize)}</span></div>`
  });
  evaluateBoardObjective(rank, iAmChampion, n);
  G.lastSeasonRank = rank;

  // archive de la saison écoulée (avant reset des stats individuelles)
  if (!G.history) G.history = [];
  const meForHistory = myTeam();
  const topScorerP = [...meForHistory.players].sort((a, b) => (b.seasonGoals || 0) - (a.seasonGoals || 0))[0];
  G.history.push({
    season: G.season, division: div.label, rank: rank + 1,
    champion: iAmChampion, finalist: iAmFinalist && !iAmChampion,
    promoted: wasPromoted, relegated: wasRelegated,
    topScorer: topScorerP && topScorerP.seasonGoals ? `${topScorerP.nom} (${topScorerP.seasonGoals})` : null
  });

  // vieillissement + évolution de mon équipe (plafonnée par le potentiel caché de chaque joueur)
  const me = myTeam();
  const departs = [];
  const retirees = [];
  me.players.forEach(p => {
    // les stats de la saison qui vient de s'achever rejoignent le total de carrière avant tout départ
    p.careerGoals = (p.careerGoals || 0) + (p.seasonGoals || 0);
    p.careerGames = (p.careerGames || 0) + (p.seasonGames || 0);
    p.age++;
    const isLate = p.lateBloomer && p.age >= 27 && p.age <= 32;
    const growth = isLate ? irnd(1, 4) // révélation tardive : progresse encore alors qu'il devrait décliner
      : p.age < 24 ? irnd(0, 3) : p.age > 30 ? -irnd(0, 3) : irnd(-1, 1);
    const cap = p.potentiel || 97;
    p.tir = Math.round(clampV(p.tir + growth + rnd(-1, 1), 30, cap));
    p.def = Math.round(clampV(p.def + growth + rnd(-1, 1), 30, cap));
    p.vit = Math.round(clampV(p.vit + (p.age > 29 && !isLate ? -irnd(0, 2) : growth), 30, cap));
    if (p.pos === 'G') p.gar = Math.round(clampV(p.gar + growth + rnd(-1, 1), 30, cap));
    p.forme = irnd(85, 100);
    p.moral = Math.round(clampV((p.moral || 70) * 0.6 + 70 * 0.4, 30, 95)); // régression vers une moyenne à l'intersaison
    p.salaire = playerSalary(p);
    if (p.injured) { p.injured = false; p.injuryWeeks = 0; } // convalescence estivale
    p.contractYears = Math.max(0, (p.contractYears || 1) - 1);

    // fin de carrière au niveau national : les joueurs peuvent rester en équipe tant qu'ils le souhaitent
    // jusqu'à 46 ans (48 pour un gardien, qui joue traditionnellement plus longtemps) — au-delà, ils
    // quittent le championnat national pour continuer tranquillement en régionale (non simulée).
    const retireHardCap = p.pos === 'G' ? 48 : 46;
    const retireBase = retireHardCap - 3; // une courte fenêtre de fin de carrière avant le départ obligatoire
    let retireChance = 0;
    if (p.age >= retireHardCap) retireChance = 1;
    else if (p.age >= retireBase) retireChance = (p.age - retireBase + 1) / (retireHardCap - retireBase) * 0.5;
    if (retireChance > 0 && Math.random() < retireChance) retirees.push(p);
    else if (p.contractYears <= 0) departs.push(p);
  });
  // fin de carrière : un message d'adieu qui rappelle le parcours du joueur chez le club
  retirees.forEach(p => {
    me.players = me.players.filter(x => x.id !== p.id);
    const statLine = p.careerGoals > 0
      ? ` Il quitte le club avec ${p.careerGoals} but(s) inscrit(s) en ${p.careerGames} match(s) sous le maillot de ${me.name}.`
      : ' ' + T('fin.quitteClub', { n: p.careerGames, club: me.name });
    pushInbox('courrier.carriere.titre', 'courrier.carriere.corps',
      { nom: p.nom, age: p.age,
        portraitHtml: `<img src="${portraitFor(p.id)}" class="portrait-thumb sm" alt="">`,
        statsHtml: statLine }, 'contrat');
  });
  // Pôle Espoir : forme régulièrement de jeunes recrues qui rejoignent directement l'effectif —
  // compense en partie les départs à la retraite. Le niveau détermine clairement leur qualité de
  // base ET leur potentiel : un pôle niveau 10 forme des pépites, un niveau 1 des espoirs modestes.
  if (G.club.pole > 0) {
    const poleLvl = G.club.pole;
    const nProspects = (Math.random() < clampV(0.25 + poleLvl * 0.06, 0, 0.9) ? 1 : 0)
      + (poleLvl >= 6 && Math.random() < (poleLvl - 5) * 0.08 ? 1 : 0);
    for (let i = 0; i < nProspects; i++) {
      const pos = ['G', 'D', 'D', 'A', 'A'][irnd(0, 4)];
      // Avant : 34 + niveau × 3,4, soit 37 au niveau 1 et 45 au niveau 3 — en dessous de
      // l'effectif que ces jeunes rejoignaient. Le pôle creusait le retard qu'il devait
      // combler. Désormais un pôle niveau 3 sort des joueurs au niveau de la N3.
      const baseQuality = clampV(40 + poleLvl * 3.8, 40, 82); // niveau 1 ≈ 44, niveau 10 ≈ 78
      const prospect = makePlayer(pos, baseQuality);
      prospect.age = irnd(16, 18); // toujours un jeune tout juste sorti du pôle
      // un espoir formé au club a une marge de progression supérieure à un joueur recruté ailleurs,
      // et cette marge grandit nettement avec le niveau du pôle
      const potentielBonus = irnd(2, 6) + poleLvl * 1.6;
      prospect.potentiel = Math.round(clampV(prospect.potentiel + potentielBonus, 45, 99));
      prospect.contractYears = irnd(3, 5); // premier contrat pro, plus long
      prospect.salaire = playerSalary(prospect);
      me.players.push(prospect);
      pushInbox('courrier.espoir.titre', 'courrier.espoir.corps',
        { nom: prospect.nom, age: prospect.age, poste: prospect.pos,
          portraitHtml: `<img src="${portraitFor(prospect.id)}" class="portrait-thumb sm" alt="">` },
        'contrat');
    }
  }
  // fin de contrat : renouvellement automatique si le joueur est content (moral correct), sinon il part libre
  departs.forEach(p => {
    if (p.moral >= 55 && Math.random() < 0.75) {
      p.contractYears = irnd(2, 4);
      pushInbox('courrier.prolongation.titre', 'courrier.prolongation.corps',
        { nom: p.nom, n: p.contractYears,
          portraitHtml: `<img src="${portraitFor(p.id)}" class="portrait-thumb sm" alt="">` },
        'contrat');
    } else {
      me.players = me.players.filter(x => x.id !== p.id);
      pushInbox('courrier.finContrat.titre', 'courrier.finContrat.corps',
        { nom: p.nom,
          portraitHtml: `<img src="${portraitFor(p.id)}" class="portrait-thumb sm" alt="">` },
        'contrat');
    }
  });
  if (me.players.filter(p => p.pos === 'G').length < 1 || me.players.filter(p => p.pos !== 'G').length < 8) {
    // sécurité : jamais sous l'effectif minimum viable après des départs
    while (me.players.filter(p => p.pos === 'G').length < 2) me.players.push(makePlayer('G', DIVISIONS[G.divIdx].qual[0]));
    while (me.players.filter(p => p.pos !== 'G').length < 12) me.players.push(makePlayer(Math.random() < 0.5 ? 'D' : 'A', DIVISIONS[G.divIdx].qual[0]));
  }

  // nouvelle division : on reconstruit les 7 autres clubs (leur historique n'est pas conservé),
  // le club du joueur (effectif, staff, finances, infrastructure) est intégralement conservé
  const newDiv = DIVISIONS[G.divIdx];
  const others = newDiv.teams.filter(t => !t.human).slice(0, newDiv.teams.length - 1).map((def, idx) => makeTeam(def, idx + 1, newDiv.qual));
  simulateAITransferWindow(others);
  me.id = 0; me.pts = me.v = me.vp = me.dp = me.n = me.d = me.bp = me.bc = 0;
  others.forEach((t, i) => { t.id = i + 1; });
  installerPoules(G.divIdx, [me, ...others]);
  G.day = 0;
  G.season++;
  G.lastReport = null;
  G.lastFinance = null;
  G.lastInjuries = [];
  G.playoff = null;
  G.upgradesThisSeason = 0; // nouveau quota de chantiers pour la saison qui commence
  noterDebutSaison();        // point de départ du résumé de la saison qui s'ouvre
  evaluatePlayerObjectives();
  me.players.forEach(p => { p.seasonGoals = 0; p.seasonGames = 0; p.seasonPenalties = 0; });
  // retour des joueurs prêtés, avec un peu de développement grâce au temps de jeu ailleurs
  if (G.loanedOut && G.loanedOut.length) {
    G.loanedOut.forEach(p => {
      const cap = p.potentiel || 97;
      const stat = p.pos === 'G' ? 'gar' : Math.random() < 0.5 ? 'tir' : 'def';
      p[stat] = Math.round(clampV(p[stat] + irnd(0, 2), 30, cap));
      p.forme = irnd(80, 100);
      me.players.push(p);
      pushInbox('courrier.retourPret.titre', 'courrier.retourPret.corps',
        { nom: p.nom }, 'transfert');
    });
    G.loanedOut = [];
  }
  assignBoardObjective();
  // le marché des coachs se renouvelle chaque saison, avec un niveau adapté à la division actuelle
  G.market = fillMarket();
  G.scoutPool = buildScoutPool();
  me.tactic = G.tactic;
  assignPlayerObjectives();
  autoLineup(me);
  renderAll();
  checkUnlockNotifications();
}

// Points marqués par `equipe` dans ses seules rencontres contre `adversaires`.
// Art. 11.3.2.1 B : à égalité de points, on départage d'abord sur les confrontations
// directes — pas sur la différence de buts générale, comme le faisait le jeu.
function pointsEntre(equipe, adversaires) {
  const ids = new Set(adversaires.map(t => t.id));
  let pts = 0;
  (G.schedule || []).forEach(journee => journee.forEach(m => {
    if (!m.score) return;
    const dom = G.teams[m.home], ext = G.teams[m.away];
    if (!dom || !ext) return;
    const moiDom = dom === equipe, moiExt = ext === equipe;
    if (!moiDom && !moiExt) return;
    const autre = moiDom ? ext : dom;
    if (!ids.has(autre.id)) return;
    const mes = moiDom ? m.score[0] : m.score[1];
    const siens = moiDom ? m.score[1] : m.score[0];
    if (mes > siens) pts += m.ot ? 2 : 3;
    else if (mes < siens && m.ot) pts += 1;
  }));
  return pts;
}

// Classement national : toutes les poules de la division, triées ensemble. Sert à
// l'affichage et, plus tard, aux croisements de phase finale — la FFRS établit bien un
// classement final unique par division (art. 4.6, 3.7, 2.9).
// Nombre de descendants par division, quand elle se joue en plusieurs poules.
// N3 : 8 sur 64 (art. 4.7 C). N2 : 4 sur 32 (art. 3.8 C).
// La N1 et l'Élite n'y figurent pas : leurs descentes se décident par un match — play-down
// (art. 2.8) et barrage (art. 1.8.2) — et non par un classement.
const DESCENTES_DIVISION = { 2: 8, 3: 4 };

// Le club est-il en position de descendre ? Sur le classement de division si elle compte
// plusieurs poules, sur celui de la poule sinon. Être dernier de sa poule ne condamne donc
// plus : encore faut-il l'être à l'échelle de la division.
function estRelegable(rangPoule, taillePoule) {
  const quota = DESCENTES_DIVISION[G.divIdx];
  if (quota && G.poules && G.poules.length > 1) {
    const cl = classementNational();
    const pos = cl.findIndex(e => e.t === myTeam());
    return pos >= 0 && pos >= cl.length - quota;
  }
  return rangPoule >= taillePoule - 2;
}

function classementNational() {
  const toutes = [];
  (G.poules || [G.teams]).forEach((p, k) => p.forEach(t => toutes.push({ t, poule: k })));
  return toutes.sort((a, b) =>
    b.t.pts - a.t.pts || (b.t.bp - b.t.bc) - (a.t.bp - a.t.bc) || b.t.bp - a.t.bp);
}

function sortedTeams() {
  const base = [...G.teams].sort((a, b) =>
    b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp);
  // On ne réordonne que l'intérieur des groupes à égalité de points : le reste du
  // classement est déjà juste, et un tri global sur les confrontations directes n'aurait
  // pas de sens entre équipes qui ne sont pas à égalité.
  const sortie = [];
  let i = 0;
  while (i < base.length) {
    let j = i;
    while (j + 1 < base.length && base[j + 1].pts === base[i].pts) j++;
    const groupe = base.slice(i, j + 1);
    if (groupe.length > 1) {
      groupe.sort((a, b) =>
        pointsEntre(b, groupe) - pointsEntre(a, groupe) ||
        (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp);
    }
    sortie.push(...groupe);
    i = j + 1;
  }
  return sortie;
}

// Témoin de chargement, lu par verifierPieces() en fin d'amorçage.
if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.phases = true;

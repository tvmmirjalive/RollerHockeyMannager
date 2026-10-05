// phases-finales.js — tout ce qui décide de la montée et de la descente.
//
// Sorti d'index.html au découpage (voir 4-outils/patch-decouper-phases-finales.py). Objectif
// déclaré par Mirja : pouvoir améliorer la simulation plus tard sans casser le reste.
//
// CE QU'IL Y A DEDANS
//   · les PLATEAUX, format fédéral des phases finales (Règlement particulier art. 4.5.1 B) :
//     quatre équipes, chacune rencontre les trois autres, nuls autorisés, barème 3/1/0 ;
//   · la PHASE D'ACCESSION Pré-Nationale → Nationale 3 (art. 9.3) et ses huit places
//     nationales — jouée au bouton, match par match, depuis la cause É5 ;
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

// Le nom d'un plateau, écrit dans la langue de la LECTURE : il se range en donnée, `{ cle, n, conf }`. Un plateau d'avant
// la v197 porte une chaîne française, qu'on laisse telle quelle (dixième relecture).
function libellePlateau(label) {
  if (label && typeof label === 'object' && typeof label.cle === 'string') return T(label.cle, label);
  return String(label || '');
}
// `hote` : l'identifiant du club qui ORGANISE le plateau et y joue chez lui, ou null quand personne ne reçoit — la finale, le tournoi
// d'accession. Un plateau rangé par une version d'avant n'a pas ce champ : voir `hoteDuPlateau` et `reparerHotesPlateaux`.
function makePlateau(ids, label, hote) {
  const table = {};
  ids.forEach(id => { table[id] = { pts: 0, bp: 0, bc: 0, j: 0 }; });
  return { label: label || '', ids: ids.slice(), table: table, duels: {}, matchs: [], fait: false, hote: hote === undefined ? null : hote };
}

// ---- Qui reçoit un plateau (cause W1, décision de Mirja du 3 octobre 2026 : « Suivre le règlement ») ----
// Règlement particulier 2026-2027 : le QUART de finale est confié « à l'équipe de la poule ayant obtenu la meilleure place lors de la
// phase de qualification » (art. 4.5.2 A a en N3, 3.6.2 A a en N2) ; la DEMI-finale à l'une des deux équipes classées 1ères de leur poule
// de quart « si elle n'a pas accueilli un ¼ de finale » (4.5.3 A a, 3.6.3 A a), à défaut à l'une des deux classées 2es (A d) ; la finale
// et le tournoi d'accession se tiennent en un lieu désigné par la Commission (4.5.4 A, 3.6.4 A, 9.3 D) : personne n'y reçoit.

// L'hôte d'un plateau — un identifiant de club DU plateau — ou null. Un champ absent (plateau d'avant) ou qui ne désigne aucun club du
// plateau (fichier importé fabriqué) ne désigne personne : le plateau reste neutre. L'identifiant 0 est un club : jamais `if (hote)`.
function hoteDuPlateau(pl) {
  if (!pl || !Array.isArray(pl.ids) || pl.hote === null || pl.hote === undefined) return null;
  return pl.ids.indexOf(pl.hote) >= 0 ? pl.hote : null;
}

// Où le club joue ses matchs de ce plateau : 'domicile' s'il l'organise, 'deplacement' chez un autre club, 'neutre' sans hôte.
function lieuDuPlateau(pl, moiId) {
  const hote = hoteDuPlateau(pl);
  return hote === null ? 'neutre' : hote === moiId ? 'domicile' : 'deplacement';
}

// Le rang de chaque qualifié à la phase de qualification : son rang dans sa poule, et son ORDRE parmi tous les qualifiés — les premiers
// de poule d'abord, puis les points, la différence, les buts : le même tri que partout. Les équipes portent encore leurs points pendant toute
// la phase finale (elle ne les touche pas). `{ id: { rang, ordre } }`.
function rangsDeQualification() {
  const tri = (a, c) => c.pts - a.pts || (c.bp - c.bc) - (a.bp - a.bc) || c.bp - a.bp;
  const out = {};
  qualifiesAvecRang(G.divIdx).slice().sort((x, y) => x.rang - y.rang || tri(x.t, y.t))
    .forEach((q, i) => { out[q.t.id] = { rang: q.rang, ordre: i }; });
  return out;
}

// L'hôte d'un QUART : le club le mieux classé de la phase de qualification, c'est-à-dire le plus petit rang dans sa poule (le plateau
// réunit un premier, un deuxième, un troisième et un quatrième). `membres` : [{ id, rang }]. null si le plateau est vide.
function hoteDuQuart(membres) {
  const premier = membres.reduce((meilleur, m) => meilleur === null || m.rang < meilleur.rang ? m : meilleur, null);
  return premier === null ? null : premier.id;
}

// L'hôte d'une DEMI-FINALE : un PREMIER de son quart qui n'a pas reçu de quart (4.5.3 A a) ; à défaut, un DEUXIÈME de son quart qui n'a pas
// reçu de quart (A d) ; à défaut personne — la Commission désignerait une salle, le plateau reste neutre. Entre deux candidats l'article dit
// « la plus centrale » : le jeu n'a pas de géographie, il prend le MIEUX CLASSÉ de la phase de qualification — un choix du jeu, écrit.
// `membres` : [{ id, rangQuart (0 = premier de son quart), aRecu, ordre }].
function hoteDeDemiFinale(membres) {
  for (const rangQuart of [0, 1]) {
    const libres = membres.filter(m => m.rangQuart === rangQuart && !m.aRecu);
    if (libres.length) return libres.reduce((meilleur, m) => m.ordre < meilleur.ordre ? m : meilleur).id;
  }
  return null;
}

// Les plateaux d'une partie rangée par une version d'avant n'ont pas d'hôte. Un QUART l'a calculé d'après la qualification ; une
// demi-finale ou une finale ne peut pas — les quarts ne sont plus là, qui a fini premier et qui a reçu un quart ne se sait plus — et reste
// neutre : null. Appelée par `migrerPartie`, jamais pendant le jeu. Idempotente : un plateau qui porte le champ n'est pas touché.
function reparerHotesPlateaux() {
  const po = G && G.playoff;
  if (!po || po.format !== 'plateau' || !Array.isArray(po.plateaux)) return;
  const rangs = po.stage === 'quarts' ? rangsDeQualification() : null;
  po.plateaux.forEach(pl => {
    if (!pl || typeof pl !== 'object' || !Array.isArray(pl.ids) || pl.hote !== undefined) return;
    pl.hote = rangs
      ? hoteDuQuart(pl.ids.filter(id => rangs[id] !== undefined).map(id => ({ id: id, rang: rangs[id].rang })))
      : null;
  });
}

// La phrase qui dit où se joue un plateau, pour une fenêtre : le club l'organise, il se déplace chez l'hôte, ou personne ne reçoit.
function phraseLieuPlateau(pl) {
  if (!pl) return '';
  const hote = hoteDuPlateau(pl);
  if (hote === null) return `<p class="modal-note">${T('playoffs.plateau.lieu.designe')}</p>`;
  if (hote === myTeam().id) return `<p class="modal-note">${T('playoffs.plateau.lieu.recoit')}</p>`;
  const equipe = playoffTeam(hote);
  return `<p class="modal-note">${T('playoffs.plateau.lieu.chez', { hote: escHtml(equipe ? equipe.name : '') })}</p>`;
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
  // Aucun avantage du terrain, même pour l'hôte du plateau : la décision de Mirja (3 octobre 2026, « Suivre le règlement ») porte sur la
  // recette — billetterie, buvette, loges —, pas sur le jeu. Y toucher changerait toute trajectoire du banc ; ce n'est pas tranché.
  return { ga: poisson(butsAttendus(sa.atk, sb.def, false)),
           gb: poisson(butsAttendus(sb.atk, sa.def, false)) };
}

// Une rencontre de plateau que le CLUB joue sans passer par le bouton — résolue d'un bloc — se paie comme celle du bouton : à domicile
// si le plateau est le sien, des frais de route chez un autre hôte, terrain neutre sans hôte (le tournoi d'accession). Les rencontres
// entre AUTRES clubs ne touchent jamais le budget.
function encaisserRencontreResolue(pl, equipeA, equipeB, r) {
  if (!(equipeA && equipeB && (equipeA.human || equipeB.human))) return;
  const lieu = lieuDuPlateau(pl, (equipeA.human ? equipeA : equipeB).id);
  encaisserMatchHorsChampionnat({ home: equipeA, away: equipeB, res: { gH: r.ga, gA: r.gb }, lieu: lieu, neutre: lieu === 'neutre' }, 'phase');
}

// Joue toutes les rencontres non encore disputées. `resoudre(id)` rend l'équipe.
function resolvePlateau(pl, resoudre) {
  const trouve = resoudre || (typeof playoffTeam === 'function' ? playoffTeam : null);
  if (!trouve) return pl;
  for (let i = 0; i < pl.ids.length; i++) {
    for (let k = i + 1; k < pl.ids.length; k++) {
      const idA = pl.ids[i], idB = pl.ids[k];
      if (pl.duels[clePlateauDuel(idA, idB)]) continue;   // déjà joué
      const equipeA = trouve(idA), equipeB = trouve(idB);
      const r = simulerRencontrePlateau(equipeA, equipeB);
      enregistrerRencontrePlateau(pl, idA, idB, r.ga, r.gb);
      // Au bouton, chaque match du club est déjà joué, donc enregistré : cette boucle ne lui en laisse aucun. Elle ne paie que le
      // repli d'`endSeason()` — le chemin du banc —, où le tournoi d'accession se joue d'un bloc.
      encaisserRencontreResolue(pl, equipeA, equipeB, r);
    }
  }
  pl.fait = true;
  return pl;
}

// Les autres rencontres du tour où le club affronte `autre` : un plateau de quatre se joue en trois tours de deux matchs,
// un tournoi de six en cinq tours de trois, le même week-end. Méthode du cercle, le club fixe et ses adversaires dans
// l'ordre du plateau : au tour r, le club affronte le r-ième, et les autres se rencontrent deux à deux — r+1 contre r-1,
// r+2 contre r-2. Sur tous les tours, chacune des rencontres entre adversaires a lieu une fois. Jouées avec le match du
// club, elles rendent son rang VRAI à chaque tour : sans elles, un 1-1 d'ouverture le disait « 1er du tournoi » contre
// des clubs qui n'avaient joué que lui, et il finissait 4e (cause É5) ; un 6-0 le disait « 1er du plateau », et il
// finissait 3e, éliminé (cause R6). Une rencontre déjà jouée ne se rejoue pas ; ce que le cercle ne couvre pas — un
// nombre pair d'adversaires — la résolution du reste le joue. Un plateau que les v195 et v197 ont rangé au milieu des tours
// est rattrapé avant le match suivant du club (`rattraperToursPasses`). `resoudre(id)` rend l'équipe.
function jouerAutresRencontresDuTour(pl, moi, autre, resoudre) {
  const autres = pl.ids.filter(x => x !== moi);
  const r = autres.indexOf(autre), m = autres.length;
  if (r < 0) return;
  for (let k = 1; 2 * k < m; k++) {
    const x = autres[(r + k) % m], y = autres[(r - k + m) % m];
    if (pl_duelJoue(pl, x, y)) continue;
    const s = simulerRencontrePlateau(resoudre(x), resoudre(y));
    enregistrerRencontrePlateau(pl, x, y, s.ga, s.gb);
  }
}

// Un plateau que la v195 (publiée) ou la v197 (installée sur un téléphone de test) a rangé au milieu des tours porte des clubs
// en retard d'un match ou deux sur le club : elles jouaient son match seul, et les rencontres des autres d'un bloc à la fin.
// Avant le match suivant, le tour de chaque adversaire DÉJÀ affronté se rejoue ; `jouerAutresRencontresDuTour` ne joue que ce
// qui manque, donc l'appel ne fait rien à un plateau d'aujourd'hui — pas une rencontre, pas un tirage. Le titre du match se lit
// alors contre des clubs qui ont joué autant que le club (cause R12 : le patch de la cause R6 tenait cette limite pour sans
// objet, « aucune de ces versions n'a été publiée » — la première l'est, la seconde est installée).
function rattraperToursPasses(pl, moi, resoudre) {
  pl.ids.forEach(x => { if (x !== moi && pl_duelJoue(pl, moi, x)) jouerAutresRencontresDuTour(pl, moi, x, resoudre); });
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

// Les adversaires du tournoi portent les identifiants 901 à 923 : loin de tout club du jeu, et le numéro de ligue se lit dans l'identifiant.
const ACCESSION_ID_BASE = 900;

// Le nom et l'abréviation d'un adversaire — « Vainqueur de ligue n », « VLn » —, dans la langue DU MOMENT. Ce n'est pas un nom propre, un
// numéro de ligue : il s'écrit au tirage ET se réécrit quand la langue change (`renommerAdversairesAccession`), par le même chemin.
function nomAdversaireAccession(i) {
  return { name: T('accession.adversaire', { n: i }), short: T('accession.adversaire.court', { n: i }) };
}

// Un adversaire du tournoi, au niveau attendu d'un qualifié de Pré-Nationale : le haut de
// la bande de sa division, puisque ce sont des premiers de ligue. Son nom passe par le dictionnaire — il restait
// « Vainqueur de ligue » sur l'écran anglais. Aucun tirage de plus.
function adversaireAccession(i) {
  const bande = DIVISIONS[1].qual;
  const niveau = rnd(bande[1] - 4, bande[1] + 4);
  const eq = makeTeam(Object.assign(nomAdversaireAccession(i), { force: niveau }), ACCESSION_ID_BASE + i, bande);
  eq.tactic = { style: 'equilibre', pressing: 'moyen' };
  autoLineup(eq);
  return eq;
}

// Les lots des tournois : le club en tête du premier, puis les adversaires dans l'ordre de leur tirage — six par tournoi,
// quatre tournois. Partagé par le repli et le bouton : le club entre toujours dans le premier.
function lotsAccession(pool) {
  const parTournoi = Math.ceil(pool.length / ACCESSION_TOURNOIS);
  const lots = [];
  for (let k = 0; k < ACCESSION_TOURNOIS; k++) {
    const lot = pool.slice(k * parTournoi, (k + 1) * parTournoi);
    if (lot.length) lots.push(lot);
  }
  return lots;
}

// Les places nationales se répartissent entre les tournois, par rang : tous les premiers,
// puis tous les deuxièmes, jusqu'à huit. Rend l'issue telle que le bilan la lit.
function placesAccession(tournois, moiId) {
  const qualifies = [];
  const classements = tournois.map(pl => classerPlateau(pl));
  const profondeur = Math.max.apply(null, classements.map(c => c.length).concat([0]));
  for (let rang = 0; rang < profondeur && qualifies.length < ACCESSION_PLACES; rang++) {
    classements.forEach(c => { if (c[rang] !== undefined && qualifies.length < ACCESSION_PLACES) qualifies.push(c[rang]); });
  }
  const rang = qualifies.indexOf(moiId) + 1;
  return { places: ACCESSION_PLACES, tours: tournois.length, rang: rang > 0 ? rang : null, monte: rang > 0 };
}

// Le tournoi d'accession, D'UN BLOC : le repli d'`endSeason()` — le chemin du banc, et de toute saison fermée sans passer
// par le bouton. Le joueur, lui, le joue match par match (`creerAccession`, `jouerMatchAccession`, cause É5).
// `rangPoule` n'est pas lu : la répartition fédérale des clubs entre les tournois n'est pas simulée, et le club entre
// toujours dans le premier. Rend le détail plutôt qu'un simple booléen : le joueur a droit à savoir de combien il lui a
// manqué.
function jouerAccessionN3(rangPoule) {
  const me = myTeam();
  const participants = [];
  for (let i = 1; i <= ACCESSION_TOURNOIS * ACCESSION_PAR_TOURNOI - 1; i++) participants.push(adversaireAccession(i));

  // Le club rejoint l'un des tournois ; les autres sont résolus pour établir le classement
  // national. Art. 9.3 C : les tournois n'ont pas à désigner un vainqueur, seulement à
  // ordonner — d'où le classement de plateau plutôt qu'une élimination directe.
  const tousLesTournois = [];
  const pool = [me].concat(participants);
  const parId = {};
  pool.forEach(t => { parId[t.id] = t; });
  const lots = lotsAccession(pool);
  for (let k = 0; k < lots.length; k++) {
    const pl = makePlateau(lots[k].map(t => t.id), { cle: 'plateau.accession', n: k + 1 });
    resolvePlateau(pl, id => parId[id]);
    tousLesTournois.push(pl);
  }
  const issue = placesAccession(tousLesTournois, me.id);
  return { places: issue.places, participants: pool, tours: issue.tours, rang: issue.rang, monte: issue.monte };
}

// ---- Le tournoi au bouton (chantier des phases finales, cause É5) ----
// Il se jouait d'un bloc DANS `endSeason()`, au clic « Bilan de la saison ». Il se joue comme les playoffs, match par
// match (décision de Mirja) : « Tournoi d'accession » tire et présente les adversaires, cinq « Match d'accession »
// passent par la visionneuse, « Classement du tournoi » dit la place, et le bilan RELIT l'issue. L'étape vit dans
// `G.playoff.finDeSaison` : `{ type: 'accession', rangPoule, tournois, equipes, issue, vu }`. `equipes` porte les cinq
// adversaires du club, JAMAIS le club : rangé, il deviendrait une copie figée au rechargement. Voir
// 4-outils/patch-accession-au-bouton.py.

// L'étape ouverte : les vingt-trois adversaires tirés comme au repli, les trois tournois sans le club résolus aussitôt —
// seul le sien reste à jouer, et ses cinq adversaires sont rangés avec lui.
function creerAccession(rangPoule) {
  const me = myTeam();
  const adversaires = [];
  for (let i = 1; i <= ACCESSION_TOURNOIS * ACCESSION_PAR_TOURNOI - 1; i++) adversaires.push(adversaireAccession(i));
  const pool = [me].concat(adversaires);
  const parId = {};
  pool.forEach(t => { parId[t.id] = t; });
  const tournois = lotsAccession(pool).map((lot, k) => {
    const pl = makePlateau(lot.map(t => t.id), { cle: 'plateau.accession', n: k + 1 });
    if (lot.indexOf(me) < 0) resolvePlateau(pl, id => parId[id]);
    return pl;
  });
  const miens = tournois[0].ids;
  return { type: 'accession', rangPoule: rangPoule, tournois: tournois,
           equipes: adversaires.filter(t => miens.indexOf(t.id) >= 0), issue: null, vu: false };
}

// Un nom qu'on range se relit (cause E3). Au changement de langue, les adversaires du tournoi EN COURS reprennent le nom de la langue du
// moment : ils sont rangés dans l'étape, sous l'identifiant 900 + n. Le rapport affiché les range aussi — des COPIES de ses deux camps
// après un rechargement, et l'abréviation de chaque ligne de but et de pénalité, une chaîne : on relit les camps adverses par leur
// identifiant, et chaque ligne reprend l'abréviation de SON camp. Jamais de correspondance sur le texte. Aucun tirage.
function renommerAdversairesAccession() {
  const e = G && G.playoff && G.playoff.finDeSaison;
  if (!e || e.type !== 'accession' || !Array.isArray(e.equipes)) return;
  const parId = {};
  e.equipes.forEach(t => {
    const i = t && Number.isInteger(t.id) ? t.id - ACCESSION_ID_BASE : 0;
    if (i < 1 || i >= ACCESSION_TOURNOIS * ACCESSION_PAR_TOURNOI) return;   // 1 à 23 : les adversaires, jamais un autre club
    Object.assign(t, nomAdversaireAccession(i));
    parId[t.id] = t;
  });
  const r = G.lastReport;
  if (!r || !r.res || !r.home || !r.away) return;
  const camps = { home: r.home, away: r.away };
  Object.keys(camps).forEach(c => { const a = parId[camps[c].id]; if (a) Object.assign(camps[c], { name: a.name, short: a.short }); });
  (r.res.scorers || []).concat(r.res.penalties || []).forEach(x => {
    const camp = x && camps[x.side];
    if (camp && parId[camp.id]) x.team = camp.short;
  });
}

// Le tournoi du club, s'il a la forme d'un plateau : le premier des quatre.
function tournoiDuClub(e) {
  const pl = e && Array.isArray(e.tournois) ? e.tournois[0] : null;
  return pl && Array.isArray(pl.ids) && pl.table && typeof pl.table === 'object' && pl.duels && typeof pl.duels === 'object'
    ? pl : null;
}

// Qui est qui dans le tournoi du club : le club, relu à chaque fois, ou l'un de ses adversaires rangés.
function equipeAccession(e, id) {
  const me = myTeam();
  return me && id === me.id ? me : (e.equipes || []).find(t => t && t.id === id);
}

// Les adversaires que le club n'a pas encore rencontrés, dans l'ordre du tournoi.
function adversairesRestantsAccession(e) {
  const pl = tournoiDuClub(e), moi = myTeam().id;
  return pl ? pl.ids.filter(x => x !== moi && !pl_duelJoue(pl, moi, x)) : [];
}

// Combien de matchs le club a joués : le suivant porte le numéro d'après, sur le bouton.
function matchsAccessionJoues(e) {
  const pl = tournoiDuClub(e), moi = myTeam().id;
  return pl ? pl.ids.filter(x => x !== moi && pl_duelJoue(pl, moi, x)).length : 0;
}

// Les deux autres rencontres du tour où le club affronte `autre` : un tournoi de six se joue en cinq tours de trois matchs,
// le même week-end — le cercle est celui des plateaux, `jouerAutresRencontresDuTour`. Ce que le cercle ne couvre pas, une
// étape rangée d'avant, la conclusion le résout.
function jouerAutresMatchsDuTour(e, autre) {
  const pl = tournoiDuClub(e);
  if (pl) jouerAutresRencontresDuTour(pl, myTeam().id, autre, id => equipeAccession(e, id));
}

// Le dernier match du club joué — ses cinq tours sont alors complets —, ou le repli sur un tournoi ouvert : ce qui reste
// du tournoi du club se résout d'un bloc, et les places se lisent. L'issue est rangée AVANT tout rendu, comme celle d'un
// match sec.
function conclureAccession(e) {
  resolvePlateau(tournoiDuClub(e), id => equipeAccession(e, id));
  e.issue = placesAccession(e.tournois, myTeam().id);
  return e;
}

// Un match du club, EN ENTIER — buteurs, pénalités — par la simulation des phases finales, au format d'un plateau :
// terrain neutre, nul permis, jamais de prolongation. Le résultat est enregistré AVANT tout rendu, avec les deux autres
// rencontres du tour ; le dernier match conclut le tournoi. Rend le rapport, titré du tournoi et du rang que le club y
// tient — chacun a alors joué autant que lui.
function jouerMatchAccession(e) {
  const autre = adversairesRestantsAccession(e)[0];
  if (autre === undefined) return null;
  const pl = tournoiDuClub(e), moi = myTeam().id;
  const a = equipeAccession(e, moi), b = equipeAccession(e, autre);
  const res = simulatePlayoffMatch(a, b, { plateau: true });
  enregistrerRencontrePlateau(pl, moi, autre, res.gH, res.gA);
  jouerAutresMatchsDuTour(e, autre);
  if (!adversairesRestantsAccession(e).length) conclureAccession(e);
  const rang = classerPlateau(pl).indexOf(moi) + 1;
  const rapport = { m: { home: moi, away: autre, score: [res.gH, res.gA] }, res: res, home: a, away: b, playoff: true,
                    titreCle: 'rapport.titreAccession', titreParams: { plateau: pl.label, rang: rang }, neutre: true };
  // Terrain neutre : des frais de route, aucune billetterie. Le résultat et son paiement sont rangés ensemble, avant tout rendu.
  rapport.finance = encaisserMatchHorsChampionnat(rapport, 'phase');
  return rapport;
}

// Forfait sous le seuil fédéral : le match compte 0-5, sur tapis vert, sans être joué — comme en plateau (art. 6.1.1 A).
function forfaitAccession(e) {
  const autre = adversairesRestantsAccession(e)[0];
  if (autre === undefined) return;
  const pl = tournoiDuClub(e);
  enregistrerRencontrePlateau(pl, myTeam().id, autre, 0, 5);
  pl.matchs[pl.matchs.length - 1].forfait = true;
  encaisserMatchHorsChampionnat({ forfait: true, neutre: true }, 'phase');
  // Les autres clubs jouent leur tour : le forfait du club n'arrête pas le tournoi.
  jouerAutresMatchsDuTour(e, autre);
  if (!adversairesRestantsAccession(e).length) conclureAccession(e);
}

// Le bouton, pendant le tournoi : un match, ou son forfait sous le seuil — refusé, rien ne bouge. Un tournoi se joue le
// même week-end : aucune séance entre ses matchs, ni après le dernier.
async function jouerEtapeAccession(po, e) {
  if (!etatEffectif(myTeam()).ok) {
    const choix = await confirmerForfaitSiNecessaire('phaseFinale');
    // Pendant la question, la partie a pu changer — un autre emplacement, le menu : on ne touche qu'à l'étape posée.
    if (choix !== 'forfait' || e.issue || G.playoff !== po || po.finDeSaison !== e) return;
    forfaitAccession(e);
    retirerSeances();
    renderAll();
    return;
  }
  // Comme avant une journée : une ligne à trois se complète depuis la réserve.
  preparerLignesAvantMatch();
  G.lastReport = jouerMatchAccession(e);
  retirerSeances();
  renderAll();
  if (G.lastReport) watchMatch(G.lastReport);
}

// La fenêtre qui ouvre le tournoi : la règle, et les cinq adversaires.
function presenterEtapeAccession(e) {
  const pl = tournoiDuClub(e);
  const regle = T('etape.accession.regle', { tournois: e.tournois.length, parTournoi: pl.ids.length, places: ACCESSION_PLACES,
                                            plateau: escHtml(libellePlateau(pl.label)), matchs: pl.ids.length - 1 });
  notify({ title: T(CLES_FIN_DE_SAISON.accession.titre), picto: 'jouer',
    html: `<p class="modal-text">${regle}</p><div class="modal-sub">${T('etape.adversaires')}</div>`
      + `<ul class="modal-list">${(e.equipes || []).map(t => `<li><span class="nm">${escHtml(t.name)}</span></li>`).join('')}</ul>` });
}

// Le classement du tournoi, son dernier match joué, et la place : décrochée ou échappée. Vu, le bouton passe au bilan. Le
// titre est du TEXTE (`textContent`) : le nom du tournoi n'y est pas échappé — « d'accession » y deviendrait « d&#39; ».
function presenterAccessionTerminee(e) {
  e.vu = true;
  const pl = tournoiDuClub(e), i = e.issue || {};
  const places = i.places || ACCESSION_PLACES;
  const lignes = pl ? lignesClassementPlateau(pl, id => equipeAccession(e, id)) : '';
  const place = i.monte ? T('accession.fin.place', { place: i.rang, places: places }) : T('accession.fin.echappe', { places: places });
  // Sans tournoi à nommer — une issue relue sans ses tournois —, le titre de l'étape : « : le classement » ne disait rien.
  const titre = pl ? T('playoffs.plateau.titre', { plateau: libellePlateau(pl.label) }) : T(CLES_FIN_DE_SAISON.accession.titre);
  notify({ title: titre, picto: 'classement', html: lignes + `<p class="modal-text">${place}</p>` });
}

// Une accession relue, NON JOUÉE, est jouable si ses quatre tournois sont des plateaux, chacun avec la table de ses
// clubs, le club dans le premier, et chacun de ses adversaires rangé, non humain, avec ses joueurs.
function accessionJouable(e) {
  const me = myTeam();
  if (!me || !Array.isArray(e.tournois) || e.tournois.length !== ACCESSION_TOURNOIS) return false;
  const plateaux = e.tournois.every(pl => !!pl && typeof pl === 'object' && Array.isArray(pl.ids) && Array.isArray(pl.matchs)
    && !!pl.duels && typeof pl.duels === 'object' && !!pl.table && typeof pl.table === 'object'
    && pl.ids.every(id => !!pl.table[id] && typeof pl.table[id] === 'object'));
  if (!plateaux || e.tournois[0].ids.indexOf(me.id) < 0 || !Array.isArray(e.equipes)) return false;
  if (!e.equipes.every(t => !!t && typeof t === 'object' && !t.human && Array.isArray(t.players))) return false;
  return e.tournois[0].ids.every(id => id === me.id || e.equipes.some(t => t.id === id));
}

// Les clés de la lettre que la direction écrit à la fin d'une accession : le titre et le corps. Une place nationale se prend
// aussi en finissant 2e de son tournoi, et la salle peut refuser la montée que le tournoi donne — la lettre ne peut donc pas
// se fonder sur `accession.monte` seul : « remporté » était faux pour un second, « Direction la Nationale 3 » pour une salle
// refusée (douzième relecture). Dans l'ordre : pas de ticket, place échappée, place décrochée mais salle refusée, montée.
function cleCourrierAccession(accession, sansTicket, salleRefusee) {
  const neutre = 'courrier.accession.phase.titre';
  if (sansTicket) return { titre: neutre, corps: 'courrier.accession.pasDeTicket' };
  if (!accession.monte) return { titre: neutre, corps: 'courrier.accession.perdue' };
  if (salleRefusee) return { titre: neutre, corps: 'courrier.accession.refusee' };
  return { titre: 'courrier.accession.decrochee.titre', corps: 'courrier.accession.gagnee' };
}

// Une issue d'accession telle que le jeu l'écrit.
function issueAccessionBienFormee(i) {
  return !!i && typeof i === 'object' && typeof i.monte === 'boolean' && (i.rang === null || Number.isInteger(i.rang));
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
      const ids = [], membres = [];
      for (let rang = 0; rang < 4; rang++) {
        // +1 en N3, −1 en N2 : le modulo est écrit avec un « + 4 » pour rester positif.
        const poule = base + (((rang + def.sens * s) % 4 + 4) % 4);
        const eq = parPouleRang[poule + ':' + rang];
        if (eq) { ids.push(eq.id); membres.push({ id: eq.id, rang: rang }); }
      }
      // Le quart est confié au club le mieux classé de la phase de qualification (art. 4.5.2 A a, 3.6.2 A a) : le premier de poule.
      plateaux.push(makePlateau(ids, def.conferences > 1
        ? { cle: 'plateau.quartConf', n: plateaux.length + 1, conf: iConf === 0 ? 'A' : 'B' }
        : { cle: 'plateau.quart', n: plateaux.length + 1 }, hoteDuQuart(membres)));
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
    // Hors des plateaux, plus de match cette saison : plus de séance, et la pastille s'éteint avec elle.
    if (G.playoff.humanOut) retirerSeances();
    renderAll();
    jouerMusique('playoffs');
    notify({
      title: T('playoffs.plateaux.titre'), picto: 'jouer',
      html: `<p class="modal-note">${T('playoffs.plateaux.qualif', { n: seeds.length, plateaux: plateaux.length })}</p>
        <p class="modal-note">${T('playoffs.plateaux.regle')}</p>
        <p class="modal-note">${T('playoffs.plateaux.montee', { montees: defPlateau.montees,
          division: escHtml(DIVISIONS[G.divIdx + 1] ? DIVISIONS[G.divIdx + 1].label : T('playoffs.plateaux.divisionSup')) })}</p>${phraseLieuPlateau(monPlateau())}`
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
  // Hors de toute série construite, le club est hors du tableau dès l'ouverture : le bouton dit « Résultat des playoffs »
  // et non « Jouer le quart », et le clic suivant résout le tableau sans lui (voir 4-outils/patch-non-qualifie-series.py).
  const horsDuTableau = ![...(quarts || []), ...(demis || []), ...(finale || [])].some(humanInSeries);
  G.playoff = { stage, seedRank, quarts, demis, finale, tableDemies, champion: null, finalists: [], humanOut: horsDuTableau, nQual };
  // Plus de match cette saison, plus de séance : la pastille s'éteint avec elle. Un barrage ou un play-down à venir : la
  // séance de la dernière journée reste, comme au qualifié celle d'avant son quart — elle attend ce match-là (cause R4).
  if (horsDuTableau && phaseFinaleFinie()) retirerSeances();
  renderAll();
  const myId = myTeam().id;
  jouerMusique('playoffs');
  notify({
    title: T('playoffs.series.titre'), picto: 'jouer',
    html: `<p class="modal-note">${T('playoffs.series.regle', { n: seeds.length })}</p>
      <div class="modal-sub">${T('playoffs.series.qualifies')}</div>
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
  compterMatchDeSerie(series, res.gH > res.gA ? hostId : guestId);
  return { home: host, away: guest, res, game };
}

// Le vainqueur d'un match de série compte une victoire ; deux font la série. Un seul décompte, match joué ou forfait.
function compterMatchDeSerie(series, gagnantId) {
  if (gagnantId === series.home) series.winsHome++; else series.winsAway++;
  if (series.winsHome === 2) series.winner = series.home;
  else if (series.winsAway === 2) series.winner = series.away;
}

// Un match de série perdu par forfait : 5-0 pour l'adversaire, sur tapis vert, sans match joué — comme au championnat
// (Règlement Sportif FFRS, art. 6.1.1 A).
function forfaitSerie(series) {
  const { hostId, guestId, gameNumber } = seriesNextGame(series);
  const moiHote = !!playoffTeam(hostId).human;
  const res = { gH: moiHote ? 0 : 5, gA: moiHote ? 5 : 0, scorers: [], penalties: [], wentOT: false, forfait: true };
  series.games.push({ home: hostId, away: guestId, res, num: gameNumber });
  compterMatchDeSerie(series, moiHote ? guestId : hostId);
  encaisserMatchHorsChampionnat({ forfait: true }, 'phase');
}

// Plateau où figure le club du joueur, s'il en reste un.
function monPlateau() {
  const po = G.playoff;
  if (!po || !po.plateaux) return null;
  const moi = myTeam().id;
  return po.plateaux.find(pl => pl.ids.indexOf(moi) >= 0) || null;
}

// Fait avancer un tour de plateaux d'un cran : une rencontre du joueur, avec celle des deux autres clubs de son tour, le
// reste d'un bloc.
function avancerPlateaux() {
  const po = G.playoff;
  const mien = monPlateau();
  if (mien && !mien.fait) {
    // Une rencontre à la fois pour le club du joueur, afin qu'il la voie.
    const moi = myTeam().id;
    // Un plateau rangé par la v195 ou la v197 au milieu des tours porte des clubs en retard : ils jouent avant le match du club,
    // pour que son titre se lise contre des clubs qui ont joué autant (cause R12). Rien à faire sur un plateau d'aujourd'hui.
    rattraperToursPasses(mien, moi, playoffTeam);
    let joue = null;
    for (const autre of mien.ids) {
      if (autre === moi) continue;
      if (pl_duelJoue(mien, moi, autre)) continue;
      // Chez qui : l'hôte du plateau reçoit, tous les autres se déplacent — le club est alors le VISITEUR du rapport, que l'hôte soit son
      // adversaire ou un troisième club. Sans hôte (plateau d'avant dont l'hôte n'a pas pu se calculer), l'ordre du plateau décide, comme avant.
      const lieu = lieuDuPlateau(mien, moi), hoteId = hoteDuPlateau(mien);
      const chezMoi = lieu === 'neutre' ? mien.ids.indexOf(moi) < mien.ids.indexOf(autre) : lieu === 'domicile';
      // Sous le seuil fédéral, le forfait se demande, comme au championnat : déclaré, le match compte 0-5 (onzième relecture).
      if (!etatEffectif(myTeam()).ok) {
        confirmerForfaitSiNecessaire('phaseFinale').then(choix => {
          if (choix !== 'forfait' || pl_duelJoue(mien, moi, autre)) return;
          enregistrerRencontrePlateau(mien, moi, autre, 0, 5);
          mien.matchs[mien.matchs.length - 1].forfait = true;
          encaisserMatchHorsChampionnat({ forfait: true, neutre: true }, 'phase');
          // Les autres clubs jouent leur tour : le forfait du club n'arrête pas le plateau, et le rang du match suivant
          // se lit contre des clubs qui ont joué autant que lui.
          jouerAutresRencontresDuTour(mien, moi, autre, playoffTeam);
          if (mien.ids.every(x => x === moi || pl_duelJoue(mien, moi, x))) resolvePlateau(mien, playoffTeam);
          retirerSeances();
          renderAll();
        });
        return;
      }
      const a = playoffTeam(moi), b = playoffTeam(autre);
      const hote = chezMoi ? a : b, visiteur = chezMoi ? b : a;
      // Le match du club se joue EN ENTIER — buteurs, pénalités — puis passe par la visionneuse : ce n'était qu'une carte
      // de score (signalé par Mirja, 27 septembre 2026). Le nul est permis : c'est un plateau.
      // Comme avant une journée : une ligne à trois se complète depuis la réserve (onzième relecture).
      preparerLignesAvantMatch();
      const res = simulatePlayoffMatch(hote, visiteur, { plateau: true });
      const ga = chezMoi ? res.gH : res.gA, gb = chezMoi ? res.gA : res.gH;
      enregistrerRencontrePlateau(mien, moi, autre, ga, gb);
      // Le tour des deux autres clubs se joue avec le match du club : le rang du titre se lit contre des clubs qui ont joué
      // autant que lui. Il se calculait avant leur rencontre — « 1er du plateau » d'un 6-0, puis le club finissait 3e,
      // éliminé (cause R6). Les rencontres de l'accession sont jouées de même (`jouerAutresMatchsDuTour`).
      jouerAutresRencontresDuTour(mien, moi, autre, playoffTeam);
      joue = { adverse: autre, hote: hote, visiteur: visiteur, res: res, lieu: lieu, hoteId: hoteId };
      break;
    }
    if (joue) {
      const cl = classerPlateau(mien);
      const rang = cl.indexOf(moi) + 1;
      // `lieu` : ce que le club paie. `neutre` : ni l'un ni l'autre des deux clubs de CE match ne reçoit — le plateau n'a pas d'hôte, ou son
      // hôte est un troisième club — et le coup d'envoi du direct le dit. Le titre dit chez qui se joue le plateau.
      G.lastReport = { m: { home: joue.hote.id, away: joue.visiteur.id, score: [joue.res.gH, joue.res.gA] },
        res: joue.res, home: joue.hote, away: joue.visiteur, playoff: true,
        titreCle: joue.hoteId === null ? 'rapport.titrePlateau' : 'rapport.titrePlateauChez',
        titreParams: joue.hoteId === null ? { plateau: mien.label, rang: rang }
          : { plateau: mien.label, rang: rang, hote: playoffTeam(joue.hoteId).name },
        neutre: joue.lieu === 'neutre' || (joue.lieu === 'deplacement' && joue.hoteId !== joue.adverse), lieu: joue.lieu };
      // Chaque match du plateau se paie comme au championnat : à domicile, billetterie comprise, si le club l'organise ; des frais de route
      // sinon.
      G.lastReport.finance = encaisserMatchHorsChampionnat(G.lastReport, 'phase');
      if (mien.ids.every(x => x === moi || pl_duelJoue(mien, moi, x))) resolvePlateau(mien, playoffTeam);
      // Un plateau se joue le même jour ou le même week-end : aucune séance entre ses matchs, pas même celle qui restait
      // d'avant le plateau (signalé par Mirja, 27 septembre 2026). La séance d'entre deux matchs vaut pour les séries.
      retirerSeances();
      renderAll(); watchMatch(G.lastReport);
      return;
    }
  }
  // Plus rien à jouer pour le joueur : on résout tout le tour et on enchaîne — et on MONTRE son plateau, qui se résolvait
  // sans un mot sous « Jouer le quart de finale » (signalé par Mirja, 27 septembre 2026).
  const fini = mien;
  po.plateaux.forEach(pl => { if (!pl.fait) resolvePlateau(pl, playoffTeam); });
  buildNextRoundPlateau();
  // Qualifié pour le plateau suivant : il se joue un autre week-end, une séance l'attend. Éliminé, ou le tournoi final
  // joué : plus aucune.
  if (!po.humanOut && monPlateau()) donnerSeanceAvantMatch(); else retirerSeances();
  renderAll();
  if (fini) presenterPlateauTermine(fini);
}

// Une séance d'entraînement avant le match suivant d'une SÉRIE, ou avant un nouveau plateau : seul `playDay` en ouvrait, et
// toute la phase finale n'en comptait qu'une (27 septembre 2026). Jamais entre deux matchs d'un même plateau.
function donnerSeanceAvantMatch() {
  G.seancesRestantes = Math.max(G.seancesRestantes || 0, 1);
  G.trainingAvailable = true;
  // La pastille le dit, comme après une journée — si un coach peut la mener (onzième relecture).
  if (aUnCoachDeSeance()) { G.tabNotify = G.tabNotify || {}; G.tabNotify.entrainement = true; }
}

// Plus de séance : un plateau commencé, ou la phase finale finie pour le club. La pastille s'éteint avec elle — allumée
// à la dernière journée, elle promettait une séance que le jeu refuse (onzième relecture).
function retirerSeances() {
  G.seancesRestantes = 0;
  G.trainingAvailable = false;
  if (G.tabNotify) G.tabNotify.entrainement = false;
}

// La phase finale est finie pour le club : éliminé, ou le dernier tour joué — et aucun barrage, play-down ni tournoi
// d'accession ne l'attend (causes É4 et É5). Il n'a plus de match cette saison. Le tableau fini, l'étape se lit dans l'état
// du bouton. Éliminé AVANT — hors du tableau dès l'ouverture, ou battu avant la finale —, elle se lit déjà dans le
// classement du championnat : `etapeFinDeSaison()` attend la fin du tableau, et l'écran Entraînement disait « plus de
// match » jusqu'au « Résultat des playoffs », séance retirée (cause R4). Le seul cas qui attend le tableau, le finaliste
// battu de N1, n'est jamais éliminé avant la finale.
function phaseFinaleFinie() {
  const po = G.playoff;
  if (!po || !(po.stage === 'done' || po.humanOut)) return false;
  return po.stage === 'done' ? !finDeSaisonAJouer() : !definirFinDeSaison();
}

// Le plateau du club est commencé : ses matchs se jouent le même week-end, sans séance entre eux. Il le reste jusqu'au
// tirage du tour suivant — son dernier match joué, les autres plateaux se résolvent au clic d'après.
function plateauEnCours() {
  const po = G.playoff;
  // Le tournoi d'accession est un plateau : commencé et pas fini, il se joue sans séance (cause É5). Testé AVANT le
  // garde du format — la Pré-Nationale joue ses playoffs en séries.
  const e = po && po.stage === 'done' ? po.finDeSaison : null;
  if (e && e.type === 'accession') return !e.issue && matchsAccessionJoues(e) > 0;
  if (!po || po.format !== 'plateau' || po.stage === 'done') return false;
  const mien = monPlateau(), moi = myTeam().id;
  return !!mien && mien.ids.some(x => x !== moi && pl_duelJoue(mien, moi, x));
}

// Les lignes d'un classement de plateau, pour une fenêtre : le rang, le nom — le club en gras —, les points. `trouve(id)`
// rend l'équipe ; un nom introuvable reste vide, jamais une levée. Partagé par les plateaux et le tournoi d'accession.
function lignesClassementPlateau(pl, trouve) {
  const moi = myTeam().id;
  return classerPlateau(pl).map((id, i) => {
    const nom = escHtml((trouve(id) || {}).name || ''), t = pl.table[id] || { pts: 0 };
    return `<div class="modal-stat"><span>${T('classement.rang', { n: i + 1 })} ${id === moi ? '<b>' + nom + '</b>' : nom}</span>`
      + `<span>${T('classement.points', { n: t.pts })}</span></div>`;
  }).join('');
}

// Le classement du plateau que le club vient de finir, et ce qui en découle.
function presenterPlateauTermine(pl) {
  const po = G.playoff;
  const lignes = lignesClassementPlateau(pl, playoffTeam);
  const champion = po.stage === 'done' && po.champion !== null && po.champion !== undefined ? playoffTeam(po.champion) : null;
  const issue = po.stage === 'done'
    ? (champion ? `<p class="modal-text">${T('playoffs.fin.champion', { nom: escHtml(champion.name) })}</p>` : '') + `<p class="modal-note">${T('playoffs.fin.suite')}</p>`
    : `<p class="modal-note">${T(monPlateau() ? 'playoffs.plateau.qualifie' : 'playoffs.plateau.elimine')}</p>` + phraseLieuPlateau(monPlateau());
  notify({ title: T('playoffs.plateau.titre', { plateau: escHtml(libellePlateau(pl.label)) }), picto: 'classement', html: lignes + issue });
}

// La fin des playoffs, dite : éliminé, le club voyait le reste se résoudre en silence, et le même bouton lançait la saison
// suivante au clic d'après. Le bouton devient « Bilan de la saison » ; c'est lui, et lui seul, qui ferme la saison.
function presenterFinDesPlayoffs() {
  const po = G.playoff;
  const champion = po && po.champion !== null && po.champion !== undefined ? playoffTeam(po.champion) : null;
  notify({ title: T('playoffs.fin.titre'), picto: 'coupe',
    html: (champion ? `<p class="modal-text">${T('playoffs.fin.champion', { nom: escHtml(champion.name) })}</p>` : '')
      + `<p class="modal-note">${suiteApresPlayoffs()}</p>` });
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
    // Qui a reçu un quart, et le rang de chacun à la qualification : relus AVANT que les quarts soient remplacés par les demi-finales.
    const hotesQuarts = po.plateaux.map(pl => hoteDuPlateau(pl));
    const rangs = rangsDeQualification();
    po.plateaux = [];
    for (let g = 0; g < classes.length; g += 4) {
      const groupe = classes.slice(g, g + 4);
      if (groupe.length < 4) break;
      [0, 1].forEach(decalage => {
        // Le membre venu du quart i est son premier ou son deuxième (rangQuart 0 ou 1) : l'ordre des identifiants est celui d'avant.
        const membres = [];
        groupe.forEach((cl, i) => {
          const rangQuart = (i + decalage) % 2, id = cl[rangQuart];
          if (id === undefined) return;
          membres.push({ id: id, rangQuart: rangQuart, aRecu: hotesQuarts[g + i] === id, ordre: rangs[id] ? rangs[id].ordre : Infinity });
        });
        po.plateaux.push(makePlateau(membres.map(m => m.id), { cle: 'plateau.demi', n: po.plateaux.length + 1 }, hoteDeDemiFinale(membres)));
      });
    }
    po.stage = 'demis';
  } else if (po.stage === 'demis') {
    const finalistes = [];
    po.plateaux.forEach(pl => classerPlateau(pl).slice(0, def.passeDemies).forEach(id => finalistes.push(id)));
    // La finale se tient en un lieu désigné par la Commission (art. 4.5.4 A, 3.6.4 A) : aucun hôte.
    po.plateaux = [makePlateau(finalistes, { cle: 'plateau.final' }, null)];
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

// ---- Le titre du rapport d'un match de série (cause D1) ----
// Une donnée rangée dans la sauvegarde, composée à la LECTURE : la langue du jour, jamais celle de l'écriture. Tout est vu du CLUB,
// parce que le club n'est pas la tête de la série — `series.home` est le mieux classé, qui reçoit l'aller, et c'est souvent l'adversaire.
const CLE_TITRE_SERIE = 'rapport.titreSerie';

// Ce que le titre doit dire : les victoires de chacun, et — la série finie — qui l'a gagnée. L'issue se juge sur `=== null` : un
// identifiant n'est pas une valeur de vérité, et celui du club peut être 0 (« (série remportée) » ne s'écrivait alors jamais).
function donneesTitreSerie(series, numeroDuMatch) {
  const chezNous = !!playoffTeam(series.home).human;
  const moi = playoffTeam(chezNous ? series.home : series.away);
  const eux = playoffTeam(chezNous ? series.away : series.home);
  return {
    serie: series.label, n: numeroDuMatch, nomMoi: moi.name, nomEux: eux.name,
    moi: chezNous ? series.winsHome : series.winsAway, eux: chezNous ? series.winsAway : series.winsHome,
    issue: series.winner === null ? null : series.winner === moi.id ? 'gagnee' : 'perdue'
  };
}

// Le score, dit par celui qui mène — ses victoires d'abord —, ou par une formule d'égalité : au meilleur des trois, 1-1 est le seul
// score à égalité, et « mène 1-1 » était faux.
function phraseScoreSerie(p) {
  if (p.moi === p.eux) return T('playoffs.egalite', { equipe: p.nomMoi, adversaire: p.nomEux, a: p.moi, b: p.eux });
  if (p.moi > p.eux) return T('playoffs.mene', { meneur: p.nomMoi, a: p.moi, b: p.eux, adversaire: p.nomEux });
  return T('playoffs.mene', { meneur: p.nomEux, a: p.eux, b: p.moi, adversaire: p.nomMoi });
}

// Les morceaux du titre, dans la langue du jour ; le squelette est dans le dictionnaire (`rapport.titreSerie`).
function paramsTitreSerie(p) {
  const issue = p.issue === 'gagnee' ? ' ' + T('playoffs.serieRemportee')
    : p.issue === 'perdue' ? ' ' + T('playoffs.seriePerdue') : '';
  return { serie: serieLabel(p.serie), match: T('playoffs.match', { n: p.n }), issue, score: phraseScoreSerie(p) };
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
      retirerSeances();
      G.lastReport = null;
      oublierRapport();
      renderAll();
      presenterFinDesPlayoffs();
      return;
    }
    avancerPlateaux();
    return;
  }

  // équipe déjà éliminée : on ne rejoue plus match par match, tout se résout d'un coup
  if (po.humanOut) {
    autoResolveRestOfPlayoffs();
    // La séance d'avant le barrage, le play-down ou le tournoi d'accession s'est décidée quand le club est sorti du
    // tableau. Ce clic n'est pas un match du club : il n'en rend pas une seconde, sans quoi une séance menée entre la
    // défaite et lui en ouvrirait deux avant le même match (cause R4). Rien ne reste : aucune.
    if (phaseFinaleFinie()) retirerSeances();
    G.lastReport = null;
    oublierRapport();
    renderAll();
    presenterFinDesPlayoffs();
    return;
  }

  const roundArr = currentRound();
  if (!roundArr) return;

  // les séries qui ne concernent pas le joueur se résolvent instantanément en arrière-plan
  roundArr.forEach(s => { if (!humanInSeries(s) && s.winner === null) resolveSeriesFully(s); });

  const humanSeries = roundArr.find(s => humanInSeries(s));
  if (!humanSeries) { po.humanOut = true; autoResolveRestOfPlayoffs(); seanceSelonLaSuite(); renderAll(); presenterFinDesPlayoffs(); return; }

  // Sous le seuil fédéral, la phase finale demande, comme le championnat et la coupe : un club sans joueur de champ valide
  // faisait lever la simulation (onzième relecture).
  if (humanSeries.winner === null && !etatEffectif(myTeam()).ok) {
    confirmerForfaitSiNecessaire('phaseFinale').then(choix => {
      if (choix !== 'forfait' || humanSeries.winner !== null) return;
      forfaitSerie(humanSeries);
      if (humanSeries.winner !== null && humanSeries.winner !== myTeam().id) po.humanOut = true;
      if (roundArr.every(s => s.winner !== null)) buildNextRound();
      if (phaseFinaleFinie()) retirerSeances(); else donnerSeanceAvantMatch();
      renderAll();
    });
    return;
  }

  if (humanSeries.winner === null) {
    // Comme avant une journée : une ligne à trois se complète depuis la réserve (onzième relecture).
    preparerLignesAvantMatch();
    const { home, away, res, game } = runSeriesGame(humanSeries);
    // Une DONNÉE, pas une phrase : le titre se compose à la lecture, dans la langue du jour (`titreRapport`, cause D1).
    G.lastReport = {
      m: game, res, home, away, playoff: true,
      titreCle: CLE_TITRE_SERIE, titreParams: donneesTitreSerie(humanSeries, game.num)
    };
    // L'aller et l'appui se jouent chez le mieux classé, le retour chez l'autre : à domicile billetterie, buvette et loges, à l'extérieur
    // les frais de route. Les séries des AUTRES clubs, résolues plus haut, ne touchent pas le budget.
    G.lastReport.finance = encaisserMatchHorsChampionnat(G.lastReport, 'phase');
    if (humanSeries.winner !== null && humanSeries.winner !== myTeam().id) po.humanOut = true;

    // le tour est peut-être déjà complet (les autres séries étaient déjà résolues) : on enchaîne tout de suite
    if (roundArr.every(s => s.winner !== null)) buildNextRound();
    // Une séance avant le match suivant, s'il y en a un. Éliminé, ou la finale jouée, plus aucune : elle était offerte
    // sans match à venir, et passait à la saison suivante (onzième relecture).
    if (phaseFinaleFinie()) retirerSeances(); else donnerSeanceAvantMatch();
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

// Le paragraphe des travaux est une DONNÉE, pas une phrase : `{ cle, params }`, que `paramsCourrier` compose dans la langue de la
// LECTURE (cause E1, relecture adverse du 3 octobre 2026). Composé ici, en français et avec `euros()` de la langue du jour, il
// s'affichait en français à l'écran anglais et gardait « €5,200 » après le retour au français. La somme se range brute,
// `{ euros: n }` ; le pluriel de « niveau » suit `n` ; la fin du paragraphe — le prochain chantier, ou le niveau que la division
// ferme encore — est une seconde donnée, imbriquée. Le paramètre qui la porte garde son nom, `detailHtml` : une lettre d'AVANT y
// range la chaîne composée, que la branche `…Html` de `paramsCourrier` laisse passer telle quelle.
function detailTravauxStade(divCible) {
  const req = classeRequise(divCible);
  const manque = req.stade - G.club.stade;
  const cout = upgradeCost('stade');
  const restants = MAX_UPGRADES_PER_SEASON - G.upgradesThisSeason;
  const plafond = infraLevelDivRequirement(G.club.stade + 1);
  const bloqueParDivision = G.divIdx < plafond;
  const suite = bloqueParDivision
    ? { cle: 'stade.detail.ferme', params: { suivant: G.club.stade + 1, plafond: DIVISIONS[plafond].label } }
    : { cle: 'stade.detail.chantier', params: { montant: { euros: cout }, restants: restants, max: MAX_UPGRADES_PER_SEASON } };
  return { cle: 'stade.detail.exige',
           params: { division: DIVISIONS[divCible].label, classe: req.classe, requis: req.stade, niveau: G.club.stade, n: manque,
                     suiteHtml: suite } };
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
  // priorités légitimes et l'assommer de calculs serait contre-productif. Une DONNÉE, comme le détail : la clé du cas — somme
  // prête, rien ne se dégage, ou n saisons d'épargne — et la somme brute, composées à la lecture (cause E1).
  const montant = { euros: cout };
  const chiffrage = refus === 0 ? '' :
    (ans === 0 ? { cle: 'stade.chiffrage.pret', params: { montant: montant } }
     : ans === null ? { cle: 'stade.chiffrage.rien', params: { montant: montant } }
     : { cle: 'stade.chiffrage.epargne', params: { montant: montant, n: ans } });

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
    { rang: rang + 1, detailHtml: detailTravauxStade(suiv),
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
// L'objectif tel qu'une lettre le range : par sa clé, traduite à la lecture ; une sauvegarde d'avant les clés garde son
// libellé en clair.
function objectifPourLettre() {
  const o = G.boardObjective;
  return o && o.key ? { cle: 'objectif.' + o.key } : objectifLabel();
}
function objectifLabel() {
  const o = G.boardObjective;
  if (!o) return '—';
  if (o.key) return T('objectif.' + o.key);
  return o.label || '—';
}

// Pour l'en-tête, où 130 px tronquaient « Viser le milieu de … » sur tous les écrans. Le
// libellé « Objectif » est déjà au-dessus : « Milieu de tableau » suffit. Les sauvegardes
// d'avant les clés (objectif en clair dans `label`) gardent leur texte entier.
function objectifCourt() {
  const o = G.boardObjective;
  if (!o) return '—';
  if (o.key) return T('objectif.' + o.key + '.court');
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
    { division: DIVISIONS[G.divIdx].label, objectif: objectifPourLettre() }, 'board');
  alerterDirectionDebutSaison();
  alerterDirectionEffectif();
}

function evaluateBoardObjective(rank, iAmChampion, n, divJouee) {
  if (!G.boardObjective) return 0;
  let met = false;
  // Sur ce qui a EU LIEU (huitième relecture) : le maintien, c'est ne pas descendre — les descentes se comptent au
  // classement national dès la N3 —, et les playoffs, c'est figurer au tableau. Le rang de poule donnait une prime à un
  // club absent des playoffs, et la retenait à un club resté dans sa division.
  const idxJouee = divJouee ? DIVISIONS.indexOf(divJouee) : -1;
  if (G.boardObjective.key === 'maintien' || G.boardObjective.key === 'maintienDescente') {
    met = idxJouee >= 0 ? G.divIdx >= idxJouee : rank < n - 2;
  }
  else if (G.boardObjective.key === 'milieu') met = rank < Math.floor(n / 2);
  else if (G.boardObjective.key === 'playoffs') {
    const po = G.playoff, moi = myTeam();
    met = !!(po && po.seedRank && moi && po.seedRank[moi.id] !== undefined);
  }
  else if (G.boardObjective.key === 'titre') met = iAmChampion;
  G.boardConfidence = Math.round(clampV((G.boardConfidence ?? 60) + (met ? 10 : -8), 0, 100));
  // La prime de confiance de la direction (décision de Mirja : « les primes de fin de saison sont bien »), au barème de la
  // division JOUÉE. Appelée après la montée ou la descente, la v196 prenait le tarif de la division d'arrivée.
  const bonus = met ? Math.round(1500 * (1 + (divJouee || DIVISIONS[G.divIdx]).prestige)) : 0;
  if (bonus) G.budget += bonus;
  pushInbox(met ? 'courrier.objectif.atteint.titre' : 'courrier.objectif.manque.titre',
    met ? 'courrier.objectif.atteint.corps' : 'courrier.objectif.manque.corps',
    { objectif: objectifPourLettre(), prime: { euros: bonus }, confiance: G.boardConfidence },
    'board');
  return bonus;
}

// LA SUBVENTION DE LA COMMUNE (v197). Versée une fois par saison close — `G.subventionPour` retient la dernière servie —,
// au barème de la division où le club jouera : montée, descente, barrage et accession sont déjà réglés quand endSeason
// l'appelle. Elle ne dépend d'aucun résultat. Rend le montant versé, 0 si la saison était déjà servie.
function verserSubventionCommune(saison) {
  if (G.subventionPour === saison) return 0;
  const montant = SUBVENTION_COMMUNE[G.divIdx] || 0;
  G.subventionPour = saison;
  G.budget += montant;
  pushInbox('courrier.subvention.titre', 'courrier.subvention.corps',
    { montant: { euros: montant }, division: DIVISIONS[G.divIdx].label }, 'club');
  return montant;
}

// ==================== Barrage et play-down, au bouton (chantier des phases finales, cause É4) ====================
// Le barrage Élite/N1 et le play-down de N1 se jouaient DANS `endSeason()`, au clic « Bilan de la saison » : le joueur
// lisait une descente décidée par un match qu'il n'avait ni vu, ni préparé, ni pu refuser sous le seuil fédéral. Ils se
// jouent au bouton, après les playoffs et avant le bilan : « Place au barrage » présente l'adversaire, « Jouer le
// barrage » passe par la visionneuse, et le bilan RELIT l'issue. L'étape vit dans `G.playoff.finDeSaison`, propre à la
// saison : `endSeason()` la remet à null avec le reste. Voir 4-outils/patch-fin-de-saison-au-bouton.py.

// Des fonctions, pas des constantes : `DIVISIONS` est déclaré dans le corps du jeu, chargé APRÈS cette pièce.
function idxElite() { return DIVISIONS.length - 1; }
function idxN1() { return DIVISIONS.length - 2; }

// Les clés de chaque étape, écrites en toutes lettres : une clé composée échapperait à la recherche comme au contrôle de
// parité des dictionnaires.
const CLES_FIN_DE_SAISON = {
  // `seance` : la phrase de l'écran Entraînement qui annonce la séance d'avant l'étape (cause C5).
  barrage: { lancer: 'action.barrage.lancer', jouer: 'action.barrage.jouer', titre: 'rapport.titreBarrage',
             suite: 'playoffs.fin.suite.barrage', seance: 'entrainement.dispoBarrage' },
  playdown: { lancer: 'action.playdown.lancer', jouer: 'action.playdown.jouer', titre: 'rapport.titrePlaydown',
              suite: 'playoffs.fin.suite.playdown', seance: 'entrainement.dispoPlaydown' },
  // Le tournoi d'accession (cause É5) : `titre` est celui de sa fenêtre ; ses matchs ont leur propre titre de rapport.
  accession: { lancer: 'action.accession.lancer', jouer: 'action.accession.jouer', titre: 'etape.accession.titre',
               suite: 'playoffs.fin.suite.accession', classement: 'action.accession.classement',
               seance: 'entrainement.dispoAccession' }
};

// Ce qui attend le club après les playoffs. PURE : ni tirage, ni écriture — le bouton l'appelle à chaque rendu. Les
// conditions sont celles qu'`endSeason()` appliquait (art. 1.8.2, 2.10 A, 2.8 et 9.3), et le barrage passe avant le
// play-down. `null` : rien à jouer.
function definirFinDeSaison() {
  const me = myTeam();
  if (!me) return null;
  const ranking = sortedTeams();
  const rank = ranking.indexOf(me);
  const n = G.teams.length;
  const po = G.playoff;
  const iAmFinalist = !!po && (po.finalists || []).includes(me.id);
  const iAmChampion = !!po && po.champion === me.id;
  const IDX_ELITE = idxElite(), IDX_N1 = idxN1();
  if (G.divIdx === IDX_ELITE && rank === n - 2) {
    // 9e d'Élite : barrage à domicile pour rester dans l'élite, contre le meilleur de N1
    const advDef = [...(DIVISIONS[IDX_N1].teams || [])].sort((a, b) => (b.force || 0) - (a.force || 0))[0];
    if (advDef) return { type: 'barrage', sens: 'maintien', aDomicile: true, advDef: advDef, advDiv: IDX_N1 };
  } else if (G.divIdx === IDX_N1 && po && iAmFinalist && !iAmChampion) {
    // 2e de N1 : barrage à l'extérieur, chez le club de l'Élite le moins fort
    const advDef = [...(DIVISIONS[IDX_ELITE].teams || [])].sort((a, b) => (a.force || 0) - (b.force || 0))[0];
    if (advDef) return { type: 'barrage', sens: 'montee', aDomicile: false, advDef: advDef, advDiv: IDX_ELITE };
  }
  if (G.divIdx === IDX_N1 && n >= 4 && (rank === n - 2 || rank === n - 1)) {
    // Play-down : l'avant-dernier et le dernier de la poule ; le mieux classé reçoit (art. 2.8 D)
    const adverse = ranking[rank === n - 2 ? n - 1 : n - 2];
    if (adverse && adverse !== me) return { type: 'playdown', aDomicile: rank === n - 2, adverseId: adverse.id, rang: rank + 1 };
  }
  // Pré-Nationale : le ticket de ligue ouvre le tournoi d'accession (art. 9.3 B et C, cause É5).
  if (G.divIdx === 1 && aLeTicketDAccession(rank + 1, n)) return { type: 'accession', rangPoule: rank + 1 };
  return null;
}

// L'adversaire du barrage, construit comme `endSeason()` le construisait : identifiant 999, joueurs tirés à sa force. Il
// est tiré UNE fois, à l'ouverture de l'étape, et rangé avec elle : un rechargement retrouve le même club.
function adversaireBarrage(def, div) {
  return makeTeam({ name: def.name, short: def.short, force: def.force }, 999, DIVISIONS[div].qual);
}

// L'étape, rangée dans la phase finale de la saison. Sans phase finale — `endSeason()` appelé directement —, elle n'est
// rangée nulle part : le repli la joue aussitôt.
function creerFinDeSaison(d) {
  const e = d.type === 'accession' ? creerAccession(d.rangPoule)
    : d.type === 'barrage'
    ? { type: 'barrage', sens: d.sens, aDomicile: d.aDomicile, adversaire: adversaireBarrage(d.advDef, d.advDiv), issue: null }
    : { type: 'playdown', aDomicile: d.aDomicile, adverseId: d.adverseId, rang: d.rang, issue: null };
  if (G.playoff) G.playoff.finDeSaison = e;
  return e;
}

// Où en est l'étape, les playoffs finies : 'ouvrir' tant qu'elle n'est pas présentée, 'jouer' tant qu'elle n'a pas
// d'issue, 'classement' tant que le classement du tournoi d'accession, joué, n'a pas été montré, null sinon. Rien avant
// la fin des playoffs : le finaliste de N1 ne se connaît qu'à leur terme.
function etapeFinDeSaison() {
  const po = G.playoff;
  if (!po || po.stage !== 'done') return null;
  const e = po.finDeSaison;
  if (e) return !e.issue ? 'jouer' : (e.type === 'accession' && !e.vu) ? 'classement' : null;
  return definirFinDeSaison() ? 'ouvrir' : null;
}

// Un match reste-t-il au club ? Le classement du tournoi, à montrer, n'en est pas un : plus de séance à offrir.
function finDeSaisonAJouer() {
  const etape = etapeFinDeSaison();
  return etape === 'ouvrir' || etape === 'jouer';
}

// Le libellé du bouton, les playoffs finies : l'étape qui attend, ou le bilan. Un match d'accession dit son numéro.
function libelleApresPhaseFinale() {
  const etape = etapeFinDeSaison();
  const e = G.playoff.finDeSaison;
  if (etape === 'jouer') {
    return e.type === 'accession' ? T(CLES_FIN_DE_SAISON.accession.jouer, { n: matchsAccessionJoues(e) + 1 })
      : T(CLES_FIN_DE_SAISON[e.type].jouer);
  }
  if (etape === 'classement') return T(CLES_FIN_DE_SAISON.accession.classement);
  if (etape === 'ouvrir') return T(CLES_FIN_DE_SAISON[definirFinDeSaison().type].lancer);
  return T('action.bilan');
}

// La phrase de la fenêtre de fin des playoffs : l'étape qui attend le club, ou le bilan.
function suiteApresPlayoffs() {
  const d = etapeFinDeSaison() === 'ouvrir' ? definirFinDeSaison() : null;
  if (!d) return T('playoffs.fin.suite');
  const cles = CLES_FIN_DE_SAISON[d.type];
  return T(cles.suite, { action: escHtml(T(cles.lancer)) });
}

// La phrase de l'écran Entraînement qui annonce la séance, choisie selon le match que le club joue ENSUITE (cause C5). Encore
// au tableau, c'est un match de playoffs. Hors du tableau — « non qualifié » au Classement, ou battu —, ou le tableau fini,
// c'est l'étape de fin de saison : barrage, play-down ou tournoi d'accession. « Le prochain match de la phase finale »
// promettait à ces clubs un match de playoffs qu'ils ne jouent pas. L'étape se lit dans `G.playoff.finDeSaison` quand elle
// est ouverte, sinon dans `definirFinDeSaison()`, qui est PURE. Rend une CLÉ de dictionnaire : le nombre reste un paramètre.
function cleSeanceAvantMatch() {
  const po = G.playoff;
  if (!po || !(po.stage === 'done' || po.humanOut)) return 'entrainement.dispoPhase';
  const etape = po.finDeSaison || definirFinDeSaison();
  const cles = etape ? CLES_FIN_DE_SAISON[etape.type] : null;
  return cles ? cles.seance : 'entrainement.dispoPhase';
}

// Une séance avant le match qui reste — série, barrage, play-down —, aucune s'il n'en reste pas.
function seanceSelonLaSuite() {
  if (phaseFinaleFinie()) retirerSeances(); else donnerSeanceAvantMatch();
}

// Ouvre l'étape : l'adversaire est tiré et rangé. Le rapport affiché — la finale, la dernière journée — appartient aux
// playoffs : il est oublié.
function ouvrirFinDeSaison() {
  const d = definirFinDeSaison();
  if (!d) return null;
  const e = creerFinDeSaison(d);
  G.lastReport = null;
  oublierRapport();
  return e;
}

// L'adversaire de l'étape : rangé pour un barrage, relu dans les poules pour un play-down.
function adversaireFinDeSaison(e) {
  return e.type === 'barrage' ? e.adversaire : playoffTeam(e.adverseId);
}

// La fenêtre qui présente l'étape : ce qui se joue, où, et contre qui.
function presenterEtapeFinDeSaison(e) {
  if (e.type === 'accession') { presenterEtapeAccession(e); return; }
  const adv = adversaireFinDeSaison(e);
  const adversaire = escHtml((adv && adv.name) || '');
  const texte = e.type === 'barrage'
    ? T(e.sens === 'montee' ? 'etape.barrage.montee' : 'etape.barrage.maintien', { adversaire: adversaire })
    : T(e.aDomicile ? 'etape.playdown.recoit' : 'etape.playdown.deplace', { rang: e.rang, adversaire: adversaire });
  notify({ title: T(CLES_FIN_DE_SAISON[e.type].titre), picto: 'jouer', html: `<p class="modal-text">${texte}</p>` });
}

// Le match sec, EN ENTIER — buteurs, pénalités, prolongation — par la simulation des phases finales. L'issue est rangée
// AVANT tout rendu : un rechargement pendant le direct retrouve le match joué, jamais un second tirage. Rend le rapport.
function jouerMatchSec(e) {
  const moi = myTeam(), adv = adversaireFinDeSaison(e);
  const home = e.aDomicile ? moi : adv, away = e.aDomicile ? adv : moi;
  const res = simulatePlayoffMatch(home, away);
  const mes = e.aDomicile ? res.gH : res.gA, siens = e.aDomicile ? res.gA : res.gH;
  e.issue = { mes: mes, siens: siens, ot: !!res.wentOT, gagne: mes > siens };
  const rapport = { m: { home: home.id, away: away.id, score: [res.gH, res.gA] }, res: res, home: home, away: away, playoff: true,
                    titreCle: CLES_FIN_DE_SAISON[e.type].titre };
  // L'issue et son paiement sont rangés ensemble : un rechargement pendant le direct ne rejoue rien, et ne repaie rien. Le repli
  // d'`endSeason()` passe par ici lui aussi — le banc paie son barrage comme le joueur.
  rapport.finance = encaisserMatchHorsChampionnat(rapport, 'phase');
  return rapport;
}

// Forfait sous le seuil fédéral : perdu 5-0 sur tapis vert (art. 6.1.1 A), et ce que le match décidait avec lui.
function forfaitFinDeSaison(e) {
  e.issue = { mes: 0, siens: 5, ot: false, gagne: false, forfait: true };
  encaisserMatchHorsChampionnat({ forfait: true }, 'phase');
}

// Le bouton, les playoffs finies : présenter l'étape, puis la jouer. Sous le seuil, le forfait se demande, comme en
// championnat ; refusé, l'étape reste ouverte, adversaire compris.
async function avancerFinDeSaison() {
  const etape = etapeFinDeSaison();
  if (etape === 'ouvrir') {
    const ouverte = ouvrirFinDeSaison();
    renderAll();
    if (ouverte) presenterEtapeFinDeSaison(ouverte);
    return;
  }
  // Le tournoi d'accession joué : son classement, avant le bilan (cause É5).
  if (etape === 'classement') {
    presenterAccessionTerminee(G.playoff.finDeSaison);
    renderAll();
    return;
  }
  if (etape !== 'jouer') return;
  const po = G.playoff, e = po.finDeSaison;
  // Un match du tournoi : un plateau, pas un match sec — il a son chemin.
  if (e.type === 'accession') { await jouerEtapeAccession(po, e); return; }
  if (!etatEffectif(myTeam()).ok) {
    const choix = await confirmerForfaitSiNecessaire('matchSec');
    // Pendant la question, la partie a pu changer — un autre emplacement, le menu : on ne touche qu'à l'étape posée.
    if (choix !== 'forfait' || e.issue || G.playoff !== po) return;
    forfaitFinDeSaison(e);
    retirerSeances();
    renderAll();
    return;
  }
  // Comme avant une journée : une ligne à trois se complète depuis la réserve.
  preparerLignesAvantMatch();
  G.lastReport = jouerMatchSec(e);
  // Plus de match cette saison : plus de séance.
  retirerSeances();
  renderAll();
  watchMatch(G.lastReport);
}

// LE REPLI D'`endSeason()`. L'issue jouée au bouton est RELUE. Sinon — le banc, une saison fermée sans passer par le
// bouton —, l'étape est créée puis jouée d'un bloc, dans l'ordre des tirages d'avant la cause É4 : l'adversaire, puis le
// match. Sous le seuil, le forfait est déclaré seul : il n'y a personne à qui le demander. Ni préparation des lignes, ni
// fenêtre, ni oubli du rapport : ce sont des gestes du bouton. Rend l'étape jouée, ou null.
// Le tournoi d'accession (cause É5) : jamais ouvert, il se joue d'un bloc par `jouerAccessionN3`, APPELÉE PAR SON NOM —
// les tirages d'avant, le chemin du banc, et celui que des suites remplacent par son issue ; ouvert et pas fini, le reste
// du tournoi du club se résout d'un bloc, ses matchs compris.
function issueFinDeSaison() {
  let e = G.playoff ? G.playoff.finDeSaison : null;
  if (!e) {
    const d = definirFinDeSaison();
    if (!d) return null;
    if (d.type === 'accession') {
      const r = jouerAccessionN3(d.rangPoule);
      e = { type: 'accession', rangPoule: d.rangPoule, issue: { places: r.places, tours: r.tours, rang: r.rang, monte: r.monte }, vu: true };
      if (G.playoff) G.playoff.finDeSaison = e;
      return e;
    }
    e = creerFinDeSaison(d);
  }
  if (!e.issue) {
    if (e.type === 'accession') conclureAccession(e);
    else if (!etatEffectif(myTeam()).ok) forfaitFinDeSaison(e);
    else jouerMatchSec(e);
  }
  return e;
}

// Une issue telle que le jeu l'écrit : celle d'un match sec, ou celle d'un tournoi d'accession.
function issueFinDeSaisonBienFormee(i, type) {
  if (type === 'accession') return issueAccessionBienFormee(i);
  return !!i && typeof i === 'object' && Number.isInteger(i.mes) && Number.isInteger(i.siens) && typeof i.gagne === 'boolean';
}

// Une étape relue d'une sauvegarde. Une étape NON JOUÉE mal formée est retirée — le bouton la rouvrira — : type inconnu,
// valeur qui n'est pas un objet, adversaire absent, humain ou sans joueurs, adversaire de play-down absent de la poule,
// tournoi d'accession qui n'est pas jouable (`accessionJouable`). Une étape dont l'issue est bien formée est gardée telle
// quelle : son match a eu lieu.
function normaliserFinDeSaison() {
  const po = G.playoff;
  if (!po || !Object.prototype.hasOwnProperty.call(po, 'finDeSaison')) return;
  const e = po.finDeSaison;
  const connue = !!e && typeof e === 'object' && !Array.isArray(e) && Object.prototype.hasOwnProperty.call(CLES_FIN_DE_SAISON, e.type);
  if (connue && issueFinDeSaisonBienFormee(e.issue, e.type)) return;
  const jouable = connue && (e.issue === null || e.issue === undefined) && (e.type === 'barrage'
    ? !!e.adversaire && typeof e.adversaire === 'object' && !e.adversaire.human && Array.isArray(e.adversaire.players)
    : e.type === 'accession' ? accessionJouable(e)
    : (G.teams || []).some(t => t && t.id === e.adverseId && !t.human));
  if (!jouable) delete po.finDeSaison;
}

// ==================== Fin de carrière ====================
// Départ obligatoire du championnat national : un CHOIX du jeu — les joueurs restent compétitifs bien plus longtemps qu'ailleurs, puis
// continuent « tranquillement en régionale », qu'on ne simule pas —, et PAS un article du règlement : aucun n'est cité, au contraire des
// plateaux et de l'accession plus haut. Un gardien joue traditionnellement plus longtemps. Deux constantes, et c'est tout : `endSeason` les
// applique, l'aide les reçoit en paramètre (`{ageFinChamp}`, `{ageFinGardien}`) — jamais un âge écrit dans une phrase —, et
// `test-vieillissement.mjs` les lit dans la page pour mesurer ce que le jeu fait de part et d'autre de la limite.
const AGE_FIN_CARRIERE_CHAMP = 46;
const AGE_FIN_CARRIERE_GARDIEN = 48;
// Les années qui précèdent la limite, où le départ devient possible : une chance sur six trois ans avant, une sur trois deux ans avant,
// une sur deux la veille — et la certitude à la limite.
const FENETRE_FIN_CARRIERE = 3;

function endSeason() {
  const ranking = sortedTeams();
  const rank = ranking.indexOf(myTeam());
  const n = G.teams.length;
  const div = DIVISIONS[G.divIdx];
  // La force de la saison JOUÉE, relevée avant tout rattrapage de montée : le résumé la montrait relevée (dixième relecture).
  const forceSaison = Math.round(myTeam().players.reduce((s, p) => s + overall(p), 0) / Math.max(1, myTeam().players.length));
  // Le barrage ou le play-down de la saison : joué au bouton, il est RELU ; sinon — le banc, un appel direct —, il se joue
  // ici, avant toute prime, dans l'ordre des tirages d'avant (voir 4-outils/patch-fin-de-saison-au-bouton.py).
  const fin = issueFinDeSaison();
  // La prime de classement, versée par la direction (décision de Mirja : « les primes de fin de saison sont bien »).
  const basePrize = [3000, 2200, 1600, 1200, 900, 700, 500, 300][Math.min(rank, 7)] * (1 + div.prestige);
  G.budget += basePrize;

  const po = G.playoff;
  const iAmFinalist = po && po.finalists.includes(myTeam().id);
  const iAmChampion = po && po.champion === myTeam().id;
  let trophyMsg = "";
  if (iAmChampion) {
    // La prime de titre, versée par la direction.
    const trophy = 5000 * (1 + div.prestige);
    G.budget += trophy;
    trophyMsg = `<div class="modal-flash good"><b>${pictoHtml('coupe')} ${T('fin.champion', { division: escHtml(div.label) })}</b>${T('fin.primeTitre', { montant: euros(trophy) })}</div>`;
  } else if (iAmFinalist) {
    trophyMsg = `<div class="modal-flash warn"><b>🥈 ${T('fin.finaliste', { division: escHtml(div.label) })}</b>${T('fin.finaliste.note')}</div>`;
  }

  // ---- Barrage Élite/N1 (art. 1.8.2 et 2.10 A) ----
  // Le 9e d'Élite défend sa place contre le 2e de N1, sur le terrain du club de l'Élite.
  // Le champion de N1 monte directement ; le 10e d'Élite descend directement. Seule la
  // place charnière se dispute — c'est là qu'est la tension.
  // Le match s'est joué au bouton avant ce bilan, ou par le repli en tête de fonction : on RELIT son issue, sans rien
  // tirer. Les conditions vivent dans `definirFinDeSaison()`.
  const IDX_ELITE = DIVISIONS.length - 1, IDX_N1 = IDX_ELITE - 1;
  let barrageMsg = null, barrageGagne = null;
  // Ce qui suit le score : un forfait, une prolongation, ou rien.
  const prolFin = fin && fin.issue ? (fin.issue.forfait ? T('fin.parForfait') : fin.issue.ot ? T('fin.apresProlongation') : '') : '';
  if (fin && fin.type === 'barrage' && fin.issue) {
    const b = fin.issue;
    barrageGagne = b.gagne;
    const adversaire = escHtml((fin.adversaire || {}).name || '');
    barrageMsg = fin.sens === 'montee'
      // 2e de N1 : barrage à l'extérieur, chez le club de l'Élite
      ? `<div class="modal-flash ${b.gagne ? 'good' : 'warn'}">
        <b>${b.gagne ? '🎉 ' + T('fin.barrage.montee') : '🥈 ' + T('fin.barrage.maintienN1')}</b>
        ${T('fin.barrage.deplacait', { adversaire: adversaire })}
        ${T('fin.score', { mes: b.mes, ses: b.siens, prol: prolFin })}</div>`
      // 9e d'Élite : barrage à domicile pour rester dans l'élite
      : `<div class="modal-flash ${b.gagne ? 'good' : 'bad'}">
        <b>${b.gagne ? '🛡️ ' + T('fin.barrage.maintien') : '⚠️ ' + T('fin.barrage.descente')}</b>
        ${T('fin.barrage.recevait', { adversaire: adversaire })}
        ${T('fin.score', { mes: b.mes, ses: b.siens, prol: prolFin })}</div>`;
  }

  // ---- Play-down de Nationale 1 (art. 2.8) ----
  // Seule division où l'on joue pour ne pas descendre : le perdant tombe en N2. Le règlement croise les deux poules — 7ᵉ
  // de l'une contre 8ᵉ de l'autre, au meilleur des trois ; le jeu, qui tient pourtant les poules de N1
  // (`DIVISIONS_MULTIPOULES`), joue un match sec entre l'avant-dernier et le dernier de la MÊME poule. Un écart au
  // règlement, écrit ; la mécanique tient : une place de barragiste n'est ni sauve ni perdue.
  let playdownMsg = null, playdownSauve = null;
  if (fin && fin.type === 'playdown' && fin.issue) {
    const b = fin.issue;
    playdownSauve = b.gagne;
    // Le mieux classé a reçu (art. 2.8 D). Un adversaire introuvable laisse un nom vide, jamais une levée.
    const adversaire = escHtml((playoffTeam(fin.adverseId) || {}).name || '');
    playdownMsg = `<div class="modal-flash ${playdownSauve ? 'good' : 'bad'}">
        <b>${playdownSauve ? '🛡️ ' + T('fin.playdown.maintien') : '⚠️ ' + T('fin.playdown.descente')}</b>
        ${T(fin.aDomicile ? 'fin.playdown.recevait' : 'fin.playdown.deplacait', { rang: fin.rang, adversaire: adversaire })}
        ${T('fin.score', { mes: b.mes, ses: b.siens, prol: prolFin })}</div>`;
  }

  // la montée se joue aux playoffs ; en N1 le finaliste doit en plus gagner son barrage
  // Format fédéral : monte qui figure parmi les promus désignés par les demi-finales
  // (art. 4.7 A). Le champion de la saison régulière ne monte plus d'office — le règlement
  // ne le prévoit pas en N3, il faut sortir des plateaux.
  const promusPlateau = (po && G.playoff && G.playoff.format === 'plateau') ? (G.playoff.promus || []) : null;
  // Pré-Nationale : la montée ne s'obtient plus en gagnant sa poule. Il faut un ticket de
  // ligue (art. 9.3 B) puis sortir du tournoi national à huit places (art. 9.3 C). Le tournoi s'est joué au bouton avant
  // ce bilan, ou par le repli en tête de fonction : on RELIT son issue, sans rien tirer (cause É5).
  let accession = null;
  if (G.divIdx === 1) {
    accession = fin && fin.type === 'accession' && fin.issue ? fin.issue : { monte: false, rang: null };
  }
  let promote = accession ? accession.monte
    : promusPlateau
    ? promusPlateau.indexOf(myTeam().id) >= 0
    : rank === 0 || (po ? iAmFinalist : rank < 2); // `let` : une salle non classée peut l'annuler
  // Nationale 1, phase finale jouée : le champion monte, le finaliste s'il gagne son barrage, et personne d'autre. Le 1er
  // de la phase régulière montait même éliminé en quart, quand le même club, finaliste puis battu, restait (onzième
  // relecture).
  if (G.divIdx === IDX_N1 && po) promote = iAmChampion || barrageGagne === true;
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
    // Le chèque de montée et l'apport de trésorerie de la direction, comme avant la v197.
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

  // Où le club jouera la saison prochaine, toujours dit : le bilan se taisait quand il ne bougeait pas (signalé par Mirja,
  // 27 septembre 2026). L'issue est de la DONNÉE, que le premier écran du résumé écrit à son tour. Un barrage ou un
  // play-down disent déjà le maintien ; la règle de la montée ne s'écrit que là où elle est simple et sûre.
  const issue = { sens: wasPromoted ? 'montee' : wasRelegated ? 'descente' : 'reste', divIdx: G.divIdx };
  let resteMsg = '';
  // Un refus de salle dit toujours le maintien : un barrage gagné annonçait la montée, et rien ne la démentait (onzième
  // relecture).
  if (issue.sens === 'reste' && (montreeRefusee || (!barrageMsg && !playdownMsg))) {
    const sup = DIVISIONS[G.divIdx + 1];
    const raison = !sup ? T('fin.resteEn.sommet')
      : montreeRefusee ? ''
      : accession ? T('fin.resteEn.accession', { division: escHtml(sup.label) })
      : promusPlateau ? T('fin.resteEn.plateau', { division: escHtml(sup.label), n: G.playoff.def.montees })
      : '';
    resteMsg = `<div class="modal-flash"><b>${T('fin.resteEn', { division: escHtml(DIVISIONS[G.divIdx].label) })}</b>${raison}</div>`;
  }

  if (wasPromoted || iAmChampion) jouerJingle('montee');
  else if (wasRelegated) jouerJingle('defaite');
  // On explique l'accession : sans cela, finir premier sans monter serait incompréhensible. La lettre dit ce qui est ARRIVÉ au
  // club — la salle refusée comprise, que le bilan vient de dire —, pas seulement ce que le tournoi a décidé.
  if (accession) {
    const sansTicket = accession.rang === null && !aLeTicketDAccession(rank + 1, n);
    const lettre = cleCourrierAccession(accession, sansTicket, !!montreeRefusee);
    const params = { rang: rank + 1, n: ticketsDeLigue(n), place: accession.rang, places: ACCESSION_PLACES };
    // Le club n'a pas changé de division quand la salle refuse la montée : ce sont les mêmes intitulés que ceux du bilan.
    if (montreeRefusee) {
      params.division = DIVISIONS[G.divIdx + 1].label;
      params.actuelle = DIVISIONS[G.divIdx].label;
      params.classe = classeRequise(G.divIdx + 1).classe;
    }
    pushInbox(lettre.titre, lettre.corps, params, 'board');
  }
  // La commune verse sa subvention pour la saison qui s'ouvre (v197).
  const subvention = verserSubventionCommune(G.season);
  // La direction juge l'objectif AVANT le résumé, qui se construit dès l'appel : « Les comptes » affichaient un budget
  // sans la prime d'objectif (huitième relecture).
  const primeObjectif = evaluateBoardObjective(rank, iAmChampion, n, div);
  presenterResumeSaison({ rank: rank, n: n, basePrize: basePrize, subvention: subvention, primeObjectif: primeObjectif, division: div, force: forceSaison, issue: issue }, {
    title: T('fin.titre', { annees: seasonLabel(G.season) }), picto: 'calendrier',
    html: `${trophyMsg}${barrageMsg || ''}${playdownMsg || ''}${montreeRefusee || ''}${moveMsg}${resteMsg}
      <div class="modal-sub">${T('fin.bilanRegulier')}</div>
      <div class="modal-stat"><span>${T('intro.division')}</span><span>${escHtml(div.label)}</span></div>
      <div class="modal-stat"><span>${T('ecran.classement.label')}</span><span>${T('classement.rang', { n: rank + 1 })} ${T('resume.sur', { n: n })}</span></div>
      <div class="modal-stat"><span>${T('resume.prime')}</span><span>${euros(basePrize)}</span></div>
      <div class="modal-stat"><span>${T('resume.subvention')}</span><span>${euros(subvention)}</span></div>`
  });
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
  // retour des joueurs prêtés, avec un peu de développement grâce au temps de jeu ailleurs
  // Il vient AVANT le vieillissement (v184) : placé après, l'année de prêt ne comptait ni en âge
  // ni en contrat, et un joueur prêté chaque saison ne vieillissait jamais. Rentré ici, il suit
  // le chemin de tout le monde, fin de carrière comprise.
  const me = myTeam();
  if (G.loanedOut && G.loanedOut.length) {
    G.loanedOut.forEach(p => {
      const cap = p.potentiel || 97;
      const stat = p.pos === 'G' ? 'gar' : Math.random() < 0.5 ? 'tir' : 'def';
      p[stat] = Math.round(clampV(p[stat] + irnd(0, 2), 30, cap));
      p.forme = irnd(80, 100);
      me.players.push(p);
      attribuerNom(me, p);      // son nom est resté réservé pendant le prêt : il ne change que si une sauvegarde d'avant l'avait laissé pris
      attribuerNumero(me, p);   // son numéro a pu être repris pendant le prêt
      pushInbox('courrier.retourPret.titre', 'courrier.retourPret.corps',
        { nom: p.nom }, 'transfert');
    });
    G.loanedOut = [];
  }
  const departs = [];
  const retirees = [];
  // Les rétablis de l'intersaison : ils retrouvent leur place à l'ouverture de la saison neuve (`rendreLignes`).
  const gueris = [];
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
    if (p.injured) { p.injured = false; p.injuryWeeks = 0; gueris.push(p); } // convalescence estivale
    p.contractYears = Math.max(0, (p.contractYears || 1) - 1);

    // fin de carrière au niveau national : les joueurs peuvent rester en équipe tant qu'ils le souhaitent
    // jusqu'à `AGE_FIN_CARRIERE_CHAMP` ans (`AGE_FIN_CARRIERE_GARDIEN` pour un gardien, qui joue traditionnellement plus longtemps) —
    // au-delà, ils quittent le championnat national pour continuer tranquillement en régionale (non simulée).
    const retireHardCap = p.pos === 'G' ? AGE_FIN_CARRIERE_GARDIEN : AGE_FIN_CARRIERE_CHAMP;
    const retireBase = retireHardCap - FENETRE_FIN_CARRIERE; // une courte fenêtre de fin de carrière avant le départ obligatoire
    let retireChance = 0;
    if (p.age >= retireHardCap) retireChance = 1;
    else if (p.age >= retireBase) retireChance = (p.age - retireBase + 1) / (retireHardCap - retireBase) * 0.5;
    if (retireChance > 0 && Math.random() < retireChance) retirees.push(p);
    else if (p.contractYears <= 0) departs.push(p);
  });
  // fin de carrière : un message d'adieu qui rappelle le parcours du joueur chez le club
  retirees.forEach(p => {
    me.players = me.players.filter(x => x.id !== p.id);
    // Rangée en clé et paramètres, écrite à la lecture : la phrase composée à l'écriture restait en français (dixième
    // relecture).
    const statLine = p.careerGoals > 0
      // Un seul match : sa propre clé, le pluriel de l'autre suit les buts — « 1 but inscrit en 1 matchs » (onzième relecture).
      ? { cle: p.careerGames === 1 ? 'fin.carriere.butsUnMatch' : 'fin.carriere.buts',
          params: { n: p.careerGoals, matchs: p.careerGames, club: me.name } }
      : { cle: 'fin.quitteClub', params: { n: p.careerGames, club: me.name } };
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
      if (effectifPlein()) break;   // pas de jeune de plus quand l'effectif est plein — voir EFFECTIF_MAX
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
      me.players.push(prospect);
      attribuerNom(me, prospect);   // AVANT la lettre, qui le nomme
      attribuerNumero(me, prospect);
      // Le poste se range par la CLÉ de son libellé court, composée à la lecture (ATT, FWD) : le code interne, « A », n'est pas un mot, et
      // la lettre s'écrivait « (17 ans, A) » (cause F1). Une lettre d'avant, qui porte le code seul, se lit par `paramsCourrier`.
      pushInbox('courrier.espoir.titre', 'courrier.espoir.corps',
        { nom: prospect.nom, age: prospect.age, poste: { cle: 'poste.' + prospect.pos + '.court' },
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
    const renfort = (pos) => { const j = makePlayer(pos, DIVISIONS[G.divIdx].qual[0]); me.players.push(j); attribuerNom(me, j); attribuerNumero(me, j); };
    const avant = me.players.length;
    while (me.players.filter(p => p.pos === 'G').length < 2) renfort('G');
    while (me.players.filter(p => p.pos !== 'G').length < 12) renfort(Math.random() < 0.5 ? 'D' : 'A');
    // Et on le DIT : l'effectif changeait sans explication (étude des décisions de l'argent).
    pushInbox('courrier.renforts.titre', 'courrier.renforts.corps', { n: me.players.length - avant }, 'contrat');
  }

  // nouvelle division : on reconstruit les 7 autres clubs (leur historique n'est pas conservé),
  // le club du joueur (effectif, staff, finances, infrastructure) est intégralement conservé
  const newDiv = DIVISIONS[G.divIdx];
  const others = newDiv.teams.filter(t => !t.human).slice(0, newDiv.teams.length - 1).map((def, idx) => makeTeam(def, idx + 1, newDiv.qual));
  simulateAITransferWindow(others);
  me.id = 0; me.pts = me.v = me.vp = me.dp = me.n = me.d = me.bp = me.bc = 0;
  // Sa forme aussi : les autres clubs arrivent neufs, sans pastille ; le sien montrait la fin de la saison passée à côté
  // de leur premier match (signalé par Mirja).
  me.forme5 = [];
  others.forEach((t, i) => { t.id = i + 1; });
  installerPoules(G.divIdx, [me, ...others]);
  // Les repères datés d'une journée sont relatifs à la SAISON, et `G.day` repart de 0 (septième relecture). Une promesse
  // du vestiaire reporte ce qui lui reste de journées sur la saison suivante — elle n'était jamais jugée ; l'écart entre
  // deux événements du club, les repères de la presse et du vestiaire, et le dernier tour de Coupe connu repartent comme
  // dans une partie neuve — les événements s'éteignaient pour de bon, et la pastille de la Coupe aussi.
  me.players.forEach(p => { if (p.engagement) p.engagement.jusqua = Math.max(0, p.engagement.jusqua - G.day); });
  delete G.evenementJournee;
  delete G.presseJournee;
  delete G.vestiaireJournee;
  G.cupKnownUnlockedRound = -1;
  G.day = 0;
  G.season++;
  // Les dates de la saison qui s'ouvre se recalculent à la première lecture — APRÈS que la saison a avancé : garder
  // celles de la saison passée donnait de faux jours de semaine (huitième relecture).
  G.datesJournees = null;
  G.lastReport = null;
  // Le rapport affiché appartient à la saison qui se ferme (v197, seconde relecture) : il restait en tête de la
  // saison neuve.
  oublierRapport();
  G.lastFinance = null;
  G.lastInjuries = [];
  G.playoff = null;
  // La présaison : une séance avant la première journée, comme une partie neuve. La phase finale n'en laisse plus traîner
  // — elle en laissait une, par hasard (onzième relecture).
  G.seancesRestantes = 1;
  G.trainingAvailable = true;
  G.upgradesThisSeason = 0; // nouveau quota de chantiers pour la saison qui commence
  noterDebutSaison();        // point de départ du résumé de la saison qui s'ouvre
  evaluatePlayerObjectives();
  me.players.forEach(p => { p.seasonGoals = 0; p.seasonGames = 0; p.seasonPenalties = 0; });
  // Le filet : les poules viennent d'être reconstruites, des joueurs sont arrivés et partis.
  // Chaque site ci-dessus numérote ce qu'il ajoute ; celui-ci garantit l'invariant même si un
  // site futur l'oublie. Idempotent — sur un effectif sain il ne touche à rien.
  normaliserNumeros();
  assignBoardObjective();
  // le marché des coachs se renouvelle chaque saison, avec un niveau adapté à la division actuelle
  G.market = fillMarket();
  G.scoutPool = buildScoutPool();
  me.tactic = G.tactic;
  assignPlayerObjectives();
  // Les lignes du joueur se RÉPARENT, elles ne se recomposent pas : la composition automatique effaçait la troisième ligne
  // à chaque saison (dixième relecture, le symptôme signalé par Mirja le 27 septembre 2026).
  // Les rétablis de l'intersaison retrouvent d'abord leur place, comme ceux d'une journée : AVANT la réparation, qui prendrait
  // sinon leur ligne pour une ligne à compléter. Seuls ceux restés au club — un gardien parti, rétabli le même jour, aurait
  // reçu la lettre « ton choix garde la cage ». Puis la saison neuve ne retient plus rien : ce que le jeu avait défait
  // décrivait la saison qui se ferme (voir 4-outils/patch-retour-de-blessure-saison.py). La lettre d'une ligne restée
  // incomplète le dit : rien ne la reformera d'elle-même (voir 4-outils/patch-retour-lettre-intersaison.py). Les lettres
  // partent APRÈS la réparation : elle a pu aligner un rétabli que sa ligne n'a pas repris, et sa lettre le disait sur le
  // banc (voir 4-outils/patch-retour-dit-vrai.py).
  const faitsRetour = rendreLignes(gueris.filter(p => me.players.includes(p)));
  reparerComposition(me);
  annoncerRetours(faitsRetour, { intersaison: true });
  me.players.forEach(oublierLigne);
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

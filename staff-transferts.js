// staff-transferts.js — comment un effectif s'améliore.
//
// Sorti d'index.html au découpage (voir 4-outils/patch-decouper-staff.py). Troisième domaine
// isolé après la visionneuse et les phases finales, et pour la même raison : pouvoir le
// faire évoluer sans toucher au reste.
//
// CE QU'IL Y A DEDANS
//   · les huit POSTES du staff, leurs conditions de déblocage, le mercato des coachs ;
//   · l'ENTRAÎNEMENT — la séance hebdomadaire, les progressions, et l'écran qui les montre ;
//   · les TRANSFERTS — achat dans sa division ou dans toute la pyramide, vente, prêt, et la
//     négociation quand un club refuse de vendre.
//
// `renderEntrainement()` part avec eux, délibérément : l'écran et la logique qu'il affiche
// appartiennent au même domaine. Un écran qui vit loin de ce qu'il montre est plus dur à
// faire évoluer, pas plus simple.
//
// CE QU'IL N'Y A PAS
//   `autoLineupIfBroken`, `toggleStarter`, `checkUnlockNotifications` : des utilitaires
//   d'effectif et d'interface que les marqueurs de section avaient réunis ici par voisinage,
//   pas par parenté. Ils restent dans index.html.
//
// POURQUOI CE DÉCOUPAGE EST SÛR
//   Aucun code exécuté au chargement — que des `const` littérales et des déclarations de
//   fonction. Tout ce que ce fichier emprunte (`myTeam`, `T`, `euros`, `pushInbox`,
//   `playerValue`, `DIVISIONS`…) est appelé à l'exécution, jamais à l'analyse.
//
// Chargé par un <script> CLASSIQUE, pas un module ES : ceux-ci sont bloqués par CORS sous
// file://, et le jeu doit pouvoir s'ouvrir par double-clic.
//
// Pièce CRITIQUE : sans elle, l'écran Entraînement ne s'affiche pas et aucun transfert n'est
// possible.

// ---------------- Staff technique / coaching ----------------
// Libellés et descriptions sont sortis de ce tableau : ils vivent sous les clés
// `staff.<poste>.label` et `staff.<poste>.desc`. L'icône et les seuils restent — ils ne se
// traduisent pas.
const ROLES = {
  attaque:      { stat: "tir", icon: "🎯", trains: true, reqDiv: 0, reqCentre: 1 },
  defense:      { stat: "def", icon: "🛡️", trains: true, reqDiv: 0, reqCentre: 1 },
  physique:     { stat: "vit", icon: "⚡", trains: true, reqDiv: 0, reqCentre: 1 },
  gardiens:     { stat: "gar", icon: "🥅", trains: true, reqDiv: 0, reqCentre: 1 },
  discipline:   { stat: "agr", icon: "🧘", trains: true, reqDiv: 2, reqCentre: 1 },
  medecin:      { stat: null, icon: "⚕️", trains: false, reqDiv: 2, reqCentre: 2 },
  recruteur:    { stat: null, icon: "🔎", trains: false, reqDiv: 3, reqCentre: 2 },
  specialistes: { stat: null, icon: "🎯⚡", trains: false, reqDiv: 3, reqCentre: 3 }
};

function roleLabel(role) { return T('staff.' + role + '.label'); }
function roleDesc(role) { return T('staff.' + role + '.desc'); }

function roleUnlocked(role) {
  const def = ROLES[role];
  return G.divIdx >= def.reqDiv && G.club.centre >= def.reqCentre;
}
function roleRequirementText(role) {
  const def = ROLES[role];
  const need = [];
  if (G.divIdx < def.reqDiv) need.push(T('staff.requis.division', { division: DIVISIONS[def.reqDiv].label }));
  if (G.club.centre < def.reqCentre) need.push(T('staff.requis.centre', { n: def.reqCentre }));
  return need.join(', ');
}

// Prénoms propres aux coachs. Les joueurs gardent PRENOMS, exclusivement masculin
// puisque le jeu simule un championnat masculin ; l'encadrement, lui, est mixte dans
// la réalité des clubs français.
const PRENOMS_COACH_H = ["Bernard", "Patrick", "Didier", "Philippe", "Christophe",
  "Laurent", "Éric", "Pascal", "Stéphane", "Frédéric", "Olivier", "Thierry",
  "Karim", "Sébastien", "Nicolas", "Vincent", "David", "Franck"];
const PRENOMS_COACH_F = ["Sylvie", "Nathalie", "Isabelle", "Céline", "Sandrine",
  "Aurélie", "Émilie", "Delphine", "Karine", "Virginie", "Marion", "Élodie"];

// Un peu moins d'une entraîneuse sur trois : c'est aussi la proportion de portraits
// féminins dont on dispose, les deux restent donc cohérents.
const PART_ENTRAINEUSES = 0.3;

let nextCoachId = 1;
function makeCoach() {
  // le niveau des coachs sur le marché suit la division : N3 attire des coachs modestes, l'Élite des pointures
  const div = G ? G.divIdx : 0;
  // divIdx 0 = Régional, et non N3 : l'ancien commentaire était décalé de deux divisions.
  // Les bornes sont plafonnées à 95, la note maximale du barème — `trainCoach()` refuse déjà
  // de former au-delà en annonçant « plafond de compétence », alors que le marché tirait
  // jusqu'à 108 en Élite. Les deux n'étaient pas d'accord.
  const lo = Math.min(95, 52 + div * 6);   // Régional:52  N3:64  Élite:82
  const hi = Math.min(95, 68 + div * 8);   // Régional:68  N3:84  Élite:95
  const femme = Math.random() < PART_ENTRAINEUSES;
  const prenom = pick(femme ? PRENOMS_COACH_F : PRENOMS_COACH_H);
  return { id: nextCoachId++, sexe: femme ? 'F' : 'H',
           nom: prenom + " " + pick(NOMS), note: irnd(lo, hi) };
}
function coachBaseCost(note) {
  // note 55 → ~1 200 € (accessible en N3), 70 → ~5 000 €, 80 → ~9 800 €, 92 → ~19 700 €
  return Math.round((note - 48) * (note - 48) * 13 / 100) * 100;
}
function coachSeverance(c) {
  // indemnité de départ du coach en poste (25 % de sa valeur)
  return Math.round(coachBaseCost(c.note) * 0.25 / 100) * 100;
}
function coachTrainCost(note) {
  // coût pour faire gagner +1 de note : de plus en plus cher à mesure que le coach est bon
  return Math.round((coachBaseCost(note + 1) - coachBaseCost(note)) * 1.6 / 100) * 100 + 300;
}
function fillMarket() {
  const m = {};
  Object.keys(ROLES).forEach(r => { m[r] = [makeCoach(), makeCoach(), makeCoach()]; });
  return m;
}

// Mercato : recruter un coach du marché. S'il y a déjà un coach en poste, il est remplacé et son
// indemnité de départ est ajoutée au coût (pas besoin de le licencier au préalable).
async function hireStaff(role, coachId) {
  if (!roleUnlocked(role)) {
    toast(T('toast.prerequis', { quoi: roleLabel(role), detail: roleRequirementText(role) }));
    return;
  }
  const cand = G.market[role].find(c => c.id === coachId);
  if (!cand) return;
  const current = G.staff[role];
  const hireCost = Math.round(coachBaseCost(cand.note) / 100) * 100;
  const sev = current ? coachSeverance(current) : 0;
  const total = hireCost + sev;
  if (G.budget < total) { toast("Budget insuffisant.", 'bad'); return; }
  const msg = current
    ? `Remplacer ${current.nom} (note ${current.note}) par ${cand.nom} (note ${cand.note}) ?\n\nEmbauche : ${euros(hireCost)}\nIndemnité de départ de ${current.nom} : ${euros(sev)}\nTotal : ${euros(total)}`
    : `Embaucher ${cand.nom} (note ${cand.note}) comme ${ROLES[role].label} pour ${euros(hireCost)} ?`;
  if (!(await ask({ title: current ? "Remplacer le coach" : "Embaucher", ico: '🧢', text: msg,
    okLabel: current ? "Remplacer" : "Embaucher" }))) return;
  G.budget -= total;
  // l'ancien coach retourne sur le marché, le nouveau quitte le marché
  G.market[role] = G.market[role].filter(c => c.id !== coachId);
  if (current) G.market[role].push(current);
  else G.market[role].push(makeCoach());
  G.staff[role] = cand;
  renderAll();
}

async function fireStaff(role) {
  const c = G.staff[role];
  if (!c) return;
  const indemnite = coachSeverance(c);
  if (!(await ask({ title: T('dlg.licencier.titre'), ico: '🧢', danger: true, okLabel: T('dlg.licencier.titre'),
      text: T('dlg.licencier.texte', { nom: c.nom, montant: euros(indemnite) }) }))) return;
  if (G.budget < indemnite) { toast(T('toast.budgetIndemnite'), 'bad'); return; }
  G.budget -= indemnite;
  G.market[role].push(c); // il reste disponible sur le marché
  G.staff[role] = null;
  renderAll();
}

// Formation : payer pour faire monter la note du coach en poste (max 95)
async function trainCoach(role) {
  const c = G.staff[role];
  if (!c) return;
  if (c.note >= 95) { toast(T('toast.coachPlafond'), 'info'); return; }
  const cost = coachTrainCost(c.note);
  if (G.budget < cost) { toast("Budget insuffisant pour cette formation.", 'bad'); return; }
  if (!(await ask({ title: "Formation", ico: '📈', okLabel: "Financer",
    text: `Financer une formation pour ${c.nom} ?\n\nNote ${c.note} → ${c.note + 1} pour ${euros(cost)}.` }))) return;
  G.budget -= cost;
  c.note++;
  renderAll();
}

// Compose une ligne de progression. Accepte les deux formes : les sauvegardes d'avant cette
// version portent déjà des phrases toutes faites, qu'on affiche telles quelles.
function ligneGain(g) {
  if (typeof g === 'string') return g;
  const libelle = g.stat === 'agr' ? T('stat.agr') : T('stat.' + g.stat);
  return T('entrainement.gain', { nom: g.nom, signe: g.sens > 0 ? '+1' : '−1',
                                  stat: libelle, valeur: g.valeur });
}

function applyTraining(mode) {
  mode = mode || 'match';
  const me = myTeam();
  const gains = [];
  me.players.forEach(p => {
    Object.entries(ROLES).forEach(([role, def]) => {
      if (!def.trains) return; // spécialistes/recruteur/médecin agissent ailleurs, pas sur la progression des stats
      const coach = G.staff[role];
      if (!coach) return;
      const stat = def.stat;
      if (role === 'gardiens' && p.pos !== 'G') return;
      if ((role === 'attaque' || role === 'defense') && p.pos === 'G') return;
      const ageF = p.age < 23 ? 1.5 : p.age > 30 ? 0.4 : 1;
      // en séance hors match, ce sont les joueurs LAISSÉS AU REPOS (pas titulaires) qui profitent
      // le plus de l'attention du staff : ils ne sont pas fatigués par le match et peuvent se concentrer.
      const playF = mode === 'session' ? (p.starter ? 0.9 : 1.4) : (p.starter ? 1.3 : 1);
      const sessionF = mode === 'session' ? 0.75 : 1; // séance bonus, un peu moins efficace qu'un vrai match
      const centreF = 1 + (G.club.centre - 1) * 0.18;
      // Le seuil était à 50 : un coach noté 50 ou moins n'avait STRICTEMENT aucun effet, tout
      // en étant payé — et le marché en propose dès le Régional (minimum 52). Le plancher
      // descend à 42, si bien qu'un coach modeste fait peu mais fait quelque chose. Le
      // coefficient passe de 0,11 à 0,13 : au maximum du jeu on gagne ~7 points de force par
      // saison, soit enfin l'écart entre deux divisions. Voir 3-documents/etude-equilibrage.md.
      const prob = ((coach.note - 42) / 40) * 0.13 * ageF * playF * centreF * sessionF;
      if (role === 'discipline') {
        if (mode === 'session') return; // la discipline se travaille surtout en match
        if (p.agr <= 40) return;
        if (Math.random() < prob) {
          p.agr--;
          // On range de la DONNÉE, pas une phrase : `G.lastTraining` est sauvegardé, et une
          // phrase y serait figée dans la langue du jour — comme le courrier avant la v109.
          gains.push({ nom: p.nom, stat: 'agr', valeur: p.agr, sens: -1 });
        }
        return;
      }
      if (p[stat] >= (p.potentiel || 97)) return;
      if (Math.random() < prob) {
        p[stat]++;
        gains.push({ nom: p.nom, stat: stat, valeur: p[stat], sens: 1 });
      }
    });
  });
  if (mode === 'session') { G.lastSessionTraining = gains; G.trainingAvailable = false; }
  else G.lastTraining = gains;
}

// Séance d'entraînement hors match : utilisable une fois entre deux journées, fait progresser
// en priorité les joueurs laissés au repos (la ligne complète qui ne joue pas).
function runTrainingSession() {
  if (!G.trainingAvailable) { toast(T('toast.seanceDeja'), 'info'); return; }
  if (Object.values(G.staff).every(v => !v)) { toast("Aucun coach en poste : recrute au moins un membre du staff.", 'warn'); return; }
  applyTraining('session');
  renderAll();
  const gains = G.lastSessionTraining;
  if (!gains.length) {
    toast(T('toast.seanceSansGain'), 'info');
  } else {
    notify({
      title: "Séance d'entraînement", ico: '🏋️',
      html: `<p class="modal-note">${gains.length} progression${gains.length > 1 ? 's' : ''} enregistrée${gains.length > 1 ? 's' : ''}.</p>
        <ul class="modal-list">${gains.map(g => `<li><span class="nm">${escHtml(ligneGain(g))}</span></li>`).join('')}</ul>`
    });
  }
}

function renderEntrainement() {
  const cards = Object.entries(ROLES).map(([role, def]) => {
    const unlocked = roleUnlocked(role);
    if (!unlocked) {
      return `<div class="card" style="opacity:.6">
        <b>${def.icon} ${roleLabel(role)}</b><br>
        <span class="note">${roleDesc(role)}.</span><br><br>
        <span class="tag" style="color:var(--rouge)">🔒 ${T('staff.requis', { quoi: roleRequirementText(role) })}</span>
      </div>`;
    }
    const c = G.staff[role];
    let current;
    if (c) {
      const trainCost = c.note < 95 ? coachTrainCost(c.note) : null;
      current = `<div class="coach-ligne">
        <img class="coach-photo" src="${coachPortrait(c)}" alt="" onerror="this.remove()">
        <div class="coach-txt"><b style="color:var(--tan)">${escHtml(c.nom)}</b> — ${T('staff.note', { n: c.note })}</div>
        </div>
        <div style="margin-top:6px">
          ${trainCost !== null
            ? `<button class="btn buy" ${G.budget < trainCost ? 'disabled' : ''} onclick="trainCoach('${role}')">📈 ${T('staff.former', { prix: euros(trainCost) })}</button>`
            : `<span class="tag">${T('staff.maximum')}</span>`}
          <button class="btn sell" onclick="fireStaff('${role}')">${T('staff.licencier', { prix: euros(coachSeverance(c)) })}</button>
        </div>`;
    } else {
      current = `<span class="tag">${T('staff.vacant')}</span>`;
    }
    // mercato : candidats toujours affichés (on peut remplacer directement le coach en poste)
    const candidates = G.market[role]
      .slice()
      .sort((a, b) => b.note - a.note)
      .map(cand => {
        const hireCost = Math.round(coachBaseCost(cand.note) / 100) * 100;
        const sev = c ? coachSeverance(c) : 0;
        const total = hireCost + sev;
        const label = c ? T('staff.remplacer', { prix: euros(total) }) : T('staff.embaucher', { prix: euros(hireCost) });
        return `<div style="margin-top:5px;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span>${escHtml(cand.nom)} — ${T('staff.noteCourte', { n: cand.note })}</span>
          <button class="btn buy" data-hire="${role}" ${G.budget < total ? 'disabled' : ''} onclick="hireStaff('${role}',${cand.id})">${label}</button>
        </div>`;
      }).join('');
    return `<div class="card">
      <b>${def.icon} ${roleLabel(role)}</b><br>
      <span class="note">${roleDesc(role)}. ${T('staff.frequence')}</span><br><br>
      ${current}
      <div style="margin-top:8px;border-top:1px solid #2c313a;padding-top:6px">
        <span class="tag">💼 ${c ? T('staff.mercato.avec') : T('staff.mercato')}</span>
        ${candidates}
      </div>
    </div>`;
  }).join('');
  const lastGains = (G.lastTraining && G.lastTraining.length)
    ? `<div class="card"><b>${T('entrainement.derniereSeance')}</b><ul>${G.lastTraining.map(g => `<li>${ligneGain(g)}</li>`).join('')}</ul></div>`
    : `<p class="note">${Object.values(G.staff).every(v => !v) ? T('entrainement.aucune.sansCoach') : T('entrainement.aucune')}</p>`;
  const sessionGains = (G.lastSessionTraining && G.lastSessionTraining.length)
    ? `<div class="card"><b>${T('entrainement.derniereHorsMatch')}</b><ul>${G.lastSessionTraining.map(g => `<li>${ligneGain(g)}</li>`).join('')}</ul></div>` : '';
  document.getElementById('tab-entrainement').innerHTML = `
    ${bandeau('entrainement', myTeam().name, T('ecran.entrainement.label'),
              G.trainingAvailable ? T('entrainement.dispo') : T('entrainement.deja'))}
    <div class="card">
      <p class="note">${T('entrainement.info')}</p>
      <button class="btn buy" ${!G.trainingAvailable ? 'disabled' : ''} onclick="runTrainingSession()">
        ${G.trainingAvailable ? '🏋️ ' + T('entrainement.lancer') : '✔️ ' + T('entrainement.deja')}
      </button>
    </div>
    ${sessionGains}

    <h2>${T('entrainement.staff')}</h2>
    <p class="note">${T('entrainement.staff.info')}</p>
    <div class="grid2">${cards}</div>
    ${lastGains}`;
}

// ---------------- Transferts ----------------
function canSell(team, p) {
  const gks = team.players.filter(x => x.pos === 'G').length;
  const field = team.players.filter(x => x.pos !== 'G').length;
  if (p.pos === 'G') return gks > 1;
  return field > 8; // garde toujours au moins 2 lignes complètes (8 joueurs de champ)
}
// Négociation : chance de refus pur, ou de contre-offre à un prix plus élevé (réduites par un bon recruteur)
function negotiatePrice(p, basePrice) {
  const recDiscount = G.staff.recruteur ? clampV((G.staff.recruteur.note - 50) / 500, 0, 0.10) : 0;
  const price = Math.round(basePrice * (1 - recDiscount) / 10) * 10;
  const rejectChance = clampV(0.05 + (overall(p) - 60) / 300 - recDiscount, 0.02, 0.25);
  if (Math.random() < rejectChance) return { ok: false, reason: 'reject' };
  const counterChance = clampV(0.28 - recDiscount, 0.08, 0.35);
  if (Math.random() < counterChance) {
    const counter = Math.round(price * rnd(1.08, 1.22) / 10) * 10;
    return { ok: true, price: counter, countered: true };
  }
  return { ok: true, price, countered: false };
}

function signNewContract(p) {
  p.contractYears = irnd(2, 4);
  p.moral = irnd(70, 90); // heureux de sa nouvelle signature
  p.salaire = playerSalary(p);
}

async function buyPlayer(teamId, playerId) {
  if (G.season < 2) { toast(T('toast.marcheFerme'), 'info'); return; }
  const seller = G.teams[teamId];
  const p = seller.players.find(x => x.id === playerId);
  if (!p) return;
  if (!canSell(seller, p)) { toast("Ce club refuse de vendre : son effectif est trop court.", 'warn'); return; }
  const basePrice = playerValue(p) * 1.1;
  const neg = negotiatePrice(p, basePrice);
  if (!neg.ok) { toast(T('toast.refuseVendre', { club: seller.name, nom: p.nom }), 'bad'); return; }
  if (G.budget < neg.price) { toast("Budget insuffisant." + (neg.countered ? ` ${seller.name} demandait ${euros(neg.price)} (contre-offre).` : ''), 'bad'); return; }
  const msg = neg.countered
    ? `${seller.name} refuse le prix affiché et demande ${euros(neg.price)} pour ${p.nom}. Accepter ?`
    : `Acheter ${p.nom} pour ${euros(neg.price)} ?`;
  if (!(await ask({ title: "Transfert", ico: '💰', text: msg,
    okLabel: neg.countered ? "Accepter" : "Acheter" }))) return;
  G.budget -= neg.price;
  seller.players = seller.players.filter(x => x.id !== playerId);
  p.starter = false;
  signNewContract(p);
  myTeam().players.push(p);
  renderAll();
}

// ---------------- Recrutement hors division ----------------
function buildScoutPool() {
  const pool = [];
  DIVISIONS.forEach((div, di) => {
    if (di === G.divIdx) return;
    const clubNames = div.teams.filter(t => !t.human).map(t => t.name);
    for (let i = 0; i < 6; i++) {
      const pos = ['G', 'D', 'D', 'A', 'A'][irnd(0, 4)];
      const quality = rnd(div.qual[0], div.qual[1]);
      const p = makePlayer(pos, quality);
      pool.push({ p, divIdx: di, clubName: pick(clubNames) });
    }
  });
  return pool;
}
async function buyScoutPlayer(scoutId) {
  if (G.season < 2) { toast(T('toast.marcheFerme'), 'info'); return; }
  const entry = G.scoutPool.find(e => e.p.id === scoutId);
  if (!entry) return;
  const { p, divIdx, clubName } = entry;
  const premium = divIdx < G.divIdx ? 1.25 : 0.95; // débaucher d'une division supérieure coûte plus cher
  const basePrice = playerValue(p) * 1.1 * premium;
  const neg = negotiatePrice(p, basePrice);
  if (!neg.ok) { toast(T('toast.refusePartir', { club: clubName, nom: p.nom }), 'bad'); return; }
  if (G.budget < neg.price) { toast("Budget insuffisant." + (neg.countered ? ` ${clubName} demandait ${euros(neg.price)} (contre-offre).` : ''), 'bad'); return; }
  const msg = neg.countered
    ? `${clubName} (${DIVISIONS[divIdx].label}) refuse le prix affiché et demande ${euros(neg.price)} pour ${p.nom}. Accepter ?`
    : `Recruter ${p.nom} (${DIVISIONS[divIdx].label}, ${clubName}) pour ${euros(neg.price)} ?`;
  if (!(await ask({ title: "Recrutement", ico: '🔍', text: msg,
    okLabel: neg.countered ? "Accepter" : "Recruter" }))) return;
  G.budget -= neg.price;
  G.scoutPool = G.scoutPool.filter(e => e.p.id !== scoutId);
  signNewContract(p);
  myTeam().players.push(p);
  renderAll();
}
async function sellPlayer(playerId) {
  const me = myTeam();
  const p = me.players.find(x => x.id === playerId);
  if (!p) return;
  if (!canSell(me, p)) { toast("Impossible : il te faut au moins 1 gardien et 5 joueurs de champ.", 'warn'); return; }
  const price = Math.round(playerValue(p) * 0.9 / 10) * 10;
  if (!(await ask({ title: "Vendre un joueur", ico: '💸', danger: true, okLabel: "Vendre",
    text: `Vendre ${p.nom} pour ${euros(price)} ?` }))) return;
  G.budget += price;
  me.players = me.players.filter(x => x.id !== playerId);
  // le joueur part dans un club aléatoire
  pick(G.teams.filter(t => !t.human)).players.push(p);
  autoLineupIfBroken();
  renderAll();
}

// Prêt : le joueur quitte l'effectif pour la saison (plus de salaire à payer) et revient à l'intersaison,
// avec un peu de développement grâce au temps de jeu ailleurs.
async function loanPlayer(playerId) {
  const me = myTeam();
  const p = me.players.find(x => x.id === playerId);
  if (!p) return;
  if (p.injured) { toast(T('toast.blesseNonPrete'), 'warn'); return; }
  if (!canSell(me, p)) { toast(T('toast.effectifTropCourt'), 'warn'); return; }
  if (!(await ask({ title: T('dlg.pret.titre'), ico: '🔄', okLabel: T('effectif.preter'),
    text: T('dlg.pret.texte', { nom: p.nom }) }))) return;
  me.players = me.players.filter(x => x.id !== playerId);
  p.starter = false;
  if (!G.loanedOut) G.loanedOut = [];
  G.loanedOut.push(p);
  pushInbox('courrier.pret.titre', 'courrier.pret.corps', { nom: p.nom }, 'transfert');
  autoLineupIfBroken();
  renderAll();
}

// Témoin de chargement, lu par verifierPieces() en fin d'amorçage.
if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.staff = true;

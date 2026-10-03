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
//   `toggleStarter`, `checkUnlockNotifications` : des utilitaires
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
// `trains` : le poste fait progresser une statistique. `seance` : il le fait AUSSI en séance hors match — le coach mental
// travaille en match seulement. La séance et sa garde lisent ce même drapeau (neuvième relecture).
const ROLES = {
  attaque:      { stat: "tir", icon: "🎯", trains: true, seance: true, reqDiv: 0, reqCentre: 1 },
  defense:      { stat: "def", icon: "🛡️", trains: true, seance: true, reqDiv: 0, reqCentre: 1 },
  physique:     { stat: "vit", icon: "⚡", trains: true, seance: true, reqDiv: 0, reqCentre: 1 },
  gardiens:     { stat: "gar", icon: "🥅", trains: true, seance: true, reqDiv: 0, reqCentre: 1 },
  discipline:   { stat: "agr", icon: "🧘", trains: true, seance: false, reqDiv: 2, reqCentre: 1 },
  medecin:      { stat: null, icon: "⚕️", trains: false, seance: false, reqDiv: 2, reqCentre: 2 },
  recruteur:    { stat: null, icon: "🔎", trains: false, seance: false, reqDiv: 3, reqCentre: 2 },
  specialistes: { stat: null, icon: "🎯⚡", trains: false, seance: false, reqDiv: 3, reqCentre: 3 }
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
// Le compteur des coachs n'est pas dans la sauvegarde : à chaque chargement, il repart AU-DESSUS du plus grand
// identifiant connu, et le second porteur d'un identifiant — ce que le compteur remis à 1 a pu produire — est renuméroté,
// le coach en poste d'abord. Après un rechargement, deux coachs du même poste portaient le même identifiant, et embaucher
// l'un faisait disparaître l'autre du marché (étude des décisions de l'argent).
function normaliserIdentitesCoachs() {
  const coachs = [...Object.values(G.staff || {}), ...Object.values(G.market || {}).flat()]
    .filter(c => c && typeof c === 'object');
  nextCoachId = Math.max(nextCoachId, 1 + coachs.reduce((m, c) => Math.max(m, Number.isInteger(c.id) ? c.id : 0), 0));
  const vus = new Set();
  coachs.forEach(c => {
    if (!Number.isInteger(c.id) || vus.has(c.id)) c.id = nextCoachId++;
    vus.add(c.id);
  });
}
function coachBaseCost(note) {
  // note 55 → 600 €, 70 → 6 300 €, 80 → 13 300 €, 92 → 25 200 €, 95 → 28 700 € (calculé depuis la formule)
  return Math.round((note - 48) * (note - 48) * 13 / 100) * 100;
}
// Le salaire d'un coach, dû à chaque journée de championnat, match ou non. La paie de `playDay` et l'affichage lisent
// cette règle, et elle seule.
function salaireCoach(c) { return Math.round(c.note * 1.5); }
function coachSeverance(c) {
  // indemnité de départ du coach en poste (25 % de sa valeur)
  return Math.round(coachBaseCost(c.note) * 0.25 / 100) * 100;
}
function coachTrainCost(note) {
  // coût pour faire gagner +1 de note : de plus en plus cher à mesure que le coach est bon. L'écart se prend sur les prix
  // EXACTS de `coachBaseCost`, avant l'arrondi à la centaine : deux prix arrondis donnaient un écart qui oscillait —
  // 1 100 € de 64 à 65, puis 900 € de 65 à 66 (signalé par Mirja, 27 septembre 2026).
  const exact = (n) => (n - 48) * (n - 48) * 13;
  return Math.round((exact(note + 1) - exact(note)) * 1.6 / 100) * 100 + 300;
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
  if (G.budget < total) { toast(T('toast.budgetInsuffisant'), 'bad'); return; }
  // Le poste par son libellé traduit — `ROLES[role].label` n'existe plus, la fenêtre disait « comme undefined » —, et le
  // salaire par journée, qu'on ne découvrait qu'après coup.
  const msg = current
    ? T('dlg.remplacer.texte', { ancien: current.nom, noteAncien: current.note, nom: cand.nom, note: cand.note,
        prix: euros(hireCost), indemnite: euros(sev), total: euros(total), salaire: euros(salaireCoach(cand)) })
    : T('dlg.embaucher.texte', { nom: cand.nom, note: cand.note, poste: roleLabel(role), prix: euros(hireCost),
        salaire: euros(salaireCoach(cand)) });
  if (!(await ask({ title: T(current ? 'dlg.remplacer.titre' : 'dlg.embaucher.titre'), ico: '', text: msg,
    okLabel: T(current ? 'dlg.remplacer.ok' : 'dlg.embaucher.titre') }))) return;
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
  if (!(await ask({ title: T('dlg.licencier.titre'), ico: '', danger: true, okLabel: T('dlg.licencier.titre'),
      text: T(sexeCoach(c) === 'F' ? 'dlg.licencier.texteF' : 'dlg.licencier.texte', { nom: c.nom, montant: euros(indemnite) }) }))) return;
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
  if (G.budget < cost) { toast(T('toast.budgetFormation'), 'bad'); return; }
  if (!(await ask({ title: T('dlg.formation.titre'), picto: 'progression', okLabel: T('dlg.formation.ok'),
    text: T('dlg.formation.texte', { nom: c.nom, note: c.note, suivante: c.note + 1, prix: euros(cost) }) }))) return;
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
    // Un blessé est à l'infirmerie : il ne progresse ni en match ni en séance, où il recevait le bonus « laissé au repos »
    // (dixième relecture).
    if (p.injured) return;
    Object.entries(ROLES).forEach(([role, def]) => {
      if (!def.trains) return; // spécialistes/recruteur/médecin agissent ailleurs, pas sur la progression des stats
      if (mode === 'session' && !def.seance) return; // la discipline se travaille en match
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
  if (mode === 'session') {
    G.lastSessionTraining = gains;
    G.seancesRestantes = Math.max(0, (G.seancesRestantes || 0) - 1);
    G.trainingAvailable = G.seancesRestantes > 0;
  }
  else G.lastTraining = gains;
}

// Séance d'entraînement hors match : utilisable une fois entre deux journées, fait progresser
// en priorité les joueurs laissés au repos (la ligne complète qui ne joue pas).
// Un coach qui ENTRAÎNE, en match — le coach mental compris : sans lui, l'écran conseille d'embaucher un coach.
function aUnEntraineur() {
  return Object.keys(G.staff || {}).some(r => G.staff[r] && ROLES[r] && ROLES[r].trains);
}
// Une séance se mène avec un coach de SÉANCE : ni le médecin, ni le recruteur, ni le coach situations spéciales, ni le
// coach mental, qui travaille en match. La séance était décomptée sans effet possible (huitième et neuvième relectures).
function aUnCoachDeSeance() {
  return Object.keys(G.staff || {}).some(r => G.staff[r] && ROLES[r] && ROLES[r].seance);
}
function runTrainingSession() {
  // Au milieu d'un plateau, la raison n'est pas une séance déjà menée : il n'y en a pas (27 septembre 2026).
  if (plateauEnCours()) { toast(T('entrainement.plateau'), 'info'); return; }
  if (phaseFinaleFinie()) { toast(T('entrainement.finDePhase'), 'info'); return; }
  if (!(G.seancesRestantes > 0)) { toast(T('toast.seanceDeja'), 'info'); return; }
  if (!aUnCoachDeSeance()) { toast(T(Object.values(G.staff).some(Boolean) ? 'toast.aucunEntraineur' : 'toast.aucunCoach'), 'warn'); return; }
  applyTraining('session');
  // La séance se mène depuis l'onglet : ce que la pastille annonçait est vu. Elle restait allumée quand la journée avait
  // été jouée depuis cet onglet (signalé par Mirja, 27 septembre 2026).
  if (G.tabNotify) G.tabNotify.entrainement = false;
  renderAll();
  const gains = G.lastSessionTraining;
  if (!gains.length) {
    toast(T('toast.seanceSansGain'), 'info');
  } else {
    notify({
      title: T('seance.titre'), picto: 'entrainement',
      html: `<p class="modal-note">${T('seance.progressions', { n: gains.length })}</p>
        <ul class="modal-list">${gains.map(g => `<li><span class="nm">${escHtml(ligneGain(g))}</span></li>`).join('')}</ul>`
    });
  }
}

// Le coach en poste : portrait, nom, note. Une seule écriture pour un poste ouvert et un poste reverrouillé.
function ligneCoachEnPoste(c) {
  return `<div class="coach-ligne">
        <img class="coach-photo" src="${coachPortrait(c)}" alt="" onerror="this.remove()">
        <div class="coach-txt"><b style="color:var(--tan)">${escHtml(c.nom)}</b> — ${T('staff.note', { n: c.note })} · ${T('staff.salaireJournee', { prix: euros(salaireCoach(c)) })}</div>
        </div>`;
}
function boutonLicencier(role, c) {
  // Grisé sans le budget de l'indemnité, comme tout bouton qu'on ne peut pas payer (huitième relecture).
  return `<button class="btn sell" ${G.budget < coachSeverance(c) ? 'disabled' : ''} onclick="fireStaff('${role}')">${T('staff.licencier', { prix: euros(coachSeverance(c)) })}</button>`;
}

function renderEntrainement() {
  const cards = Object.entries(ROLES).map(([role, def]) => {
    const unlocked = roleUnlocked(role);
    if (!unlocked) {
      // Un poste reverrouillé par une descente GARDE son coach : il agit, il est payé à chaque journée — il se voit donc, et
      // il peut partir (étude des décisions de l'argent). Il disparaissait de l'écran, sans bouton « Licencier ».
      const enPoste = G.staff[role];
      return `<div class="card"${enPoste ? '' : ' style="opacity:.6"'}>
        <b>${def.icon} ${roleLabel(role)}</b><br>
        <span class="note">${roleDesc(role)}.</span><br><br>
        <span class="tag" style="color:var(--rouge)">🔒 ${T('staff.requis', { quoi: roleRequirementText(role) })}</span>
        ${enPoste ? `<div style="margin-top:8px">${ligneCoachEnPoste(enPoste)}</div>
        <div style="margin-top:6px">${boutonLicencier(role, enPoste)}</div>` : ''}
      </div>`;
    }
    const c = G.staff[role];
    let current;
    if (c) {
      const trainCost = c.note < 95 ? coachTrainCost(c.note) : null;
      current = `${ligneCoachEnPoste(c)}
        <div style="margin-top:6px">
          ${trainCost !== null
            ? `<button class="btn buy" ${G.budget < trainCost ? 'disabled' : ''} onclick="trainCoach('${role}')">📈 ${T('staff.former', { prix: euros(trainCost) })}</button>`
            : `<span class="tag">${T('staff.maximum')}</span>`}
          ${boutonLicencier(role, c)}
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
          <span>${escHtml(cand.nom)} — ${T('staff.noteCourte', { n: cand.note })} · ${T('staff.salaireJournee', { prix: euros(salaireCoach(cand)) })}</span>
          <button class="btn buy" data-hire="${role}" data-prix="${total}" ${G.budget < total ? 'disabled' : ''} onclick="hireStaff('${role}',${cand.id})">${label}</button>
        </div>`;
      }).join('');
    return `<div class="card">
      <b>${def.icon} ${roleLabel(role)}</b><br>
      <span class="note">${roleDesc(role)}. ${T('staff.frequence')}</span><br><br>
      ${current}
      <div style="margin-top:8px;border-top:1px solid var(--bordure);padding-top:6px">
        <span class="tag">${c ? T('staff.mercato.avec') : T('staff.mercato')}</span>
        ${candidates}
      </div>
    </div>`;
  }).join('');
  const lastGains = (G.lastTraining && G.lastTraining.length)
    ? `<div class="card"><b>${T('entrainement.derniereSeance')}</b><ul>${G.lastTraining.map(g => `<li>${ligneGain(g)}</li>`).join('')}</ul></div>`
    : `<p class="note">${!aUnEntraineur() ? T('entrainement.aucune.sansCoach') : T('entrainement.aucune')}</p>`;
  const sessionGains = (G.lastSessionTraining && G.lastSessionTraining.length)
    ? `<div class="card"><b>${T('entrainement.derniereHorsMatch')}</b><ul>${G.lastSessionTraining.map(g => `<li>${ligneGain(g)}</li>`).join('')}</ul></div>` : '';
  // Au milieu d'un plateau, le bouton s'éteint et l'écran dit pourquoi : « séance déjà menée » aurait été faux.
  const enPlateau = plateauEnCours();
  // Éliminé, ou la phase finale jouée : plus de match cette saison, et l'écran le dit (onzième relecture).
  const finie = phaseFinaleFinie();
  const possible = G.seancesRestantes > 0 && !enPlateau && !finie;
  document.getElementById('tab-entrainement').innerHTML = `
    ${bandeau('entrainement', myTeam().name, T('ecran.entrainement.label'),
              enPlateau ? T('entrainement.plateau')
              : finie ? T('entrainement.finDePhase')
              : G.seancesRestantes > 0
                // Pendant la phase finale, `G.day` reste sur la dernière journée, déjà jouée : pas de date. La phrase nomme le
                // match qui vient — playoffs, barrage, play-down ou tournoi d'accession —, pas toujours « la phase finale ».
                ? (G.playoff ? T(cleSeanceAvantMatch(), { n: G.seancesRestantes })
                   : T('entrainement.dispoN', { n: G.seancesRestantes, date: formatDateJournee(dateJournee(G.day), false) }))
                : T('entrainement.deja'))}
    <div class="card">
      <button class="btn buy" ${!possible ? 'disabled' : ''} onclick="runTrainingSession()">
        ${possible || enPlateau || finie ? pictoHtml('entrainement') + ' ' + T('entrainement.lancer') : '✔️ ' + T('entrainement.deja')}
      </button>
      ${regleRepliable(T('entrainement.info'))}
    </div>
    ${sessionGains}

    <h2>${T('entrainement.staff')}</h2>
    ${regleRepliable(T('entrainement.staff.info'))}
    <div class="grid2">${cards}</div>
    ${lastGains}`;
}

// ---------------- Transferts ----------------
// Le plancher d'une vente : deux lignes complètes de joueurs de champ, et un gardien. La règle et le message de refus
// lisent cette constante ; le message disait « 5 joueurs de champ ».
const JOUEURS_DE_CHAMP_MIN = 8;
function canSell(team, p) {
  const gks = team.players.filter(x => x.pos === 'G').length;
  const field = team.players.filter(x => x.pos !== 'G').length;
  if (p.pos === 'G') return gks > 1;
  return field > JOUEURS_DE_CHAMP_MIN;
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
}

// Le joueur portait un numéro que quelqu'un porte déjà chez nous : il en a reçu un autre, et
// on le DIT. Sans numéro valide au départ — marché hors division — il n'y a rien à annoncer.
function annoncerNumeroDArrivee(p, voulu, porte) {
  if (numeroValide(voulu) && porte !== voulu) toast(T('numero.arrivee', { nom: p.nom, n: porte, ancien: voulu }), 'info');
}

async function buyPlayer(teamId, playerId) {
  if (!marcheOuvert()) { toast(T('toast.marcheFerme', { saison: SAISON_OUVERTURE_MARCHE }), 'info'); return; }
  // Par l'IDENTIFIANT : `G.teams` est la poule, rangée de 0 à n-1, et les identifiants sont renumérotés sur toute la
  // division. `G.teams[teamId]` ne trouvait personne dès la N3 hors de la première poule. Un club ou un joueur disparu entre
  // l'affichage et le clic — une fin de saison — ne fait rien, comme avant.
  const seller = G.teams.find(t => t.id === teamId);
  const p = seller ? seller.players.find(x => x.id === playerId) : null;
  if (!p) return;
  if (!canSell(seller, p)) { toast(T('toast.clubEffectifCourt'), 'warn'); return; }
  if (effectifPlein()) { toast(T('toast.effectifPlein', { n: EFFECTIF_MAX }), 'warn'); return; }
  const basePrice = playerValue(p) * 1.1;
  const neg = negotiatePrice(p, basePrice);
  if (!neg.ok) { toast(T('toast.refuseVendre', { club: seller.name, nom: p.nom }), 'bad'); return; }
  if (G.budget < neg.price) { toast(T('toast.budgetInsuffisant') + (neg.countered ? ' ' + T('toast.contreOffre', { club: seller.name, prix: euros(neg.price) }) : ''), 'bad'); return; }
  const msg = neg.countered
    ? T('dlg.achat.contre', { club: seller.name, prix: euros(neg.price), nom: p.nom })
    : T('dlg.achat.texte', { nom: p.nom, prix: euros(neg.price) });
  if (!(await ask({ title: T('dlg.achat.titre'), picto: 'argent', text: msg,
    okLabel: T(neg.countered ? 'dlg.accepter' : 'dlg.achat.ok') }))) return;
  G.budget -= neg.price;
  seller.players = seller.players.filter(x => x.id !== playerId);
  p.starter = false;
  signNewContract(p);
  oublierLigne(p);   // une place retenue ne vaut que dans le club qui l'a donnée
  myTeam().players.push(p);
  annoncerNumeroDArrivee(p, p.num, attribuerNumero(myTeam(), p));
  renderAll();
}

// ---------------- Recrutement hors division ----------------
// Le supplément d'une recrue venue d'une autre division : débaucher PLUS HAUT coûte 25 % de plus, recruter plus bas 5 %
// de moins. Les divisions montent du Régional (0) à l'Élite (5) ; le code comparait à l'envers depuis toujours (étude des
// décisions de l'argent, 26 septembre 2026). Une seule fonction pour le prix affiché et le prix demandé.
function primeHorsDivision(divIdx) {
  if (divIdx > G.divIdx) return 1.25;
  if (divIdx < G.divIdx) return 0.95;
  return 1;
}
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
  if (!marcheOuvert()) { toast(T('toast.marcheFerme', { saison: SAISON_OUVERTURE_MARCHE }), 'info'); return; }
  const entry = G.scoutPool.find(e => e.p.id === scoutId);
  if (!entry) return;
  const { p, divIdx, clubName } = entry;
  if (effectifPlein()) { toast(T('toast.effectifPlein', { n: EFFECTIF_MAX }), 'warn'); return; }
  const basePrice = playerValue(p) * 1.1 * primeHorsDivision(divIdx);
  const neg = negotiatePrice(p, basePrice);
  if (!neg.ok) { toast(T('toast.refusePartir', { club: clubName, nom: p.nom }), 'bad'); return; }
  if (G.budget < neg.price) { toast(T('toast.budgetInsuffisant') + (neg.countered ? ' ' + T('toast.contreOffre', { club: clubName, prix: euros(neg.price) }) : ''), 'bad'); return; }
  const msg = neg.countered
    ? T('dlg.recrutement.contre', { club: clubName, division: DIVISIONS[divIdx].label, prix: euros(neg.price), nom: p.nom })
    : T('dlg.recrutement.texte', { nom: p.nom, division: DIVISIONS[divIdx].label, club: clubName, prix: euros(neg.price) });
  if (!(await ask({ title: T('dlg.recrutement.titre'), picto: 'loupe', text: msg,
    okLabel: T(neg.countered ? 'dlg.accepter' : 'dlg.recrutement.ok') }))) return;
  G.budget -= neg.price;
  G.scoutPool = G.scoutPool.filter(e => e.p.id !== scoutId);
  signNewContract(p);
  oublierLigne(p);   // une place retenue ne vaut que dans le club qui l'a donnée
  myTeam().players.push(p);
  annoncerNumeroDArrivee(p, p.num, attribuerNumero(myTeam(), p));
  renderAll();
}
async function sellPlayer(playerId) {
  const me = myTeam();
  const p = me.players.find(x => x.id === playerId);
  if (!p) return;
  if (!canSell(me, p)) { toast(T('toast.venteImpossible', { champ: JOUEURS_DE_CHAMP_MIN }), 'warn'); return; }
  const price = Math.round(playerValue(p) * 0.9 / 10) * 10;
  if (!(await ask({ title: T('dlg.vente.titre'), picto: 'argent', danger: true, okLabel: T('dlg.vente.ok'),
    text: T('dlg.vente.texte', { nom: p.nom, prix: euros(price) }) }))) return;
  G.budget += price;
  me.players = me.players.filter(x => x.id !== playerId);
  // Sa place retenue revient au dépanneur qui la tient, et il part sans la mémoire du club.
  promouvoirDepanneur(me, p);
  oublierLigne(p);
  // le joueur part dans un club aléatoire
  const acheteur = pick(G.teams.filter(t => !t.human));
  acheteur.players.push(p);
  attribuerNumero(acheteur, p);
  // Pas de recomposition ici : `lineupOf()` et `preparerLignesAvantMatch()` s'en chargent au
  // moment de jouer. L'appel qui se trouvait là visait une fonction retirée en v128, et levait
  // AVANT `renderAll()` — l'écran restait figé sur le joueur vendu.
  renderAll();
}

// Prêt : le joueur quitte l'effectif pour la saison (plus d'indemnité de match à payer, dès la Pré-Nationale) et revient à l'intersaison,
// avec un peu de développement grâce au temps de jeu ailleurs.
async function loanPlayer(playerId) {
  const me = myTeam();
  const p = me.players.find(x => x.id === playerId);
  if (!p) return;
  if (p.injured) { toast(T('toast.blesseNonPrete'), 'warn'); return; }
  if (!canSell(me, p)) { toast(T('toast.effectifTropCourt'), 'warn'); return; }
  if (!(await ask({ title: T('dlg.pret.titre'), picto: 'transferts', okLabel: T('effectif.preter'),
    text: T('dlg.pret.texte', { nom: p.nom }) }))) return;
  me.players = me.players.filter(x => x.id !== playerId);
  // Sa place retenue revient au dépanneur qui la tient, et il part sans la mémoire du club.
  promouvoirDepanneur(me, p);
  oublierLigne(p);
  p.starter = false;
  if (!G.loanedOut) G.loanedOut = [];
  G.loanedOut.push(p);
  pushInbox('courrier.pret.titre', 'courrier.pret.corps', { nom: p.nom }, 'transfert');
  renderAll();   // même raison que dans `sellPlayer` : la composition se refait au moment de jouer
}

// Témoin de chargement, lu par verifierPieces() en fin d'amorçage.
if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.staff = true;

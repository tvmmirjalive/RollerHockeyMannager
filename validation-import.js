// validation-import.js — ce qu'une sauvegarde doit prouver pour entrer dans le jeu.
//
// Extrait d'`index.html` sans une ligne réécrite (A4, première extraction). Ce fichier ne
// touche à RIEN : ni à l'état du jeu, ni au DOM, ni au stockage. Il déclare, il ne fait pas.
//
// Il lit trois choses qui restent dans `index.html` — `T()`, `DIVISIONS` et
// `SCHEMA_SAUVEGARDE` — et seulement au moment de l'appel, donc bien après le chargement des
// pièces. C'est ce qui rend l'extraction possible sans toucher à l'ordre de chargement.
//
// PIÈCE CRITIQUE : sans elle, aucune sauvegarde ne peut être lue.

// Ce qu'une lettre a le droit de contenir : un portrait, du gras, des notes. On ne peut donc
// pas échapper le corps des messages — ce serait afficher les balises en clair. On ne peut
// pas non plus se contenter de RETIRER ce qui exécute : l'audit du 9 septembre 2026 a montré
// que `<img src="x"/onerror=…>` — une barre oblique au lieu de l'espace — passait trois
// expressions régulières et s'exécutait dans la messagerie. Un filtre à motifs court toujours
// après le parseur HTML ; il perd.
//
// D'où une LISTE D'AUTORISATION, appliquée APRÈS interprétation HTML (DOMParser : embarqué,
// hors ligne, inerte — rien ne s'y charge ni ne s'y exécute) : les balises, attributs et
// chemins que les courriers utilisent réellement — gras, italique, exposant, saut de ligne,
// paragraphe et note, portrait local — et rien d'autre. Une balise inconnue est déballée (son
// texte reste) ; une balise dont le contenu est du code, une feuille de style, un espace de
// noms étranger ou du texte brut est supprimée avec son contenu. Le résultat est resérialisé
// par le navigateur : ce qui entre dans la page est un HTML que le jeu a écrit, pas celui du
// fichier.
//
// Deux types de champs seulement ont droit au HTML : `body` (lettres d'avant la v109) et les
// paramètres `…Html` des lettres à clés. Tout autre texte importé — noms, titres, libellés —
// est du TEXTE : ses balises tombent, ses chevrons aussi.
const HTML_BALISES_AUTORISEES = new Set(['b', 'i', 'em', 'strong', 'u', 'small', 'sup', 'sub', 'br', 'p', 'span', 'img', 'ul', 'ol', 'li']);
// Supprimées AVEC leur contenu. Les quatre dernières (noscript, template, textarea, title —
// et xmp, plaintext) sont du texte brut pour le parseur : les garder, même vidées de leurs
// attributs, c'est prendre le risque qu'une resérialisation les relise autrement.
const HTML_BALISES_SUPPRIMEES = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'option', 'textarea', 'noscript', 'noembed', 'noframes',
  'template', 'title', 'head', 'xmp', 'plaintext', 'svg', 'math', 'video', 'audio', 'source', 'track', 'picture',
  'canvas', 'dialog', 'slot']);
// Une image ne vient que du dossier images/ du jeu : chemin relatif, minuscules, extension
// connue — ni protocole, ni « .. », ni donnée en ligne.
const HTML_SRC_LOCAL = /^images\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.(?:webp|png|jpg|jpeg|svg)$/;
const HTML_CLASSE = /^[a-z][a-z0-9-]*$/;
const HTML_PROFONDEUR_MAX = 40;
let analyseurHtml = null;
function documentInerte(s) {
  if (!analyseurHtml) analyseurHtml = new DOMParser();
  return analyseurHtml.parseFromString('<!DOCTYPE html><body>' + s, 'text/html');
}

function assainirNoeud(parent, profondeur) {
  Array.from(parent.childNodes).forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) return;
    if (n.nodeType !== Node.ELEMENT_NODE) { n.remove(); return; }        // commentaires et autres
    const nom = n.localName;
    if (profondeur >= HTML_PROFONDEUR_MAX || n.namespaceURI !== 'http://www.w3.org/1999/xhtml'
        || HTML_BALISES_SUPPRIMEES.has(nom)) { n.remove(); return; }
    assainirNoeud(n, profondeur + 1);
    if (!HTML_BALISES_AUTORISEES.has(nom)) {                              // déballée : le texte reste
      while (n.firstChild) parent.insertBefore(n.firstChild, n);
      n.remove();
      return;
    }
    Array.from(n.attributes).forEach(a => {
      const garde = (a.name === 'class' && a.value.split(/\s+/).every(c => !c || HTML_CLASSE.test(c)))
        || a.name === 'alt'
        || (a.name === 'src' && nom === 'img' && HTML_SRC_LOCAL.test(a.value));
      if (!garde) n.removeAttribute(a.name);
    });
  });
}

// Le HTML d'une lettre, réduit à ce qui est autorisé. Sans balise, rien à faire.
function assainirHtml(s) {
  if (typeof s !== 'string') return '';
  if (s.indexOf('<') < 0) return s;
  const doc = documentInerte(s);
  assainirNoeud(doc.body, 0);
  return doc.body.innerHTML;
}

// Un champ ordinaire n'a pas de HTML : ses balises tombent, et les chevrons qui resteraient.
function texteDepuisHtml(s) {
  if (typeof s !== 'string' || s.indexOf('<') < 0) return s;
  return (documentInerte(s).body.textContent || '').replace(/[<>]/g, '');
}

// Profondeur maximale d'un objet importé. Une sauvegarde saine ne dépasse pas cinq niveaux ;
// au-delà, c'est une structure fabriquée, et on ne lui doit pas une descente infinie.
const IMPORT_PROFONDEUR_MAX = 12;
function champHtml(cle) { return cle === 'body' || /Html$/.test(String(cle)); }

function nettoyerImport(v, profondeur, cle) {
  const p = profondeur || 0;
  if (typeof v === 'string') return champHtml(cle) ? assainirHtml(v) : texteDepuisHtml(v);
  if (!v || typeof v !== 'object') return v;          // nombres, booléens, null : intacts
  if (p >= IMPORT_PROFONDEUR_MAX) return Array.isArray(v) ? [] : {};
  if (Array.isArray(v)) return v.map(x => nettoyerImport(x, p + 1, cle));   // un tableau hérite de sa clé
  const out = {};
  Object.keys(v).forEach(k => {
    // `__proto__` et consorts ne peuvent rien polluer via JSON.parse, mais les recopier
    // dans un objet neuf n'a aucun intérêt non plus.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    out[k] = nettoyerImport(v[k], p + 1, k);
  });
  return out;
}

// ---------------- Schéma et validation d'une sauvegarde ----------------
// Numéro DISTINCT de la version du jeu : la version change à chaque livraison, la forme des
// données beaucoup plus rarement. Une sauvegarde sans `schema` date d'avant ce numéro et
// passe par les compléments de `migrerPartie()`. Une sauvegarde d'un schéma plus grand vient
// d'une version plus récente du jeu : on la refuse nommément plutôt que de la deviner.
const SCHEMA_SAUVEGARDE = 1;
// Une partie de trois saisons pèse 340 Ko ; au-delà de 8 Mo, ce n'est pas une sauvegarde.
const TAILLE_MAX_SAUVEGARDE = 8 * 1024 * 1024;
const IMPORT_BORNES = { poules: 16, equipes: 40, joueurs: 60, journees: 120,
                        inbox: 2000, history: 2000, market: 500, scoutPool: 500, loanedOut: 200 };

function erreurImport(chemin, attendu) { return new Error(chemin + ' : ' + attendu); }

// Vérifie la FORME d'un candidat AVANT toute migration : types, bornes, références. Ce qui
// n'est pas listé ici est complété par la migration ; ce qui est listé est ce sans quoi le
// moteur plante ou boucle. Les sauvegardes anciennes doivent passer : on n'exige que ce que
// toutes les versions ont écrit — `teams`/`schedule` seuls valent `poules`/`calendriers`.
function validerCandidat(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw erreurImport('sauvegarde', 'objet attendu');
  if (data.schema !== undefined) {
    if (!Number.isInteger(data.schema) || data.schema < 0) throw erreurImport('schema', 'entier attendu');
    if (data.schema > SCHEMA_SAUVEGARDE) throw new Error(T('import.schemaRecent', { n: data.schema, max: SCHEMA_SAUVEGARDE }));
  }
  const g = data.G;
  if (!g || typeof g !== 'object' || Array.isArray(g)) throw erreurImport('G', 'objet attendu');
  if (data.nextPlayerId !== undefined && !(Number.isInteger(data.nextPlayerId) && data.nextPlayerId >= 0)) throw erreurImport('nextPlayerId', 'entier attendu');
  const entier = (v, chemin, min, max) => { if (!Number.isInteger(v) || v < min || v > max) throw erreurImport(chemin, `entier entre ${min} et ${max} attendu`); };
  const nombre = (v, chemin) => { if (typeof v !== 'number' || !isFinite(v)) throw erreurImport(chemin, 'nombre attendu'); };
  const tableau = (v, chemin, max) => {
    if (!Array.isArray(v)) throw erreurImport(chemin, 'tableau attendu');
    if (v.length > max) throw erreurImport(chemin, `${v.length} éléments, ${max} au plus`);
  };
  entier(g.season, 'G.season', 1, 10000);
  nombre(g.budget, 'G.budget');
  if (g.divIdx !== undefined) entier(g.divIdx, 'G.divIdx', 0, DIVISIONS.length - 1);
  const poules = g.poules !== undefined ? g.poules : (g.teams !== undefined ? [g.teams] : undefined);
  if (poules === undefined) throw erreurImport('G.poules', 'aucune équipe');
  tableau(poules, 'G.poules', IMPORT_BORNES.poules);
  if (!poules.length) throw erreurImport('G.poules', 'au moins une poule');
  const pouleIdx = g.poules !== undefined ? (g.pouleIdx === undefined ? 0 : g.pouleIdx) : 0;
  entier(pouleIdx, 'G.pouleIdx', 0, poules.length - 1);
  let humains = 0;
  poules.forEach((poule, k) => {
    tableau(poule, `G.poules[${k}]`, IMPORT_BORNES.equipes);
    if (poule.length < 2) throw erreurImport(`G.poules[${k}]`, 'au moins deux équipes');
    poule.forEach((t, i) => {
      const ch = `G.poules[${k}][${i}]`;
      if (!t || typeof t !== 'object') throw erreurImport(ch, 'équipe attendue');
      if (typeof t.name !== 'string' || !t.name) throw erreurImport(ch + '.name', 'nom attendu');
      if (t.id !== undefined) nombre(t.id, ch + '.id');        // interpolé dans un onclick (buyPlayer)
      tableau(t.players, ch + '.players', IMPORT_BORNES.joueurs);
      if (t.human) humains++;
      // v176 : la balise de maillot est facultative — aucune sauvegarde d'avant n'en a — mais
      // présente, elle doit être un objet de deux couleurs `#rrggbb` minuscules : elles finissent
      // dans un attribut `style`, et un refus nommé vaut mieux qu'une correction silencieuse.
      if (t.maillot !== undefined) {
        if (!t.maillot || typeof t.maillot !== 'object' || Array.isArray(t.maillot)) throw erreurImport(ch + '.maillot', 'objet attendu');
        ['corps', 'epaules'].forEach(z => {
          if (typeof t.maillot[z] !== 'string' || !/^#[0-9a-f]{6}$/.test(t.maillot[z])) throw erreurImport(`${ch}.maillot.${z}`, 'couleur #rrggbb attendue');
        });
      }
      t.players.forEach((p, j) => {
        const cp = `${ch}.players[${j}]`;
        if (!p || typeof p !== 'object') throw erreurImport(cp, 'joueur attendu');
        nombre(p.id, cp + '.id');
        if (typeof p.nom !== 'string') throw erreurImport(cp + '.nom', 'nom attendu');
        if (p.pos !== 'G' && p.pos !== 'D' && p.pos !== 'A') throw erreurImport(cp + '.pos', 'G, D ou A attendu');
        ['tir', 'def', 'vit', 'gar'].forEach(a => nombre(p[a], `${cp}.${a}`));
        // v179 : le numéro est facultatif — aucune sauvegarde d'avant n'en a, et un DOUBLON
        // n'est pas un motif de refus, la migration le répare. Mais présent, c'est un entier de
        // 0 à 99 : il finit dans du HTML, et « 07 » à côté de 7 est ce que le règlement interdit.
        if (p.num !== undefined) entier(p.num, cp + '.num', 0, 99);
      });
    });
  });
  if (humains !== 1) throw erreurImport('G.poules', `${humains} équipe(s) humaine(s), une attendue`);
  const calendriers = g.calendriers !== undefined ? g.calendriers : (g.schedule !== undefined ? [g.schedule] : undefined);
  if (calendriers !== undefined) {
    tableau(calendriers, 'G.calendriers', IMPORT_BORNES.poules);
    if (calendriers.length !== poules.length) throw erreurImport('G.calendriers', `${calendriers.length} calendrier(s) pour ${poules.length} poule(s)`);
    calendriers.forEach((cal, k) => {
      tableau(cal, `G.calendriers[${k}]`, IMPORT_BORNES.journees);
      cal.forEach((journee, d) => {
        tableau(journee, `G.calendriers[${k}][${d}]`, IMPORT_BORNES.equipes);
        journee.forEach((m, i) => {
          const cm = `G.calendriers[${k}][${d}][${i}]`;
          if (!m || typeof m !== 'object') throw erreurImport(cm, 'match attendu');
          entier(m.home, cm + '.home', 0, poules[k].length - 1);
          entier(m.away, cm + '.away', 0, poules[k].length - 1);
          if (m.score !== null && m.score !== undefined) {
            if (!(Array.isArray(m.score) && m.score.length === 2)) throw erreurImport(cm + '.score', 'nul ou [buts, buts] attendu');
            entier(m.score[0], cm + '.score[0]', 0, 99); entier(m.score[1], cm + '.score[1]', 0, 99);
          }
        });
      });
    });
    entier(g.day === undefined ? 0 : g.day, 'G.day', 0, calendriers[pouleIdx].length);
  } else if (g.day !== undefined) {
    entier(g.day, 'G.day', 0, IMPORT_BORNES.journees);
  }
  // Collections bornées sans présumer de leur forme : `market` est un objet, `inbox` un
  // tableau, et la migration complète ce qui manque.
  // Les collections ont le TYPE que le moteur leur donne — pas « un objet quelconque » (revue
  // de la v145, R2 : `history: {}` passait la validation et faisait lever le rendu). Absentes
  // ou nulles, la migration les crée ; présentes, elles ont la bonne forme et des éléments qui
  // sont des objets. Ce qui finit dans un attribut HTML est d'un type qui ne peut pas en
  // sortir : un type de lettre est une chaîne (ramenée à l'énumération par la migration), un
  // identifiant interpolé dans un onclick est un nombre.
  const objet = (o, chemin) => { if (!o || typeof o !== 'object' || Array.isArray(o)) throw erreurImport(chemin, 'objet attendu'); };
  const identifiant = (o, chemin) => { if (o.id !== undefined) nombre(o.id, chemin + '.id'); };
  const tableauObjets = (k, parElement) => {
    const v = g[k];
    if (v === undefined || v === null) return;
    tableau(v, 'G.' + k, IMPORT_BORNES[k]);
    v.forEach((e, i) => { objet(e, `G.${k}[${i}]`); if (parElement) parElement(e, `G.${k}[${i}]`); });
  };
  tableauObjets('inbox', (m, ch) => { if (m.type !== undefined && typeof m.type !== 'string') throw erreurImport(ch + '.type', 'texte attendu'); });
  tableauObjets('history');
  // Les joueurs hors équipe voyagent avec leur numéro : même exigence de type.
  const numeroFacultatif = (o, chemin) => { if (o.num !== undefined) entier(o.num, chemin + '.num', 0, 99); };
  tableauObjets('scoutPool', (e, ch) => { objet(e.p, ch + '.p'); identifiant(e.p, ch + '.p'); numeroFacultatif(e.p, ch + '.p'); });
  tableauObjets('loanedOut', (e, ch) => { identifiant(e, ch); numeroFacultatif(e, ch); });
  if (g.market !== undefined && g.market !== null) {
    objet(g.market, 'G.market');
    const roles = Object.keys(g.market);
    if (roles.length > IMPORT_BORNES.market) throw erreurImport('G.market', `${roles.length} postes, ${IMPORT_BORNES.market} au plus`);
    roles.forEach(r => {
      tableau(g.market[r], `G.market.${r}`, IMPORT_BORNES.market);
      g.market[r].forEach((c, i) => { objet(c, `G.market.${r}[${i}]`); identifiant(c, `G.market.${r}[${i}]`); });
    });
  }
}

// Témoin de chargement : la sentinelle d'`index.html` le relève, et arrête le jeu si la pièce
// manque plutôt que de le laisser déclarer illisibles quatre emplacements pleins.
if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.validation = true;

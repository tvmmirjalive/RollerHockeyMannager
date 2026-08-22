// textes-en.js — the game text in English
//
// Traduction. Ce qui n'est PAS traduit, et ne le sera pas : noms de joueurs, de clubs,
// de villes, de sponsors, prénoms de coachs. Ce sont des noms propres.
//
// Chargé par un <script> CLASSIQUE, pas un module ES : ceux-ci sont bloqués par CORS sous
// file://, et le jeu doit pouvoir s'ouvrir par double-clic.
//
// Une clé peut porter une chaîne, ou { un, autres } quand un pluriel est en jeu. Le
// français met 0 ET 1 au singulier, l'anglais met 0 au pluriel : c'est `REGLE_PLURIEL` qui
// tranche, pas ce fichier.
//
// Les marqueurs {nom} sont substitués par `T(cle, params)`. L'échappement reste à
// l'appelant : `T('cle', { nom: escHtml(p.nom) })`.

// Pas de garde `typeof` autour de cette affectation : `TEXTES` est déclaré dans le bloc
// d'amorçage de la page, donc toujours là. Un garde ferait échouer le chargement EN SILENCE
// si l'ordre changeait un jour — et c'est exactement le défaut qu'on a payé une fois.
Object.assign(TEXTES.en, {
  "ecran.effectif.label": "Squad",
  "ecran.effectif.court": "Squad",
  "ecran.club.label": "Club",
  "ecran.club.court": "Club",
  "ecran.entrainement.label": "Training",
  "ecran.entrainement.court": "Train.",
  "ecran.classement.label": "Standings",
  "ecran.classement.court": "Table",
  "ecran.calendrier.label": "Fixtures",
  "ecran.calendrier.court": "Fixtures",
  "ecran.transferts.label": "Transfers",
  "ecran.transferts.court": "Transf.",
  "ecran.inbox.label": "Messages",
  "ecran.inbox.court": "Messages",
  "ecran.historique.label": "History",
  "ecran.historique.court": "History",
  "ecran.coupe.label": "Cup",
  "ecran.coupe.court": "Cup",
  "ecran.aide.label": "Help",
  "ecran.aide.court": "Help",
  "ecran.options.label": "Settings",
  "ecran.options.court": "Settings",
  "reglages.langue.titre": "Language",
  "reglages.langue.note": "The whole game follows this choice. Player, club and town names stay as they are — they are proper nouns.",
  "reglages.son.titre": "Sound",
  "reglages.son.note": "The music changes with the screen. It stops on its own when you leave the app.",
  "reglages.son.active": "On",
  "reglages.son.coupee": "Muted",
  "reglages.son.volume": "Volume",
  "reglages.partie.titre": "Current game",
  "reglages.partie.note": "Go back to the title screen to switch slot or start another game. Yours is saved automatically — you will find it exactly as you left it.",
  "reglages.partie.retour": "Back to title screen",
  "reglages.partie.confirmer": "Back to title",
  "reglages.partie.question": "Go back to the title screen?\\n\\nYour game is saved — you will find it in this slot.",
  "reglages.barre.titre": "Bottom bar",
  "reglages.barre.note": "Choose which screens appear directly, and in what order. The rest stay available under the « More » button.",
  "reglages.barre.retirer": "Remove {ecran} from the bar",
  "reglages.barre.ajouter": "Add {ecran} to the bar",
  "reglages.barre.capacite": {"un": "This screen shows <b>{n} entry</b> at its current width ({largeur} px).", "autres": "This screen shows <b>{n} entries</b> at its current width ({largeur} px)."},
  "reglages.barre.reste": {"un": "The last screen is under « More ».", "autres": "The other {n} screens are under « More »."},
  "reglages.barre.tout": "Everything fits in the bar, the « More » button disappears.",
  "reglages.barre.elargis": "Widen the window and the bar fills out by itself.",
  "reglages.version": "version {n}",

  // ---- tranche 2 : bandeau, bouton d'action, tiroir
  "bandeau.saison": "season",
  "bandeau.journee": "matchday",
  "bandeau.budget": "Budget",
  "bandeau.objectif": "Target",
  "bandeau.direction": "Board",
  "bandeau.rang": "{rang} of {total}",
  "nav.plus": "More",
  "action.journee": "Play matchday {n}",
  "action.coupe.tirage": "Draw the Coupe de France",
  "action.coupe.resultats": "Coupe de France results",
  "action.coupe.jouer": "Play the Coupe de France tie",
  "action.playoffs.lancer": "Start the playoffs (Top 8)",
  "action.playoffs.final": "See the final playoff result",
  "action.playoffs.quart": "Play a quarter-final",
  "action.playoffs.demi": "Play a semi-final",
  "action.playoffs.finale": "Play a final",
  "action.bilan": "End-of-season review"
});

if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.textesen = true;

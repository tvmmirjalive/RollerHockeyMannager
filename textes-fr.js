// textes-fr.js — les textes du jeu en français
//
// Langue d'origine du jeu, et langue de repli de toutes les autres : quand une clé
// manque ailleurs, `T()` revient ici plutôt que de laisser un trou blanc.
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
Object.assign(TEXTES.fr, {
  "ecran.effectif.label": "Effectif",
  "ecran.effectif.court": "Effectif",
  "ecran.club.label": "Club",
  "ecran.club.court": "Club",
  "ecran.entrainement.label": "Entraînement",
  "ecran.entrainement.court": "Entraîn.",
  "ecran.classement.label": "Classement",
  "ecran.classement.court": "Classem.",
  "ecran.calendrier.label": "Calendrier",
  "ecran.calendrier.court": "Calend.",
  "ecran.transferts.label": "Transferts",
  "ecran.transferts.court": "Transf.",
  "ecran.inbox.label": "Messages",
  "ecran.inbox.court": "Messages",
  "ecran.historique.label": "Historique",
  "ecran.historique.court": "Histor.",
  "ecran.coupe.label": "Coupe",
  "ecran.coupe.court": "Coupe",
  "ecran.aide.label": "Aide",
  "ecran.aide.court": "Aide",
  "ecran.options.label": "Réglages",
  "ecran.options.court": "Réglages",
  "reglages.langue.titre": "Langue",
  "reglages.langue.note": "Le jeu tout entier suit ce choix. Les noms de joueurs, de clubs et de villes ne changent pas — ce sont des noms propres.",
  "reglages.son.titre": "Son",
  "reglages.son.note": "La musique change selon l'écran. Elle se coupe toute seule quand tu quittes l'application.",
  "reglages.son.active": "Activée",
  "reglages.son.coupee": "Coupée",
  "reglages.son.volume": "Volume",
  "reglages.partie.titre": "Partie en cours",
  "reglages.partie.note": "Reviens à l'écran titre pour changer d'emplacement ou démarrer une autre partie. La tienne est sauvegardée automatiquement, tu la retrouveras telle quelle.",
  "reglages.partie.retour": "Retour à l'écran titre",
  "reglages.partie.confirmer": "Revenir au titre",
  "reglages.partie.question": "Revenir à l'écran titre ?\\n\\nTa partie est sauvegardée, tu la retrouveras à cet emplacement.",
  "reglages.barre.titre": "Barre du bas",
  "reglages.barre.note": "Choisis les écrans qui apparaissent directement, et leur ordre. Les autres restent accessibles par le bouton « Plus ».",
  "reglages.barre.retirer": "Retirer {ecran} de la barre",
  "reglages.barre.ajouter": "Ajouter {ecran} à la barre",
  "reglages.barre.capacite": {"un": "Cet écran affiche <b>{n} entrée</b> à sa largeur actuelle ({largeur} px).", "autres": "Cet écran affiche <b>{n} entrées</b> à sa largeur actuelle ({largeur} px)."},
  "reglages.barre.reste": {"un": "Le dernier écran est dans « Plus ».", "autres": "Les {n} écrans restants sont dans « Plus »."},
  "reglages.barre.tout": "Tout tient dans la barre, le bouton « Plus » disparaît.",
  "reglages.barre.elargis": "Élargis la fenêtre et la barre s'étoffe d'elle-même.",
  "reglages.version": "version {n}",

  // ---- tranche 2 : bandeau, bouton d'action, tiroir
  "bandeau.saison": "saison",
  "bandeau.journee": "journée",
  "bandeau.budget": "Budget",
  "bandeau.objectif": "Objectif",
  "bandeau.direction": "Direction",
  "bandeau.rang": "{rang}e/{total}",
  "nav.plus": "Plus",
  "action.journee": "Jouer la journée {n}",
  "action.coupe.tirage": "Lancer le tirage de la Coupe de France",
  "action.coupe.resultats": "Résultats de la Coupe de France",
  "action.coupe.jouer": "Jouer le match de Coupe de France",
  "action.playoffs.lancer": "Lancer les playoffs (Top 8)",
  "action.playoffs.final": "Voir le résultat final des playoffs",
  "action.playoffs.quart": "Jouer un match de quart de finale",
  "action.playoffs.demi": "Jouer un match de demi-finale",
  "action.playoffs.finale": "Jouer un match de la finale",
  "action.bilan": "Bilan de fin de saison"
});

if (typeof PIECES_CHARGEES === 'object') PIECES_CHARGEES.textesfr = true;

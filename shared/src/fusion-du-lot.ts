/**
 * LA FUSION DU LOT : QUI RÉSOUT, DANS QUEL ORDRE, ET CE QUI S'ÉCRIT.
 *
 * L'audit du 18/08/2026 (`docs/audit-fusion-deploiement.md`) a chiffré la
 * fusion des branches sur 175 publications : elle pèse **66 % du temps de
 * publication**, et **98 % de ce temps part dans les conflits** — 2,1 s pour
 * une fusion propre, 370 s pour une fusion en conflit. Quatre défauts
 * mesurés, quatre règles ici, toutes PURES (ni base, ni disque, ni git) :
 *
 * 1. UN CONFLIT EST DE LA PLOMBERIE, PAS UN CHANTIER. `resoudreConflit`
 *    créait son agent avec `run: card.run`, c'est-à-dire le modèle et la
 *    réflexion de la carte en conflit : 59 fusions sur 99 faites par Opus 5,
 *    102 millions de jetons en seize jours pour recoller deux versions d'un
 *    même fichier. La première passe se fait donc sur le modèle LÉGER du
 *    moteur, avec une réflexion moyenne ; le modèle de la carte ne reprend la
 *    main qu'en SECONDE passe, si la légère a échoué. On ne perd donc aucune
 *    résolution, on cesse seulement de payer la plus chère d'emblée.
 *
 * 2. LES BRANCHES QUI NE SE HEURTENT À RIEN PASSENT D'ABORD. Les branches
 *    étaient fusionnées dans l'ordre des cartes, et chacune se heurtait au
 *    cumul des précédentes : 0,11 conflit en moyenne pour un lot d'une
 *    branche, 2,00 pour un lot de dix. Passer les propres devant ne change
 *    aucun résultat — les mêmes branches partent — mais retire du chemin des
 *    conflictuelles tout ce qui n'avait aucune raison d'y être.
 *
 * 3. LE DÉTAIL D'UNE ÉTAPE NE SE RECOPIE PLUS, ET NE PERD PLUS SA TÊTE.
 *    `setStep` AJOUTE son texte à `step.log` ; la boucle de fusion lui
 *    repassait le journal ENTIER à chaque conflit, d'où des lignes répétées
 *    autant de fois qu'il y avait eu de conflits (175 lignes « CONFLIT » pour
 *    78 conflits réels), puis une troncature par la fin qui effaçait les
 *    PREMIÈRES branches du lot — exactement ce qu'on venait y chercher.
 *
 * 4. UN GROS LOT SE DIT AVANT D'ÊTRE LANCÉ. Ce qui se heurte est déjà connu
 *    avant le clic (`conflitsPrevus`, `git merge-tree` en mémoire) : on
 *    l'annonce, et on propose de publier en deux fois.
 *
 * 5. UN HEURT DE DOCUMENTATION SE RECOLLE SANS APPELER PERSONNE. 58 des 78
 *    conflits mesurés portaient sur `CLAUDE.md` et `MEMOIRE.md` — deux fichiers
 *    de TEXTE que chaque agent complète en fin de tâche, jamais du code. Les
 *    recoller, c'est exactement ce qu'on demandait à l'agent de faire (« garde
 *    les deux intentions ») : on le fait donc mécaniquement, sans moteur, sans
 *    tour et sans attente.
 *
 * 6. ON VOIT OÙ EN EST CHAQUE TÂCHE DU LOT. Le déroulé racontait les ÉTAPES ;
 *    il ne disait pas, d'un coup d'œil, laquelle des dix cartes était passée,
 *    laquelle se faisait recoller et laquelle venait d'être écartée.
 */

import type { IdMoteur, MoteurCatalogue, ModeleCatalogue } from './reglages-proposition.js';

/* ------------------------------------------------------------------ */
/* 1. Le modèle qui résout un conflit                                  */
/* ------------------------------------------------------------------ */

/** La réflexion visée pour une résolution de conflit : ni zéro, ni une analyse. */
export const REFLEXION_DE_FUSION = 'medium';

/**
 * Les familles reconnues comme légères quand le catalogue n'annonce pas
 * d'appétit. Même prudence que `modele-econome.ts` : on ne devine rien de plus,
 * un moteur dont on ne sait rien garde le modèle de la carte.
 */
const FAMILLES_LEGERES = ['haiku', 'mini', 'flash'];

export interface RunDeFusion {
  engine?: IdMoteur;
  model?: string;
  thinking?: string;
  mode?: 'direct' | 'plan';
}

/** Le modèle le plus léger que CE moteur propose vraiment, ou rien. */
function modeleLeger(moteur: MoteurCatalogue): ModeleCatalogue | undefined {
  const parAppetit = moteur.models.find((m) => m.appetite === 'light');
  if (parAppetit) return parAppetit;
  for (const famille of FAMILLES_LEGERES) {
    const trouve = moteur.models.find(
      (m) => m.id.toLowerCase().includes(famille) || (m.label ?? '').toLowerCase().includes(famille),
    );
    if (trouve) return trouve;
  }
  return undefined;
}

/** Le cran demandé s'il existe pour ce modèle, sinon celui du modèle, sinon le premier. */
function cranPossible(modele: ModeleCatalogue, voulu: string): string | undefined {
  const crans = modele.thinking.map((t) => t.id);
  if (!crans.length) return undefined;
  if (crans.includes(voulu)) return voulu;
  if (modele.defaultThinking && crans.includes(modele.defaultThinking)) return modele.defaultThinking;
  return crans[0];
}

/**
 * LE RÉGLAGE DE LA PREMIÈRE PASSE : le modèle léger du MÊME moteur que la
 * carte — on ne change jamais de moteur au passage, une session Codex ne se
 * poursuit pas sous Claude.
 *
 * Rend `undefined` quand il n'y a rien à alléger : moteur inconnu du
 * catalogue, aucun modèle léger annoncé, ou carte déjà réglée sur ce
 * modèle-là. L'appelant part alors sur le run de la carte, comme avant.
 */
export function runDeFusionLegere(
  runDeLaCarte: RunDeFusion | undefined,
  catalogue: readonly MoteurCatalogue[],
): RunDeFusion | undefined {
  const moteur = catalogue.find((m) => m.id === runDeLaCarte?.engine);
  if (!moteur?.models.length) return undefined;
  const modele = modeleLeger(moteur);
  if (!modele) return undefined;
  if (modele.id === runDeLaCarte?.model) return undefined;
  return {
    engine: moteur.id,
    model: modele.id,
    thinking: cranPossible(modele, REFLEXION_DE_FUSION),
    // Le mode de conduite reste celui de la carte : il ne dit pas la dépense.
    mode: runDeLaCarte?.mode,
  };
}

/**
 * LES PASSES DE RÉSOLUTION, dans l'ordre, chacune avec son réglage et le mot
 * qui la nomme au journal. Une seule passe quand il n'y a rien à alléger : on
 * ne rappelle jamais deux fois le même modèle sur le même conflit.
 */
export function passesDeResolution(
  runDeLaCarte: RunDeFusion | undefined,
  catalogue: readonly MoteurCatalogue[],
): { nom: 'legere' | 'carte'; run: RunDeFusion | undefined }[] {
  const legere = runDeFusionLegere(runDeLaCarte, catalogue);
  if (!legere) return [{ nom: 'carte', run: runDeLaCarte }];
  return [
    { nom: 'legere', run: legere },
    { nom: 'carte', run: runDeLaCarte },
  ];
}

/* ------------------------------------------------------------------ */
/* 2. L'ordre de fusion des branches                                   */
/* ------------------------------------------------------------------ */

/** Ce qu'on sait d'une branche du lot avant de la fusionner. */
export interface BrancheDuLot {
  cardId: string;
  /** La prévision `git merge-tree` : cette branche se heurte-t-elle à la cible ? */
  heurte: boolean;
}

/**
 * LES PROPRES D'ABORD, LES CONFLICTUELLES ENSUITE, chacune gardant sa place
 * dans son groupe. Une prévision vide (dépôt illisible, git trop ancien) rend
 * l'ordre d'origine : on ne réordonne jamais à l'aveugle.
 */
export function ordreDeFusion<T extends BrancheDuLot>(branches: readonly T[]): T[] {
  return [...branches.filter((b) => !b.heurte), ...branches.filter((b) => b.heurte)];
}

/** Ce que l'ordre retenu change, dit au journal de l'étape — ou rien. */
export function mentionDeLOrdre(heurts: number, total: number): string | null {
  if (!heurts || heurts >= total) return null;
  return `${total - heurts} branche(s) sans heurt fusionnée(s) en premier, ${heurts} conflictuelle(s) ensuite.`;
}

/* ------------------------------------------------------------------ */
/* 3. Le détail d'une étape, borné par les DEUX bouts                  */
/* ------------------------------------------------------------------ */

/** La taille gardée pour le détail d'une étape, dans la base comme à l'écran. */
export const DETAIL_ETAPE_MAX = 4000;

const COUPURE = '\n[…détail trop long : le milieu a été retiré…]\n';

/**
 * LE DÉTAIL D'UNE ÉTAPE S'ALLONGE, ET GARDE SES DEUX BOUTS.
 *
 * Il ne se coupait que par la FIN, donc un lot de dix branches perdait les
 * premières — celles qu'on venait justement relire. On garde donc le DÉBUT
 * (quelle branche a ouvert le bal, la cible retenue) et la FIN (où l'on en
 * est), et on DIT que le milieu manque.
 */
export function detailDeLEtape(avant: string, ajout: string, max = DETAIL_ETAPE_MAX): string {
  const entier = ajout ? (avant ? `${avant}\n${ajout}` : ajout) : avant;
  if (entier.length <= max) return entier;
  const garde = Math.max(1, Math.floor((max - COUPURE.length) / 2));
  return entier.slice(0, garde) + COUPURE + entier.slice(-garde);
}

/**
 * LES LIGNES PAS ENCORE ÉCRITES. `setStep` AJOUTE ce qu'on lui donne : lui
 * repasser le journal entier à chaque conflit le recopiait autant de fois
 * qu'il y avait eu de conflits. L'appelant ne lui donne donc que la suite.
 */
export function lignesNouvelles(toutes: readonly string[], dejaEcrites: number): string {
  return toutes.slice(Math.max(0, dejaEcrites)).join('\n');
}

/* ------------------------------------------------------------------ */
/* 4. Prévenir avant de lancer un gros lot                             */
/* ------------------------------------------------------------------ */

/**
 * L'ANNONCE D'AVANT-CLIC : combien de branches du lot se heurtent déjà.
 * Rendue `null` quand il n'y a rien à annoncer — aucun heurt, ou une seule
 * branche, où publier en deux fois ne veut rien dire.
 */
export function annonceDeHeurts(heurts: number, total: number): string | null {
  if (heurts <= 0 || total <= 1) return null;
  const s = heurts > 1 ? 's' : '';
  return `${heurts} tâche${s} sur ${total} se heurte${s ? 'nt' : ''} déjà à la branche d’accueil : leur fusion demandera un agent de dépannage.`;
}

/**
 * PUBLIER EN DEUX FOIS : ne garder, pour ce coup-ci, que les tâches qui ne se
 * heurtent à rien. Les autres restent dans « À déployer » et repartiront
 * seules, sans le cumul du lot.
 *
 * Rendu vide quand tout se heurte : il n'y aurait plus rien à publier, et
 * l'écran de sélection le dit déjà.
 */
export function selectionSansHeurts(
  toutes: readonly { id: string }[],
  cartesQuiHeurtent: readonly string[],
): Set<string> {
  const heurtent = new Set(cartesQuiHeurtent);
  const propres = toutes.filter((carte) => !heurtent.has(carte.id));
  return new Set(propres.map((carte) => carte.id));
}

/* ------------------------------------------------------------------ */
/* 5. Les heurts de DOCUMENTATION se recollent sans moteur             */
/* ------------------------------------------------------------------ */

/**
 * LES FICHIERS QUE TOUS LES AGENTS ÉCRIVENT, ET QUI SE HEURTENT POUR ÇA.
 *
 * 44 conflits sur `CLAUDE.md`, 14 sur `MEMOIRE.md`, 8 sur `docs/memoire/…` :
 * 74 % du total, pour des fichiers de TEXTE que le briefing demande à chaque
 * agent de compléter en fin de tâche. Dix cartes lancées le même jour écrivent
 * dix versions des mêmes lignes.
 *
 * La liste est FERMÉE et elle ne contient QUE de la documentation en LISTE —
 * de la prose qu'on ajoute, jamais de code, jamais un réglage, jamais un
 * fichier dont l'ordre des lignes porte un sens exécutable. Un `.md` qui n'y
 * figure pas (un README de projet, une page de spécification) suit le chemin
 * ordinaire : un agent le lit et tranche.
 */
export const DOCUMENTS_RECOLLABLES: readonly string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  'MEMOIRE.md',
  'HISTORIQUE.md',
  'docs/instructions-en-attente.md',
  'docs/regles-du-moteur.md',
  'docs/verifications.md',
];

/** Les dossiers dont TOUT le contenu Markdown est de la documentation en liste. */
const DOSSIERS_RECOLLABLES: readonly string[] = [
  'docs/memoire/',
  'docs/regles/',
  'docs/mecaniques/',
  // Le dépôt des règles apprises, un fichier par carte : deux cartes n'y
  // écrivent plus la même ligne, mais le filet reste posé pour une carte
  // reprise qui reviendrait sur son propre fichier.
  'docs/instructions-en-attente/',
];

/** Ce fichier-là peut-il se recoller mécaniquement, sans qu'un agent tranche ? */
export function documentRecollable(chemin: string): boolean {
  const propre = chemin.trim().replace(/^\.\//, '');
  if (DOCUMENTS_RECOLLABLES.includes(propre)) return true;
  return DOSSIERS_RECOLLABLES.some((dossier) => propre.startsWith(dossier) && propre.endsWith('.md'));
}

/** Tous les fichiers en conflit sont-ils de la documentation recollable ? */
export function conflitPurementDocumentaire(fichiers: readonly string[]): boolean {
  return fichiers.length > 0 && fichiers.every((fichier) => documentRecollable(fichier));
}

const DEBUT_CONFLIT = /^<{7}(\s|$)/;
const BASE_CONFLIT = /^\|{7}(\s|$)/;
const MILIEU_CONFLIT = /^={7}(\s|$)/;
const FIN_CONFLIT = /^>{7}(\s|$)/;

/**
 * RECOLLER UN FICHIER EN GARDANT LES DEUX INTENTIONS — le geste exact qu'on
 * demandait à l'agent, fait sans lui.
 *
 * Pour chaque bloc en conflit : d'abord les lignes de la branche d'ACCUEIL,
 * puis celles de la branche de la CARTE qui n'y figurent pas déjà. L'ordre
 * d'accueil est donc préservé, et rien n'est perdu — c'est la propriété qui
 * compte pour un sommaire de mémoire ou une liste d'instructions en attente.
 *
 * La comparaison ignore les espaces de bord : deux agents qui ajoutent la MÊME
 * ligne ne la font pas apparaître deux fois. Une ligne vide, elle, n'est jamais
 * dédoublonnée — elle sépare des paragraphes, elle n'est pas un contenu.
 *
 * Rend `null` — et l'agent reprend la main — dès que le texte n'est pas
 * exactement ce qu'on attend : marqueurs mal formés, imbriqués, ou aucun
 * conflit à recoller. On ne bricole pas un fichier qu'on ne comprend pas.
 */
export function recollerLesDeuxIntentions(texte: string): string | null {
  const lignes = texte.split('\n');
  const rendu: string[] = [];
  let accueil: string[] | null = null;
  let carte: string[] | null = null;
  // `base` n'est gardée que pour être JETÉE : le style de conflit « diff3 »
  // intercale l'ancêtre commun, qui n'est l'intention de personne.
  let dansLaBase = false;
  let blocs = 0;

  for (const ligne of lignes) {
    if (DEBUT_CONFLIT.test(ligne)) {
      // Un conflit dans un conflit ne se recolle pas : on rend la main.
      if (accueil) return null;
      accueil = [];
      carte = null;
      dansLaBase = false;
      continue;
    }
    if (accueil && BASE_CONFLIT.test(ligne)) {
      if (carte) return null;
      dansLaBase = true;
      continue;
    }
    if (accueil && MILIEU_CONFLIT.test(ligne)) {
      if (carte) return null;
      dansLaBase = false;
      carte = [];
      continue;
    }
    if (FIN_CONFLIT.test(ligne)) {
      if (!accueil || !carte) return null;
      const vues = new Set(accueil.map((l) => l.trim()).filter(Boolean));
      rendu.push(...accueil);
      rendu.push(...carte.filter((l) => !l.trim() || !vues.has(l.trim())));
      accueil = null;
      carte = null;
      dansLaBase = false;
      blocs += 1;
      continue;
    }

    if (dansLaBase) continue;
    if (carte) carte.push(ligne);
    else if (accueil) accueil.push(ligne);
    else rendu.push(ligne);
  }

  // Un marqueur ouvert et jamais refermé, ou rien à recoller du tout.
  if (accueil || carte || !blocs) return null;
  return rendu.join('\n');
}

/** Ce qui s'écrit au fil quand un heurt de documentation a été recollé seul. */
export function mentionDuRecollage(fichiers: readonly string[]): string {
  const combien = fichiers.length > 1 ? `${fichiers.length} fichiers de documentation` : fichiers[0];
  return `heurt de documentation recollé sans agent (${combien}) : les deux intentions ont été gardées`;
}

/* ------------------------------------------------------------------ */
/* 6. Où en est chaque tâche du lot                                    */
/* ------------------------------------------------------------------ */

/**
 * L'ÉTAT D'UNE TÂCHE DU LOT DANS LA MISE EN LIGNE. Sept états, et pas un de
 * plus : chacun correspond à une issue réellement possible de la fusion, plus
 * l'arrivée en ligne.
 */
export type EtatDeTache =
  | 'attente'
  | 'fusion'
  | 'conflit'
  | 'recollee'
  | 'fusionnee'
  | 'ecartee'
  | 'absente'
  | 'en-ligne';

/** Ce que chaque état veut dire, en français simple — le texte de l'écran. */
export const LIBELLE_ETAT_TACHE: Record<EtatDeTache, string> = {
  attente: 'en attente',
  fusion: 'fusion en cours',
  conflit: 'conflit, résolution en cours',
  recollee: 'recollée toute seule',
  fusionnee: 'fusionnée',
  ecartee: 'écartée du lot',
  absente: 'branche absente',
  'en-ligne': 'en ligne',
};

/**
 * L'état qui compte quand on regarde la liste de loin : ce qui a ABOUTI, ce
 * qui TRAVAILLE, ce qui a MAL TOURNÉ. C'est ce qui donne sa couleur à la ligne
 * — la même convention que partout : orange pour ce qui est en cours, bleu pour
 * ce qui est terminé.
 */
export function natureDeLEtat(etat: EtatDeTache): 'attente' | 'encours' | 'fait' | 'ecart' {
  if (etat === 'attente') return 'attente';
  if (etat === 'fusion' || etat === 'conflit') return 'encours';
  if (etat === 'ecartee' || etat === 'absente') return 'ecart';
  return 'fait';
}

export interface TacheDuLot {
  cardId: string;
  titre: string;
  branche?: string;
  etat: EtatDeTache;
  detail?: string;
}

/**
 * LE RÉSUMÉ DU LOT, en une ligne : ce qui est passé, ce qui travaille, ce qui
 * est resté au bord. Rendu vide quand il n'y a rien à résumer — un lot d'une
 * tâche se lit tout seul dans la liste juste dessous.
 */
export function resumeDuLot(taches: readonly TacheDuLot[]): string {
  if (taches.length < 2) return '';
  const parts: string[] = [];
  const compte = (predicat: (t: TacheDuLot) => boolean) => taches.filter(predicat).length;
  const faites = compte((t) => natureDeLEtat(t.etat) === 'fait');
  const enCours = compte((t) => natureDeLEtat(t.etat) === 'encours');
  const ecarts = compte((t) => natureDeLEtat(t.etat) === 'ecart');
  const attente = compte((t) => t.etat === 'attente');
  if (faites) parts.push(`${faites} passée${faites > 1 ? 's' : ''}`);
  if (enCours) parts.push(`${enCours} en cours`);
  if (attente) parts.push(`${attente} en attente`);
  if (ecarts) parts.push(`${ecarts} écartée${ecarts > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/**
 * POSER UN ÉTAT SUR UNE TÂCHE, sans jamais toucher aux autres. Une liste vide
 * ou un identifiant inconnu rend la liste telle quelle : la fusion ne s'arrête
 * pas parce qu'une carte a disparu du lot entre-temps.
 */
export function avecEtatDeTache(
  taches: readonly TacheDuLot[],
  cardId: string,
  etat: EtatDeTache,
  detail?: string,
): TacheDuLot[] {
  return taches.map((tache) =>
    tache.cardId === cardId ? { ...tache, etat, detail: detail ?? tache.detail } : tache,
  );
}

/**
 * TOUT CE QUI EST PASSÉ EST EN LIGNE — le dernier mot du lot, écrit une fois la
 * publication réussie. Ce qui a été écarté ne change pas d'état : la carte est
 * restée dans « À déployer », et le dire autrement serait un mensonge.
 */
export function lotMisEnLigne(taches: readonly TacheDuLot[]): TacheDuLot[] {
  return taches.map((tache) =>
    natureDeLEtat(tache.etat) === 'ecart' ? tache : { ...tache, etat: 'en-ligne' as EtatDeTache },
  );
}

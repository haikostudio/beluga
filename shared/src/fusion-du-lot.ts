/**
 * LA FUSION DU LOT : DANS QUEL ORDRE, ET CE QUI S'ÉCRIT.
 *
 * L'audit du 18/08/2026 (`docs/audit-fusion-deploiement.md`) a chiffré la
 * fusion des branches sur 175 publications : elle pèse **66 % du temps de
 * publication**, et **98 % de ce temps part dans les conflits** — 2,1 s pour
 * une fusion propre, 370 s pour une fusion en conflit. Les règles d'ici sont
 * toutes PURES (ni base, ni disque, ni git) :
 *
 * 1. LES BRANCHES QUI NE SE HEURTENT À RIEN PASSENT D'ABORD. Les branches
 *    étaient fusionnées dans l'ordre des cartes, et chacune se heurtait au
 *    cumul des précédentes : 0,11 conflit en moyenne pour un lot d'une
 *    branche, 2,00 pour un lot de dix. Passer les propres devant ne change
 *    aucun résultat — les mêmes branches partent — mais retire du chemin des
 *    conflictuelles tout ce qui n'avait aucune raison d'y être.
 *
 * 2. LE DÉTAIL D'UNE ÉTAPE NE SE RECOPIE PLUS, ET NE PERD PLUS SA TÊTE.
 *    `setStep` AJOUTE son texte à `step.log` ; la boucle de fusion lui
 *    repassait le journal ENTIER à chaque conflit, d'où des lignes répétées
 *    autant de fois qu'il y avait eu de conflits (175 lignes « CONFLIT » pour
 *    78 conflits réels), puis une troncature par la fin qui effaçait les
 *    PREMIÈRES branches du lot — exactement ce qu'on venait y chercher.
 *
 * 3. UN GROS LOT SE DIT AVANT D'ÊTRE LANCÉ. Ce qui se heurte est déjà connu
 *    avant le clic (`conflitsPrevus`, `git merge-tree` en mémoire) : on
 *    l'annonce, et on propose de publier en deux fois.
 *
 * 4. UN HEURT DE DOCUMENTATION SE RECOLLE SANS APPELER PERSONNE. 58 des 78
 *    conflits mesurés portaient sur `CLAUDE.md` et `MEMOIRE.md` — deux fichiers
 *    de TEXTE que chaque agent complète en fin de tâche, jamais du code. Les
 *    recoller, c'est exactement ce qu'on demandait à l'agent de faire (« garde
 *    les deux intentions ») : on le fait donc mécaniquement, sans moteur, sans
 *    tour et sans attente.
 *
 * 5. ON VOIT OÙ EN EST CHAQUE TÂCHE DU LOT. Le déroulé racontait les ÉTAPES ;
 *    il ne disait pas, d'un coup d'œil, laquelle des dix cartes était passée,
 *    laquelle se faisait recoller et laquelle venait d'être écartée.
 */

/* ------------------------------------------------------------------ */
/* 1. L'ordre de fusion des branches                                   */
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

/* ------------------------------------------------------------------ */
/* 2. Le détail d'une étape, borné par les DEUX bouts                  */
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

/* ------------------------------------------------------------------ */
/* 3. Prévenir avant de lancer un gros lot                             */
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
/* 4. Les heurts de DOCUMENTATION se recollent sans moteur             */
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
/* 5. Où en est chaque tâche du lot                                    */
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
  /** Une tâche ÉCARTÉE : les fichiers en heurt et les cartes du lot contre qui (`cartesHeurtees`). */
  ecart?: EcartStructure;
  /** Le rattrapage de la carte écartée, une fois décidé (`shared/src/rattrapage-ecartee.ts`). */
  rattrapage?: RattrapageDeTache;
}

/** Ce qu'une tâche écartée garde de son heurt, pour l'écran et pour la demande de réconciliation. */
export interface EcartStructure {
  fichiers: string[];
  brancheDAccueil?: string;
  contre: CarteHeurtee[];
}

/**
 * L'ÉTAT DU RATTRAPAGE d'une carte écartée. `prevu` : il partira après la
 * publication (et après le redémarrage retenu) ; `attente-quota` : aucun compte
 * n'avait de quota, il repartira seul ; `lance` : l'agent de la carte
 * réconcilie ; `revenu` : la carte est revenue dans « À déployer » ; `echec` :
 * le tour s'est fini sans la ramener ; `sans-objet` : la carte avait bougé.
 */
export type EtatDuRattrapage = 'prevu' | 'attente-quota' | 'lance' | 'revenu' | 'echec' | 'sans-objet';

export interface RattrapageDeTache {
  etat: EtatDuRattrapage;
  at: number;
  /** Qui l'a déclenché : la fin de publication, ou le bouton « Réconcilier ». */
  par?: 'automatique' | 'humain';
  /** Le redémarrage du démon doit-il passer avant (DEC-166) ? */
  apresRedemarrage?: boolean;
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

/* ------------------------------------------------------------------ */
/* 6. Une carte écartée dit ce qui heurte, et contre qui               */
/* ------------------------------------------------------------------ */

/**
 * CE QU'UNE CARTE DU LOT A APPORTÉ, une fois fusionnée : ses fichiers. C'est
 * ce qui permet, quand la suivante heurte, de nommer CONTRE QUI.
 */
export interface CarteFusionneeDuLot {
  cardId: string;
  titre: string;
  branche?: string;
  /** L'enregistrement de tête de sa branche, au moment de sa fusion. */
  commit?: string;
  /** Les fichiers que sa fusion a changés sur la branche d'accueil. */
  fichiers: readonly string[];
}

/** Une carte du lot que la carte écartée heurte, et sur quels fichiers. */
export interface CarteHeurtee {
  cardId: string;
  titre: string;
  branche?: string;
  commit?: string;
  fichiers: string[];
}

/**
 * CONTRE QUELLES CARTES DU LOT CETTE BRANCHE SE HEURTE. Constat : une carte
 * écartée du lot disait « conflit toujours présent après passage de l'agent »
 * — ni QUELS fichiers, ni QUELLE carte du même lot venait de les changer. Il
 * fallait rouvrir le dépôt pour comprendre, et souvent relancer à l'aveugle.
 *
 * On croise donc les fichiers en conflit avec ceux qu'ont apportés les cartes
 * déjà fusionnées de CE lot, dans l'ordre où elles sont passées. Une liste vide
 * veut dire que le heurt vient de ce qui était DÉJÀ sur la branche d'accueil
 * avant le lot — et la phrase le dira, plutôt que de nommer une carte au hasard.
 */
export function cartesHeurtees(
  fichiersEnConflit: readonly string[],
  fusionnees: readonly CarteFusionneeDuLot[],
): CarteHeurtee[] {
  const heurtes = new Set(fichiersEnConflit.map((f) => f.trim()).filter(Boolean));
  if (!heurtes.size) return [];
  const resultat: CarteHeurtee[] = [];
  for (const carte of fusionnees) {
    const communs = carte.fichiers.map((f) => f.trim()).filter((f) => heurtes.has(f));
    if (communs.length) {
      resultat.push({
        cardId: carte.cardId,
        titre: carte.titre,
        branche: carte.branche,
        ...(carte.commit ? { commit: carte.commit } : {}),
        fichiers: communs,
      });
    }
  }
  return resultat;
}

/** Combien de fichiers une phrase d'écartement nomme au plus, avant « et N autres ». */
export const FICHIERS_NOMMES_MAX = 8;

/** Une liste de fichiers dite en une ligne, bornée. */
export function listeDeFichiers(fichiers: readonly string[], max = FICHIERS_NOMMES_MAX): string {
  const propres = fichiers.map((f) => f.trim()).filter(Boolean);
  if (!propres.length) return 'fichiers non identifiés';
  const montres = propres.slice(0, max);
  const reste = propres.length - montres.length;
  return reste > 0 ? `${montres.join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}` : montres.join(', ');
}

export interface EcartementDuLot {
  /** La branche de la carte écartée. */
  branche: string;
  /** La branche d'accueil du lot (« dev », « main »…). */
  brancheDAccueil: string;
  /** Les fichiers restés en conflit. */
  fichiers: readonly string[];
  /** Les cartes du lot que ces fichiers heurtent (`cartesHeurtees`). */
  contre: readonly CarteHeurtee[];
  /** L'issue de la résolution, en français (« conflit toujours présent après passage de l'agent »). */
  recit?: string;
}

/**
 * LA PHRASE DE L'ÉCARTEMENT, écrite UNE fois pour le journal de publication,
 * le volet du lot et le journal de la carte. Elle nomme les fichiers, puis
 * chaque carte du lot heurtée avec les fichiers communs — ou, faute de carte,
 * dit que le heurt vient de la branche d'accueil elle-même.
 */
export function mentionDeLEcartement(ecart: EcartementDuLot): string {
  const fichiers = listeDeFichiers(ecart.fichiers);
  const contre = ecart.contre.length
    ? ecart.contre
        .map((carte) => `« ${carte.titre} »${carte.branche ? ` (${carte.branche})` : ''} sur ${listeDeFichiers(carte.fichiers)}`)
        .join(' ; ')
    : `ce qui était déjà sur « ${ecart.brancheDAccueil} » avant ce lot — aucune carte du lot n’a touché ces fichiers`;
  const issue = ecart.recit?.trim() ? ` ${ecart.recit.trim()}.` : '';
  return `${ecart.branche} écartée du lot : heurt sur ${fichiers}, contre ${contre}.${issue}`;
}

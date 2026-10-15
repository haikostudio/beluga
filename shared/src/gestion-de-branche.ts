import { estLaBrancheDeLaCarte, nomDeBranche } from './branche-de-carte.js';
import { BRANCHES_TOUJOURS_PROTEGEES, PREFIXE_ARCHIVE } from './archivage-de-branche.js';

/**
 * LA BRANCHE D'UNE CARTE SE GÈRE À LA MAIN, FAÇON CONDUCTOR.
 *
 * Demande de l'utilisateur : voir dans quelle branche travaille une tâche et la
 * gérer soi-même — la renommer, en créer une depuis un départ choisi, reprendre
 * celle d'une autre tâche, changer de branche en décidant ce que devient le
 * travail déjà fait. Le bouton vit au bout du fil d'Ariane de la carte.
 *
 * Choix tranchés au cadrage :
 *  - « dev », « main » et les branches de publication réglées ne sont JAMAIS
 *    une branche de travail : elles ne se proposent pas ;
 *  - une branche se partage entre tâches, mais L'UNE APRÈS L'AUTRE : celle où
 *    l'agent d'une autre carte travaille est grisée, avec sa raison ;
 *  - un nom de branche garde son préfixe « tache/ » : l'archivage et le ménage
 *    des copies reconnaissent les branches des cartes par lui
 *    (`brancheRefermableALArchivage`) ;
 *  - la destination ne change pas : la branche part toujours avec le lot
 *    « À déployer », vers la branche de déploiement puis la production.
 *
 * Les règles vivent ici, sans base ni disque ; le démon parle à git
 * (`server/src/gestion-de-branche.ts`), l'écran les affiche
 * (`web/src/components/bouton-de-branche.tsx`).
 */

/** Le préfixe imposé à toute branche de travail. */
export const PREFIXE_BRANCHE_DE_TACHE = 'tache/';

/** Ce qu'il faut d'une carte pour connaître sa branche. */
export interface CarteABranche {
  id: string;
  title: string;
  brancheChoisie?: string;
  /** Le suivi GitHub : `branch` est la branche RÉELLE posée au lancement. */
  github?: { branch?: string; brancheSupprimee?: boolean };
}

/**
 * LA BRANCHE D'UNE CARTE : celle qu'on a choisie, sinon celle que tire le
 * titre. Tout ce qui ouvre, referme, archive ou publie la branche d'une carte
 * passe par ici — plus jamais par `nomDeBranche` seul, qui perdrait une
 * branche renommée ou reprise.
 */
export function brancheDeLaCarte(card: CarteABranche): string {
  const choisie = (card.brancheChoisie ?? '').trim();
  if (choisie) return choisie;
  /* UNE CARTE DÉJÀ LANCÉE GARDE LA BRANCHE QU'ELLE A : le nom tiré du titre est
     devenu plus court (15/10/2026), et le recalculer ferait perdre la branche
     réelle (`github.branch`, posée au lancement). Une branche supprimée ou
     archivée ne compte plus : la carte repart d'un nom neuf. */
  const reelle = (card.github?.branch ?? '').trim();
  if (reelle && !card.github?.brancheSupprimee && estLaBrancheDeLaCarte(reelle, card.id)) return reelle;
  return nomDeBranche(card.title, card.id);
}

/** Les branches du projet qui ne sont jamais une branche de travail. */
export function branchesInterdites(reglees: readonly (string | undefined | null)[] = []): Set<string> {
  return new Set(
    [...BRANCHES_TOUJOURS_PROTEGEES, ...reglees]
      .map((b) => (b ?? '').trim().replace(/^origin\//, ''))
      .filter(Boolean),
  );
}

/**
 * UNE BRANCHE DU DÉPÔT PEUT-ELLE ÊTRE REPRISE PAR UNE CARTE ? Jamais une
 * branche du projet (« dev », « main », publication réglée), jamais une
 * branche archivée, jamais le pointeur `HEAD` d'un dépôt distant.
 */
export function brancheProposable(nom: string, interdites: Set<string>): boolean {
  const propre = (nom ?? '').trim().replace(/^origin\//, '');
  if (!propre || propre === 'HEAD') return false;
  if (propre.startsWith(PREFIXE_ARCHIVE)) return false;
  return !interdites.has(propre);
}

/**
 * Un point de DÉPART possible pour une branche neuve : toute branche connue, y
 * compris « dev » et « main » — on part d'elles, on n'y travaille pas. Seules
 * les branches archivées sont écartées.
 */
export function departProposable(nom: string): boolean {
  const propre = (nom ?? '').trim();
  return !!propre && propre !== 'HEAD' && !propre.replace(/^origin\//, '').startsWith(PREFIXE_ARCHIVE);
}

export interface VerdictDeNom {
  ok: boolean;
  /** Le nom à écrire, préfixe « tache/ » compris. */
  nom: string;
  /** Ce qui ne va pas, en français. */
  raison?: string;
}

/**
 * LE NOM SAISI POUR UNE BRANCHE, rendu valable pour git et pour Beluga Build.
 *
 * On ne refuse pas pour un détail qu'on sait corriger : les espaces deviennent
 * des tirets, le préfixe « tache/ » s'ajoute s'il manque. On refuse ce que git
 * refuserait (`git check-ref-format`) et ce qui viserait une branche du projet.
 */
export function validerNomDeBranche(saisie: string, interdites: Set<string> = branchesInterdites()): VerdictDeNom {
  let nom = (saisie ?? '').trim().replace(/\s+/g, '-');
  if (!nom.startsWith(PREFIXE_BRANCHE_DE_TACHE)) nom = `${PREFIXE_BRANCHE_DE_TACHE}${nom.replace(/^\/+/, '')}`;
  const reste = nom.slice(PREFIXE_BRANCHE_DE_TACHE.length);
  const refus = (raison: string): VerdictDeNom => ({ ok: false, nom, raison });
  if (!reste) return refus('Le nom de la branche est vide.');
  if (nom.length > 120) return refus('Le nom de la branche est trop long (120 signes au plus).');
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(nom)) return refus('Le nom contient un signe que git refuse (~ ^ : ? * [ \\).');
  if (nom.includes('..') || nom.includes('//') || nom.includes('@{')) return refus('Le nom contient une suite de signes que git refuse.');
  if (nom.endsWith('/') || nom.endsWith('.') || nom.endsWith('.lock')) return refus('Le nom ne peut pas finir ainsi.');
  if (nom.split('/').some((segment) => segment.startsWith('.') || segment.startsWith('-'))) {
    return refus('Une partie du nom commence par un point ou un tiret.');
  }
  if (interdites.has(nom)) return refus('Cette branche est une branche du projet.');
  return { ok: true, nom };
}

/** Une autre carte qui porte une branche du dépôt. */
export interface CarteSurLaBranche {
  id: string;
  titre: string;
  /** Son agent travaille-t-il en ce moment ? */
  active: boolean;
}

/** Une branche telle que le menu la montre. */
export interface BrancheProposee {
  nom: string;
  /** Elle n'existe que sur le dépôt distant (GitHub) : la reprendre la rapatrie. */
  distante: boolean;
  /** Les AUTRES cartes qui la portent. */
  cartes: CarteSurLaBranche[];
  /** Pourquoi on ne peut pas la reprendre maintenant ; absente, elle se reprend. */
  occupee?: string;
}

/**
 * LA BRANCHE D'UNE AUTRE CARTE SE REPREND L'UNE APRÈS L'AUTRE. Tant que l'agent
 * d'une carte y travaille, git refuserait de la poser dans une seconde copie,
 * et deux agents s'y voleraient les fichiers : elle est grisée, et la raison
 * nomme la carte.
 */
export function raisonDOccupation(cartes: readonly CarteSurLaBranche[]): string | undefined {
  const active = cartes.find((c) => c.active);
  return active ? `Un agent y travaille pour « ${active.titre} » : elle se reprend quand il aura rendu.` : undefined;
}

/**
 * LES BRANCHES PROPOSÉES PAR LE MENU : locales et distantes réunies sous un
 * seul nom, branches du projet et archives écartées, la branche courante de la
 * carte retirée (elle s'affiche en tête), les autres triées par nom.
 */
export function branchesProposees(entree: {
  locales: readonly string[];
  distantes: readonly string[];
  courante: string;
  interdites: Set<string>;
  cartesParBranche: ReadonlyMap<string, CarteSurLaBranche[]>;
}): BrancheProposee[] {
  const vues = new Map<string, BrancheProposee>();
  const ajouter = (brut: string, distante: boolean) => {
    const nom = brut.trim().replace(/^origin\//, '');
    if (!brancheProposable(nom, entree.interdites) || nom === entree.courante) return;
    const deja = vues.get(nom);
    if (deja) {
      if (!distante) deja.distante = false;
      return;
    }
    const cartes = entree.cartesParBranche.get(nom) ?? [];
    vues.set(nom, { nom, distante, cartes, ...(raisonDOccupation(cartes) ? { occupee: raisonDOccupation(cartes) } : {}) });
  };
  for (const b of entree.locales) ajouter(b, false);
  for (const b of entree.distantes) ajouter(b, true);
  return [...vues.values()].sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * LE PARCOURS DE LA BRANCHE VERS LA MISE EN LIGNE, en trois étapes : la
 * branche de la tâche, la branche de déploiement (« dev »), la production
 * (« main »). L'étape courante se dessine en violet.
 *
 *  - 0 : le travail est sur la branche (Planifié, En cours) ;
 *  - 0 aussi, mais « en attente » : la carte est dans « À déployer », la
 *    branche partira avec le prochain lot ;
 *  - 1 : la branche est fusionnée dans la branche de déploiement.
 *
 * La production n'est pas suivie carte par carte : c'est un état de version,
 * lu en tête d'« Archivé ».
 */
export type EtapeDeLaBranche = 'branche' | 'a-deployer' | 'deployee';

export function etapeDeLaBranche(card: {
  column: string;
  deployedAt?: number;
  github?: { fusionnee?: boolean } | null;
}): EtapeDeLaBranche {
  if (card.deployedAt || card.github?.fusionnee) return 'deployee';
  if (card.column === 'to_deploy') return 'a-deployer';
  return 'branche';
}

/** Le geste demandé au menu de branche. */
export type GesteDeBranche = 'renommer' | 'creer' | 'reprendre';

/** Ce que devient le travail déjà fait quand la carte change de branche. */
export type SortDuTravail = 'laisser' | 'emporter';

/**
 * CE QUE LE MENU DE BRANCHE REÇOIT DU DÉMON pour une carte.
 */
export interface BranchesDeLaCarte {
  /** La branche de la carte (choisie, ou tirée du titre). */
  courante: string;
  /** Existe-t-elle déjà dans le dépôt ? (Non tant que la carte n'a pas été lancée.) */
  existe: boolean;
  /** Le départ choisi ou, à défaut, la branche de déploiement du projet. */
  depart: string;
  /** La branche de déploiement (« dev ») et la branche de production (« main »). */
  deploiement: string;
  production: string;
  /** Les départs possibles pour une branche neuve. */
  departs: string[];
  /** Les branches que la carte peut reprendre. */
  branches: BrancheProposee[];
  /** Les autres cartes qui partagent la branche courante. */
  partagee: CarteSurLaBranche[];
  /** Pourquoi aucun geste n'est possible maintenant (un agent travaille…). */
  verrou?: string;
  /** L'adresse de la branche sur GitHub, quand le dépôt y vit. */
  urlGithub?: string;
}

/** La réponse d'un geste : fait, ou une question à poser avant de le faire. */
export interface ReponseGesteDeBranche {
  ok: boolean;
  /** La carte a déjà du travail : demander « laisser / emporter ». */
  question?: 'travail';
  /** Ce qui a été fait, ou pourquoi rien ne l'a été. */
  message?: string;
  branche?: string;
}

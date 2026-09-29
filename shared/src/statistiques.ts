/**
 * LE SERVICE « STATISTIQUES » — les règles pures (demande du 27/09/2026).
 *
 * Un service à la Google Analytics, sorti de l'atelier marketing : chaque
 * projet Beluga mesuré, et chaque SITE AUTONOME créé ici (sans projet, pour
 * n'importe quel site), a sa clé de suivi, son mode (anonyme ou visiteur) et
 * ses REPÈRES — les boutons, liens et zones clés qu'un agent a marqués
 * `data-beluga-repere` après avoir étudié le site.
 *
 * Ici : reconnaître un site autonome, juger les repères déclarés par un agent,
 * et analyser les PARCOURS du mode visiteur (chemins, entonnoir, clics par
 * repère, frise d'un visiteur, lecture résumée). Aucun appel au moteur : la
 * lecture est calculée depuis les chiffres, à chaque affichage.
 */
import { type EvenementDeSuivi, nomDeRepere } from './marketing.js';
import { type DiagnosticSuivi, diagnosticACorriger } from './suivi-par-defaut.js';

/** Un site autonome n'est pas un projet : son identifiant d'espace commence par ce préfixe. */
export const PREFIXE_SITE_AUTONOME = 'site:';

export function estSiteAutonome(projectId: string | null | undefined): boolean {
  return typeof projectId === 'string' && projectId.startsWith(PREFIXE_SITE_AUTONOME);
}

/** Le nom d'un site autonome : 1 à 80 signes, espaces resserrés. */
export function nomDeSiteValide(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const nom = valeur.replace(/\s+/g, ' ').trim().slice(0, 80);
  return nom || null;
}

/* ------------------------------------------------------------------ */
/* L'état du suivi, dit pareil partout                                 */
/* ------------------------------------------------------------------ */

/**
 * CE QUE L'ÉCRAN DIT DU SUIVI D'UN SITE (demande du 28/09/2026) — UNE seule
 * règle pour la ligne de la liste, le bouton du détail, le bandeau d'Audience
 * et l'assistant. Avant elle, un code « posé » faisait dire « Suivi installé »
 * au bouton pendant que la liste disait « en attente de la première visite » et
 * que le bandeau proposait d'installer (HaikoDev).
 *
 *  - `verifie` : une visite est arrivée, la mesure est en place ;
 *  - `installation` : la carte d'installation est en demande ou au travail ;
 *  - `probleme` : la page lue porte un code absent, faux ou l'ancien outil,
 *    alors qu'une installation a déjà eu lieu (état « posé » perdu) ;
 *  - `attente` : le code est sur la page, aucune visite reçue encore ;
 *  - `absent` : rien n'est posé.
 */
export const ETATS_AFFICHES_DU_SUIVI = ['absent', 'installation', 'attente', 'probleme', 'verifie'] as const;
export type EtatAfficheDuSuivi = (typeof ETATS_AFFICHES_DU_SUIVI)[number];

export function etatAfficheDuSuivi(entree: {
  etatSuivi: string;
  diagnostic?: DiagnosticSuivi | null;
  installationEnCours?: boolean;
}): EtatAfficheDuSuivi {
  if (entree.etatSuivi === 'verifie') return 'verifie';
  if (entree.installationEnCours) return 'installation';
  if (entree.etatSuivi === 'pose' || entree.diagnostic === 'ok') return 'attente';
  if (diagnosticACorriger(entree.diagnostic) && entree.diagnostic !== 'absent') return 'probleme';
  return 'absent';
}

/* ------------------------------------------------------------------ */
/* Recherche dans la liste                                             */
/* ------------------------------------------------------------------ */

/** Minuscules, sans accents ni espaces superflus : « Éloya » se trouve avec « projeta ». */
export function textePourRecherche(valeur: string | null | undefined): string {
  return (valeur ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * LA BARRE DE RECHERCHE DE LA LISTE : garde les sites dont le NOM ou l'ADRESSE
 * contient le texte tapé, sans tenir compte des majuscules ni des accents. Un
 * texte vide garde tout, dans l'ordre reçu.
 */
export function filtrerLesSites<S extends { nom: string; adresse?: string | null }>(sites: readonly S[], recherche: string): S[] {
  const cherche = textePourRecherche(recherche);
  if (!cherche) return [...sites];
  return sites.filter((s) => textePourRecherche(s.nom).includes(cherche) || textePourRecherche(s.adresse).includes(cherche));
}

/* ------------------------------------------------------------------ */
/* Tendance et tri de la liste                                         */
/* ------------------------------------------------------------------ */

/** En deçà de cet écart (en %), la popularité est dite stable : le bruit d'un jour ne fait pas une flèche. */
export const SEUIL_TENDANCE_STABLE = 5;

export interface TendanceDesVisites {
  sens: 'hausse' | 'baisse' | 'stable' | 'aucune';
  /** L'écart en % arrondi ; `null` quand il n'a pas de sens (rien avant, ou rien du tout). */
  ecart: number | null;
}

/**
 * LA FLÈCHE DE LA LISTE : les visites des 28 derniers jours comparées aux 28
 * jours d'avant. Rien avant mais des visites maintenant : hausse, sans
 * pourcentage (jamais « Infinity % ») ; rien des deux côtés : aucune.
 */
export function tendanceDesVisites(actuelles: number, precedentes: number): TendanceDesVisites {
  if (!precedentes) return actuelles > 0 ? { sens: 'hausse', ecart: null } : { sens: 'aucune', ecart: null };
  const ecart = Math.round(((actuelles - precedentes) / precedentes) * 100);
  if (Math.abs(ecart) < SEUIL_TENDANCE_STABLE) return { sens: 'stable', ecart };
  return { sens: ecart > 0 ? 'hausse' : 'baisse', ecart };
}

export const COLONNES_DE_LA_LISTE = ['nom', 'visites', 'visiteurs', 'objectifs', 'tendance'] as const;
export type ColonneDeLaListe = (typeof COLONNES_DE_LA_LISTE)[number];
export interface TriDeLaListe {
  colonne: ColonneDeLaListe;
  sens: 'asc' | 'desc';
}
/** Le tri d'une liste ouverte pour la première fois : par nom, comme avant le tableau. */
export const TRI_DE_LA_LISTE_PAR_DEFAUT: TriDeLaListe = { colonne: 'nom', sens: 'asc' };

/** Un tri gardé en préférence, remis d'aplomb (colonne disparue, valeur illisible → tri par défaut). */
export function triDeLaListe(garde: unknown): TriDeLaListe {
  const g = garde as Partial<TriDeLaListe> | null;
  if (!g || !COLONNES_DE_LA_LISTE.includes(g.colonne as ColonneDeLaListe) || (g.sens !== 'asc' && g.sens !== 'desc')) return TRI_DE_LA_LISTE_PAR_DEFAUT;
  return { colonne: g.colonne as ColonneDeLaListe, sens: g.sens };
}

/** Le rang d'une tendance pour le tri : une hausse sans point de comparaison passe devant toute hausse chiffrée. */
function rangDeTendance(t: TendanceDesVisites): number {
  if (t.sens === 'aucune') return -Infinity;
  if (t.ecart === null) return Number.MAX_SAFE_INTEGER;
  return t.ecart;
}

/**
 * LE TRI DE LA LISTE EN TABLEAU : par nom (ordre alphabétique français) ou par
 * chiffre ; à égalité, le nom départage. Rend une copie.
 */
export function trierLesSites<S extends { nom: string; visites: readonly number[]; visiteurs: number; objectifs: number; visitesPrecedentes: number }>(
  sites: readonly S[],
  tri: TriDeLaListe,
): S[] {
  const total = (s: S) => s.visites.reduce((a, b) => a + b, 0);
  const valeur = (s: S): number => {
    switch (tri.colonne) {
      case 'visites':
        return total(s);
      case 'visiteurs':
        return s.visiteurs;
      case 'objectifs':
        return s.objectifs;
      case 'tendance':
        return rangDeTendance(tendanceDesVisites(total(s), s.visitesPrecedentes));
      default:
        return 0;
    }
  };
  const signe = tri.sens === 'asc' ? 1 : -1;
  const parNom = (a: S, b: S) => a.nom.localeCompare(b.nom, 'fr');
  return [...sites].sort((a, b) => {
    if (tri.colonne === 'nom') return signe * parNom(a, b);
    const va = valeur(a);
    const vb = valeur(b);
    return va === vb ? parNom(a, b) : va < vb ? -signe : signe;
  });
}

/* ------------------------------------------------------------------ */
/* Robots                                                              */
/* ------------------------------------------------------------------ */

const MOTIFS_DE_ROBOT = /headlesschrome|bot\b|bot\/|crawler|spider|slurp|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|playwright|puppeteer|phantomjs|prerender/i;

/**
 * UN ROBOT N'EST PAS UN VISITEUR : un navigateur sans écran (contrôles,
 * surveillances, aperçus) ou un robot d'indexation exécute le script de suivi
 * comme un humain. Sa visite n'est ni comptée ni prise pour la « première
 * visite » qui confirme la mesure.
 */
export function agentEstUnRobot(userAgent: string | null | undefined): boolean {
  return !!userAgent && MOTIFS_DE_ROBOT.test(userAgent);
}

/* ------------------------------------------------------------------ */
/* Objectifs du site                                                   */
/* ------------------------------------------------------------------ */

/** Ce que l'agent fait du code du site : étudier, marquer, déclarer. */
export const METHODE_DES_REPERES = [
  'MÉTHODE — UN SUIVI INTELLIGENT, PAS UN COMPTEUR :',
  '1. Étudie les pages servies : à quoi sert le site, quel parcours mène au but (réserver, acheter, écrire, s’inscrire, télécharger).',
  '2. Repère ce qui compte : appels à l’action (en-tête, héros, pied), boutons de formulaire, liens sortants (téléphone, courriel, réseaux, boutique), onglets et zones clés (tarifs, galerie, FAQ). Dix à trente repères, pas un par lien.',
  '3. Pose sur chaque élément data-beluga-repere="<nom-en-kebab>" : un nom par INTENTION et par EMPLACEMENT (« reserver-hero », « reserver-pied », « tel-contact »). Un clic est compté tout seul, sans autre code.',
  '4. Définis les PARCOURS du site — un à quatre, un par but réel (« Réserver une table », « Demander un devis », « S’inscrire à la lettre ») : pour chacun un « nom » lisible, un « objectif » (la phrase qui dit quand il est réussi), une « description », et ses « etapes » DANS L’ORDRE, du premier geste au but atteint. Chaque étape : « repere » (le nom d’un repère posé, d’un objectif, ou un chemin de page « /tarifs »), un « libelle » court et lisible par un non-informaticien (« Voit les tarifs », « Choisit sa formule », « Paie »), une « description » d’une phrase. Un but atteint sans clic (page de remerciement) : belugaSuivi("objectif", { o: "<nom>" }) et une étape de ce nom.',
  '5. Déclare le tout avec l’action « reperes » : « reperes » (nom, emplacement, raison) ET « parcours » — chaque liste ENTIÈRE remplace la précédente.',
].join('\n');

/**
 * LES OBJECTIFS PROPRES AU SITE (demande du 28/09/2026) : en suivi complet,
 * l'agent qui installe le suivi ne pose pas qu'un compteur — il étudie le site
 * du projet choisi et fixe SES objectifs (les repères marqués « objectif »,
 * qui forment l'entonnoir de l'onglet Parcours). En anonyme, les repères
 * restent utiles (clics comptés), les objectifs sont conseillés.
 */
export function consigneDesObjectifs(mode: 'anonyme' | 'visiteur'): string {
  return [
    mode === 'visiteur'
      ? 'SUIVI COMPLET — OBJECTIFS OBLIGATOIRES : étudie CE site (ses pages, son offre, son public) et fixe SES parcours — un à quatre buts concrets (réserver, acheter, écrire, s’inscrire, télécharger…), chacun avec ses étapes nommées dans l’ordre. Des objectifs génériques ne servent à rien : ils doivent se lire dans les pages de ce site.'
      : 'SUIVI ANONYME : les repères comptent les clics ; déclare aussi les parcours du site quand il en a.',
    METHODE_DES_REPERES,
    'DÉCLARE repères et parcours avec l’outil « statistiques », action « reperes » : ils s’affichent aussitôt dans le service Statistiques, onglet Parcours.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Repères                                                             */
/* ------------------------------------------------------------------ */

export interface RepereDeSuivi {
  /** Le nom posé sur l'élément : `data-beluga-repere="<nom>"`. */
  nom: string;
  /** Où il se trouve (« en-tête, bouton Réserver »). */
  emplacement: string;
  /** Pourquoi l'agent l'a posé : ce qu'il permet de comprendre. */
  raison: string;
  /** Une étape du parcours visé : elle entre dans l'entonnoir, dans l'ordre de la liste. */
  objectif: boolean;
}

export const REPERES_MAX = 60;

/**
 * LES REPÈRES DÉCLARÉS PAR UN AGENT : la liste ENTIÈRE, qui remplace la
 * précédente. Un nom est ramené à sa forme posée sur la page ; un doublon
 * garde la première déclaration. Refusée si elle est vide ou illisible.
 */
export function jugerReperes(brut: unknown): { ok: true; reperes: RepereDeSuivi[] } | { ok: false; raison: string } {
  if (!Array.isArray(brut)) return { ok: false, raison: 'Donne « reperes » : une liste de { nom, emplacement, raison, objectif }.' };
  const vus = new Set<string>();
  const reperes: RepereDeSuivi[] = [];
  for (const r of brut.slice(0, REPERES_MAX)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const nom = nomDeRepere(o.nom);
    if (!nom || vus.has(nom)) continue;
    vus.add(nom);
    reperes.push({
      nom,
      emplacement: typeof o.emplacement === 'string' ? o.emplacement.trim().slice(0, 160) : '',
      raison: typeof o.raison === 'string' ? o.raison.trim().slice(0, 300) : '',
      objectif: o.objectif === true,
    });
  }
  if (!reperes.length) return { ok: false, raison: 'Aucun repère lisible : chaque repère a un « nom » (minuscules et tirets).' };
  return { ok: true, reperes };
}

/* ------------------------------------------------------------------ */
/* Parcours déclarés                                                   */
/* ------------------------------------------------------------------ */

/**
 * UNE ÉTAPE D'UN PARCOURS : un repère cliqué ou un objectif atteint (son nom,
 * tel que posé sur la page), ou une page vue (un chemin qui commence par « / »).
 * Le libellé et la phrase sont ce que l'écran montre : la nomenclature lisible.
 */
export interface EtapeDeSuiviDuParcours {
  repere: string;
  libelle: string;
  description: string;
}

/**
 * UN PARCOURS DÉCLARÉ PAR L'AGENT (demande du 29/09/2026) : un site en a
 * plusieurs — réserver, écrire, s'inscrire… —, chacun son but et ses étapes
 * dans l'ordre. Le parcours « principal » (nom vide) est celui qu'on déduit
 * des anciens repères marqués « objectif », tant qu'aucun n'a été déclaré.
 */
export interface ParcoursDeSuivi {
  id: string;
  /** Le nom lisible ; vide pour le parcours principal déduit (l'écran écrit « Parcours principal »). */
  nom: string;
  /** Ce qui compte comme réussi, en une phrase. */
  objectif: string;
  description: string;
  etapes: EtapeDeSuiviDuParcours[];
}

export const PARCOURS_MAX = 6;
export const ETAPES_DE_PARCOURS_MAX = 10;
export const ID_DU_PARCOURS_PRINCIPAL = 'principal';

/** Un chemin de page (« /tarifs ») ou un nom de repère ; rien d'autre. */
function repereDEtape(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const v = valeur.trim();
  if (v.startsWith('/')) return v.split(/[?#\s]/)[0].slice(0, 120) || undefined;
  return nomDeRepere(v);
}

/** « payer-formule » → « Payer formule » : le libellé d'un repère qui n'en a pas reçu. */
export function libelleDeRepere(nom: string): string {
  if (nom.startsWith('/')) return nom;
  const mots = nom.replace(/-+/g, ' ').trim();
  return mots ? mots[0].toUpperCase() + mots.slice(1) : nom;
}

const texte = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/**
 * LES PARCOURS DÉCLARÉS PAR UN AGENT : la liste ENTIÈRE, qui remplace la
 * précédente. Chaque parcours a un nom et au moins une étape lisible ; une
 * étape s'écrit { repere, libelle, description } ou simplement son nom.
 * Deux parcours du même nom : le premier est gardé.
 */
export function jugerParcours(brut: unknown): { ok: true; parcours: ParcoursDeSuivi[] } | { ok: false; raison: string } {
  if (!Array.isArray(brut)) return { ok: false, raison: 'Donne « parcours » : une liste de { nom, objectif, description, etapes: [{ repere, libelle, description }] }.' };
  const vus = new Set<string>();
  const parcours: ParcoursDeSuivi[] = [];
  for (const p of brut.slice(0, PARCOURS_MAX)) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const nom = texte(o.nom, 80);
    const id = nomDeRepere(nom);
    if (!id || vus.has(id)) continue;
    const etapes: EtapeDeSuiviDuParcours[] = [];
    for (const e of Array.isArray(o.etapes) ? o.etapes.slice(0, ETAPES_DE_PARCOURS_MAX) : []) {
      const x = typeof e === 'string' ? { repere: e } : e && typeof e === 'object' ? (e as Record<string, unknown>) : null;
      const repere = x ? repereDEtape(x.repere ?? x.nom) : undefined;
      if (!x || !repere) continue;
      etapes.push({ repere, libelle: texte(x.libelle, 60) || libelleDeRepere(repere), description: texte(x.description, 240) });
    }
    if (!etapes.length) continue;
    vus.add(id);
    parcours.push({ id, nom, objectif: texte(o.objectif, 240), description: texte(o.description, 400), etapes });
  }
  if (!parcours.length) return { ok: false, raison: 'Aucun parcours lisible : chaque parcours a un « nom » et au moins une étape (« repere » : le nom posé sur la page, ou un chemin « /page »).' };
  return { ok: true, parcours };
}

/**
 * LES PARCOURS À MONTRER : ceux déclarés, sinon le parcours principal déduit
 * des repères marqués « objectif » (l'ancienne forme, un seul entonnoir),
 * sinon aucun. Les libellés vides sont remplis depuis le nom du repère.
 */
export function parcoursDuSite(declares: readonly ParcoursDeSuivi[], reperes: readonly RepereDeSuivi[]): ParcoursDeSuivi[] {
  if (declares.length) return declares.map((p) => ({ ...p, etapes: p.etapes.map((e) => ({ ...e, libelle: e.libelle || libelleDeRepere(e.repere) })) }));
  const objectifs = reperes.filter((r) => r.objectif);
  if (!objectifs.length) return [];
  return [
    {
      id: ID_DU_PARCOURS_PRINCIPAL,
      nom: '',
      objectif: '',
      description: '',
      etapes: objectifs.map((r) => ({ repere: r.nom, libelle: libelleDeRepere(r.nom), description: r.raison || r.emplacement })),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Parcours                                                            */
/* ------------------------------------------------------------------ */

/** Une étape d'un parcours : une page vue, un repère cliqué ou un objectif atteint. */
export interface EtapeVisiteur {
  genre: 'page' | 'repere' | 'objectif';
  nom: string;
}

export interface CheminFrequent {
  etapes: EtapeVisiteur[];
  sessions: number;
}

export interface MarcheDEntonnoir {
  nom: string;
  /** Les sessions qui ont atteint cette étape (et toutes celles d'avant, dans l'ordre). */
  sessions: number;
  /** Part des sessions de départ, en %. */
  part: number;
  /** Perdues depuis l'étape précédente, en % de celle-ci (null pour la première). */
  decrochage: number | null;
}

export interface ClicsDuRepere {
  nom: string;
  clics: number;
  visiteurs: number;
}

export interface AnalyseDesParcours {
  /** Visiteurs reconnus (mode visiteur, après accord). */
  visiteurs: number;
  sessions: number;
  /** Visiteurs venus lors de plus d'une session. */
  visiteursRevenus: number;
  /** Pages par session, arrondi au dixième ; null sans session. */
  pagesParSession: number | null;
  chemins: CheminFrequent[];
  reperes: ClicsDuRepere[];
  /** Les visiteurs les plus récents, pour ouvrir leur frise. */
  derniersVisiteurs: { id: string; sessions: number; pages: number; dernier: number }[];
}

/** Une session sans identifiant de session (vieux navigateur) : le visiteur et 30 minutes d'inactivité. */
const PAUSE_DE_SESSION_MS = 30 * 60_000;
const CHEMINS_MAX = 8;
const LONGUEUR_CHEMIN_MAX = 5;
const DERNIERS_VISITEURS_MAX = 20;

function etapeDe(e: EvenementDeSuivi): EtapeVisiteur | null {
  if ((e.type === 'vue' || e.type === 'ecran') && e.chemin) return { genre: 'page', nom: e.chemin };
  if (e.type === 'repere' && e.repere) return { genre: 'repere', nom: e.repere };
  if (e.type === 'objectif' && e.objectif) return { genre: 'objectif', nom: e.objectif };
  return null;
}

const cleEtape = (x: EtapeVisiteur) => `${x.genre}:${x.nom}`;

/** Les sessions du mode visiteur, chacune ses étapes dans l'ordre, deux étapes identiques de suite fusionnées. */
export function sessionsDesVisiteurs(evenements: readonly EvenementDeSuivi[]): { visiteur: string; session: string; debut: number; etapes: EtapeVisiteur[] }[] {
  const tries = evenements.filter((e) => e.visiteurPersistant).sort((a, b) => a.instant - b.instant);
  const sessions = new Map<string, { visiteur: string; session: string; debut: number; dernier: number; etapes: EtapeVisiteur[] }>();
  const derniereSansId = new Map<string, string>();
  for (const e of tries) {
    const visiteur = e.visiteurPersistant!;
    let cle: string;
    if (e.session) cle = `${visiteur}|${e.session}`;
    else {
      const prec = derniereSansId.get(visiteur);
      const ouverte = prec ? sessions.get(prec) : undefined;
      cle = ouverte && e.instant - ouverte.dernier <= PAUSE_DE_SESSION_MS ? prec! : `${visiteur}|~${e.instant}`;
      derniereSansId.set(visiteur, cle);
    }
    let s = sessions.get(cle);
    if (!s) {
      s = { visiteur, session: cle.split('|')[1], debut: e.instant, dernier: e.instant, etapes: [] };
      sessions.set(cle, s);
    }
    s.dernier = e.instant;
    const etape = etapeDe(e);
    if (!etape) continue;
    const derniere = s.etapes[s.etapes.length - 1];
    if (derniere && cleEtape(derniere) === cleEtape(etape)) continue;
    s.etapes.push(etape);
  }
  return [...sessions.values()].filter((s) => s.etapes.length).map(({ dernier: _d, ...s }) => s);
}

/** Une étape visée est atteinte : une page par son chemin (« /tarifs »), sinon un repère ou un objectif par son nom. */
function etapeAtteinte(x: EtapeVisiteur, visee: string): boolean {
  return visee.startsWith('/') ? x.genre === 'page' && x.nom === visee : x.genre !== 'page' && x.nom === visee;
}

/**
 * L'ENTONNOIR : les étapes visées (repères ou objectifs marqués « objectif »,
 * dans leur ordre), et combien de sessions les franchissent l'une après
 * l'autre. Une étape se reconnaît à son nom, qu'elle soit repère ou objectif.
 */
export function entonnoirDesSessions(sessions: readonly { etapes: readonly EtapeVisiteur[] }[], etapesVisees: readonly string[]): MarcheDEntonnoir[] {
  if (!etapesVisees.length) return [];
  const atteintes = etapesVisees.map(() => 0);
  for (const s of sessions) {
    let rang = 0;
    for (const x of s.etapes) {
      if (rang >= etapesVisees.length) break;
      if (etapeAtteinte(x, etapesVisees[rang])) {
        atteintes[rang] += 1;
        rang += 1;
      }
    }
  }
  const depart = atteintes[0];
  return etapesVisees.map((nom, i) => ({
    nom,
    sessions: atteintes[i],
    part: depart ? Math.round((atteintes[i] / depart) * 100) : 0,
    decrochage: i === 0 || !atteintes[i - 1] ? null : Math.round(((atteintes[i - 1] - atteintes[i]) / atteintes[i - 1]) * 100),
  }));
}

/**
 * ANALYSE LES PARCOURS d'une période. `evenements` : tous ceux de la période
 * (les repères se comptent dans les deux modes, les parcours seulement sur
 * ceux qui portent un visiteur reconnu). `reperes` : la liste déclarée, pour
 * compter aussi les repères que personne ne touche.
 */
export function analyserLesParcours(entree: { evenements: readonly EvenementDeSuivi[]; reperes: readonly RepereDeSuivi[] }): AnalyseDesParcours {
  const sessions = sessionsDesVisiteurs(entree.evenements);
  const parVisiteur = new Map<string, { sessions: number; pages: number; dernier: number }>();
  for (const s of sessions) {
    const v = parVisiteur.get(s.visiteur) ?? { sessions: 0, pages: 0, dernier: 0 };
    v.sessions += 1;
    v.pages += s.etapes.filter((x) => x.genre === 'page').length;
    v.dernier = Math.max(v.dernier, s.debut);
    parVisiteur.set(s.visiteur, v);
  }
  const pages = sessions.reduce((n, s) => n + s.etapes.filter((x) => x.genre === 'page').length, 0);

  // Les chemins : le début de chaque session (5 étapes au plus), comptés tels quels.
  const chemins = new Map<string, CheminFrequent>();
  for (const s of sessions) {
    const etapes = s.etapes.slice(0, LONGUEUR_CHEMIN_MAX);
    const cle = etapes.map(cleEtape).join('>');
    const c = chemins.get(cle);
    if (c) c.sessions += 1;
    else chemins.set(cle, { etapes, sessions: 1 });
  }
  const cheminsTries = [...chemins.values()].sort((a, b) => b.sessions - a.sessions || b.etapes.length - a.etapes.length).slice(0, CHEMINS_MAX);

  // Les clics par repère : tous les événements « repere », visiteurs reconnus ou non.
  const clics = new Map<string, { clics: number; visiteurs: Set<string> }>();
  for (const r of entree.reperes) clics.set(r.nom, { clics: 0, visiteurs: new Set() });
  for (const e of entree.evenements) {
    if (e.type !== 'repere' || !e.repere) continue;
    const c = clics.get(e.repere) ?? { clics: 0, visiteurs: new Set<string>() };
    c.clics += 1;
    c.visiteurs.add(e.visiteurPersistant ?? e.visiteur);
    clics.set(e.repere, c);
  }
  const reperes = [...clics.entries()].map(([nom, c]) => ({ nom, clics: c.clics, visiteurs: c.visiteurs.size })).sort((a, b) => b.clics - a.clics || a.nom.localeCompare(b.nom));

  const visiteursRevenus = [...parVisiteur.values()].filter((v) => v.sessions > 1).length;

  return {
    visiteurs: parVisiteur.size,
    sessions: sessions.length,
    visiteursRevenus,
    pagesParSession: sessions.length ? Math.round((pages / sessions.length) * 10) / 10 : null,
    chemins: cheminsTries,
    reperes,
    derniersVisiteurs: [...parVisiteur.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.dernier - a.dernier)
      .slice(0, DERNIERS_VISITEURS_MAX),
  };
}

/** LA FRISE D'UN VISITEUR : ses sessions, de la plus récente à la plus ancienne, chacune ses étapes horodatées. */
export function friseDuVisiteur(
  evenements: readonly EvenementDeSuivi[],
  visiteur: string,
): { session: string; debut: number; appareil?: string; source?: string; etapes: (EtapeVisiteur & { instant: number })[] }[] {
  const siens = evenements.filter((e) => e.visiteurPersistant === visiteur).sort((a, b) => a.instant - b.instant);
  const parSession = new Map<string, { session: string; debut: number; appareil?: string; source?: string; etapes: (EtapeVisiteur & { instant: number })[] }>();
  let derniere: { cle: string; instant: number } | null = null;
  for (const e of siens) {
    const cle: string = e.session ?? (derniere && e.instant - derniere.instant <= PAUSE_DE_SESSION_MS ? derniere.cle : `~${e.instant}`);
    derniere = { cle, instant: e.instant };
    let s = parSession.get(cle);
    if (!s) {
      s = { session: cle, debut: e.instant, etapes: [] };
      parSession.set(cle, s);
    }
    if (!s.appareil && e.appareil) s.appareil = e.appareil;
    if (!s.source && e.source) s.source = e.source;
    const etape = etapeDe(e);
    if (etape) s.etapes.push({ ...etape, instant: e.instant });
  }
  return [...parSession.values()].sort((a, b) => b.debut - a.debut);
}

/* ------------------------------------------------------------------ */
/* La période lue                                                       */
/* ------------------------------------------------------------------ */

/** La profondeur lisible : la conservation des événements (`CONSERVATION_MS` du démon). */
export const PROFONDEUR_STATISTIQUES_JOURS = 90;

/**
 * LA PÉRIODE DES STATISTIQUES, REMISE D'APLOMB. L'écran demande soit une
 * échelle (`jours`), soit une plage (`debut`, `fin`) ; le démon ne lit jamais
 * au-delà de la conservation, jamais dans le futur, et une plage à l'envers est
 * retournée plutôt que refusée. Rend `depuis`/`jusqua` (inclus) et le nombre de
 * jours couverts.
 */
export function periodeDesStatistiques(
  demande: { jours?: unknown; debut?: unknown; fin?: unknown },
  maintenant = Date.now(),
): { depuis: number; jusqua: number; jours: number } {
  const plancher = maintenant - PROFONDEUR_STATISTIQUES_JOURS * 86_400_000;
  const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const debut = nombre(demande.debut);
  const fin = nombre(demande.fin);
  if (debut !== null && fin !== null) {
    let [a, b] = debut <= fin ? [debut, fin] : [fin, debut];
    b = Math.min(b, maintenant);
    a = Math.min(Math.max(a, plancher), b);
    return { depuis: a, jusqua: b, jours: Math.max(1, Math.ceil((b - a) / 86_400_000)) };
  }
  const jours = Math.max(1, Math.min(PROFONDEUR_STATISTIQUES_JOURS, Math.round(nombre(demande.jours) ?? 30)));
  return { depuis: maintenant - jours * 86_400_000, jusqua: maintenant, jours };
}

/* ------------------------------------------------------------------ */
/* Le tableau de bord complet                                           */
/* ------------------------------------------------------------------ */

/**
 * UN CODE PAYS ISO À DEUX LETTRES, ou null. « XX » (inconnu) et « T1 » (Tor),
 * posés par Cloudflare, ne sont pas des pays.
 */
export function codePaysValide(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const code = valeur.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'ZZ' ? code : null;
}

/** Une session vue par le tableau de bord, dans les deux modes. */
export interface SessionDuTableau {
  /** Le visiteur : reconnu (mode visiteur) ou celui du jour (hachage salé, anonyme). */
  visiteur: string;
  reconnu: boolean;
  debut: number;
  fin: number;
  source: string;
  appareil: string;
  pays: string | null;
  pages: string[];
  etapes: EtapeVisiteur[];
  /** Clics sur un repère et objectifs atteints. */
  interactions: number;
  /** Somme des temps passés sur ses pages (événements « sortie »), en ms ; null sans mesure. */
  dureeMs: number | null;
}

/**
 * LES SESSIONS DU TABLEAU DE BORD. En suivi complet, l'identifiant de session
 * du navigateur ; sinon (anonyme, ou avant l'accord) le visiteur DU JOUR et
 * trente minutes d'inactivité — la page tire un identifiant par chargement,
 * il ne relie pas deux pages. Source, appareil et pays : ceux de la première
 * page vue.
 */
export function sessionsDuTableau(evenements: readonly EvenementDeSuivi[]): SessionDuTableau[] {
  const tries = [...evenements].sort((a, b) => a.instant - b.instant);
  const ouvertes = new Map<string, SessionDuTableau & { cle: string }>();
  const toutes: (SessionDuTableau & { cle: string })[] = [];
  for (const e of tries) {
    if (e.type === 'clic' || e.type === 'achat' || e.type === 'installation') continue;
    const reconnu = !!(e.visiteurPersistant && e.session);
    const cle = reconnu ? `v|${e.visiteurPersistant}|${e.session}` : `j|${e.visiteur}`;
    let s = ouvertes.get(cle);
    if (s && !reconnu && e.instant - s.fin > PAUSE_DE_SESSION_MS) s = undefined;
    if (!s) {
      s = {
        cle,
        visiteur: reconnu ? e.visiteurPersistant! : e.visiteur,
        reconnu,
        debut: e.instant,
        fin: e.instant,
        source: e.source ?? 'direct',
        appareil: e.appareil ?? 'ordinateur',
        pays: e.pays ?? null,
        pages: [],
        etapes: [],
        interactions: 0,
        dureeMs: null,
      };
      ouvertes.set(cle, s);
      toutes.push(s);
    }
    s.fin = e.instant;
    if (!s.pays && e.pays) s.pays = e.pays;
    if ((e.type === 'vue' || e.type === 'ecran') && e.chemin) {
      if (!s.pages.length && e.source) s.source = e.source;
      s.pages.push(e.chemin);
    }
    if (e.type === 'repere' || e.type === 'objectif') s.interactions += 1;
    if (e.type === 'sortie' && typeof e.dureeMs === 'number') s.dureeMs = (s.dureeMs ?? 0) + e.dureeMs;
    const etape = etapeDe(e);
    if (etape) {
      const derniere = s.etapes[s.etapes.length - 1];
      if (!derniere || cleEtape(derniere) !== cleEtape(etape)) s.etapes.push(etape);
    }
  }
  return toutes.filter((s) => s.pages.length || s.interactions).map(({ cle: _c, ...s }) => s);
}

export interface MarcheDeConversion {
  nom: string;
  sessions: number;
  /** Part de l'étape précédente, en % (100 pour la première). */
  tauxEtape: number;
  /** Part des sessions de départ, en %. */
  tauxGlobal: number;
  /** Sessions perdues depuis l'étape précédente. */
  abandons: number;
}

/**
 * LE FLUX DE CONVERSION : « Sessions », puis chaque objectif dans l'ordre
 * déclaré. Une session franchit une étape si elle a franchi les précédentes
 * avant (même règle que `entonnoirDesSessions`).
 */
export function fluxDeConversion(sessions: readonly { etapes: readonly EtapeVisiteur[] }[], objectifs: readonly string[]): MarcheDeConversion[] {
  if (!objectifs.length) return [];
  const marches = entonnoirDesSessions(sessions, objectifs);
  const comptes = [sessions.length, ...marches.map((m) => m.sessions)];
  const noms = ['', ...objectifs];
  return comptes.map((n, i) => ({
    nom: noms[i],
    sessions: n,
    tauxEtape: i === 0 ? 100 : comptes[i - 1] ? Math.round((n / comptes[i - 1]) * 1000) / 10 : 0,
    tauxGlobal: comptes[0] ? Math.round((n / comptes[0]) * 1000) / 10 : 0,
    abandons: i === 0 ? 0 : Math.max(0, comptes[i - 1] - n),
  }));
}

/** Une marche du flux d'un parcours : celle d'une étape, plus les pages d'où partent ceux qui s'arrêtent avant elle. */
export interface MarcheDeParcours extends MarcheDeConversion {
  /** Les dernières pages vues par les sessions perdues juste avant cette étape : trois au plus, puis « autres » (chemin null, avec celles sans page). */
  departs: { chemin: string | null; sessions: number }[];
}

export interface FluxDUnParcours {
  id: string;
  /** « Entrée » (toutes les sessions), puis chaque étape du parcours. */
  marches: MarcheDeParcours[];
  /** Le rang de la marche où l'on perd le plus de sessions ; null sans perte. */
  plusGrosDecrochage: number | null;
}

const DEPARTS_MAX = 3;

/**
 * LE FLUX D'UN PARCOURS : l'entrée, puis chaque étape dans l'ordre — combien
 * la franchissent, combien s'arrêtent avant, et d'où ils quittent le site
 * (leur dernière page). Un seul passage par session.
 */
export function fluxDeParcours(sessions: readonly { etapes: readonly EtapeVisiteur[] }[], parcours: ParcoursDeSuivi): FluxDUnParcours {
  const visees = parcours.etapes.map((e) => e.repere);
  const marches = fluxDeConversion(sessions, visees);
  const departs = visees.map(() => new Map<string, number>());
  for (const s of sessions) {
    let rang = 0;
    let dernierePage: string | null = null;
    for (const x of s.etapes) {
      if (x.genre === 'page') dernierePage = x.nom;
      if (rang < visees.length && etapeAtteinte(x, visees[rang])) rang += 1;
    }
    if (rang >= visees.length) continue;
    // Sans page vue (des clics seuls), la session va dans « autres » : la clé vide.
    const cle = dernierePage ?? '';
    departs[rang].set(cle, (departs[rang].get(cle) ?? 0) + 1);
  }
  let pire: number | null = null;
  for (let i = 1; i < marches.length; i++) if (marches[i].abandons > 0 && (pire === null || marches[i].abandons > marches[pire].abandons)) pire = i;
  return {
    id: parcours.id,
    marches: marches.map((m, i) => {
      if (i === 0) return { ...m, departs: [] };
      const sansPage = departs[i - 1].get('') ?? 0;
      const tries = [...departs[i - 1].entries()].filter(([c]) => c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const gardes = tries.slice(0, DEPARTS_MAX).map(([chemin, n]) => ({ chemin, sessions: n }));
      const reste = sansPage + tries.slice(DEPARTS_MAX).reduce((n, [, k]) => n + k, 0);
      return { ...m, departs: reste ? [...gardes, { chemin: null, sessions: reste }] : gardes };
    }),
    plusGrosDecrochage: pire,
  };
}

/** Un nœud du flux de comportement : une source, une page ou un repère, à un rang donné. */
export interface NoeudDeFlux {
  cle: string;
  genre: 'source' | 'page' | 'repere' | 'objectif' | 'autres';
  nom: string;
  sessions: number;
  /** Sessions qui s'arrêtent ici (sans étape suivante). */
  abandons: number;
}

export interface FluxDeComportement {
  /** Source, page d'arrivée, 1re interaction, 2e interaction, 3e interaction. */
  colonnes: NoeudDeFlux[][];
  liens: { colonne: number; de: string; vers: string; sessions: number }[];
}

export const NOEUDS_DE_FLUX_MAX = 5;
const RANGS_DE_FLUX = 5;

/**
 * LE FLUX DE COMPORTEMENT, à la Google Analytics : d'où viennent les sessions,
 * sur quelle page elles arrivent, puis leurs trois étapes suivantes. Chaque
 * colonne garde ses cinq nœuds les plus fréquents, le reste va dans « autres » ;
 * un nœud dit combien de sessions s'y arrêtent.
 */
export function fluxDeComportement(sessions: readonly { source: string; etapes: readonly EtapeVisiteur[] }[]): FluxDeComportement {
  const parcours = sessions
    .map((s) => {
      const debut = s.etapes.findIndex((x) => x.genre === 'page');
      if (debut < 0) return null;
      return [{ genre: 'source' as const, nom: s.source || 'direct' }, ...s.etapes.slice(debut, debut + RANGS_DE_FLUX - 1)];
    })
    .filter((p): p is ({ genre: 'source'; nom: string } | EtapeVisiteur)[] => !!p);
  const colonnes: NoeudDeFlux[][] = [];
  const garde: Set<string>[] = [];
  const cleDe = (x: { genre: string; nom: string }) => `${x.genre}:${x.nom}`;
  for (let rang = 0; rang < RANGS_DE_FLUX; rang++) {
    const comptes = new Map<string, { genre: NoeudDeFlux['genre']; nom: string; sessions: number; abandons: number }>();
    for (const p of parcours) {
      const x = p[rang];
      if (!x) continue;
      const c = comptes.get(cleDe(x)) ?? { genre: x.genre, nom: x.nom, sessions: 0, abandons: 0 };
      c.sessions += 1;
      if (rang > 0 && !p[rang + 1]) c.abandons += 1;
      comptes.set(cleDe(x), c);
    }
    if (!comptes.size) break;
    const tries = [...comptes.entries()].sort((a, b) => b[1].sessions - a[1].sessions || a[0].localeCompare(b[0]));
    const gardes = tries.slice(0, NOEUDS_DE_FLUX_MAX);
    garde.push(new Set(gardes.map(([k]) => k)));
    const noeuds: NoeudDeFlux[] = gardes.map(([cle, c]) => ({ cle, ...c }));
    const reste = tries.slice(NOEUDS_DE_FLUX_MAX);
    if (reste.length) {
      noeuds.push({
        cle: 'autres',
        genre: 'autres',
        nom: String(reste.length),
        sessions: reste.reduce((n, [, c]) => n + c.sessions, 0),
        abandons: reste.reduce((n, [, c]) => n + c.abandons, 0),
      });
    }
    colonnes.push(noeuds);
  }
  const liens = new Map<string, { colonne: number; de: string; vers: string; sessions: number }>();
  for (const p of parcours) {
    for (let rang = 0; rang + 1 < Math.min(p.length, colonnes.length); rang++) {
      const de = garde[rang].has(cleDe(p[rang])) ? cleDe(p[rang]) : 'autres';
      const vers = garde[rang + 1].has(cleDe(p[rang + 1])) ? cleDe(p[rang + 1]) : 'autres';
      const k = `${rang}|${de}|${vers}`;
      const l = liens.get(k) ?? { colonne: rang, de, vers, sessions: 0 };
      l.sessions += 1;
      liens.set(k, l);
    }
  }
  return { colonnes, liens: [...liens.values()].sort((a, b) => a.colonne - b.colonne || b.sessions - a.sessions) };
}

export interface TableauDeBord {
  /** Le fuseau du serveur, dans lequel les heures sont comptées. */
  fuseau: string;
  sessions: number;
  utilisateurs: number;
  /** Sessions d'une seule page, sans clic sur un repère ni objectif, en %. */
  rebond: number | null;
  /** Durée moyenne d'une session mesurée, en ms. */
  dureeMoyenne: number | null;
  pagesParSession: number | null;
  /** Utilisateurs actifs sur le jour, les 7 et les 28 derniers jours (dans la période lue). */
  actifs: { jour: string; j1: number; j7: number; j28: number }[];
  pays: { pays: string; sessions: number }[];
  /** Sessions ouvertes à chaque heure (0 à 23) du fuseau du serveur. */
  parHeure: number[];
  /** Sessions ouvertes chaque jour de la semaine, lundi d'abord. */
  parJourDeSemaine: number[];
  sources: { source: string; sessions: number }[];
  appareils: { appareil: string; sessions: number }[];
  entrees: { chemin: string; sessions: number }[];
  sorties: { chemin: string; sessions: number }[];
  /** Suivi complet : le flux de chaque parcours déclaré, dans l'ordre des parcours. */
  parcours: FluxDUnParcours[];
  flux: FluxDeComportement;
}

const LISTES_DU_TABLEAU_MAX = 10;

function compterPar<T>(elements: readonly T[], cle: (x: T) => string | null): { cle: string; n: number }[] {
  const m = new Map<string, number>();
  for (const x of elements) {
    const k = cle(x);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, n]) => ({ cle: k, n })).sort((a, b) => b.n - a.n || a.cle.localeCompare(b.cle));
}

/**
 * LE TABLEAU DE BORD D'UNE PÉRIODE — le groupe de chiffres « à la Google
 * Analytics » du service Statistiques. Calculé par le démon sur les événements
 * de la période ; `fuseau` : celui du SERVEUR (les heures s'y comptent).
 * Flux de conversion et flux de comportement ne lisent que les sessions
 * reconnues (suivi complet, après accord).
 */
export function tableauDeBord(entree: {
  evenements: readonly EvenementDeSuivi[];
  parcours: readonly ParcoursDeSuivi[];
  depuis: number;
  jusqua: number;
  fuseau: string;
}): TableauDeBord {
  const sessions = sessionsDuTableau(entree.evenements);
  const n = sessions.length;
  const heure = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', weekday: 'short', timeZone: entree.fuseau });
  const JOURS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const parHeure = Array.from({ length: 24 }, () => 0);
  const parJourDeSemaine = Array.from({ length: 7 }, () => 0);
  for (const s of sessions) {
    const parts = heure.formatToParts(s.debut);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const j = JOURS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
    parHeure[h] += 1;
    if (j >= 0) parJourDeSemaine[j] += 1;
  }

  // Utilisateurs actifs : pour chaque visiteur, ses jours d'activité ; un jour compte les visiteurs actifs dans la fenêtre qui s'y termine.
  const jours: string[] = [];
  for (let t = Date.parse(`${new Date(entree.depuis).toISOString().slice(0, 10)}T00:00:00Z`); t <= entree.jusqua; t += 86_400_000) jours.push(new Date(t).toISOString().slice(0, 10));
  const rangDuJour = new Map(jours.map((j, i) => [j, i]));
  const joursParVisiteur = new Map<string, Set<number>>();
  for (const s of sessions) {
    const r = rangDuJour.get(new Date(s.debut).toISOString().slice(0, 10));
    if (r === undefined) continue;
    const k = `${s.reconnu ? 'v' : 'j'}|${s.visiteur}`;
    if (!joursParVisiteur.has(k)) joursParVisiteur.set(k, new Set());
    joursParVisiteur.get(k)!.add(r);
  }
  const j1 = jours.map(() => 0);
  const j7 = jours.map(() => 0);
  const j28 = jours.map(() => 0);
  for (const rangs of joursParVisiteur.values()) {
    const vus7 = new Set<number>();
    const vus28 = new Set<number>();
    for (const r of rangs) {
      j1[r] += 1;
      for (let d = r; d < Math.min(jours.length, r + 7); d++) vus7.add(d);
      for (let d = r; d < Math.min(jours.length, r + 28); d++) vus28.add(d);
    }
    for (const d of vus7) j7[d] += 1;
    for (const d of vus28) j28[d] += 1;
  }

  const mesurees = sessions.filter((s) => s.dureeMs !== null);
  const avecPages = sessions.filter((s) => s.pages.length);
  const rebonds = avecPages.filter((s) => s.pages.length === 1 && !s.interactions).length;
  const reconnues = sessions.filter((s) => s.reconnu);
  const top = <K extends string>(liste: { cle: string; n: number }[], nom: K) =>
    liste.slice(0, LISTES_DU_TABLEAU_MAX).map((x) => ({ [nom]: x.cle, sessions: x.n }) as { [P in K]: string } & { sessions: number });

  return {
    fuseau: entree.fuseau,
    sessions: n,
    utilisateurs: joursParVisiteur.size,
    rebond: avecPages.length ? Math.round((rebonds / avecPages.length) * 100) : null,
    dureeMoyenne: mesurees.length ? Math.round(mesurees.reduce((t, s) => t + (s.dureeMs ?? 0), 0) / mesurees.length) : null,
    pagesParSession: avecPages.length ? Math.round((avecPages.reduce((t, s) => t + s.pages.length, 0) / avecPages.length) * 10) / 10 : null,
    actifs: jours.map((jour, i) => ({ jour, j1: j1[i], j7: j7[i], j28: j28[i] })),
    pays: top(compterPar(sessions, (s) => s.pays ?? '??'), 'pays'),
    parHeure,
    parJourDeSemaine,
    sources: top(compterPar(sessions, (s) => s.source), 'source'),
    appareils: top(compterPar(sessions, (s) => s.appareil), 'appareil'),
    entrees: top(compterPar(avecPages, (s) => s.pages[0]), 'chemin'),
    sorties: top(compterPar(avecPages, (s) => s.pages[s.pages.length - 1]), 'chemin'),
    parcours: entree.parcours.map((p) => fluxDeParcours(reconnues, p)),
    flux: fluxDeComportement(reconnues),
  };
}

/* ------------------------------------------------------------------ */
/* La disposition des blocs du tableau de bord                          */
/* ------------------------------------------------------------------ */

/** Ce qui est gardé (préférence de l'utilisateur, la même sur tous ses appareils et pour tous les sites). */
export interface DispositionDesBlocs {
  ordre: string[];
  masques: string[];
}

/**
 * LA DISPOSITION REMISE D'APLOMB : l'ordre gardé, sans les blocs qui
 * n'existent plus ; un bloc nouveau se range juste après celui qui le précède
 * dans l'ordre par défaut (en tête s'il est le premier) — un graphique ajouté
 * au milieu d'un onglet n'échoue pas en bas chez ceux qui ont déjà rangé.
 * Une préférence illisible rend la disposition par défaut.
 */
export function dispositionDesBlocs(existants: readonly string[], gardee: unknown): DispositionDesBlocs {
  const g = gardee && typeof gardee === 'object' ? (gardee as Partial<DispositionDesBlocs>) : {};
  const connus = new Set(existants);
  const ordre = (Array.isArray(g.ordre) ? g.ordre : []).filter((id): id is string => typeof id === 'string' && connus.has(id));
  const vus = new Set(ordre);
  existants.forEach((id, i) => {
    if (vus.has(id)) return;
    ordre.splice(i === 0 ? 0 : ordre.indexOf(existants[i - 1]) + 1, 0, id);
    vus.add(id);
  });
  const masques = (Array.isArray(g.masques) ? g.masques : []).filter((id): id is string => typeof id === 'string' && connus.has(id));
  return { ordre: [...new Set(ordre)], masques: [...new Set(masques)] };
}

/** UN BLOC DÉPLACÉ avant ou après un autre ; l'ordre est rendu neuf. */
export function deplacerLeBloc(ordre: readonly string[], id: string, cible: string, position: 'before' | 'after'): string[] {
  if (id === cible || !ordre.includes(id) || !ordre.includes(cible)) return [...ordre];
  const sans = ordre.filter((x) => x !== id);
  const rang = sans.indexOf(cible) + (position === 'after' ? 1 : 0);
  return [...sans.slice(0, rang), id, ...sans.slice(rang)];
}

import { aLaFormeDUnMoteur, nomCourtDuMoteur, type IdDeMoteur } from './registre-moteurs.js';
/**
 * LE MODE « CRÉATION » — les règles pures, sans moteur, sans base ni disque.
 *
 * Un interrupteur de la barre d'écriture, à côté de « Plan », mémorisé SUR LA
 * CARTE (`parcours.creationSouhaitee`) et éteint à la naissance. Allumé, l'agent
 * de la carte devient CHEF D'ORCHESTRE : il confie le texte à un moteur, le code
 * à un autre, demande des avis complémentaires aux moteurs installés sur le
 * serveur, et fait départager les propositions par le juge local (Laya).
 *
 * Ce fichier décide QUI répond à quel rôle, à partir du réglage global
 * (`Settings.creation`) et du catalogue RÉEL des moteurs (`catalogueMoteurs`,
 * modèles lus du moteur, jamais écrits en dur). L'exécution — le tour de
 * service borné, l'appel au juge — vit dans `server/src/mode-creation.ts`.
 *
 * TROIS INVARIANTS :
 *  - un moteur sans compte disponible est CONTOURNÉ, jamais attendu ;
 *  - le repli ne bascule JAMAIS tout seul vers Cursor (DEC-248) : Cursor ne
 *    répond qu'aux rôles où il est explicitement réglé ;
 *  - une suggestion acceptée ne vaut que pour LA CARTE : le réglage global et
 *    le modèle de la carte ne sont jamais réécrits (DEC-213).
 */

import { z } from 'zod';
import type { IdMoteur, MoteurCatalogue } from './reglages-proposition.js';

/* ------------------------------------------------------------------ */
/* LE RÉGLAGE : rôle → moteur (et modèle facultatif)                   */
/* ------------------------------------------------------------------ */

export const ROLES_CREATION = ['texte', 'code', 'avis'] as const;
export type RoleCreation = (typeof ROLES_CREATION)[number];

export const AffectationCreation = z.object({
  moteur: z.custom<IdDeMoteur>(aLaFormeDUnMoteur, { message: 'moteur inconnu' }),
  /** Vide : le modèle par défaut du moteur, lu dans son catalogue. */
  modele: z.string().optional(),
});
export type AffectationCreation = z.infer<typeof AffectationCreation>;

/** Le plafond d'avis par défaut, par tour du chef. */
export const PLAFOND_AVIS_PAR_DEFAUT = 3;

/**
 * LES DÉLÉGATIONS D'UN TOUR, TOUS RÔLES CONFONDUS. Les avis ont leur plafond
 * réglable ; celui-ci borne le reste, pour qu'un chef qui boucle ne vide pas
 * le quota de trois comptes en un seul tour.
 */
export const PLAFOND_DELEGATIONS_PAR_TOUR = 8;

export const ReglageCreation = z.object({
  texte: AffectationCreation.default({ moteur: 'codex' }),
  code: AffectationCreation.default({ moteur: 'claude' }),
  avis: z.array(AffectationCreation).default([{ moteur: 'cursor' }]),
  plafondAvis: z.number().int().min(0).max(10).default(PLAFOND_AVIS_PAR_DEFAUT),
});
export type ReglageCreation = z.infer<typeof ReglageCreation>;

/** Le réglage lu, toujours complet : un champ absent reprend son défaut. */
export function reglageCreation(brut: unknown): ReglageCreation {
  const lu = ReglageCreation.safeParse(brut ?? {});
  return lu.success ? lu.data : ReglageCreation.parse({});
}

/* ------------------------------------------------------------------ */
/* LA RÉSOLUTION : un rôle → un moteur réellement utilisable           */
/* ------------------------------------------------------------------ */

export interface ChoixCreation {
  moteur: IdMoteur;
  /** Absent : le moteur part sur son modèle par défaut. */
  modele?: string;
  /** Rempli quand le moteur voulu a été contourné : la raison, en clair. */
  repli?: string;
}

const NOMS: Partial<Record<IdMoteur, string>> = { codex: 'GPT (Codex)' };

/** Le nom lisible d'un moteur. */
export function nomDuMoteurCreation(moteur: IdMoteur): string {
  return NOMS[moteur] ?? nomCourtDuMoteur(moteur);
}

function utilisable(catalogue: readonly MoteurCatalogue[], moteur: IdMoteur): MoteurCatalogue | undefined {
  const trouve = catalogue.find((m) => m.id === moteur);
  return trouve && trouve.installed && trouve.comptesDisponibles > 0 ? trouve : undefined;
}

/**
 * LE MODÈLE DEMANDÉ, S'IL EXISTE VRAIMENT CHEZ LE MOTEUR. Un modèle inconnu
 * (retiré, mal écrit) retombe sur le défaut du moteur plutôt que de faire
 * échouer la délégation.
 */
function modeleExistant(moteur: MoteurCatalogue, modele: string | undefined): string | undefined {
  const voulu = modele?.trim();
  if (voulu && moteur.models.some((m) => m.id === voulu)) return voulu;
  return moteur.defaultModel || undefined;
}

/**
 * LE REPLI D'UN RÔLE PRINCIPAL : Claude et GPT se relaient, et seulement eux.
 * Le code tente Claude avant GPT, le texte GPT avant Claude — la même
 * préférence que le tri automatique des cartes (DEC-248).
 */
function ordreDeRepli(role: 'texte' | 'code'): IdMoteur[] {
  return role === 'code' ? ['claude', 'codex'] : ['codex', 'claude'];
}

/**
 * QUI RÉPOND AU RÔLE « texte » OU « code ». La surcharge (une suggestion
 * acceptée pour cette carte) passe avant le réglage ; un moteur sans quota ou
 * absent est contourné. `null` : aucun moteur ne peut répondre.
 */
export function resoudreRoleCreation(
  role: 'texte' | 'code',
  reglage: ReglageCreation,
  catalogue: readonly MoteurCatalogue[],
  surcharge?: AffectationCreation,
): ChoixCreation | null {
  const voulu = surcharge ?? reglage[role];
  const direct = utilisable(catalogue, voulu.moteur);
  if (direct) return { moteur: direct.id, modele: modeleExistant(direct, voulu.modele) };
  for (const autre of ordreDeRepli(role)) {
    if (autre === voulu.moteur) continue;
    const relais = utilisable(catalogue, autre);
    if (relais) {
      return {
        moteur: relais.id,
        modele: modeleExistant(relais, undefined),
        repli: `${nomDuMoteurCreation(voulu.moteur)} n’a plus de compte disponible : ${nomDuMoteurCreation(relais.id)} prend le relais.`,
      };
    }
  }
  return null;
}

/**
 * LES MOTEURS D'AVIS ENCORE OUVERTS DANS CE TOUR, dans l'ordre du réglage : ceux
 * qui ont du quota, sans doublon, et pas plus que ce que le plafond laisse. Un
 * moteur d'avis sans quota est simplement sauté — aucun repli vers un autre
 * moteur n'est inventé ici, l'avis est un bonus.
 */
export function moteursDAvis(
  reglage: ReglageCreation,
  catalogue: readonly MoteurCatalogue[],
  avisDejaDonnes: number,
  surcharge?: AffectationCreation,
): ChoixCreation[] {
  const restants = Math.max(0, reglage.plafondAvis - Math.max(0, avisDejaDonnes));
  if (!restants) return [];
  const liste = surcharge ? [surcharge, ...reglage.avis] : reglage.avis;
  const vus = new Set<string>();
  const choix: ChoixCreation[] = [];
  for (const affectation of liste) {
    const moteur = utilisable(catalogue, affectation.moteur);
    if (!moteur) continue;
    const modele = modeleExistant(moteur, affectation.modele);
    const cle = `${moteur.id}/${modele ?? ''}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    choix.push({ moteur: moteur.id, ...(modele ? { modele } : {}) });
  }
  return choix.slice(0, restants);
}

/* ------------------------------------------------------------------ */
/* LA SUGGESTION DE MODÈLE : posée comme une question, acceptée ou non */
/* ------------------------------------------------------------------ */

/** Ce que la carte garde d'une suggestion posée, en attendant la réponse. */
export const SuggestionCreation = z.object({
  questionId: z.string(),
  /** L'agent qui a posé la question : c'est dans SON fil que vit la réponse. */
  agentId: z.string().optional(),
  role: z.enum(ROLES_CREATION),
  moteur: z.custom<IdDeMoteur>(aLaFormeDUnMoteur, { message: 'moteur inconnu' }),
  modele: z.string().optional(),
  at: z.number(),
});
export type SuggestionCreation = z.infer<typeof SuggestionCreation>;

export const REPONSE_ACCEPTER = 'Accepter';
export const REPONSE_REFUSER = 'Refuser';

const LIBELLES_ROLES: Record<RoleCreation, string> = {
  texte: 'le texte',
  code: 'le code',
  avis: 'les avis complémentaires',
};

/** La question posée à l'utilisateur, prête pour la bulle « Accepter / Refuser ». */
export function questionDeSuggestion(suggestion: {
  role: RoleCreation;
  moteur: IdMoteur;
  modele?: string;
  raison: string;
}): { question: string; description: string; options: { label: string; description: string }[] } {
  const cible = `${nomDuMoteurCreation(suggestion.moteur)}${suggestion.modele ? ` (${suggestion.modele})` : ''}`;
  return {
    question: `Confier ${LIBELLES_ROLES[suggestion.role]} de cette carte à ${cible} ?`,
    description: suggestion.raison.trim().slice(0, 600),
    options: [
      { label: REPONSE_ACCEPTER, description: 'Pour cette carte seulement ; vos réglages ne changent pas.' },
      { label: REPONSE_REFUSER, description: 'La répartition réglée reste appliquée.' },
    ],
  };
}

/** La réponse donnée vaut-elle acceptation ? Le choix « Accepter », complément libre toléré. */
export function suggestionAcceptee(reponse: string | undefined): boolean {
  return /^\s*accepter\b/i.test(reponse ?? '');
}

/**
 * LES SURCHARGES EN VIGUEUR SUR LA CARTE : pour chaque rôle, la DERNIÈRE
 * suggestion ACCEPTÉE. Une suggestion refusée, sans réponse ou annulée ne
 * change rien ; une acceptation plus récente remplace la précédente.
 */
export function surchargesAcceptees(
  suggestions: readonly SuggestionCreation[] | undefined,
  reponses: ReadonlyMap<string, string | undefined>,
): Partial<Record<RoleCreation, AffectationCreation>> {
  const surcharges: Partial<Record<RoleCreation, AffectationCreation>> = {};
  const triees = [...(suggestions ?? [])].sort((a, b) => a.at - b.at);
  for (const suggestion of triees) {
    if (!suggestionAcceptee(reponses.get(suggestion.questionId))) continue;
    surcharges[suggestion.role] = {
      moteur: suggestion.moteur,
      ...(suggestion.modele ? { modele: suggestion.modele } : {}),
    };
  }
  return surcharges;
}

/* ------------------------------------------------------------------ */
/* L'ÉVALUATION : départager des propositions par le juge local        */
/* ------------------------------------------------------------------ */

/** Au plus cinq propositions départagées d'un coup : au-delà, le juge local se perd. */
export const PROPOSITIONS_A_DEPARTAGER_MAX = 5;

/** La clé de la proposition n (1, 2…) telle que le juge la choisit. */
export function cleDeProposition(numero: number): string {
  return `proposition-${numero}`;
}

/** Le numéro choisi par le juge, ou `undefined` si la réponse n'en est pas une. */
export function numeroDeProposition(cle: string | undefined, nombre: number): number | undefined {
  const lu = Number(/^proposition-(\d+)$/.exec(cle ?? '')?.[1]);
  return Number.isInteger(lu) && lu >= 1 && lu <= nombre ? lu : undefined;
}

/* ------------------------------------------------------------------ */
/* LA CONSIGNE DU MODE : elle part AVEC LA DEMANDE DU TOUR              */
/* ------------------------------------------------------------------ */

function ligneDAffectation(choix: ChoixCreation | null): string {
  if (!choix) return 'aucun moteur disponible pour l’instant — fais-le toi-même';
  const nom = `${nomDuMoteurCreation(choix.moteur)}${choix.modele ? ` (${choix.modele})` : ''}`;
  return choix.repli ? `${nom} — ${choix.repli}` : nom;
}

/**
 * LE BLOC AJOUTÉ À LA DEMANDE DU TOUR quand le mode est allumé. Jamais à la
 * consigne système : elle ne change pas d'un tour à l'autre dans une session,
 * et un interrupteur basculé en cours de conversation doit prendre effet au
 * message suivant.
 */
export function consigneDuModeCreation(options: {
  reglage: ReglageCreation;
  catalogue: readonly MoteurCatalogue[];
  surcharges?: Partial<Record<RoleCreation, AffectationCreation>>;
  jugeDisponible: boolean;
}): string {
  const { reglage, catalogue, surcharges = {} } = options;
  const texte = resoudreRoleCreation('texte', reglage, catalogue, surcharges.texte);
  const code = resoudreRoleCreation('code', reglage, catalogue, surcharges.code);
  const avis = moteursDAvis(reglage, catalogue, 0, surcharges.avis);
  const lignesAvis = avis.length
    ? avis.map((choix) => ligneDAffectation(choix)).join(', ')
    : 'aucun moteur d’avis disponible';
  return [
    'MODE CRÉATION ALLUMÉ SUR CETTE CARTE — tu es CHEF D’ORCHESTRE de plusieurs modèles.',
    'Répartition en vigueur :',
    `- texte (rédaction, formulation, contenu éditorial) : ${ligneDAffectation(texte)}`,
    `- code (programmation) : ${ligneDAffectation(code)}`,
    `- avis complémentaires (au plus ${reglage.plafondAvis} par tour) : ${lignesAvis}`,
    `- évaluation : ${options.jugeDisponible ? 'Laya, le juge local' : 'juge local absent — tranche toi-même'}`,
    'Méthode :',
    '1. Pour chaque morceau de texte ou de code qui compte, demande une proposition au rôle concerné avec l’outil « deleguer » (rôle, consigne précise, fichiers utiles). Le moteur consulté LIT la copie de travail mais n’écrit rien : c’est toi seul qui modifies les fichiers.',
    '2. Sur un choix créatif ou une solution discutable, demande un ou deux regards neufs avec « deleguer » au rôle « avis ».',
    '3. Quand tu as plusieurs propositions pour la même chose, départage-les avec « evaluer ». Son verdict est un conseil : tu gardes le dernier mot.',
    '4. Si un autre modèle servirait nettement mieux un rôle, propose-le avec « suggerer_modele » : l’utilisateur accepte ou refuse, et tu attends sa réponse.',
    '5. Assemble UN résultat unique et cohérent, puis applique-le toi-même. Dis en une phrase, dans ta réponse, qui a contribué à quoi.',
    'Ne délègue pas ce qui se fait en une ligne : le mode sert la qualité, pas la cérémonie.',
  ].join('\n');
}

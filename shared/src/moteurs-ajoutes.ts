import { z } from 'zod';
import { FORME_ID_MOTEUR_AJOUTE, IDS_MOTEURS, type FicheMoteur } from './registre-moteurs.js';
import type { AccesCoffre } from './coffre-fort.js';

/**
 * LES MOTEURS AJOUTÉS DEPUIS LES RÉGLAGES — les règles pures.
 *
 * Un agent (« Ajouter un moteur », Réglages › Comptes) étudie un fournisseur,
 * DÉCLARE sa fiche, l'ÉPROUVE par un vrai tour, puis l'ACTIVE. Ce fichier dit
 * ce qu'une fiche doit contenir, et ce qu'une épreuve doit avoir montré pour
 * qu'un moteur devienne utilisable : un fournisseur dont on n'a pas vu
 * l'outil répondre ne se retrouve jamais dans les menus.
 */

export const FicheMoteurZ = z.object({
  id: z.string().regex(FORME_ID_MOTEUR_AJOUTE) as unknown as z.ZodType<`ext-${string}`>,
  label: z.string().min(1).max(60),
  nomCourt: z.string().min(1).max(24),
  famille: z.enum(['anthropic', 'openai']),
  urlDeBase: z.string().url(),
  api: z.enum(['responses', 'chat']).optional(),
  urlDesModeles: z.string().url().optional(),
  pageDesCles: z.string().url().optional(),
  modeleParDefaut: z.string().min(1).max(120),
  modeleLeger: z.string().min(1).max(120).optional(),
  statut: z.enum(['essai', 'actif', 'retire']),
  epreuve: z
    .object({
      ok: z.boolean(),
      at: z.number(),
      resume: z.string(),
      constat: z
        .object({
          cleAcceptee: z.boolean(),
          cleRefusee: z.boolean().optional(),
          formatReconnu: z.boolean(),
          outilUtilise: z.boolean(),
          reponseJuste: z.boolean(),
        })
        .optional(),
    })
    .optional(),
  carteId: z.string().optional(),
  creeLe: z.number(),
}) satisfies z.ZodType<FicheMoteur>;

/** « DeepSeek (Chine) » → « ext-deepseek-chine ». */
export function idDeMoteurAjoute(nom: string): `ext-${string}` {
  const racine =
    nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'moteur';
  return `ext-${racine}`;
}

/** Ce que l'agent déclare ; le reste (identifiant, statut, dates) est posé par le démon. */
export interface DeclarationDeMoteur {
  label: string;
  nomCourt?: string;
  famille: string;
  urlDeBase: string;
  /** Famille openai : « responses » ou « chat » (chat/completions seulement). Absent : l'épreuve le détecte. */
  api?: string;
  urlDesModeles?: string;
  pageDesCles?: string;
  modeleParDefaut: string;
  modeleLeger?: string;
}

/**
 * JUGER UNE DÉCLARATION : une fiche, ou la raison du refus en clair (l'agent
 * la lit et corrige). Une adresse doit être en `https`, et un fournisseur qui
 * n'imite ni Anthropic ni OpenAI n'a pas de fiche — il demande du
 * développement, donc une carte.
 */
export function jugerDeclaration(
  entree: DeclarationDeMoteur,
  existants: readonly Pick<FicheMoteur, 'id' | 'statut'>[],
  maintenant: number,
): { fiche: FicheMoteur } | { refus: string } {
  const label = (entree.label ?? '').trim();
  if (!label) return { refus: 'il faut un nom (« label ») pour ce moteur' };
  if (entree.famille !== 'anthropic' && entree.famille !== 'openai') {
    return {
      refus:
        'famille inconnue : seule une API compatible Anthropic (« anthropic ») ou OpenAI (« openai », format responses ou chat/completions) devient une fiche. Sinon, propose une carte de développement.',
    };
  }
  if (entree.api !== undefined && entree.api !== '' && entree.api !== 'responses' && entree.api !== 'chat') {
    return { refus: '« api » vaut « responses » ou « chat » (famille openai seulement)' };
  }
  for (const [champ, valeur] of [
    ['urlDeBase', entree.urlDeBase],
    ['urlDesModeles', entree.urlDesModeles],
    ['pageDesCles', entree.pageDesCles],
  ] as const) {
    if (valeur === undefined || valeur === '') continue;
    if (!/^https:\/\/[^\s/]+/.test(valeur)) return { refus: `« ${champ} » doit être une adresse https complète` };
  }
  if (!entree.urlDeBase) return { refus: 'il faut l’adresse de base de l’API (« urlDeBase »)' };
  if (!(entree.modeleParDefaut ?? '').trim()) return { refus: 'il faut le modèle par défaut (« modeleParDefaut »)' };

  const id = idDeMoteurAjoute(label);
  if ((IDS_MOTEURS as readonly string[]).includes(id.slice(4))) {
    return { refus: `« ${label} » est déjà un moteur intégré de l’application` };
  }
  const deja = existants.find((f) => f.id === id);
  if (deja && deja.statut === 'actif') {
    return { refus: `un moteur « ${label} » est déjà actif : retire-le d’abord depuis les comptes pour le redéclarer` };
  }
  const parsee = FicheMoteurZ.safeParse({
    id,
    label,
    nomCourt: (entree.nomCourt ?? '').trim() || label.split(/\s+/)[0],
    famille: entree.famille,
    urlDeBase: entree.urlDeBase.replace(/\/+$/, ''),
    api: entree.famille === 'openai' && (entree.api === 'chat' || entree.api === 'responses') ? entree.api : undefined,
    urlDesModeles: entree.urlDesModeles || undefined,
    pageDesCles: entree.pageDesCles || undefined,
    modeleParDefaut: entree.modeleParDefaut.trim(),
    modeleLeger: entree.modeleLeger?.trim() || undefined,
    statut: 'essai',
    creeLe: maintenant,
  });
  if (!parsee.success) {
    return { refus: `fiche illisible : ${parsee.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}` };
  }
  return { fiche: parsee.data };
}

/** Ce qu'un tour d'épreuve a montré. */
export interface ConstatDEpreuve {
  cleAcceptee: boolean;
  /**
   * Le fournisseur a-t-il DIT que la clé est mauvaise (401/403) ? Une sonde
   * restée sans réponse ou refusée pour surcharge ne prouve rien sur la clé :
   * on ne l'écrit alors jamais « clé refusée ».
   */
  cleRefusee?: boolean;
  /**
   * Le fournisseur parle-t-il un format que l'application sait conduire ?
   * Faux quand la sonde ne trouve ni la route de la famille ni son repli
   * (réponse « introuvable ») : ce n'est PAS une clé refusée.
   */
  formatReconnu: boolean;
  /** L'outil a-t-il appelé au moins un outil (lecture du fichier) ? */
  outilUtilise: boolean;
  /** La réponse finale contient-elle le mot attendu ? */
  reponseJuste: boolean;
  /** Le processus s'est-il refermé seul, sans être coupé ? */
  finPropre: boolean;
  /** La liste des modèles a-t-elle répondu (quand la fiche en donne l'adresse) ? */
  modelesLus: boolean | null;
  /** L'usage (jetons) a-t-il été rapporté ? Informatif : son absence n'échoue pas. */
  usageLu: boolean;
  erreur?: string;
}

/** Le verdict : vert seulement si tout ce qui compte a été VU. */
export function verdictDEpreuve(constat: ConstatDEpreuve): { ok: boolean; resume: string } {
  const manques: string[] = [];
  if (!constat.formatReconnu) manques.push('le fournisseur ne parle aucun format que l’application sait conduire');
  else if (!constat.cleAcceptee) {
    manques.push(constat.cleRefusee === false ? 'le fournisseur n’a pas répondu à la sonde (la clé n’est pas en cause)' : 'la clé n’a pas été acceptée');
  }
  // Sonde ratée : le tour n'a pas été joué, on ne lui prête aucun manque.
  if (manques.length) {
    return { ok: false, resume: `Épreuve ratée : ${manques.join(' ; ')}.${constat.erreur ? ` Erreur : ${constat.erreur}` : ''}` };
  }
  if (!constat.outilUtilise) manques.push('aucun outil n’a été utilisé (lecture du fichier)');
  if (!constat.reponseJuste) manques.push('la réponse finale n’est pas la bonne');
  if (!constat.finPropre) manques.push('le processus ne s’est pas arrêté proprement');
  if (constat.modelesLus === false) manques.push('la liste des modèles n’a pas répondu');
  if (manques.length) {
    return { ok: false, resume: `Épreuve ratée : ${manques.join(' ; ')}.${constat.erreur ? ` Erreur : ${constat.erreur}` : ''}` };
  }
  return {
    ok: true,
    resume: `Épreuve réussie : clé acceptée, fichier lu par un outil, bonne réponse, fin propre${
      constat.modelesLus ? ', liste des modèles lue' : ''
    }${constat.usageLu ? ', consommation rapportée' : ''}.`,
  };
}

/** Pourquoi on sait, ou non, qu'un moteur ajouté peut faire tourner des agents. */
export type MotifDeCompatibilite =
  | 'eprouve'
  | 'jamais-eprouve'
  | 'format-inconnu'
  | 'cle-refusee'
  | 'sans-reponse'
  | 'sans-outil'
  | 'inacheve';

/**
 * CE MOTEUR PEUT-IL FAIRE TOURNER DES AGENTS ? Déduit de ce que la dernière
 * épreuve a VU : un agent lit et écrit des fichiers par des outils, donc un
 * fournisseur qui accepte la clé mais n'appelle jamais d'outil ne le peut pas.
 * `inconnue` tant que rien n'a été vu (jamais éprouvé, clé à revoir). L'écran
 * traduit le `motif` ; `raison` est la phrase française des agents et du journal.
 */
export function compatibiliteAgents(fiche: Pick<FicheMoteur, 'statut' | 'epreuve'>): {
  etat: 'oui' | 'non' | 'inconnue';
  motif: MotifDeCompatibilite;
  raison: string;
} {
  if (fiche.statut === 'actif' || fiche.epreuve?.ok) {
    return { etat: 'oui', motif: 'eprouve', raison: 'peut faire tourner des agents : il lit et écrit des fichiers' };
  }
  const vu = fiche.epreuve?.constat;
  if (!fiche.epreuve || !vu) {
    return { etat: 'inconnue', motif: 'jamais-eprouve', raison: 'pas encore éprouvé : on ne sait pas s’il peut faire tourner des agents' };
  }
  if (!vu.formatReconnu) {
    return { etat: 'non', motif: 'format-inconnu', raison: 'incompatible avec les agents : ce fournisseur ne parle aucun format que l’application sait conduire' };
  }
  if (!vu.cleAcceptee && vu.cleRefusee === false) {
    return { etat: 'inconnue', motif: 'sans-reponse', raison: 'le fournisseur n’a pas répondu (surcharge ou délai) : relancez l’essai plus tard' };
  }
  if (!vu.cleAcceptee) {
    return { etat: 'inconnue', motif: 'cle-refusee', raison: 'clé refusée : impossible de savoir s’il peut faire tourner des agents' };
  }
  if (!vu.outilUtilise) {
    return { etat: 'non', motif: 'sans-outil', raison: 'incompatible avec les agents : ce modèle n’a pas su utiliser un outil pour lire un fichier' };
  }
  return { etat: 'inconnue', motif: 'inacheve', raison: 'outils utilisés, mais l’épreuve n’est pas allée au bout' };
}

/** Une activation est-elle permise ? Seulement après une épreuve VERTE. */
export function activationPermise(fiche: Pick<FicheMoteur, 'statut' | 'epreuve'> | undefined): { ok: true } | { ok: false; raison: string } {
  if (!fiche) return { ok: false, raison: 'aucune fiche à ce nom : déclare-la d’abord' };
  if (fiche.statut === 'retire') return { ok: false, raison: 'ce moteur a été retiré : redéclare-le' };
  if (fiche.statut === 'actif') return { ok: true };
  if (!fiche.epreuve) return { ok: false, raison: 'le moteur n’a jamais été éprouvé : lance l’épreuve d’abord' };
  if (!fiche.epreuve.ok) return { ok: false, raison: `la dernière épreuve a échoué — ${fiche.epreuve.resume}` };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La consigne de l'agent « Ajouter un moteur »                        */
/* ------------------------------------------------------------------ */

/**
 * CE QUE L'AGENT DU TIROIR LIT À SON PREMIER MESSAGE. Il étudie le fournisseur
 * demandé, et ne rend un moteur utilisable qu'après une épreuve verte ; sinon,
 * il pose une carte de développement.
 */
export function consigneAjoutDeMoteur(fiches: readonly Pick<FicheMoteur, 'id' | 'label' | 'statut' | 'famille'>[]): string {
  const connues = fiches.length
    ? fiches.map((f) => `- ${f.label} (${f.id}, ${f.famille}, ${f.statut})`).join('\n')
    : '- aucun pour l’instant';
  return [
    'TU ES L’AGENT « AJOUTER UN MOTEUR » DE BELUGA BUILD, ouvert depuis Réglages › Comptes.',
    'L’utilisateur ne programme pas : parle-lui simplement, en français, sans jargon.',
    '',
    'TA MISSION : ajouter à l’application le fournisseur de modèles (LLM) qu’il nomme, pour que ses agents puissent travailler avec.',
    'Moteurs intégrés, rien à faire pour eux : Claude, Codex (GPT), Cursor, Xiaomi MiMo.',
    `Moteurs déjà ajoutés :\n${connues}`,
    '',
    'MÉTHODE, dans cet ordre :',
    '1. Si le fournisseur n’est pas clair, demande-le avec ask_user.',
    '2. Étudie sa documentation officielle (WebSearch, WebFetch) : a-t-il une API COMPATIBLE ANTHROPIC (route /v1/messages, en-tête x-api-key) ou COMPATIBLE OPENAI (route /responses, ou seulement /chat/completions — comme Gemini —, en-tête Bearer) ? Relève l’adresse de base exacte, l’adresse de la liste des modèles (format { data: [{ id }] }), la page où l’on crée une clé, un modèle par défaut équilibré et un modèle léger. Préfère Anthropic quand les deux existent.',
    '3. La clé : cherche-la d’abord dans le coffre (outil coffre_fort, « lister », avec le nom du fournisseur). Sinon, demande-la avec ask_user. Toute clé reçue s’enregistre aussitôt au coffre (« enregistrer », une fiche par clé, type cle-api).',
    '4. Outil « moteurs », action « declarer » : la fiche (label, nomCourt, famille anthropic|openai, api responses|chat pour openai, urlDeBase, urlDesModeles, pageDesCles, modeleParDefaut, modeleLeger). Pour anthropic, urlDeBase est ce qui précède /v1/messages ; pour openai, ce qui précède /responses ou /chat/completions (souvent terminé par /v1). Sans « api », l’épreuve détecte seule le format ; une réponse « introuvable » n’est JAMAIS une clé refusée.',
    '5. Action « eprouver » (id, cle) : un vrai tour dans un dossier jetable — clé acceptée, fichier lu par un outil, bonne réponse, fin propre, liste des modèles. Si elle échoue, lis la raison, corrige la fiche (redéclare) et réessaie, deux ou trois fois au plus.',
    '6. Épreuve verte : action « activer » (id). Le moteur apparaît dans les menus et un premier compte naît avec la clé éprouvée. Dis-le à l’utilisateur en une ou deux phrases, et rappelle-lui qu’il ajoute d’autres clés depuis les comptes.',
    '',
    'L’AJOUT A SA CARTE sur le tableau : elle suit l’état de la demande toute seule, ne la déplace pas et n’en crée pas d’autre pour le même ajout.',
    '',
    'SI LE FOURNISSEUR N’IMITE NI ANTHROPIC NI OPENAI, OU SI L’ÉPREUVE RESTE ROUGE : n’active rien. Explique pourquoi simplement, puis pose une carte de développement dans Beluga Build (board_create_card, colonne Planifié) avec ce que tu as appris : adresses, format, authentification, modèles, ce qui a échoué. Elle ne part jamais seule.',
    '',
    'INTERDITS : ne modifie aucun fichier de projet, ne publie rien, ne redémarre rien. Tu ne fais que chercher, déclarer, éprouver, activer, ou proposer une carte.',
  ].join('\n');
}

/** Le rappel court des messages suivants. */
export function rappelAjoutDeMoteur(): string {
  return 'Rappel : tu es l’agent « Ajouter un moteur ». Outil « moteurs » (lister, declarer, eprouver, activer) ; activation seulement après une épreuve verte ; sinon, une carte de développement dans Planifié. Parle simplement.';
}

/* ------------------------------------------------------------------ */
/* La carte d'un ajout de moteur                                       */
/* ------------------------------------------------------------------ */

/**
 * L'ÉTIQUETTE DES CARTES D'AJOUT DE MOTEUR. Chaque conversation avec l'agent
 * « Ajouter un LLM » a sa carte sur le tableau (projet Beluga Build), qui suit
 * l'état de la demande. Son agent ne déplace rien (rôle `deploy`) : c'est le
 * démon qui la range d'après la fiche, et le balayage des cartes oubliées la
 * laisse en paix — sinon il rangerait un essai raté comme un travail fini.
 */
export const ETIQUETTE_AJOUT_DE_MOTEUR = 'ajout-de-llm';

/** Le titre de la carte : le nom du fournisseur dès qu'il est déclaré. */
export function titreDeLAjout(fiche: Pick<FicheMoteur, 'label'> | undefined, premierMessage?: string): string {
  if (fiche) return `Ajout du LLM « ${fiche.label} »`.slice(0, 80);
  const debut = (premierMessage ?? '').replace(/\s+/g, ' ').trim();
  return (debut ? `Ajout d’un LLM — ${debut}` : 'Ajout d’un LLM').slice(0, 80);
}

/**
 * OÙ VA LA CARTE, ET CE QU'ELLE DIT. « Travail » (`running`) tant que le
 * moteur n'est pas actif — étude, essai, essai raté (avec sa raison et le
 * geste pour repartir) ; « Archivé » une fois actif ou retiré : aucune branche,
 * rien à déployer, comme les autres cartes d'agents du démon
 * (`rangerCarteDAgent`). Un agent au travail garde toujours sa carte en
 * « Travail ». La phrase suit le VRAI verdict de l'épreuve.
 */
export function etatDeLaCarteDAjout(
  fiche: Pick<FicheMoteur, 'label' | 'statut' | 'epreuve'> | undefined,
  agentAuTravail: boolean,
): { colonne: 'running' | 'archived'; phrase: string } {
  if (agentAuTravail) {
    return { colonne: 'running', phrase: fiche ? `L’agent travaille sur « ${fiche.label} ».` : 'L’agent étudie le fournisseur demandé.' };
  }
  if (!fiche) return { colonne: 'running', phrase: 'Aucun moteur déclaré pour l’instant : écrivez à l’agent pour continuer.' };
  if (fiche.statut === 'actif') {
    return { colonne: 'archived', phrase: `« ${fiche.label} » est actif : il fait tourner des agents et apparaît dans le choix des moteurs.` };
  }
  if (fiche.statut === 'retire') return { colonne: 'archived', phrase: `« ${fiche.label} » a été retiré des comptes.` };
  if (!fiche.epreuve) {
    return { colonne: 'running', phrase: `« ${fiche.label} » est déclaré, pas encore essayé. Collez sa clé dans Réglages › Comptes et quotas pour lancer l’essai.` };
  }
  if (fiche.epreuve.ok) return { colonne: 'running', phrase: `Essai réussi pour « ${fiche.label} » : il reste à l’activer.` };
  const compat = compatibiliteAgents(fiche);
  const suite =
    compat.etat === 'non'
      ? ` Ce moteur ${compat.raison.replace(/^incompatible/, 'est incompatible')}.`
      : ' Collez une clé et relancez l’essai depuis Réglages › Comptes et quotas, ou écrivez à l’agent.';
  return { colonne: 'running', phrase: `${fiche.epreuve.resume}${suite}` };
}

/** L'hôte d'une adresse, ou `''`. */
function hote(adresse: unknown): string {
  try {
    return typeof adresse === 'string' && adresse ? new URL(adresse).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * LA CLÉ DU FOURNISSEUR, RETROUVÉE AU COFFRE. « Réessayer l'essai » sans clé
 * collée reprend celle-ci : une fiche `cle-api` dont l'adresse vise le MÊME
 * hôte que la fiche du moteur, sinon dont le nom ou le service nomme le
 * fournisseur. La plus récente gagne.
 */
export function cleDuMoteurDansLeCoffre(acces: readonly AccesCoffre[], fiche: Pick<FicheMoteur, 'urlDeBase' | 'nomCourt' | 'label'>): string | undefined {
  const avecCle = acces.filter((a) => a.type === 'cle-api' && typeof a.champs?.cle === 'string' && a.champs.cle.trim());
  const recente = (liste: AccesCoffre[]) =>
    [...liste].sort((a, b) => (b.modifieLe || b.creeLe || 0) - (a.modifieLe || a.creeLe || 0))[0]?.champs.cle.trim();
  const cible = hote(fiche.urlDeBase);
  const parHote = cible ? avecCle.filter((a) => hote(a.champs.adresse) === cible) : [];
  if (parHote.length) return recente(parHote);
  const mots = [fiche.nomCourt, fiche.label.split(/\s+/).pop() ?? ''].map((m) => m.toLowerCase()).filter((m) => m.length >= 3);
  const parNom = avecCle.filter((a) => {
    const empreinte = [a.champs.service, a.nom].join(' ').toLowerCase();
    return mots.some((m) => empreinte.includes(m));
  });
  return parNom.length ? recente(parNom) : undefined;
}

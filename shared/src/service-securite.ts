/**
 * LE SERVICE « SÉCURITÉ » — les règles pures de l'audit SUIVI d'un projet (carte « Service Sécurité des projets »,
 * 15/11/2026).
 *
 * Le contrôle lui-même existe déjà (`controle-securite.ts` ici, `server/src/controle-securite.ts` pour les relevés) :
 * ce module ne juge aucun code. Il dit ce qui fait le SUIVI d'un projet au fil des semaines :
 *
 *  - l'EMPREINTE d'un point, qui le reconnaît d'un audit à l'autre. Elle se tire de la catégorie et de l'identifiant
 *    du constat (déjà stable et groupé : « entete-csp », « secrets-navigateur », « injection-sql »…), JAMAIS du titre
 *    (qui porte des nombres) ni d'un numéro de ligne (qui bouge à chaque modification). Sans cela, chaque semaine
 *    ferait naître de faux « Nouveau » et de fausses alertes ;
 *  - l'ÉTAT de chaque point (à traiter, en correction, corrigé) après un audit ;
 *  - les points GRAVES NOUVEAUX, seuls à réveiller l'agent (et donc à dépenser du quota) ;
 *  - le PROCHAIN PASSAGE hebdomadaire, recalculé d'après le dernier audit (un minuteur de sept jours sauterait au
 *    moindre redémarrage) ;
 *  - la DURÉE DE GARDE de l'historique : douze mois, quel que soit le nombre d'audits.
 *
 * Décisions de l'utilisateur au cadrage : audit chaque semaine sans quota + audit à la demande ; une seule carte de
 * correction pour les points ajoutés ; contrôle relancé à la mise en ligne de cette carte ; alerte SEULEMENT pour un
 * nouveau point critique ou élevé ; historique de douze mois.
 */
import { ORDRE_DES_GRAVITES, type ConstatSecurite, type GraviteSecurite, type RapportDeSecurite } from './controle-securite.js';

/** Un audit par semaine. */
export const RYTHME_DES_AUDITS_MS = 7 * 24 * 60 * 60 * 1000;
/** L'historique gardé : douze mois, quel que soit le nombre d'audits. */
export const RETENTION_AUDITS_MS = 365 * 24 * 60 * 60 * 1000;
/** Les gravités qui se signalent dans le tableau comme point NOUVEAU (jamais un réveil d'agent). */
export const GRAVITES_QUI_ALERTENT: readonly GraviteSecurite[] = ['critique', 'elevee'];
/** L'étiquette posée sur la carte de l'agent de sécurité d'un projet : elle en fait un agent de volet. Jamais « securite » tout court, que des cartes ordinaires portent déjà. */
export const LABEL_SECURITE = 'agent-securite';

/**
 * `etude` : une ÉTUDE complète rédigée par un agent (cartes « Étude de sécurité … »), rattachée au service comme
 * premier rapport du projet (`etude-de-securite.ts`). Elle ne passe jamais par la file : elle est importée telle quelle.
 */
export type DeclencheurDAudit = 'hebdo' | 'manuel' | 'ajout' | 'apres-mise-en-ligne' | 'etude';
export type EtatDuPointDeSecurite = 'a-traiter' | 'en-correction' | 'corrige';

export const DECLENCHEURS_D_AUDIT: readonly DeclencheurDAudit[] = ['hebdo', 'manuel', 'ajout', 'apres-mise-en-ligne', 'etude'];
export const ETATS_DU_POINT_DE_SECURITE: readonly EtatDuPointDeSecurite[] = ['a-traiter', 'en-correction', 'corrige'];

/** Un projet suivi, tel que la liste du service le montre. */
export interface ProjetSuiviSecurite {
  projectId: string;
  ajouteLe: number;
  /** L'agent de sécurité du projet (sa conversation), une fois né. */
  agentId?: string;
  cardId?: string;
  /** Le dernier audit TERMINÉ (réussi ou non). */
  dernierAudit?: ResumeDAudit;
  /** Un audit attend ou tourne pour ce projet. */
  enCours: boolean;
  prochainPassage: number;
  /** Les points À TRAITER par gravité (ni en correction, ni corrigés). */
  aTraiter: Record<GraviteSecurite, number>;
  enCorrection: number;
}

/** Ce qu'une ligne de l'historique montre sans le rapport entier. */
export interface ResumeDAudit {
  id: string;
  lance: number;
  fini: number | null;
  declencheur: DeclencheurDAudit;
  erreur?: string;
  compte?: Record<GraviteSecurite, number>;
}

/** Un audit et son rapport. */
export interface AuditDeSecurite extends ResumeDAudit {
  projectId: string;
  rapport: RapportDeSecurite | null;
}

/** Le suivi d'un point, d'un audit à l'autre. */
export interface PointSuivi {
  empreinte: string;
  etat: EtatDuPointDeSecurite;
  /** La carte de correction qui porte ce point, tant qu'il est en correction (ou qui l'a corrigé). */
  cardId?: string;
  /** L'audit où il est apparu pour la première fois (le badge « Nouveau »). */
  premierAuditId: string;
  misAJourLe: number;
}

/** Ce que la page d'un projet reçoit : un audit, ses points suivis et ce qui y est nouveau. */
export interface VueDAudit {
  audit: AuditDeSecurite;
  points: PointSuivi[];
  /** Les empreintes absentes de l'audit précédent (badge « Nouveau »). */
  nouveaux: string[];
  /** Les titres des cartes de correction liées, pour leur lien. */
  cartes: Record<string, { titre: string; projectId: string }>;
}

/* ------------------------------------------------------------------ */
/* Empreinte et comparaison                                            */
/* ------------------------------------------------------------------ */

/** Ce qui reconnaît un point d'un audit à l'autre : sa catégorie et son identifiant, rien qui bouge. */
export function empreinteDuConstat(c: Pick<ConstatSecurite, 'categorie' | 'id'>): string {
  return `${c.categorie}:${c.id}`;
}

/** Les empreintes d'un rapport (sans doublon). */
export function empreintesDuRapport(rapport: Pick<RapportDeSecurite, 'constats'> | null | undefined): string[] {
  return [...new Set((rapport?.constats ?? []).map(empreinteDuConstat))];
}

/** Les points du rapport courant absents du précédent. Sans précédent, tout est nouveau. */
export function pointsNouveaux(
  precedent: Pick<RapportDeSecurite, 'constats'> | null | undefined,
  courant: Pick<RapportDeSecurite, 'constats'>,
): ConstatSecurite[] {
  const avant = new Set(empreintesDuRapport(precedent));
  return courant.constats.filter((c) => !avant.has(empreinteDuConstat(c)));
}

/**
 * LES POINTS GRAVES NOUVEAUX — les seuls qui font travailler l'agent. Il faut un audit précédent RÉUSSI : le premier
 * audit d'un projet (son ajout) n'alerte jamais, l'utilisateur est devant l'écran.
 */
export function nouveauxPointsGraves(
  precedent: Pick<RapportDeSecurite, 'constats'> | null | undefined,
  courant: Pick<RapportDeSecurite, 'constats'>,
): ConstatSecurite[] {
  if (!precedent) return [];
  return pointsNouveaux(precedent, courant).filter((c) => GRAVITES_QUI_ALERTENT.includes(c.gravite));
}

/**
 * L'AUDIT AUQUEL SE COMPARER. Une étude rédigée et le contrôle automatique ne nomment pas les points de la même façon
 * (`etude:<titre>` contre `entetes:entete-csp`…) : comparer l'un à l'autre ferait passer TOUT le premier contrôle
 * automatique pour « Nouveau » et réveillerait l'agent pour rien. Après une étude, le contrôle suivant est donc une
 * BASE, comme l'audit d'ajout : aucun « Nouveau », aucune alerte.
 */
export function precedentDeComparaison<T extends { declencheur: DeclencheurDAudit }>(precedent: T | null | undefined): T | null {
  return precedent && precedent.declencheur !== 'etude' ? precedent : null;
}

/** Un point venu d'une étude rédigée : seul un humain (ou sa carte de correction) le fait avancer. */
export function estUnPointDEtude(empreinte: string): boolean {
  return empreinte.startsWith('etude:');
}

/* ------------------------------------------------------------------ */
/* États des points après un audit                                     */
/* ------------------------------------------------------------------ */

export interface ChangementDePoint {
  empreinte: string;
  etat: EtatDuPointDeSecurite;
  cardId?: string;
  /** Vrai pour un point jamais vu : il naît avec cet audit. */
  nouveau?: boolean;
}

/**
 * CE QUE DEVIENT CHAQUE POINT après un audit réussi.
 *
 *  - Un point présent et inconnu naît « à traiter ».
 *  - Un point présent et déjà « corrigé » revient « à traiter » (il est réapparu).
 *  - Un point présent et « en correction » le reste — SAUF après la mise en ligne de SA carte : la correction n'a
 *    pas suffi, il revient « à traiter » et quitte la carte.
 *  - Un point absent qui n'était pas corrigé devient « corrigé » (sa carte, s'il en avait une, est gardée : c'est la
 *    preuve de ce qui l'a corrigé) — SAUF un point d'ÉTUDE (`etude:…`), que le contrôle automatique ne sait pas nommer.
 *
 * Seuls les points qui CHANGENT sont rendus.
 */
export function etatsApresControle(
  points: readonly Pick<PointSuivi, 'empreinte' | 'etat' | 'cardId'>[],
  rapport: Pick<RapportDeSecurite, 'constats'>,
  cartesMisesEnLigne: readonly string[] = [],
): ChangementDePoint[] {
  const presents = new Set(empreintesDuRapport(rapport));
  const connus = new Map(points.map((p) => [p.empreinte, p]));
  const changements: ChangementDePoint[] = [];
  for (const empreinte of presents) {
    const p = connus.get(empreinte);
    if (!p) changements.push({ empreinte, etat: 'a-traiter', nouveau: true });
    else if (p.etat === 'corrige') changements.push({ empreinte, etat: 'a-traiter' });
    else if (p.etat === 'en-correction' && p.cardId && cartesMisesEnLigne.includes(p.cardId))
      changements.push({ empreinte, etat: 'a-traiter' });
  }
  for (const p of points) {
    if (presents.has(p.empreinte) || p.etat === 'corrige') continue;
    // Un point d'étude n'est jamais nommé par le contrôle automatique : son absence ne prouve rien. Seule la mise en
    // ligne de SA carte de correction le fait passer « corrigé » (la carte est la preuve).
    if (estUnPointDEtude(p.empreinte) && !(p.etat === 'en-correction' && p.cardId && cartesMisesEnLigne.includes(p.cardId))) continue;
    changements.push({ empreinte: p.empreinte, etat: 'corrige', ...(p.cardId ? { cardId: p.cardId } : {}) });
  }
  return changements;
}

/** Les points que la carte de correction peut emporter : ceux du rapport qui ne sont pas déjà en correction. */
export function pointsACorriger(
  points: readonly Pick<PointSuivi, 'empreinte' | 'etat'>[],
  demandes: readonly string[],
): string[] {
  const etats = new Map(points.map((p) => [p.empreinte, p.etat]));
  return [...new Set(demandes)].filter((e) => etats.get(e) === 'a-traiter');
}

/* ------------------------------------------------------------------ */
/* Rythme et garde                                                     */
/* ------------------------------------------------------------------ */

/** Le prochain passage : sept jours après le dernier audit lancé, ou dès l'ajout s'il n'y en a aucun. */
export function prochainPassage(dernierLance: number | null | undefined, ajouteLe: number, rythme = RYTHME_DES_AUDITS_MS): number {
  return (dernierLance ?? ajouteLe) + (dernierLance ? rythme : 0);
}

/** Un projet est-il dû ? */
export function auditDu(dernierLance: number | null | undefined, ajouteLe: number, maintenant: number): boolean {
  return prochainPassage(dernierLance, ajouteLe) <= maintenant;
}

/**
 * Les audits à ranger : plus vieux que douze mois, SAUF le dernier de chaque projet (le rapport affiché) et ceux qu'une
 * carte de correction encore suivie désigne.
 */
export function auditsAPurger(
  audits: readonly { id: string; projectId: string; lance: number }[],
  maintenant: number,
  gardes: ReadonlySet<string> = new Set(),
): string[] {
  const derniers = new Map<string, { id: string; lance: number }>();
  for (const a of audits) {
    const d = derniers.get(a.projectId);
    if (!d || a.lance > d.lance) derniers.set(a.projectId, a);
  }
  const garderDerniers = new Set([...derniers.values()].map((a) => a.id));
  return audits
    .filter((a) => maintenant - a.lance > RETENTION_AUDITS_MS && !garderDerniers.has(a.id) && !gardes.has(a.id))
    .map((a) => a.id);
}

/* ------------------------------------------------------------------ */
/* Textes                                                              */
/* ------------------------------------------------------------------ */

/** Une gravité vide de chaque sorte : le point de départ des compteurs. */
export function compteurVide(): Record<GraviteSecurite, number> {
  return { critique: 0, elevee: 0, moyenne: 0, faible: 0 };
}

/**
 * LA LIGNE D'UN POINT DANS LE CHAMP D'ÉCRITURE (cocher un point du rapport). Le titre seul, sans repère technique :
 * c'est ce que l'utilisateur lit dans sa barre, et l'agent retrouve le point par son titre dans le rapport qu'il a.
 */
export function texteDuPointPourLeChamp(c: Pick<ConstatSecurite, 'titre' | 'gravite'>): string {
  return `Corriger : ${c.titre.replace(/\s+/g, ' ').trim()}`;
}

/**
 * LE RAPPORT EN CONTEXTE COMPACT pour l'agent : chaque point avec son empreinte (entre crochets, pour la carte de
 * correction), sa gravité, son état et son lieu. Aucune valeur secrète n'y est jamais : le rapport n'en porte pas
 * (DEC-501 — `constatsDeCles` ne recopie que des chemins).
 */
export function rapportPourLAgent(
  rapport: RapportDeSecurite | null,
  points: readonly Pick<PointSuivi, 'empreinte' | 'etat'>[],
  quand: string,
): string {
  if (!rapport) return 'Aucun audit réussi pour l’instant.';
  const etats = new Map(points.map((p) => [p.empreinte, p.etat]));
  const lignes = [`Dernier audit : ${quand}. Dépôt ${rapport.depotPublic === null ? 'de visibilité inconnue' : rapport.depotPublic ? 'public' : 'privé'}.`];
  if (!rapport.constats.length) lignes.push('Aucun point relevé.');
  for (const c of rapport.constats) {
    const e = empreinteDuConstat(c);
    lignes.push(
      `- [${e}] ${c.gravite} · ${etats.get(e) ?? 'a-traiter'} · ${c.titre}` +
        `\n  Risque : ${c.risque}\n  Proposition : ${c.proposition}` +
        (c.ou.length ? `\n  Où : ${c.ou.join(' ; ')}` : '') +
        (c.technique ? `\n  Technique : ${c.technique}` : ''),
    );
  }
  lignes.push('Ce qui a été vérifié :');
  for (const e of rapport.etapes) lignes.push(`- ${e.etat === 'fait' ? '✓' : 'non vérifié'} ${e.nom}${e.note ? ` (${e.note})` : ''}`);
  return lignes.join('\n');
}

/* ------------------------------------------------------------------ */
/* La correction groupée (« Corriger la sélection »)                   */
/* ------------------------------------------------------------------ */

/**
 * LES POINTS QU'UNE CARTE DE CORRECTION GROUPÉE EMPORTE (carte « Fil d'Ariane et corrections sécurité », 16/11/2026) :
 * TOUS ceux du dernier audit encore « à traiter », du plus grave au plus léger (critique → élevée → moyenne → faible),
 * l'ordre du rapport gardé à gravité égale. Un point déjà « en correction » (une carte le porte) ou « corrigé » n'y
 * entre pas : deux cartes ne corrigent jamais le même point.
 */
export function pointsDeLaCorrectionGroupee(
  rapport: Pick<RapportDeSecurite, 'constats'> | null | undefined,
  points: readonly Pick<PointSuivi, 'empreinte' | 'etat'>[],
): ConstatSecurite[] {
  const etats = new Map(points.map((p) => [p.empreinte, p.etat]));
  const rang = (g: GraviteSecurite) => ORDRE_DES_GRAVITES.indexOf(g);
  return (rapport?.constats ?? [])
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (etats.get(empreinteDuConstat(c)) ?? 'a-traiter') === 'a-traiter')
    .sort((a, b) => rang(a.c.gravite) - rang(b.c.gravite) || a.i - b.i)
    .map(({ c }) => c);
}

/** Le niveau de l'agent qui corrige : « approfondi » dès qu'un point est critique, « standard » sinon. */
export function niveauDeLaCorrection(constats: readonly Pick<ConstatSecurite, 'gravite'>[]): 'approfondi' | 'standard' {
  return constats.some((c) => c.gravite === 'critique') ? 'approfondi' : 'standard';
}

const NOM_DE_GRAVITE: Record<GraviteSecurite, string> = { critique: 'Critique', elevee: 'Élevée', moyenne: 'Moyenne', faible: 'Faible' };

/**
 * LA CARTE DE CORRECTION GROUPÉE, rédigée sans moteur : un titre court et une description qui reprend chaque point
 * (gravité, ce qui risque, ce qu'on propose, où regarder, le détail technique) dans l'ordre où l'agent doit les
 * traiter, puis la ligne **Vérification**. Aucune valeur secrète : le rapport n'en porte pas (DEC-501).
 */
export function carteDeCorrectionGroupee(
  nomDuProjet: string,
  constats: readonly ConstatSecurite[],
): { titre: string; description: string } {
  const n = constats.length;
  const titre = `Sécurité : corriger ${n} point${n > 1 ? 's' : ''} de ${nomDuProjet}`;
  const lignes = [
    `Corriger TOUS les points à traiter du dernier audit de sécurité de « ${nomDuProjet} », dans cet ordre : du plus grave au plus léger. Ne passe à un point qu'une fois le précédent corrigé et vérifié.`,
    '',
  ];
  constats.forEach((c, i) => {
    lignes.push(`### ${i + 1}. [${NOM_DE_GRAVITE[c.gravite]}] ${c.titre.replace(/\s+/g, ' ').trim()}`);
    lignes.push(`- Empreinte : ${empreinteDuConstat(c)}`);
    lignes.push(`- Ce qui risque : ${c.risque}`);
    if (c.proposition) lignes.push(`- Ce qu'on propose : ${c.proposition}`);
    if (c.ou.length) lignes.push(`- Où regarder : ${c.ou.join(' ; ')}`);
    if (c.technique) lignes.push(`- Détail technique : ${c.technique}`);
    lignes.push('');
  });
  lignes.push(
    '**Vérification** : le contrôle de sécurité relancé ne remonte plus ces points (il repasse seul à la mise en ligne de cette carte). Ne recopie jamais la valeur d’une clé, d’un mot de passe ou d’un jeton : nomme seulement le fichier.',
  );
  return { titre, description: lignes.join('\n') };
}

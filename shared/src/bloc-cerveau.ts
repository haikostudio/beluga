/**
 * Ce que le bloc « Mémoire envoyée au cerveau » DIT, et quand.
 *
 * Le bloc racontait la même chose trois fois : un badge « aucune clé », un
 * encadré « rien ne part tant que la clé n'est pas posée », puis une liste
 * d'erreurs qui répétait « aucune clé (CERVEAU_API_KEY) ». Une seule ligne
 * d'état suffit ; les erreurs ne se montrent que si elles APPRENNENT quelque
 * chose de neuf.
 *
 * Règles pures : ni base, ni disque, ni réseau — donc testables seules. Le
 * « quand » est injecté (le temps relatif se met en forme côté interface).
 */

/** L'état de la liaison, tel que le serveur le rend et que l'interface le lit. */
export interface EtatCerveau {
  clePosee: boolean;
  adresse: string;
  dernierSucces?: number;
  projetsEnvoyes: number;
  fichiersEnvoyes: number;
  derniereTentative?: number;
  erreurs: { at: number; projet?: string; message: string }[];
}

/** Trois tons seulement : ça marche, on attend, ça coince. */
export type TonCerveau = 'ok' | 'attente' | 'probleme';

export interface LigneEtatCerveau {
  ton: TonCerveau;
  texte: string;
  /** Vrai quand le geste qui débloque est de poser la clé. */
  besoinDeCle: boolean;
}

/** Trois erreurs au plus : au-delà, c'est un journal, pas un état. */
export const ERREURS_MONTREES = 3;

/** Une clé plus longue que ça n'est pas une clé. */
export const CLE_LONGUEUR_MAX = 500;

function pluriel(nombre: number, mot: string): string {
  return `${nombre} ${mot}${nombre > 1 ? 's' : ''}`;
}

/** Une erreur qui ne fait que redire l'absence de clé n'apprend rien. */
export function ditLAbsenceDeCle(message: string): boolean {
  return /aucune\s+cl[ée]/i.test(message);
}

/**
 * LA ligne d'état — une seule, jamais deux qui se répètent. Sans clé, elle dit
 * le geste attendu ; avec la clé, elle dit le résultat du dernier envoi.
 */
export function ligneEtatCerveau(
  etat: EtatCerveau | null,
  quand: (at: number) => string,
): LigneEtatCerveau {
  if (!etat) return { ton: 'attente', texte: 'État en cours de lecture…', besoinDeCle: false };

  if (!etat.clePosee) {
    return {
      ton: 'attente',
      texte: "Rien ne part : la clé du cerveau n'est pas encore posée.",
      besoinDeCle: true,
    };
  }

  if (etat.dernierSucces) {
    const quoi = etat.fichiersEnvoyes
      ? ` — ${pluriel(etat.fichiersEnvoyes, 'fichier')} pour ${pluriel(etat.projetsEnvoyes, 'projet')}`
      : ' — rien de nouveau à envoyer';
    return { ton: 'ok', texte: `Dernier envoi ${quand(etat.dernierSucces)}${quoi}.`, besoinDeCle: false };
  }

  if (etat.derniereTentative) {
    return {
      ton: 'probleme',
      texte: `Aucun envoi abouti ; dernière tentative ${quand(etat.derniereTentative)}.`,
      besoinDeCle: false,
    };
  }

  return { ton: 'attente', texte: 'Aucun envoi encore : le prochain part cette nuit.', besoinDeCle: false };
}

/**
 * Les erreurs qui apprennent quelque chose : ni la redite de l'absence de clé
 * — la ligne d'état la dit quand elle manque, et elle est périmée dès qu'elle
 * est posée —, ni le même message dix fois de suite.
 */
export function erreursUtiles(etat: EtatCerveau | null): { at: number; projet?: string; message: string }[] {
  if (!etat?.erreurs?.length) return [];
  const gardees: { at: number; projet?: string; message: string }[] = [];
  const vues = new Set<string>();
  for (const erreur of etat.erreurs) {
    if (ditLAbsenceDeCle(erreur.message)) continue;
    const cle = `${erreur.projet ?? ''}|${erreur.message}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    gardees.push(erreur);
    if (gardees.length >= ERREURS_MONTREES) break;
  }
  return gardees;
}

/** Ce qu'on accepte comme clé saisie dans le bloc. */
export function validerCleCerveau(saisie: string): { ok: true; cle: string } | { ok: false; raison: string } {
  const cle = (saisie ?? '').trim();
  if (!cle) return { ok: false, raison: 'La clé est vide.' };
  if (/\s/.test(cle)) return { ok: false, raison: "La clé ne doit contenir ni espace ni retour à la ligne." };
  if (cle.length > CLE_LONGUEUR_MAX) return { ok: false, raison: 'La clé est trop longue.' };
  return { ok: true, cle };
}

/**
 * L'ESPACE CLIENT : SES DEMANDES, SES COMMENTAIRES, SON FIL.
 *
 * Un second domaine de données, à CÔTÉ du tableau de Beluga et jamais mêlé à
 * lui : une demande de client n'est pas une carte, elle ne porte ni agent, ni
 * moteur, ni branche. Elle peut être TRANSFORMÉE en carte par Haiko — et garde
 * alors le lien dans les deux sens —, mais elle vit sa vie sans.
 *
 * Ce fichier tient les modèles et les règles PURES : les quatre colonnes, les
 * niveaux d'importance, le rang dans une colonne, la galerie des pièces jointes
 * d'une fiche. Rien n'y touche la base : c'est testable seul.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Les trois colonnes                                                   */
/* ------------------------------------------------------------------ */

export const COLONNES_DEMANDE = ['a-faire', 'en-cours', 'termine', 'valide'] as const;
export const ColonneDemande = z.enum(COLONNES_DEMANDE);
export type ColonneDemande = z.infer<typeof ColonneDemande>;

/** Le titre de chaque colonne, en français : l'interface les traduit ensuite. */
export const TITRES_COLONNES_DEMANDE: Record<ColonneDemande, string> = {
  'a-faire': 'À faire',
  'en-cours': 'En cours',
  termine: 'Terminé',
  valide: 'Validé',
};

/**
 * LA COULEUR SUIT LA CONVENTION DE LA MAISON : orange pour ce qui est EN COURS,
 * bleu pour ce qui est TERMINÉ. « À faire » reste neutre — une demande qui
 * attend n'est pas une alerte.
 */
export const COULEURS_COLONNES_DEMANDE: Record<ColonneDemande, 'neutre' | 'orange' | 'bleu' | 'vert'> = {
  'a-faire': 'neutre',
  'en-cours': 'orange',
  termine: 'bleu',
  valide: 'vert',
};

/**
 * LA DERNIÈRE COLONNE NE S'ÉCRIT PLUS EN DUR. Tant qu'il n'y en avait que
 * trois, « termine est la fin » passait ; à la quatrième, tout code qui
 * l'énumérait à la main devenait faux en silence. On lit ceci, jamais un index.
 */
export const COLONNE_FINALE: ColonneDemande = COLONNES_DEMANDE[COLONNES_DEMANDE.length - 1];

/** Une demande de cette colonne est-elle close ? Ni alerte, ni relance. */
export function colonneClose(colonne: ColonneDemande): boolean {
  return colonne === 'termine' || colonne === 'valide';
}

/* ------------------------------------------------------------------ */
/* L'importance                                                         */
/* ------------------------------------------------------------------ */

export const IMPORTANCES = ['basse', 'normale', 'haute', 'urgente'] as const;
export const ImportanceDemande = z.enum(IMPORTANCES);
export type ImportanceDemande = z.infer<typeof ImportanceDemande>;

export const TITRES_IMPORTANCE: Record<ImportanceDemande, string> = {
  basse: 'Basse',
  normale: 'Normale',
  haute: 'Haute',
  urgente: 'Urgente',
};

/** Le rang d'une importance, pour trier : l'urgent d'abord. */
export function rangDImportance(importance: ImportanceDemande): number {
  return IMPORTANCES.indexOf(importance);
}

/* ------------------------------------------------------------------ */
/* Les modèles                                                          */
/* ------------------------------------------------------------------ */

/** Le genre d'une pièce jointe, décidé une fois pour toutes à l'envoi. */
export const GENRES_PIECE = ['image', 'video', 'fichier'] as const;
export const GenrePiece = z.enum(GENRES_PIECE);
export type GenrePiece = z.infer<typeof GenrePiece>;

/**
 * Le genre se lit sur le type du fichier, jamais sur son extension : un
 * « .mov » renommé « .txt » reste une vidéo pour le navigateur.
 */
export function genreDuFichier(mime: string): GenrePiece {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'fichier';
}

/* ------------------------------------------------------------------ */
/* Les cases à cocher d'une demande                                     */
/* ------------------------------------------------------------------ */

export const TacheDemande = z.object({
  id: z.string(),
  texte: z.string(),
  faite: z.boolean().default(false),
});
export type TacheDemande = z.infer<typeof TacheDemande>;

/** Combien de cases cochées sur combien : ce que la vignette affiche. */
export interface JaugeDesTaches {
  faites: number;
  total: number;
  /** De 0 à 1 ; vaut 0 quand il n'y a aucune case, jamais NaN. */
  part: number;
}

export function jaugeDesTaches(taches: readonly TacheDemande[]): JaugeDesTaches {
  const total = taches.length;
  const faites = taches.filter((t) => t.faite).length;
  return { faites, total, part: total ? faites / total : 0 };
}

/* ------------------------------------------------------------------ */
/* CE QUI ATTEND UNE RÉPONSE — LU, PAS DÉCLARÉ                          */
/* ------------------------------------------------------------------ */

/*
 * IL N'Y A PLUS DE « RÉPONSE ATTENDUE » À COCHER.
 *
 * Le drapeau `attenteDe` disait de qui l'on attendait quelque chose. Personne ne
 * le posait, et la règle qui le posait toute seule se trompait à tous les coups :
 * une demande déposée par un client « attendait Haiko » même quand Haiko avait
 * répondu trois fois dans le fil ; une question de Haiko restait « en attente du
 * client » longtemps après sa réponse. Le tableau affichait donc un chiffre
 * d'attentes que rien ne vérifiait, et qu'on avait appris à ne plus lire.
 *
 * LA LECTURE RÉELLE LE REMPLACE, ENTIÈREMENT. Le serveur sait déjà, pour chaque
 * demande et chaque compte, ce qui est arrivé depuis sa dernière ouverture
 * (`demande_lectures`, `nonLusDeLaDemande`) : c'est un FAIT, pas une déclaration.
 * Ce qui « attend ma réponse » est donc ce que je n'ai pas lu — rien à cocher,
 * rien à éteindre, et jamais de contradiction entre l'écran et le fil.
 */

/**
 * COMBIEN, DANS CE LOT, PORTENT DES MESSAGES QUE JE N'AI PAS LUS. C'est le
 * chiffre porté par la tête d'une colonne : ce qui m'attend VRAIMENT, pas ce
 * que la colonne contient.
 */
export function nonLuesPourMoi(demandes: readonly { resume?: { nonLus: number } }[]): number {
  return demandes.filter((d) => (d.resume?.nonLus ?? 0) > 0).length;
}

/**
 * L'ÉCHÉANCE EST-ELLE PASSÉE ? La date du jour est PASSÉE EN ARGUMENT, jamais
 * lue d'un `Date.now()` caché : sans cela la règle ne serait pas testable, et
 * un test écrit un vendredi tomberait le lundi suivant.
 */
export function echeanceDeDemandeDepassee(echeance: number | undefined, maintenant: number): boolean {
  if (!echeance) return false;
  return echeance < maintenant;
}

/* ------------------------------------------------------------------ */
/* Le journal d'activité                                                */
/* ------------------------------------------------------------------ */

export const GENRES_ACTIVITE = [
  'creation',
  'deplacement',
  'commentaire',
  'modification',
  'archivage',
  'desarchivage',
  'carte',
  /* L'ÉTAPE de la carte liée — démarrée, terminée, en ligne —, rangée dans `detail`. */
  'avancement',
] as const;
export const GenreActivite = z.enum(GENRES_ACTIVITE);
export type GenreActivite = z.infer<typeof GenreActivite>;

export const ActiviteDemande = z.object({
  id: z.string(),
  demandeId: z.string(),
  projectId: z.string(),
  auteurId: z.string(),
  auteurNom: z.string(),
  auteurRole: z.enum(['admin', 'client']),
  genre: GenreActivite,
  /** Une phrase déjà écrite, en français : l'écran l'affiche telle quelle. */
  detail: z.string().default(''),
  /*
   * LE CHANGEMENT D'IMPORTANCE GARDE SES DEUX BOUTS. La phrase française ne
   * disait que la nouvelle valeur, sous son nom technique, et s'affichait telle
   * quelle dans les cinq langues ; l'écran rédige maintenant « Normale → Haute »
   * lui-même, traduit. Optionnels : les lignes déjà en base n'en portent pas.
   */
  importanceAvant: ImportanceDemande.optional(),
  importanceApres: ImportanceDemande.optional(),
  creeLe: z.number(),
});
export type ActiviteDemande = z.infer<typeof ActiviteDemande>;

/** Les deux bouts d'un changement d'importance, ou rien s'il n'y en a pas eu. */
export function changementDImportance(
  avant: Pick<Demande, 'importance'>,
  apres: Pick<Demande, 'importance'>,
): { importanceAvant: ImportanceDemande; importanceApres: ImportanceDemande } | null {
  if (avant.importance === apres.importance) return null;
  return { importanceAvant: avant.importance, importanceApres: apres.importance };
}

export const Demande = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Le compte qui l'a déposée. Réécrit depuis la SESSION, jamais reçu du navigateur. */
  auteurId: z.string(),
  auteurNom: z.string(),
  titre: z.string(),
  description: z.string().default(''),
  importance: ImportanceDemande.default('normale'),
  colonne: ColonneDemande.default('a-faire'),
  rang: z.number(),
  /** La carte Beluga qui porte cette demande, quand Haiko l'a transformée. */
  carteId: z.string().optional(),
  creeeLe: z.number(),
  derniereActivite: z.number(),
  /** Les pièces jointes de la demande elle-même (pas celles des commentaires). */
  fichiers: z.array(z.string()).default([]),
  /*
   * CE QUI SUIT EST ARRIVÉ APRÈS COUP, ET DOIT DONC ÊTRE OPTIONNEL : les
   * demandes déjà en base n'en portent aucun, et un champ obligatoire les
   * rendrait illisibles EN SILENCE au premier `parse`.
   */
  /** L'échéance souhaitée. Posée par qui veut — client compris. */
  echeance: z.number().optional(),
  /** La date de livraison ANNONCÉE par Haiko. Admin seul : c'est un engagement. */
  livraisonAnnoncee: z.number().optional(),
  /*
   * PLUS DE TYPE (anomalie, évolution…) : personne ne s'en servait. Une
   * ancienne ligne qui porterait encore `type` reste lisible — zod ignore une
   * clé inconnue —, et la migration `demandes-sans-type` l'efface en base.
   */
  etiquettes: z.array(z.string()).default([]),
  taches: z.array(TacheDemande).default([]),
  /** Rangée : hors du tableau, hors des alertes, hors du récapitulatif. */
  archiveeLe: z.number().optional(),
});
export type Demande = z.infer<typeof Demande>;

export const MessageDemande = z.object({
  id: z.string(),
  demandeId: z.string(),
  auteurId: z.string(),
  auteurNom: z.string(),
  /** « client » ou « admin » : c'est ce qui décide du côté de la bulle. */
  auteurRole: z.enum(['admin', 'client']),
  texte: z.string().default(''),
  fichiers: z.array(z.string()).default([]),
  creeLe: z.number(),
});
export type MessageDemande = z.infer<typeof MessageDemande>;

/** Un message du FIL de discussion — indépendant des demandes. */
export const MessageFil = z.object({
  id: z.string(),
  /** Le compte CLIENT dont c'est le fil, même quand c'est Haiko qui écrit. */
  filId: z.string(),
  auteurId: z.string(),
  auteurNom: z.string(),
  auteurRole: z.enum(['admin', 'client']),
  texte: z.string().default(''),
  fichiers: z.array(z.string()).default([]),
  creeLe: z.number(),
  /** Quand le destinataire l'a lu. Absent tant qu'il ne l'a pas ouvert. */
  luLe: z.number().optional(),
});
export type MessageFil = z.infer<typeof MessageFil>;

/** Ce qu'une pièce jointe montre dans la galerie d'une fiche. */
export interface PieceDeGalerie {
  id: string;
  nom: string;
  mime: string;
  taille: number;
  genre: GenrePiece;
  /** D'où elle vient : la demande elle-même, ou l'un de ses commentaires. */
  provenance: 'demande' | 'commentaire';
  deposeeLe: number;
  /**
   * POUR UNE VIDÉO : l'instant qui lui sert d'aperçu, en secondes. Le client le
   * LIT — sa galerie montre la même image que la conversation de la tâche —
   * mais il ne peut pas le changer : la commande qui l'écrit ne lui est pas
   * ouverte (`shared/src/droits-commandes.ts`).
   */
  apercuSeconde?: number;
}

/* ------------------------------------------------------------------ */
/* Les règles                                                           */
/* ------------------------------------------------------------------ */

/** Le pas entre deux rangs : de la place pour glisser une carte entre deux. */
export const PAS_DE_RANG = 1000;

/**
 * LE RANG D'UNE DEMANDE QUI ARRIVE DANS UNE COLONNE. Posée entre ses deux
 * voisines quand on la glisse au milieu, en fin de colonne quand on la crée.
 * Les rangs des voisines sont ceux de la colonne D'ARRIVÉE, triés.
 */
export function rangEntre(avant: number | undefined, apres: number | undefined): number {
  if (avant === undefined && apres === undefined) return PAS_DE_RANG;
  if (avant === undefined) return (apres as number) - PAS_DE_RANG;
  if (apres === undefined) return (avant as number) + PAS_DE_RANG;
  return (avant + apres) / 2;
}

/**
 * Les demandes d'une colonne, dans l'ordre où elles s'affichent. Générique :
 * l'écran y passe des demandes ENRICHIES (avec leur résumé), le serveur des
 * demandes nues, et ni l'un ni l'autre ne perd son type au passage.
 */
export function demandesDeLaColonne<T extends Pick<Demande, 'colonne' | 'rang'>>(
  demandes: readonly T[],
  colonne: ColonneDemande,
): T[] {
  return demandes.filter((d) => d.colonne === colonne).sort((a, b) => a.rang - b.rang);
}

/**
 * LA GALERIE D'UNE FICHE : TOUTES les pièces jointes, celles de la demande ET
 * celles de ses commentaires, dans l'ordre où elles sont arrivées. C'est ce
 * qu'on voit en TÊTE de la fiche — le client cherche une image, pas le
 * commentaire qui la portait.
 */
export function galerieDeLaDemande(
  demande: Pick<Demande, 'fichiers' | 'creeeLe'>,
  messages: readonly Pick<MessageDemande, 'fichiers' | 'creeLe'>[],
  pieces: readonly { id: string; name: string; mime: string; size: number; apercuSeconde?: number }[],
): PieceDeGalerie[] {
  const parId = new Map(pieces.map((p) => [p.id, p]));
  const sortie: PieceDeGalerie[] = [];
  const vues = new Set<string>();

  const ajouter = (id: string, provenance: 'demande' | 'commentaire', deposeeLe: number) => {
    if (vues.has(id)) return;
    const piece = parId.get(id);
    if (!piece) return;
    vues.add(id);
    sortie.push({
      id: piece.id,
      nom: piece.name,
      mime: piece.mime,
      taille: piece.size,
      genre: genreDuFichier(piece.mime),
      apercuSeconde: piece.apercuSeconde,
      provenance,
      deposeeLe,
    });
  };

  for (const id of demande.fichiers) ajouter(id, 'demande', demande.creeeLe);
  for (const message of [...messages].sort((a, b) => a.creeLe - b.creeLe)) {
    for (const id of message.fichiers) ajouter(id, 'commentaire', message.creeLe);
  }
  return sortie;
}

/** Le plafond d'un fichier envoyé depuis l'espace client, vidéo comprise. */
export const TAILLE_MAX_PIECE = 200 * 1024 * 1024;

/**
 * LE REFUS SE DIT AVANT L'ENVOI, pas après vingt minutes de téléversement.
 * Rend le message quand le fichier est trop lourd, `null` quand il passe.
 */
export function refusDeTaille(taille: number, plafond = TAILLE_MAX_PIECE): string | null {
  if (taille <= plafond) return null;
  const mo = Math.round(plafond / (1024 * 1024));
  return `Ce fichier dépasse ${mo} Mo : il ne peut pas être envoyé.`;
}

/** Un titre de demande vide n'a jamais de sens : on le refuse en le disant. */
export function jugerTitreDeDemande(titre: string): { ok: boolean; raison?: string } {
  const propre = titre.trim();
  if (!propre) return { ok: false, raison: 'Une demande porte un titre.' };
  if (propre.length > 160) return { ok: false, raison: 'Le titre fait au plus 160 signes.' };
  return { ok: true };
}

/**
 * QUI PARLE EN FACE DE MOI. Écrit une seule fois, ici : le compteur de non-lus
 * du fil se calcule à l'écran (`nonLusDuFil`) ET en base, par une requête SQL
 * qui ne peut pas appeler la règle. Les deux visent donc le MÊME rôle, et une
 * requête qui figerait « admin » se voit tout de suite.
 */
export function roleDEnFace(monRole: 'admin' | 'client'): 'admin' | 'client' {
  return monRole === 'admin' ? 'client' : 'admin';
}

/**
 * CE QUE COMPTE LA PASTILLE DE NON-LUS d'un fil : les messages de l'AUTRE côté
 * qui n'ont pas encore été ouverts. Les siens ne comptent jamais.
 *
 * LE RÔLE QUI DEMANDE DÉCIDE, TOUJOURS. Le compte en base figeait « admin » :
 * Haiko voyait donc grossir la pastille du fil d'un client à chacun de SES
 * propres messages, tant que le client ne les avait pas ouverts. Le même fil
 * rend deux chiffres différents selon qui regarde — c'est le seul résultat
 * juste.
 */
export function nonLusDuFil(messages: readonly MessageFil[], monRole: 'admin' | 'client'): number {
  const enFace = roleDEnFace(monRole);
  return messages.filter((m) => m.auteurRole === enFace && !m.luLe).length;
}

/**
 * L'EXTRAIT D'UNE DESCRIPTION sur la carte du kanban : une ligne, coupée net,
 * jamais un pavé. On coupe sur un espace pour ne pas trancher un mot en deux.
 */
export function extraitDeDescription(description: string, longueur = 120): string {
  const propre = description.replace(/\s+/g, ' ').trim();
  if (propre.length <= longueur) return propre;
  const coupe = propre.slice(0, longueur);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > longueur / 2 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}

/**
 * LE RÉSUMÉ D'UNE FICHE POUR LA CARTE DU KANBAN : combien de pièces, combien de
 * commentaires. Calculé une fois, au serveur, pour qu'une colonne de cent
 * demandes n'oblige pas l'écran à charger cent fiches entières.
 */
export interface ResumeDemande {
  pieces: number;
  commentaires: number;
  /** Commentaires arrivés depuis la dernière ouverture par CE compte. */
  nonLus: number;
  /**
   * CE COMPTE NE L'A JAMAIS OUVERTE (`demandeJamaisOuverte`) : c'est la part du
   * non-lu de la Messagerie qui n'allumait aucune pastille dans la fiche.
   */
  jamaisOuverte?: boolean;
}

/**
 * LA DEMANDE TELLE QU'ELLE PART À L'ÉCRAN : la demande, son résumé, et le titre
 * de la carte Beluga qui la porte quand il y en a une.
 */
export interface DemandeAffichee extends Demande {
  resume: ResumeDemande;
  carteTitre?: string;
}

/* ------------------------------------------------------------------ */
/* QUI PEUT ÉCRIRE QUOI                                                 */
/* ------------------------------------------------------------------ */

/** Les champs d'une demande qu'une commande de modification peut toucher. */
export const CHAMPS_DE_DEMANDE = [
  'titre',
  'description',
  'importance',
  'etiquettes',
  'taches',
  'echeance',
  'livraisonAnnoncee',
  'fichiers',
] as const;
export type ChampDeDemande = (typeof CHAMPS_DE_DEMANDE)[number];

/**
 * CE QU'UN COMPTE PEUT MODIFIER SUR UNE DEMANDE QU'IL VOIT.
 *
 * Un client VOIT désormais toutes les demandes de ses projets, ce qui n'est pas
 * la même chose que d'avoir le droit de les RÉÉCRIRE. Il ne retouche le titre
 * ou la description que des SIENNES ; sur celles de Haiko il peut cocher une
 * case, poser une étiquette, dire quand il en aurait besoin — et CHANGER
 * L'IMPORTANCE : c'est son projet, la priorité lui appartient autant qu'à
 * Haiko. Chaque changement d'importance garde ses deux bouts dans l'historique
 * (`changementDImportance`), avec son auteur : rien ne bouge en silence.
 *
 * `livraisonAnnoncee` n'est JAMAIS ouverte à un client : c'est un engagement de
 * Haiko, et un engagement que le destinataire peut réécrire n'en est pas un.
 */
export function champsModifiables(role: 'admin' | 'client', estLAuteur: boolean): ChampDeDemande[] {
  if (role === 'admin') return [...CHAMPS_DE_DEMANDE];
  const communs: ChampDeDemande[] = ['importance', 'etiquettes', 'taches', 'echeance'];
  if (!estLAuteur) return communs;
  return ['titre', 'description', 'fichiers', ...communs];
}

/** Le patch nettoyé de ce que ce compte n'a pas le droit d'écrire. */
export function patchAutorise<T extends Partial<Record<ChampDeDemande, unknown>>>(
  patch: T,
  role: 'admin' | 'client',
  estLAuteur: boolean,
): Partial<T> {
  const permis = new Set<string>(champsModifiables(role, estLAuteur));
  const sortie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(patch)) {
    if (valeur !== undefined && permis.has(cle)) sortie[cle] = valeur;
  }
  return sortie as Partial<T>;
}

/* ------------------------------------------------------------------ */
/* Filtrer et trier une colonne                                         */
/* ------------------------------------------------------------------ */

export const TRIS_DEMANDE = ['rang', 'echeance', 'activite', 'importance'] as const;
export const TriDemande = z.enum(TRIS_DEMANDE);
export type TriDemande = z.infer<typeof TriDemande>;

export const TITRES_TRI_DEMANDE: Record<TriDemande, string> = {
  rang: 'Ordre manuel',
  echeance: 'Échéance',
  activite: 'Dernière activité',
  importance: 'Importance',
};

export interface FiltreDemandes {
  etiquette?: string;
  importance?: ImportanceDemande;
  /** Le texte tapé dans la barre de recherche, comparé au titre et au corps. */
  texte?: string;
  /** Ne garder que celles qui portent des messages que je n'ai pas lus. */
  nonLues?: boolean;
  /** Montrer les archivées à la place des vivantes. */
  archivees?: boolean;
}

/** Une demande est-elle rangée ? Le tableau ne la montre plus. */
export function estArchivee(demande: Pick<Demande, 'archiveeLe'>): boolean {
  return demande.archiveeLe !== undefined && demande.archiveeLe > 0;
}

/**
 * LE FILTRE ET LE TRI SONT PURS, donc rejoués à l'identique par l'écran et par
 * les tests. L'archivage n'est PAS un filtre parmi d'autres : par défaut une
 * demande rangée n'apparaît nulle part, il faut la demander expressément.
 */
export function filtrerDemandes<T extends Demande & { resume?: ResumeDemande }>(
  demandes: readonly T[],
  filtre: FiltreDemandes = {},
): T[] {
  const texte = filtre.texte?.trim().toLowerCase() ?? '';
  return demandes.filter((d) => {
    if (estArchivee(d) !== Boolean(filtre.archivees)) return false;
    if (filtre.etiquette && !d.etiquettes.includes(filtre.etiquette)) return false;
    if (filtre.importance && d.importance !== filtre.importance) return false;
    if (filtre.nonLues && !(d.resume?.nonLus ?? 0)) return false;
    if (texte && !`${d.titre} ${d.description}`.toLowerCase().includes(texte)) return false;
    return true;
  });
}

/**
 * TRIER UNE COLONNE. « rang » est l'ordre à la main, celui qu'on obtient en
 * glissant une vignette ; les autres tris ne le détruisent pas, ils ne font que
 * l'afficher autrement — le rang reste écrit en base.
 */
export function trierDemandes<T extends Demande>(demandes: readonly T[], tri: TriDemande = 'rang'): T[] {
  const liste = [...demandes];
  switch (tri) {
    case 'echeance':
      // Sans échéance, on va à la fin : une demande sans date n'est pas urgente.
      return liste.sort((a, b) => (a.echeance ?? Infinity) - (b.echeance ?? Infinity) || a.rang - b.rang);
    case 'activite':
      return liste.sort((a, b) => b.derniereActivite - a.derniereActivite);
    case 'importance':
      return liste.sort(
        (a, b) => rangDImportance(b.importance) - rangDImportance(a.importance) || a.rang - b.rang,
      );
    default:
      return liste.sort((a, b) => a.rang - b.rang);
  }
}

/* ------------------------------------------------------------------ */
/* Chaque colonne a SON filtre, SA recherche, SON tri                   */
/* ------------------------------------------------------------------ */

/**
 * LE FILTRE D'UNE COLONNE. Le filtre était unique pour tout le tableau, rangé
 * dans un menu de l'entête : filtrer « À faire » vidait aussi « Terminé », et
 * rien ne disait dans la colonne qu'un filtre y retenait des demandes. Chaque
 * colonne porte donc le sien, à droite de son titre.
 */
export interface FiltreDeColonne {
  etiquette?: string;
  importance?: ImportanceDemande;
  nonLues?: boolean;
  /**
   * MONTRER LES DEMANDES ARCHIVÉES DE CETTE COLONNE, à la place des vivantes.
   * C'était une bascule du menu burger, qui basculait TOUT le tableau d'un
   * coup : on ne pouvait pas relire une demande rangée de « Terminé » sans
   * vider les trois autres colonnes. C'est donc un filtre de colonne comme les
   * autres, et chaque colonne garde le sien.
   */
  archivees?: boolean;
}

/** Combien de réglages sont posés sur le filtre d'une colonne. */
export function filtresActifs(filtre: FiltreDeColonne): number {
  return [filtre.etiquette, filtre.importance, filtre.nonLues, filtre.archivees].filter(Boolean).length;
}

/**
 * LA RECHERCHE D'UNE COLONNE regarde le titre, la description ET les
 * étiquettes : on cherche « facture » en pensant à l'étiquette autant qu'au
 * texte.
 */
export function correspondALaRecherche(demande: Pick<Demande, 'titre' | 'description' | 'etiquettes'>, recherche: string): boolean {
  const mot = recherche.trim().toLowerCase();
  if (!mot) return true;
  return `${demande.titre} ${demande.description} ${demande.etiquettes.join(' ')}`.toLowerCase().includes(mot);
}

/** Ce qu'une colonne affiche, et combien de ses demandes le filtre et la recherche cachent. */
export interface VueDeColonne<T> {
  cartes: T[];
  /** Les demandes de la colonne que le filtre ET la recherche masquent. Zéro : pas de pastille. */
  masquees: number;
}

/**
 * LA VUE D'UNE COLONNE : ses demandes vivantes (ou archivées, si on les
 * demande), filtrées, cherchées, triées — et le COMPTE de celles qu'on ne voit
 * pas. Le compte se fait sur la même liste que l'affichage : un chiffre qui ne
 * correspond à aucune carte cachée ne s'expliquerait pas.
 */
export function vueDeLaColonne<T extends Demande & { resume?: ResumeDemande }>(
  demandes: readonly T[],
  colonne: ColonneDemande,
  reglage: { filtre?: FiltreDeColonne; recherche?: string; tri?: TriDemande } = {},
): VueDeColonne<T> {
  /*
   * L'ARCHIVAGE SE LIT DANS LE FILTRE DE LA COLONNE, plus dans un réglage du
   * tableau entier. Il reste le premier tri appliqué : ce qui est masqué n'est
   * pas « caché par le filtre », c'est une autre liste — sans quoi la pastille
   * des masquées compterait toutes les demandes vivantes dès qu'on regarde les
   * archives.
   */
  const archivees = reglage.filtre?.archivees;
  const toutes = demandesDeLaColonne(filtrerDemandes(demandes, { archivees }), colonne);
  const retenues = filtrerDemandes(toutes, { ...reglage.filtre, archivees }).filter((d) =>
    correspondALaRecherche(d, reglage.recherche ?? ''),
  );
  return { cartes: trierDemandes(retenues, reglage.tri ?? 'rang'), masquees: toutes.length - retenues.length };
}

/** Les réglages de toutes les colonnes, tels qu'on les garde dans le navigateur. */
export interface ReglagesDesColonnes {
  filtres: Record<ColonneDemande, FiltreDeColonne>;
  tris: Record<ColonneDemande, TriDemande>;
}

/** La version de la forme gardée : une autre forme est ignorée, sans erreur. */
export const VERSION_REGLAGES_COLONNES = 2;

/** Les réglages de départ : aucun filtre, l'ordre à la main partout. */
export function reglagesDeDepart(): ReglagesDesColonnes {
  return {
    filtres: Object.fromEntries(COLONNES_DEMANDE.map((c) => [c, {}])) as Record<ColonneDemande, FiltreDeColonne>,
    tris: Object.fromEntries(COLONNES_DEMANDE.map((c) => [c, 'rang'])) as Record<ColonneDemande, TriDemande>,
  };
}

/**
 * RELIRE LES RÉGLAGES GARDÉS. Un texte illisible, une ANCIENNE forme (le filtre
 * unique d'avant, sans version) ou une valeur inconnue retombent sur le départ,
 * champ par champ : un réglage périmé ne casse jamais l'écran.
 */
export function lireReglagesDesColonnes(brut: string | null | undefined): ReglagesDesColonnes {
  const depart = reglagesDeDepart();
  if (!brut) return depart;
  let lu: any;
  try {
    lu = JSON.parse(brut);
  } catch {
    return depart;
  }
  if (!lu || typeof lu !== 'object' || lu.version !== VERSION_REGLAGES_COLONNES) return depart;
  for (const colonne of COLONNES_DEMANDE) {
    const f = lu.filtres?.[colonne];
    if (f && typeof f === 'object') {
      depart.filtres[colonne] = {
        etiquette: typeof f.etiquette === 'string' && f.etiquette ? f.etiquette : undefined,
        importance: ImportanceDemande.safeParse(f.importance).success ? f.importance : undefined,
        nonLues: f.nonLues === true ? true : undefined,
        archivees: f.archivees === true ? true : undefined,
      };
    }
    if (TriDemande.safeParse(lu.tris?.[colonne]).success) depart.tris[colonne] = lu.tris[colonne];
  }
  return depart;
}

/** Les réglages mis en texte, avec leur version. */
export function ecrireReglagesDesColonnes(reglages: ReglagesDesColonnes): string {
  return JSON.stringify({ version: VERSION_REGLAGES_COLONNES, ...reglages });
}

/** Toutes les étiquettes posées sur un lot de demandes, sans doublon, triées. */
export function etiquettesConnues(demandes: readonly Pick<Demande, 'etiquettes'>[]): string[] {
  const vues = new Set<string>();
  for (const d of demandes) for (const e of d.etiquettes) vues.add(e);
  return [...vues].sort((a, b) => a.localeCompare(b));
}

/** Une étiquette se range en minuscules, sans espace de bord ni doublon. */
export function etiquettesNettoyees(brutes: readonly string[]): string[] {
  const vues = new Set<string>();
  const gardees: string[] = [];
  for (const brute of brutes) {
    const propre = brute.trim().replace(/\s+/g, ' ').slice(0, 32);
    const cle = propre.toLowerCase();
    if (!propre || vues.has(cle)) continue;
    vues.add(cle);
    gardees.push(propre);
  }
  return gardees;
}

/* ------------------------------------------------------------------ */
/* Les modèles de demande                                               */
/* ------------------------------------------------------------------ */

export interface ModeleDeDemande {
  id: string;
  nom: string;
  /** La trame de description : le client remplit, il n'invente pas la forme. */
  description: string;
  /**
   * AUCUNE TRAME NE LIVRE D'ÉTAPE, ET CE TABLEAU RESTE TOUJOURS VIDE.
   *
   * Les trames déposaient trois étapes toutes faites (« Reproduit »,
   * « Corrigé », « Vérifié en ligne »…) : elles ne correspondaient presque
   * jamais au travail réel et donnaient l'impression d'un suivi qui n'existait
   * pas. Une demande naît donc SANS étape — chez le client comme chez Haiko —
   * et chacune s'ajoute à la main quand elle a un sens. Le champ reste pour ne
   * pas réécrire les appelants, et un test le verrouille à vide.
   *
   * Les demandes DÉJÀ en base gardent leurs étapes : on ne réécrit pas
   * l'historique.
   */
  taches: string[];
  importance: ImportanceDemande;
}

/**
 * LES MODÈLES SONT DES DONNÉES PURES, pas un écran. Le client qui ouvre
 * « Nouvelle demande » choisit d'abord une trame : c'est ce qui fait la
 * différence entre « ça marche pas » et une anomalie qu'on peut reproduire.
 */
export const MODELES_DEMANDE: readonly ModeleDeDemande[] = [
  {
    id: 'bug',
    nom: 'Signaler une anomalie',
    description:
      "Ce que je faisais :\n\nCe que j'attendais :\n\nCe qui s'est passé à la place :\n\nOù (page, écran) :",
    taches: [],
    importance: 'haute',
  },
  {
    id: 'evolution',
    nom: 'Demander une évolution',
    description: "Ce que je voudrais pouvoir faire :\n\nPourquoi c'est utile :\n\nÀ quoi je verrai que c'est fait :",
    taches: [],
    importance: 'normale',
  },
  {
    id: 'question',
    nom: 'Poser une question',
    description: 'Ma question :\n\nCe que j’ai déjà essayé :',
    taches: [],
    importance: 'normale',
  },
  {
    id: 'vierge',
    nom: 'Partir d’une page blanche',
    description: '',
    taches: [],
    importance: 'normale',
  },
];

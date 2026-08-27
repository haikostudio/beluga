/**
 * LA COLONNE DE GAUCHE, PILOTÉE PAR UN AGENT.
 *
 * Jusqu'ici, créer un projet, le renommer, le ranger dans un groupe ou le mettre
 * de côté étaient des gestes de SOURIS : ils n'existaient que dans l'interface.
 * Le chef d'orchestre, lui, est monté en LECTURE SEULE sur le projet
 * (`bridage-cadrage.ts`) et n'a aucun moyen d'écrire dans la base — « range Haiko
 * dans Clients » lui restait donc impossible à faire, même pour un geste qui ne
 * touche pas une ligne de code.
 *
 * Ce module tient les RÈGLES de ces gestes, sans base ni disque : ce qui est
 * demandé, ce qui manque, ce qui est refusé et pourquoi. Le démon
 * (`server/src/tools.ts`) ne fait qu'exécuter ce qui est jugé recevable ici.
 *
 * Trois interdits sont posés ICI, au niveau de la règle, pas dans une consigne
 * (`docs/mecaniques/ajouter-un-outil.md`) :
 *
 *  1. UN PROJET NE SE SUPPRIME PAS — il est MIS DE CÔTÉ. C'est la règle du
 *     moteur (`project.archive`) : ses cartes et ses conversations restent.
 *  2. UN PROJET NE SE MONTE PAS SANS SON ADRESSE — le sous-domaine et le port
 *     se demandent AVANT le premier dossier (`CONSIGNE_CREATION_PROJET`). Sans
 *     eux, la création est refusée, à moins que l'utilisateur ait dit ne pas en
 *     vouloir : cela se déclare alors en toutes lettres.
 *  3. UN GROUPE NE SE SUPPRIME PAS PAR UN AGENT — le retirer déplace tous ses
 *     projets d'un coup dans la colonne de gauche : ce geste-là reste à
 *     l'utilisateur.
 */

/* ------------------------------------------------------------------ */
/* La palette des groupes                                              */
/* ------------------------------------------------------------------ */

/** La palette des groupes : seize teintes franches (la barre latérale s'en sert aussi). */
export const COULEURS_DE_GROUPE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
];

/**
 * Les mêmes teintes, dites avec des mots : un agent écrit « bleu », pas
 * « #3b82f6 ». Un code hexadécimal reste évidemment accepté tel quel.
 */
const COULEURS_NOMMEES: Record<string, string> = {
  rouge: '#ef4444',
  orange: '#f97316',
  ambre: '#f59e0b',
  jaune: '#eab308',
  citron: '#84cc16',
  vert: '#22c55e',
  emeraude: '#10b981',
  turquoise: '#14b8a6',
  cyan: '#06b6d4',
  bleu: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  pourpre: '#a855f7',
  fuchsia: '#d946ef',
  rose: '#ec4899',
  framboise: '#f43f5e',
};

/** Sans accent et en minuscules : « Émeraude » et « emeraude » sont la même teinte. */
function sansAccent(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Ce que rend l'examen d'une demande : un geste recevable, ou une raison dite. */
export type Recevable<T> = { ok: true; demande: T } | { ok: false; raison: string };

/**
 * UNE COULEUR DE GROUPE, telle qu'on l'enregistrera.
 *
 * « bleu », « #3b82f6 », « #38F » désignent la même chose ; « aucune », « sans »
 * et une chaîne vide RETIRENT la pastille. Tout le reste est refusé en nommant
 * les teintes connues : un refus muet se lit comme une panne.
 */
export function couleurDeGroupe(brut: string): Recevable<{ couleur?: string }> {
  const texte = sansAccent(String(brut ?? ''));
  if (!texte || ['aucune', 'aucun', 'sans', 'none', 'vide'].includes(texte)) return { ok: true, demande: {} };

  const nommee = COULEURS_NOMMEES[texte];
  if (nommee) return { ok: true, demande: { couleur: nommee } };

  const court = /^#([0-9a-f]{3})$/.exec(texte);
  if (court) {
    const [r, v, b] = court[1].split('');
    return { ok: true, demande: { couleur: `#${r}${r}${v}${v}${b}${b}` } };
  }
  if (/^#[0-9a-f]{6}$/.test(texte)) return { ok: true, demande: { couleur: texte } };

  return {
    ok: false,
    raison:
      `Couleur inconnue : « ${brut} ». Donne un code hexadécimal (« #3b82f6 »), « aucune » pour retirer la pastille, ` +
      `ou l'un de ces noms : ${Object.keys(COULEURS_NOMMEES).join(', ')}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Retrouver un projet ou un groupe par son nom                        */
/* ------------------------------------------------------------------ */

/** Le minimum pour désigner quelque chose de la colonne de gauche. */
export interface Nommable {
  id: string;
  name: string;
}

/**
 * RETROUVER PAR LE NOM, jamais par un identifiant deviné.
 *
 * Un agent écrit « Haiko », pas « c8f2… ». On accepte donc l'identifiant exact,
 * le nom exact (accents et casse ignorés), puis un nom PARTIEL — mais seulement
 * s'il ne désigne qu'une seule chose : deux candidats, et on rend la main en les
 * nommant, plutôt que d'en renommer un au hasard.
 */
export function retrouverParNom<T extends Nommable>(
  demande: string,
  liste: T[],
  quoi: 'projet' | 'groupe',
): Recevable<T> {
  const brut = String(demande ?? '').trim();
  if (!brut) return { ok: false, raison: `Il manque le ${quoi} visé : donne son nom.` };

  const parId = liste.find((item) => item.id === brut);
  if (parId) return { ok: true, demande: parId };

  const cherche = sansAccent(brut);
  const exacts = liste.filter((item) => sansAccent(item.name) === cherche);
  if (exacts.length === 1) return { ok: true, demande: exacts[0] };
  if (exacts.length > 1) {
    return { ok: false, raison: `Plusieurs ${quoi}s portent le nom « ${brut} » : précise l'identifiant.` };
  }

  const partiels = liste.filter((item) => sansAccent(item.name).includes(cherche));
  if (partiels.length === 1) return { ok: true, demande: partiels[0] };
  if (partiels.length > 1) {
    return {
      ok: false,
      raison: `« ${brut} » désigne plusieurs ${quoi}s : ${partiels.map((item) => `« ${item.name} »`).join(', ')}. Précise.`,
    };
  }

  const connus = liste.length ? liste.map((item) => `« ${item.name} »`).join(', ') : 'aucun pour l’instant';
  return { ok: false, raison: `Aucun ${quoi} ne s'appelle « ${brut} ». ${quoi === 'projet' ? 'Projets' : 'Groupes'} connus : ${connus}.` };
}

/* ------------------------------------------------------------------ */
/* Les gestes sur un projet                                            */
/* ------------------------------------------------------------------ */

/** Les gestes qu'un agent peut faire sur un projet. La suppression n'en est pas. */
export const GESTES_PROJET = ['lister', 'creer', 'renommer', 'deplacer', 'retirer', 'remettre'] as const;

/** Ce qu'on retient d'une demande sur un projet, une fois jugée recevable. */
export type DemandeProjet =
  | { geste: 'lister' }
  | {
      geste: 'creer';
      nom: string;
      dossier?: string;
      description?: string;
      sousDomaine?: string;
      port?: number;
      /** L'utilisateur a dit ne pas vouloir d'adresse : le montage continue sans. */
      sansAdresse: boolean;
      github: boolean;
    }
  | { geste: 'renommer'; cible: string; nom: string }
  | { geste: 'deplacer'; cible: string; groupe?: string; horsGroupe: boolean; position?: number }
  | { geste: 'retirer'; cible: string }
  | { geste: 'remettre'; cible: string };

/** Le refus opposé à toute tentative de suppression d'un projet. */
export const REFUS_SUPPRESSION_PROJET =
  "Refusé : un projet ne se SUPPRIME pas, il se RETIRE (geste « retirer ») — il est alors mis de côté, ses cartes et " +
  "ses conversations restent en base et « Remettre en service » le fait revenir. Une suppression définitive reste un " +
  "geste de l'utilisateur, dans les réglages du projet.";

/** Le refus opposé à un montage de projet dont personne n'a demandé l'adresse. */
export const REFUS_CREATION_SANS_ADRESSE =
  "Refusé : un projet se monte AVEC son adresse. Demande d'abord à l'utilisateur, avec l'outil « ask_user », le " +
  "SOUS-DOMAINE voulu et le PORT sur lequel le projet écoutera, puis rappelle cet outil avec « sousDomaine » et " +
  "« port ». S'il répond qu'il n'en veut pas, rappelle-le avec « sansAdresse: true » — mais ne le décide jamais à sa place.";

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

function vrai(valeur: unknown): boolean {
  return valeur === true || valeur === 'true';
}

/** Une position dans la colonne de gauche : un rang humain, à partir de 1. */
function lirePosition(valeur: unknown): Recevable<{ position?: number }> {
  if (valeur === undefined || valeur === null || valeur === '') return { ok: true, demande: {} };
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre) || nombre < 1) {
    return { ok: false, raison: `Position refusée : « ${valeur} ». Donne un rang à partir de 1 (1 = tout en haut).` };
  }
  return { ok: true, demande: { position: Math.floor(nombre) } };
}

/** Longueur d'un nom : assez pour dire quelque chose, pas de quoi casser une colonne. */
export const MAX_SIGNES_NOM = 60;

function lireNom(brut: string, quoi: 'projet' | 'groupe'): Recevable<{ nom: string }> {
  const nom = brut.replace(/\s+/g, ' ').trim();
  if (!nom) return { ok: false, raison: `Il manque le nom du ${quoi}.` };
  if (nom.length > MAX_SIGNES_NOM) {
    return { ok: false, raison: `Nom trop long (${nom.length} signes) : ${MAX_SIGNES_NOM} au plus.` };
  }
  return { ok: true, demande: { nom } };
}

/**
 * CE QUE DEMANDE UN AGENT SUR UN PROJET, jugé avant d'ouvrir la base.
 *
 * Un geste inconnu, un champ manquant, une suppression déguisée : tout est
 * refusé ici, avec la phrase qui dit quoi faire à la place.
 */
export function lireGesteProjet(args: Record<string, unknown>): Recevable<DemandeProjet> {
  const geste = sansAccent(texte(args.action ?? args.geste));
  if (!geste) return { ok: false, raison: `Il manque l'action : ${GESTES_PROJET.join(', ')}.` };

  if (['supprimer', 'delete', 'effacer', 'detruire'].includes(geste)) {
    return { ok: false, raison: REFUS_SUPPRESSION_PROJET };
  }
  if (!(GESTES_PROJET as readonly string[]).includes(geste)) {
    return { ok: false, raison: `Action inconnue : « ${geste} ». Actions possibles : ${GESTES_PROJET.join(', ')}.` };
  }

  const cible = texte(args.projet ?? args.cible ?? args.projectId);

  if (geste === 'lister') return { ok: true, demande: { geste: 'lister' } };

  if (geste === 'creer') {
    const nom = lireNom(texte(args.nom ?? args.name), 'projet');
    if (!nom.ok) return nom;
    const sousDomaine = texte(args.sousDomaine ?? args.sousdomaine);
    const portBrut = args.port;
    const sansAdresse = vrai(args.sansAdresse ?? args.sansadresse);
    if (!sansAdresse && !sousDomaine && (portBrut === undefined || portBrut === null || portBrut === '')) {
      return { ok: false, raison: REFUS_CREATION_SANS_ADRESSE };
    }
    const port = portBrut === undefined || portBrut === null || portBrut === '' ? undefined : Number(portBrut);
    if (port !== undefined && !Number.isFinite(port)) {
      return { ok: false, raison: `Port refusé : « ${String(portBrut)} » n'est pas un nombre.` };
    }
    return {
      ok: true,
      demande: {
        geste: 'creer',
        nom: nom.demande.nom,
        dossier: texte(args.dossier ?? args.folder) || undefined,
        description: texte(args.description) || undefined,
        sousDomaine: sousDomaine || undefined,
        port,
        sansAdresse,
        github: args.github === undefined ? true : vrai(args.github),
      },
    };
  }

  if (geste === 'renommer') {
    const nom = lireNom(texte(args.nom ?? args.name), 'projet');
    if (!nom.ok) return nom;
    if (!cible) return { ok: false, raison: 'Il manque le projet visé : donne son nom.' };
    return { ok: true, demande: { geste: 'renommer', cible, nom: nom.demande.nom } };
  }

  if (geste === 'deplacer') {
    if (!cible) return { ok: false, raison: 'Il manque le projet visé : donne son nom.' };
    const groupeBrut = args.groupe ?? args.group;
    const groupe = texte(groupeBrut);
    // Un groupe explicitement vide SORT le projet de son groupe : c'est une
    // demande, pas un oubli. Un champ absent, lui, ne touche pas au rangement.
    const horsGroupe =
      groupeBrut !== undefined &&
      groupeBrut !== null &&
      (!groupe || ['aucun', 'aucune', 'hors groupe', 'sans', 'racine'].includes(sansAccent(groupe)));
    const position = lirePosition(args.position);
    if (!position.ok) return position;
    if (!horsGroupe && !groupe && position.demande.position === undefined) {
      return {
        ok: false,
        raison: 'Rien à déplacer : donne un « groupe » (ou « aucun » pour l’en sortir) et/ou une « position ».',
      };
    }
    return {
      ok: true,
      demande: {
        geste: 'deplacer',
        cible,
        groupe: horsGroupe ? undefined : groupe || undefined,
        horsGroupe,
        position: position.demande.position,
      },
    };
  }

  if (!cible) return { ok: false, raison: 'Il manque le projet visé : donne son nom.' };
  return { ok: true, demande: { geste: geste as 'retirer' | 'remettre', cible } };
}

/* ------------------------------------------------------------------ */
/* Les gestes sur un groupe                                            */
/* ------------------------------------------------------------------ */

/** Les gestes qu'un agent peut faire sur un groupe. Le retrait n'en est pas. */
export const GESTES_GROUPE = ['lister', 'creer', 'renommer', 'regler'] as const;

export type DemandeGroupe =
  | { geste: 'lister' }
  | { geste: 'creer'; nom: string; couleur?: string }
  | { geste: 'renommer'; cible: string; nom: string }
  | {
      geste: 'regler';
      cible: string;
      couleur?: string;
      /** La couleur demandée est « aucune » : la pastille est retirée. */
      retirerCouleur: boolean;
      replie?: boolean;
      position?: number;
    };

/** Le refus opposé à toute tentative de retrait d'un groupe. */
export const REFUS_SUPPRESSION_GROUPE =
  "Refusé : retirer un groupe déplace d'un coup tous les projets qu'il contient — ce geste reste à l'utilisateur, " +
  "dans la colonne de gauche. Tu peux le créer, le renommer, changer sa couleur, le replier ou le déplier.";

export function lireGesteGroupe(args: Record<string, unknown>): Recevable<DemandeGroupe> {
  const geste = sansAccent(texte(args.action ?? args.geste));
  if (!geste) return { ok: false, raison: `Il manque l'action : ${GESTES_GROUPE.join(', ')}.` };

  if (['supprimer', 'delete', 'retirer', 'effacer'].includes(geste)) {
    return { ok: false, raison: REFUS_SUPPRESSION_GROUPE };
  }
  if (!(GESTES_GROUPE as readonly string[]).includes(geste)) {
    return { ok: false, raison: `Action inconnue : « ${geste} ». Actions possibles : ${GESTES_GROUPE.join(', ')}.` };
  }

  if (geste === 'lister') return { ok: true, demande: { geste: 'lister' } };

  const cible = texte(args.groupe ?? args.cible ?? args.groupId);

  if (geste === 'creer') {
    const nom = lireNom(texte(args.nom ?? args.name), 'groupe');
    if (!nom.ok) return nom;
    const couleurBrute = texte(args.couleur ?? args.color);
    if (!couleurBrute) return { ok: true, demande: { geste: 'creer', nom: nom.demande.nom } };
    const couleur = couleurDeGroupe(couleurBrute);
    if (!couleur.ok) return couleur;
    return { ok: true, demande: { geste: 'creer', nom: nom.demande.nom, couleur: couleur.demande.couleur } };
  }

  if (geste === 'renommer') {
    const nom = lireNom(texte(args.nom ?? args.name), 'groupe');
    if (!nom.ok) return nom;
    if (!cible) return { ok: false, raison: 'Il manque le groupe visé : donne son nom.' };
    return { ok: true, demande: { geste: 'renommer', cible, nom: nom.demande.nom } };
  }

  if (!cible) return { ok: false, raison: 'Il manque le groupe visé : donne son nom.' };

  const couleurBrute = args.couleur ?? args.color;
  let couleur: string | undefined;
  let retirerCouleur = false;
  if (couleurBrute !== undefined && couleurBrute !== null) {
    const lue = couleurDeGroupe(String(couleurBrute));
    if (!lue.ok) return lue;
    couleur = lue.demande.couleur;
    retirerCouleur = !couleur;
  }

  const replie =
    args.replie === undefined && args.collapsed === undefined
      ? undefined
      : vrai(args.replie ?? args.collapsed);

  const position = lirePosition(args.position);
  if (!position.ok) return position;

  if (couleurBrute === undefined && replie === undefined && position.demande.position === undefined) {
    return { ok: false, raison: 'Rien à régler : donne une « couleur », « replie » (vrai/faux) et/ou une « position ».' };
  }

  return {
    ok: true,
    demande: { geste: 'regler', cible, couleur, retirerCouleur, replie, position: position.demande.position },
  };
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent doit LIRE de la colonne de gauche                    */
/* ------------------------------------------------------------------ */

/** Un projet, réduit à ce que la colonne de gauche en montre. */
export interface ProjetDeLaColonne {
  id: string;
  name: string;
  groupId?: string;
  rank?: number;
  archived?: boolean;
  path?: string;
}

/** Un groupe, réduit à ce que la colonne de gauche en montre. */
export interface GroupeDeLaColonne {
  id: string;
  name: string;
  rank?: number;
  collapsed?: boolean;
  color?: string;
}

function parRang(a: { rank?: number; name: string }, b: { rank?: number; name: string }): number {
  const ra = a.rank ?? 1000;
  const rb = b.rank ?? 1000;
  return ra === rb ? a.name.localeCompare(b.name) : ra - rb;
}

/**
 * LA COLONNE DE GAUCHE, ÉCRITE.
 *
 * Un agent ne voit pas l'écran : sans ce texte, il ne sait ni ce qui existe, ni
 * où c'est rangé, et devine des noms. On rend donc l'ordre réel — groupes et
 * projets hors groupe mêlés, comme à l'écran —, les projets de chaque groupe, et
 * enfin ce qui est mis de côté.
 */
export function resumeColonneDeGauche(projets: ProjetDeLaColonne[], groupes: GroupeDeLaColonne[]): string {
  const vivants = projets.filter((p) => !p.archived);
  const ranges = new Map<string, ProjetDeLaColonne[]>();
  for (const groupe of groupes) ranges.set(groupe.id, []);
  const horsGroupe: ProjetDeLaColonne[] = [];
  for (const projet of vivants) {
    const dans = projet.groupId ? ranges.get(projet.groupId) : undefined;
    if (dans) dans.push(projet);
    else horsGroupe.push(projet);
  }

  const lignes: string[] = [];
  const entrees = [
    ...groupes.map((groupe) => ({ rank: groupe.rank, name: groupe.name, groupe })),
    ...horsGroupe.map((projet) => ({ rank: projet.rank, name: projet.name, projet })),
  ] as ({ rank?: number; name: string } & { groupe?: GroupeDeLaColonne; projet?: ProjetDeLaColonne })[];

  for (const entree of entrees.sort(parRang)) {
    if (entree.groupe) {
      const dedans = (ranges.get(entree.groupe.id) ?? []).sort(parRang);
      const couleur = entree.groupe.color ? `, couleur ${entree.groupe.color}` : '';
      const etat = entree.groupe.collapsed ? ', replié' : '';
      lignes.push(`▸ Groupe « ${entree.groupe.name} » (${dedans.length} projet(s)${couleur}${etat})`);
      for (const projet of dedans) lignes.push(`    · ${projet.name}`);
      continue;
    }
    if (entree.projet) lignes.push(`· ${entree.projet.name}`);
  }

  const misDeCote = projets.filter((p) => p.archived);
  if (misDeCote.length) {
    lignes.push(`Mis de côté (invisibles dans la colonne) : ${misDeCote.map((p) => `« ${p.name} »`).join(', ')}.`);
  }

  return lignes.length ? lignes.join('\n') : 'La colonne de gauche est vide.';
}

/**
 * LE NOUVEL ORDRE d'une famille de lignes, après un déplacement.
 *
 * On sort la ligne visée, on la réinsère à la position demandée (1 = en haut),
 * puis on renumérote tout : les rangs restent réguliers, sans trou ni égalité.
 * C'est le même calcul que le rangement à la souris (`sidebar.reorder`).
 */
export function rangsApresDeplacement<T extends { id: string }>(
  lignes: T[],
  id: string,
  position: number,
): { id: string; rank: number }[] {
  const restantes = lignes.filter((ligne) => ligne.id !== id);
  const cible = lignes.find((ligne) => ligne.id === id);
  if (!cible) return lignes.map((ligne, index) => ({ id: ligne.id, rank: (index + 1) * 10 }));
  const place = Math.min(Math.max(position, 1), restantes.length + 1) - 1;
  restantes.splice(place, 0, cible);
  return restantes.map((ligne, index) => ({ id: ligne.id, rank: (index + 1) * 10 }));
}

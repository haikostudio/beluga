/**
 * LA RECETTE D'UN BACKUP ET LE VERDICT DE SON ARCHIVE — les règles qui se
 * jugent sans base ni disque.
 *
 * Un backup n'est plus une COPIE câblée dans le démon (un vidage de base, puis
 * un dossier recopié) : c'est une RECETTE, écrite par l'agent d'analyse après
 * avoir lu le site, puis REJOUÉE seule à chaque passage. Une recette est une
 * suite d'ÉTAPES ; chacune sait PRENDRE une part du site (le code, les fichiers
 * téléversés, une base) dans le dossier `$SORTIE` qu'on lui donne, et la
 * REMETTRE en place depuis le dossier `$ENTREE` qu'on lui rend. Tout ce que les
 * étapes ont posé part dans UNE archive zip, une étape par dossier, avec un
 * `manifeste.json` à la racine.
 *
 * LE VERDICT SE LIT DANS L'ARCHIVE MÊME, jamais dans ce que les commandes ont
 * prétendu : une étape qui a rendu 0 mais n'a rien posé est VIDE, et un point
 * dont l'archive ne s'ouvre pas est un ÉCHEC. C'est `verdictDeLArchive` qui
 * décide « réussi », « partiel » ou « échec », sur l'inventaire relu.
 *
 * Une fiche d'avant, que l'agent n'a pas encore analysée, n'est pas laissée
 * sans backup : `recetteDepuisLaFiche` écrit la recette équivalente à
 * l'ancienne copie, à partir de sa base et de ses fichiers.
 *
 * Le travail réel (lancer les étapes, écrire le zip, le relire, le rejouer à
 * l'envers) vit dans `server/src/backups.ts`.
 */

import type { SiteASauvegarder } from './backups.js';

/* ------------------------------------------------------------------ */
/* Ce qu'une recette porte                                              */
/* ------------------------------------------------------------------ */

/** Ce qu'une étape prend : le code du site, ses fichiers vivants, ou une base. */
export const GENRES_D_ETAPE = ['code', 'fichiers', 'base'] as const;
export type GenreDEtape = (typeof GENRES_D_ETAPE)[number];

export const LIBELLE_GENRE_D_ETAPE: Readonly<Record<GenreDEtape, string>> = {
  code: 'Code',
  fichiers: 'Fichiers',
  base: 'Base de données',
};

/** Une étape de recette : prendre une part du site, et savoir la remettre. */
export interface EtapeDeRecette {
  /** Le nom de son dossier dans l'archive : minuscules, chiffres et tirets. */
  id: string;
  genre: GenreDEtape;
  /** Ce que l'étape prend, en clair : « la base PocketBase du conteneur ». */
  libelle: string;
  /** Commande bash qui écrit ce qu'elle prend dans le dossier vide `$SORTIE`. */
  prendre: string;
  /** Commande bash qui remet en place ce qu'elle trouve dans `$ENTREE`. */
  remettre: string;
  /** En dessous de ce poids, l'étape est jugée VIDE (une base de 0 o n'est pas une base). */
  octetsMin: number;
}

export interface RecetteDeBackup {
  version: 1;
  etapes: EtapeDeRecette[];
  /** Ce que l'agent a constaté : quoi, où, et pourquoi ces étapes. */
  explication: string;
  /** `agent` : écrite par l'agent d'analyse. `fiche` : déduite de la fiche, en attendant. */
  origine: 'agent' | 'fiche';
}

export const ETAPES_MAX = 12;
export const COMMANDE_MAX = 4000;
export const LIBELLE_ETAPE_MAX = 120;
export const EXPLICATION_MAX = 2000;
export const OCTETS_MIN_PAR_DEFAUT = 1;
/** Deux heures par étape : au-delà, une commande est une panne, pas un travail lent. */
export const DELAI_ETAPE_MS = 2 * 3600 * 1000;

/** Le nom du fichier qui décrit l'archive, à sa racine. */
export const NOM_MANIFESTE = 'manifeste.json';

const ID_VALIDE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/* ------------------------------------------------------------------ */
/* Juger une recette, et lire celle qu'un modèle propose                */
/* ------------------------------------------------------------------ */

/** Le jugement d'une recette avant enregistrement : ce qui manque se DIT. */
export function jugerRecette(recette: RecetteDeBackup | null | undefined): { ok: boolean; raison?: string } {
  const etapes = recette?.etapes;
  if (!Array.isArray(etapes) || !etapes.length) {
    return { ok: false, raison: 'une recette a besoin d’au moins une étape' };
  }
  if (etapes.length > ETAPES_MAX) return { ok: false, raison: `une recette tient en ${ETAPES_MAX} étapes au plus` };
  const vus = new Set<string>();
  for (const [rang, etape] of etapes.entries()) {
    const nom = `l’étape ${rang + 1}`;
    if (!ID_VALIDE.test(etape.id ?? '')) {
      return { ok: false, raison: `${nom} a un identifiant invalide (minuscules, chiffres, tirets)` };
    }
    if (etape.id === NOM_MANIFESTE.replace('.json', '')) {
      return { ok: false, raison: `${nom} ne peut pas s’appeler « ${etape.id} »` };
    }
    if (vus.has(etape.id)) return { ok: false, raison: `deux étapes s’appellent « ${etape.id} »` };
    vus.add(etape.id);
    if (!GENRES_D_ETAPE.includes(etape.genre)) return { ok: false, raison: `${nom} a un genre inconnu` };
    if (!(etape.libelle ?? '').trim()) return { ok: false, raison: `${nom} a besoin d’un libellé` };
    for (const champ of ['prendre', 'remettre'] as const) {
      const commande = (etape[champ] ?? '').trim();
      if (!commande) return { ok: false, raison: `${nom} n’a pas de commande « ${champ} »` };
      if (commande.length > COMMANDE_MAX) {
        return { ok: false, raison: `la commande « ${champ} » de ${nom} dépasse ${COMMANDE_MAX} signes` };
      }
    }
  }
  return { ok: true };
}

/** Un genre d'étape, même écrit « database », « uploads » ou « dépôt ». */
export function genreDemande(valeur: unknown): GenreDEtape | undefined {
  if (typeof valeur !== 'string') return undefined;
  const mot = valeur
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!mot) return undefined;
  if (GENRES_D_ETAPE.includes(mot as GenreDEtape)) return mot as GenreDEtape;
  if (/(base|donnee|database|db|sql|dump)/.test(mot)) return 'base';
  if (/(fichier|upload|media|storage|stockage|file)/.test(mot)) return 'fichiers';
  if (/(code|source|depot|repo|git|app)/.test(mot)) return 'code';
  return undefined;
}

/** Un identifiant de dossier tiré d'un libellé : « Base PocketBase » → « base-pocketbase ». */
export function idDEtape(texte: string): string {
  return (texte || 'etape')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'etape';
}

/**
 * LA RECETTE PROPOSÉE PAR L'AGENT, RAMENÉE À CE QUE LE CODE ATTEND. Un genre
 * écrit autrement est traduit, un identifiant absent est tiré du libellé et
 * rendu unique ; ce qui manque vraiment (une commande) reste vide, et
 * `jugerRecette` le dira.
 */
export function recetteProposee(brut: unknown): RecetteDeBackup {
  const source = (brut && typeof brut === 'object' ? brut : {}) as Record<string, any>;
  const lues = Array.isArray(source.etapes) ? source.etapes.slice(0, ETAPES_MAX + 1) : [];
  const vus = new Set<string>();
  const etapes: EtapeDeRecette[] = lues.map((e: any, rang: number) => {
    const etape = e && typeof e === 'object' ? e : {};
    const genre = genreDemande(etape.genre) ?? ('' as GenreDEtape);
    const libelle = String(etape.libelle ?? '').trim().slice(0, LIBELLE_ETAPE_MAX);
    let id = typeof etape.id === 'string' && ID_VALIDE.test(etape.id.trim()) ? etape.id.trim() : idDEtape(libelle || genre || `etape-${rang + 1}`);
    const racine = id;
    for (let n = 2; vus.has(id); n += 1) id = `${racine.slice(0, 36)}-${n}`;
    vus.add(id);
    const octets = Number(etape.octetsMin);
    return {
      id,
      genre,
      libelle,
      prendre: String(etape.prendre ?? '').trim(),
      remettre: String(etape.remettre ?? '').trim(),
      octetsMin: Number.isFinite(octets) && octets > 0 ? Math.round(octets) : OCTETS_MIN_PAR_DEFAUT,
    };
  });
  return {
    version: 1,
    etapes,
    explication: String(source.explication ?? '').trim().slice(0, EXPLICATION_MAX),
    origine: 'agent',
  };
}

/* ------------------------------------------------------------------ */
/* La recette d'une fiche que l'agent n'a pas encore analysée          */
/* ------------------------------------------------------------------ */

const HOTE_MYSQL = '${BASE_HOTE:+-h "$BASE_HOTE"} ${BASE_PORT:+-P "$BASE_PORT"}';
const HOTE_PG = '${BASE_HOTE:+-h "$BASE_HOTE"} ${BASE_PORT:+-p "$BASE_PORT"}';
const SSH = '-e "ssh -p ${FICHIERS_PORT:-22} -o BatchMode=yes -o StrictHostKeyChecking=accept-new"';
const DISTANT = '"$FICHIERS_UTILISATEUR@$FICHIERS_HOTE:$FICHIERS_CHEMIN/"';
const REFABRIQUABLES = '--exclude node_modules --exclude .next';

/**
 * LA RECETTE ÉQUIVALENTE À L'ANCIENNE COPIE. Chaque commande lit les accès de
 * la fiche par des VARIABLES (`variablesDeLaFiche`) : aucun mot de passe n'est
 * écrit dans la recette, et aucun n'apparaît dans la liste des processus —
 * `mysqldump` le reçoit par `MYSQL_PWD`, `pg_dump` par `PGPASSWORD`, `lftp` par
 * son entrée standard.
 */
export function recetteDepuisLaFiche(site: SiteASauvegarder): RecetteDeBackup {
  const etapes: EtapeDeRecette[] = [];
  const base = site.base;
  if (base.moteur === 'sqlite') {
    etapes.push({
      id: 'base',
      genre: 'base',
      libelle: 'La base SQLite',
      prendre:
        'if command -v sqlite3 >/dev/null; then sqlite3 "$BASE_NOM" ".backup \'$SORTIE/base.sqlite\'"; ' +
        'else cp "$BASE_NOM" "$SORTIE/base.sqlite"; fi',
      remettre: 'cp "$ENTREE/base.sqlite" "$BASE_NOM"',
      octetsMin: OCTETS_MIN_PAR_DEFAUT,
    });
  } else if (base.moteur === 'mysql') {
    etapes.push({
      id: 'base',
      genre: 'base',
      libelle: 'La base MySQL',
      prendre: `mysqldump --single-transaction --quick --routines ${HOTE_MYSQL} -u "$BASE_UTILISATEUR" "$BASE_NOM" > "$SORTIE/base.sql"`,
      remettre: `mysql ${HOTE_MYSQL} -u "$BASE_UTILISATEUR" "$BASE_NOM" < "$ENTREE/base.sql"`,
      octetsMin: OCTETS_MIN_PAR_DEFAUT,
    });
  } else if (base.moteur === 'postgres') {
    etapes.push({
      id: 'base',
      genre: 'base',
      libelle: 'La base PostgreSQL',
      prendre: `pg_dump --no-owner --no-privileges ${HOTE_PG} -U "$BASE_UTILISATEUR" "$BASE_NOM" > "$SORTIE/base.sql"`,
      remettre: `psql -v ON_ERROR_STOP=1 ${HOTE_PG} -U "$BASE_UTILISATEUR" "$BASE_NOM" < "$ENTREE/base.sql"`,
      octetsMin: OCTETS_MIN_PAR_DEFAUT,
    });
  }

  const fichiers = site.fichiers;
  if (fichiers.moyen === 'local') {
    etapes.push({
      id: 'fichiers',
      genre: 'fichiers',
      libelle: 'Les fichiers du site',
      prendre: `rsync -a ${REFABRIQUABLES} "$FICHIERS_CHEMIN/" "$SORTIE/"`,
      remettre: `rsync -a --delete ${REFABRIQUABLES} "$ENTREE/" "$FICHIERS_CHEMIN/"`,
      octetsMin: OCTETS_MIN_PAR_DEFAUT,
    });
  } else if (fichiers.moyen === 'ssh') {
    etapes.push({
      id: 'fichiers',
      genre: 'fichiers',
      libelle: 'Les fichiers du site, par SSH',
      prendre: `rsync -a --timeout=600 ${SSH} ${DISTANT} "$SORTIE/"`,
      remettre: `rsync -a --delete --timeout=600 ${SSH} "$ENTREE/" ${DISTANT}`,
      octetsMin: OCTETS_MIN_PAR_DEFAUT,
    });
  } else if (fichiers.moyen === 'ftp') {
    const ouvrir =
      'set ssl:verify-certificate no\nopen -u "$FICHIERS_UTILISATEUR","$FICHIERS_MOT_DE_PASSE" -p ${FICHIERS_PORT:-21} "$FICHIERS_HOTE"';
    etapes.push({
      id: 'fichiers',
      genre: 'fichiers',
      libelle: 'Les fichiers du site, par FTP',
      prendre: `lftp -f /dev/stdin <<FIN\n${ouvrir}\nmirror --verbose=0 --parallel=2 "$FICHIERS_CHEMIN" "$SORTIE"\nbye\nFIN`,
      remettre: `lftp -f /dev/stdin <<FIN\n${ouvrir}\nmirror --reverse --delete --verbose=0 --parallel=2 "$ENTREE" "$FICHIERS_CHEMIN"\nbye\nFIN`,
      octetsMin: OCTETS_MIN_PAR_DEFAUT,
    });
  }

  return {
    version: 1,
    etapes,
    explication: 'Recette déduite de la fiche (sa base et ses fichiers), en attendant l’analyse du site.',
    origine: 'fiche',
  };
}

/** La recette qui tourne vraiment : celle de l'agent, sinon celle de la fiche. */
export function recetteEffective(site: SiteASauvegarder): RecetteDeBackup {
  return site.recette?.etapes?.length ? site.recette : recetteDepuisLaFiche(site);
}

/**
 * LES ACCÈS DE LA FICHE, DONNÉS AUX COMMANDES PAR L'ENVIRONNEMENT. Les noms
 * sont stables : c'est eux que la recette cite. `MYSQL_PWD` et `PGPASSWORD`
 * sont posés d'office, pour que le mot de passe ne passe jamais par la ligne de
 * commande.
 */
export function variablesDeLaFiche(site: SiteASauvegarder): Record<string, string> {
  const b = site.base;
  const f = site.fichiers;
  return {
    SITE_ID: site.id,
    SITE_NOM: site.nom,
    BASE_MOTEUR: b.moteur,
    BASE_HOTE: b.hote.trim(),
    BASE_PORT: b.port.trim(),
    BASE_NOM: b.nom,
    BASE_UTILISATEUR: b.utilisateur,
    BASE_MOT_DE_PASSE: b.motDePasse,
    MYSQL_PWD: b.moteur === 'mysql' ? b.motDePasse : '',
    PGPASSWORD: b.moteur === 'postgres' ? b.motDePasse : '',
    FICHIERS_MOYEN: f.moyen,
    FICHIERS_CHEMIN: f.chemin.replace(/\/+$/, ''),
    FICHIERS_HOTE: f.hote.trim(),
    FICHIERS_PORT: f.port.trim(),
    FICHIERS_UTILISATEUR: f.utilisateur,
    FICHIERS_MOT_DE_PASSE: f.motDePasse,
  };
}

/** Les noms de variables qu'une commande peut citer, dans l'ordre où on les explique. */
export const VARIABLES_DE_RECETTE = Object.keys(
  variablesDeLaFiche({
    id: '',
    nom: '',
    base: { moteur: 'aucune', hote: '', port: '', nom: '', utilisateur: '', motDePasse: '' },
    fichiers: { moyen: 'aucun', chemin: '', hote: '', port: '', utilisateur: '', motDePasse: '' },
  } as SiteASauvegarder),
);

/* ------------------------------------------------------------------ */
/* L'archive : son inventaire, son verdict                              */
/* ------------------------------------------------------------------ */

/** Ce qu'une étape a laissé dans l'archive. */
export interface InventaireDEtape {
  id: string;
  genre: GenreDEtape;
  libelle: string;
  fichiers: number;
  octets: number;
  /** Vrai quand l'étape a posé assez pour compter. */
  ok: boolean;
  /** Pourquoi elle ne compte pas : sa commande a échoué, ou elle n'a rien posé. */
  raison?: string;
}

/** L'INVENTAIRE D'UNE ARCHIVE, relu dans le zip une fois écrit. */
export interface InventaireDArchive {
  etapes: InventaireDEtape[];
  fichiers: number;
  /** La somme des poids NON compressés. */
  octets: number;
  manifeste: boolean;
}

/** Une entrée lue dans le zip : son nom et son poids décompressé. */
export interface EntreeDArchive {
  nom: string;
  octets: number;
}

/**
 * UN CHEMIN D'ENTRÉE SÛR, OU RIEN. Une archive peut porter « ../../etc/passwd »
 * ou un chemin absolu : l'extraire tel quel écrirait hors du dossier prévu. Le
 * chemin est rendu normalisé (séparateurs « / »), ou `null` s'il sort du cadre.
 */
export function entreeSure(nom: string): string | null {
  if (typeof nom !== 'string' || !nom || nom.includes('\0') || nom.includes('\\')) return null;
  if (nom.startsWith('/') || /^[a-zA-Z]:/.test(nom)) return null;
  const morceaux = nom.split('/').filter((m) => m !== '' && m !== '.');
  if (!morceaux.length || morceaux.some((m) => m === '..')) return null;
  return morceaux.join('/') + (nom.endsWith('/') ? '/' : '');
}

/** Les entrées du zip, rangées étape par étape. */
export function inventaireDesEntrees(
  entrees: EntreeDArchive[],
  recette: RecetteDeBackup,
  erreurs: Readonly<Record<string, string>> = {},
): InventaireDArchive {
  const parEtape = new Map<string, { fichiers: number; octets: number }>();
  let fichiers = 0;
  let octets = 0;
  let manifeste = false;
  for (const entree of entrees) {
    const nom = entreeSure(entree.nom);
    if (!nom || nom.endsWith('/')) continue;
    if (nom === NOM_MANIFESTE) {
      manifeste = true;
      continue;
    }
    const poids = Math.max(0, Number(entree.octets) || 0);
    fichiers += 1;
    octets += poids;
    const id = nom.split('/')[0];
    const compte = parEtape.get(id) ?? { fichiers: 0, octets: 0 };
    if (nom.includes('/')) {
      compte.fichiers += 1;
      compte.octets += poids;
      parEtape.set(id, compte);
    }
  }
  const etapes = recette.etapes.map((etape): InventaireDEtape => {
    const compte = parEtape.get(etape.id) ?? { fichiers: 0, octets: 0 };
    const erreur = erreurs[etape.id];
    const seuil = Math.max(OCTETS_MIN_PAR_DEFAUT, etape.octetsMin || 0);
    const raison = erreur
      ? erreur
      : !compte.fichiers
        ? 'rien n’a été posé'
        : compte.octets < seuil
          ? `trop léger (${compte.octets} o, au moins ${seuil} o attendus)`
          : undefined;
    return {
      id: etape.id,
      genre: etape.genre,
      libelle: etape.libelle,
      fichiers: compte.fichiers,
      octets: compte.octets,
      ok: !raison,
      ...(raison ? { raison } : {}),
    };
  });
  return { etapes, fichiers, octets, manifeste };
}

/** L'issue d'un point, décidée sur son inventaire. */
export type IssueDArchive = 'reussi' | 'partiel' | 'echec';

/**
 * LE VERDICT. Toutes les étapes ont posé ce qu'il fallait : « réussi ». Une
 * partie : « partiel ». Aucune, ou une archive sans son manifeste (écriture
 * interrompue) : « échec ». Le détail nomme chaque étape qui manque, avec sa
 * raison — c'est lui que l'agent relira pour réparer.
 */
export function verdictDeLArchive(inventaire: InventaireDArchive | null): { statut: IssueDArchive; detail: string } {
  if (!inventaire) return { statut: 'echec', detail: 'archive illisible' };
  if (!inventaire.manifeste) return { statut: 'echec', detail: 'archive incomplète : son manifeste manque' };
  const ratees = inventaire.etapes.filter((e) => !e.ok);
  const reussies = inventaire.etapes.length - ratees.length;
  const detail = ratees.length
    ? ratees.map((e) => `${e.libelle} : ${e.raison}`).join(' ; ')
    : `${inventaire.etapes.length} étape(s) prise(s) sans incident`;
  if (!inventaire.etapes.length || reussies === 0) return { statut: 'echec', detail: detail || 'aucune étape' };
  return { statut: ratees.length ? 'partiel' : 'reussi', detail };
}

/* ------------------------------------------------------------------ */
/* Le manifeste, et ce que la restauration rejoue                       */
/* ------------------------------------------------------------------ */

/** Ce que l'archive dit d'elle-même. Aucun mot de passe : ils restent sur la fiche. */
export interface ManifesteDArchive {
  version: 1;
  siteId: string;
  siteNom: string;
  debut: number;
  recette: RecetteDeBackup;
}

export function manifesteDArchive(site: SiteASauvegarder, recette: RecetteDeBackup, debut: number): ManifesteDArchive {
  return { version: 1, siteId: site.id, siteNom: site.nom, debut, recette };
}

/** Relit un manifeste venu d'une archive : `null` s'il ne tient pas debout. */
export function lireManifeste(brut: unknown): ManifesteDArchive | null {
  if (!brut || typeof brut !== 'object') return null;
  const m = brut as Record<string, any>;
  if (m.version !== 1 || typeof m.siteId !== 'string') return null;
  const recette = m.recette as RecetteDeBackup;
  if (!jugerRecette(recette).ok) return null;
  return { version: 1, siteId: m.siteId, siteNom: String(m.siteNom ?? ''), debut: Number(m.debut) || 0, recette };
}

/**
 * CE QUE LA RESTAURATION REJOUE : les étapes de la recette ENREGISTRÉE DANS
 * L'ARCHIVE (celle qui a pris ces données sait les remettre, même si la fiche
 * a changé depuis), et seulement celles que l'inventaire dit présentes.
 */
export function etapesARemettre(manifeste: ManifesteDArchive, inventaire: InventaireDArchive): EtapeDeRecette[] {
  const presentes = new Set(inventaire.etapes.filter((e) => e.ok).map((e) => e.id));
  return manifeste.recette.etapes.filter((etape) => presentes.has(etape.id));
}

/**
 * Le nom de l'archive d'un point : triable, comme son dossier d'avant. Un RANG
 * départage deux prises de la même seconde — le filet pris juste avant une
 * restauration écrasait sinon l'archive qu'on s'apprêtait à restaurer.
 */
export function nomDArchive(horodatage: string, rang = 1): string {
  return rang > 1 ? `${horodatage}-${rang}.zip` : `${horodatage}.zip`;
}

/** La recette telle qu'on la lit, une étape par ligne. */
export function phraseDeRecette(recette: RecetteDeBackup): string {
  if (!recette.etapes.length) return '(aucune étape)';
  return recette.etapes
    .map((e, rang) => `${rang + 1}. ${e.libelle} [${e.id}, ${LIBELLE_GENRE_D_ETAPE[e.genre] ?? e.genre}]`)
    .join('\n');
}

/** L'inventaire tel que l'agent et l'écran le lisent. */
export function phraseDInventaire(inventaire: InventaireDArchive): string {
  return inventaire.etapes
    .map((e) => `- ${e.libelle} : ${e.ok ? `${e.fichiers} fichier(s), ${e.octets} o` : `MANQUE — ${e.raison}`}`)
    .join('\n');
}

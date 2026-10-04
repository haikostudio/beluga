import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DIMENSIONS_VECTEURS,
  EXPLICATION_CHANGELOG_MAX,
  FICHES_GLOBAL,
  FICHES_PROJET,
  MODELE_VECTEURS,
  PISTES_MAX,
  PORTEE_GLOBALE,
  SEUIL_DES_PISTES,
  SEUIL_DOUBLON_SENS,
  SEUIL_DOUBLON_TEXTE,
  TITRE_CHANGELOG_MAX,
  categorieDuPoids,
  categorieDuTexte,
  cosinus,
  demandeAVectoriser,
  detailAuGabarit,
  detailSansSectionsVides,
  dossierDuProjet,
  empreinteDEntree,
  estIdentifiantDUnite,
  ficheDeLUnite,
  fichesDeLaPortee,
  formaterIdentifiant,
  jugerEntreeChangelog,
  jugerProposition,
  jugerRedactionChangelog,
  ligneDUneLecture,
  poidsValide,
  prefixeDuType,
  rendreArchive,
  rendreUnite,
  rendreChangelog,
  rendreFicheNumerotee,
  ressemblanceDeTextes,
  requetePleinTexte,
  requeteTrigrammes,
  scoreDUnite,
  uniteDansLaFiche,
  competenceDUnAutreProjet,
  scoreParMot,
  similariteDuRang,
  texteDAccueilConnaissances,
  titreNormalise,
  trierUnites,
  typesProbables,
  type CategorieChangelog,
  type EntreeDuChangelog,
  type GenreEntreeChangelog,
  type EtapeDuParcours,
  type Importance,
  type LigneDuCarnet,
  type PropositionPropre,
  type FicheNumerotee,
  type PropositionUnite,
  type RenduDeFiche,
  type TypeUnite,
  type Unite,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { vectoriser, vectoriseurDisponible } from './vectoriseur.js';

/**
 * LA BASE DE CONNAISSANCES — le travail réel : tables, porte d'écriture unique,
 * recherche pondérée, rendu des fiches en fichiers, changelog, brouillon
 * (Working) et import des lots de la génération.
 *
 * Les règles (taxonomie, jugement, gabarits, rendu, pondération) vivent dans
 * `shared/src/connaissances.ts`. Ici : écrire, lire, chercher, compter.
 *
 * UNE SEULE PORTE D'ÉCRITURE : `proposerUnite`. Les agents (outils « memoire »
 * et « remember »), le rangement de nuit, l'écran et la génération y passent
 * tous. Le moteur choisit la fiche et l'identifiant, cherche les doublons (même
 * titre normalisé, texte très proche, ou sens très proche), transforme un
 * doublon en mise à jour, déprécie ce qu'une unité remplace, garde chaque
 * version, et refuse ce qui ne se mémorise pas en rendant la raison.
 *
 * LA BASE FAIT FOI. À chaque écriture, les fichiers lisibles
 * `data/MEMORY/GLOBAL/*.md` et `data/MEMORY/PROJECTS/<projet>/NN_*.md` (plus
 * `archive/` et `CHANGELOG.md`) sont régénérés, regroupés en un seul passage.
 */

/* ------------------------------------------------------------------ */
/* Lignes                                                               */
/* ------------------------------------------------------------------ */

interface LigneUnite {
  num: number;
  id: string;
  portee: string;
  type: string;
  sujets: string;
  titre: string;
  titre_norme: string;
  resume: string;
  detail: string;
  raisonnement: string;
  statut: string;
  importance: string;
  confiance: number;
  source: string;
  liens: string;
  supersedes: string | null;
  superseded_by: string | null;
  jamais_supposer: number;
  relue: number;
  version: number;
  auteur: string;
  cree_le: number;
  modifie_le: number;
}

function json<T>(texte: string | null | undefined, defaut: T): T {
  try {
    return texte ? (JSON.parse(texte) as T) : defaut;
  } catch {
    return defaut;
  }
}

function versUnite(l: LigneUnite): Unite {
  return {
    id: l.id,
    portee: l.portee,
    type: l.type as TypeUnite,
    sujets: json<string[]>(l.sujets, []),
    titre: l.titre,
    resume: l.resume,
    detail: l.detail,
    raisonnement: l.raisonnement,
    statut: l.statut === 'deprecated' ? 'deprecated' : 'active',
    importance: l.importance as Importance,
    confiance: l.confiance,
    source: json(l.source, { genre: 'carte', ref: '' }),
    liens: json<string[]>(l.liens, []),
    supersedes: l.supersedes,
    supersededBy: l.superseded_by,
    jamaisSupposer: Boolean(l.jamais_supposer),
    relue: Boolean(l.relue),
    version: l.version,
    auteur: l.auteur,
    creeLe: l.cree_le,
    modifieLe: l.modifie_le,
  };
}

function numeroDe(id: string): number | null {
  const l = getDb().prepare('SELECT num FROM connaissances WHERE id = ?').get(id) as { num: number } | undefined;
  return l?.num ?? null;
}

export function lireUnite(id: string): Unite | null {
  const l = getDb().prepare('SELECT * FROM connaissances WHERE id = ?').get(String(id ?? '').trim().toUpperCase()) as LigneUnite | undefined;
  return l ? versUnite(l) : null;
}

export function unitesDeLaPortee(portee: string, statut: 'active' | 'deprecated' | 'toutes' = 'active'): Unite[] {
  const lignes = (
    statut === 'toutes'
      ? getDb().prepare('SELECT * FROM connaissances WHERE portee = ?').all(portee)
      : getDb().prepare('SELECT * FROM connaissances WHERE portee = ? AND statut = ?').all(portee, statut)
  ) as LigneUnite[];
  return trierUnites(lignes.map(versUnite));
}

export function compterUnites(portees: readonly string[]): number {
  if (!portees.length) return 0;
  try {
    return (
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM connaissances WHERE statut = 'active' AND portee IN (${portees.map(() => '?').join(',')})`)
        .get(...portees) as { n: number }
    ).n;
  } catch {
    return 0;
  }
}

export function nomDeLaPortee(portee: string): string {
  if (portee === PORTEE_GLOBALE) return 'Global';
  try {
    const l = getDb().prepare('SELECT name FROM projects WHERE id = ?').get(portee) as { name: string } | undefined;
    return l?.name ?? portee;
  } catch {
    return portee;
  }
}

export interface PorteeResumee {
  id: string;
  nom: string;
  unites: number;
  depreciees: number;
  changelog: number;
  aRelire: number;
  modifieLe: number;
}

/** Le Global en tête, puis les projets donnés, avec leurs comptes. */
export function listerLesPortees(projets: readonly { id: string; name: string }[]): PorteeResumee[] {
  const db = getDb();
  const comptes = new Map(
    (
      db
        .prepare(
          `SELECT portee, SUM(statut = 'active') AS actives, SUM(statut = 'deprecated') AS depreciees,
                  SUM(statut = 'active' AND relue = 0 AND confiance < 0.6) AS a_relire, MAX(modifie_le) AS modifie
             FROM connaissances GROUP BY portee`,
        )
        .all() as { portee: string; actives: number; depreciees: number; a_relire: number; modifie: number }[]
    ).map((l) => [l.portee, l]),
  );
  const changelogs = new Map(
    (db.prepare('SELECT project_id, COUNT(*) AS n FROM changelog_entrees GROUP BY project_id').all() as { project_id: string; n: number }[]).map((l) => [l.project_id, l.n]),
  );
  const resumer = (id: string, nom: string): PorteeResumee => {
    const c = comptes.get(id);
    return { id, nom, unites: c?.actives ?? 0, depreciees: c?.depreciees ?? 0, changelog: changelogs.get(id) ?? 0, aRelire: c?.a_relire ?? 0, modifieLe: c?.modifie ?? 0 };
  };
  return [resumer(PORTEE_GLOBALE, 'Global'), ...[...projets].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((p) => resumer(p.id, p.name))];
}

/* ------------------------------------------------------------------ */
/* La porte d'écriture                                                  */
/* ------------------------------------------------------------------ */

export type GesteDeLaPorte = 'cree' | 'mis-a-jour' | 'deja-la' | 'deprecie';

export type ResultatDeProposition =
  | { ok: true; geste: GesteDeLaPorte; unite: Unite; fusionneAvec?: string; remplace?: string }
  | { ok: false; raisons: string[] };

export interface ContexteDEcriture {
  auteur: string;
  cardId?: string;
  motif?: string;
  /** Une unité active très proche PAR LE SENS, trouvée avant d'entrer (`proposerUniteAvecSens`). */
  procheParLeSens?: string;
  /** Une règle déclarée par un humain (rangement de nuit) : le test des quatre questions ne s'y applique pas. */
  sansQuatreQuestions?: boolean;
  /**
   * La confiance donnée est la VRAIE, pas un plancher : une mise à jour la pose
   * telle quelle au lieu de garder la plus haute. C'est le cas d'une unité dont
   * la confiance est MESURÉE ailleurs (une compétence : `competence_stats`), et
   * qui doit pouvoir descendre.
   */
  confianceMesuree?: boolean;
}

/**
 * CE QUI ÉCOUTE LES DÉPRÉCIATIONS. Une unité peut refléter une chose tenue
 * ailleurs (une compétence du pool) : quand un humain ou un agent la déprécie
 * par la porte, sa source doit suivre. Les écouteurs sont appelés APRÈS
 * l'écriture ; une panne d'écouteur ne défait jamais la dépréciation.
 */
type EcouteurDeDepreciation = (unite: Unite, contexte: ContexteDEcriture) => void;
const ecouteursDeDepreciation = new Set<EcouteurDeDepreciation>();

export function quandUneUniteEstDepreciee(ecouteur: EcouteurDeDepreciation): () => void {
  ecouteursDeDepreciation.add(ecouteur);
  return () => ecouteursDeDepreciation.delete(ecouteur);
}

function prevenirDeLaDepreciation(unite: Unite, contexte: ContexteDEcriture): void {
  for (const ecouteur of ecouteursDeDepreciation) {
    try {
      ecouteur(unite, contexte);
    } catch (err) {
      log.warn(`écouteur de dépréciation en panne (${unite.id}) : ${(err as Error).message}`);
    }
  }
}

/**
 * LES UNITÉS D'UNE SOURCE — actives ET dépréciées, la plus récente d'abord.
 * C'est par la source, jamais par le titre, qu'une unité qui reflète une chose
 * tenue ailleurs (une compétence : genre « competence », `ref` = son nom) se
 * retrouve.
 */
export function unitesDeLaSource(portee: string, genre: string, ref?: string): Unite[] {
  const lignes = getDb()
    .prepare(
      `SELECT * FROM connaissances WHERE portee = ? AND json_extract(source, '$.genre') = ?
         ${ref === undefined ? '' : "AND json_extract(source, '$.ref') = ?"}
       ORDER BY (statut = 'active') DESC, modifie_le DESC`,
    )
    .all(...(ref === undefined ? [portee, genre] : [portee, genre, ref])) as LigneUnite[];
  return lignes.map(versUnite);
}

function numeroSuivant(type: TypeUnite): number {
  const prefixe = prefixeDuType(type);
  const db = getDb();
  db.prepare('INSERT INTO connaissance_compteurs (prefixe, dernier) VALUES (?, 1) ON CONFLICT(prefixe) DO UPDATE SET dernier = dernier + 1').run(prefixe);
  return (db.prepare('SELECT dernier FROM connaissance_compteurs WHERE prefixe = ?').get(prefixe) as { dernier: number }).dernier;
}

function garderLaVersion(avant: Unite, auteur: string, motif: string): void {
  getDb()
    .prepare('INSERT INTO connaissance_versions (unite_id, version, instantane, auteur, motif, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(avant.id, avant.version, JSON.stringify(avant), auteur, motif, Date.now());
}

function refuser(portee: string, proposition: PropositionUnite, raisons: string[], auteur: string): ResultatDeProposition {
  try {
    getDb()
      .prepare('INSERT INTO connaissance_refus (portee, titre, raisons, auteur, at) VALUES (?, ?, ?, ?, ?)')
      .run(portee, String(proposition.titre ?? proposition.id ?? '').slice(0, 200), JSON.stringify(raisons), auteur, Date.now());
  } catch {
    /* le journal des refus n'arrête jamais la réponse */
  }
  return { ok: false, raisons };
}

const IMPORTANCE_LA_PLUS_HAUTE = (a: Importance, b: Importance): Importance => ([a, b].sort()[0] as Importance);

/**
 * Les chiffres et les lettres isolées d'un titre : ce qui distingue deux
 * titres autrement semblables (« port 7000 » / « port 7070 », « carte A » /
 * « carte B »). Une lettre collee a une apostrophe (« l' », « d' », « n'... »)
 * est une elision francaise, pas un identifiant : elle est ignoree des deux
 * cotes (« l'heure » comme « qu'un ») pour ne pas separer a tort deux titres
 * qui disent la meme chose avec des tournures differentes.
 */
function marqueursDuTitre(titre: string): string {
  return (
    titre
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/(?<![\x27\u2019])\b(\d+|[a-z])\b(?![\x27\u2019])/g) ?? []
  )
    .sort()
    .join(' ');
}

/**
 * Le doublon d'une proposition : même titre normalisé (tous types confondus), ou texte très proche
 * du même type, dans la même portée OU dans le classeur global — un projet ne recrée pas une fiche
 * qui existe déjà pour tout le monde (même règle que « update »/« deprecate » à la ligne 322).
 */
function doublonDe(portee: string, p: PropositionPropre, procheParLeSens?: string): Unite | null {
  const db = getDb();
  const portees = portee === PORTEE_GLOBALE ? [portee] : [portee, PORTEE_GLOBALE];
  const placeholders = portees.map(() => '?').join(', ');
  const memeTitre = db
    .prepare(`SELECT * FROM connaissances WHERE portee IN (${placeholders}) AND titre_norme = ? AND statut = 'active' LIMIT 1`)
    .get(...portees, titreNormalise(p.titre)) as LigneUnite | undefined;
  if (memeTitre) return versUnite(memeTitre);
  const candidats = db
    .prepare(`SELECT * FROM connaissances WHERE portee IN (${placeholders}) AND type = ? AND statut = 'active'`)
    .all(...portees, p.type) as LigneUnite[];
  // Un texte très proche ne suffit pas quand les titres portent des marqueurs différents (« carte A » / « carte B », « port 7000 » / « port 7070 »).
  const marqueurs = marqueursDuTitre(p.titre);
  for (const c of candidats) {
    if (marqueursDuTitre(c.titre) !== marqueurs) continue;
    if (ressemblanceDeTextes(c.titre, p.titre) >= SEUIL_DOUBLON_TEXTE && ressemblanceDeTextes(c.resume, p.resume) >= 0.6) return versUnite(c);
  }
  if (procheParLeSens) {
    const u = lireUnite(procheParLeSens);
    if (u && (u.portee === portee || u.portee === PORTEE_GLOBALE) && u.type === p.type && u.statut === 'active') return u;
  }
  return null;
}

/**
 * LA PORTE D'ÉCRITURE — la seule. Rend ce que le moteur a fait (créée, mise à
 * jour, déjà là, dépréciée) ou TOUTES les raisons d'un refus.
 */
export function proposerUnite(portee: string, proposition: PropositionUnite, contexte: ContexteDEcriture): ResultatDeProposition {
  const juge = jugerProposition(proposition, { quatreQuestions: !contexte.sansQuatreQuestions });
  if (!juge.ok) return refuser(portee, proposition, juge.raisons, contexte.auteur);
  const p = juge.propre;
  const db = getDb();
  const maintenant = Date.now();
  const source = p.source.ref ? p.source : { ...p.source, ref: contexte.cardId ?? contexte.auteur };

  if (p.action === 'deprecate' || p.action === 'update') {
    const cible = lireUnite(p.id!);
    if (!cible || (cible.portee !== portee && cible.portee !== PORTEE_GLOBALE)) {
      return refuser(portee, proposition, [`Aucune unité « ${p.id} » dans cette portée : cherche-la d’abord avec « chercher ».`], contexte.auteur);
    }
    if (p.action === 'deprecate') {
      if (cible.statut === 'deprecated') return { ok: true, geste: 'deja-la', unite: cible };
      db.transaction(() => {
        garderLaVersion(cible, contexte.auteur, contexte.motif ?? `dépréciée${p.raisonnement ? ` : ${p.raisonnement}` : ''}`);
        db.prepare("UPDATE connaissances SET statut = 'deprecated', version = version + 1, auteur = ?, modifie_le = ? WHERE id = ?").run(contexte.auteur, maintenant, cible.id);
      })();
      apresEcriture(cible.portee);
      const depreciee = lireUnite(cible.id)!;
      prevenirDeLaDepreciation(depreciee, contexte);
      return { ok: true, geste: 'deprecie', unite: depreciee };
    }
    if (p.type !== cible.type) return reclasser(cible, p, source, contexte);
    return mettreAJour(cible, p, source, contexte, 'mise à jour');
  }

  const doublon = doublonDe(portee, p, contexte.procheParLeSens);
  if (doublon) {
    const pareil =
      doublon.type === p.type &&
      titreNormalise(doublon.resume) === titreNormalise(p.resume) &&
      (!p.detail || titreNormalise(doublon.detail) === titreNormalise(p.detail)) &&
      (!p.jamaisSupposer || doublon.jamaisSupposer);
    if (pareil) return { ok: true, geste: 'deja-la', unite: doublon };
    // Une simple création ne change jamais le type d'une unité existante — elle
    // fusionne dedans, sinon deux propositions au même titre mais de types
    // différents rejouées plusieurs fois font ping-pong d'un type à l'autre à
    // chaque import (constaté : 6 unités neuves à la deuxième passe d'un import
    // pourtant censé être rejouable à l'identique). Changer le type reste un
    // geste explicite : « update » avec un id, qui passe par `reclasser`.
    const r = mettreAJour(doublon, p, source, contexte, 'doublon fusionné');
    return r.ok ? { ...r, fusionneAvec: doublon.id } : r;
  }

  let remplacee: Unite | null = null;
  if (p.remplace) {
    remplacee = lireUnite(p.remplace);
    if (!remplacee || remplacee.portee !== portee) {
      return refuser(portee, proposition, [`L’unité à remplacer « ${p.remplace} » n’existe pas dans cette portée.`], contexte.auteur);
    }
  }

  const id = formaterIdentifiant(p.type, numeroSuivant(p.type));
  db.transaction(() => {
    db.prepare(
      `INSERT INTO connaissances (id, portee, type, sujets, titre, titre_norme, resume, detail, raisonnement, statut, importance, confiance,
                                  source, liens, supersedes, superseded_by, jamais_supposer, relue, version, auteur, cree_le, modifie_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, 0, 1, ?, ?, ?)`,
    ).run(
      id,
      portee,
      p.type,
      JSON.stringify(p.sujets),
      p.titre,
      titreNormalise(p.titre),
      p.resume,
      p.detail,
      p.raisonnement,
      p.importance,
      p.confiance,
      JSON.stringify(source),
      JSON.stringify(p.liens),
      remplacee && remplacee.statut === 'active' ? remplacee.id : remplacee?.id ?? null,
      p.jamaisSupposer ? 1 : 0,
      contexte.auteur,
      maintenant,
      maintenant,
    );
    if (remplacee && remplacee.statut === 'active') {
      garderLaVersion(remplacee, contexte.auteur, `remplacée par ${id}`);
      db.prepare("UPDATE connaissances SET statut = 'deprecated', superseded_by = ?, version = version + 1, auteur = ?, modifie_le = ? WHERE id = ?").run(
        id,
        contexte.auteur,
        maintenant,
        remplacee.id,
      );
    }
  })();
  apresEcriture(portee);
  return { ok: true, geste: 'cree', unite: lireUnite(id)!, remplace: remplacee?.id };
}

function mettreAJour(cible: Unite, p: PropositionPropre, source: Unite['source'], contexte: ContexteDEcriture, motif: string): ResultatDeProposition {
  const db = getDb();
  const maintenant = Date.now();
  const titre = p.titre || cible.titre;
  db.transaction(() => {
    garderLaVersion(cible, contexte.auteur, contexte.motif ?? motif);
    db.prepare(
      `UPDATE connaissances SET titre = ?, titre_norme = ?, resume = ?, detail = ?, raisonnement = ?, importance = ?, confiance = ?,
              sujets = ?, liens = ?, source = ?, jamais_supposer = ?, statut = 'active', relue = 0, version = version + 1, auteur = ?, modifie_le = ?
        WHERE id = ?`,
    ).run(
      titre,
      titreNormalise(titre),
      p.resume || cible.resume,
      p.detail || cible.detail,
      p.raisonnement || cible.raisonnement,
      IMPORTANCE_LA_PLUS_HAUTE(cible.importance, p.importance),
      contexte.confianceMesuree ? p.confiance : Math.max(cible.confiance, p.confiance),
      JSON.stringify([...new Set([...cible.sujets, ...p.sujets])]),
      JSON.stringify([...new Set([...cible.liens, ...p.liens])]),
      JSON.stringify(source),
      cible.jamaisSupposer || p.jamaisSupposer ? 1 : 0,
      contexte.auteur,
      maintenant,
      cible.id,
    );
  })();
  apresEcriture(cible.portee);
  return { ok: true, geste: 'mis-a-jour', unite: lireUnite(cible.id)! };
}

/**
 * DÉPRÉCIER UNE UNITÉ AU PROFIT D'UNE AUTRE DÉJÀ EXISTANTE — le rapprochement
 * de deux fiches qui disent la même chose, jamais la création normale (qui
 * passe par `remplace` dans `proposerUnite`). Rien n'est supprimé : la version
 * est gardée, `superseded_by` pointe vers l'unité qui reste.
 */
export function deprecierEnFaveurDe(id: string, remplacePar: string, auteur: string, motif: string): ResultatDeProposition {
  const db = getDb();
  const cible = lireUnite(id);
  if (!cible) return { ok: false, raisons: [`Aucune unité « ${id} ».`] };
  if (cible.statut === 'deprecated') return { ok: true, geste: 'deja-la', unite: cible };
  const maintenant = Date.now();
  db.transaction(() => {
    garderLaVersion(cible, auteur, motif);
    db.prepare("UPDATE connaissances SET statut = 'deprecated', superseded_by = ?, version = version + 1, auteur = ?, modifie_le = ? WHERE id = ?").run(
      remplacePar,
      auteur,
      maintenant,
      cible.id,
    );
  })();
  apresEcriture(cible.portee);
  return { ok: true, geste: 'deprecie', unite: lireUnite(cible.id)! };
}

/**
 * RECLASSER : un « update » qui donne un autre type. L'ancienne version est
 * gardée avec le motif « reclassée ». Tant que le préfixe ne change pas, l'unité
 * garde son identifiant ; vers ou depuis « decision » (DEC ↔ MEM), une unité
 * neuve prend le relais et l'ancienne est dépréciée, reliée à elle. Le détail
 * quitte les sections restées vides de son ancien gabarit.
 */
function reclasser(cible: Unite, p: PropositionPropre, source: Unite['source'], contexte: ContexteDEcriture): ResultatDeProposition {
  const db = getDb();
  const maintenant = Date.now();
  const titre = p.titre || cible.titre;
  const resume = p.resume || cible.resume;
  const brut = detailSansSectionsVides(p.detail || cible.detail);
  const detail = p.type === 'decision' || p.type === 'domain' || p.type === 'component' ? detailAuGabarit(p.type, brut, resume) : brut;
  const raisonnement = p.raisonnement || cible.raisonnement;
  const importance = IMPORTANCE_LA_PLUS_HAUTE(cible.importance, p.importance);
  const sujets = JSON.stringify([...new Set([...cible.sujets, ...p.sujets])]);
  const liens = JSON.stringify([...new Set([...cible.liens, ...p.liens])]);
  const jamais = cible.jamaisSupposer || p.jamaisSupposer ? 1 : 0;
  const motif = contexte.motif ?? `reclassée : ${cible.type} → ${p.type}`;

  if (prefixeDuType(p.type) === prefixeDuType(cible.type)) {
    db.transaction(() => {
      garderLaVersion(cible, contexte.auteur, motif);
      db.prepare(
        `UPDATE connaissances SET type = ?, titre = ?, titre_norme = ?, resume = ?, detail = ?, raisonnement = ?, importance = ?, sujets = ?, liens = ?,
                source = ?, jamais_supposer = ?, version = version + 1, auteur = ?, modifie_le = ? WHERE id = ?`,
      ).run(p.type, titre, titreNormalise(titre), resume, detail, raisonnement, importance, sujets, liens, JSON.stringify(source), jamais, contexte.auteur, maintenant, cible.id);
    })();
    apresEcriture(cible.portee);
    return { ok: true, geste: 'mis-a-jour', unite: lireUnite(cible.id)! };
  }

  const id = formaterIdentifiant(p.type, numeroSuivant(p.type));
  db.transaction(() => {
    db.prepare(
      `INSERT INTO connaissances (id, portee, type, sujets, titre, titre_norme, resume, detail, raisonnement, statut, importance, confiance,
                                  source, liens, supersedes, superseded_by, jamais_supposer, relue, version, auteur, cree_le, modifie_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?)`,
    ).run(
      id,
      cible.portee,
      p.type,
      sujets,
      titre,
      titreNormalise(titre),
      resume,
      detail,
      raisonnement,
      importance,
      Math.max(cible.confiance, p.confiance),
      JSON.stringify(source),
      liens,
      cible.id,
      jamais,
      cible.relue ? 1 : 0,
      contexte.auteur,
      maintenant,
      maintenant,
    );
    garderLaVersion(cible, contexte.auteur, `${motif}, remplacée par ${id}`);
    db.prepare("UPDATE connaissances SET statut = 'deprecated', superseded_by = ?, version = version + 1, auteur = ?, modifie_le = ? WHERE id = ?").run(
      id,
      contexte.auteur,
      maintenant,
      cible.id,
    );
  })();
  apresEcriture(cible.portee);
  return { ok: true, geste: 'cree', unite: lireUnite(id)!, remplace: cible.id };
}

/** La même porte, précédée d'un regard par le SENS : une unité très proche du même type devient la cible. */
export async function proposerUniteAvecSens(portee: string, proposition: PropositionUnite, contexte: ContexteDEcriture): Promise<ResultatDeProposition> {
  if ((proposition.action ?? 'create') !== 'create' || !vectoriseurDisponible() || !proposition.titre || !proposition.resume) {
    return proposerUnite(portee, proposition, contexte);
  }
  try {
    const [v] = await vectoriser(
      [texteDUniteAVectoriser({ titre: String(proposition.titre), resume: String(proposition.resume), detail: proposition.detail ? String(proposition.detail) : undefined })],
      6_000,
    );
    let meilleur: { id: string; cos: number } | null = null;
    for (const x of vecteursDesUnites()) {
      if (x.portee !== portee || x.type !== String(proposition.type ?? '').toLowerCase() || x.statut !== 'active') continue;
      const cos = cosinus(v, x.vecteur);
      if (cos >= SEUIL_DOUBLON_SENS && (!meilleur || cos > meilleur.cos)) meilleur = { id: x.id, cos };
    }
    return proposerUnite(portee, proposition, { ...contexte, procheParLeSens: meilleur?.id });
  } catch {
    return proposerUnite(portee, proposition, contexte);
  }
}

/**
 * Seuil de ressemblance du TITRE pour `procheDuMemeSujet` — plus bas que
 * `SEUIL_DOUBLON_TEXTE` (0,8), car un titre reformulé ou complété d'une
 * clause tombe vite en dessous (constaté sur MEM-1904/MEM-2782 et
 * DEC-221/MEM-2781 : 0,875 les deux fois). Le RÉSUMÉ n'entre plus dans le
 * calcul : deux textes qui décrivent le même fait à des grains très
 * différents (une décision en une phrase, une règle nommée avec ses fichiers)
 * tombent souvent sous 0,6 de résumé alors que le titre, lui, reste très
 * proche (constaté sur DEC-221/MEM-2781 : résumé à 0,339). N'existe QUE pour
 * le rangement de nuit : les autres portes d'écriture (`remember`, l'outil
 * « memoire ») gardent `doublonDe` inchangée, à son seuil habituel —
 * l'élargir pour tout le monde risquerait de fusionner à tort des faits
 * distincts.
 */
const SEUIL_DOUBLON_SUJET = 0.75;

/**
 * Une unité active du MÊME SUJET qui dit déjà essentiellement la même chose
 * qu'une règle candidate, TOUS TYPES CONFONDUS — au lieu du même type
 * seulement, comme `doublonDe`. Réservée au rangement de nuit : une decision
 * posée par une carte et une convention reformulée le lendemain sur le même
 * sujet ne se distinguaient que par leur catégorie, et se doublaient malgré
 * un contenu quasi identique (constat du 17/09/2026 : DEC-221/MEM-2782,
 * MEM-1904/MEM-2782, MEM-2736/MEM-2783).
 *
 * D'abord un rapprochement par le TEXTE (rapide, sans moteur) ; si rien ne
 * sort et que le moteur de vectorisation tourne, un rapprochement par le SENS
 * — utile quand le titre change trop pour `ressemblanceDeTextes` mais que le
 * contenu reste le même.
 */
async function procheDuMemeSujet(portee: string, sujet: string, p: { titre: string; resume: string; detail?: string }): Promise<Unite | undefined> {
  const candidats = unitesDeLaPortee(portee, 'active').filter((u) => u.sujets.includes(sujet));
  if (!candidats.length) return undefined;

  // Le même garde-fou que `doublonDe` : un port 7000 et un port 7070, ou une
  // carte A et une carte B, ne sont proches ni par le texte ni par le sens.
  const marqueurs = marqueursDuTitre(p.titre);
  const memeMarqueurs = candidats.filter((c) => marqueursDuTitre(c.titre) === marqueurs);
  if (!memeMarqueurs.length) return undefined;

  const parLeTexte = memeMarqueurs.find((c) => ressemblanceDeTextes(c.titre, p.titre) >= SEUIL_DOUBLON_SUJET);
  if (parLeTexte) return parLeTexte;

  if (!vectoriseurDisponible()) return undefined;
  try {
    const [v] = await vectoriser([texteDUniteAVectoriser(p)], 6_000);
    const vecteurs = vecteursDesUnites();
    let meilleur: { unite: Unite; cos: number } | undefined;
    for (const c of memeMarqueurs) {
      const vec = vecteurs.find((x) => x.id === c.id);
      if (!vec) continue;
      const cos = cosinus(v, vec.vecteur);
      if (cos >= SEUIL_DOUBLON_SENS && (!meilleur || cos > meilleur.cos)) meilleur = { unite: c, cos };
    }
    return meilleur?.unite;
  } catch {
    return undefined;
  }
}

/**
 * LA PORTE DU RANGEMENT DE NUIT — cherche une unité proche du MÊME SUJET,
 * toutes catégories confondues, avant de créer. Trouvée : elle se COMPLÈTE
 * (`mettreAJour`, via l'action « update » posée avec le type de la cible), sa
 * catégorie ne change JAMAIS — reclasser une decision en convention à cette
 * occasion a déjà causé un va-et-vient de créations à chaque rejeu de
 * l'import. Rien trouvé : la création normale se déroule, comme avant.
 */
export async function proposerReglesDeNuit(
  portee: string,
  sujet: string,
  regle: { titre: string; resume: string; detail: string; source: PropositionUnite['source'] },
  contexte: { auteur: string; motif?: string },
): Promise<ResultatDeProposition> {
  const proche = await procheDuMemeSujet(portee, sujet, regle);
  if (!proche) {
    return proposerUnite(
      portee,
      { type: 'convention', importance: 'P1', titre: regle.titre, resume: regle.resume, detail: regle.detail, sujets: [sujet], confiance: 0.9, source: regle.source },
      { auteur: contexte.auteur, motif: contexte.motif, sansQuatreQuestions: true },
    );
  }

  const dejaLa =
    titreNormalise(proche.resume) === titreNormalise(regle.resume) && (!regle.detail || titreNormalise(proche.detail) === titreNormalise(regle.detail));
  if (dejaLa) return { ok: true, geste: 'deja-la', unite: proche };

  return proposerUnite(
    portee,
    {
      action: 'update',
      id: proche.id,
      type: proche.type,
      importance: 'P1',
      titre: regle.titre,
      resume: regle.resume,
      detail: regle.detail,
      raisonnement: proche.raisonnement,
      sujets: [sujet],
      confiance: 0.9,
      source: regle.source,
    },
    { auteur: contexte.auteur, motif: contexte.motif ?? 'complétée par le rangement de nuit, règle proche déjà rangée', sansQuatreQuestions: true },
  );
}

/** Confirmée par un humain : l'unité quitte la liste « à relire ». */
export function confirmerUnite(id: string): Unite | null {
  getDb().prepare('UPDATE connaissances SET relue = 1 WHERE id = ?').run(String(id).toUpperCase());
  return lireUnite(id);
}

export function versionsDeLUnite(id: string): { version: number; auteur: string; motif: string; at: number; unite: Unite }[] {
  return (
    getDb()
      .prepare('SELECT version, instantane, auteur, motif, at FROM connaissance_versions WHERE unite_id = ? ORDER BY at DESC, id DESC LIMIT 50')
      .all(String(id).toUpperCase()) as { version: number; instantane: string; auteur: string; motif: string; at: number }[]
  ).map((l) => ({ version: l.version, auteur: l.auteur, motif: l.motif, at: l.at, unite: json<Unite>(l.instantane, null as unknown as Unite) }));
}

export function refusRecents(portee: string, limite = 30): { titre: string; raisons: string[]; auteur: string; at: number }[] {
  return (
    getDb().prepare('SELECT titre, raisons, auteur, at FROM connaissance_refus WHERE portee = ? ORDER BY at DESC LIMIT ?').all(portee, limite) as {
      titre: string;
      raisons: string;
      auteur: string;
      at: number;
    }[]
  ).map((l) => ({ ...l, raisons: json<string[]>(l.raisons, []) }));
}

/** Les sujets déjà présents dans une portée. */
export function sujetsDeLaPortee(portee: string): string[] {
  try {
    const lignes = getDb().prepare("SELECT DISTINCT value AS sujet FROM connaissances, json_each(connaissances.sujets) WHERE portee = ?").all(portee) as { sujet: string }[];
    return lignes.map((l) => l.sujet).sort();
  } catch {
    return [];
  }
}

/** Les unités qu'un agent a écrites ou modifiées depuis la veille : la relecture de nuit. */
export function unitesARelire(maintenant = Date.now()): Unite[] {
  try {
    return (
      getDb()
        .prepare(
          `SELECT * FROM connaissances WHERE modifie_le >= ? AND auteur NOT IN ('generation', 'écran', 'montage')
            ORDER BY modifie_le DESC LIMIT 30`,
        )
        .all(maintenant - 24 * 3600_000) as LigneUnite[]
    ).map(versUnite);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Après chaque écriture                                                */
/* ------------------------------------------------------------------ */

function apresEcriture(portee: string): void {
  cacheDesVecteurs = null;
  planifierLeRendu(portee);
  planifierLesVecteurs();
}

/* ------------------------------------------------------------------ */
/* Le rendu en fichiers                                                 */
/* ------------------------------------------------------------------ */

export function dossierDeLaMemoire(): string {
  return path.join(CONFIG.dataDir, 'MEMORY');
}

export function dossierDeLaPortee(portee: string): string {
  return portee === PORTEE_GLOBALE
    ? path.join(dossierDeLaMemoire(), 'GLOBAL')
    : path.join(dossierDeLaMemoire(), 'PROJECTS', dossierDuProjet(nomDeLaPortee(portee), portee));
}

function ecrireSiChange(fichier: string, contenu: string): boolean {
  try {
    if (fs.readFileSync(fichier, 'utf8') === contenu) return false;
  } catch {
    /* fichier absent : on l'écrit */
  }
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, contenu);
  return true;
}

/**
 * Les unités d'une fiche. Les compétences vivent toutes dans le classeur Global : la fiche
 * « Compétences » d'un projet va les y chercher, celle du Global ne garde que celles qui valent pour tous.
 */
export function unitesDeLaFiche(portee: string, fiche: FicheNumerotee, statut: 'active' | 'deprecated' | 'toutes' = 'active', dejaLues?: readonly Unite[]): Unite[] {
  if (fiche.competences && portee !== PORTEE_GLOBALE) {
    const nom = nomDeLaPortee(portee);
    return unitesDeLaPortee(PORTEE_GLOBALE, statut).filter((u) => uniteDansLaFiche(fiche, u, nom));
  }
  const unites = dejaLues ?? unitesDeLaPortee(portee, statut);
  return unites.filter((u) => (statut === 'toutes' || u.statut === (statut === 'active' ? 'active' : 'deprecated')) && uniteDansLaFiche(fiche, u));
}

function renduDeLaFiche(portee: string, fiche: FicheNumerotee, unitesDeLaPorteeToutes: readonly Unite[]): RenduDeFiche {
  const competencesDeProjet = fiche.competences && portee !== PORTEE_GLOBALE;
  return {
    portee,
    nomDeLaPortee: nomDeLaPortee(portee),
    fiche,
    unites: competencesDeProjet ? unitesDeLaFiche(portee, fiche, 'toutes') : unitesDeLaPorteeToutes,
    competencesDe: competencesDeProjet ? nomDeLaPortee(portee) : undefined,
  };
}

/** Une fiche numérotée d'une portée, en Markdown (ou son archive). */
export function markdownDeLaFiche(portee: string, ficheId: string, archive = false): string | null {
  const fiche = fichesDeLaPortee(portee).find((f) => f.id === ficheId);
  if (!fiche) return null;
  const unites = unitesDeLaPortee(portee, 'toutes');
  const rendu = renduDeLaFiche(portee, fiche, unites);
  if (archive) return rendreArchive(rendu);
  const toutes = portee === PORTEE_GLOBALE ? unites : [...unites, ...unitesDeLaPortee(PORTEE_GLOBALE).filter((u) => u.jamaisSupposer)];
  return rendreFicheNumerotee(rendu, toutes);
}

export function markdownDuChangelog(projectId: string): string {
  return rendreChangelog(nomDeLaPortee(projectId), entreesDuChangelog(projectId));
}

/** Régénère tous les fichiers d'une portée. Rend le nombre de fichiers réellement réécrits. */
export function rendreLesFichiers(portee: string): number {
  const dossier = dossierDeLaPortee(portee);
  let ecrits = 0;
  const unites = unitesDeLaPortee(portee, 'toutes');
  const nom = nomDeLaPortee(portee);
  const toutes = portee === PORTEE_GLOBALE ? unites : [...unites, ...unitesDeLaPortee(PORTEE_GLOBALE).filter((u) => u.jamaisSupposer)];
  for (const fiche of fichesDeLaPortee(portee)) {
    const rendu = renduDeLaFiche(portee, fiche, unites);
    if (ecrireSiChange(path.join(dossier, `${fiche.id}.md`), rendreFicheNumerotee(rendu, toutes))) ecrits++;
    if (rendu.unites.some((u) => u.statut === 'deprecated' && uniteDansLaFiche(fiche, u, rendu.competencesDe))) {
      if (ecrireSiChange(path.join(dossier, 'archive', `${fiche.id}.md`), rendreArchive(rendu))) ecrits++;
    }
  }
  if (portee !== PORTEE_GLOBALE && ecrireSiChange(path.join(dossier, 'CHANGELOG.md'), markdownDuChangelog(portee))) ecrits++;
  return ecrits;
}

const rendusEnAttente = new Set<string>();
let minuteurDuRendu: NodeJS.Timeout | null = null;

function planifierLeRendu(portee: string): void {
  rendusEnAttente.add(portee);
  if (minuteurDuRendu) return;
  minuteurDuRendu = setTimeout(() => {
    minuteurDuRendu = null;
    const portees = [...rendusEnAttente];
    rendusEnAttente.clear();
    for (const p of portees) {
      try {
        rendreLesFichiers(p);
      } catch (err) {
        log.warn(`base de connaissances : rendu de ${p} sauté (${(err as Error).message})`);
      }
    }
  }, 1500);
  minuteurDuRendu.unref();
}

/** Tout ce qu'une portée sait, en un seul document (export, lecture de la mémoire d'un projet). */
export function markdownDeLaPortee(portee: string): string {
  const nom = nomDeLaPortee(portee);
  const fiches = fichesDeLaPortee(portee)
    .map((f) => markdownDeLaFiche(portee, f.id) ?? '')
    .filter((m) => !/\n_Non renseigné\._\n$/.test(m) || /^## /m.test(m))
    .map((m) => m.replace(/^(#{1,4}) /gm, '#$1 '));
  const changelog = portee === PORTEE_GLOBALE ? '' : markdownDuChangelog(portee).replace(/^(#{1,4}) /gm, '#$1 ');
  return [`# Base de connaissances — ${nom}`, '', ...fiches, changelog].join('\n');
}

/* ------------------------------------------------------------------ */
/* La recherche pondérée                                                */
/* ------------------------------------------------------------------ */

export interface UniteTrouvee {
  unite: Unite;
  score: number;
}

export interface OptionsDeRecherche {
  projectId?: string | null;
  /** Les portées où chercher ; par défaut le projet puis le global. */
  portees?: readonly string[];
  /** Toutes les portées (l'écran). */
  tous?: boolean;
  types?: readonly TypeUnite[];
  sujet?: string;
  deprecies?: boolean;
  limite?: number;
}

function porteesVisees(o: OptionsDeRecherche): string[] | null {
  if (o.tous) return null;
  if (o.portees?.length) return [...o.portees];
  return o.projectId ? [o.projectId, PORTEE_GLOBALE] : [PORTEE_GLOBALE];
}

interface Classement {
  nums: number[];
  meilleurScore: number;
}

function classerParLesMots(texte: string, o: OptionsDeRecherche): Classement {
  const pleinTexte = requetePleinTexte(texte);
  const trigrammes = requeteTrigrammes(texte);
  const portees = porteesVisees(o);
  const filtres: string[] = [];
  const valeurs: unknown[] = [];
  if (portees) {
    filtres.push(`c.portee IN (${portees.map(() => '?').join(',')})`);
    valeurs.push(...portees);
  }
  if (!o.deprecies) filtres.push("c.statut = 'active'");
  const ou = filtres.length ? `AND ${filtres.join(' AND ')}` : '';
  const nums: number[] = [];
  let meilleurScore = 0;
  const db = getDb();
  const noter = (lignes: { num: number; rang: number }[]) => {
    for (const l of lignes) {
      if (nums.includes(l.num)) continue;
      nums.push(l.num);
      meilleurScore = Math.max(meilleurScore, Math.abs(l.rang));
    }
  };
  if (pleinTexte) {
    try {
      noter(
        db
          .prepare(
            `SELECT c.num, bm25(connaissances_fts, 8, 4, 1, 2) AS rang FROM connaissances_fts JOIN connaissances c ON c.num = connaissances_fts.rowid
              WHERE connaissances_fts MATCH ? ${ou} ORDER BY rang LIMIT 150`,
          )
          .all(pleinTexte, ...valeurs) as { num: number; rang: number }[],
      );
    } catch (err) {
      log.warn(`base de connaissances : requête plein texte refusée (${(err as Error).message})`);
    }
  }
  if (nums.length < 20 && trigrammes) {
    try {
      noter(
        (
          db
            .prepare(
              `SELECT c.num, bm25(connaissances_tri, 6, 1) AS rang FROM connaissances_tri JOIN connaissances c ON c.num = connaissances_tri.rowid
                WHERE connaissances_tri MATCH ? ${ou} ORDER BY rang LIMIT 60`,
            )
            .all(trigrammes, ...valeurs) as { num: number; rang: number }[]
        ).map((l) => ({ ...l, rang: 0 })),
      );
    } catch (err) {
      log.warn(`base de connaissances : requête en trigrammes refusée (${(err as Error).message})`);
    }
  }
  return { nums, meilleurScore };
}

function unitesParNumeros(nums: readonly number[]): Map<number, Unite & { num: number }> {
  const sortie = new Map<number, Unite & { num: number }>();
  for (let i = 0; i < nums.length; i += 400) {
    const lot = nums.slice(i, i + 400);
    for (const l of getDb().prepare(`SELECT * FROM connaissances WHERE num IN (${lot.map(() => '?').join(',')})`).all(...lot) as LigneUnite[]) {
      sortie.set(l.num, { ...versUnite(l), num: l.num });
    }
  }
  return sortie;
}

/** Le nom d'un projet, pour reconnaître SES compétences (sujet `projet-<nom>`). */
function nomDuProjet(projectId: string): string | undefined {
  try {
    return (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name?: string } | undefined)?.name;
  } catch {
    return undefined;
  }
}

function ponderer(texte: string, o: OptionsDeRecherche, similarites: Map<number, number>): UniteTrouvee[] {
  const limite = Math.max(1, Math.min(o.limite ?? 8, 60));
  const types = o.types?.length ? o.types : typesProbables(texte);
  const sujet = o.sujet ? o.sujet.toLowerCase() : '';
  const unites = unitesParNumeros([...similarites.keys()]);
  const maintenant = Date.now();
  // Une recherche MENÉE DEPUIS UN PROJET ne remonte pas les compétences propres
  // aux autres ; l'écran (« tous ») ou une portée choisie voient tout.
  const projet = o.projectId && !o.tous && !o.portees?.length ? nomDuProjet(o.projectId) : undefined;
  return [...unites.values()]
    .filter((u) => !sujet || u.sujets.includes(sujet))
    .filter((u) => !projet || !competenceDUnAutreProjet(u, projet))
    .map((u) => ({
      unite: u,
      score: scoreDUnite({
        similarite: similarites.get(u.num) ?? 0,
        importance: u.importance,
        type: u.type,
        typesVises: types,
        modifieLe: u.modifieLe,
        liens: u.liens.length + (u.supersedes ? 1 : 0),
        maintenant,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map(({ unite, score }) => {
      const { num: _num, ...propre } = unite as Unite & { num: number };
      void _num;
      return { unite: propre, score };
    });
}

/** Chercher par les MOTS seulement : synchrone, pour les chemins qui ne peuvent pas attendre. */
export function chercherUnites(texte: string, o: OptionsDeRecherche = {}): UniteTrouvee[] {
  if (!texte.trim()) return [];
  const { nums } = classerParLesMots(texte, o);
  return ponderer(texte, o, new Map(nums.map((n, i) => [n, similariteDuRang(i, nums.length)])));
}

/**
 * Le plancher de cosinus en dessous duquel une unité n'est même pas candidate
 * au classement par le sens : un modèle e5 donne des cosinus compressés (0,7 à
 * 0,95 même entre textes sans rapport), donc une VALEUR absolue ne sépare pas
 * le pertinent du bruit. Mesuré sur des cas réels : une unité effectivement
 * visée par une demande reformulée tombe entre 0,84 et 0,90 ; 0,80 écarte le
 * bruit sans jamais couper une bonne réponse observée.
 */
const PLANCHER_COSINUS_SENS = 0.8;
/** Combien de candidats du sens (les plus proches par cosinus) entrent en lice, au maximum. */
const MAX_CANDIDATS_SENS = 60;

/** Chercher par les MOTS et par le SENS, puis pondérer (similarité 45 %, importance 20 %, type 15 %, fraîcheur 10 %, liens 10 %). */
export async function chercherUnitesMelees(texte: string, o: OptionsDeRecherche = {}): Promise<UniteTrouvee[]> {
  if (!texte.trim()) return [];
  const { nums } = classerParLesMots(texte, o);
  const similarites = new Map(nums.map((n, i) => [n, similariteDuRang(i, nums.length)]));
  const memoire = vectoriseurDisponible() ? vecteursDesUnites() : [];
  if (memoire.length) {
    try {
      const [demande] = await vectoriser([demandeAVectoriser(texte)], 6_000);
      const portees = porteesVisees(o);
      const candidats = memoire
        .filter((v) => (!portees || portees.includes(v.portee)) && (o.deprecies || v.statut === 'active'))
        .map((v) => ({ num: v.num, cos: cosinus(demande, v.vecteur) }))
        .filter((c) => c.cos >= PLANCHER_COSINUS_SENS)
        .sort((a, b) => b.cos - a.cos)
        .slice(0, MAX_CANDIDATS_SENS);
      // L'écart entre le meilleur cosinus de CETTE demande et le plancher sert d'échelle : un modèle
      // e5 comprime ses cosinus (0,80 à 0,90 pour une demande, 0,80 à 0,95 pour une autre), donc une
      // échelle FIXE écraserait tantôt tout à 0, tantôt tout à 1. L'échelle s'adapte à chaque demande.
      const etendue = Math.max(0.02, (candidats[0]?.cos ?? PLANCHER_COSINUS_SENS) - PLANCHER_COSINUS_SENS);
      candidats.forEach(({ num, cos }) => {
        const sens = Math.max(0, Math.min(1, (cos - PLANCHER_COSINUS_SENS) / etendue));
        const mots = similarites.get(num) ?? 0;
        similarites.set(num, Math.max(mots, 0.5 * mots + 0.5 * sens, sens * 0.85));
      });
    } catch (err) {
      log.warn(`base de connaissances : recherche par les mots seuls (${(err as Error).message})`);
    }
  }
  return ponderer(texte, o, similarites);
}

/* Les vecteurs des unités. */

interface VecteurDUnite {
  num: number;
  id: string;
  portee: string;
  type: string;
  statut: string;
  vecteur: Float32Array;
}

let cacheDesVecteurs: VecteurDUnite[] | null = null;

/**
 * ÉLARGI au-delà du titre et du résumé : le détail utile (sections « Non
 * renseigné » écartées, gabarit retiré) porte souvent le vocabulaire qui
 * rapproche une demande formulée autrement — un symptôme, un nom de fichier,
 * une conséquence — du fait qui y répond.
 */
function texteDUniteAVectoriser(u: { titre: string; resume: string; detail?: string }): string {
  const detail = u.detail
    ? detailSansSectionsVides(u.detail)
        .replace(/^### /gm, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return `passage: ${u.titre}. ${u.resume}${detail ? ` ${detail}` : ''}`.slice(0, 3000);
}

function empreinteDuTexte(texte: string): string {
  return crypto.createHash('sha1').update(`${MODELE_VECTEURS}\n${texte}`).digest('hex');
}

function versVecteur(buf: Buffer): Float32Array {
  const copie = new Uint8Array(buf.length);
  copie.set(buf);
  return new Float32Array(copie.buffer);
}

function vecteursDesUnites(): VecteurDUnite[] {
  if (cacheDesVecteurs) return cacheDesVecteurs;
  try {
    const lignes = getDb()
      .prepare(
        `SELECT c.num, c.id, c.portee, c.type, c.statut, v.vecteur FROM connaissances c
           JOIN connaissance_vecteurs v ON v.num = c.num AND v.modele = ?`,
      )
      .all(MODELE_VECTEURS) as { num: number; id: string; portee: string; type: string; statut: string; vecteur: Buffer }[];
    cacheDesVecteurs = lignes.filter((l) => l.vecteur.length === DIMENSIONS_VECTEURS * 4).map((l) => ({ ...l, vecteur: versVecteur(l.vecteur) }));
  } catch {
    cacheDesVecteurs = [];
  }
  return cacheDesVecteurs;
}

let calculEnCours: Promise<number> | null = null;

/** Calcule les vecteurs des unités qui n'en ont pas, ou dont le texte a changé. Un seul calcul à la fois. */
export function completerLesVecteurs(): Promise<number> {
  if (calculEnCours) return calculEnCours;
  if (!vectoriseurDisponible()) return Promise.resolve(0);
  calculEnCours = (async () => {
    const lignes = getDb()
      .prepare('SELECT c.num, c.titre, c.resume, c.detail, v.empreinte FROM connaissances c LEFT JOIN connaissance_vecteurs v ON v.num = c.num')
      .all() as { num: number; titre: string; resume: string; detail: string; empreinte: string | null }[];
    const manquants = lignes
      .map((l) => ({ num: l.num, texte: texteDUniteAVectoriser(l), avant: l.empreinte }))
      .map((l) => ({ ...l, empreinte: empreinteDuTexte(l.texte) }))
      .filter((l) => l.empreinte !== l.avant);
    const poser = getDb().prepare(
      `INSERT INTO connaissance_vecteurs (num, empreinte, modele, vecteur, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(num) DO UPDATE SET empreinte = excluded.empreinte, modele = excluded.modele, vecteur = excluded.vecteur, at = excluded.at`,
    );
    let faits = 0;
    for (let i = 0; i < manquants.length; i += 16) {
      const lot = manquants.slice(i, i + 16);
      const vecteurs = await vectoriser(lot.map((x) => x.texte));
      getDb().transaction(() => lot.forEach((x, j) => poser.run(x.num, x.empreinte, MODELE_VECTEURS, Buffer.from(vecteurs[j].buffer), Date.now())))();
      faits += lot.length;
    }
    cacheDesVecteurs = null;
    if (faits) log.info(`base de connaissances : ${faits} unité(s) vectorisée(s)`);
    return faits;
  })()
    .catch((err) => {
      log.warn(`base de connaissances : vecteurs interrompus (${(err as Error).message})`);
      return 0;
    })
    .finally(() => {
      calculEnCours = null;
    });
  return calculEnCours;
}

let minuteurDesVecteurs: NodeJS.Timeout | null = null;
function planifierLesVecteurs(delaiMs = 60_000): void {
  if (!vectoriseurDisponible()) return;
  if (minuteurDesVecteurs) clearTimeout(minuteurDesVecteurs);
  minuteurDesVecteurs = setTimeout(() => void completerLesVecteurs(), delaiMs);
  minuteurDesVecteurs.unref();
}

/* ------------------------------------------------------------------ */
/* L'accueil, les pistes et la reprise                                  */
/* ------------------------------------------------------------------ */

/**
 * CE QUE CHAQUE COMPRÉHENSION LIT D'OFFICE : 00_project, « À ne jamais
 * supposer », les unités P0 et P1 du projet (et les P0 du global), le changelog
 * récent. Vide tant que la base ne sait rien du projet.
 */
export function accueilDesConnaissances(projectId: string, nomDuProjet: string): string {
  try {
    const projet = unitesDeLaPortee(projectId);
    const global = unitesDeLaPortee(PORTEE_GLOBALE);
    const changelog = entreesDuChangelog(projectId, 20);
    if (!projet.length && !global.length && !changelog.length) return '';
    const tete = projet.filter((u) => u.type === 'project');
    const jamais = [...projet, ...global].filter((u) => u.jamaisSupposer && u.type !== 'project');
    const dejaDits = new Set([...tete, ...jamais].map((u) => u.id));
    const vitales = [
      ...projet.filter((u) => (u.importance === 'P0' || u.importance === 'P1') && !dejaDits.has(u.id)),
      ...global.filter((u) => u.importance === 'P0' && !dejaDits.has(u.id)),
    ];
    return texteDAccueilConnaissances({ nomDuProjet, tete, jamaisSupposer: jamais, vitales, changelog, totalUnites: projet.length + global.length });
  } catch (err) {
    log.warn(`base de connaissances : accueil sauté (${(err as Error).message})`);
    return '';
  }
}

/** Au-dessus de la tête et des P0/P1, ce que la recherche rattache au travail de la carte : des identifiants, jamais un corps. */
export async function pistesDesConnaissances(projectId: string | null, travail: string): Promise<UniteTrouvee[]> {
  if (!travail.trim()) return [];
  const { meilleurScore } = classerParLesMots(travail, { projectId });
  if (scoreParMot(meilleurScore, travail) < SEUIL_DES_PISTES) return [];
  return (await chercherUnitesMelees(travail, { projectId, limite: PISTES_MAX + 3 })).filter((t) => t.unite.importance === 'P2' || t.unite.importance === 'P3').slice(0, PISTES_MAX);
}

export function pistesParLesMots(projectId: string | null, travail: string): UniteTrouvee[] {
  if (!travail.trim()) return [];
  const { meilleurScore } = classerParLesMots(travail, { projectId });
  if (scoreParMot(meilleurScore, travail) < SEUIL_DES_PISTES) return [];
  return chercherUnites(travail, { projectId, limite: PISTES_MAX });
}

export function texteDesPistes(pistes: readonly UniteTrouvee[]): string {
  if (!pistes.length) return '';
  return [
    'PISTES DE LA BASE DE CONNAISSANCES — d’autres unités qui semblent parler de ce travail. Ouvre celle qui te sert avec l’outil « memoire » (geste « lire », « id »).',
    ...pistes.map((p) => `- ${p.unite.id} (${p.unite.type}, ${p.unite.importance}) ${p.unite.titre}`),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Ce qu'un agent a lu                                                  */
/* ------------------------------------------------------------------ */

/**
 * NOTE UNE OUVERTURE. C'est LE relevé de ce qu'un agent a lu : il sert le
 * rappel « déjà dans ton contexte » (`lusDansLaSession`), le contexte de départ
 * de l'exécution (`lecturesDeLaCarte`) ET le bloc « mémoire » du fil de la
 * carte (`carnetDesLectures`) — jamais un second enregistrement à côté.
 * `etape` : l'étape du parcours où la lecture a lieu (`etapeDeLaMemoire`).
 */
export function noterUneLecture(cle: string, agentId?: string, cardId?: string, etape?: EtapeDuParcours): void {
  if (!agentId) return;
  getDb()
    .prepare(
      `INSERT INTO connaissance_lectures (agent_id, cle, card_id, en_contexte, at, etape) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(agent_id, cle) DO UPDATE SET en_contexte = 1, at = excluded.at, card_id = COALESCE(excluded.card_id, connaissance_lectures.card_id), etape = COALESCE(excluded.etape, connaissance_lectures.etape)`,
    )
    .run(agentId, cle, cardId ?? null, Date.now(), etape ?? null);
}

export function lusDansLaSession(agentId: string): Set<string> {
  try {
    return new Set((getDb().prepare('SELECT cle FROM connaissance_lectures WHERE agent_id = ? AND en_contexte = 1').all(agentId) as { cle: string }[]).map((l) => l.cle));
  } catch {
    return new Set();
  }
}

/** Session neuve : l'agent repart d'un contexte vide, plus rien de ce qui lui a été servi n'y est. */
export function oublierLesLectures(agentId: string): void {
  try {
    getDb().prepare('UPDATE connaissance_lectures SET en_contexte = 0 WHERE agent_id = ?').run(agentId);
  } catch {
    /* base partielle d'un contrôle : rien à oublier */
  }
}

/** Ce qui a été LU pendant le travail d'une carte : identifiants et titres, pour le contexte de départ. */
export function lecturesDeLaCarte(cardId: string): string[] {
  try {
    return (getDb().prepare('SELECT cle FROM connaissance_lectures WHERE card_id = ? ORDER BY at').all(cardId) as { cle: string }[])
      .map(({ cle }) => {
        const u = lireUnite(cle);
        return u ? `${u.id} « ${u.titre} »` : cle.startsWith('fiche:') ? `fiche ${cle.slice(6)}` : '';
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

interface LectureSql {
  agent_id: string;
  cle: string;
  card_id: string;
  en_contexte: number;
  at: number;
  etape: string | null;
  role: string | null;
}

const LECTURES_EN_LIGNES = `SELECT l.agent_id, l.cle, l.card_id, l.en_contexte, l.at, l.etape, a.role
  FROM connaissance_lectures l LEFT JOIN agents a ON a.id = l.agent_id`;

function versLigneDuCarnet(lecture: LectureSql): LigneDuCarnet {
  const unite = estIdentifiantDUnite(lecture.cle) ? lireUnite(lecture.cle) : null;
  return ligneDUneLecture({
    agentId: lecture.agent_id,
    cle: lecture.cle,
    cardId: lecture.card_id,
    at: lecture.at,
    enContexte: lecture.en_contexte === 1,
    etape: lecture.etape,
    roleAgent: lecture.role ?? undefined,
    titre: unite?.titre,
    globale: unite?.portee === PORTEE_GLOBALE,
  });
}

/**
 * LE CARNET D'UNE CARTE, LU DANS LE RELEVÉ VIVANT : une ligne par unité, fiche
 * ou changelog ouvert pendant son travail, dans l'ordre des lectures.
 * `nouveauDepart` rend l'instant du dernier « repartir de zéro » d'un agent : ce
 * qu'il avait ouvert AVANT ne s'affiche plus (le relevé, lui, n'est pas effacé).
 */
export function carnetDesLectures(cardId: string, nouveauDepart: (agentId: string) => number = () => 0): LigneDuCarnet[] {
  if (!cardId) return [];
  try {
    const lectures = getDb().prepare(`${LECTURES_EN_LIGNES} WHERE l.card_id = ? ORDER BY l.at ASC`).all(cardId) as LectureSql[];
    return lectures.filter((l) => l.at >= nouveauDepart(l.agent_id)).map(versLigneDuCarnet);
  } catch {
    return [];
  }
}

/** La ligne d'UNE lecture qui vient d'être notée, pour la diffuser en direct (`carnet.lignes`). */
export function ligneDeLaLecture(agentId: string, cle: string): LigneDuCarnet | null {
  try {
    const lecture = getDb().prepare(`${LECTURES_EN_LIGNES} WHERE l.agent_id = ? AND l.cle = ?`).get(agentId, cle) as LectureSql | undefined;
    return lecture?.card_id ? versLigneDuCarnet(lecture) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Le changelog                                                         */
/* ------------------------------------------------------------------ */

interface LigneEntree {
  id: number;
  project_id: string;
  jour: string;
  categorie: string;
  texte: string;
  branche: string | null;
  commits: string;
  cartes: string;
  unites: string;
  publication: string | null;
  source: string;
  at: number;
  titre?: string | null;
  explication?: string | null;
  poids?: string | null;
  masquee?: number;
  corrigee?: number;
}

function versEntree(l: LigneEntree): EntreeDuChangelog {
  return {
    id: l.id,
    projectId: l.project_id,
    jour: l.jour,
    categorie: l.categorie as CategorieChangelog,
    texte: l.texte,
    branche: l.branche,
    commits: json<string[]>(l.commits, []),
    cartes: json<string[]>(l.cartes, []),
    unites: json<string[]>(l.unites, []),
    publication: l.publication,
    source: l.source as GenreEntreeChangelog,
    at: l.at,
    titre: l.titre ?? null,
    explication: l.explication ?? null,
    poids: poidsValide(l.poids) ? l.poids : null,
    corrigee: Boolean(l.corrigee),
  };
}

/**
 * LA CARTE D'ORIGINE DE CHAQUE ENTRÉE, pour l'ouvrir d'un clic : la carte nommée
 * par l'entrée, sinon celle dont la branche (ou son archive) a été fusionnée.
 * Une carte effacée depuis ne se propose pas.
 */
export function lierLesCartes(projectId: string, entrees: readonly EntreeDuChangelog[]): EntreeDuChangelog[] {
  try {
    const db = getDb();
    const parId = db.prepare('SELECT id, title FROM cards WHERE id = ?');
    const parBranche = db.prepare("SELECT id, title FROM cards WHERE project_id = ? AND json_extract(data, '$.github.branch') IN (?, ?) ORDER BY updated_at DESC LIMIT 1");
    return entrees.map((e) => {
      let carte: { id: string; title: string } | undefined;
      for (const id of e.cartes) if (!carte) carte = parId.get(id) as typeof carte;
      if (!carte && e.branche) carte = parBranche.get(projectId, e.branche, `archive/${e.branche}`) as typeof carte;
      return { ...e, carte: carte ? { id: carte.id, titre: carte.title } : null };
    });
  } catch {
    return [...entrees];
  }
}

/**
 * CORRIGER UNE ENTRÉE À LA MAIN, depuis l'écran. Le titre est obligatoire,
 * l'explication facultative ; l'entrée est marquée `corrigee` et plus aucune
 * rédaction automatique ne la réécrit.
 */
export function corrigerEntreeDuChangelog(
  projectId: string,
  id: number,
  c: { titre: string; explication?: string | null; poids: string },
): { ok: true; entree: EntreeDuChangelog } | { ok: false; raison: string } {
  const titre = c.titre.replace(/\s+/g, ' ').trim();
  const explication = (c.explication ?? '').trim();
  if (!titre) return { ok: false, raison: 'Le titre est vide.' };
  if (titre.length > TITRE_CHANGELOG_MAX) return { ok: false, raison: `Le titre dépasse ${TITRE_CHANGELOG_MAX} signes.` };
  if (explication.length > EXPLICATION_CHANGELOG_MAX) return { ok: false, raison: `L’explication dépasse ${EXPLICATION_CHANGELOG_MAX} signes.` };
  if (!poidsValide(c.poids)) return { ok: false, raison: 'Poids inconnu.' };
  const db = getDb();
  const n = db
    .prepare('UPDATE changelog_entrees SET titre = ?, explication = ?, poids = ?, categorie = ?, corrigee = 1 WHERE id = ? AND project_id = ?')
    .run(titre, explication || null, c.poids, categorieDuPoids(c.poids), id, projectId).changes;
  if (!n) return { ok: false, raison: 'Entrée introuvable.' };
  planifierLeRendu(projectId);
  const [entree] = lierLesCartes(projectId, [versEntree(db.prepare('SELECT * FROM changelog_entrees WHERE id = ?').get(id) as LigneEntree)]);
  return { ok: true, entree };
}

/** Les entrées visibles : un doublon fusionné par la reprise (`masquee`) reste en base, jamais à l'écran. */
export function entreesDuChangelog(projectId: string, limite?: number): EntreeDuChangelog[] {
  try {
    const lignes = getDb()
      .prepare(`SELECT * FROM changelog_entrees WHERE project_id = ? AND masquee = 0 ORDER BY jour DESC, at DESC, id DESC${limite ? ' LIMIT ?' : ''}`)
      .all(...(limite ? [projectId, limite] : [projectId])) as LigneEntree[];
    return lignes.map(versEntree);
  } catch {
    return [];
  }
}

/**
 * UNE ENTRÉE DE CHANGELOG. Une carte n'a qu'UNE entrée : l'entrée RÉDIGÉE par
 * son agent (titre, explication, poids) remplace celle que la clôture pose
 * d'elle-même, et la clôture ne redit jamais une entrée déjà rédigée. Un agent
 * qui n'envoie qu'une ligne est refusé : `jugerRedactionChangelog` dit quoi
 * ajouter. La clôture, elle, peut poser la ligne nue (le titre de la carte) —
 * la rédaction de repli la complète ensuite.
 */
export function ajouterAuChangelog(e: {
  projectId: string;
  texte?: string;
  titre?: string;
  explication?: string;
  poids?: string;
  branche?: string | null;
  cardId?: string;
  categorie?: CategorieChangelog;
  commits?: string[];
  unites?: string[];
  source: GenreEntreeChangelog;
  jour?: string;
}): { ok: true; ajoutee: boolean } | { ok: false; raison: string } {
  const redigee = Boolean(e.titre || e.explication || e.poids) || e.source === 'agent';
  const redaction = redigee ? jugerRedactionChangelog(e) : null;
  if (redaction && !redaction.ok) return redaction;
  const juge = jugerEntreeChangelog({ texte: e.texte || (redaction?.ok ? redaction.titre : '') });
  if (!juge.ok) return juge;
  const r3 = redaction?.ok ? redaction : null;
  const categorie = e.categorie ?? (r3 ? categorieDuPoids(r3.poids) : categorieDuTexte(juge.texte));
  const db = getDb();
  const maintenant = Date.now();
  const jour = e.jour ?? new Date(maintenant).toISOString().slice(0, 10);
  if (e.cardId) {
    const deLaCarte = db
      .prepare("SELECT * FROM changelog_entrees WHERE project_id = ? AND EXISTS (SELECT 1 FROM json_each(changelog_entrees.cartes) WHERE value = ?) ORDER BY at DESC LIMIT 1")
      .get(e.projectId, e.cardId) as LigneEntree | undefined;
    if (deLaCarte) {
      // Rien de neuf à dire, ou une rédaction de repli sur une entrée que l'agent a déjà rédigée : l'entrée reste.
      // Une entrée corrigée à la main n'est plus jamais réécrite.
      if (!r3 || deLaCarte.corrigee || (e.source === 'carte' && deLaCarte.explication)) return { ok: true, ajoutee: false };
      const texte = e.source === 'carte' ? deLaCarte.texte : juge.texte;
      db.prepare('UPDATE changelog_entrees SET texte = ?, categorie = ?, empreinte = ?, source = ?, unites = ?, titre = ?, explication = ?, poids = ?, masquee = 0 WHERE id = ?').run(
        texte,
        categorie,
        empreinteDEntree({ jour: deLaCarte.jour, texte }),
        e.source === 'carte' ? deLaCarte.source : e.source,
        JSON.stringify([...new Set([...json<string[]>(deLaCarte.unites, []), ...(e.unites ?? [])])]),
        r3.titre,
        r3.explication,
        r3.poids,
        deLaCarte.id,
      );
      planifierLeRendu(e.projectId);
      annoncerLaLivraison(e.projectId, r3, `carte:${e.cardId}`);
      return { ok: true, ajoutee: false };
    }
  }
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO changelog_entrees (project_id, jour, categorie, texte, branche, commits, cartes, unites, publication, source, empreinte, at, titre, explication, poids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.projectId,
      jour,
      categorie,
      juge.texte,
      e.branche ?? null,
      JSON.stringify(e.commits ?? []),
      JSON.stringify(e.cardId ? [e.cardId] : []),
      JSON.stringify(e.unites ?? []),
      e.source,
      empreinteDEntree({ jour, texte: juge.texte }),
      maintenant,
      r3?.titre ?? null,
      r3?.explication ?? null,
      r3?.poids ?? null,
    );
  planifierLeRendu(e.projectId);
  if (r3) annoncerLaLivraison(e.projectId, r3, e.cardId ? `carte:${e.cardId}` : empreinteDEntree({ jour, texte: juge.texte }));
  return { ok: true, ajoutee: r.changes > 0 };
}

/**
 * UNE LIVRAISON RÉDIGÉE PROPOSE SON ANNONCE à l'atelier marketing du projet
 * (`proposerAnnonceDeLivraison`), en brouillon, une seule fois par entrée. Ni
 * attendue ni bloquante : une panne ici ne touche jamais le changelog.
 */
function annoncerLaLivraison(projectId: string, r: { titre: string; explication: string | null; poids: string }, ref: string): void {
  void import('./marketing.js')
    .then(({ proposerAnnonceDeLivraison }) => proposerAnnonceDeLivraison({ projectId, titre: r.titre, explication: r.explication, poids: r.poids, ref }))
    .catch(() => undefined);
}

/** L'entrée d'une carte a-t-elle déjà son explication ? (La rédaction de repli ne repaie pas un modèle pour rien.) */
export function entreeDeCarteRedigee(projectId: string, cardId: string): boolean {
  try {
    const l = getDb()
      .prepare("SELECT explication FROM changelog_entrees WHERE project_id = ? AND EXISTS (SELECT 1 FROM json_each(changelog_entrees.cartes) WHERE value = ?) ORDER BY at DESC LIMIT 1")
      .get(projectId, cardId) as { explication: string | null } | undefined;
    return Boolean(l?.explication);
  } catch {
    return false;
  }
}

export interface ReecritureDEntree {
  /** L'empreinte de l'entrée visée (unique par projet). */
  empreinte: string;
  titre: string;
  explication?: string | null;
  poids: string;
  /** Les empreintes des entrées du même jour qui disaient la même chose : masquées, jamais effacées. */
  fusionneAvec?: string[];
}

/**
 * LA REPRISE DU PASSÉ : chaque entrée reçoit son titre, son explication et son
 * poids, jugés en mode souple (on ne retrouve parfois qu'un titre). Les doublons
 * fusionnés sont MASQUÉS : la ligne d'origine reste consultable en base. Rejouée,
 * la reprise réécrit à l'identique.
 */
export function reecrireLeChangelog(projectId: string, reecritures: readonly ReecritureDEntree[]): { reecrites: number; fusionnees: number; refusees: number } {
  const db = getDb();
  // Une entrée corrigée à la main n'est ni réécrite ni masquée.
  const ecrire = db.prepare('UPDATE changelog_entrees SET titre = ?, explication = ?, poids = ?, categorie = ?, masquee = 0 WHERE project_id = ? AND empreinte = ? AND corrigee = 0');
  const masquer = db.prepare('UPDATE changelog_entrees SET masquee = 1 WHERE project_id = ? AND empreinte = ? AND corrigee = 0');
  const lire = db.prepare('SELECT id, branche, commits, cartes FROM changelog_entrees WHERE project_id = ? AND empreinte = ?');
  const completer = db.prepare('UPDATE changelog_entrees SET branche = ?, commits = ?, cartes = ? WHERE id = ?');
  const unir = (a: string, b: string) => JSON.stringify([...new Set([...json<string[]>(a, []), ...json<string[]>(b, [])])]);
  const bilan = { reecrites: 0, fusionnees: 0, refusees: 0 };
  db.transaction(() => {
    for (const r of reecritures) {
      const juge = jugerRedactionChangelog(r, { souple: true });
      if (!juge.ok) {
        bilan.refusees++;
        continue;
      }
      const n = ecrire.run(juge.titre, juge.explication, juge.poids, categorieDuPoids(juge.poids), projectId, r.empreinte).changes;
      if (!n) continue;
      bilan.reecrites++;
      for (const autre of r.fusionneAvec ?? []) {
        if (autre === r.empreinte || !masquer.run(projectId, autre).changes) continue;
        bilan.fusionnees++;
        // Le doublon masqué lègue sa branche, ses commits et ses cartes à l'entrée gardée : ni le lien vers la carte ni la trace de la fusion ne se perdent.
        type Refs = { id: number; branche: string | null; commits: string; cartes: string };
        const garde = lire.get(projectId, r.empreinte) as Refs | undefined;
        const masque = lire.get(projectId, autre) as Refs | undefined;
        if (garde && masque) completer.run(garde.branche ?? masque.branche, unir(garde.commits, masque.commits), unir(garde.cartes, masque.cartes), garde.id);
      }
    }
  })();
  if (bilan.reecrites) planifierLeRendu(projectId);
  return bilan;
}

/** La publication marque les entrées d'une carte (ou toutes celles pas encore publiées du projet). */
export function marquerLaPublication(projectId: string, etiquette: string, cardId?: string): number {
  const db = getDb();
  const r = cardId
    ? db
        .prepare('UPDATE changelog_entrees SET publication = ? WHERE project_id = ? AND publication IS NULL AND EXISTS (SELECT 1 FROM json_each(changelog_entrees.cartes) WHERE value = ?)')
        .run(etiquette, projectId, cardId)
    : db.prepare('UPDATE changelog_entrees SET publication = ? WHERE project_id = ? AND publication IS NULL').run(etiquette, projectId);
  if (r.changes) planifierLeRendu(projectId);
  return r.changes;
}

/** Les entrées reconstruites (git, historique, cartes) rejoignent la base, sans doublon. */
export function importerLeChangelog(projectId: string, entrees: readonly EntreeDuChangelog[]): { ajoutees: number; dejaLa: number } {
  const db = getDb();
  const poser = db.prepare(
    `INSERT OR IGNORE INTO changelog_entrees (project_id, jour, categorie, texte, branche, commits, cartes, unites, publication, source, empreinte, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let ajoutees = 0;
  db.transaction(() => {
    for (const e of entrees) {
      const juge = jugerEntreeChangelog(e);
      if (!juge.ok || !/^\d{4}-\d{2}-\d{2}$/.test(e.jour)) continue;
      ajoutees += poser.run(
        projectId,
        e.jour,
        e.categorie,
        juge.texte,
        e.branche,
        JSON.stringify(e.commits ?? []),
        JSON.stringify(e.cartes ?? []),
        JSON.stringify(e.unites ?? []),
        e.publication,
        e.source,
        empreinteDEntree({ jour: e.jour, texte: juge.texte }),
        e.at,
      ).changes;
    }
  })();
  planifierLeRendu(projectId);
  return { ajoutees, dejaLa: entrees.length - ajoutees };
}

/* ------------------------------------------------------------------ */
/* Working : le brouillon d'une carte                                   */
/* ------------------------------------------------------------------ */

export function noterAuBrouillon(n: { cardId: string; projectId: string; agentId?: string; texte: string }): { ok: true; nombre: number } | { ok: false; raison: string } {
  const texte = String(n.texte ?? '').trim();
  if (!texte) return { ok: false, raison: 'Le brouillon est vide.' };
  if (texte.length > 4000) return { ok: false, raison: 'Un brouillon tient en 4 000 signes : garde l’essentiel.' };
  const db = getDb();
  db.prepare('INSERT INTO working_notes (card_id, project_id, agent_id, texte, at) VALUES (?, ?, ?, ?, ?)').run(n.cardId, n.projectId, n.agentId ?? null, texte, Date.now());
  return { ok: true, nombre: (db.prepare('SELECT COUNT(*) AS n FROM working_notes WHERE card_id = ?').get(n.cardId) as { n: number }).n };
}

/** La carte se ferme : son brouillon disparaît. Ce qui méritait de durer a dû être promu. */
export function purgerLeBrouillon(cardId: string): number {
  try {
    return getDb().prepare('DELETE FROM working_notes WHERE card_id = ?').run(cardId).changes;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Les lots de la génération                                            */
/* ------------------------------------------------------------------ */

export interface RapportDImport {
  portee: string;
  nom: string;
  propositions: number;
  creees: number;
  fusionnees: number;
  dejaLa: number;
  refusees: { titre: string; raisons: string[] }[];
  changelog: { ajoutees: number; dejaLa: number };
  /** La reprise du passé (`scripts/reecrire-changelog.mjs`) : entrées réécrites, doublons masqués, refus. */
  reecritures?: { reecrites: number; fusionnees: number; refusees: number };
  generation: unknown;
  at: number;
}

export function dossierDesLots(): string {
  return path.join(CONFIG.dataDir, 'connaissances', 'lots');
}

const CLE_LOTS_IMPORTES = 'connaissances.lots-importes';

/**
 * IMPORTER LES LOTS DE LA GÉNÉRATION par la porte d'écriture. Un lot déjà
 * importé à l'identique est sauté ; rejoué quand même (`force`), le
 * dédoublonnage le rend inoffensif.
 */
export function importerLesLots(options: { dossier?: string; portee?: string; force?: boolean } = {}): RapportDImport[] {
  const dossier = options.dossier ?? dossierDesLots();
  if (!fs.existsSync(dossier)) return [];
  const deja = json<Record<string, string>>(getMeta(CLE_LOTS_IMPORTES), {});
  const projets = new Set((getDb().prepare('SELECT id FROM projects').all() as { id: string }[]).map((l) => l.id));
  const rapports: RapportDImport[] = [];
  const fichiers = fs
    .readdirSync(dossier)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => (a === `${PORTEE_GLOBALE}.json` ? -1 : b === `${PORTEE_GLOBALE}.json` ? 1 : a.localeCompare(b)));
  for (const fichier of fichiers) {
    const brut = fs.readFileSync(path.join(dossier, fichier), 'utf8');
    const empreinte = crypto.createHash('sha1').update(brut).digest('hex');
    const lot = json<{ portee?: string; nom?: string; propositions?: PropositionUnite[]; changelog?: EntreeDuChangelog[]; reecritures?: ReecritureDEntree[]; rapport?: unknown }>(brut, {});
    const portee = String(lot.portee ?? '');
    if (!portee || (options.portee && portee !== options.portee)) continue;
    if (portee !== PORTEE_GLOBALE && !projets.has(portee)) {
      log.warn(`base de connaissances : lot ${fichier} ignoré, projet inconnu`);
      continue;
    }
    // Une reprise du changelog lue par un démon d'avant (qui ne connaissait pas `reecritures`) a pu marquer le fichier : sa réécriture a sa propre marque.
    const cleReecritures = `${fichier}#reecritures`;
    if (!options.force && deja[fichier] === empreinte && (!lot.reecritures?.length || deja[cleReecritures] === empreinte)) continue;
    const rapport: RapportDImport = {
      portee,
      nom: lot.nom ?? nomDeLaPortee(portee),
      propositions: lot.propositions?.length ?? 0,
      creees: 0,
      fusionnees: 0,
      dejaLa: 0,
      refusees: [],
      changelog: { ajoutees: 0, dejaLa: 0 },
      generation: lot.rapport ?? null,
      at: Date.now(),
    };
    for (const p of lot.propositions ?? []) {
      const r = proposerUnite(portee, { ...p, action: 'create', id: undefined, remplace: undefined }, { auteur: 'generation', motif: 'génération' });
      if (!r.ok) rapport.refusees.push({ titre: String(p.titre ?? ''), raisons: r.raisons });
      else if (r.geste === 'cree') rapport.creees++;
      else if (r.geste === 'mis-a-jour') rapport.fusionnees++;
      else rapport.dejaLa++;
    }
    if (portee !== PORTEE_GLOBALE && lot.changelog?.length) rapport.changelog = importerLeChangelog(portee, lot.changelog);
    // Après l'import : une entrée que la reprise réécrit peut venir du même lot.
    if (portee !== PORTEE_GLOBALE && lot.reecritures?.length) {
      rapport.reecritures = reecrireLeChangelog(portee, lot.reecritures);
      deja[cleReecritures] = empreinte;
    }
    getDb().prepare('INSERT INTO connaissance_generations (portee, rapport, at) VALUES (?, ?, ?)').run(portee, JSON.stringify(rapport), rapport.at);
    deja[fichier] = empreinte;
    setMeta(CLE_LOTS_IMPORTES, JSON.stringify(deja));
    rendreLesFichiers(portee);
    rapports.push(rapport);
    log.info(
      `base de connaissances : lot ${rapport.nom} — ${rapport.creees} créée(s), ${rapport.fusionnees} fusionnée(s), ${rapport.dejaLa} déjà là, ` +
        `${rapport.refusees.length} refusée(s), changelog +${rapport.changelog.ajoutees}`,
    );
  }
  if (rapports.length) void completerLesVecteurs();
  return rapports;
}

export function dernierRapportDeGeneration(portee: string): RapportDImport | null {
  try {
    const l = getDb().prepare('SELECT rapport FROM connaissance_generations WHERE portee = ? ORDER BY at DESC LIMIT 1').get(portee) as { rapport: string } | undefined;
    return l ? json<RapportDImport | null>(l.rapport, null) : null;
  } catch {
    return null;
  }
}

/** Toutes les portées qui ont quelque chose en base : unités ou changelog. */
export function porteesConnues(): string[] {
  try {
    return (getDb().prepare('SELECT portee FROM connaissances UNION SELECT project_id AS portee FROM changelog_entrees').all() as { portee: string }[]).map((l) => l.portee);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Ce que l'outil rend aux agents                                       */
/* ------------------------------------------------------------------ */

/** Au-delà de ce nombre de signes, « lire » une fiche rend son sommaire. */
export const LECTURE_FICHE_MAX = 40_000;

export function rendreUnitesTrouvees(demande: string, trouvees: readonly UniteTrouvee[], lus: ReadonlySet<string> = new Set()): string {
  if (!trouvees.length) {
    return `Aucune unité ne répond à « ${demande} ». Essaie d'autres mots (un nom de fichier, de fonction, un synonyme), un « type », ou lis une fiche numérotée avec « lire » et « fiche ».`;
  }
  const lignes = trouvees.map(({ unite: u }) => {
    const deja = lus.has(u.id) ? ' — déjà lue dans cette session' : '';
    const resume = u.resume.length > 240 ? `${u.resume.slice(0, 239).trim()}…` : u.resume;
    return `- ${u.id} · ${u.type} · ${u.importance}${u.portee === PORTEE_GLOBALE ? ' · global' : ''} · ${u.titre} (fiche ${ficheDeLUnite(u).id})${deja}\n  ${resume}`;
  });
  return `${trouvees.length} unité(s) pour « ${demande} » :\n${lignes.join('\n')}\n\nLis une unité entière avec « lire » et son « id ».`;
}

export function texteDUneUnite(u: Unite): string {
  const versions = versionsDeLUnite(u.id).length;
  const notes = [
    `fiche ${ficheDeLUnite(u).id}${u.portee === PORTEE_GLOBALE ? ' (global)' : ''}`,
    versions ? `${versions} version(s) antérieure(s) gardée(s)` : '',
    u.statut === 'deprecated' ? `DÉPRÉCIÉE${u.supersededBy ? `, remplacée par ${u.supersededBy}` : ''} : ne t'y fie plus` : '',
  ].filter(Boolean);
  return `${rendreUnite(u, 1)}\n\n_${notes.join(' · ')}_`;
}

export function texteDuResultat(r: ResultatDeProposition): string {
  if (!r.ok) return `Proposition refusée :\n- ${r.raisons.join('\n- ')}`;
  const u = r.unite;
  const fiche = ficheDeLUnite(u).id;
  switch (r.geste) {
    case 'cree':
      return `Unité créée : ${u.id} (${u.type}, ${u.importance}) → fiche ${fiche}.${r.remplace ? ` ${r.remplace} est dépréciée et reliée à elle.` : ''}`;
    case 'mis-a-jour':
      return `Unité ${u.id} mise à jour, version ${u.version} (la précédente est gardée)${r.fusionneAvec ? ' : ta proposition doublait cette unité, elle l’a complétée au lieu d’en créer une autre' : ''}.`;
    case 'deja-la':
      return `${u.id} « ${u.titre} » dit déjà cela : rien de redit.`;
    case 'deprecie':
      return `${u.id} est dépréciée (version précédente gardée).`;
  }
}

/** L'unité active qu'un « replaces » désigne : son identifiant, ou le début de son titre ou de sa ligne. */
export function uniteARemplacer(portee: string, debut: string): Unite | null {
  const net = debut.trim();
  if (!net) return null;
  const parId = lireUnite(net);
  if (parId) return parId.portee === portee && parId.statut === 'active' ? parId : null;
  const cle = titreNormalise(net);
  if (!cle) return null;
  return (
    unitesDeLaPortee(portee).find((u) => {
      const titre = titreNormalise(u.titre);
      return titre.startsWith(cle) || cle.startsWith(titre) || titreNormalise(`${u.titre} ${u.resume}`).startsWith(cle) || titreNormalise(u.resume).startsWith(cle);
    }) ?? null
  );
}

export { FICHES_GLOBAL, FICHES_PROJET, ficheDeLUnite };

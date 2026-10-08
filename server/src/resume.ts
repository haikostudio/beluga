import {
  bornesDeLaPeriode,
  joursDeLaPeriode,
  minuitDe,
  sommesParJour,
  type BaseDuResume,
  type ResumeBackups,
  type ResumeCoffre,
  type ResumeDeRubrique,
  type ResumeEnsemble,
  type ResumeMarketing,
  type ResumeMemoire,
  type ResumeMessagerie,
  type ResumeNotes,
  type ResumeStatistiques,
  type ResumeStudio,
  type ResumeSurveillance,
  type ResumeTaches,
  type RubriqueDuResume,
} from '@beluga/shared';
import { getDb } from './db.js';
import { etatDuPoolPourLEcran } from './competences.js';

/**
 * LA PAGE « RÉSUMÉ » — ce que le démon calcule pour chaque rubrique, sur la
 * période demandée (règles pures et formes : `shared/src/resume.ts`).
 *
 * UNE RUBRIQUE, UNE COMMANDE (`stats.resume`), demandée à l'ouverture de la
 * rubrique seulement. Tout se lit en SQL, par des requêtes bornées par la
 * période : plus aucun tour de `listCards` sur tous les projets (l'ancien
 * `stats.dashboard` le faisait à chaque ouverture pour retrouver les titres —
 * la colonne `cards.title` les donne d'une jointure).
 *
 * Les séries par jour se rangent dans le FUSEAU DE RÉFÉRENCE
 * (`sommesParJour`), le même que l'accueil de la messagerie : le serveur tourne
 * en UTC, la personne qui lit est à Zurich.
 *
 * `depuis` dit la plus ancienne donnée gardée : certaines tables sont purgées
 * (contrôles de surveillance, événements de visite à 90 jours), et une période
 * plus longue doit le DIRE plutôt qu'afficher des zéros.
 *
 * LE COFFRE-FORT : seules les colonnes `project_id`, `type` et les trois dates
 * sont lues — jamais `nom`, `champs`, `note` ni `images`. Rien d'une fiche ne
 * peut donc quitter le démon par cette porte.
 */

type Bornes = { debut: number; fin: number };

/** La période remise d'aplomb, et le socle commun de chaque réponse. */
function socle(debutDemande: number | undefined, finDemandee: number | undefined, maintenant: number): BaseDuResume {
  const { debut, fin } = bornesDeLaPeriode(debutDemande, finDemandee, maintenant);
  return { debut, fin, jours: joursDeLaPeriode(debut, fin), depuis: null };
}

/** La plus ancienne valeur d'une colonne de date, ou `null` sur une table vide. */
function plusAncien(table: string, colonne: string): number | null {
  const ligne = getDb().prepare(`SELECT MIN(${colonne}) AS v FROM ${table}`).get() as { v: number | null };
  return typeof ligne.v === 'number' ? ligne.v : null;
}

/** Le nom de chaque projet (archivés compris : une activité passée garde son nom). */
function nomsDesProjets(): Map<string, string> {
  return new Map(
    (getDb().prepare('SELECT id, name FROM projects').all() as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );
}

/** Une case par jour, chaque CLÉ comptée une seule fois par jour (une tâche, un visiteur…). */
function distinctsParJour(points: readonly { at: number; cle: string }[], b: Bornes): number[] {
  const vus = new Set<string>();
  const uniques: { at: number }[] = [];
  for (const point of points) {
    const marque = `${minuitDe(point.at)}|${point.cle}`;
    if (vus.has(marque)) continue;
    vus.add(marque);
    uniques.push({ at: point.at });
  }
  return sommesParJour(uniques, b.debut, b.fin);
}

const dans = (at: number | null | undefined, b: Bornes) => typeof at === 'number' && at >= b.debut && at <= b.fin;

/* ------------------------------------------------------------------ */
/* Vue d'ensemble et tâches                                             */
/* ------------------------------------------------------------------ */

function ensemble(base: BaseDuResume): ResumeEnsemble {
  const db = getDb();
  const projets = db
    .prepare(
      `SELECT u.project_id AS projectId, COALESCE(p.name, MAX(u.project_name)) AS nom,
              COUNT(DISTINCT u.card_id) AS taches, COUNT(*) AS tours,
              SUM(u.seconds) AS secondes, SUM(u.tokens) AS jetons
         FROM usage u LEFT JOIN projects p ON p.id = u.project_id
        WHERE u.created_at BETWEEN ? AND ?
        GROUP BY u.project_id
        ORDER BY SUM(u.seconds) DESC`,
    )
    .all(base.debut, base.fin) as ResumeEnsemble['projets'];
  const points = db
    .prepare('SELECT created_at AS at, seconds AS valeur, card_id AS cle FROM usage WHERE created_at BETWEEN ? AND ?')
    .all(base.debut, base.fin) as { at: number; valeur: number; cle: string | null }[];
  const taches = new Set(points.map((p) => p.cle).filter(Boolean)).size;
  const note = db
    .prepare('SELECT AVG(note) AS n FROM telemetrie_tache WHERE created_at BETWEEN ? AND ?')
    .get(base.debut, base.fin) as { n: number | null };
  return {
    ...base,
    rubrique: 'ensemble',
    depuis: plusAncien('usage', 'created_at'),
    secondes: projets.reduce((t, p) => t + (p.secondes ?? 0), 0),
    taches,
    tours: points.length,
    jetons: projets.reduce((t, p) => t + (p.jetons ?? 0), 0),
    note: typeof note.n === 'number' ? Math.round(note.n) : null,
    parJour: {
      secondes: sommesParJour(points, base.debut, base.fin),
      taches: distinctsParJour(
        points.filter((p) => p.cle).map((p) => ({ at: p.at, cle: p.cle! })),
        base,
      ),
    },
    projets: projets.map((p) => ({
      projectId: p.projectId,
      nom: p.nom ?? null,
      taches: p.taches ?? 0,
      tours: p.tours ?? 0,
      secondes: p.secondes ?? 0,
      jetons: p.jetons ?? 0,
    })),
  };
}

function taches(base: BaseDuResume): ResumeTaches {
  const lignes = getDb()
    .prepare(
      `SELECT u.card_id AS cardId, c.title AS titre, COALESCE(p.name, MAX(u.project_name)) AS projet,
              MAX(u.created_at) AS at, COUNT(*) AS tours, SUM(u.seconds) AS secondes,
              SUM(u.input_tokens) AS entree, SUM(u.output_tokens) AS sortie, SUM(u.tokens) AS jetons,
              MAX(u.engine) AS moteur
         FROM usage u
         LEFT JOIN cards c ON c.id = u.card_id
         LEFT JOIN projects p ON p.id = u.project_id
        WHERE u.card_id IS NOT NULL AND u.created_at BETWEEN ? AND ?
        GROUP BY u.card_id
        ORDER BY at DESC`,
    )
    .all(base.debut, base.fin) as ResumeTaches['lignes'];
  return {
    ...base,
    rubrique: 'taches',
    depuis: plusAncien('usage', 'created_at'),
    lignes: lignes.map((l) => ({
      ...l,
      titre: l.titre ?? null,
      projet: l.projet ?? null,
      secondes: l.secondes ?? 0,
      entree: l.entree ?? 0,
      sortie: l.sortie ?? 0,
      jetons: l.jetons ?? 0,
      moteur: l.moteur ?? null,
    })),
  };
}

/**
 * LE TITRE ET LE PROJET DE CHAQUE CARTE, d'une seule requête — à la place du
 * tour de `listCards` sur tous les projets que faisait la télémétrie.
 */
export function titresDesCartes(): Map<string, { titre: string; projet?: string }> {
  const lignes = getDb()
    .prepare('SELECT c.id AS id, c.title AS titre, p.name AS projet FROM cards c LEFT JOIN projects p ON p.id = c.project_id')
    .all() as { id: string; titre: string; projet: string | null }[];
  return new Map(lignes.map((l) => [l.id, { titre: l.titre, projet: l.projet ?? undefined }]));
}

/* ------------------------------------------------------------------ */
/* Mémoire et compétences                                              */
/* ------------------------------------------------------------------ */

function memoire(base: BaseDuResume): ResumeMemoire {
  const db = getDb();
  const b = base;
  const noms = nomsDesProjets();

  const creees = db
    .prepare('SELECT cree_le AS at, type, portee FROM connaissances WHERE cree_le BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { at: number; type: string; portee: string }[];
  const parTypeMap = new Map<string, number>();
  for (const u of creees) parTypeMap.set(u.type, (parTypeMap.get(u.type) ?? 0) + 1);

  const portees = db
    .prepare(
      `SELECT portee, SUM(CASE WHEN cree_le BETWEEN @debut AND @fin THEN 1 ELSE 0 END) AS creees,
              SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) AS actives
         FROM connaissances GROUP BY portee`,
    )
    .all({ debut: b.debut, fin: b.fin }) as { portee: string; creees: number; actives: number }[];

  const versions = db
    .prepare('SELECT at FROM connaissance_versions WHERE at BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { at: number }[];
  const refus = db.prepare('SELECT at FROM connaissance_refus WHERE at BETWEEN ? AND ?').all(b.debut, b.fin) as { at: number }[];

  const appels = db
    .prepare(
      `SELECT created_at AS at, sujet, duree_ms AS ms, blocs_demandes AS demandes, blocs_rendus AS rendus
         FROM memoire_consultation WHERE created_at BETWEEN ? AND ?`,
    )
    .all(b.debut, b.fin) as { at: number; sujet: string | null; ms: number; demandes: number; rendus: number }[];
  const sujets = new Map<string, { appels: number; ms: number; demandes: number; rendus: number }>();
  for (const a of appels) {
    const cle = a.sujet || '—';
    const s = sujets.get(cle) ?? { appels: 0, ms: 0, demandes: 0, rendus: 0 };
    s.appels += 1;
    s.ms += a.ms ?? 0;
    s.demandes += a.demandes ?? 0;
    s.rendus += a.rendus ?? 0;
    sujets.set(cle, s);
  }
  const totalMs = appels.reduce((t, a) => t + (a.ms ?? 0), 0);

  /* Les compétences vivent sur le disque (`data/competences`) : leur date de
     naissance est dans l'entête de leur fiche, leurs compteurs en base. */
  let fiches: ResumeMemoire['fiches'] = [];
  try {
    fiches = etatDuPoolPourLEcran().fiches.map((f) => ({
      nom: f.nom,
      creeeLe: typeof f.creeeLe === 'number' ? f.creeeLe : null,
      servie: f.servie ?? 0,
      aidee: f.aidee ?? 0,
      inutile: f.inutile ?? 0,
      contredite: f.contredite ?? 0,
      confiance: typeof f.confiance === 'number' ? f.confiance : null,
      dernierService: typeof f.dernierService === 'number' ? f.dernierService : null,
    }));
  } catch {
    fiches = [];
  }
  const nees = fiches.filter((f) => dans(f.creeeLe, b));
  const juges = fiches.reduce(
    (t, f) => ({ aidee: t.aidee + f.aidee, inutile: t.inutile + f.inutile, contredite: t.contredite + f.contredite }),
    { aidee: 0, inutile: 0, contredite: 0 },
  );
  const sommeJuges = juges.aidee + juges.inutile + juges.contredite;

  return {
    ...base,
    rubrique: 'memoire',
    depuis: plusAncien('memoire_consultation', 'created_at'),
    unitesCreees: creees.length,
    unitesActives: portees.reduce((t, p) => t + (p.actives ?? 0), 0),
    modifications: versions.length,
    refus: refus.length,
    appels: appels.length,
    dureeMoyenneMs: appels.length ? Math.round(totalMs / appels.length) : 0,
    blocsDemandes: appels.reduce((t, a) => t + (a.demandes ?? 0), 0),
    blocsRendus: appels.reduce((t, a) => t + (a.rendus ?? 0), 0),
    competencesCreees: nees.length,
    competences: fiches.length,
    tauxDAide: sommeJuges ? juges.aidee / sommeJuges : null,
    parJour: {
      unites: sommesParJour(creees, b.debut, b.fin),
      modifications: sommesParJour(versions, b.debut, b.fin),
      refus: sommesParJour(refus, b.debut, b.fin),
      appels: sommesParJour(appels, b.debut, b.fin),
      competences: sommesParJour(nees.map((f) => ({ at: f.creeeLe! })), b.debut, b.fin),
    },
    parType: [...parTypeMap.entries()].map(([type, nombre]) => ({ type, nombre })).sort((x, y) => y.nombre - x.nombre),
    parPortee: portees
      .map((p) => ({ portee: p.portee, nom: p.portee === 'global' ? null : (noms.get(p.portee) ?? null), creees: p.creees ?? 0, actives: p.actives ?? 0 }))
      .sort((x, y) => y.creees - x.creees || y.actives - x.actives),
    sujets: [...sujets.entries()]
      .map(([sujet, s]) => ({ sujet, appels: s.appels, dureeMoyenneMs: Math.round(s.ms / s.appels), demandes: s.demandes, rendus: s.rendus }))
      .sort((x, y) => y.appels - x.appels),
    fiches,
  };
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

function surveillance(base: BaseDuResume): ResumeSurveillance {
  const db = getDb();
  const b = base;
  const sites = db.prepare('SELECT id, nom, url, etat, wordpress, derniere_panne AS dernierePanne FROM sites_surveilles').all() as {
    id: string;
    nom: string | null;
    url: string;
    etat: string;
    wordpress: number | null;
    dernierePanne: number | null;
  }[];
  const controles = db
    .prepare('SELECT site_id AS site, instant AS at, etat, duree_ms AS ms FROM controles_surveillance WHERE instant BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { site: string; at: number; etat: string; ms: number | null }[];
  const constats = new Map(
    (
      db.prepare('SELECT site_id AS site, COUNT(*) AS n FROM constats_wordpress WHERE resolu_le IS NULL GROUP BY site_id').all() as {
        site: string;
        n: number;
      }[]
    ).map((c) => [c.site, c.n]),
  );
  const parSite = new Map<string, { controles: number; pannes: number; ms: number; mesures: number }>();
  for (const c of controles) {
    const s = parSite.get(c.site) ?? { controles: 0, pannes: 0, ms: 0, mesures: 0 };
    s.controles += 1;
    if (c.etat === 'panne') s.pannes += 1;
    if (typeof c.ms === 'number') {
      s.ms += c.ms;
      s.mesures += 1;
    }
    parSite.set(c.site, s);
  }
  const mesures = controles.filter((c) => typeof c.ms === 'number');
  return {
    ...base,
    rubrique: 'surveillance',
    depuis: plusAncien('controles_surveillance', 'instant'),
    sites: sites.length,
    controles: controles.length,
    pannes: controles.filter((c) => c.etat === 'panne').length,
    dureeMoyenneMs: mesures.length ? Math.round(mesures.reduce((t, c) => t + (c.ms ?? 0), 0) / mesures.length) : 0,
    constatsOuverts: [...constats.values()].reduce((t, n) => t + n, 0),
    parJour: {
      controles: sommesParJour(controles, b.debut, b.fin),
      pannes: sommesParJour(
        controles.filter((c) => c.etat === 'panne'),
        b.debut,
        b.fin,
      ),
    },
    lignes: sites.map((s) => {
      const c = parSite.get(s.id);
      return {
        id: s.id,
        nom: s.nom || s.url,
        url: s.url,
        etat: s.etat,
        wordpress: Boolean(s.wordpress),
        controles: c?.controles ?? 0,
        pannes: c?.pannes ?? 0,
        dureeMoyenneMs: c && c.mesures ? Math.round(c.ms / c.mesures) : 0,
        dernierePanne: s.dernierePanne ?? null,
        constats: constats.get(s.id) ?? 0,
      };
    }),
  };
}

function studio(base: BaseDuResume): ResumeStudio {
  const db = getDb();
  const b = base;
  const noms = nomsDesProjets();
  const creations = db
    .prepare('SELECT id, project_id AS projet, titre, etat, cree_le AS creeLe, maj_le AS majLe FROM studio_creations WHERE maj_le >= ? AND cree_le <= ?')
    .all(b.debut, b.fin) as { id: string; projet: string; titre: string; etat: string; creeLe: number; majLe: number }[];
  const exports = db
    .prepare('SELECT creation_id AS creation, etat, cree_le AS at FROM studio_exports WHERE cree_le BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { creation: string; etat: string; at: number }[];
  const depenses = db
    .prepare('SELECT creation_id AS creation, montant_reel AS montant FROM studio_depenses WHERE cree_le BETWEEN ? AND ? AND montant_reel IS NOT NULL')
    .all(b.debut, b.fin) as { creation: string; montant: number }[];
  const medias = db.prepare('SELECT COUNT(*) AS n FROM studio_medias WHERE cree_le BETWEEN ? AND ?').get(b.debut, b.fin) as { n: number };
  const nees = creations.filter((c) => dans(c.creeLe, b));
  return {
    ...base,
    rubrique: 'studio',
    depuis: plusAncien('studio_creations', 'cree_le'),
    creations: nees.length,
    exports: exports.length,
    exportsEnEchec: exports.filter((e) => e.etat === 'echoue').length,
    depense: depenses.reduce((t, d) => t + (d.montant ?? 0), 0),
    medias: medias.n ?? 0,
    parJour: {
      creations: sommesParJour(
        nees.map((c) => ({ at: c.creeLe })),
        b.debut,
        b.fin,
      ),
      exports: sommesParJour(exports, b.debut, b.fin),
    },
    lignes: creations.map((c) => ({
      id: c.id,
      titre: c.titre,
      projet: noms.get(c.projet) ?? null,
      etat: c.etat,
      exports: exports.filter((e) => e.creation === c.id).length,
      depense: depenses.filter((d) => d.creation === c.id).reduce((t, d) => t + (d.montant ?? 0), 0),
      creeLe: c.creeLe,
      majLe: c.majLe,
    })),
  };
}

function coffre(base: BaseDuResume): ResumeCoffre {
  const b = base;
  const noms = nomsDesProjets();
  /* NI `nom`, NI `champs`, NI `note`, NI `images` : des comptes, rien d'autre. */
  const fiches = getDb()
    .prepare('SELECT project_id AS projet, type, cree_le AS creeLe, modifie_le AS modifieLe, archive_le AS archiveLe FROM secrets')
    .all() as { projet: string | null; type: string; creeLe: number; modifieLe: number; archiveLe: number | null }[];
  const vivantes = fiches.filter((f) => f.archiveLe === null);
  const modifiee = (f: (typeof fiches)[number]) => dans(f.modifieLe, b) && f.modifieLe - f.creeLe > 1000;
  const parProjet = new Map<string, ResumeCoffre['parProjet'][number]>();
  const parType = new Map<string, ResumeCoffre['parType'][number]>();
  for (const f of vivantes) {
    const cle = f.projet ?? '';
    const p = parProjet.get(cle) ?? { projet: f.projet, nom: f.projet ? (noms.get(f.projet) ?? null) : null, fiches: 0, creees: 0, modifiees: 0, derniereModif: null };
    p.fiches += 1;
    if (dans(f.creeLe, b)) p.creees += 1;
    if (modifiee(f)) p.modifiees += 1;
    p.derniereModif = Math.max(p.derniereModif ?? 0, f.modifieLe);
    parProjet.set(cle, p);
    const t = parType.get(f.type) ?? { type: f.type, fiches: 0, creees: 0 };
    t.fiches += 1;
    if (dans(f.creeLe, b)) t.creees += 1;
    parType.set(f.type, t);
  }
  return {
    ...base,
    rubrique: 'coffre',
    depuis: plusAncien('secrets', 'cree_le'),
    fiches: vivantes.length,
    creees: fiches.filter((f) => dans(f.creeLe, b)).length,
    modifiees: fiches.filter(modifiee).length,
    archivees: fiches.filter((f) => dans(f.archiveLe, b)).length,
    parJour: {
      creees: sommesParJour(
        fiches.map((f) => ({ at: f.creeLe })),
        b.debut,
        b.fin,
      ),
      modifiees: sommesParJour(
        fiches.filter(modifiee).map((f) => ({ at: f.modifieLe })),
        b.debut,
        b.fin,
      ),
    },
    parProjet: [...parProjet.values()].sort((x, y) => y.fiches - x.fiches),
    parType: [...parType.values()].sort((x, y) => y.fiches - x.fiches),
  };
}

function backups(base: BaseDuResume): ResumeBackups {
  const db = getDb();
  const b = base;
  const noms = nomsDesProjets();
  const sites = db.prepare('SELECT id, project_id AS projet, nom, actif FROM backup_sites').all() as {
    id: string;
    projet: string | null;
    nom: string;
    actif: number;
  }[];
  const dernieres = new Map(
    (db.prepare('SELECT site_id AS site, MAX(debut) AS at FROM backup_points GROUP BY site_id').all() as { site: string; at: number }[]).map((l) => [
      l.site,
      l.at,
    ]),
  );
  const points = db
    .prepare('SELECT id, site_id AS site, debut, statut, taille, data FROM backup_points WHERE debut BETWEEN ? AND ? ORDER BY debut DESC')
    .all(b.debut, b.fin) as { id: string; site: string; debut: number; statut: string; taille: number | null; data: string }[];
  const nomDuSite = new Map(sites.map((s) => [s.id, s.nom]));
  const lus = points.map((p) => {
    let fin: number | null = null;
    let origine: string | null = null;
    try {
      const d = JSON.parse(p.data) as { fin?: unknown; origine?: unknown };
      fin = typeof d.fin === 'number' ? d.fin : null;
      origine = typeof d.origine === 'string' ? d.origine : null;
    } catch {
      /* un point illisible garde sa ligne, sans durée */
    }
    return {
      id: p.id,
      siteId: p.site,
      site: nomDuSite.get(p.site) ?? '—',
      debut: p.debut,
      statut: p.statut,
      octets: p.taille ?? 0,
      dureeMs: fin !== null && fin >= p.debut ? fin - p.debut : null,
      origine,
    };
  });
  const echec = (statut: string) => statut === 'echec';
  return {
    ...base,
    rubrique: 'backups',
    depuis: plusAncien('backup_points', 'debut'),
    sites: sites.length,
    prises: lus.length,
    echecs: lus.filter((p) => echec(p.statut)).length,
    octets: lus.reduce((t, p) => t + p.octets, 0),
    parJour: {
      prises: sommesParJour(
        lus.map((p) => ({ at: p.debut })),
        b.debut,
        b.fin,
      ),
      echecs: sommesParJour(
        lus.filter((p) => echec(p.statut)).map((p) => ({ at: p.debut })),
        b.debut,
        b.fin,
      ),
    },
    sitesListe: sites.map((s) => {
      const siens = lus.filter((p) => p.siteId === s.id);
      return {
        id: s.id,
        nom: s.nom,
        projet: s.projet ? (noms.get(s.projet) ?? null) : null,
        actif: Boolean(s.actif),
        prises: siens.length,
        echecs: siens.filter((p) => echec(p.statut)).length,
        octets: siens.reduce((t, p) => t + p.octets, 0),
        dernierePrise: dernieres.get(s.id) ?? null,
      };
    }),
    points: lus.map(({ siteId: _site, ...p }) => p),
  };
}

function statistiques(base: BaseDuResume): ResumeStatistiques {
  const db = getDb();
  const b = base;
  const noms = nomsDesProjets();
  const espaces = db.prepare('SELECT project_id AS projet, nom FROM marketing_espaces').all() as { projet: string; nom: string | null }[];
  const parSite = new Map(
    (
      db
        .prepare(
          `SELECT e.project_id AS projet,
                  COUNT(DISTINCT CASE WHEN e.type IN ('vue', 'session')
                        THEN COALESCE(e.visite, e.visiteur || ':' || strftime('%Y-%m-%d', e.instant / 1000, 'unixepoch')) END) AS visites,
                  COUNT(DISTINCT e.visiteur) AS visiteurs,
                  SUM(CASE WHEN e.type = 'vue' THEN 1 ELSE 0 END) AS pagesVues,
                  SUM(CASE WHEN e.type = 'objectif' OR (e.type = 'repere' AND EXISTS (
                        SELECT 1 FROM stats_reperes r WHERE r.project_id = e.project_id AND r.nom = e.repere AND r.objectif = 1)) THEN 1 ELSE 0 END) AS objectifs
             FROM marketing_evenements e
            WHERE e.instant BETWEEN ? AND ?
            GROUP BY e.project_id`,
        )
        .all(b.debut, b.fin) as { projet: string; visites: number; visiteurs: number; pagesVues: number; objectifs: number }[]
    ).map((l) => [l.projet, l]),
  );
  const evenements = db
    .prepare(
      `SELECT instant AS at, project_id AS projet, visiteur,
              COALESCE(visite, visiteur || ':' || strftime('%Y-%m-%d', instant / 1000, 'unixepoch')) AS visite
         FROM marketing_evenements WHERE instant BETWEEN ? AND ? AND type IN ('vue', 'session')`,
    )
    .all(b.debut, b.fin) as { at: number; projet: string; visiteur: string | null; visite: string | null }[];
  const visiteurs = db
    .prepare('SELECT COUNT(DISTINCT visiteur) AS n FROM marketing_evenements WHERE instant BETWEEN ? AND ?')
    .get(b.debut, b.fin) as { n: number };

  const lignes: ResumeStatistiques['lignes'] = [];
  const vus = new Set<string>();
  const ajouter = (projet: string, nomEspace: string | null) => {
    if (vus.has(projet)) return;
    const autonome = projet.startsWith('site:');
    const nom = autonome ? nomEspace : (noms.get(projet) ?? null);
    if (!nom) return;
    vus.add(projet);
    const c = parSite.get(projet);
    lignes.push({ id: projet, nom, autonome, visites: c?.visites ?? 0, visiteurs: c?.visiteurs ?? 0, pagesVues: c?.pagesVues ?? 0, objectifs: c?.objectifs ?? 0 });
  };
  for (const e of espaces) ajouter(e.projet, e.nom);
  for (const projet of parSite.keys()) ajouter(projet, null);
  lignes.sort((x, y) => y.visites - x.visites);

  return {
    ...base,
    rubrique: 'statistiques',
    depuis: plusAncien('marketing_evenements', 'instant'),
    visites: lignes.reduce((t, l) => t + l.visites, 0),
    visiteurs: visiteurs.n ?? 0,
    pagesVues: lignes.reduce((t, l) => t + l.pagesVues, 0),
    objectifs: lignes.reduce((t, l) => t + l.objectifs, 0),
    parJour: {
      visites: distinctsParJour(
        evenements.filter((e) => e.visite).map((e) => ({ at: e.at, cle: `${e.projet}|${e.visite}` })),
        b,
      ),
      visiteurs: distinctsParJour(
        evenements.filter((e) => e.visiteur).map((e) => ({ at: e.at, cle: e.visiteur! })),
        b,
      ),
    },
    lignes,
  };
}

function messagerie(base: BaseDuResume): ResumeMessagerie {
  const db = getDb();
  const b = base;
  const noms = nomsDesProjets();
  const demandes = db
    .prepare(
      'SELECT id, project_id AS projet, titre, colonne, creee_le AS creeeLe, derniere_activite AS derniereActivite, archivee_le AS archiveeLe FROM demandes',
    )
    .all() as { id: string; projet: string; titre: string; colonne: string; creeeLe: number; derniereActivite: number; archiveeLe: number | null }[];
  const messages = db
    .prepare('SELECT demande_id AS demande, cree_le AS at FROM demande_messages WHERE cree_le BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { demande: string; at: number }[];
  const fil = db.prepare('SELECT cree_le AS at FROM fil_messages WHERE cree_le BETWEEN ? AND ?').all(b.debut, b.fin) as { at: number }[];
  const close = (colonne: string) => colonne === 'termine' || colonne === 'valide';
  const parDemande = new Map<string, number>();
  for (const m of messages) parDemande.set(m.demande, (parDemande.get(m.demande) ?? 0) + 1);
  const actives = demandes.filter((d) => d.derniereActivite >= b.debut && d.creeeLe <= b.fin);
  return {
    ...base,
    rubrique: 'messagerie',
    depuis: plusAncien('demandes', 'creee_le'),
    demandesCreees: demandes.filter((d) => dans(d.creeeLe, b)).length,
    demandesOuvertes: demandes.filter((d) => d.archiveeLe === null && !close(d.colonne)).length,
    demandesTerminees: actives.filter((d) => close(d.colonne)).length,
    messages: messages.length + fil.length,
    parJour: {
      demandes: sommesParJour(
        demandes.map((d) => ({ at: d.creeeLe })),
        b.debut,
        b.fin,
      ),
      messages: sommesParJour([...messages, ...fil], b.debut, b.fin),
    },
    lignes: actives
      .sort((x, y) => y.derniereActivite - x.derniereActivite)
      .map((d) => ({
        id: d.id,
        titre: d.titre,
        projet: noms.get(d.projet) ?? null,
        colonne: d.colonne,
        creeeLe: d.creeeLe,
        derniereActivite: d.derniereActivite,
        messages: parDemande.get(d.id) ?? 0,
        archivee: d.archiveeLe !== null,
      })),
  };
}

function marketing(base: BaseDuResume): ResumeMarketing {
  const db = getDb();
  const b = base;
  const noms = nomsDesProjets();
  const contenus = db
    .prepare('SELECT project_id AS projet, etape, url_publiee AS url, cree_le AS creeLe, maj_le AS majLe FROM marketing_contenus')
    .all() as { projet: string; etape: string; url: string | null; creeLe: number; majLe: number }[];
  const actions = db
    .prepare('SELECT project_id AS projet, fait_le AS at FROM marketing_actions WHERE fait_le BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { projet: string; at: number }[];
  const ventes = db
    .prepare('SELECT project_id AS projet, montant_centimes AS montant FROM marketing_ventes WHERE instant BETWEEN ? AND ?')
    .all(b.debut, b.fin) as { projet: string; montant: number | null }[];
  const lignes = new Map<string, ResumeMarketing['lignes'][number]>();
  const ligne = (projet: string) => {
    let l = lignes.get(projet);
    if (!l) {
      l = { projectId: projet, nom: noms.get(projet) ?? null, contenus: 0, aValider: 0, publies: 0, actions: 0, ventes: 0, montant: 0 };
      lignes.set(projet, l);
    }
    return l;
  };
  const nes = contenus.filter((c) => dans(c.creeLe, b));
  const publies = contenus.filter((c) => c.url && dans(c.majLe, b));
  for (const c of nes) ligne(c.projet).contenus += 1;
  for (const c of contenus) if (c.etape === 'a_valider') ligne(c.projet).aValider += 1;
  for (const c of publies) ligne(c.projet).publies += 1;
  for (const a of actions) ligne(a.projet).actions += 1;
  for (const v of ventes) {
    const l = ligne(v.projet);
    l.ventes += 1;
    l.montant += v.montant ?? 0;
  }
  return {
    ...base,
    rubrique: 'marketing',
    depuis: plusAncien('marketing_contenus', 'cree_le'),
    contenus: nes.length,
    publies: publies.length,
    actionsFaites: actions.length,
    ventes: ventes.length,
    montant: ventes.reduce((t, v) => t + (v.montant ?? 0), 0),
    parJour: {
      contenus: sommesParJour(
        nes.map((c) => ({ at: c.creeLe })),
        b.debut,
        b.fin,
      ),
      actions: sommesParJour(actions, b.debut, b.fin),
    },
    lignes: [...lignes.values()].filter((l) => l.nom).sort((x, y) => y.contenus - x.contenus || y.aValider - x.aValider),
  };
}

function notes(base: BaseDuResume): ResumeNotes {
  const b = base;
  const noms = nomsDesProjets();
  const toutes = getDb()
    .prepare('SELECT id, project_id AS projet, titre, importance, echeance, cree_le AS creeLe, modifie_le AS modifieLe FROM notes')
    .all() as { id: string; projet: string; titre: string; importance: string; echeance: number | null; creeLe: number; modifieLe: number }[];
  const modifiee = (n: (typeof toutes)[number]) => dans(n.modifieLe, b) && n.modifieLe - n.creeLe > 1000;
  return {
    ...base,
    rubrique: 'notes',
    depuis: plusAncien('notes', 'cree_le'),
    total: toutes.length,
    creees: toutes.filter((n) => dans(n.creeLe, b)).length,
    modifiees: toutes.filter(modifiee).length,
    parJour: {
      creees: sommesParJour(
        toutes.map((n) => ({ at: n.creeLe })),
        b.debut,
        b.fin,
      ),
      modifiees: sommesParJour(
        toutes.filter(modifiee).map((n) => ({ at: n.modifieLe })),
        b.debut,
        b.fin,
      ),
    },
    lignes: toutes
      .filter((n) => n.modifieLe >= b.debut && n.creeLe <= b.fin)
      .sort((x, y) => y.modifieLe - x.modifieLe)
      .map((n) => ({ ...n, projet: noms.get(n.projet) ?? null, echeance: n.echeance ?? null })),
  };
}

const CALCULS: Record<RubriqueDuResume, (base: BaseDuResume) => ResumeDeRubrique> = {
  ensemble,
  taches,
  memoire,
  surveillance,
  studio,
  coffre,
  backups,
  statistiques,
  messagerie,
  marketing,
  notes,
};

/** CE QUE MONTRE UNE RUBRIQUE DU RÉSUMÉ sur la période demandée (remise d'aplomb ici). */
export function resumeDeRubrique(
  rubrique: RubriqueDuResume,
  demande: { debut?: number; fin?: number } = {},
  maintenant = Date.now(),
): ResumeDeRubrique {
  return CALCULS[rubrique](socle(demande.debut, demande.fin, maintenant));
}

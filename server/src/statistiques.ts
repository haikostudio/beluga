import crypto from 'node:crypto';
import {
  type Card,
  type EspaceMarketing,
  type EtatAfficheDuSuivi,
  type ModeSuivi,
  type ParcoursDeSuivi,
  type RepereDeSuivi,
  PREFIXE_SITE_AUTONOME,
  analyserLesParcours,
  consigneDesObjectifs,
  estSiteAutonome,
  estUnRegroupement,
  etatAfficheDuSuivi,
  extraitDeSuivi,
  friseDuVisiteur,
  identifiantDeNavigateur,
  modeDEmploiDuSuivi,
  nomDeSiteValide,
  origineDe,
  parcoursDuSite,
  phraseDeConfidentialite,
  periodeDesStatistiques,
  tableauDeBord,
} from '@beluga/shared';
import { getDb } from './db.js';
import {
  adresseDeBeluga,
  assurerEspace,
  carteDuSuivi,
  carteDuSuiviEnTravail,
  diffuser,
  ecrireConfiguration,
  evenementsDuProjet,
  evenementsDuVisiteur,
  lireEspace,
  listerEspaces,
  resultatsDuProjet,
} from './marketing.js';
import { lireEtatDuSuivi } from './suivi-par-defaut.js';
import * as store from './store.js';
import { log } from './logger.js';

/**
 * LE SERVICE « STATISTIQUES » — côté démon (demande du 27/09/2026).
 *
 * Il reprend la mécanique du suivi des visites de l'atelier marketing (mêmes
 * espaces `marketing_espaces`, même porte publique `/m/s.js` et `/m/c`, mêmes
 * événements) et l'ouvre :
 *  - aux SITES AUTONOMES, créés depuis l'écran sans projet Beluga : leur
 *    espace porte l'identifiant « site:<id> » et un `nom` ;
 *  - au MODE VISITEUR (bandeau d'accord, parcours par visiteur) ;
 *  - aux REPÈRES posés par les agents (`stats_reperes`).
 *
 * Règles pures : `shared/src/statistiques.ts`.
 */

export interface SiteDeStatistiques {
  id: string;
  nom: string;
  autonome: boolean;
  adresse: string | null;
  modeSuivi: ModeSuivi;
  etatSuivi: string;
  /** Ce que l'écran en dit, la même règle partout (`etatAfficheDuSuivi`). */
  etatAffiche: EtatAfficheDuSuivi;
  actif: boolean;
  /** Les visites des 28 derniers jours, jour par jour. */
  visites: number[];
  /** Les visiteurs distincts des 28 derniers jours. */
  visiteurs: number;
  /** Les objectifs atteints sur 28 jours : évènements « objectif » et clics sur un repère marqué objectif. */
  objectifs: number;
  /** Les visites des 28 jours d'avant, pour la tendance (`tendanceDesVisites`). */
  visitesPrecedentes: number;
}

/** Le nom affiché d'un espace : celui du projet, ou celui du site autonome. */
function nomDeLEspace(espace: EspaceMarketing): string | null {
  if (estSiteAutonome(espace.projectId)) return espace.nom ?? null;
  const projet = store.getProject(espace.projectId);
  if (!projet || projet.archived || estUnRegroupement(projet)) return null;
  return projet.name;
}

/** L'état affiché d'un espace : son état, le code lu sur sa page, et sa carte d'installation encore au travail. */
export function etatAfficheDeLEspace(espace: EspaceMarketing): EtatAfficheDuSuivi {
  const autonome = estSiteAutonome(espace.projectId);
  return etatAfficheDuSuivi({
    etatSuivi: espace.configuration.etatSuivi,
    diagnostic: lireEtatDuSuivi(espace.projectId).diagnostic,
    installationEnCours: !autonome && !!carteDuSuiviEnTravail(espace.projectId),
  });
}

function derniersJours(maintenant: number, n = 28): string[] {
  return Array.from({ length: n }, (_, i) => new Date(maintenant - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/**
 * LA LISTE DU SERVICE : chaque espace de suivi dont le projet vit encore, puis
 * les sites autonomes. Les visites des quatre dernières semaines viennent
 * d'UNE requête pour tous ; une seconde, groupée par projet sur 56 jours,
 * donne les chiffres de la liste en tableau (visiteurs, objectifs atteints,
 * visites des 28 jours d'avant pour la flèche de tendance).
 */
export function listerLesSites(maintenant = Date.now()): { sites: SiteDeStatistiques[]; jours: string[] } {
  const jours = derniersJours(maintenant);
  const debut = Date.parse(`${jours[0]}T00:00:00Z`);
  const lignes = getDb()
    .prepare(
      `SELECT project_id AS projet, strftime('%Y-%m-%d', instant / 1000, 'unixepoch') AS jour,
              COUNT(DISTINCT COALESCE(visite, visiteur || ':' || strftime('%Y-%m-%d', instant / 1000, 'unixepoch'))) AS n
         FROM marketing_evenements
        WHERE instant >= ? AND type IN ('vue', 'session')
        GROUP BY projet, jour`,
    )
    .all(debut) as { projet: string; jour: string; n: number }[];
  const visites = new Map<string, Map<string, number>>();
  for (const l of lignes) {
    if (!visites.has(l.projet)) visites.set(l.projet, new Map());
    visites.get(l.projet)!.set(l.jour, l.n);
  }
  const chiffres = new Map(
    (
      getDb()
        .prepare(
          `SELECT e.project_id AS projet,
                  COUNT(DISTINCT CASE WHEN e.instant >= @debut THEN e.visiteur END) AS visiteurs,
                  SUM(CASE WHEN e.instant >= @debut AND (e.type = 'objectif' OR (e.type = 'repere' AND EXISTS (
                        SELECT 1 FROM stats_reperes r WHERE r.project_id = e.project_id AND r.nom = e.repere AND r.objectif = 1))) THEN 1 ELSE 0 END) AS objectifs,
                  COUNT(DISTINCT CASE WHEN e.instant < @debut AND e.type IN ('vue', 'session')
                        THEN COALESCE(e.visite, e.visiteur || ':' || strftime('%Y-%m-%d', e.instant / 1000, 'unixepoch')) END) AS precedentes
             FROM marketing_evenements e
            WHERE e.instant >= @avant
            GROUP BY e.project_id`,
        )
        .all({ debut, avant: debut - 28 * 86_400_000 }) as { projet: string; visiteurs: number; objectifs: number; precedentes: number }[]
    ).map((l) => [l.projet, l]),
  );
  const sites: SiteDeStatistiques[] = [];
  const espaces = listerEspaces();
  const avecEspace = new Set(espaces.map((e) => e.projectId));
  // Un projet vivant sans espace paraît aussi : l'ouvrir lui donne sa clé de suivi.
  for (const projet of store.listProjects()) {
    if (projet.archived || estUnRegroupement(projet) || avecEspace.has(projet.id)) continue;
    sites.push({ id: projet.id, nom: projet.name, autonome: false, adresse: null, modeSuivi: 'anonyme', etatSuivi: 'absent', etatAffiche: 'absent', actif: true, visites: jours.map(() => 0), visiteurs: 0, objectifs: 0, visitesPrecedentes: 0 });
  }
  for (const espace of espaces) {
    const nom = nomDeLEspace(espace);
    if (!nom) continue;
    const parJour = visites.get(espace.projectId);
    const c = chiffres.get(espace.projectId);
    sites.push({
      id: espace.projectId,
      nom,
      autonome: estSiteAutonome(espace.projectId),
      adresse: espace.configuration.adresse ?? null,
      modeSuivi: espace.modeSuivi,
      etatSuivi: espace.configuration.etatSuivi,
      etatAffiche: etatAfficheDeLEspace(espace),
      actif: espace.actif,
      visites: jours.map((j) => parJour?.get(j) ?? 0),
      visiteurs: c?.visiteurs ?? 0,
      objectifs: c?.objectifs ?? 0,
      visitesPrecedentes: c?.precedentes ?? 0,
    });
  }
  sites.sort((a, b) => Number(a.autonome) - Number(b.autonome) || a.nom.localeCompare(b.nom, 'fr'));
  return { sites, jours };
}

/* ------------------------------------------------------------------ */
/* Sites autonomes                                                     */
/* ------------------------------------------------------------------ */

/**
 * UN SITE AUTONOME : un nom et une adresse, rien d'autre. Son adresse est
 * déclarée d'office (le script refuse les sites non déclarés), et son espace
 * est prêt à recevoir ses visites dès que l'extrait est posé.
 */
export function creerSiteAutonome(entree: { nom: unknown; adresse: unknown; mode?: unknown }, maintenant = Date.now()): EspaceMarketing {
  const nom = nomDeSiteValide(entree.nom);
  if (!nom) throw new Error('Donnez un nom au site.');
  const adresse = typeof entree.adresse === 'string' ? entree.adresse.trim() : '';
  const origine = origineDe(adresse);
  if (!origine) throw new Error('Adresse du site illisible : elle commence par https://');
  const id = `${PREFIXE_SITE_AUTONOME}${crypto.randomBytes(6).toString('base64url')}`;
  const cle = crypto.randomBytes(9).toString('base64url');
  const mode: ModeSuivi = entree.mode === 'visiteur' ? 'visiteur' : 'anonyme';
  getDb()
    .prepare(
      `INSERT INTO marketing_espaces (project_id, nom, mode_suivi, cle_suivi, origines, sources_ventes, objectifs, canaux, etat_suivi, langue, fiche, methode_suivi, cree_le, maj_le)
       VALUES (?, ?, ?, ?, '[]', '[]', '[]', '[]', 'absent', 'fr', '{}', 'manuel', ?, ?)`,
    )
    .run(id, nom, mode, cle, maintenant, maintenant);
  ecrireConfiguration(id, { adresse, origines: [origine] }, maintenant);
  return lireEspace(id)!;
}

/** Le nom et l'adresse d'un site autonome, corrigés depuis l'écran. */
export function modifierSiteAutonome(id: string, entree: { nom?: unknown; adresse?: unknown }): EspaceMarketing {
  const espace = lireEspace(id);
  if (!espace || !estSiteAutonome(id)) throw new Error('site introuvable');
  if (entree.nom !== undefined) {
    const nom = nomDeSiteValide(entree.nom);
    if (!nom) throw new Error('Donnez un nom au site.');
    getDb().prepare('UPDATE marketing_espaces SET nom = ?, maj_le = ? WHERE project_id = ?').run(nom, Date.now(), id);
  }
  if (entree.adresse !== undefined) {
    const adresse = typeof entree.adresse === 'string' ? entree.adresse.trim() : '';
    const origine = origineDe(adresse);
    if (!origine) throw new Error('Adresse du site illisible : elle commence par https://');
    const origines = espace.configuration.origines.includes(origine) ? espace.configuration.origines : [...espace.configuration.origines, origine];
    ecrireConfiguration(id, { adresse, origines });
  }
  diffuser(id);
  return lireEspace(id)!;
}

/** Un site autonome retiré : son espace, ses repères et ses passages. Un projet Beluga ne se retire pas d'ici. */
export function supprimerSiteAutonome(id: string): void {
  if (!estSiteAutonome(id) || !lireEspace(id)) throw new Error('site introuvable');
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM marketing_evenements WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM marketing_ventes WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM stats_reperes WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM stats_parcours WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM marketing_espaces WHERE project_id = ?').run(id);
  })();
  diffuser(id);
}

/* ------------------------------------------------------------------ */
/* Mode et repères                                                     */
/* ------------------------------------------------------------------ */

/**
 * LE MODE DU SUIVI. `analyser` (l'écran, jamais l'outil de l'agent qui installe
 * lui-même) : un PROJET qui PASSE d'anonyme à visiteur voit naître son analyse
 * des objectifs (`analyserLesObjectifs`) — le suivi complet sans objectifs n'a
 * pas d'entonnoir. Un site autonome garde son bouton « Étudier le site ».
 */
export function reglerLeMode(id: string, mode: unknown, options: { analyser?: boolean } = {}): EspaceMarketing {
  if (mode !== 'anonyme' && mode !== 'visiteur') throw new Error('mode inconnu : anonyme ou visiteur');
  const avant = lireEspace(id);
  if (!avant) throw new Error('site introuvable');
  getDb().prepare('UPDATE marketing_espaces SET mode_suivi = ?, maj_le = ? WHERE project_id = ?').run(mode, Date.now(), id);
  diffuser(id);
  if (options.analyser && mode === 'visiteur' && avant.modeSuivi !== 'visiteur' && !estSiteAutonome(id)) {
    analyserLesObjectifs(id).catch((err) => log.warn(`statistiques : analyse des objectifs impossible pour ${id}`, err));
  }
  return lireEspace(id)!;
}

export function lireLesReperes(id: string): (RepereDeSuivi & { posePar: string | null; creeLe: number })[] {
  return (
    getDb()
      .prepare('SELECT nom, emplacement, raison, objectif, pose_par, cree_le FROM stats_reperes WHERE project_id = ? ORDER BY ordre ASC, nom ASC')
      .all(id) as { nom: string; emplacement: string; raison: string; objectif: number; pose_par: string | null; cree_le: number }[]
  ).map((l) => ({ nom: l.nom, emplacement: l.emplacement, raison: l.raison, objectif: l.objectif === 1, posePar: l.pose_par, creeLe: l.cree_le }));
}

/** LA LISTE ENTIÈRE des repères, qui remplace la précédente (déjà jugée par `jugerReperes`). */
export function ecrireLesReperes(id: string, reperes: readonly RepereDeSuivi[], posePar: string | null, maintenant = Date.now()): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM stats_reperes WHERE project_id = ?').run(id);
    const inserer = db.prepare(
      'INSERT INTO stats_reperes (project_id, nom, emplacement, raison, objectif, ordre, pose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    reperes.forEach((r, i) => inserer.run(id, r.nom, r.emplacement, r.raison, r.objectif ? 1 : 0, i, posePar, maintenant));
  })();
  diffuser(id);
}

/** LES PARCOURS DÉCLARÉS, dans leur ordre (sans le parcours principal déduit : voir `lireLesParcoursDuSite`). */
export function lireLesParcours(id: string): (ParcoursDeSuivi & { posePar: string | null; creeLe: number })[] {
  return (
    getDb()
      .prepare('SELECT id, nom, objectif, description, etapes, pose_par, cree_le FROM stats_parcours WHERE project_id = ? ORDER BY ordre ASC, id ASC')
      .all(id) as { id: string; nom: string; objectif: string; description: string; etapes: string; pose_par: string | null; cree_le: number }[]
  ).map((l) => {
    let etapes: ParcoursDeSuivi['etapes'] = [];
    try {
      const brut = JSON.parse(l.etapes);
      if (Array.isArray(brut)) etapes = brut.filter((e) => e && typeof e.repere === 'string').map((e) => ({ repere: e.repere, libelle: String(e.libelle ?? ''), description: String(e.description ?? '') }));
    } catch {
      /* une ligne illisible rend un parcours sans étape, ignoré à l'affichage */
    }
    return { id: l.id, nom: l.nom, objectif: l.objectif, description: l.description, etapes, posePar: l.pose_par, creeLe: l.cree_le };
  });
}

/** Les parcours à montrer : les déclarés, sinon le principal déduit des repères « objectif ». */
export function lireLesParcoursDuSite(id: string, reperes = lireLesReperes(id)): ParcoursDeSuivi[] {
  return parcoursDuSite(lireLesParcours(id).filter((p) => p.etapes.length), reperes);
}

/**
 * LA LISTE ENTIÈRE des parcours (déjà jugée par `jugerParcours`), qui remplace
 * la précédente ; une liste vide les retire tous (retour au parcours principal
 * déduit des repères). Les repères qui sont une étape d'un parcours sont
 * marqués « objectif » : la liste des sites compte leurs atteintes.
 */
export function ecrireLesParcours(id: string, parcours: readonly ParcoursDeSuivi[], posePar: string | null, maintenant = Date.now()): void {
  const db = getDb();
  const etapes = new Set(parcours.flatMap((p) => p.etapes.map((e) => e.repere)));
  db.transaction(() => {
    db.prepare('DELETE FROM stats_parcours WHERE project_id = ?').run(id);
    const inserer = db.prepare(
      'INSERT INTO stats_parcours (project_id, id, nom, objectif, description, etapes, ordre, pose_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    parcours.forEach((p, i) => inserer.run(id, p.id, p.nom, p.objectif, p.description, JSON.stringify(p.etapes), i, posePar, maintenant));
    if (parcours.length) {
      const marquer = db.prepare('UPDATE stats_reperes SET objectif = ? WHERE project_id = ? AND nom = ?');
      for (const r of lireLesReperes(id)) marquer.run(etapes.has(r.nom) ? 1 : 0, id, r.nom);
    }
  })();
  diffuser(id);
}

/* ------------------------------------------------------------------ */
/* Détail                                                              */
/* ------------------------------------------------------------------ */

/** L'extrait, la phrase de confidentialité du mode et le mode d'emploi : ce que l'écran et l'agent donnent à poser. */
export function troussePourLeSite(espace: EspaceMarketing, nom: string) {
  return {
    extrait: extraitDeSuivi(adresseDeBeluga(), espace.cleSuivi),
    confidentialite: phraseDeConfidentialite(espace.configuration.langue, nom, espace.modeSuivi),
    modeDEmploi: modeDEmploiDuSuivi(),
  };
}

/** Le fuseau horaire du serveur : les « utilisateurs par heure » s'y comptent. */
const FUSEAU_DU_SERVEUR = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** LE DÉTAIL D'UN SITE, tel que l'écran le montre : chiffres, parcours, repères, extrait. */
export function detailDuSite(id: string, demande: { jours?: unknown; debut?: unknown; fin?: unknown } = {}, maintenant = Date.now()) {
  const periode = periodeDesStatistiques(demande, maintenant);
  const bornes = { depuis: periode.depuis, jusqua: periode.jusqua };
  const espace = estSiteAutonome(id) ? lireEspace(id) : store.getProject(id) ? assurerEspace(id) : null;
  if (!espace) throw new Error('site introuvable');
  const nom = nomDeLEspace(espace);
  if (!nom) throw new Error('site introuvable');
  const reperes = lireLesReperes(id);
  const parcoursDeclares = lireLesParcoursDuSite(id, reperes);
  const { evenements, tronque } = evenementsDuProjet(id, bornes, maintenant);
  const autonome = estSiteAutonome(id);
  const etat = lireEtatDuSuivi(id);
  const carte = autonome ? null : carteDuSuivi(id);
  // Un site autonome n'a pas de carte d'installation, mais peut avoir sa carte d'ÉTUDE (`etudierLeSite`).
  const carteEtude = autonome ? carteDuSuivi(id) : null;
  return {
    id,
    nom,
    autonome,
    espace,
    resultats: resultatsDuProjet(id, bornes, maintenant),
    periode,
    parcours: analyserLesParcours({ evenements, reperes }),
    parcoursTronque: tronque,
    reperes,
    /** Les parcours déclarés (ou le principal déduit), leur flux dans `tableau.parcours`, même ordre. */
    parcoursDeclares,
    ...troussePourLeSite(espace, nom),
    diagnosticSuivi: etat.diagnostic,
    carteSuivi: carte,
    carteEtude,
    /** La carte qui analyse les objectifs : l'étude d'un site autonome, ou l'analyse d'un projet. */
    carteObjectifs: autonome ? carteEtude : carteDesObjectifs(id),
    etatAffiche: etatAfficheDeLEspace(espace),
    /** Le groupe de chiffres complet, heures comptées dans le fuseau du serveur. */
    tableau: tableauDeBord({ evenements, parcours: parcoursDeclares, depuis: periode.depuis, jusqua: periode.jusqua, fuseau: FUSEAU_DU_SERVEUR }),
  };
}

/* ------------------------------------------------------------------ */
/* Étude d'un site autonome                                            */
/* ------------------------------------------------------------------ */

/** Le libellé posé sur la carte qui étudie un site autonome. */
export const LABEL_ETUDE_DE_SITE = 'statistiques';

/**
 * « ÉTUDIER LE SITE » (demande du 28/09/2026) : un site autonome ne reçoit
 * JAMAIS d'installation automatique (il ne vit pas sur ce serveur), mais son
 * suivi complet mérite des objectifs propres. Un agent LIT le site — ses pages
 * publiques et, si l'utilisateur les donne, celles derrière une connexion — et
 * déclare ses repères et objectifs, à poser à la main.
 *
 *  - LES ACCÈS vont au COFFRE-FORT, une fiche « mot de passe » (adresse,
 *    identifiant, mot de passe) : la carte ne porte que le NOM de la fiche,
 *    jamais le secret ;
 *  - LA CARTE vit dans le projet Beluga (un site autonome n'a pas de projet,
 *    comme les surveillances) et désigne le site par son identifiant ; son
 *    cadrage part seul, le travail attend le clic de l'utilisateur ;
 *  - une carte d'étude encore en demande ou au travail est rendue telle quelle.
 */
export async function etudierLeSite(
  id: string,
  acces: { identifiant?: unknown; motDePasse?: unknown } = {},
): Promise<{ card: import('@beluga/shared').Card; deja: boolean; fiche: string | null }> {
  if (!estSiteAutonome(id)) throw new Error('seul un site autonome s’étudie ainsi : un projet reçoit sa carte d’installation');
  const espace = lireEspace(id);
  if (!espace) throw new Error('site introuvable');
  const nom = espace.nom ?? id;
  const adresse = espace.configuration.adresse;
  if (!adresse) throw new Error('Adresse du site inconnue.');
  const deja = carteDuSuiviEnTravail(id);
  if (deja) return { card: deja, deja: true, fiche: null };
  const beluga = store.listProjects().find((p) => p.isSelf && !p.archived);
  if (!beluga) throw new Error('projet Beluga introuvable : la carte d’étude n’a nulle part où naître');

  const identifiant = typeof acces.identifiant === 'string' ? acces.identifiant.trim() : '';
  const motDePasse = typeof acces.motDePasse === 'string' ? acces.motDePasse : '';
  let fiche: string | null = null;
  if (identifiant || motDePasse) {
    const { enregistrerAcces } = await import('./coffre-fort.js');
    const nomFiche = `Statistiques — connexion à ${nom}`.slice(0, 80);
    const r = enregistrerAcces({
      nom: nomFiche,
      type: 'mot-de-passe',
      champs: { adresse, identifiant, motDePasse },
      note: `Donné pour l’étude du suivi des visites du site autonome ${nom} (${id}).`,
    });
    if (!r.ok) throw new Error(r.raison);
    fiche = r.acces.nom;
  }

  const description = [
    `ÉTUDIER LE SITE AUTONOME « ${nom} » (${adresse}) pour son suivi des visites, identifiant de site « ${id} ». Ce site ne vit PAS sur ce serveur : tu ne modifies rien, ni ici ni sur le site — tu le LIS, dans un vrai navigateur.`,
    '',
    fiche
      ? `ACCÈS : la fiche « ${fiche} » du coffre-fort (outil « coffre_fort ») porte l’adresse de connexion, l’identifiant et le mot de passe. Connecte-toi pour lire les pages protégées ; ne recopie jamais le secret dans une réponse, un fichier ou la mémoire.`
      : 'ACCÈS : aucun donné — étudie les pages publiques. S’il faut une connexion pour comprendre le parcours, demande-la (« ask_user ») et range-la au coffre-fort, une fiche par secret.',
    '',
    consigneDesObjectifs(espace.modeSuivi),
    '',
    `Sur ce site, les repères se posent À LA MAIN : utilise l’outil « statistiques » avec « site » : « ${id} » (actions « etat », « reperes » avec ses parcours, « lire »), puis rends à l’utilisateur la liste des attributs data-beluga-repere à poser, élément par élément.`,
  ].join('\n');
  const { faireNaitreLaCarte } = await import('./naissance-de-carte.js');
  const { card } = await faireNaitreLaCarte(
    beluga.id,
    { auteur: 'marketing', title: `Étudier le site ${nom}`.slice(0, 80), description, labels: [LABEL_ETUDE_DE_SITE], origin: 'agent' },
    { premierTour: true },
  );
  getDb().prepare('UPDATE marketing_espaces SET carte_suivi_id = ? WHERE project_id = ?').run(card.id, id);
  diffuser(id);
  return { card, deja: false, fiche };
}

/* ------------------------------------------------------------------ */
/* Analyse des objectifs d'un projet                                   */
/* ------------------------------------------------------------------ */

/** La carte qui analyse les objectifs d'un projet, tant qu'elle n'est pas archivée. */
export function carteDesObjectifs(id: string): Card | null {
  const l = getDb().prepare('SELECT carte_objectifs_id FROM marketing_espaces WHERE project_id = ?').get(id) as { carte_objectifs_id: string | null } | undefined;
  const carte = l?.carte_objectifs_id ? store.getCard(l.carte_objectifs_id) ?? null : null;
  return carte && carte.column !== 'archived' ? carte : null;
}

/** La même, seulement si le travail n'est pas fait : en demande ou au travail. */
function carteDesObjectifsEnTravail(id: string): Card | null {
  const c = carteDesObjectifs(id);
  return c && (c.column === 'planned' || c.column === 'running') ? c : null;
}

/**
 * ANALYSER LES OBJECTIFS D'UN SITE (demande du 28/09/2026) : au passage en
 * suivi complet, puis à la demande (« Relancer l'analyse des objectifs ») pour
 * un site ancien dont le parcours a pu changer. Un agent relit le site et son
 * code, repose les repères qui manquent et redéclare la liste ENTIÈRE avec ses
 * objectifs (outil « statistiques », action « reperes »).
 *
 *  - un SITE AUTONOME passe par son étude (`etudierLeSite`), dans le projet
 *    Beluga : son code ne vit pas ici ;
 *  - une carte d'analyse — ou d'installation, qui porte déjà la consigne des
 *    objectifs — encore en demande ou au travail est rendue telle quelle :
 *    changer de mode dix fois ne fait pas dix cartes ;
 *  - la carte naît dans le PROJET, son cadrage part seul, le travail attend le
 *    clic de l'utilisateur (`faireNaitreLaCarte`, premier tour).
 */
export async function analyserLesObjectifs(id: string): Promise<{ card: Card; deja: boolean }> {
  if (estSiteAutonome(id)) {
    const { card, deja } = await etudierLeSite(id);
    return { card, deja };
  }
  const projet = store.getProject(id);
  if (!projet || projet.archived || estUnRegroupement(projet)) throw new Error('site introuvable');
  const espace = assurerEspace(id);
  const deja = carteDesObjectifsEnTravail(id) ?? carteDuSuiviEnTravail(id);
  if (deja) return { card: deja, deja: true };
  const reperes = lireLesReperes(id);
  const parcours = lireLesParcours(id);
  const adresse = espace.configuration.adresse;
  const description = [
    `ANALYSER LES OBJECTIFS DU SITE de ce projet${adresse ? ` (${adresse})` : ''} pour son suivi des visites, en suivi ${espace.modeSuivi === 'visiteur' ? 'complet' : 'anonyme'}. Le code de suivi est déjà posé ou le sera par sa propre carte : ne le touche pas, sauf s’il manque dans le <head>.`,
    '',
    reperes.length
      ? `REPÈRES DÉJÀ DÉCLARÉS (${reperes.length}, le ${new Date(Math.max(...reperes.map((r) => r.creeLe))).toISOString().slice(0, 10)}) — le site a pu changer depuis : garde ceux qui existent encore, retire ceux dont l’élément a disparu, ajoute ce qui manque.\n${reperes.map((r) => `- ${r.nom}${r.objectif ? ' [objectif]' : ''} — ${r.emplacement}`).join('\n')}`
      : 'AUCUN REPÈRE DÉCLARÉ : pars de zéro.',
    '',
    parcours.length
      ? `PARCOURS DÉJÀ DÉCLARÉS (${parcours.length}) — garde ceux qui ont encore un sens, corrige leurs étapes, ajoutes-en si le site en a d’autres :\n${parcours.map((p) => `- ${p.nom} : ${p.etapes.map((e) => e.libelle || e.repere).join(' → ')}${p.objectif ? ` (réussi quand : ${p.objectif})` : ''}`).join('\n')}`
      : 'AUCUN PARCOURS DÉCLARÉ : définis-les.',
    '',
    consigneDesObjectifs('visiteur'),
    '',
    'Chaque repère déclaré doit exister dans le code servi (data-beluga-repere). Déclare la liste ENTIÈRE des repères ET des parcours (outil « statistiques », action « reperes » avec « reperes » et « parcours »), puis enregistre et sauvegarde (commit + push). Tu ne publies pas.',
  ].join('\n');
  const { faireNaitreLaCarte } = await import('./naissance-de-carte.js');
  const { card } = await faireNaitreLaCarte(
    id,
    { auteur: 'marketing', title: 'Analyser les objectifs du suivi', description, labels: [LABEL_ETUDE_DE_SITE], origin: 'agent' },
    { premierTour: true },
  );
  getDb().prepare('UPDATE marketing_espaces SET carte_objectifs_id = ? WHERE project_id = ?').run(card.id, id);
  diffuser(id);
  return { card, deja: false };
}

/** LA FRISE D'UN VISITEUR reconnu (mode visiteur), toutes ses sessions gardées. */
export function friseDUnVisiteur(id: string, visiteur: unknown) {
  const v = identifiantDeNavigateur(visiteur);
  if (!v) throw new Error('visiteur illisible');
  if (!lireEspace(id)) throw new Error('site introuvable');
  return { visiteur: v, sessions: friseDuVisiteur(evenementsDuVisiteur(id, v), v) };
}

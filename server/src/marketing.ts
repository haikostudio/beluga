import crypto from 'node:crypto';
import {
  agentEstUnRobot,
  type ActionMarketing,
  type ConfigurationMarketing,
  type ContenuMarketing,
  type EspaceMarketing,
  type EtapeContenu,
  type EvenementDeSuivi,
  type FicheMarketing,
  type SourceVentes,
  type Vente,
  CANAUX_CONTENU,
  CLES_CANAUX,
  ETAPES_CONTENU,
  GENRES_CONTENU,
  LABEL_MARKETING,
  TAILLE_EVENEMENT_MAX,
  annonceDeLivraison,
  agentTientSonTour,
  appareilDe,
  configurationVide,
  estUnRegroupement,
  estLHeureDuPlanHebdo,
  extraitDeSuivi,
  fusionnerConfiguration,
  fusionnerFiche,
  guideDuProjet,
  heureValide,
  jourValide,
  jugerEvenementDeSuivi,
  lundiDe,
  origineAutorisee,
  origineDe,
  phraseDeConfidentialite,
  raisonActionRefusee,
  rapportPropre,
  raisonRapportRefuse,
  resumeDesResultats,
  sourceDeLaVisite,
  contenusEnRetard,
  estLHeureDeLaReorganisation,
  jourLocalDe,
  productionAutomatiqueSuspendue,
  rythmeDeLUtilisateur,
  transitionPermise,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { mediasDuContenuMarketing } from './studio.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * L'ATELIER MARKETING — la base, le compteur de visites et les minuteurs.
 *
 * Les règles vivent dans `shared/src/marketing.ts`. Ici : les tables, la porte
 * PUBLIQUE qui reçoit les visites des sites (où qu'ils soient hébergés), les
 * liens de suivi, le rangement des vieux événements et le rendez-vous du
 * dimanche soir.
 *
 * AUCUNE DONNÉE PERSONNELLE N'EST GARDÉE. L'adresse IP n'est jamais écrite :
 * elle entre, avec le navigateur, dans un hachage salé par un SEL DU JOUR tiré
 * au hasard et gardé en mémoire seulement — le lendemain, personne (pas même
 * le serveur) ne peut relier deux passages.
 */

/** L'adresse publique de Beluga, d'où les sites chargent le script et où ils envoient leurs visites (MEM-1175). */
export function adresseDeBeluga(): string {
  return (process.env.BELUGA_ADRESSE_PUBLIQUE || 'https://belugatool.haikostudio.cloud').replace(/\/+$/, '');
}

/* ------------------------------------------------------------------ */
/* Espaces                                                             */
/* ------------------------------------------------------------------ */

interface LigneEspace {
  project_id: string;
  agent_id: string | null;
  card_id: string | null;
  cle_suivi: string;
  nature: string | null;
  hebergement: string | null;
  hebergement_detail: string | null;
  adresse: string | null;
  origines: string;
  sources_ventes: string;
  objectifs: string;
  canaux: string;
  methode_suivi: string | null;
  etat_suivi: string;
  langue: string;
  explication: string | null;
  fiche: string;
  suivi_verifie_le: number | null;
  plan_hebdo_pour: string | null;
  rapport: string | null;
  rapport_le: number | null;
  recommandations_canaux: string | null;
  actif: number | null;
  nom: string | null;
  mode_suivi: string | null;
  cree_le: number;
  maj_le: number;
}

function json<T>(texte: string | null | undefined, repli: T): T {
  if (!texte) return repli;
  try {
    return JSON.parse(texte) as T;
  } catch {
    return repli;
  }
}

function depuisLigneEspace(l: LigneEspace): EspaceMarketing {
  const configuration: ConfigurationMarketing = {
    ...configurationVide(),
    nature: (l.nature as ConfigurationMarketing['nature']) ?? undefined,
    hebergement: (l.hebergement as ConfigurationMarketing['hebergement']) ?? undefined,
    hebergementDetail: l.hebergement_detail ?? undefined,
    adresse: l.adresse ?? undefined,
    origines: json<string[]>(l.origines, []),
    sourcesVentes: json(l.sources_ventes, []),
    objectifs: json(l.objectifs, []),
    canaux: json(l.canaux, []),
    recommandations: json(l.recommandations_canaux, []),
    methodeSuivi: (l.methode_suivi as ConfigurationMarketing['methodeSuivi']) ?? undefined,
    etatSuivi: (l.etat_suivi as ConfigurationMarketing['etatSuivi']) ?? 'absent',
    langue: (l.langue as ConfigurationMarketing['langue']) ?? 'fr',
    explication: l.explication ?? undefined,
  };
  return {
    projectId: l.project_id,
    agentId: l.agent_id ?? undefined,
    cardId: l.card_id ?? undefined,
    cleSuivi: l.cle_suivi,
    configuration,
    fiche: json<FicheMarketing>(l.fiche, {}),
    suiviVerifieLe: l.suivi_verifie_le ?? undefined,
    rapport: l.rapport ?? undefined,
    rapportLe: l.rapport_le ?? undefined,
    actif: l.actif !== 0,
    modeSuivi: l.mode_suivi === 'visiteur' ? 'visiteur' : 'anonyme',
    ...(l.nom ? { nom: l.nom } : {}),
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function lireEspace(projectId: string): EspaceMarketing | null {
  const l = getDb().prepare('SELECT * FROM marketing_espaces WHERE project_id = ?').get(projectId) as LigneEspace | undefined;
  return l ? depuisLigneEspace(l) : null;
}

export function listerEspaces(): EspaceMarketing[] {
  return (getDb().prepare('SELECT * FROM marketing_espaces ORDER BY cree_le ASC').all() as LigneEspace[]).map(depuisLigneEspace);
}

export function espaceParCle(cle: string): EspaceMarketing | null {
  const l = getDb().prepare('SELECT * FROM marketing_espaces WHERE cle_suivi = ?').get(cle) as LigneEspace | undefined;
  return l ? depuisLigneEspace(l) : null;
}

/** L'espace d'un projet, créé à la première demande avec sa clé de suivi. */
export function assurerEspace(projectId: string, maintenant = Date.now()): EspaceMarketing {
  const deja = lireEspace(projectId);
  if (deja) return deja;
  if (!store.getProject(projectId)) throw new Error('projet introuvable');
  const cle = crypto.randomBytes(9).toString('base64url');
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO marketing_espaces (project_id, cle_suivi, origines, sources_ventes, objectifs, canaux, etat_suivi, langue, fiche, cree_le, maj_le)
       VALUES (?, ?, '[]', '[]', '[]', '[]', 'absent', 'fr', '{}', ?, ?)`,
    )
    .run(projectId, cle, maintenant, maintenant);
  return lireEspace(projectId)!;
}

export function diffuser(projectId: string): void {
  bus.emit({ type: 'marketing', projectId });
}

/**
 * COUPER OU RENDRE LE SUIVI MARKETING D'UN PROJET. Un projet sans espace en
 * reçoit un : c'est lui qui porte le drapeau.
 */
export function ecrireActif(projectId: string, actif: boolean, maintenant = Date.now()): EspaceMarketing {
  assurerEspace(projectId, maintenant);
  getDb().prepare('UPDATE marketing_espaces SET actif = ?, maj_le = ? WHERE project_id = ?').run(actif ? 1 : 0, maintenant, projectId);
  diffuser(projectId);
  return lireEspace(projectId)!;
}

export function ecrireConfiguration(projectId: string, recue: Record<string, unknown>, maintenant = Date.now()): EspaceMarketing {
  const espace = assurerEspace(projectId);
  const c = fusionnerConfiguration(espace.configuration, recue);
  // Choisir une méthode de pose ne pose pas le script : l'état ne bouge qu'au geste (`marquerSuiviPose`) ou à la première visite.
  getDb()
    .prepare(
      `UPDATE marketing_espaces SET nature = ?, hebergement = ?, hebergement_detail = ?, adresse = ?, origines = ?, sources_ventes = ?,
         objectifs = ?, canaux = ?, recommandations_canaux = ?, methode_suivi = ?, langue = ?, explication = ?, maj_le = ? WHERE project_id = ?`,
    )
    .run(
      c.nature ?? null,
      c.hebergement ?? null,
      c.hebergementDetail ?? null,
      c.adresse ?? null,
      JSON.stringify(c.origines),
      JSON.stringify(c.sourcesVentes),
      JSON.stringify(c.objectifs),
      JSON.stringify(c.canaux),
      JSON.stringify(c.recommandations ?? []),
      c.methodeSuivi ?? null,
      c.langue,
      c.explication ?? null,
      maintenant,
      projectId,
    );
  diffuser(projectId);
  return lireEspace(projectId)!;
}

export function ecrireFiche(projectId: string, recue: Record<string, unknown>, maintenant = Date.now()): EspaceMarketing {
  const espace = assurerEspace(projectId);
  const fiche = fusionnerFiche(espace.fiche, recue);
  getDb().prepare('UPDATE marketing_espaces SET fiche = ?, maj_le = ? WHERE project_id = ?').run(JSON.stringify(fiche), maintenant, projectId);
  diffuser(projectId);
  return lireEspace(projectId)!;
}

/**
 * LE RAPPORT DE L'AGENT, entier à chaque fois : il remplace le précédent. La
 * porte (`raisonRapportRefuse`) exige d'abord nature et hébergement, pour que
 * le Guide dise vrai.
 */
export function ecrireRapport(
  projectId: string,
  rapport: unknown,
  maintenant = Date.now(),
): { ok: true; espace: EspaceMarketing } | { ok: false; raison: string } {
  const espace = assurerEspace(projectId);
  const refus = raisonRapportRefuse(espace.configuration, rapport);
  if (refus) return { ok: false, raison: refus };
  getDb()
    .prepare('UPDATE marketing_espaces SET rapport = ?, rapport_le = ?, maj_le = ? WHERE project_id = ?')
    .run(rapportPropre(rapport), maintenant, maintenant, projectId);
  diffuser(projectId);
  return { ok: true, espace: lireEspace(projectId)! };
}

export function marquerAgentMarketing(projectId: string, agentId: string, cardId: string): void {
  assurerEspace(projectId);
  getDb().prepare('UPDATE marketing_espaces SET agent_id = ?, card_id = ?, maj_le = ? WHERE project_id = ?').run(agentId, cardId, Date.now(), projectId);
  diffuser(projectId);
}

/**
 * L'AGENT PORTE-T-IL UNE CARTE MARKETING ? C'est ce qui lui ouvre l'outil
 * « marketing » et lui garde sa consigne d'un tour à l'autre : l'agent attitré
 * comme celui du dimanche soir. Aucun autre agent ne voit cet outil.
 */
export function estAgentMarketing(agentId: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId) return false;
  /*
   * LA CARTE « INSTALLER LE SUIVI » PORTE AUSSI L'ÉTIQUETTE MARKETING, mais ce
   * n'est pas l'atelier : son agent de CADRAGE, puis son agent de tâche dans sa
   * copie de travail, gardent leur propre consigne. L'agent de l'atelier naît
   * sans copie de travail (`ouvrirCarteDAgent`).
   */
  if (agent.role === 'cadrage' || (agent as { workdir?: string }).workdir) return false;
  return !!store.getCard(agent.cardId)?.labels.includes(LABEL_MARKETING);
}

/**
 * Le script est POSÉ par un geste annoncé (plateforme, marche à suivre) : il
 * reste à voir passer la première visite. Jamais appelé à la naissance d'une
 * carte : une carte n'est pas un code posé (`etatSuiviApresDiagnostic`).
 */
export function marquerSuiviPose(projectId: string): void {
  getDb()
    .prepare("UPDATE marketing_espaces SET etat_suivi = CASE WHEN etat_suivi = 'verifie' THEN 'verifie' ELSE 'pose' END, maj_le = ? WHERE project_id = ?")
    .run(Date.now(), projectId);
  diffuser(projectId);
}

/* ------------------------------------------------------------------ */
/* Contenus                                                            */
/* ------------------------------------------------------------------ */

interface LigneContenu {
  id: string;
  project_id: string;
  genre: string;
  canal: string;
  titre: string;
  texte: string;
  date_prevue: string | null;
  heure_prevue: string | null;
  etape: string;
  origine: string;
  variante_de: string | null;
  lien_code: string | null;
  lien_cible: string | null;
  url_publiee: string | null;
  raison_echec: string | null;
  source_ref: string | null;
  cree_le: number;
  maj_le: number;
}

function depuisLigneContenu(l: LigneContenu): ContenuMarketing {
  return {
    id: l.id,
    projectId: l.project_id,
    genre: l.genre as ContenuMarketing['genre'],
    canal: l.canal as ContenuMarketing['canal'],
    titre: l.titre,
    texte: l.texte,
    datePrevue: l.date_prevue ?? undefined,
    heurePrevue: l.heure_prevue ?? undefined,
    etape: l.etape as EtapeContenu,
    origine: l.origine as ContenuMarketing['origine'],
    varianteDe: l.variante_de ?? undefined,
    lienCode: l.lien_code ?? undefined,
    lienCible: l.lien_cible ?? undefined,
    urlPubliee: l.url_publiee ?? undefined,
    raisonEchec: l.raison_echec ?? undefined,
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function listerContenus(projectId: string): ContenuMarketing[] {
  return (
    getDb().prepare('SELECT * FROM marketing_contenus WHERE project_id = ? ORDER BY COALESCE(date_prevue, \'9999\') ASC, cree_le DESC').all(projectId) as LigneContenu[]
  ).map(depuisLigneContenu);
}

export function lireContenu(id: string): ContenuMarketing | null {
  const l = getDb().prepare('SELECT * FROM marketing_contenus WHERE id = ?').get(id) as LigneContenu | undefined;
  return l ? depuisLigneContenu(l) : null;
}

export type ResultatContenu = { ok: true; contenu: ContenuMarketing } | { ok: false; raison: string };

function texteContenu(valeur: unknown, max: number): string {
  return typeof valeur === 'string' ? valeur.trim().slice(0, max) : '';
}

/**
 * CRÉE UN CONTENU. L'agent ne dépose qu'en « Brouillon » ou « À valider » ;
 * chaque contenu reçoit son lien de suivi. Une `sourceRef` déjà vue (une
 * livraison déjà annoncée) ne crée rien une seconde fois.
 */
export function creerContenu(entree: {
  projectId: string;
  genre: unknown;
  canal: unknown;
  titre: unknown;
  texte: unknown;
  datePrevue?: unknown;
  etape?: unknown;
  origine: ContenuMarketing['origine'];
  varianteDe?: unknown;
  lienCible?: unknown;
  sourceRef?: string;
  maintenant?: number;
}): ResultatContenu {
  const maintenant = entree.maintenant ?? Date.now();
  if (!store.getProject(entree.projectId)) return { ok: false, raison: 'Projet introuvable.' };
  const genre = (GENRES_CONTENU as readonly string[]).includes(String(entree.genre)) ? String(entree.genre) : 'post';
  const canal = (CANAUX_CONTENU as readonly string[]).includes(String(entree.canal)) ? String(entree.canal) : 'autre';
  const titre = texteContenu(entree.titre, 160);
  const texte = texteContenu(entree.texte, 8000);
  if (!titre) return { ok: false, raison: 'Un contenu a besoin d’un titre.' };
  if (!texte) return { ok: false, raison: 'Un contenu a besoin d’un texte.' };
  const etape = entree.etape === 'a_valider' ? 'a_valider' : 'brouillon';
  const datePrevue = jourValide(entree.datePrevue) ? entree.datePrevue : null;
  let varianteDe: string | null = null;
  if (typeof entree.varianteDe === 'string' && entree.varianteDe) {
    const a = lireContenu(entree.varianteDe);
    if (!a || a.projectId !== entree.projectId) return { ok: false, raison: `Aucun contenu « ${entree.varianteDe} » dans ce projet.` };
    varianteDe = a.id;
  }
  if (entree.sourceRef) {
    const deja = getDb().prepare('SELECT id FROM marketing_contenus WHERE project_id = ? AND source_ref = ?').get(entree.projectId, entree.sourceRef) as { id: string } | undefined;
    if (deja) return { ok: true, contenu: lireContenu(deja.id)! };
  }
  const espace = assurerEspace(entree.projectId);
  const id = `mc_${crypto.randomBytes(6).toString('base64url')}`;
  const lienCode = crypto.randomBytes(5).toString('base64url');
  const lienCible = origineDe(entree.lienCible) ? String(entree.lienCible).trim().slice(0, 500) : (espace.configuration.adresse ?? null);
  getDb()
    .prepare(
      `INSERT INTO marketing_contenus (id, project_id, genre, canal, titre, texte, date_prevue, etape, origine, variante_de, lien_code, lien_cible, source_ref, cree_le, maj_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, entree.projectId, genre, canal, titre, texte, datePrevue, etape, entree.origine, varianteDe, lienCode, lienCible, entree.sourceRef ?? null, maintenant, maintenant);
  diffuser(entree.projectId);
  return { ok: true, contenu: lireContenu(id)! };
}

/**
 * MODIFIE UN CONTENU. L'agent ne touche qu'à un contenu encore en
 * « Brouillon » ou « À valider » : ce que l'utilisateur a validé ne bouge plus
 * sans lui.
 */
export function modifierContenu(
  id: string,
  patch: { titre?: unknown; texte?: unknown; canal?: unknown; datePrevue?: unknown; heurePrevue?: unknown; lienCible?: unknown },
  parQui: 'humain' | 'agent',
  projectId?: string,
): ResultatContenu {
  const c = lireContenu(id);
  if (!c || (projectId && c.projectId !== projectId)) return { ok: false, raison: `Aucun contenu « ${id} » dans ce projet.` };
  if (parQui === 'agent' && c.etape !== 'brouillon' && c.etape !== 'a_valider') {
    return { ok: false, raison: 'Ce contenu est déjà validé : seul l’utilisateur peut encore le modifier.' };
  }
  if (c.etape === 'publie') return { ok: false, raison: 'Un contenu publié ne se modifie plus.' };
  const titre = patch.titre !== undefined ? texteContenu(patch.titre, 160) || c.titre : c.titre;
  const texte = patch.texte !== undefined ? texteContenu(patch.texte, 8000) || c.texte : c.texte;
  const canal = (CANAUX_CONTENU as readonly string[]).includes(String(patch.canal)) ? String(patch.canal) : c.canal;
  const datePrevue = patch.datePrevue === null || patch.datePrevue === '' ? null : jourValide(patch.datePrevue) ? patch.datePrevue : (c.datePrevue ?? null);
  const heurePrevue = patch.heurePrevue === null || patch.heurePrevue === '' ? null : heureValide(patch.heurePrevue) ? patch.heurePrevue : (c.heurePrevue ?? null);
  if (c.etape === 'programme' && !datePrevue) return { ok: false, raison: 'Un contenu programmé garde sa date.' };
  const lienCible =
    patch.lienCible === null || patch.lienCible === '' ? null : origineDe(patch.lienCible) ? String(patch.lienCible).trim().slice(0, 500) : (c.lienCible ?? null);
  getDb()
    .prepare('UPDATE marketing_contenus SET titre = ?, texte = ?, canal = ?, date_prevue = ?, heure_prevue = ?, lien_cible = ?, maj_le = ? WHERE id = ?')
    .run(titre, texte, canal, datePrevue, heurePrevue, lienCible, Date.now(), id);
  diffuser(c.projectId);
  return { ok: true, contenu: lireContenu(id)! };
}

export function changerEtape(id: string, vers: unknown, parQui: 'humain' | 'agent' | 'systeme', projectId?: string): ResultatContenu {
  const c = lireContenu(id);
  if (!c || (projectId && c.projectId !== projectId)) return { ok: false, raison: `Aucun contenu « ${id} » dans ce projet.` };
  if (!(ETAPES_CONTENU as readonly string[]).includes(String(vers))) return { ok: false, raison: `Étape inconnue : « ${vers} ».` };
  const etape = String(vers) as EtapeContenu;
  const refus = transitionPermise({ de: c.etape, vers: etape, parQui, datePrevue: c.datePrevue });
  if (refus) return { ok: false, raison: refus };
  getDb().prepare('UPDATE marketing_contenus SET etape = ?, raison_echec = CASE WHEN ? = \'echec\' THEN raison_echec ELSE NULL END, maj_le = ? WHERE id = ?').run(etape, etape, Date.now(), id);
  diffuser(c.projectId);
  return { ok: true, contenu: lireContenu(id)! };
}

export function supprimerContenu(id: string): { ok: boolean; raison?: string } {
  const c = lireContenu(id);
  if (!c) return { ok: false, raison: 'contenu introuvable' };
  if (c.etape === 'publie') return { ok: false, raison: 'Un contenu publié reste dans l’historique : abandonnez plutôt les suivants.' };
  getDb().prepare('DELETE FROM marketing_contenus WHERE id = ?').run(id);
  diffuser(c.projectId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Le plan d'action                                                    */
/* ------------------------------------------------------------------ */

interface LigneAction {
  id: string;
  project_id: string;
  titre: string;
  detail: string;
  canal: string | null;
  date_prevue: string | null;
  fait_le: number | null;
  cree_le: number;
  maj_le: number;
}

function depuisLigneAction(l: LigneAction): ActionMarketing {
  return {
    id: l.id,
    projectId: l.project_id,
    titre: l.titre,
    detail: l.detail,
    canal: l.canal ?? undefined,
    datePrevue: l.date_prevue ?? undefined,
    faitLe: l.fait_le ?? undefined,
    creeLe: l.cree_le,
    majLe: l.maj_le,
  };
}

export function listerActions(projectId: string): ActionMarketing[] {
  return (
    getDb().prepare("SELECT * FROM marketing_actions WHERE project_id = ? ORDER BY COALESCE(date_prevue, '9999') ASC, cree_le ASC").all(projectId) as LigneAction[]
  ).map(depuisLigneAction);
}

export function lireAction(id: string): ActionMarketing | null {
  const l = getDb().prepare('SELECT * FROM marketing_actions WHERE id = ?').get(id) as LigneAction | undefined;
  return l ? depuisLigneAction(l) : null;
}

export type ResultatAction = { ok: true; action: ActionMarketing } | { ok: false; raison: string };

/**
 * POSE OU CORRIGE UNE ACTION DU PLAN. Sans « id », elle naît (titre et date
 * exigés) ; avec, ce qui n'est pas redit est gardé. L'agent ne coche jamais
 * « fait » : c'est `marquerActionFaite`, un geste de l'utilisateur.
 */
export function ecrireAction(
  projectId: string,
  entree: { id?: unknown; titre?: unknown; detail?: unknown; canal?: unknown; datePrevue?: unknown },
  maintenant = Date.now(),
): ResultatAction {
  if (!store.getProject(projectId)) return { ok: false, raison: 'Projet introuvable.' };
  const id = typeof entree.id === 'string' && entree.id ? entree.id : null;
  const ancienne = id ? lireAction(id) : null;
  if (id && (!ancienne || ancienne.projectId !== projectId)) return { ok: false, raison: `Aucune action « ${id} » dans ce projet.` };
  const refus = raisonActionRefusee(entree, !ancienne);
  if (refus) return { ok: false, raison: refus };
  const titre = texteContenu(entree.titre, 160) || ancienne?.titre || '';
  const detail = entree.detail !== undefined ? texteContenu(entree.detail, 2000) : (ancienne?.detail ?? '');
  const canal =
    entree.canal === null || entree.canal === '' ? null : CLES_CANAUX.includes(String(entree.canal)) ? String(entree.canal) : (ancienne?.canal ?? null);
  const datePrevue = jourValide(entree.datePrevue) ? entree.datePrevue : (ancienne?.datePrevue ?? null);
  if (ancienne) {
    getDb()
      .prepare('UPDATE marketing_actions SET titre = ?, detail = ?, canal = ?, date_prevue = ?, maj_le = ? WHERE id = ?')
      .run(titre, detail, canal, datePrevue, maintenant, ancienne.id);
    diffuser(projectId);
    return { ok: true, action: lireAction(ancienne.id)! };
  }
  const nouvel = `ma_${crypto.randomBytes(6).toString('base64url')}`;
  getDb()
    .prepare('INSERT INTO marketing_actions (id, project_id, titre, detail, canal, date_prevue, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nouvel, projectId, titre, detail, canal, datePrevue, maintenant, maintenant);
  diffuser(projectId);
  return { ok: true, action: lireAction(nouvel)! };
}

export function marquerActionFaite(id: string, fait: boolean, maintenant = Date.now()): ResultatAction {
  const a = lireAction(id);
  if (!a) return { ok: false, raison: 'action introuvable' };
  getDb().prepare('UPDATE marketing_actions SET fait_le = ?, maj_le = ? WHERE id = ?').run(fait ? maintenant : null, maintenant, id);
  diffuser(a.projectId);
  return { ok: true, action: lireAction(id)! };
}

export function supprimerAction(id: string, projectId?: string): { ok: boolean; raison?: string } {
  const a = lireAction(id);
  if (!a || (projectId && a.projectId !== projectId)) return { ok: false, raison: `Aucune action « ${id} » dans ce projet.` };
  getDb().prepare('DELETE FROM marketing_actions WHERE id = ?').run(id);
  diffuser(a.projectId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La porte publique : script, visites, liens                          */
/* ------------------------------------------------------------------ */

let selDuJour: { jour: string; sel: Buffer } | null = null;

/** Le visiteur du jour : l'adresse et le navigateur, hachés avec un sel qui meurt à minuit. */
function visiteurDuJour(ip: string, userAgent: string, cle: string, maintenant: number): string {
  const jour = new Date(maintenant).toISOString().slice(0, 10);
  if (!selDuJour || selDuJour.jour !== jour) selDuJour = { jour, sel: crypto.randomBytes(32) };
  return crypto.createHmac('sha256', selDuJour.sel).update(`${cle}|${ip}|${userAgent}`).digest('base64url').slice(0, 16);
}

/** Limitation de débit : au plus N événements par minute et par adresse. */
const DEBIT_MAX_PAR_MINUTE = 120;
const compteurs = new Map<string, { minute: number; n: number }>();

function debitDepasse(ip: string, maintenant: number): boolean {
  const minute = Math.floor(maintenant / 60_000);
  const c = compteurs.get(ip);
  if (!c || c.minute !== minute) {
    if (compteurs.size > 50_000) compteurs.clear();
    compteurs.set(ip, { minute, n: 1 });
    return false;
  }
  c.n += 1;
  return c.n > DEBIT_MAX_PAR_MINUTE;
}

/**
 * `mode` : rendu à la première page vue, pour que le script sache s'il doit
 * montrer le bandeau d'accord (« v ») ou rester anonyme (« a »), et dans quelle
 * langue par défaut.
 */
export type RecuDeSuivi = { ok: true; mode?: { m: 'a' | 'v'; l: string } } | { ok: false; statut: number; raison: string };

/**
 * REÇOIT UN ÉVÉNEMENT D'UNE PAGE. Refusé : trop gros, trop fréquent, clé
 * inconnue, ou venu d'un site que le projet n'a pas déclaré. La première visite
 * reçue fait passer le suivi à « vérifié ».
 */
export function recevoirEvenement(entree: {
  corps: string;
  origine?: string;
  ip: string;
  userAgent?: string;
  /** Le code pays déjà déduit de l'adresse (`paysDeLaRequete`) : seul lui est écrit. */
  pays?: string;
  maintenant?: number;
}): RecuDeSuivi {
  const maintenant = entree.maintenant ?? Date.now();
  if (entree.corps.length > TAILLE_EVENEMENT_MAX) return { ok: false, statut: 413, raison: 'trop gros' };
  if (debitDepasse(entree.ip, maintenant)) return { ok: false, statut: 429, raison: 'trop d’envois' };
  let brut: any;
  try {
    brut = JSON.parse(entree.corps);
  } catch {
    return { ok: false, statut: 400, raison: 'illisible' };
  }
  const cle = typeof brut?.k === 'string' ? brut.k : '';
  const espace = cle ? espaceParCle(cle) : null;
  if (!espace) return { ok: false, statut: 404, raison: 'clé inconnue' };
  if (!origineAutorisee(entree.origine, espace.configuration)) return { ok: false, statut: 403, raison: 'site non déclaré' };
  const juge = jugerEvenementDeSuivi(brut);
  if (!juge.ok) return { ok: false, statut: 400, raison: juge.raison };
  // Un robot (navigateur sans écran, indexeur, contrôle) n'est ni compté ni pris pour la première visite.
  if (agentEstUnRobot(entree.userAgent)) return { ok: true };
  const e = juge.evenement;
  /* LES IDENTIFIANTS DU MODE VISITEUR ne sont gardés que si l'espace est EN
     mode visiteur : un script resté avec un ancien accord, ou une page qui les
     invente, n'écrit rien de persistant sur un site anonyme. */
  const visiteurMode = espace.modeSuivi === 'visiteur';
  const evenement: EvenementDeSuivi = {
    ...e,
    ...(visiteurMode && juge.visiteurPersistant ? { visiteurPersistant: juge.visiteurPersistant } : {}),
    ...(visiteurMode && juge.visiteurPersistant && juge.session ? { session: juge.session } : {}),
    instant: maintenant,
    visiteur: visiteurDuJour(entree.ip, entree.userAgent ?? '', cle, maintenant),
    source: e.type === 'vue' || e.type === 'session' ? sourceDeLaVisite({ referent: juge.referent, utm: juge.utm, origineDuSite: entree.origine }) : undefined,
    appareil: appareilDe(entree.userAgent),
    ...(entree.pays ? { pays: entree.pays } : {}),
  };
  // Un contenu inconnu de ce projet n'est pas crédité : un paramètre recopié ne fausse pas les chiffres.
  if (evenement.contenuId && !contenuDuProjetParCode(espace.projectId, evenement.contenuId)) delete evenement.contenuId;
  else if (evenement.contenuId) evenement.contenuId = contenuDuProjetParCode(espace.projectId, evenement.contenuId)!;
  ecrireEvenement(espace.projectId, evenement);
  if (evenement.type === 'achat' && typeof evenement.montantCentimes === 'number') {
    enregistrerVente(espace.projectId, {
      instant: maintenant,
      montantCentimes: evenement.montantCentimes,
      devise: evenement.devise ?? 'EUR',
      source: 'suivi',
      reference: evenement.reference,
      visiteur: evenement.visiteur,
      contenuId: evenement.contenuId,
    });
  }
  if (espace.configuration.etatSuivi !== 'verifie') {
    getDb().prepare("UPDATE marketing_espaces SET etat_suivi = 'verifie', suivi_verifie_le = ?, maj_le = ? WHERE project_id = ?").run(maintenant, maintenant, espace.projectId);
    diffuser(espace.projectId);
    log.info(`marketing : première visite reçue pour ${espace.projectId}, suivi vérifié`);
  }
  if (evenement.type === 'vue') return { ok: true, mode: { m: visiteurMode ? 'v' : 'a', l: espace.configuration.langue } };
  return { ok: true };
}

/** Le lien de suivi d'un contenu porte son code ; la visite garde l'identifiant. */
function contenuDuProjetParCode(projectId: string, code: string): string | null {
  const l = getDb().prepare('SELECT id FROM marketing_contenus WHERE project_id = ? AND (lien_code = ? OR id = ?)').get(projectId, code, code) as { id: string } | undefined;
  return l?.id ?? null;
}

function ecrireEvenement(projectId: string, e: EvenementDeSuivi): void {
  getDb()
    .prepare(
      `INSERT INTO marketing_evenements (project_id, instant, type, chemin, source, contenu_id, visiteur, visite, duree_ms, montant_centimes, devise, reference, objectif, variante, retour, appareil, visiteur_persistant, session, repere, pays)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      e.instant,
      e.type,
      e.chemin ?? null,
      e.source ?? null,
      e.contenuId ?? null,
      e.visiteur,
      e.visite ?? null,
      e.dureeMs ?? null,
      e.montantCentimes ?? null,
      e.devise ?? null,
      e.reference ?? null,
      e.objectif ?? null,
      e.variante ?? null,
      e.retour ? 1 : 0,
      e.appareil ?? null,
      e.visiteurPersistant ?? null,
      e.session ?? null,
      e.repere ?? null,
      e.pays ?? null,
    );
}

/** UNE VENTE, d'où qu'elle vienne. La référence dédoublonne : deux sources, une vente. */
export function enregistrerVente(projectId: string, v: Vente): void {
  const reference = v.reference ? v.reference.slice(0, 80) : null;
  if (reference) {
    const deja = getDb().prepare('SELECT id, contenu_id FROM marketing_ventes WHERE project_id = ? AND reference = ?').get(projectId, reference) as
      | { id: number; contenu_id: string | null }
      | undefined;
    if (deja) {
      if (!deja.contenu_id && v.contenuId) getDb().prepare('UPDATE marketing_ventes SET contenu_id = ? WHERE id = ?').run(v.contenuId, deja.id);
      return;
    }
  }
  getDb()
    .prepare('INSERT INTO marketing_ventes (project_id, instant, montant_centimes, devise, source, reference, visiteur, contenu_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, v.instant, Math.round(v.montantCentimes), v.devise, v.source, reference, v.visiteur ?? null, v.contenuId ?? null);
}

/**
 * UN LIEN DE SUIVI : compte le clic, puis renvoie vers l'adresse du contenu en
 * y ajoutant « bm=<code> » (le script du site le relit et crédite le contenu)
 * et « utm_source=<réseau> ». Rend null pour un code inconnu.
 */
export function suivreLien(code: string, entree: { ip: string; userAgent?: string; maintenant?: number }): string | null {
  const l = getDb().prepare('SELECT * FROM marketing_contenus WHERE lien_code = ?').get(code) as LigneContenu | undefined;
  if (!l) return null;
  const espace = lireEspace(l.project_id);
  const cible = l.lien_cible || espace?.configuration.adresse;
  if (!cible || !origineDe(cible)) return null;
  const maintenant = entree.maintenant ?? Date.now();
  if (!debitDepasse(entree.ip, maintenant) && espace) {
    ecrireEvenement(l.project_id, {
      instant: maintenant,
      type: 'clic',
      contenuId: l.id,
      source: l.canal,
      visiteur: visiteurDuJour(entree.ip, entree.userAgent ?? '', espace.cleSuivi, maintenant),
      appareil: appareilDe(entree.userAgent),
    });
  }
  const url = new URL(cible);
  url.searchParams.set('bm', code);
  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', l.canal);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Résultats et vue d'ensemble                                         */
/* ------------------------------------------------------------------ */

interface LigneEvenement {
  instant: number;
  type: string;
  chemin: string | null;
  source: string | null;
  contenu_id: string | null;
  visiteur: string;
  visite: string | null;
  duree_ms: number | null;
  montant_centimes: number | null;
  devise: string | null;
  reference: string | null;
  objectif: string | null;
  variante: string | null;
  retour: number | null;
  appareil: string | null;
  visiteur_persistant: string | null;
  session: string | null;
  repere: string | null;
  pays: string | null;
}

/** Au-delà, les plus vieux événements de la période sont ignorés — et l'écran le dit. */
const EVENEMENTS_LUS_MAX = 200_000;

function lignesDEvenements(projectId: string, depuis: number, jusqua = Number.MAX_SAFE_INTEGER): LigneEvenement[] {
  return getDb()
    .prepare('SELECT * FROM marketing_evenements WHERE project_id = ? AND instant >= ? AND instant <= ? ORDER BY instant DESC LIMIT ?')
    .all(projectId, depuis, jusqua, EVENEMENTS_LUS_MAX) as LigneEvenement[];
}

/** Une période lue : un nombre de jours jusqu'à maintenant, ou deux bornes (`periodeDesStatistiques`). */
export type PeriodeLue = number | { depuis: number; jusqua: number };

function bornesDe(periode: PeriodeLue, maintenant: number): { depuis: number; jusqua: number } {
  if (typeof periode === 'number') return { depuis: maintenant - Math.max(1, Math.min(90, periode)) * 86_400_000, jusqua: maintenant };
  return periode;
}

/** Les événements bruts d'une période, pour l'analyse des parcours (`shared/src/statistiques.ts`). */
export function evenementsDuProjet(projectId: string, periode: PeriodeLue = 30, maintenant = Date.now()): { evenements: EvenementDeSuivi[]; tronque: boolean } {
  const { depuis, jusqua } = bornesDe(periode, maintenant);
  const lignes = lignesDEvenements(projectId, depuis, jusqua);
  return { evenements: lignes.map(depuisLigneEvenement), tronque: lignes.length >= EVENEMENTS_LUS_MAX };
}

/** Les événements d'UN visiteur reconnu (mode visiteur), sur toute la conservation — index `idx_marketing_evenements_persistant`. */
export function evenementsDuVisiteur(projectId: string, visiteur: string): EvenementDeSuivi[] {
  return (
    getDb()
      .prepare('SELECT * FROM marketing_evenements WHERE project_id = ? AND visiteur_persistant = ? ORDER BY instant ASC LIMIT 5000')
      .all(projectId, visiteur) as LigneEvenement[]
  ).map(depuisLigneEvenement);
}

function depuisLigneEvenement(l: LigneEvenement): EvenementDeSuivi {
  return {
    instant: l.instant,
    type: l.type as EvenementDeSuivi['type'],
    chemin: l.chemin ?? undefined,
    source: l.source ?? undefined,
    contenuId: l.contenu_id ?? undefined,
    visiteur: l.visiteur,
    visite: l.visite ?? undefined,
    dureeMs: l.duree_ms ?? undefined,
    montantCentimes: l.montant_centimes ?? undefined,
    devise: l.devise ?? undefined,
    reference: l.reference ?? undefined,
    objectif: l.objectif ?? undefined,
    variante: (l.variante as 'A' | 'B' | null) ?? undefined,
    retour: l.retour ? true : undefined,
    appareil: (l.appareil as EvenementDeSuivi['appareil']) ?? undefined,
    visiteurPersistant: l.visiteur_persistant ?? undefined,
    session: l.session ?? undefined,
    repere: l.repere ?? undefined,
    pays: l.pays ?? undefined,
  };
}

export function resultatsDuProjet(projectId: string, periode: PeriodeLue = 30, maintenant = Date.now()) {
  const { depuis, jusqua } = bornesDe(periode, maintenant);
  const lignes = lignesDEvenements(projectId, depuis, jusqua);
  const evenements: EvenementDeSuivi[] = lignes.map((l) => ({
    instant: l.instant,
    type: l.type as EvenementDeSuivi['type'],
    chemin: l.chemin ?? undefined,
    source: l.source ?? undefined,
    contenuId: l.contenu_id ?? undefined,
    visiteur: l.visiteur,
    visite: l.visite ?? undefined,
    dureeMs: l.duree_ms ?? undefined,
    montantCentimes: l.montant_centimes ?? undefined,
    devise: l.devise ?? undefined,
    reference: l.reference ?? undefined,
    objectif: l.objectif ?? undefined,
    variante: (l.variante as 'A' | 'B' | null) ?? undefined,
    retour: l.retour ? true : undefined,
    appareil: (l.appareil as EvenementDeSuivi['appareil']) ?? undefined,
  }));
  const ventes = (
    getDb().prepare('SELECT * FROM marketing_ventes WHERE project_id = ? AND instant >= ? AND instant <= ?').all(projectId, depuis, jusqua) as {
      instant: number;
      montant_centimes: number;
      devise: string;
      source: string;
      reference: string | null;
      visiteur: string | null;
      contenu_id: string | null;
    }[]
  ).map(
    (v): Vente => ({
      instant: v.instant,
      montantCentimes: v.montant_centimes,
      devise: v.devise,
      source: v.source as SourceVentes,
      reference: v.reference ?? undefined,
      visiteur: v.visiteur ?? undefined,
      contenuId: v.contenu_id ?? undefined,
    }),
  );
  return { ...resumeDesResultats({ evenements, ventes, depuis, jusqua }), tronque: lignes.length >= EVENEMENTS_LUS_MAX };
}

function compteursDuGuide(projectId: string) {
  const r = getDb()
    .prepare(
      `SELECT SUM(etape = 'publie') AS publies, SUM(etape IN ('a_valider','brouillon')) AS attente FROM marketing_contenus WHERE project_id = ?`,
    )
    .get(projectId) as { publies: number | null; attente: number | null };
  const ventes = (getDb().prepare('SELECT COUNT(*) AS n FROM marketing_ventes WHERE project_id = ?').get(projectId) as { n: number }).n;
  return { contenusPublies: r.publies ?? 0, contenusEnAttente: r.attente ?? 0, ventes, carteDuSuivi: !!carteDuSuivi(projectId) };
}

/** Combien de jours la vue d'ensemble trace, du plus ancien à aujourd'hui. */
export const JOURS_DE_TENDANCE = 28;

/** Les `n` derniers jours (UTC, comme `jourDe`), le plus ancien d'abord. */
function derniersJours(maintenant: number, n = JOURS_DE_TENDANCE): string[] {
  return Array.from({ length: n }, (_, i) => new Date(maintenant - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/**
 * LES VISITES PAR JOUR ET PAR PROJET, sur les quatre dernières semaines, en
 * UNE requête pour tous les projets (index `idx_marketing_evenements_instant`) :
 * la vue d'ensemble ne relit jamais les statistiques complètes de chaque
 * projet. Une visite = une clé de visite distincte, comme `resumeDesResultats`.
 */
function visitesParProjetEtJour(depuis: number): Map<string, Map<string, number>> {
  const lignes = getDb()
    .prepare(
      `SELECT project_id AS projet, strftime('%Y-%m-%d', instant / 1000, 'unixepoch') AS jour,
              COUNT(DISTINCT COALESCE(visite, visiteur || ':' || strftime('%Y-%m-%d', instant / 1000, 'unixepoch'))) AS n
         FROM marketing_evenements
        WHERE instant >= ? AND type IN ('vue', 'session')
        GROUP BY projet, jour`,
    )
    .all(depuis) as { projet: string; jour: string; n: number }[];
  const parProjet = new Map<string, Map<string, number>>();
  for (const l of lignes) {
    if (!parProjet.has(l.projet)) parProjet.set(l.projet, new Map());
    parProjet.get(l.projet)!.set(l.jour, l.n);
  }
  return parProjet;
}

/** Les contenus de chaque projet, comptés par étape — une requête pour tous. */
function contenusParProjet(): Map<string, Record<string, number>> {
  const lignes = getDb()
    .prepare('SELECT project_id AS projet, etape, COUNT(*) AS n FROM marketing_contenus GROUP BY project_id, etape')
    .all() as { projet: string; etape: string; n: number }[];
  const parProjet = new Map<string, Record<string, number>>();
  for (const l of lignes) {
    const r = parProjet.get(l.projet) ?? {};
    r[l.etape] = l.n;
    parProjet.set(l.projet, r);
  }
  return parProjet;
}

/**
 * LA LIGNE D'UN PROJET DANS LE TABLEAU DE BORD de l'outil : où il en est, ce
 * qui attend, sa tendance, et si son agent travaille — sans rien charger
 * d'autre. UN REGROUPEMENT N'Y PARAÎT JAMAIS (demande du 26/09/2026) : on voit
 * ses membres (« ProjetA Saas », « ProjetA Interface VPS »), jamais « ProjetA ».
 */
export function vueDEnsemble(maintenant = Date.now()) {
  const espaces = new Map(listerEspaces().map((e) => [e.projectId, e]));
  const jours = derniersJours(maintenant);
  const visites = visitesParProjetEtJour(Date.parse(`${jours[0]}T00:00:00Z`));
  const contenus = contenusParProjet();
  return store
    .listProjects()
    .filter((p) => !p.archived && !estUnRegroupement(p))
    .map((p) => {
      const espace = espaces.get(p.id) ?? null;
      const guide = guideDuProjet({ espace, ...(espace ? compteursDuGuide(p.id) : { contenusPublies: 0, contenusEnAttente: 0, ventes: 0 }) });
      const agent = espace?.agentId ? store.getAgent(espace.agentId) : null;
      const parEtape = contenus.get(p.id) ?? {};
      const parJour = visites.get(p.id);
      return {
        projectId: p.id,
        nom: p.name,
        nature: espace?.configuration.nature ?? null,
        etatSuivi: espace?.configuration.etatSuivi ?? 'absent',
        /* Ce que la page en production porte, lu par « Tester le suivi »
           (`suivi-par-defaut.ts`) ; `null` tant qu'aucune adresse n'est connue. */
        diagnosticSuivi: espace ? diagnosticDeLEspace(p.id) : null,
        /* La carte d'installation du suivi : posée, elle ne vaut pas code posé. */
        carteSuivi: espace ? resumeCarteDuSuivi(p.id) : null,
        avancement: guide.avancement,
        prochaineAction: guide.prochainesActions[0] ?? null,
        aUnAgent: !!espace?.agentId,
        agentId: espace?.agentId ?? null,
        // L'état au moment de la lecture ; l'écran le suit ensuite en direct sur l'agent.
        travaille: !!agent && agentTientSonTour(agent),
        attendReponse: !!agent?.attendReponse,
        brouillons: parEtape.brouillon ?? 0,
        aValider: parEtape.a_valider ?? 0,
        programmes: (parEtape.pret ?? 0) + (parEtape.programme ?? 0),
        publies: parEtape.publie ?? 0,
        visites: jours.map((j) => parJour?.get(j) ?? 0),
        actif: espace ? espace.actif : true,
        enCours: espace && espace.actif ? travauxEnCours(p.id) : [],
      };
    });
}

/**
 * LES TRAVAUX MARKETING EN COURS D'UN PROJET, pour la colonne « En cours » du
 * tableau de bord : les cartes de l'atelier (`LABEL_MARKETING`) encore dans
 * « En cours », ou dont l'agent tient son tour. Ces cartes ne partent jamais
 * dans les paquets du tableau (`SANS_MARKETING`) : c'est ici qu'elles
 * atteignent l'écran, qui suit ensuite leur agent en direct.
 */
function travauxEnCours(projectId: string): { cardId: string; agentId: string | null; titre: string; colonne: string; depuis: number }[] {
  const travaux: { cardId: string; agentId: string | null; titre: string; colonne: string; depuis: number }[] = [];
  const cartes = cartesDeLAgent(projectId, 10);
  if (!cartes.length) return travaux;
  const agents = store.listAgents(projectId);
  for (const carte of cartes) {
    const agent = agents.find((a) => a.id === carte.agentId) ?? agents.find((a) => a.cardId === carte.id && agentTientSonTour(a)) ?? null;
    if (carte.column !== 'running' && !(agent && agentTientSonTour(agent))) continue;
    travaux.push({ cardId: carte.id, agentId: agent?.id ?? null, titre: carte.title, colonne: carte.column, depuis: carte.updatedAt });
  }
  return travaux;
}

/**
 * LA CARTE DU SUIVI déjà posée pour ce projet (`carte_suivi_id`), si elle
 * existe encore et n'est pas ARCHIVÉE : une seule par projet, partagée par le
 * démon, le bouton « Installer le suivi » et l'agent de l'atelier. Une carte
 * archivée est un travail fini : elle ne compte plus comme « installation en
 * cours » et ne bloque plus la naissance d'une nouvelle carte (capture #5113 du
 * 28/09/2026 : l'assistant rouvrait une carte archivée au lieu de lancer).
 */
export function carteDuSuivi(projectId: string) {
  const l = getDb().prepare('SELECT carte_suivi_id FROM marketing_espaces WHERE project_id = ?').get(projectId) as { carte_suivi_id: string | null } | undefined;
  const carte = l?.carte_suivi_id ? store.getCard(l.carte_suivi_id) ?? null : null;
  return carte && carte.column !== 'archived' ? carte : null;
}

/** Une carte du suivi où le travail n'est pas encore fait : on la rouvre plutôt que d'en lancer une autre. */
export function carteDuSuiviEnTravail(projectId: string) {
  const carte = carteDuSuivi(projectId);
  return carte && (carte.column === 'planned' || carte.column === 'running') ? carte : null;
}

/** Ce que l'écran montre de la carte du suivi : de quoi l'ouvrir, et où elle en est. */
function resumeCarteDuSuivi(projectId: string): { cardId: string; titre: string; colonne: string } | null {
  const c = carteDuSuivi(projectId);
  return c ? { cardId: c.id, titre: c.title, colonne: c.column } : null;
}

function diagnosticDeLEspace(projectId: string): string | null {
  const l = getDb().prepare('SELECT diagnostic_suivi FROM marketing_espaces WHERE project_id = ?').get(projectId) as { diagnostic_suivi: string | null } | undefined;
  return l?.diagnostic_suivi ?? null;
}

/** Les jours tracés par la vue d'ensemble, pour lire `visites` de chaque ligne. */
export function joursDeTendance(maintenant = Date.now()): string[] {
  return derniersJours(maintenant);
}

/**
 * LES CARTES DE L'AGENT MARKETING D'UN PROJET — analyse, plan de la semaine,
 * pose du suivi. Elles ne paraissent plus sur le tableau (`estCarteMarketing`) :
 * c'est ici, dans l'onglet Contenus, qu'on les suit. Les plus récentes d'abord.
 */
export function cartesDeLAgent(projectId: string, limite = 20) {
  const ids = getDb()
    .prepare(
      `SELECT c.id FROM cards c
         JOIN card_labels l ON l.card_id = c.id AND l.label = ?
        WHERE c.project_id = ?
        ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(LABEL_MARKETING, projectId, limite) as { id: string }[];
  const cartes = [];
  for (const { id } of ids) {
    const carte = store.getCard(id);
    if (carte) cartes.push(carte);
  }
  return cartes;
}

/** L'espace complet d'un projet, tel que l'écran le montre. */
export function espaceComplet(projectId: string, jours = 30) {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  const espace = lireEspace(projectId);
  const contenus = espace ? listerContenus(projectId) : [];
  const actions = espace ? listerActions(projectId) : [];
  const guide = guideDuProjet({ espace, ...(espace ? compteursDuGuide(projectId) : { contenusPublies: 0, contenusEnAttente: 0, ventes: 0 }) });
  const adresse = adresseDeBeluga();
  return {
    projectId,
    nom: projet.name,
    espace,
    contenus,
    actions,
    guide,
    resultats: espace ? resultatsDuProjet(projectId, jours) : null,
    extrait: espace ? extraitDeSuivi(adresse, espace.cleSuivi) : null,
    confidentialite: phraseDeConfidentialite(espace?.configuration.langue, projet.name, espace?.modeSuivi),
    adresseLiens: `${adresse}/m/l/`,
    cartes: cartesDeLAgent(projectId),
    /* Ce que porte la page servie, et la carte d'installation (onglet Statistiques). */
    diagnosticSuivi: espace ? diagnosticDeLEspace(projectId) : null,
    carteSuivi: espace ? carteDuSuivi(projectId) : null,
    /* LES VISUELS DU STUDIO rattachés à chaque contenu : ses exports prêts, le plus récent d'abord. */
    visuels: Object.fromEntries(
      contenus
        .map((c) => [c.id, mediasDuContenuMarketing(c.id).map((e) => ({ exportId: e.id, creationId: e.creationId, attachmentId: e.attachmentId, afficheId: e.afficheId, format: e.format, genre: e.genre, titre: e.titre }))] as const)
        .filter(([, liste]) => liste.length),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Annonces des livraisons                                             */
/* ------------------------------------------------------------------ */

/** Les contenus d'un projet comptés par étape. */
export function contenusDuProjetParEtape(projectId: string): Record<string, number> {
  const lignes = getDb().prepare('SELECT etape, COUNT(*) AS n FROM marketing_contenus WHERE project_id = ? GROUP BY etape').all(projectId) as { etape: string; n: number }[];
  return Object.fromEntries(lignes.map((l) => [l.etape, l.n]));
}

/** LA PRODUCTION AUTOMATIQUE EST SUSPENDUE : 10 contenus ou plus attendent (brouillons + à valider). */
export function productionSuspendue(projectId: string): boolean {
  return productionAutomatiqueSuspendue(contenusDuProjetParEtape(projectId));
}

/** Le rythme réel de l'utilisateur sur ce projet, en chiffres. */
export function rythmeDuProjet(projectId: string, maintenant = Date.now()) {
  return rythmeDeLUtilisateur(listerContenus(projectId), maintenant);
}

export interface NouveauteEnReserve {
  ref: string;
  titre: string;
  explication: string;
  poids: string;
}

const RESERVE_MAX = 20;
const cleReserve = (projectId: string) => `marketing:nouveautes-en-reserve:${projectId}`;

/** Les livraisons notées pendant que la production était suspendue : l'agent les relit avec « lire ». */
export function nouveautesEnReserve(projectId: string): NouveauteEnReserve[] {
  try {
    const brut = JSON.parse(getMeta(cleReserve(projectId)) ?? '[]');
    return Array.isArray(brut) ? (brut as NouveauteEnReserve[]) : [];
  } catch {
    return [];
  }
}

export function mettreEnReserve(projectId: string, n: NouveauteEnReserve): void {
  const actuelles = nouveautesEnReserve(projectId);
  if (actuelles.some((x) => x.ref === n.ref)) return;
  setMeta(cleReserve(projectId), JSON.stringify([...actuelles, n].slice(-RESERVE_MAX)));
}

/** Une nouveauté annoncée (ou jugée inutile) sort de la réserve. */
export function retirerDeLaReserve(projectId: string, ref: string): void {
  const restantes = nouveautesEnReserve(projectId).filter((x) => x.ref !== ref);
  setMeta(cleReserve(projectId), JSON.stringify(restantes));
}

/** Les projets qui ont des brouillons ou contenus « à valider » à replacer (jour prévu passé). */
export function projetsAReorganiser(maintenant = Date.now()): string[] {
  return listerEspaces()
    .filter((e) => contenusEnRetard(listerContenus(e.projectId), maintenant).length > 0)
    .map((e) => e.projectId);
}


/**
 * UNE LIVRAISON NOTÉE AU CHANGELOG PROPOSE SON ANNONCE, en brouillon, pour un
 * projet qui a un espace marketing. Jamais une panne pour la carte : tout
 * échec est avalé et noté.
 */
export function proposerAnnonceDeLivraison(entree: { projectId: string; titre?: string | null; explication?: string | null; poids?: string | null; ref: string }): void {
  try {
    const espace = lireEspace(entree.projectId);
    if (!espace) return;
    const projet = store.getProject(entree.projectId);
    const annonce = annonceDeLivraison({ ...entree, nomProjet: projet?.name ?? 'le projet' });
    if (!annonce) return;
    // Trop de contenus attendent : pas de brouillon de plus, la nouveauté est gardée en réserve.
    if (productionSuspendue(entree.projectId)) {
      mettreEnReserve(entree.projectId, { ref: entree.ref, titre: entree.titre ?? '', explication: entree.explication ?? '', poids: entree.poids ?? '' });
      return;
    }
    creerContenu({
      projectId: entree.projectId,
      genre: 'annonce',
      canal: espace.configuration.canaux[0] ?? 'linkedin',
      titre: annonce.titre,
      texte: annonce.texte,
      etape: 'brouillon',
      origine: 'nouveaute',
      sourceRef: `changelog:${entree.ref}`,
    });
  } catch (err) {
    log.warn('marketing : annonce de livraison non préparée', err);
  }
}

/* ------------------------------------------------------------------ */
/* Minuteur : rangement et plan du dimanche                            */
/* ------------------------------------------------------------------ */

const CONSERVATION_MS = 90 * 86_400_000;

export function purgerEvenements(maintenant = Date.now()): number {
  return getDb().prepare('DELETE FROM marketing_evenements WHERE instant < ?').run(maintenant - CONSERVATION_MS).changes;
}

const CLE_PLAN_HEBDO = 'marketing:plan-hebdo-pour';
const CLE_REORGANISATION = 'marketing:reorganisation-du-jour';

/**
 * CHAQUE MINUTE : le rangement une fois par jour, la réorganisation des dates
 * une fois par jour (à partir de 6 h), et le dimanche soir le plan de la
 * semaine pour chaque projet actif qui a une fiche. `BELUGA_MARKETING_NUIT=0`
 * coupe le plan (jamais le rangement).
 */
export function demarrerMarketing(): NodeJS.Timeout {
  let dernierRangement = 0;
  const tour = () => {
    const maintenant = Date.now();
    try {
      if (maintenant - dernierRangement > 86_400_000) {
        dernierRangement = maintenant;
        const n = purgerEvenements(maintenant);
        if (n) log.info(`marketing : ${n} événement(s) de plus de 90 jours retiré(s)`);
        // La base des pays (DB-IP, mensuelle) : téléchargée si elle manque ou a vieilli.
        void import('./pays-des-visites.js').then(({ assurerLaBaseDesPays }) => assurerLaBaseDesPays(maintenant)).catch(() => undefined);
      }
      if (process.env.BELUGA_MARKETING_NUIT === '0') return;
      if (estLHeureDeLaReorganisation(maintenant, getMeta(CLE_REORGANISATION))) {
        setMeta(CLE_REORGANISATION, jourLocalDe(maintenant));
        void import('./assistant-marketing.js')
          .then(({ lancerLaReorganisationDuJour }) => lancerLaReorganisationDuJour(maintenant))
          .catch((err) => log.warn('marketing : réorganisation du jour impossible', err));
      }
      const dejaFait = getMeta(CLE_PLAN_HEBDO);
      if (!estLHeureDuPlanHebdo(maintenant, dejaFait)) return;
      const lundi = lundiDe(maintenant + 86_400_000);
      setMeta(CLE_PLAN_HEBDO, lundi);
      void import('./assistant-marketing.js')
        .then(({ lancerLesPlansDeLaSemaine }) => lancerLesPlansDeLaSemaine(lundi))
        .catch((err) => log.warn('marketing : plan de la semaine impossible', err));
    } catch (err) {
      log.warn('marketing : tour du minuteur impossible', err);
    }
  };
  const minuteur = setInterval(tour, 60_000);
  minuteur.unref?.();
  return minuteur;
}

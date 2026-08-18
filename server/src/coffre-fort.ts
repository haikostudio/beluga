import crypto from 'node:crypto';
import {
  AccesCoffre,
  ID_ACCES_VPS,
  MOYENS_VPS,
  MoyenVps,
  TypeAcces,
  jugerAcces,
  trierAcces,
} from '@haikodev/shared';
import { getDb } from './db.js';
import { getSettings, saveSettings } from './store.js';
import { log } from './logger.js';

/**
 * LE COFFRE-FORT — le rangement sur le disque.
 *
 * Les règles qui se décident sans base vivent dans `shared/src/coffre-fort.ts`.
 * Ici : lire, écrire, effacer, et le pont avec les accès SSH centraux réglés
 * dans l'onglet « Système ».
 *
 * CES ACCÈS-LÀ NE SONT PAS RECOPIÉS. Une copie aurait deux vérités : celle du
 * coffre et celle des réglages, chacune se croyant à jour. Le coffre montre donc
 * la fiche `reglages:vps` LUE dans les réglages à chaque appel, et l'écrire
 * depuis le coffre écrit dans les réglages. Un seul endroit, deux fenêtres.
 */

interface LigneAcces {
  id: string;
  nom: string;
  type: string;
  project_id: string | null;
  champs: string;
  note: string;
  cree_le: number;
  modifie_le: number;
}

function depuisLigne(ligne: LigneAcces): AccesCoffre {
  let champs: Record<string, string> = {};
  try {
    const lu = JSON.parse(ligne.champs ?? '{}');
    if (lu && typeof lu === 'object') champs = lu as Record<string, string>;
  } catch {
    // Une fiche au JSON abîmé se montre vide plutôt que de faire tomber la liste.
  }
  return {
    id: ligne.id,
    nom: ligne.nom,
    type: ligne.type as TypeAcces,
    projectId: ligne.project_id,
    champs,
    note: ligne.note ?? '',
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    origine: 'coffre',
  };
}

/**
 * La fiche qui reflète les accès SSH centraux d'HaikoDev, telle que les
 * réglages les portent AU MOMENT de l'appel. Elle est toujours là, même vide :
 * c'est ce qui permet de la remplir depuis le coffre sans passer par l'onglet
 * « Système ».
 */
export function accesVpsEnFiche(): AccesCoffre {
  const r = getSettings();
  const champs: Record<string, string> = {};
  const poser = (cle: string, valeur: unknown) => {
    const texte = String(valeur ?? '').trim();
    if (texte) champs[cle] = texte;
  };
  poser('hote', r.vpsHote);
  poser('port', r.vpsPort);
  poser('utilisateur', r.vpsUtilisateur);
  poser('cle', r.vpsCle);
  poser('motDePasse', r.vpsMotDePasse);
  return {
    id: ID_ACCES_VPS,
    nom: 'Machine HaikoDev (accès SSH)',
    type: 'ssh',
    projectId: null,
    champs,
    note: 'Ces accès sont ceux de l’onglet « Système » : les modifier ici les modifie là-bas.',
    creeLe: 0,
    modifieLe: 0,
    origine: 'reglages',
  };
}

/**
 * Toutes les fiches : celles du coffre, la plus récemment touchée d'abord, puis
 * les accès SSH centraux — posés en dernier parce qu'ils ne portent pas de date
 * de modification et se classeraient toujours au fond.
 */
export function listerAcces(): AccesCoffre[] {
  const lignes = getDb().prepare('SELECT * FROM secrets').all() as LigneAcces[];
  return [...trierAcces(lignes.map(depuisLigne)), accesVpsEnFiche()];
}

export type EnregistrementAcces = { ok: true; acces: AccesCoffre } | { ok: false; raison: string };

/**
 * Écrit une fiche : nouvelle si `id` est vide, remplacée sinon. Le retour est
 * la fiche telle qu'elle est désormais rangée — l'interface s'en sert plutôt
 * que de recopier ce qu'elle croyait avoir envoyé.
 */
export function enregistrerAcces(brut: unknown, maintenant = Date.now()): EnregistrementAcces {
  const juge = jugerAcces(brut);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const id = String((brut as any)?.id ?? '').trim();

  // Les accès SSH centraux : on écrit dans les RÉGLAGES, pas dans le coffre.
  if (id === ID_ACCES_VPS) {
    if (juge.type !== 'ssh') return { ok: false, raison: 'Ces accès sont un accès SSH : leur type ne change pas.' };
    const c = juge.champs;
    const port = Number.parseInt(c.port ?? '', 10);
    /*
     * Le moyen de connexion suit ce qui est REMPLI : une clé privée écrite veut
     * dire « par clé », un mot de passe seul « par mot de passe », et rien de
     * tout cela « par les clés déjà en place ». Le coffre ne montre pas ce
     * bouton à trois positions — il se déduit sans jamais se contredire.
     */
    const moyen: MoyenVps = c.cle?.trim() ? 'cle' : c.motDePasse?.trim() ? 'mot-de-passe' : 'agent';
    if (!MOYENS_VPS.includes(moyen)) return { ok: false, raison: 'Moyen de connexion inconnu.' };
    saveSettings({
      vpsHote: c.hote ?? '',
      vpsPort: Number.isFinite(port) && port > 0 ? port : 22,
      vpsUtilisateur: c.utilisateur ?? '',
      vpsMoyen: moyen,
      vpsCle: c.cle ?? '',
      vpsMotDePasse: c.motDePasse ?? '',
    });
    log.info('coffre-fort : accès SSH de la machine mis à jour');
    return { ok: true, acces: accesVpsEnFiche() };
  }

  // Un projet inconnu ne se range pas : la contrainte de la base refuserait la
  // ligne avec un message illisible.
  if (juge.projectId) {
    const existe = getDb().prepare('SELECT 1 FROM projects WHERE id = ?').get(juge.projectId);
    if (!existe) return { ok: false, raison: 'Ce projet n’existe pas.' };
  }

  const champs = JSON.stringify(juge.champs);

  if (id) {
    const ligne = getDb().prepare('SELECT * FROM secrets WHERE id = ?').get(id) as LigneAcces | undefined;
    if (!ligne) return { ok: false, raison: 'Accès introuvable.' };
    getDb()
      .prepare(
        'UPDATE secrets SET nom = ?, type = ?, project_id = ?, champs = ?, note = ?, modifie_le = ? WHERE id = ?',
      )
      .run(juge.nom, juge.type, juge.projectId, champs, juge.note, maintenant, id);
    return { ok: true, acces: depuisLigne({ ...ligne, nom: juge.nom, type: juge.type, project_id: juge.projectId, champs, note: juge.note, modifie_le: maintenant }) };
  }

  const neuf: LigneAcces = {
    id: crypto.randomUUID(),
    nom: juge.nom,
    type: juge.type,
    project_id: juge.projectId,
    champs,
    note: juge.note,
    cree_le: maintenant,
    modifie_le: maintenant,
  };
  getDb()
    .prepare(
      'INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(neuf.id, neuf.nom, neuf.type, neuf.project_id, neuf.champs, neuf.note, neuf.cree_le, neuf.modifie_le);
  log.info(`coffre-fort : accès « ${neuf.nom} » enregistré`);
  return { ok: true, acces: depuisLigne(neuf) };
}

/** Efface une fiche. Les accès SSH centraux se VIDENT dans les réglages, ils ne s'effacent pas. */
export function supprimerAcces(id: string): { ok: boolean; raison?: string } {
  if (id === ID_ACCES_VPS)
    return { ok: false, raison: 'Ces accès viennent des réglages : videz leurs champs pour les retirer.' };
  const res = getDb().prepare('DELETE FROM secrets WHERE id = ?').run(id);
  if (!res.changes) return { ok: false, raison: 'Accès introuvable.' };
  return { ok: true };
}

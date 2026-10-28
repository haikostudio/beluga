/**
 * RANGER UN FICHIER EN PIÈCE JOINTE — UNE SEULE FOIS POUR TOUS LES CHEMINS.
 *
 * L'outil `attach_file` (l'agent joint lui-même un fichier) et la détection
 * automatique des captures (`server/src/captures-auto.ts`) passent par cette
 * fonction : même plafond de poids, même dédoublonnage par empreinte, même
 * dossier de stockage, même événement vers l'interface. Un fichier déjà connu du
 * projet (même contenu) rend la pièce existante, sans second exemplaire.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Attachment, aliasDePieceJointe, mimeDuFichier, nomSansCollision, nomSurDisque, refusDeTaille } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { cheminDePieceJointe, dossierDEcriture, dossiersDeDonneesOuverts } from './pieces-jointes.js';
import { racinesDesCopiesDuProjet } from './copies-de-cartes.js';
import { CONFIG } from './config.js';
import { safeJoin } from './files.js';

/**
 * LES DOSSIERS OÙ UN AGENT PEUT PRENDRE UN FICHIER — UNE SEULE DÉFINITION,
 * partagée par `attach_file` et par les autres outils qui rangent un fichier :
 * le dossier de travail de l'agent (où vit une capture prise par ses propres
 * scripts), le dépôt du projet, le dossier de données partagé de Beluga
 * Build (pièces jointes, scripts de vérification « de tous les jours »), le
 * DISQUE DE STOCKAGE des pièces (`dossiersDeDonneesOuverts`, déjà ouvert en
 * lecture à tout moteur : un PDF produit là était refusé « introuvable » alors
 * qu'il existait) et les copies de travail des cartes du projet.
 *
 * Un chemin absolu doit ÊTRE une racine ou commencer par « racine + / » (un
 * préfixe trompeur comme « data2 » ne passe pas) ; un chemin relatif se
 * résout dans chaque racine sans pouvoir en sortir. Rend le premier fichier
 * existant, ou null.
 */
export function fichierPermis(demande: string, racines: Array<string | undefined | null>): string | null {
  for (const racine of racines.filter(Boolean) as string[]) {
    const essai = path.isAbsolute(demande)
      ? path.resolve(demande) === path.resolve(racine) || path.resolve(demande).startsWith(path.resolve(racine) + path.sep)
        ? demande
        : null
      : safeJoin(racine, demande);
    if (essai && fs.existsSync(essai) && fs.statSync(essai).isFile()) return essai;
  }
  return null;
}

/** Les racines de `fichierPermis` pour un agent et son projet. */
export function racinesDeLAgent(agentId: string, projet: { path: string }): Array<string | undefined> {
  return [
    store.getAgent(agentId)?.workdir,
    projet.path,
    CONFIG.dataDir,
    ...dossiersDeDonneesOuverts(),
    ...racinesDesCopiesDuProjet(projet.path),
  ];
}

/**
 * LE REFUS DIT LA VRAIE RAISON : un fichier absent n'est pas un fichier hors
 * des dossiers permis. L'agent qui lit « introuvable » sur un fichier qu'il
 * vient d'écrire croit à une faute de frappe et tourne en rond.
 */
export function refusDeChemin(demande: string, racines: Array<string | undefined | null>): string {
  const absolu = path.isAbsolute(demande);
  if (absolu && fs.existsSync(demande)) {
    const permises = (racines.filter(Boolean) as string[]).join(', ');
    return `Fichier hors des dossiers permis : ${demande} (dossiers acceptés : ${permises})`;
  }
  return `Fichier introuvable : ${demande}`;
}

export type ResultatDeJointure =
  | { ok: true; attachment: Attachment; taille: number; nouvelle: boolean }
  | { ok: false; refus: string };

/** Un fichier encore en cours d'écriture grossit : on attend qu'il ne bouge plus. */
async function attendreUneTailleStable(fichier: string, essais = 10, pauseMs = 150): Promise<number> {
  let taille = (await fs.promises.stat(fichier)).size;
  for (let i = 0; i < essais; i++) {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const maintenant = (await fs.promises.stat(fichier)).size;
    if (maintenant === taille) return taille;
    taille = maintenant;
  }
  return taille;
}

export async function joindreUnFichier(opts: {
  projectId: string;
  /** Absent quand la pièce est rattachée à un brouillon sans agent. */
  agentId?: string;
  cardId?: string;
  /** Chemin absolu d'un fichier déjà vérifié par l'appelant (racines autorisées). */
  fichier: string;
  /** Le nom donné à la pièce ; à défaut, celui du fichier. */
  nom?: string;
  /** Attendre que le fichier cesse de grossir (capture détectée en plein tour). */
  attendreStable?: boolean;
  /** La pièce vient de l'agent (outil de jointure, capture rangée) : elle porte `deLAgent`. */
  deLAgent?: boolean;
}): Promise<ResultatDeJointure> {
  const { fichier } = opts;
  const mime = mimeDuFichier(fichier);
  /* LE SEUL REFUS EST LE POIDS. Le fichier est lu EN FLUX (empreinte puis
     copie disque à disque) : une vidéo rangée d'office ne passe jamais entière
     par la mémoire du démon. */
  const poids = opts.attendreStable ? await attendreUneTailleStable(fichier) : (await fs.promises.stat(fichier)).size;
  const refus = refusDeTaille(poids);
  if (refus) return { ok: false, refus };
  const sha = await empreinteEnFlux(fichier);
  const existant = store.findAttachmentBySha(opts.projectId, sha);
  if (existant) return { ok: true, attachment: existant, taille: poids, nouvelle: false };

  const conversation = opts.cardId ?? opts.agentId;
  const dejaUtilises = store
    .listAttachments(opts.projectId)
    .filter((a) => (a.cardId ?? a.agentId) === conversation)
    .map((a) => a.name);
  const id = store.newId();
  const attachment = Attachment.parse({
    id,
    alias: aliasDePieceJointe(id, store.aliasDesPiecesJointes()),
    projectId: opts.projectId,
    name: nomSansCollision(opts.nom?.trim() || path.basename(fichier), dejaUtilises),
    mime,
    size: poids,
    sha,
    cardId: opts.cardId,
    agentId: opts.agentId,
    createdAt: Date.now(),
    deLAgent: opts.deLAgent ? true : undefined,
  });
  await fs.promises.copyFile(fichier, path.join(dossierDEcriture(), nomSurDisque(attachment)));
  store.saveAttachment(attachment);
  bus.emit({ type: 'attachments', projectId: opts.projectId, items: store.listAttachments(opts.projectId) });
  return { ok: true, attachment, taille: poids, nouvelle: true };
}

/** L'empreinte d'un fichier, lue par morceaux (jamais le fichier entier en mémoire). */
function empreinteEnFlux(fichier: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hache = crypto.createHash('sha256');
    fs.createReadStream(fichier)
      .on('data', (morceau) => hache.update(morceau))
      .on('error', reject)
      .on('end', () => resolve(hache.digest('hex')));
  });
}

/**
 * UN TAG COLLÉ DEPUIS UNE AUTRE CARTE RAMÈNE SON FICHIER.
 *
 * Le champ de saisie ne retrouve les tags « [fichier: nom #alias] » que dans la
 * liste du projet affiché. Un texte copié dans un AUTRE projet (ou avant que
 * cette liste soit chargée) gardait ses tags sans aucun fichier. Chaque alias
 * est cherché sur tout le dépôt : une pièce du même projet est rendue telle
 * quelle ; celle d'un autre projet est RECOPIÉE dans celui-ci, par le même
 * chemin qu'un fichier joint (poids, empreinte, dossier, événement), pour que le
 * fil, la carte et ses droits ne dépendent jamais d'un projet voisin. Un même
 * contenu déjà présent ici rend la pièce existante : coller deux fois ne double
 * rien. Un alias inconnu (pièce retirée) est sauté sans bruit.
 */
export async function rattacherParAlias(opts: {
  projectId: string;
  agentId?: string;
  cardId?: string;
  alias: readonly string[];
}): Promise<Array<{ alias: string; attachment: Attachment }>> {
  const rendues: Array<{ alias: string; attachment: Attachment }> = [];
  for (const source of store.attachmentsParAlias(opts.alias)) {
    if (!source.alias) continue;
    if (source.projectId === opts.projectId) {
      rendues.push({ alias: source.alias, attachment: source });
      continue;
    }
    const fichier = cheminDePieceJointe(source);
    if (!fs.existsSync(fichier)) continue;
    const jointure = await joindreUnFichier({
      projectId: opts.projectId,
      agentId: opts.agentId,
      cardId: opts.cardId,
      fichier,
      nom: source.name,
    });
    if (jointure.ok) rendues.push({ alias: source.alias, attachment: jointure.attachment });
  }
  return rendues;
}

/**
 * LE MONTAGE D'UN PROJET SE SUIT ÉTAPE PAR ÉTAPE, EN DIRECT.
 *
 * Créer un projet (ou en reprendre un depuis GitHub) dure de quelques secondes
 * à plusieurs minutes — l'adresse publique attend que son nom soit visible sur
 * Internet. La fenêtre ne montrait qu'une roue muette, puis l'avertissement
 * « … prend plus de temps que prévu » : on croyait à une panne. Désormais la
 * liste des étapes PRÉVUES s'affiche dès le clic, et chaque étape se coche au
 * moment où le démon la termine.
 *
 * Ce fichier est la SEULE source des titres et de l'ordre : le démon note ses
 * étapes avec ces clés et ces titres, l'écran calcule la même liste prévue à
 * partir des mêmes options. Un titre écrit deux fois finirait par diverger, et
 * une ligne prévue ne se cocherait jamais.
 */

import { TITRE_ETAPE_ADRESSE, jugerAdresseDemandee } from './sous-domaine-projet.js';

/** Une étape du montage, telle que le démon la rend (réponse finale ou progression). */
export interface EtapeDuMontage {
  /** La clé stable de l'étape (`CleEtapeMontage`) ; absente sur un ancien démon. */
  cle?: string;
  titre: string;
  fait: boolean;
  detail?: string;
}

export type CleEtapeMontage =
  | 'dossier'
  | 'port'
  | 'fichiers'
  | 'git'
  | 'distant'
  | 'github'
  | 'clone'
  | 'branches'
  | 'adresse'
  | 'inscription'
  | 'cahier';

/** Le titre d'une étape réussie, puis celui d'une étape ratée quand il diffère. */
export const TITRES_DU_MONTAGE: Record<CleEtapeMontage, { fait: string; rate?: string }> = {
  dossier: { fait: 'Dossier créé sur le serveur' },
  port: { fait: 'Port du projet attribué' },
  fichiers: { fait: 'Fichiers de départ écrits' },
  git: { fait: 'Dépôt git démarré sur la branche « main »', rate: 'Dépôt git non démarré' },
  distant: { fait: 'Dépôt distant rattaché', rate: 'Dépôt distant non rattaché' },
  github: { fait: 'Dépôt GitHub créé et poussé', rate: 'Dépôt GitHub non créé' },
  clone: { fait: 'Dépôt récupéré sur le serveur' },
  branches: { fait: 'Branches « dev » et « main » en place', rate: 'Branches « dev » et « main » pas en place' },
  adresse: { fait: TITRE_ETAPE_ADRESSE },
  inscription: { fait: 'Projet inscrit dans la colonne de gauche' },
  cahier: { fait: 'Carte « Cahier des charges » posée', rate: 'Carte « Cahier des charges » non posée' },
};

/** Le titre à écrire pour une étape selon son issue. */
export function titreDEtape(cle: CleEtapeMontage, fait: boolean): string {
  const titres = TITRES_DU_MONTAGE[cle];
  return fait ? titres.fait : (titres.rate ?? titres.fait);
}

/** Les options d'un projet NEUF, telles que la fenêtre les envoie. */
export interface OptionsDuMontageNeuf {
  git?: boolean;
  gitRemote?: string;
  github?: boolean;
  sousDomaine?: string;
  port?: number | string | null;
  /** Une carte « Cahier des charges » est demandée (case cochée ou source à cloner). */
  cahier?: boolean;
}

/** Une adresse sera-t-elle tentée ? La même règle que le démon (`etapeAdressePublique`). */
function adresseTentee(sousDomaine?: string, port?: number | string | null): boolean {
  return jugerAdresseDemandee({ sousDomaine, port }).demandee;
}

/** Les étapes PRÉVUES d'un projet neuf, dans l'ordre exact où le démon les fait. */
export function etapesPrevuesDuMontageNeuf(options: OptionsDuMontageNeuf): CleEtapeMontage[] {
  const cles: CleEtapeMontage[] = ['dossier', 'port', 'fichiers'];
  const avecGit = options.git !== false;
  if (avecGit) {
    cles.push('git');
    if (options.gitRemote?.trim()) cles.push('distant');
    else if (options.github !== false) cles.push('github');
    cles.push('branches');
  }
  if (adresseTentee(options.sousDomaine, options.port)) cles.push('adresse');
  cles.push('inscription');
  if (options.cahier) cles.push('cahier');
  return cles;
}

/** Les étapes PRÉVUES d'un projet repris depuis GitHub. */
export function etapesPrevuesDepuisGithub(options: {
  sousDomaine?: string;
  port?: number | string | null;
  cahier?: boolean;
}): CleEtapeMontage[] {
  const cles: CleEtapeMontage[] = ['clone', 'branches'];
  if (adresseTentee(options.sousDomaine, options.port)) cles.push('adresse');
  cles.push('inscription');
  if (options.cahier) cles.push('cahier');
  return cles;
}

/** L'état d'une ligne de la liste affichée. */
export type EtatDeLigneDuMontage = 'a-venir' | 'en-cours' | 'fait' | 'rate';

export interface LigneDuMontage {
  cle: string;
  titre: string;
  etat: EtatDeLigneDuMontage;
  detail?: string;
}

/**
 * La liste à afficher : les étapes prévues, chacune avec ce que le démon en a
 * dit. Une étape notée prend son issue ; celle que le démon annonce commencée
 * tourne ; les autres attendent. Une étape notée que la liste ne prévoyait pas
 * (démon plus récent que l'écran, ou sans clé) se range à la fin, jamais perdue.
 */
export function lignesDuMontage(
  prevues: readonly string[],
  notees: readonly EtapeDuMontage[],
  enCours?: string,
): LigneDuMontage[] {
  const ligneNotee = (etape: EtapeDuMontage, index: number): LigneDuMontage => ({
    cle: etape.cle ?? `etape-${index}`,
    titre: etape.titre,
    etat: etape.fait ? 'fait' : 'rate',
    detail: etape.detail,
  });
  const lignes: LigneDuMontage[] = prevues.map((cle) => {
    const index = notees.findIndex((etape) => etape.cle === cle);
    if (index >= 0) return ligneNotee(notees[index], index);
    const titre = cle in TITRES_DU_MONTAGE ? TITRES_DU_MONTAGE[cle as CleEtapeMontage].fait : cle;
    return { cle, titre, etat: cle === enCours ? 'en-cours' : 'a-venir' };
  });
  notees.forEach((etape, index) => {
    if (!etape.cle || !prevues.includes(etape.cle)) lignes.push(ligneNotee(etape, index));
  });
  return lignes;
}

/**
 * LE BILAN D'UN MONTAGE QUI N'A PAS TOUT RÉUSSI — ce que la fenêtre dit en
 * revenant au formulaire (décision de l'utilisateur : TOUTE erreur ramène le
 * formulaire, avec un message qui explique).
 *
 * Le démon ne lève une erreur qu'AVANT de toucher au disque (emplacement
 * refusé, dossier déjà là, port pris) ; une fois le dossier créé, une étape qui
 * rate est seulement NOTÉE et le projet est inscrit quand même. Le message doit
 * donc dire quelles étapes ont raté, avec leur cause, et si le projet existe
 * déjà — car alors un nouvel envoi sous le même nom de dossier sera refusé.
 *
 * `null` quand tout est fait : il n'y a rien à dire, la fenêtre se referme.
 */
export interface BilanDUnMontageRate {
  /** Les étapes ratées, dans l'ordre du démon, avec leur cause (`detail`). */
  ratees: EtapeDuMontage[];
  /** Le projet est inscrit dans la colonne de gauche malgré l'échec. */
  projetInscrit: boolean;
}

export function bilanDuMontageRate(etapes: readonly EtapeDuMontage[]): BilanDUnMontageRate | null {
  const ratees = etapes.filter((etape) => !etape.fait);
  if (!ratees.length) return null;
  // Le démon inscrit le projet quoi qu'il arrive après le dossier : seule une
  // inscription NOTÉE ratée dit le contraire (un ancien démon ne note pas de clé).
  const projetInscrit = !etapes.some((etape) => etape.cle === 'inscription' && !etape.fait);
  return { ratees, projetInscrit };
}

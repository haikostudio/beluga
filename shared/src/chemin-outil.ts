/**
 * OÙ CHERCHER L'OUTIL D'UN MOTEUR — l'ordre des emplacements, sans disque.
 *
 * Un chemin FIGÉ (`/root/.local/bin/codex`, `/usr/local/bin/cursor-agent`) ne
 * vaut que sur la machine d'origine. Sur un serveur neuf, le service tourne sous
 * son propre compte et l'installateur de l'éditeur pose l'outil ailleurs :
 * `npm install -g` sous le préfixe global de npm, l'installateur de Cursor dans
 * `~/.local/bin`. L'outil était bien installé, mais l'écran restait sur
 * « Installer » : personne ne le cherchait là.
 *
 * L'ORDRE :
 *  1. la variable d'environnement, quand elle est posée — et ALORS SEULE : les
 *     contrôles la posent sur un chemin inexistant pour simuler « pas
 *     installé », et une recherche de secours les tromperait ;
 *  2. le PATH du service, dans son ordre ;
 *  3. les emplacements habituels : `~/.local/bin`, le dossier de Node (le
 *     préfixe global de npm quand Node est installé pour tout le système),
 *     `/usr/local/bin`, `/usr/bin` ;
 *  4. les emplacements propres à l'outil (paquet autonome de Codex) ;
 *  5. l'ancien chemin figé, en dernier : l'installation d'origine le garde.
 *
 * Le premier candidat EXÉCUTABLE l'emporte (`server/src/engines/outil-du-moteur.ts`).
 * Aucun ne l'est : on rend le dernier, pour que l'erreur dise un chemin lisible.
 */

export interface LieuxDeRecherche {
  /** Le nom du programme : `codex`, `cursor-agent`. */
  nom: string;
  /** La valeur de la variable d'environnement dédiée, si posée. */
  impose?: string;
  /** `process.env.PATH`. */
  path?: string;
  /** Le dossier personnel du compte du service. */
  maison: string;
  /** Le dossier qui contient l'exécutable de Node (`path.dirname(process.execPath)`). */
  dossierDeNode?: string;
  /** Des chemins COMPLETS propres à l'outil, essayés avant l'ancien chemin. */
  enPlus?: string[];
  /** L'ancien chemin figé, gardé en tout dernier. */
  historique?: string;
}

/** Les chemins complets à essayer, dans l'ordre, sans doublon. */
export function candidatsDeLOutil(lieux: LieuxDeRecherche): string[] {
  const impose = lieux.impose?.trim();
  if (impose) return [impose];

  const dossiers: string[] = [];
  for (const dossier of (lieux.path ?? '').split(':')) {
    if (dossier.trim()) dossiers.push(dossier.trim());
  }
  dossiers.push(`${lieux.maison.replace(/\/+$/, '')}/.local/bin`);
  if (lieux.dossierDeNode) dossiers.push(lieux.dossierDeNode);
  dossiers.push('/usr/local/bin', '/usr/bin');

  const chemins = dossiers.map((dossier) => `${dossier.replace(/\/+$/, '')}/${lieux.nom}`);
  chemins.push(...(lieux.enPlus ?? []));
  if (lieux.historique) chemins.push(lieux.historique);
  // Un chemin RELATIF du PATH (« . », « bin ») dépendrait du dossier courant : écarté.
  return [...new Set(chemins.filter((chemin) => chemin.startsWith('/')))];
}

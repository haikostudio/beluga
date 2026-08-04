/**
 * LES COMPÉTENCES PARTAGÉES : des modes d'emploi écrits d'avance, disponibles
 * pour TOUS les projets et TOUS les agents.
 *
 * Une compétence (« skill ») est un dossier portant un `SKILL.md` : un en-tête
 * qui dit son nom et à quoi elle sert, puis le mode d'emploi. Elles vivaient
 * dans le dossier personnel de l'utilisateur, donc nulle part pour les agents
 * lancés par HaikoDev — chaque compte de moteur a SON coffre, et un coffre neuf
 * n'a rien. Deux chemins, complémentaires, les rendent atteignables :
 *
 *   1. LE COFFRE. Claude Code lit les compétences de son dossier de
 *      configuration (`<coffre>/skills/<nom>`) : le démon y pose un lien vers
 *      chaque compétence partagée, sans jamais écraser ce qui s'y trouve.
 *   2. LE BRIEFING. Codex n'a aucun mécanisme de compétences, et le chef
 *      d'orchestre n'a pas le droit d'ouvrir celles de son moteur. Le briefing
 *      les ANNONCE donc à tout agent, avec le chemin de leur mode d'emploi :
 *      lire un fichier suffit, et cela vaut pour les deux moteurs comme pour
 *      les rôles bridés.
 *
 * Rien ici ne touche à la base ni au disque : les règles se lisent et se
 * rejouent seules.
 */

/** Le nom du dossier de compétences dans le coffre d'un compte. */
export const NOM_DOSSIER_COMPETENCES = 'skills';

/** Le fichier qui fait d'un dossier une compétence. */
export const FICHIER_COMPETENCE = 'SKILL.md';

/** Une compétence partagée, telle qu'annoncée aux agents. */
export interface Competence {
  /** Nom court, celui du dossier ou celui déclaré dans l'en-tête. */
  nom: string;
  /** À quoi elle sert et quand s'en servir, en une phrase. */
  description: string;
  /** Le dossier de la compétence. */
  dossier: string;
  /** Le mode d'emploi à ouvrir. */
  fichier: string;
}

/**
 * L'en-tête d'un `SKILL.md` : un bloc encadré de `---`, une clé par ligne. On
 * ne dépend d'aucun analyseur YAML — deux clés suffisent, et un fichier sans
 * en-tête ne doit pas faire tomber le démon.
 */
export function enTeteDeCompetence(texte: string): { nom?: string; description?: string } {
  const lignes = texte.split(/\r?\n/);
  if (lignes[0]?.trim() !== '---') return {};
  const entete: { nom?: string; description?: string } = {};
  for (let i = 1; i < lignes.length; i += 1) {
    const ligne = lignes[i];
    if (ligne.trim() === '---') break;
    const coupe = ligne.indexOf(':');
    if (coupe <= 0) continue;
    const cle = ligne.slice(0, coupe).trim().toLowerCase();
    const valeur = ligne
      .slice(coupe + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!valeur) continue;
    if (cle === 'name') entete.nom = valeur;
    else if (cle === 'description') entete.description = valeur;
  }
  return entete;
}

/**
 * Ce que le démon doit faire d'une compétence pour un coffre donné. `existant`
 * est le chemin RÉEL de ce qui occupe déjà la place (rien si la place est
 * libre) : comparer les chemins réels évite de reposer un lien sur lui-même, et
 * de piétiner une compétence que l'utilisateur a mise là à la main.
 */
export type GesteDeLiaison = 'lier' | 'deja-liee' | 'occupe';

export function gesteDeLiaison(source: string, existant?: string): GesteDeLiaison {
  if (!existant) return 'lier';
  return existant === source ? 'deja-liee' : 'occupe';
}

/**
 * Le bloc annoncé dans le briefing. Vide s'il n'y a aucune compétence : on
 * n'envoie pas un titre pour ne rien dire.
 */
export function texteDesCompetences(liste: Competence[]): string {
  if (!liste.length) return '';
  const lignes = liste.map((c) => `- ${c.nom} : ${c.description} → mode d'emploi : ${c.fichier}`);
  return (
    `COMPÉTENCES PARTAGÉES (${liste.length}) — des modes d'emploi déjà écrits, valables pour TOUS les projets :\n` +
    `${lignes.join('\n')}\n\n` +
    `Dès qu'une demande entre dans le champ d'une compétence, OUVRE son mode d'emploi et suis-le : ` +
    `il dit quelle commande lancer et avec quels identifiants. Ne réponds jamais que tu ne sais pas faire ` +
    `ce qu'une compétence sait faire — et si tu ne fais pas le travail toi-même, nomme-la dans la carte que tu proposes.`
  );
}

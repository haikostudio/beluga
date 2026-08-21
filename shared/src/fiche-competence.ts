/**
 * ÉCRIRE UNE FICHE DE COMPÉTENCE — le format, l'arbre, les deux fichiers
 * d'entrée. Les règles de LECTURE du pool vivent dans
 * `shared/src/competences.ts` ; ici, on ne fait que fabriquer du texte, sans
 * base ni disque.
 *
 * TROIS NIVEAUX, et c'est tout l'objet de ce fichier :
 *
 *   1. AU SOMMET, deux fichiers d'ENTRÉE réécrits par le démon — un sommaire
 *      par thème, un index par symptôme. Ils rattrapent l'agent qui cherche
 *      large (« la barre d'état de l'application installable »).
 *   2. AU MILIEU, la TÊTE de chaque fiche (`SKILL.md`) : un en-tête strictement
 *      standard — `name` et `description`, les deux seules clés que Claude et
 *      GPT lisent — puis des sections NOMMÉES, dans le même ordre partout.
 *   3. EN BAS, les DÉTAILS : des fichiers voisins cités depuis la tête. Ils sont
 *      indexés, donc retrouvables, mais ne pèsent que si on les ouvre.
 *
 * Les clés de HaikoDev (`etat`, `themes`, `symptomes`, `projets`,
 * `provenance-*`) viennent APRÈS les deux standard : un moteur qui ne les
 * connaît pas les ignore, et la fiche reste déclenchable.
 */

import {
  ETAT_PAR_DEFAUT,
  FICHIER_COMPETENCE,
  FICHIER_INDEX_SYMPTOMES,
  FICHIER_SOMMAIRE,
  SECTIONS_DE_FICHE,
  THEME_PAR_DEFAUT,
  type Competence,
  type EtatDeFiche,
  type ProvenanceDeFiche,
} from './competences.js';

/** Ce qu'on écrit dans une fiche : le fond, jamais la mise en page. */
export interface RedactionDeFiche {
  nom: string;
  description: string;
  themes?: string[];
  symptomes?: string[];
  projets?: string[];
  etat?: EtatDeFiche;
  provenance?: ProvenanceDeFiche;
  /** Les six sections, dans l'ordre de `SECTIONS_DE_FICHE`. */
  symptome?: string;
  cause?: string;
  procedure?: string;
  verification?: string;
  pieges?: string;
  echecs?: string;
  /** Les fichiers de DÉTAIL, chemins relatifs au dossier de la fiche. */
  annexes?: { chemin: string; texte: string }[];
}

/**
 * UN NOM DE FICHE EST UN NOM DE DOSSIER, et il ne sort jamais du pool. On refuse
 * donc tout ce qui n'est pas un mot simple en minuscules : un `..`, un `/`, un
 * nom caché ouvriraient l'écriture sur le reste du disque.
 */
export const MOTIF_NOM_DE_FICHE = /^[a-z0-9][a-z0-9-]{1,48}$/;

export function nomDeFicheValide(nom: string): boolean {
  return MOTIF_NOM_DE_FICHE.test(nom.trim());
}

/** Le nom d'annexe accepté : un chemin relatif, sans remontée ni racine. */
export function cheminDAnnexeValide(chemin: string): boolean {
  const propre = chemin.trim();
  if (!propre || propre.startsWith('/') || propre.startsWith('.')) return false;
  if (propre.includes('..') || propre.includes('\\')) return false;
  if (propre === FICHIER_COMPETENCE) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,80}$/.test(propre);
}

function ligneDeListe(valeurs?: string[]): string | undefined {
  const propres = (valeurs ?? []).map((v) => v.trim()).filter(Boolean);
  return propres.length ? propres.join(', ') : undefined;
}

/**
 * LE TEXTE D'UNE FICHE. L'en-tête porte d'abord les deux clés standard, puis
 * celles de HaikoDev ; le corps porte les sections dans l'ordre fixe. Une
 * section vide n'est pas écrite — un titre sans texte ne dit rien et fausse le
 * contrôle de qualité.
 */
export function texteDeLaFiche(redaction: RedactionDeFiche): string {
  const provenance = redaction.provenance ?? {};
  const entete: [string, string | undefined][] = [
    ['name', redaction.nom.trim()],
    ['description', redaction.description.trim().replace(/\s*\n\s*/g, ' ')],
    ['etat', redaction.etat ?? ETAT_PAR_DEFAUT],
    ['themes', ligneDeListe(redaction.themes)],
    ['symptomes', ligneDeListe(redaction.symptomes)],
    ['projets', ligneDeListe(redaction.projets)],
    ['provenance-projet', provenance.projet],
    ['provenance-carte', provenance.carte],
    ['provenance-titre', provenance.titre],
    ['provenance-commit', provenance.commit],
    ['provenance-creee-le', provenance.creeeLe ? String(provenance.creeeLe) : undefined],
    ['provenance-verifiee-le', provenance.verifieeLe ? String(provenance.verifieeLe) : undefined],
    ['provenance-renforcee-par', ligneDeListe(provenance.renforceePar)],
  ];

  const corps: string[] = [`# ${redaction.nom.trim()}`];
  const sections: [string, string | undefined][] = [
    [SECTIONS_DE_FICHE[0], redaction.symptome],
    [SECTIONS_DE_FICHE[1], redaction.cause],
    [SECTIONS_DE_FICHE[2], redaction.procedure],
    [SECTIONS_DE_FICHE[3], redaction.verification],
    [SECTIONS_DE_FICHE[4], redaction.pieges],
    [SECTIONS_DE_FICHE[5], redaction.echecs],
  ];
  for (const [titre, texte] of sections) {
    const propre = texte?.trim();
    if (!propre) continue;
    corps.push(`## ${titre}\n\n${propre}`);
  }

  const annexes = (redaction.annexes ?? []).filter((a) => cheminDAnnexeValide(a.chemin));
  if (annexes.length) {
    corps.push(
      `## Détails\n\n${annexes.map((a) => `- \`${a.chemin.trim()}\``).join('\n')}\n\n` +
        `Ces fichiers ne sont pas à lire d'avance : ouvre celui dont tu as besoin.`,
    );
  }

  const lignesEntete = entete
    .filter((paire): paire is [string, string] => Boolean(paire[1]))
    .map(([cle, valeur]) => `${cle}: ${valeur}`);

  return `---\n${lignesEntete.join('\n')}\n---\n\n${corps.join('\n\n')}\n`;
}

/**
 * COMPLÉTER UNE FICHE EXISTANTE PLUTÔT QUE D'EN CRÉER UNE DEUXIÈME. La nuit
 * relit des cartes voisines : sans cela, le pool fabriquerait trois fiches pour
 * le même symptôme. La provenance D'ORIGINE ne bouge JAMAIS — c'est elle qui dit
 * où la leçon est née — et la nouvelle carte s'ajoute à `renforcee-par`.
 */
export function provenanceRenforcee(
  ancienne: ProvenanceDeFiche,
  carte: { id: string; projet?: string },
): ProvenanceDeFiche {
  const deja = ancienne.renforceePar ?? [];
  const cle = carte.projet ? `${carte.projet}:${carte.id}` : carte.id;
  if (deja.includes(cle) || ancienne.carte === carte.id) return ancienne;
  return { ...ancienne, renforceePar: [...deja, cle] };
}

/* ------------------------------------------------------------------ */
/* LES DEUX FICHIERS D'ENTRÉE                                          */
/* ------------------------------------------------------------------ */

/** L'entête commun aux deux fichiers d'entrée : ils sont ÉCRITS, pas tenus à la main. */
const AVERTISSEMENT =
  '<!-- Écrit par HaikoDev à chaque changement du pool. Ne pas modifier à la main : la prochaine écriture écrase. -->';

/** Le SOMMAIRE par thème : où trouver la bonne fiche quand on cherche large. */
export function texteDuSommaireDesCompetences(
  groupes: { theme: string; fiches: Competence[] }[],
  quand?: string,
): string {
  const corps = groupes.map((groupe) => {
    const lignes = groupe.fiches.map((fiche) => {
      const etat = fiche.etat === 'active' ? '' : ` _(${fiche.etat})_`;
      return `- **${fiche.nom}**${etat} — ${fiche.description}`;
    });
    return `## ${groupe.theme}\n\n${lignes.join('\n')}`;
  });
  const date = quand ? `\n\nDernière écriture : ${quand}.` : '';
  return (
    `${AVERTISSEMENT}\n\n# Sommaire des compétences partagées\n\n` +
    `Un thème par section, une ligne par fiche. Le mode d'emploi d'une fiche est dans ` +
    `\`<nom>/${FICHIER_COMPETENCE}\` ; l'index par symptôme est dans \`${FICHIER_INDEX_SYMPTOMES}\`.` +
    `${date}\n\n${corps.join('\n\n')}\n`
  );
}

/** L'INDEX par symptôme : on cherche par ce qu'on CONSTATE, pas par le nom de la fiche. */
export function texteDeLIndexDesSymptomes(fiches: Competence[]): string {
  const parSymptome = new Map<string, string[]>();
  for (const fiche of fiches) {
    for (const symptome of fiche.symptomes) {
      const cle = symptome.trim().toLowerCase();
      if (!cle) continue;
      parSymptome.set(cle, [...(parSymptome.get(cle) ?? []), fiche.nom]);
    }
  }
  const lignes = [...parSymptome]
    .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
    .map(([symptome, noms]) => `- **${symptome}** → ${[...new Set(noms)].join(', ')}`);
  const corps = lignes.length
    ? lignes.join('\n')
    : "_Aucune fiche ne déclare encore de symptôme (clé `symptomes` de l'en-tête)._";
  return (
    `${AVERTISSEMENT}\n\n# Index par symptôme\n\n` +
    `Ce qu'on CONSTATE, puis la fiche à ouvrir. Le sommaire par thème est dans \`${FICHIER_SOMMAIRE}\`.\n\n${corps}\n`
  );
}

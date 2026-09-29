/**
 * UNE COMPÉTENCE, VUE PAR LA MÉMOIRE — la règle qui fait d'une fiche du pool
 * (`data/competences/<nom>/SKILL.md`) une UNITÉ de la base de connaissances.
 *
 * Les compétences vivaient à part : la recherche de la mémoire (outil
 * « memoire ») ne les rendait jamais, et un agent ne les connaissait que par une
 * liste de noms en tête de sa consigne. Chacune entre donc dans le classeur
 * GLOBAL, sans type neuf (la taxonomie est fermée) : c'est une PROCÉDURE de
 * travail, donc une unité « operation », rangée dans `05_operations`.
 *
 * LE DISQUE RESTE LA SOURCE : certains moteurs lisent le `SKILL.md` directement,
 * avec ses fichiers de détail. L'unité en porte l'essentiel — quand s'en servir,
 * le mode d'emploi, où lire le texte entier — et se RÉÉCRIT à chaque changement
 * de la fiche (`server/src/competences-memoire.ts`), par la porte d'écriture
 * unique. Elle se reconnaît à sa SOURCE : genre « competence », `ref` = le nom
 * de la fiche. Jamais au titre, qui peut changer.
 *
 * IMPORTANCE P2 (P3 pour une fiche de bibliothèque) : l'accueil de la mémoire
 * ne sert que P0/P1 sous un plafond mesuré — des dizaines de fiches importées
 * ne doivent JAMAIS y entrer. Elles se trouvent par la recherche.
 *
 * Rien ici ne touche à la base ni au disque.
 */

import { ficheEnService, type Competence } from './competences.js';
import {
  DETAIL_UNITE_MAX,
  GENRE_SOURCE_COMPETENCE,
  PORTEE_GLOBALE,
  RESUME_UNITE_MAX,
  RESUME_UNITE_MIN,
  TITRE_UNITE_MAX,
  estUniteDeCompetence,
  idDeSujetDUnite,
  sujetDeProjetDeCompetence,
  type Importance,
  type PropositionUnite,
  type Unite,
} from './connaissances.js';

/** Le sujet commun à toutes les unités de compétence : il les regroupe à la recherche. */
export const SUJET_COMPETENCES = 'competences';

/** La portée des unités de compétence : le classeur global, valable pour tous les projets. */
export const PORTEE_DES_COMPETENCES = PORTEE_GLOBALE;

export const IMPORTANCE_COMPETENCE_MAISON: Importance = 'P2';
export const IMPORTANCE_COMPETENCE_BIBLIOTHEQUE: Importance = 'P3';

/** Au-delà, le mode d'emploi s'arrête dans l'unité et renvoie au `SKILL.md` : le détail d'une unité est plafonné. */
export const MODE_D_EMPLOI_DANS_L_UNITE_MAX = 8_000;

/** Les fichiers de détail cités dans l'unité, au plus. */
const ANNEXES_CITEES_MAX = 25;

/** Le nom de la fiche d'une unité de compétence, ou `undefined`. */
export function nomDeCompetenceDeLUnite(u: Pick<Unite, 'source'>): string | undefined {
  return estUniteDeCompetence(u) ? u.source.ref : undefined;
}

export function titreDeLUniteDeCompetence(nom: string): string {
  return `Compétence « ${nom} »`.slice(0, TITRE_UNITE_MAX);
}

function couper(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  return `${texte.slice(0, max - 1).trimEnd()}…`;
}

/** Le corps d'un `SKILL.md`, sans son en-tête. */
export function corpsDuModeDEmploi(texte: string): string {
  const lignes = String(texte ?? '').split(/\r?\n/);
  if (lignes[0]?.trim() !== '---') return lignes.join('\n').trim();
  const fin = lignes.findIndex((ligne, i) => i > 0 && ligne.trim() === '---');
  return (fin < 0 ? lignes : lignes.slice(fin + 1)).join('\n').trim();
}

/**
 * LES TITRES DU MODE D'EMPLOI DESCENDENT SOUS CEUX DE L'UNITÉ. L'unité range son
 * détail en sections « ### » ; un « # » ou un « ## » du `SKILL.md` recopié tel
 * quel se ferait passer pour une section de la fiche rendue. On les décale
 * sous « #### », hors des blocs de code.
 */
export function titresDescendus(texte: string): string {
  let dansUnBloc = false;
  return texte
    .split('\n')
    .map((ligne) => {
      if (/^\s*(```|~~~)/.test(ligne)) dansUnBloc = !dansUnBloc;
      if (dansUnBloc) return ligne;
      const titre = /^(#{1,6})\s+(.*)$/.exec(ligne);
      if (!titre) return ligne;
      return `${'#'.repeat(Math.min(6, titre[1].length + 3))} ${titre[2]}`;
    })
    .join('\n');
}

/** Le résumé de l'unité : la description de la fiche, celle qui dit QUAND s'en servir. */
export function resumeDeLUniteDeCompetence(fiche: Pick<Competence, 'nom' | 'description'>): string {
  let resume = fiche.description.replace(/\s+/g, ' ').trim();
  if (resume.length < RESUME_UNITE_MIN) resume = `${resume || 'Compétence sans description'} — compétence partagée « ${fiche.nom} ».`;
  return couper(resume, RESUME_UNITE_MAX);
}

/**
 * LE DÉTAIL DE L'UNITÉ : quand s'en servir, le mode d'emploi (le corps du
 * `SKILL.md`, titres descendus, coupé au besoin), où lire le texte entier et ses
 * fichiers de détail, puis la provenance. Toujours sous le plafond d'une unité.
 */
export function detailDeLUniteDeCompetence(fiche: Competence, texteDuSkill: string): string {
  const sections: string[] = [];

  const quand: string[] = [fiche.description.replace(/\s+/g, ' ').trim()];
  if (fiche.symptomes.length) quand.push(`Symptômes : ${fiche.symptomes.join(', ')}.`);
  if (fiche.themes.length) quand.push(`Thèmes : ${fiche.themes.join(', ')}.`);
  quand.push(fiche.projets.length ? `Projets : ${fiche.projets.join(', ')}.` : 'Vaut pour tous les projets.');
  if (fiche.etat !== 'active') quand.push(`État de la fiche : ${fiche.etat === 'depreciee' ? 'dépréciée — elle a été contredite ou n’aide plus, lis-la avec prudence' : 'archivée'}.`);
  sections.push(`### Quand s'en servir\n\n${quand.join('\n\n')}`);

  const corps = titresDescendus(corpsDuModeDEmploi(texteDuSkill));
  const coupe = corps.length > MODE_D_EMPLOI_DANS_L_UNITE_MAX;
  const extrait = coupe ? `${corps.slice(0, MODE_D_EMPLOI_DANS_L_UNITE_MAX).trimEnd()}\n\n…` : corps;
  sections.push(
    `### Mode d'emploi\n\n${extrait || '_Le SKILL.md ne porte pas de corps._'}` +
      (coupe ? `\n\n_Suite dans le texte entier : ouvre le SKILL.md ci-dessous._` : ''),
  );

  const fichiers = [`- Texte entier (à suivre tel quel) : \`${fiche.fichier}\``];
  const annexes = fiche.annexes.slice(0, ANNEXES_CITEES_MAX);
  if (annexes.length) {
    fichiers.push(`- Fichiers de détail, dans \`${fiche.dossier}\` — à ouvrir seulement au besoin :`);
    for (const annexe of annexes) fichiers.push(`  - \`${annexe}\``);
    if (fiche.annexes.length > annexes.length) fichiers.push(`  - … et ${fiche.annexes.length - annexes.length} autre(s)`);
  }
  sections.push(`### Où la lire\n\n${fichiers.join('\n')}`);

  const provenance: string[] = [];
  if (fiche.bibliotheque) {
    provenance.push(`Importée de la bibliothèque « ${fiche.bibliotheque} »${fiche.provenance.source ? ` (${fiche.provenance.source})` : ''}.`);
    provenance.push('Gardée telle que ses auteurs l’ont écrite : elle n’a pas encore fait ses preuves ici. Dis ce qu’elle t’a apporté avec l’outil « competences », action « retour ».');
  } else {
    const d = fiche.provenance;
    provenance.push(`Compétence maison${d.projet ? `, apprise sur le projet ${d.projet}` : ''}${d.carte ? ` (carte ${d.carte})` : ''}.`);
    provenance.push('Dis ce qu’elle t’a apporté avec l’outil « competences », action « retour » : c’est ce qui règle sa confiance.');
  }
  sections.push(`### Provenance\n\n${provenance.join(' ')}`);

  return couper(sections.join('\n\n'), DETAIL_UNITE_MAX);
}

/**
 * LA PROPOSITION D'UNITÉ d'une fiche du pool — prête pour la porte d'écriture.
 * `id` : l'unité déjà liée à cette fiche (mise à jour), sinon une création. Une
 * fiche ARCHIVÉE n'a pas de proposition de contenu : son unité se déprécie.
 */
export function propositionDeLaCompetence(
  fiche: Competence,
  texteDuSkill: string,
  options: { confiance: number; id?: string },
): PropositionUnite {
  const sujets = [SUJET_COMPETENCES, ...fiche.projets.map(sujetDeProjetDeCompetence), ...fiche.themes, ...(fiche.bibliotheque ? [`bibliotheque-${fiche.bibliotheque}`] : [])];
  return {
    action: options.id ? 'update' : 'create',
    id: options.id,
    type: 'operation',
    importance: fiche.bibliotheque ? IMPORTANCE_COMPETENCE_BIBLIOTHEQUE : IMPORTANCE_COMPETENCE_MAISON,
    titre: titreDeLUniteDeCompetence(fiche.nom),
    resume: resumeDeLUniteDeCompetence(fiche),
    detail: detailDeLUniteDeCompetence(fiche, texteDuSkill),
    sujets,
    confiance: Math.round(Math.max(0, Math.min(1, options.confiance)) * 100) / 100,
    source: { genre: GENRE_SOURCE_COMPETENCE, ref: fiche.nom },
  };
}

/** Ce que la synchronisation doit faire de l'unité d'une fiche. */
export type GesteDeSynchro = 'creer' | 'mettre-a-jour' | 'deprecier' | 'rien';

/**
 * LE GESTE, fiche par fiche. Une fiche en service (active ou dépréciée) a une
 * unité ACTIVE — une fiche dépréciée reste lisible, son détail le dit. Une
 * fiche archivée, ou disparue du pool, voit son unité dépréciée. RIEN NE
 * S'EFFACE : une unité dépréciée garde ses versions.
 */
export function gesteDeSynchro(
  fiche: Pick<Competence, 'etat'> | undefined,
  unite: Pick<Unite, 'statut'> | undefined,
): GesteDeSynchro {
  const enService = fiche ? ficheEnService(fiche.etat) : false;
  if (!enService) return unite && unite.statut === 'active' ? 'deprecier' : 'rien';
  return unite ? 'mettre-a-jour' : 'creer';
}

/**
 * L'UNITÉ DIT-ELLE DÉJÀ CE QUE LA FICHE DIT ? Comparer avant d'écrire évite
 * une version neuve à chaque démarrage : la synchronisation tourne souvent, la
 * base ne doit bouger que quand la fiche a bougé.
 */
export function uniteAJour(unite: Pick<Unite, 'titre' | 'resume' | 'detail' | 'importance' | 'confiance' | 'statut' | 'sujets'>, p: PropositionUnite): boolean {
  const sujets = Array.isArray(p.sujets) ? p.sujets : [];
  return (
    unite.statut === 'active' &&
    unite.titre === p.titre &&
    unite.resume === p.resume &&
    unite.detail === p.detail &&
    // Une importance RELEVÉE à la main (à l'écran) est gardée : la synchro ne la redescend pas.
    unite.importance <= String(p.importance ?? unite.importance) &&
    Math.abs(unite.confiance - Number(p.confiance ?? unite.confiance)) < 0.005 &&
    sujets.every((s) => unite.sujets.includes(idDeSujetDUnite(String(s))))
  );
}

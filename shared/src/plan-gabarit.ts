/**
 * LE GABARIT D'UN PLAN — la même page, à chaque plan rendu.
 *
 * Les quatre parties étaient déjà EXIGÉES (`jugerLePlan`, `plan-complet.ts`),
 * mais leur FORME restait libre : un plan arrivait tantôt en titres Markdown
 * (« ## Faisabilité »), tantôt en lignes grasses (« **Faisabilité** »), tantôt
 * en début de ligne suivi de deux points. Or le rendu du fil ne met en cadre
 * que les vrais TITRES : un plan écrit en gras s'affichait donc comme un long
 * texte plat, sans hiérarchie ni repère — c'est exactement ce qu'on reprochait
 * à l'écran.
 *
 * Ce module ne juge rien : il RANGE. Il prend le texte tel que le moteur l'a
 * rendu et en tire toujours la même structure — un titre, un résumé d'une
 * ligne, quatre parties numérotées dans l'ordre, et ce qui traîne après (une
 * question posée au bas du plan, par exemple). L'affichage n'a plus alors
 * qu'une seule mise en page à savoir dessiner.
 *
 * Règle pure : ni base, ni disque, ni réseau — donc rejouable seule
 * (`server/src/test/plan-gabarit.test.ts`).
 */

import { BLOC_DES_DECISIONS, BLOC_DES_TACHES, BLOC_EN_CLAIR, PARTIES_DU_PLAN, type PartieDePlan } from './plan-complet.js';
import { aplatiCompact as aplati } from './mots.js';

/** Une partie du plan, telle que l'affichage la dessine. */
export interface PartieRangee {
  /** Repère stable, sans accent : « faisabilite », « chemin-a-suivre »… */
  cle: string;
  /** Le nom canonique de la partie, quelle que soit la tournure employée. */
  nom: string;
  /** Son rang dans le gabarit, de 1 à 4 — le numéro affiché. */
  numero: number;
  /** Ce qu'il y a sous son titre, Markdown compris, sans le titre lui-même. */
  corps: string;
}

/** Un plan rangé selon le gabarit. */
export interface PlanRange {
  /** Le titre du plan, s'il en porte un (« # Refonte de l'accueil »). */
  titre: string | null;
  /**
   * Le résumé d'une ligne posé sous le titre, s'il y en a un. Les plans rendus
   * depuis le passage à la LISTE DES TÂCHES n'en portent plus ; ceux
   * enregistrés avant le portent encore, et doivent s'afficher tels quels.
   */
  resume: string | null;
  /**
   * L'OUVERTURE « En clair » : ce qui sera fait, comment ça fonctionnera, à
   * quoi ça servira — posée avant tout le reste. `null` sur un plan rendu
   * avant ce bloc.
   */
  enClair: string | null;
  /**
   * LE BLOC « Liste des tâches » : ce qu'il y a à réaliser, chaque
   * point avec sa description. `null` sur un plan de l'ancienne forme.
   */
  taches: string | null;
  /**
   * LE BLOC « Décisions des itérations », posé après les tâches : ce qui a été
   * décidé, changé ou abandonné au fil des versions. `null` sur un plan rendu
   * avant ce bloc.
   */
  decisions: string | null;
  /** Les parties trouvées, dans l'ordre du gabarit. */
  parties: PartieRangee[];
  /** Ce qui précède la première partie, titre et résumé retirés. */
  preambule: string;
  /** Ce qui suit la dernière partie et n'appartient à aucune : une question, une note. */
  queue: string;
  /** Le gabarit est-il tenu ? Les quatre parties, dans l'ordre attendu. */
  conforme: boolean;
}

/** Les clés des quatre parties, dans l'ordre du gabarit. */
export const CLES_DU_GABARIT = ['faisabilite', 'chemin-a-suivre', 'consequences', 'ameliorations'] as const;

/**
 * L'HABILLAGE D'UNE LIGNE DE TITRE, retiré : dièses, puce, numéro, gras,
 * icône, deux-points final. « ## 2. 🎯 **Chemin à suivre :** » et « CHEMIN À
 * SUIVRE » doivent rendre le même mot nu.
 */
function titreNu(ligne: string): string {
  return ligne
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^\*\*(.*?)\*\*\s*:?\s*$/, '$1')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .replace(/\s*:\s*$/, '')
    .trim();
}

/**
 * LA PARTIE QU'UNE LIGNE OUVRE, s'il y en a une.
 *
 * On accepte les trois écritures qu'un moteur emploie — titre Markdown, ligne
 * toute en gras, intitulé suivi de deux points —, mais la ligne doit être
 * COURTE et ne rien dire d'autre : « Chemin à suivre : d'abord le serveur »
 * n'ouvre pas une partie, c'est une phrase.
 */
export function partieOuvertePar(ligne: string): PartieDePlan | null {
  return intituleOuvertPar(ligne, PARTIES_DU_PLAN);
}

/**
 * LA LIGNE OUVRE-T-ELLE LE BLOC « LISTE DES TÂCHES » ? Le premier bloc du plan
 * se reconnaît comme les quatre parties, mais il ne compte pas parmi elles :
 * un plan reste conforme sans lui (les versions enregistrées avant ce bloc).
 */
export function blocDesTachesOuvertPar(ligne: string): boolean {
  return intituleOuvertPar(ligne, [BLOC_DES_TACHES]) !== null;
}

/** LA LIGNE OUVRE-T-ELLE L'OUVERTURE « EN CLAIR » ? Même statut que la liste des tâches. */
export function blocEnClairOuvertPar(ligne: string): boolean {
  return intituleOuvertPar(ligne, [BLOC_EN_CLAIR]) !== null;
}

/**
 * LA LIGNE OUVRE-T-ELLE LE BLOC « DÉCISIONS DES ITÉRATIONS » ? Même statut que
 * la liste des tâches : un en-tête avant les quatre parties, jamais l'une
 * d'elles — sinon ses puces tomberaient dans la liste des tâches, ou dans les
 * améliorations où elles deviendraient des idées cliquables.
 */
export function blocDesDecisionsOuvertPar(ligne: string): boolean {
  return intituleOuvertPar(ligne, [BLOC_DES_DECISIONS]) !== null;
}

function intituleOuvertPar(ligne: string, connus: readonly PartieDePlan[]): PartieDePlan | null {
  const nue = ligne.trim();
  if (!nue) return null;

  const estTitreMarkdown = /^#{1,6}\s+\S/.test(nue);
  // La puce ou le numéro qui précède, retirés — mais JAMAIS les étoiles du
  // gras : « **Chemin à suivre :** » doit rester reconnaissable.
  const sansPuce = nue.replace(/^(?:[-•]\s+|\d+[.)]\s*)/, '');
  const estLigneGrasse = /^\*\*[^*]+\*\*\s*:?\s*$/.test(sansPuce);
  const avantDeuxPoints = nue.match(/^([^:]{1,60}):\s*$/);
  if (!estTitreMarkdown && !estLigneGrasse && !avantDeuxPoints) return null;

  const candidat = aplati(titreNu(avantDeuxPoints ? avantDeuxPoints[1] : nue));
  if (!candidat || candidat.length > 60) return null;
  return connus.find((partie) => partie.intitules.some((attendu) => candidat.startsWith(attendu))) ?? null;
}

/**
 * LE PLAN, RANGÉ. Une seule lecture du texte : chaque ligne appartient à la
 * partie ouverte la plus récente, ou au préambule tant qu'aucune ne l'est.
 */
export function rangerLePlan(texte: string): PlanRange {
  const lignes = (texte ?? '').split('\n');
  const preambule: string[] = [];
  const corps = new Map<string, string[]>();
  const ordre: PartieDePlan[] = [];
  let courante: PartieDePlan | null = null;

  /* LES BLOCS D'EN-TÊTE — tâches, puis décisions —, ouverts avant la première
     partie : leurs lignes ne tombent NI dans le préambule — où leur titre
     serait pris pour le résumé — NI dans une partie du gabarit. Chacun a sa
     propre pile. */
  const lignesEnClair: string[] = [];
  const lignesDesTaches: string[] = [];
  const lignesDesDecisions: string[] = [];
  let blocOuvert: 'en-clair' | 'taches' | 'decisions' | null = null;

  for (const ligne of lignes) {
    const ouverte = partieOuvertePar(ligne);
    if (ouverte) {
      blocOuvert = null;
      // Une partie citée deux fois n'ouvre rien la seconde fois : elle reprend
      // la même section, sinon la fin du plan écraserait son début.
      if (!corps.has(ouverte.nom)) {
        corps.set(ouverte.nom, []);
        ordre.push(ouverte);
      }
      courante = ouverte;
      continue;
    }
    if (!courante && blocEnClairOuvertPar(ligne)) {
      blocOuvert = 'en-clair';
      continue;
    }
    if (!courante && blocDesTachesOuvertPar(ligne)) {
      blocOuvert = 'taches';
      continue;
    }
    if (!courante && blocDesDecisionsOuvertPar(ligne)) {
      blocOuvert = 'decisions';
      continue;
    }
    if (courante) corps.get(courante.nom)!.push(ligne);
    else if (blocOuvert === 'en-clair') lignesEnClair.push(ligne);
    else if (blocOuvert === 'taches') lignesDesTaches.push(ligne);
    else if (blocOuvert === 'decisions') lignesDesDecisions.push(ligne);
    else preambule.push(ligne);
  }

  const { titre, resume, reste } = enteteDuPreambule(preambule.join('\n'));
  const enClair = lignesEnClair.join('\n').trim() || null;
  const taches = lignesDesTaches.join('\n').trim() || null;
  const decisions = lignesDesDecisions.join('\n').trim() || null;

  const parties: PartieRangee[] = [];
  PARTIES_DU_PLAN.forEach((partie, index) => {
    const contenu = corps.get(partie.nom);
    if (contenu === undefined) return;
    parties.push({
      cle: CLES_DU_GABARIT[index],
      nom: partie.nom,
      numero: index + 1,
      corps: contenu.join('\n').trim(),
    });
  });

  /* LA QUEUE : ce que le plan ajoute APRÈS sa dernière partie — une question
     posée en une ligne, une note. La consigne demande de la poser là ; on ne
     la noie donc pas dans la quatrième partie, où elle passerait pour une
     suggestion cliquable. */
  const derniere = ordre[ordre.length - 1];
  const queue = derniere ? detacherLaQueue(corps.get(derniere.nom) ?? []) : { corps: '', queue: '' };
  if (derniere && queue.queue) {
    const rangee = parties.find((p) => p.nom === derniere.nom);
    if (rangee) rangee.corps = queue.corps;
  }

  return {
    titre,
    resume,
    enClair,
    taches,
    decisions,
    parties,
    preambule: reste,
    queue: queue.queue,
    conforme: parties.length === PARTIES_DU_PLAN.length,
  };
}

/**
 * LE TITRE ET LE RÉSUMÉ, tirés de ce qui précède la première partie.
 *
 * Le titre est un « # » de premier niveau, ou — à défaut — une première ligne
 * courte qui ne se termine pas par un point : un moteur écrit souvent son
 * titre sans dièse. Le résumé est la ligne suivante, si elle est courte.
 */
function enteteDuPreambule(preambule: string): { titre: string | null; resume: string | null; reste: string } {
  const lignes = preambule.split('\n');
  let titre: string | null = null;
  let resume: string | null = null;
  const reste: string[] = [];

  for (const ligne of lignes) {
    const nue = ligne.trim();
    if (!nue) {
      if (reste.length) reste.push(ligne);
      continue;
    }
    if (titre === null && !reste.length) {
      const dieze = nue.match(/^#{1,2}\s+(.+)$/);
      if (dieze) {
        titre = titreNu(dieze[1]);
        continue;
      }
      if (nue.length <= 90 && !/[.!?]$/.test(nue)) {
        titre = titreNu(nue);
        continue;
      }
    }
    if (titre !== null && resume === null && !reste.length && nue.length <= 240) {
      resume = nue.replace(/^[_*]+|[_*]+$/g, '').trim();
      continue;
    }
    reste.push(ligne);
  }

  return { titre, resume, reste: reste.join('\n').trim() };
}

/**
 * LA DERNIÈRE PARTIE, coupée de ce qui la suit sans lui appartenir : après une
 * ligne de séparation (« --- ») ou après la dernière puce, une phrase isolée
 * qui pose une question est une QUESTION, pas une amélioration.
 */
function detacherLaQueue(lignes: string[]): { corps: string; queue: string } {
  const separateur = lignes.findIndex((l) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l));
  if (separateur >= 0) {
    return {
      corps: lignes.slice(0, separateur).join('\n').trim(),
      queue: lignes.slice(separateur + 1).join('\n').trim(),
    };
  }
  const dernierePuce = lignes.reduce((max, ligne, index) => (/^\s*[-*•]\s+\S/.test(ligne) ? index : max), -1);
  if (dernierePuce < 0) return { corps: lignes.join('\n').trim(), queue: '' };
  const apres = lignes.slice(dernierePuce + 1).join('\n').trim();
  if (!apres || !apres.includes('?')) return { corps: lignes.join('\n').trim(), queue: '' };
  return { corps: lignes.slice(0, dernierePuce + 1).join('\n').trim(), queue: apres };
}

/**
 * LE PLAN REMIS AU GABARIT, EN MARKDOWN SIMPLE.
 *
 * Le plan ne se dessine plus en rapport — entête encadré, sommaire de quatre
 * lignes dépliantes : il se lit comme n'importe quelle réponse du fil, en
 * texte. Mais un moteur écrit parfois ses quatre parties EN GRAS
 * (« **Faisabilité** ») plutôt qu'en titres, et le texte s'afficherait alors
 * en pavé, sans hiérarchie.
 *
 * Cette règle recompose donc le MÊME plan, mots pour mots, avec ses titres
 * normalisés : « # titre », l'ouverture « En clair », le bloc « Liste des tâches », puis « ## <partie> »
 * pour chacune des quatre. Un plan enregistré AVANT ce bloc porte un résumé en
 * italique à la place : il se réémet tel quel. Un texte qui n'est PAS au
 * gabarit rend `null` : mieux vaut l'afficher tel quel qu'un plan reconstruit
 * à tort.
 *
 * Règle pure : ni base, ni disque, ni navigateur.
 */
export function planEnTexteSimple(texte: string): string | null {
  const range = rangerLePlan(texte);
  if (!range.conforme) return null;
  const blocs: string[] = [];
  if (range.titre) blocs.push(`# ${range.titre}`);
  /* Un plan de l'ANCIENNE forme porte encore son résumé en italique : il se
     réémet tel quel. Un plan neuf n'en a pas, il ouvre sur ses tâches. */
  if (range.resume) blocs.push(`_${range.resume}_`);
  if (range.enClair) {
    blocs.push(`## ${BLOC_EN_CLAIR.nom}`);
    blocs.push(range.enClair);
  }
  if (range.taches) {
    blocs.push(`## ${BLOC_DES_TACHES.nom}`);
    blocs.push(range.taches);
  }
  if (range.decisions) {
    blocs.push(`## ${BLOC_DES_DECISIONS.nom}`);
    blocs.push(range.decisions);
  }
  if (range.preambule.trim()) blocs.push(range.preambule.trim());
  for (const partie of range.parties) {
    blocs.push(`## ${partie.nom}`);
    if (partie.corps.trim()) blocs.push(partie.corps.trim());
  }
  if (range.queue.trim()) blocs.push(range.queue.trim());
  return blocs.join('\n\n');
}

import type { SentContextSnapshot } from './models.js';

/**
 * LE PROMPT RÉELLEMENT ENVOYÉ, À PLAT.
 *
 * Sous chaque demande partie, la conversation ne pose plus un bloc « Contexte
 * envoyé » à droite avec sa chronologie, sa recherche et ses blocs repliés :
 * elle pose un REPÈRE simple à GAUCHE, dès que le prompt est parti, et le clic
 * ouvre un tiroir qui montre CE tour-là — rien d'autre. Ce fichier tient la
 * seule règle du tiroir : mettre le prompt à plat, dans l'ordre où il est parti,
 * en une suite de morceaux nommés.
 *
 * Les PASSAGES retrouvés par la recherche (le « RAG ») en font partie : ils sont
 * ce que la machine est allée chercher toute seule, donc ce qu'on vient
 * justement vérifier. Ils se rangent APRÈS les blocs du prompt, chacun nommé par
 * sa source.
 *
 * Aucune mesure, aucun compteur de jetons : seulement du texte.
 */

/** Un morceau nommé du prompt, prêt à être affiché tel quel. */
export interface MorceauDePrompt {
  /** Le nom lisible du morceau (« Demande utilisateur », « Passage — docs/… »). */
  label: string;
  /** Le texte réellement envoyé. Absent quand il n'a pas été conservé. */
  texte?: string;
  /** Vrai pour un morceau relu au cache du moteur plutôt que réécrit. */
  cached: boolean;
  /** Vrai pour un passage retrouvé par la recherche de documentation. */
  passage: boolean;
}

/** Le nom du moteur, tel qu'il s'affiche en tête du tiroir. */
export function nomDuMoteurEnvoye(engine: SentContextSnapshot['engine']): string {
  if (engine === 'claude') return 'Claude Code';
  if (engine === 'cursor') return 'Cursor';
  return 'Codex';
}

/**
 * Le prompt d'un tour, mis à plat : d'abord les blocs du prompt dans leur
 * ordre d'envoi, puis les passages retrouvés par la recherche. Un bloc sans
 * texte reste dans la liste — il DIT que son texte n'a pas été conservé, au
 * lieu de disparaître sans un mot.
 */
export function morceauxDuPromptEnvoye(contexte: SentContextSnapshot): MorceauDePrompt[] {
  const blocs: MorceauDePrompt[] = contexte.blocks.map((bloc) => ({
    label: bloc.label,
    texte: bloc.text,
    cached: Boolean(bloc.cached),
    passage: false,
  }));

  const passages: MorceauDePrompt[] = (contexte.passages ?? []).map((passage) => ({
    label: `Passage retrouvé — ${passage.source}${passage.titre ? ` › ${passage.titre}` : ''}`,
    texte: passage.texte,
    cached: false,
    passage: true,
  }));

  return [...blocs, ...passages];
}

/**
 * LA DEMANDE ELLE-MÊME, telle qu'elle est partie au moteur.
 *
 * Un tour lancé par un BOUTON — une carte qu'on démarre, une reprise, un
 * dépannage de publication — n'écrit aucune bulle de demande dans le fil :
 * personne n'a rien tapé. Le texte réellement envoyé existe pourtant, dans le
 * bloc « Demande utilisateur » de l'instantané. On le rend ici pour pouvoir
 * l'afficher AU-DESSUS du déroulé, là où une bulle se serait trouvée.
 */
export function demandeDuPromptEnvoye(contexte: SentContextSnapshot): string | undefined {
  const bloc = contexte.blocks.find((b) => b.kind === 'request');
  const texte = bloc?.text?.trim();
  return texte ? texte : undefined;
}

/**
 * Ce que la recherche a rapporté pour ce tour, en une phrase : le nombre de
 * passages, ou la raison écrite par le démon quand il n'y en a aucun.
 */
export function mentionDesPassages(contexte: SentContextSnapshot): string | undefined {
  const passages = contexte.passages ?? [];
  if (passages.length) {
    return `${passages.length} passage${passages.length > 1 ? 's' : ''} retrouvé${
      passages.length > 1 ? 's' : ''
    } dans la documentation`;
  }
  return contexte.passagesRaison;
}

/**
 * CE QUI EST PARTI EN MÊME TEMPS QUE LA DEMANDE.
 *
 * La demande n'est qu'un morceau du prompt : à côté d'elle voyagent le briefing
 * du projet, la mémoire (index ou passages retrouvés), la carte en cours, les
 * pièces jointes, la consigne système. Ces morceaux-là étaient bien conservés,
 * mais il fallait ouvrir le tiroir pour seulement SAVOIR qu'ils existaient —
 * l'utilisateur, lui, veut voir d'un coup d'œil ce qui a été transmis en
 * parallèle, au-dessus du déroulé.
 *
 * On rend donc leurs NOMS, dans l'ordre d'envoi, sans la demande elle-même (déjà
 * affichée) ni le gabarit (des séparateurs, jamais du contenu). Les passages
 * retrouvés sont comptés en UNE seule entrée : leur détail vit dans le tiroir.
 * Aucun chiffre de jetons, ici comme ailleurs.
 */
export function donneesParallelesDuPrompt(contexte: SentContextSnapshot): string[] {
  const noms = contexte.blocks
    .filter((bloc) => bloc.kind !== 'request' && bloc.kind !== 'format')
    .map((bloc) => bloc.label.trim())
    .filter(Boolean);

  const passages = contexte.passages ?? [];
  if (passages.length) {
    noms.push(`Passages retrouvés (${passages.length})`);
  }

  // Deux morceaux peuvent porter le même nom (une reprise qui repose son
  // briefing) : on ne l'écrit qu'une fois, la liste sert à se repérer.
  return [...new Set(noms)];
}

/**
 * Le tour entier en texte brut, pour la copie : l'en-tête, puis chaque morceau
 * nommé. C'est exactement ce que le tiroir montre, rien de plus.
 */
export function texteDuPromptEnvoye(contexte: SentContextSnapshot): string {
  const entete = `${nomDuMoteurEnvoye(contexte.engine)}${contexte.model ? ` — ${contexte.model}` : ''}`;
  return [
    entete,
    ...morceauxDuPromptEnvoye(contexte)
      .filter((morceau) => morceau.texte)
      .map((morceau) => `${morceau.label}${morceau.cached ? ' (relu au cache)' : ''}\n\n${morceau.texte}`),
  ].join('\n\n---\n\n');
}

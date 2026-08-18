import type { SentContextSnapshot } from './models.js';

/**
 * LE PROMPT RÉELLEMENT ENVOYÉ, DANS LA CONVERSATION ELLE-MÊME.
 *
 * Il n'y a plus ni pastille à cliquer, ni tiroir à ouvrir : ce qui est parti au
 * moteur se lit COMME DES MESSAGES de l'utilisateur, alignés à droite, dans le
 * même encadré gris que ses demandes. Trois bulles, toujours dans cet ordre :
 * sa demande, ce que la recherche est allée chercher dans la mémoire, puis le
 * prompt COMPLET tel qu'il est parti. Une bulle trop longue ne montre que ses
 * cinq premières lignes, avec « voir plus » en bas.
 *
 * Les PASSAGES retrouvés par la recherche (le « RAG ») ont leur bulle à eux :
 * ils sont ce que la machine est allée chercher toute seule, donc ce qu'on vient
 * justement vérifier. Ils restent aussi DANS le prompt complet, à leur place —
 * la deuxième bulle les met en avant, elle ne les déplace pas. Cette bulle-là est
 * ISOLÉE (`isole`) et repliée plus court que les autres
 * (`LIGNES_VISIBLES_MEMOIRE`) : elle porte son propre encadré, sans quoi elle se
 * lisait comme la première moitié du prompt complet posé juste dessous.
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

/** Le nom du moteur, tel qu'il s'affiche en tête du prompt complet. */
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
    const compte = `${passages.length} passage${passages.length > 1 ? 's' : ''} retrouvé${
      passages.length > 1 ? 's' : ''
    } dans la documentation`;
    const details = [mentionDuModeDeRecherche(contexte), mentionDePertinence(contexte)].filter(Boolean);
    return details.length ? `${compte} · ${details.join(' · ')}` : compte;
  }
  return contexte.passagesRaison;
}

/**
 * PAR LE SENS OU PAR LES MOTS — dit à l'écran, jamais deviné.
 *
 * La recherche ne classe par le SENS que si la documentation du projet est
 * préparée à plus de `COUVERTURE_VECTEURS_MIN` ; en dessous, elle retombe sur
 * une comparaison de mots, bien moins fine. Ce repli n'était visible NULLE PART :
 * la bulle affichait des passages médiocres sans dire pourquoi, et la panne a
 * duré des jours sur HaikoDev (couverture retombée à 53 %). La mention porte
 * donc le mode ET la part préparée — le seul chiffre qui explique le mode.
 *
 * UN CHOIX N'EST PAS UN REPLI, et la mention ne doit pas les confondre. Au
 * lancement d'une carte, les mots exacts sont désormais le réglage VOULU
 * (mesuré : ils font aussi bien que le sens sur ce terrain-là). Écrire « par les
 * MOTS · 99 % de la documentation préparée » se lirait comme la panne de
 * couverture d'hier : la part préparée n'explique plus rien, puisqu'elle est
 * bonne. On dit donc le choix, sans chiffre — le chiffre revient dès que c'est
 * un vrai repli.
 */
export function mentionDuModeDeRecherche(contexte: SentContextSnapshot): string | undefined {
  const mode = contexte.passagesMode;
  if (!mode) return undefined;
  const part = `${Math.round(mode.couverture * 100)} % de la documentation préparée`;
  if (mode.sens) return `par le sens · ${part}`;
  if (mode.choisi) return 'par les mots exacts · le réglage de ce terrain';
  return `par les MOTS · ${part}`;
}

/**
 * RIEN DE NETTEMENT PERTINENT — dit à l'écran, plutôt que servi en silence.
 *
 * `contexte.passagesPertinents` compare le score du passage le mieux placé à
 * la moyenne du reste du corpus (`rechercheConvaincante`,
 * shared/src/passages-doc.ts). Faux ne veut pas dire que la recherche a
 * échoué — les passages restent envoyés, ils peuvent aider — mais que rien ne
 * s'est nettement détaché du reste, contrairement à un passage qui répond
 * clairement à la question. `undefined` (comparaison non faite, ou contexte
 * écrit avant cette règle) ne dit rien, plutôt qu'une fausse alerte.
 */
export function mentionDePertinence(contexte: SentContextSnapshot): string | undefined {
  return contexte.passagesPertinents === false ? 'rien de nettement pertinent trouvé' : undefined;
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
 * Le tour entier en texte brut : l'en-tête, puis chaque morceau nommé. C'est le
 * PROMPT COMPLET de la troisième bulle, et c'est aussi ce que la copie rend.
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

/** Une ligne du prompt complet, avec ce qu'elle vaut : déjà là, ou neuf. */
export interface LigneDePrompt {
  texte: string;
  /** Vrai pour une ligne reprise du cache — DÉJÀ présente, pas facturée. */
  cached: boolean;
}

/**
 * LE PROMPT COMPLET, LIGNE PAR LIGNE, AVEC CE QUI EST DÉJÀ LÀ ET CE QUI EST NEUF.
 *
 * Même contenu que `texteDuPromptEnvoye`, rejoué ligne à ligne pour que
 * l'affichage puisse colorer chaque ligne selon son morceau d'origine : gris
 * pour un morceau relu au cache (`cached`), jaune pour un morceau écrit pour
 * ce tour. L'en-tête et les séparateurs (`---`) ne portent ni l'un ni
 * l'autre — ce ne sont pas des morceaux du prompt, ils balisent l'affichage.
 *
 * La reconstruction suit exactement le `join('\n\n---\n\n')` ci-dessus : entre
 * deux morceaux, cette séparation produit toujours trois lignes (vide, `---`,
 * vide), jamais mêlées aux lignes du texte qui les entoure.
 */
export function lignesDuPromptEnvoye(contexte: SentContextSnapshot): LigneDePrompt[] {
  const entete = `${nomDuMoteurEnvoye(contexte.engine)}${contexte.model ? ` — ${contexte.model}` : ''}`;
  const morceaux = morceauxDuPromptEnvoye(contexte).filter((morceau) => morceau.texte);

  const segments: { texte: string; cached: boolean }[] = [
    { texte: entete, cached: false },
    ...morceaux.map((morceau) => ({
      texte: `${morceau.label}${morceau.cached ? ' (relu au cache)' : ''}\n\n${morceau.texte}`,
      cached: Boolean(morceau.cached),
    })),
  ];

  const lignes: LigneDePrompt[] = [];
  segments.forEach((segment, index) => {
    if (index > 0) {
      lignes.push({ texte: '', cached: false }, { texte: '---', cached: false }, { texte: '', cached: false });
    }
    segment.texte.split('\n').forEach((ligne) => lignes.push({ texte: ligne, cached: segment.cached }));
  });
  return lignes;
}

/**
 * CE QUE LA RECHERCHE A RAMENÉ DE LA MÉMOIRE, en un seul texte.
 *
 * Chaque passage est nommé par sa SOURCE (son fichier, et son titre quand il en
 * a un), puis rendu en clair. Sans aucun passage, on rend la RAISON écrite par
 * le démon — une bulle qui dit « rien, et voici pourquoi » vaut mieux qu'une
 * bulle absente : c'est justement ce qu'on vient vérifier.
 */
export function texteDesPassagesRetrouves(contexte: SentContextSnapshot): string | undefined {
  const passages = contexte.passages ?? [];
  if (!passages.length) return contexte.passagesRaison?.trim() || undefined;
  return passages
    .map((passage) => `${passage.source}${passage.titre ? ` › ${passage.titre}` : ''}\n\n${passage.texte}`)
    .join('\n\n---\n\n');
}

/** Une bulle du prompt envoyé, prête à être posée dans la conversation. */
export interface BulleDePrompt {
  /** Repère stable, pour la clé de rendu et les contrôles d'écran. */
  cle: 'demande' | 'memoire' | 'complet';
  /** Le titre lisible, en tête de la bulle. */
  titre: string;
  /** Une précision courte à côté du titre (le compte des passages, la raison). */
  mention?: string;
  /** Le texte de la bulle, tel qu'il est parti au moteur. */
  texte: string;
  /** Les NOMS des morceaux partis en même temps (troisième bulle seulement). */
  noms?: string[];
  /**
   * Une bulle ISOLÉE : son propre encadré, détaché des messages du fil.
   *
   * La mémoire retrouvée n'est pas un message de l'utilisateur — c'est ce que la
   * machine est allée chercher toute seule. Rendue dans le même encadré gris que
   * le prompt complet, juste au-dessus de lui, elle se lisait comme sa première
   * moitié : deux pavés collés, sans frontière. Elle porte donc son propre fond,
   * son propre écart et son propre repli.
   */
  isole?: boolean;
  /** Combien de lignes cette bulle montre avant qu'on la déroule. */
  lignesVisibles?: number;
  /**
   * Le texte, ligne par ligne, avec ce qui est déjà là et ce qui est neuf —
   * posé seulement sur la bulle « Prompt complet » (`lignesDuPromptEnvoye`).
   * Les autres bulles n'en ont pas besoin : rien n'y est jamais relu au cache.
   */
  lignes?: LigneDePrompt[];
}

/**
 * LES TROIS BULLES DU PROMPT ENVOYÉ, DANS L'ORDRE DEMANDÉ.
 *
 * 1. la demande de l'utilisateur, telle qu'elle est réellement partie ;
 * 2. ce que la recherche est allée chercher dans la mémoire du projet ;
 * 3. le prompt COMPLET, briefing et consigne système compris.
 *
 * `demandeDejaAffichee` vaut vrai quand l'utilisateur a TAPÉ sa demande : sa
 * bulle existe déjà, juste au-dessus, avec son heure et son bouton de copie —
 * la redire mot pour mot ne montrerait rien de neuf. Un tour lancé par un
 * BOUTON (carte démarrée, reprise, dépannage) n'écrit aucune bulle : la
 * première est alors posée ici, à la place qu'elle aurait occupée.
 *
 * Une bulle sans texte n'est pas rendue : on ne pose jamais un encadré vide.
 */
export function bullesDuPromptEnvoye(
  contexte: SentContextSnapshot,
  options: { demandeDejaAffichee?: boolean } = {},
): BulleDePrompt[] {
  const bulles: BulleDePrompt[] = [];

  const demande = demandeDuPromptEnvoye(contexte);
  if (demande && !options.demandeDejaAffichee) {
    bulles.push({ cle: 'demande', titre: 'Votre demande', texte: demande });
  }

  const memoire = texteDesPassagesRetrouves(contexte);
  if (memoire) {
    bulles.push({
      cle: 'memoire',
      /*
       * LE TITRE RESTE COURT : il illustre le contenu de la bulle, jamais le
       * détail (le compte, le mode de recherche ou la raison de son absence),
       * qui vit dans `mention`, affichée SOUS le titre plutôt qu'à sa suite —
       * sinon le titre s'allonge de toute la phrase et déborde de la bulle.
       */
      titre: 'Mémoire retrouvée',
      mention: mentionDesPassages(contexte),
      texte: memoire,
      isole: true,
      lignesVisibles: LIGNES_VISIBLES_MEMOIRE,
    });
  }

  const complet = texteDuPromptEnvoye(contexte);
  if (complet.trim()) {
    bulles.push({
      cle: 'complet',
      titre: 'Prompt complet envoyé à l’agent',
      texte: complet,
      noms: donneesParallelesDuPrompt(contexte),
      lignes: lignesDuPromptEnvoye(contexte),
    });
  }

  return bulles;
}

/**
 * COMBIEN DE LIGNES UNE BULLE MONTRE AVANT « VOIR PLUS ».
 *
 * Cinq : de quoi reconnaître ce qui est parti sans que le prompt entier — des
 * centaines de lignes — pousse la conversation hors de l'écran.
 */
export const LIGNES_VISIBLES_BULLE = 5;

/**
 * COMBIEN DE LIGNES LA BULLE DE MÉMOIRE MONTRE AVANT D'ÊTRE DÉPLIÉE.
 *
 * Trois : de quoi reconnaître d'où vient le premier passage retrouvé, sans que
 * la liste entière — souvent des dizaines de lignes citées mot pour mot — pousse
 * la réponse de l'agent hors de l'écran. C'est un REPÈRE, pas une lecture : on
 * déplie quand on veut vérifier ce que la recherche a rapporté.
 */
export const LIGNES_VISIBLES_MEMOIRE = 3;

/**
 * L'aperçu d'un texte long : ses premières lignes, et le fait qu'il en reste.
 *
 * La coupe se fait sur les vraies lignes du texte. Une ligne unique mais très
 * longue, elle, est repliée par l'affichage (une hauteur bornée à cinq lignes) :
 * c'est le seul cas que cette règle ne peut pas voir, l'écran seul sachant où le
 * texte revient à la ligne.
 */
export function apercuDeBulle(
  texte: string,
  lignes: number = LIGNES_VISIBLES_BULLE,
): { apercu: string; tronque: boolean } {
  const toutes = texte.split('\n');
  if (toutes.length <= lignes) return { apercu: texte, tronque: false };
  return { apercu: toutes.slice(0, lignes).join('\n'), tronque: true };
}

import type { SentContextEtat } from './models.js';

/**
 * LE PROMPT RÉELLEMENT ENVOYÉ, DANS LA CONVERSATION ELLE-MÊME.
 *
 * Il n'y a plus ni pastille à cliquer, ni tiroir à ouvrir : ce qui est parti au
 * moteur se lit dans le fil, côté agent, une étape par information reçue
 * (`filVisuelDeLAgent`, rendu par `web/src/components/prompt-envoye.tsx`).
 * Aucun compteur de jetons sur ces bulles : seulement du texte.
 */

/**
 * LA DEMANDE ELLE-MÊME, telle qu'elle est partie au moteur.
 *
 * Un tour lancé par un BOUTON — une carte qu'on démarre, une reprise, un
 * dépannage de publication — n'écrit aucune bulle de demande dans le fil :
 * personne n'a rien tapé. Le texte réellement envoyé existe pourtant, dans le
 * bloc « Demande utilisateur » de l'instantané. On le rend ici pour pouvoir
 * l'afficher AU-DESSUS du déroulé, là où une bulle se serait trouvée.
 */
export function demandeDuPromptEnvoye(contexte: SentContextEtat): string | undefined {
  const bloc = contexte.blocks.find((b) => b.kind === 'request');
  const texte = bloc?.text?.trim();
  return texte ? texte : undefined;
}

/** Une bulle courte du fil de recherche affiché côté agent. */
export interface BulleDuFilAgent {
  /** Clé stable : les nouvelles réponses s'ajoutent sans remplacer les précédentes. */
  cle: string;
  nature: 'requete' | 'recherche' | 'resume' | 'directives';
  titre: string;
  texte: string;
  reussie: boolean;
}

function couperTexteLisible(texte: string, maximum: number): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  if (propre.length <= maximum) return propre;
  const coupe = propre.slice(0, maximum - 1);
  const dernierEspace = coupe.lastIndexOf(' ');
  return `${coupe.slice(0, dernierEspace > maximum * 0.65 ? dernierEspace : coupe.length).trim()}…`;
}

/**
 * Retire l'habillage technique d'un résultat sans inventer ce qu'il dit.
 * On garde les premières phrases utiles ; les chemins, titres Markdown et
 * blocs de code restent dans le lecteur détaillé, pas dans la conversation.
 */
function lignesLisiblesDuResultat(texte: string): string[] {
  return texte
    .split('\n')
    .map((ligne) =>
      ligne
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*[-*]\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^SUJET\s+«[^»]+»\s*:\s*/i, '')
        .replace(/^[a-z0-9]+(?:-[a-z0-9]+){2,}\s*:\s*/i, '')
        .replace(/(?:\/[\w.@-]+){2,}/g, 'un document du projet')
        .replace(/\b(?:web|server|shared|scripts|docs)\/(?:[\w.@-]+\/?)+/g, 'un document du projet')
        .trim(),
    )
    .filter((ligne) => ligne.length >= 16)
    .filter((ligne) => !/^SUJET\s+«/i.test(ligne))
    .filter((ligne) => !/^(faits|règles|contrôles|pool de compétences)\b.*:$/i.test(ligne))
    .filter((ligne) => !/^(```|const\b|let\b|var\b|import\b|export\b|function\b|class\b)/i.test(ligne))
    .filter((ligne) => !/^tenu automatiquement/i.test(ligne));
}

const TITRE_DE_DIRECTIVES = /^(?:règles?|contrôles?|directives?|instructions?|procédure|garde-fous?|pièges?)\b/i;
const TITRE_DE_SECTION = /^(?:faits?|règles?|contrôles?|directives?|instructions?|procédure|garde-fous?|pièges?|mémoire|compétences?)\b/i;
const MOT_DE_DIRECTIVE = /\b(?:doit|doivent|jamais|toujours|interdit|obligatoire|vérifi|contrôle|garder|conserver|retirer|afficher|appeler|demander|règle)\w*/i;

function lignesDeContexteDuResultat(texte: string): string[] {
  const lignes: string[] = [];
  for (const brute of texte.split('\n')) {
    const sansHabillage = brute.trim().replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
    if (TITRE_DE_DIRECTIVES.test(sansHabillage) && /:\s*$/.test(sansHabillage)) break;
    lignes.push(...lignesLisiblesDuResultat(brute));
  }
  return lignes;
}

function extraitLisibleDuResultat(texte: string): string {
  return lignesDeContexteDuResultat(texte).slice(0, 2).join(' ');
}

/**
 * SECOND PASSAGE, CIBLÉ SUR LES DIRECTIVES.
 *
 * `project_memory` rend souvent d'abord les faits, puis les RÈGLES et les
 * CONTRÔLES du sujet. Le premier extrait lisible s'arrêtait aux faits : toute
 * la suite était bien conservée mais invisible. On reparcourt donc le résultat
 * exact, sans génération, en privilégiant ces sections nommées. Les anciennes
 * réponses sans titres gardent un repli par les mots directifs.
 */
function directivesLisiblesDuResultat(texte: string): string[] {
  const directives: string[] = [];
  let dansLesDirectives = false;

  for (const brute of texte.split('\n')) {
    const ligne = brute.trim().replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
    if (!ligne || /^═+$/.test(ligne)) continue;

    if (TITRE_DE_SECTION.test(ligne) && /:\s*$/.test(ligne)) {
      dansLesDirectives = TITRE_DE_DIRECTIVES.test(ligne);
      if (dansLesDirectives) continue;
      continue;
    }
    if (!dansLesDirectives) continue;

    const [lisible] = lignesLisiblesDuResultat(brute);
    if (lisible) directives.push(lisible);
  }

  if (directives.length) return directives;
  return lignesLisiblesDuResultat(texte).filter((ligne) => MOT_DE_DIRECTIVE.test(ligne));
}

function texteDetailleDesDirectives(
  consultation: NonNullable<SentContextEtat['consultationsMemoire']>[number],
  resume: string,
): string | undefined {
  const dejaResume = resume.toLocaleLowerCase('fr');
  const lignes = (consultation.source === 'competence'
    ? lignesLisiblesDuResultat(consultation.resultat)
    : directivesLisiblesDuResultat(consultation.resultat))
    .filter((ligne) => !dejaResume.includes(ligne.toLocaleLowerCase('fr')))
    .filter((ligne, index, toutes) => toutes.indexOf(ligne) === index)
    .slice(0, 4);
  if (!lignes.length) return undefined;

  const nom = consultation.source === 'competence'
    ? 'Compétences partagées'
    : consultation.requete.trim()
      ? `Mémoire · ${couperTexteLisible(consultation.requete, 48)}`
      : 'Mémoire du projet';
  const texte = `${nom} :\n${lignes.map((ligne) => `• ${ligne}`).join('\n')}`;
  return texte.length <= 480 ? texte : `${texte.slice(0, 479).trimEnd()}…`;
}

/**
 * LE FIL VISIBLE CÔTÉ AGENT : une étape distincte par information reçue.
 *
 * La demande ouvre le fil, puis CHAQUE consultation ajoute ses propres blocs,
 * dans l'ordre où elle a rejoint l'instantané : recherche, résumé du contexte
 * utile, puis directives éventuelles. Les clés portent l'identifiant de la
 * consultation afin qu'une nouvelle réponse ne puisse ni remplir un ancien
 * bloc, ni l'écraser à l'écran.
 */
export function filVisuelDeLAgent(contexte: SentContextEtat): BulleDuFilAgent[] {
  const consultations = contexte.consultationsMemoire ?? [];
  if (!consultations.length) return [];

  const demande = demandeDuPromptEnvoye(contexte) ?? contexte.prompt?.trim() ?? '';
  const bulles: BulleDuFilAgent[] = [
    {
      cle: 'requete',
      nature: 'requete',
      titre: 'Requête reçue',
      texte: couperTexteLisible(demande, 220),
      reussie: true,
    },
  ];

  consultations.forEach((consultation) => {
    const recherche = consultation.source === 'competence'
      ? 'Le catalogue des compétences partagées a été consulté.'
      : consultation.requete.trim()
        ? `La mémoire du projet a été consultée sur « ${couperTexteLisible(consultation.requete, 80)} ».`
        : 'La carte de la mémoire du projet a été consultée.';
    bulles.push({
      cle: `${consultation.id}-recherche`,
      nature: 'recherche',
      titre: 'Recherche effectuée',
      texte: recherche,
      reussie: consultation.reussie,
    });

    const extrait = extraitLisibleDuResultat(consultation.resultat);
    const sujet = consultation.source === 'competence'
      ? 'les compétences disponibles'
      : consultation.requete.trim()
        ? `« ${couperTexteLisible(consultation.requete, 60)} »`
        : 'la mémoire du projet';
    const resume = !consultation.reussie
      ? extrait
        ? `La recherche sur ${sujet} n’a pas abouti : ${extrait}`
        : `La recherche sur ${sujet} n’a pas abouti.`
      : extrait
        ? `Pour ${sujet}, l’agent a retenu : ${extrait}`
        : `La recherche sur ${sujet} a bien répondu, mais son ancien texte n’est plus conservé.`;

    // Une compétence est déjà une directive : la résumer juste avant la
    // recopierait. Les résultats de mémoire, eux, gardent leur résumé propre.
    if (consultation.source !== 'competence') {
      bulles.push({
        cle: `${consultation.id}-resume`,
        nature: 'resume',
        titre: 'Résumé compris',
        texte: couperTexteLisible(resume, 360),
        reussie: consultation.reussie,
      });
    }

    const directives = texteDetailleDesDirectives(
      consultation,
      consultation.source === 'competence' ? '' : resume,
    );
    if (directives) {
      bulles.push({
        cle: `${consultation.id}-directives`,
        nature: 'directives',
        titre: 'Directives retrouvées',
        texte: directives,
        reussie: consultation.reussie,
      });
    }
  });

  return bulles;
}

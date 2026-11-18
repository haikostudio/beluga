/**
 * LES MODES DE RÉALISATION DU STUDIO (demande du 31/10/2026) : des tuiles posées
 * au début de la conversation d'une création, titre et description, qui disent au
 * directeur artistique quel genre de réalisation on attend — une annonce animée,
 * une voix off, une synchronisation labiale, un visage remplacé… Le mode choisi
 * se garde sur la création (`cleDuModeDuStudio`) et part avec chaque tour
 * (`ligneDuModeDuStudio`).
 *
 * Un mode est DISPONIBLE quand une des capacités qu'il demande est couverte par
 * un service branché (`capacitesDuDirecteur`, côté démon). Sinon la tuile reste
 * visible, éteinte, avec sa raison : rien n'est promis que les services ne savent
 * pas faire. Depuis le 31/10/2026, le présentateur parlant (Kling AI Avatar chez
 * kie.ai), le visage remplacé dans une vidéo (Wan 2.2 Animate Replace) et le
 * clonage de voix (Fish Audio par OpenRouter) ont leurs modèles.
 *
 * LISTE VERTICALE ILLUSTRÉE (31/10/2026) : chaque mode a sa photo réaliste
 * (`outils/modes-du-studio/<id>.webp`, fabriquée par Codex), et un clic le choisit
 * ET lance la conversation (`premiereDemandeDuMode`). Ses QUESTIONS propres
 * guident le directeur, qui propose la bibliothèque de styles au bon moment
 * (`OPTION_VOIR_LA_BIBLIOTHEQUE`).
 */

/** L'option d'une question du directeur qui OUVRE la bibliothèque de styles au lieu de répondre. */
export const OPTION_VOIR_LA_BIBLIOTHEQUE = 'Voir la bibliothèque';

export const IDS_DES_MODES_DU_STUDIO = [
  'annonce',
  'voix-off',
  'animation',
  'synchro',
  'presentateur',
  'visage-image',
  'visage-video',
  'clonage-voix',
  'musique',
] as const;
export type IdDuModeDuStudio = (typeof IDS_DES_MODES_DU_STUDIO)[number];

export interface ModeDuStudio {
  id: IdDuModeDuStudio;
  titre: string;
  description: string;
  /** Les capacités qui le rendent possible : UNE suffit. */
  capacites: readonly string[];
  /** Ce que le directeur lit de ce mode, à chaque tour. */
  consigne: string;
  /** LES QUESTIONS PROPRES À CE TYPE, posées une par une au début du brief (après quoi, la bibliothèque au bon moment). */
  questions: readonly string[];
  /** Ce type gagne-t-il à un style visuel ? Alors le directeur propose la bibliothèque une fois le fond posé. */
  style: boolean;
}

export const MODES_DU_STUDIO: readonly ModeDuStudio[] = [
  {
    id: 'annonce',
    titre: 'Vidéo d’annonce',
    description: 'Une courte vidéo animée pour les réseaux : textes, images et plans montés sur la ligne de temps.',
    capacites: ['image', 'animation', 'video', 'composition'],
    consigne: 'une vidéo d’annonce courte pour les réseaux, montée sur la ligne de temps (textes, images, plans animés)',
    questions: ['le sujet et le message à faire passer', 'le réseau visé et la durée (15, 30 ou 60 s)', 'le ton (enjoué, sobre, premium…)', 'les images ou vidéos déjà disponibles', 'l’appel à l’action de la fin'],
    style: true,
  },
  {
    id: 'voix-off',
    titre: 'Voix off',
    description: 'Un texte dit par une voix naturelle, posé sur la vidéo et calé sur les images.',
    capacites: ['voix'],
    consigne: 'une voix off : le texte d’abord, puis la voix finale choisie à l’oreille',
    questions: ['le texte à dire (ou son sujet, si le texte reste à écrire)', 'le ton et le rythme', 'une voix d’homme ou de femme', 'la vidéo qu’elle accompagne, si elle existe'],
    style: false,
  },
  {
    id: 'animation',
    titre: 'Animer une image',
    description: 'Une image fixe devient un plan vidéo qui bouge, quelques secondes.',
    capacites: ['animation'],
    consigne: 'animer une image fournie ou fabriquée : l’image vers la vidéo, quelques secondes',
    questions: ['l’image à animer (pièce jointe, ou à fabriquer)', 'le mouvement voulu (caméra, sujet, ambiance)', 'la durée du plan', 'l’image de fin, s’il y en a une'],
    style: true,
  },
  {
    id: 'synchro',
    titre: 'Synchronisation labiale',
    description: 'Une vidéo d’un visage qui parle reçoit une autre voix, ses lèvres recalées dessus.',
    capacites: ['synchro'],
    consigne: 'une synchronisation labiale : une vidéo d’un visage qui parle reçoit une nouvelle voix, lèvres recalées',
    questions: ['la vidéo du visage qui parle (pièce jointe)', 'la nouvelle voix : un texte à dire ou un enregistrement', 'la langue de la nouvelle voix'],
    style: false,
  },
  {
    id: 'presentateur',
    titre: 'Présentateur parlant',
    description: 'Un personnage à l’écran dit votre texte, face caméra.',
    capacites: ['avatar'],
    consigne: 'un présentateur parlant face caméra qui dit le texte',
    questions: ['le portrait du présentateur (photo de face, pièce jointe) ou son apparence à fabriquer', 'le texte qu’il dit', 'sa voix (une des voix finales, ou votre voix clonée)', 'le décor et le cadrage'],
    style: true,
  },
  {
    id: 'visage-image',
    titre: 'Remplacer un visage (image)',
    description: 'Le visage de vos photos posé sur la personne d’une image.',
    capacites: ['visage'],
    consigne: 'un remplacement de visage sur une image, d’après les photos fournies',
    questions: ['l’image où remplacer la personne', 'les photos du visage à poser (nettes, de face)', 'qui remplacer, s’il y a plusieurs personnes'],
    style: false,
  },
  {
    id: 'visage-video',
    titre: 'Remplacer un visage (vidéo)',
    description: 'Le visage de vos photos posé sur la personne d’une vidéo.',
    capacites: ['visage-video'],
    consigne: 'un remplacement de visage dans une vidéo, d’après les photos fournies',
    questions: ['la vidéo où remplacer la personne (10 Mo au plus)', 'la photo du visage à poser (nette, de face)', 'l’accord de la personne dont le visage est utilisé'],
    style: false,
  },
  {
    id: 'clonage-voix',
    titre: 'Clonage de voix',
    description: 'Votre propre voix, apprise d’un court enregistrement, dit le texte.',
    capacites: ['clonage-voix'],
    consigne: 'un clonage de voix : la voix de l’utilisateur, apprise d’un enregistrement, dit le texte',
    questions: ['un enregistrement de votre voix de 10 à 30 s, au calme (trombone ou micro du champ)', 'votre accord pour cloner cette voix (la vôtre, ou celle d’une personne qui l’a donné)', 'le texte à dire'],
    style: false,
  },
  {
    id: 'musique',
    titre: 'Musique',
    description: 'Un morceau composé pour la vidéo, à son rythme.',
    capacites: ['musique'],
    consigne: 'une musique composée pour la vidéo, calée sur son rythme',
    questions: ['l’ambiance et le genre', 'la durée', 'avec ou sans voix', 'la vidéo qu’elle accompagne, pour caler son rythme'],
    style: false,
  },
];

export interface ModeDisponible {
  mode: ModeDuStudio;
  disponible: boolean;
  /** Pourquoi la tuile est éteinte. */
  raison?: string;
}

/** Chaque mode, et s'il est possible avec les capacités des services branchés. */
export function modesDuStudio(capacites: readonly string[]): ModeDisponible[] {
  const couvertes = new Set(capacites);
  return MODES_DU_STUDIO.map((mode) =>
    mode.capacites.some((c) => couvertes.has(c))
      ? { mode, disponible: true }
      : { mode, disponible: false, raison: 'Aucun service branché ne sait le faire pour l’instant.' },
  );
}

export function estModeDuStudio(id: unknown): id is IdDuModeDuStudio {
  return typeof id === 'string' && (IDS_DES_MODES_DU_STUDIO as readonly string[]).includes(id);
}

export function cleDuModeDuStudio(creationId: string): string {
  return `studio.mode.${creationId}`;
}

/** La ligne que le directeur lit à chaque tour : le mode retenu guide tout le brief. */
export function ligneDuModeDuStudio(id: string | null | undefined): string {
  const mode = MODES_DU_STUDIO.find((m) => m.id === id);
  if (!mode) return '';
  return [
    `MODE DE RÉALISATION CHOISI PAR L’UTILISATEUR : « ${mode.titre} » — ${mode.consigne}. Mène le brief, les questions et les fabrications vers ce résultat.`,
    `SES QUESTIONS, une « ask_user » à la fois et seulement pour ce qui manque encore : ${mode.questions.join(' ; ')}.`,
    mode.style
      ? `LA BIBLIOTHÈQUE AU BON MOMENT : une fois le fond posé (sujet, durée, ton), pose UNE question sur le style visuel dont une option s’intitule exactement « ${OPTION_VOIR_LA_BIBLIOTHEQUE} » — ce bouton ouvre la bibliothèque de styles ; le style choisi arrive en pièce jointe « Style … » dans le message suivant. Les autres options proposent deux ou trois directions décrites en mots.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** LA PREMIÈRE DEMANDE QU'UN CLIC SUR UN MODE ENVOIE AU DIRECTEUR (liste illustrée du début de la conversation). */
export function premiereDemandeDuMode(id: string): string {
  const mode = MODES_DU_STUDIO.find((m) => m.id === id);
  return mode ? `Je veux réaliser : ${mode.titre}. ${mode.description}` : '';
}

/**
 * LE CHOIX DU MODÈLE SE DEMANDE DANS LE FIL (demande du 31/10/2026) : pendant la conception, pour chaque type de
 * média à fabriquer (image, vidéo, voix, musique) qui n'a pas encore de modèle retenu, le directeur pose UNE question
 * listant les modèles disponibles — ceux de kie.ai, de Higgsfield et de fal.ai (rallumés le 11/11/2026), et ceux
 * d'OpenRouter quand leur clé est au coffre —, le service conseillé en tête avec sa raison et son prix, puis note la
 * réponse (outil « studio », action « modeles »). Il ne choisit JAMAIS le service en silence. Sans aucune clé, il
 * propose de la poser dans le fil : une fiche du coffre par clé, au nom exact que lit le Studio.
 */
export function consigneDuChoixDesModeles(cles: { kie: boolean; openrouter: boolean; higgsfield?: boolean; fal?: boolean }): string {
  if (!cles.kie && !cles.openrouter && !cles.higgsfield && !cles.fal) {
    return [
      'AUCUN SERVICE DE FABRICATION N’A SA CLÉ (ni kie.ai, ni Higgsfield, ni fal.ai, ni OpenRouter) : rien ne peut se fabriquer.',
      'Avant tout devis, propose DANS LE FIL de configurer l’un des deux : une question « ask_user » qui demande la clé de kie.ai (https://kie.ai/api-key) ou d’OpenRouter (https://openrouter.ai/settings/keys), avec l’option de l’enregistrer soi-même dans le coffre-fort.',
      'Une clé reçue s’enregistre AUSSITÔT au coffre (« coffre_fort », geste « enregistrer ») : type « cle-api », nom exact « Studio — kie.ai » ou « Studio — OpenRouter », la clé dans la case « cle ». Ne la répète jamais dans le fil.',
    ].join(' ');
  }
  const branches = [cles.kie && 'kie.ai', cles.higgsfield && 'Higgsfield', cles.fal && 'fal.ai', cles.openrouter && 'OpenRouter'].filter(Boolean) as string[];
  const fournisseurs = branches.length > 1 ? `${branches.slice(0, -1).join(', ')} et ${branches[branches.length - 1]}` : branches[0];
  return [
    `CHOIX DU SERVICE ET DU MODÈLE, DANS LE FIL : pour chaque type à fabriquer (image, vidéo, voix, musique) sans modèle retenu, pose UNE question « ask_user » AVANT son premier devis, avec les modèles de ${fournisseurs} pour ce type (outil « studio », action « modeles », pour la liste et les prix) — le service et le modèle que tu CONSEILLES en tête, avec ta raison en une phrase (Higgsfield pour un rendu cinéma ou un mouvement de caméra, fal.ai pour un modèle précis ou les lèvres synchronisées, kie.ai pour un bon rendu au meilleur prix), son prix dans la ligne. Ne choisis JAMAIS le service en silence, même quand un seul a sa clé : dis alors lequel est disponible.`,
    'La réponse se note aussitôt (outil « studio », action « modeles » avec « type » et « modele ») : elle s’impose ensuite aux devis.',
    cles.openrouter ? '' : 'OpenRouter n’a pas de clé : propose-la en une option de la question si un modèle d’OpenRouter conviendrait mieux (même enregistrement au coffre : « Studio — OpenRouter », type « cle-api », case « cle »).',
  ]
    .filter(Boolean)
    .join(' ');
}

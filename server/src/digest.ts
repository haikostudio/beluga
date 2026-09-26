/**
 * Le point du jour, écrit POUR L'OREILLE (PLAN §22).
 *
 * Rien ici ne touche à la base : ce module reçoit un état déjà rassemblé et
 * rend un texte. C'est ce qui permet de l'écouter et de le tester sur des
 * situations inventées, sans démarrer le serveur.
 *
 * Les trois règles qui gouvernent tout le fichier :
 *   1. l'important d'abord — ce qui bloque ou attend une décision passe avant
 *      les compteurs ;
 *   2. on ne dit rien quand il n'y a rien — jamais une liste de zéros ;
 *   3. aucun chiffre ni aucune heure en écriture d'écran — la voix de synthèse
 *      articule mal « 14:32 » et « 2 », elle dit très bien « quatorze heures
 *      trente » et « deux ».
 */

/* ------------------------------------------------------------------ */
/* Les nombres en toutes lettres                                       */
/* ------------------------------------------------------------------ */

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];

const DIZAINES: Record<number, string> = {
  2: 'vingt',
  3: 'trente',
  4: 'quarante',
  5: 'cinquante',
  6: 'soixante',
  8: 'quatre-vingt',
};

function souscent(n: number): string {
  if (n < 20) return UNITES[n];
  // Soixante-dix et quatre-vingt-dix se disent « soixante + dix » et
  // « quatre-vingt + dix » : la dizaine parlée n'est pas la dizaine écrite.
  const base = n < 70 ? Math.floor(n / 10) : n < 80 ? 6 : n < 90 ? 8 : 8;
  const reste = n - (n < 70 ? base * 10 : n < 80 ? 60 : 80);
  const mot = DIZAINES[base];
  if (reste === 0) return base === 8 ? 'quatre-vingts' : mot;
  if (reste === 1 && (base === 2 || base === 3 || base === 4 || base === 5 || base === 6)) {
    return `${mot} et un`;
  }
  if (reste === 11 && base === 6) return 'soixante et onze';
  return `${mot}-${UNITES[reste]}`;
}

/** « quatre-vingt-une tâches » : au féminin, le « un » final devient « une ». */
export function enLettres(n: number, feminin = false): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const entier = Math.round(n);
  let mots: string;
  if (entier < 100) {
    mots = souscent(entier);
  } else if (entier < 1000) {
    const centaines = Math.floor(entier / 100);
    const reste = entier % 100;
    const tete = centaines === 1 ? 'cent' : `${UNITES[centaines]} cent${reste === 0 ? 's' : ''}`;
    mots = reste === 0 ? tete : `${tete} ${souscent(reste)}`;
  } else if (entier < 1000000) {
    const milliers = Math.floor(entier / 1000);
    const reste = entier % 1000;
    const tete = milliers === 1 ? 'mille' : `${enLettres(milliers)} mille`;
    mots = reste === 0 ? tete : `${tete} ${enLettres(reste)}`;
  } else {
    return String(entier);
  }
  if (feminin) mots = mots.replace(/\bun$/, 'une');
  return mots;
}

/* ------------------------------------------------------------------ */
/* Les heures dites à l'oral                                           */
/* ------------------------------------------------------------------ */

/** « quatorze heures trente », « midi », « une heure du matin ». */
export function heureParlee(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  if (h === 0 && m === 0) return 'minuit';
  if (h === 12 && m === 0) return 'midi';
  const heures = h === 1 ? 'une heure' : `${enLettres(h, true)} heures`;
  if (m === 0) return heures;
  return `${heures} ${enLettres(m)}`;
}

/**
 * Quand une chose s'est passée, dit comme on le dirait de vive voix :
 * « ce matin », « hier soir », « il y a trois jours ».
 */
export function momentParle(quand: number, maintenant: number): string {
  const jour = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const ecart = Math.round((jour(maintenant) - jour(quand)) / (24 * 3600 * 1000));
  const h = new Date(quand).getHours();
  const tranche = h < 5 ? 'nuit' : h < 12 ? 'matin' : h < 18 ? 'après-midi' : 'soir';
  if (ecart <= 0) {
    if (tranche === 'nuit') return 'cette nuit';
    if (tranche === 'matin') return 'ce matin';
    if (tranche === 'après-midi') return 'cet après-midi';
    return 'ce soir';
  }
  if (ecart === 1) {
    if (tranche === 'nuit') return 'cette nuit';
    return `hier ${tranche === 'matin' ? 'matin' : tranche === 'après-midi' ? 'après-midi' : 'soir'}`;
  }
  return `il y a ${enLettres(ecart)} jours`;
}

/* ------------------------------------------------------------------ */
/* Nommer les choses sans jargon                                       */
/* ------------------------------------------------------------------ */

/**
 * Un titre de carte tel qu'on le prononcerait : sans balises, sans chemin de
 * fichier, sans identifiant technique, et raccourci s'il n'en finit pas.
 */
export function pourLOreille(texte: string, longueurMax = 70): string {
  let net = (texte ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w.-]*\/[\w./-]+/g, ' ') // chemins et noms de branches
    .replace(/\b[0-9a-f]{7,}\b/gi, ' ') // empreintes et identifiants
    .replace(/[*_#>«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Une heure écrite pour l'œil (« 14:32 ») se dit avant d'être découpée en
  // deux nombres sans rapport.
  net = net.replace(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g, (_, h: string, m: string) => {
    const faux = new Date(2000, 0, 1, Number(h), Number(m));
    return heureParlee(faux);
  });
  net = net.replace(/\b([01]?\d|2[0-3])\s?h\b/g, (_, h: string) => heureParlee(new Date(2000, 0, 1, Number(h), 0)));

  // Les chiffres restés dans un titre se prononcent, eux aussi.
  net = net.replace(/\b\d{1,6}\b/g, (n) => enLettres(Number(n)));

  // Un deux-points dans un titre en ferait un second dans la phrase qui
  // l'annonce : à l'oreille, une virgule suffit à marquer la respiration.
  net = net.replace(/\s*:\s*/g, ', ').replace(/\s+/g, ' ').trim();

  if (net.length > longueurMax) {
    const coupe = net.slice(0, longueurMax);
    // On coupe de préférence à une respiration naturelle (virgule, tiret,
    // deux-points) : « ouvert depuis le » en fin de phrase ne veut rien dire.
    const respiration = Math.max(coupe.lastIndexOf(','), coupe.lastIndexOf(';'), coupe.lastIndexOf(' — '));
    const espace = coupe.lastIndexOf(' ');
    const point = respiration > longueurMax * 0.4 ? respiration : espace > longueurMax * 0.4 ? espace : longueurMax;
    net = coupe.slice(0, point).trim();
    // Un titre ne s'arrête jamais sur un petit mot : « ouvert depuis le » se
    // termine « ouvert depuis ».
    net = net.replace(
      /\s+(le|la|les|un|une|des|du|de|d'|l'|à|au|aux|et|ou|en|dans|sur|pour|avec|par|depuis|sans|chez)$/i,
      '',
    );
  }
  return net.replace(/[.,;:—-]+$/, '').trim();
}

/** Une phrase se dit avec une majuscule : elle suit un point. */
function phrase(texte: string): string {
  const net = texte.trim().replace(/\s+/g, ' ');
  return net ? net.charAt(0).toUpperCase() + net.slice(1) : '';
}

/**
 * Les raisons d'attente sont écrites pour l'écran (« Quota épuisé — reprise à
 * 14:32 », « Bouton Dès que possible »). À l'oreille il faut la cause, pas le
 * mode d'emploi : les cas connus sont redits en une phrase simple, le reste est
 * simplement nettoyé.
 */
export function raisonParlee(texte?: string): string {
  const brut = (texte ?? '').trim();
  if (!brut) return '';
  const bas = brut.toLowerCase();
  if (bas.includes('quota')) return 'la réserve du moteur est épuisée, elle repartira toute seule';
  if (bas.includes('heures creuses')) return 'elle est lourde et attend la nuit pour tourner';
  if (bas.includes('plafond') || bas.includes('capacité') || bas.includes('mémoire')) {
    return 'le serveur est plein, elle démarrera dès qu\'une place se libère';
  }
  if (bas.includes('redémarrage')) return 'elle reprend après un redémarrage du serveur';
  // Le mode d'emploi entre guillemets ne s'écoute pas : on le retire.
  return pourLOreille(brut.replace(/bouton[^.]*\.?/gi, '').replace(/\s*—\s*/g, ', '), 110);
}

/** « A, B et C » — l'énumération telle qu'on la dit, pas « A, B, C ». */
function etPuis(elements: string[]): string {
  if (elements.length <= 1) return elements[0] ?? '';
  // Quand les éléments contiennent déjà des virgules (« Tri des messages, sur
  // ProjetE »), une virgule de plus avant le « et » évite la bouillie.
  const respire = elements.some((e) => e.includes(',')) ? ',' : '';
  return `${elements.slice(0, -1).join(', ')}${respire} et ${elements[elements.length - 1]}`;
}

/** « deux tâches » / « une tâche » — le mot s'accorde tout seul. */
function combien(n: number, singulier: string, pluriel: string, feminin = true): string {
  return `${enLettres(n, feminin)} ${n > 1 ? pluriel : singulier}`;
}

/* ------------------------------------------------------------------ */
/* L'état rassemblé, puis le texte                                     */
/* ------------------------------------------------------------------ */

export interface CarteDite {
  projet: string;
  titre: string;
  detail?: string;
  quand?: number;
}

export interface EtatDuPoint {
  maintenant: number;
  /** Nom du projet quand le point ne porte que sur lui ; absent = tous. */
  projetUnique?: string;
  /** Questions d'agents restées sans réponse : le plus urgent. */
  questions: CarteDite[];
  /** Tâches arrêtées en chemin : échec ou attente d'une ressource. */
  bloquees: CarteDite[];
  /** Travail fini par l'agent, qui attend votre clôture. */
  aClore: CarteDite[];
  /** Tâches proposées par un agent, à accepter ou à écarter. */
  propositions: CarteDite[];
  /** Travail terminé qui attend d'être mis en ligne. */
  aPublier: CarteDite[];
  /** Cartes écrites qui attendent le feu vert. */
  aValider: CarteDite[];
  /** Ce qui tourne à cet instant. */
  enCours: CarteDite[];
  /** Ce qui est parti en ligne depuis la veille. */
  publiees: CarteDite[];
  /** Le compte le plus consommé, s'il approche de sa limite. */
  quota?: { compte: string; pourcent: number };
}

const SEUIL_QUOTA = 75;

/** Combien de titres on cite avant de s'en tenir au nombre. */
const CITES = 2;

function citer(cartes: CarteDite[], avecProjet: boolean): string {
  const noms = cartes.slice(0, CITES).map((c) => {
    const titre = pourLOreille(c.titre);
    // La virgule donne sa respiration à la voix : sans elle, deux titres cités
    // à la suite s'agglutinent en une bouillie (constaté à l'écoute).
    return avecProjet && c.projet ? `${titre}, sur ${c.projet}` : titre;
  });
  return etPuis(noms.filter(Boolean));
}

/** « sur ProjetE » quand le point couvre plusieurs projets, rien sinon. */
function ou(carte: CarteDite, multi: boolean): string {
  return multi && carte.projet ? ` sur ${carte.projet}` : '';
}

/**
 * Le texte lu à voix haute. Des phrases courtes, dans l'ordre de ce qui compte,
 * et rien du tout sur les rubriques vides.
 */
export function composerLePoint(etat: EtatDuPoint): string {
  const brut: string[] = [];
  const multi = !etat.projetUnique;
  const dire = (texte: string) => {
    const net = phrase(texte);
    if (net) brut.push(/[.?!]$/.test(net) ? net : `${net}.`);
  };
  const ouverture = etat.projetUnique
    ? `Il est ${heureParlee(new Date(etat.maintenant))}. Voici le point sur ${etat.projetUnique}.`
    : `Il est ${heureParlee(new Date(etat.maintenant))}. Voici votre point.`;

  /* 1. Ce qui vous attend, vous, avant tout le reste. */
  if (etat.questions.length === 1) {
    const q = etat.questions[0];
    dire(`Un agent vous pose une question${ou(q, multi)}`);
    const dit = pourLOreille(q.detail ?? q.titre, 120);
    if (dit) dire(`Il demande : ${dit}`);
    dire('Il attend votre réponse pour continuer');
  } else if (etat.questions.length > 1) {
    dire(`${combien(etat.questions.length, 'agent attend', 'agents attendent', false)} votre réponse`);
    const projets = [...new Set(etat.questions.map((q) => q.projet).filter(Boolean))];
    if (multi && projets.length) dire(`Sur ${etPuis(projets)}`);
  }

  /* 2. Ce qui est arrêté en chemin. */
  if (etat.bloquees.length === 1) {
    const b = etat.bloquees[0];
    dire(`Une tâche est arrêtée${ou(b, multi)} : ${pourLOreille(b.titre)}`);
    if (b.detail) dire(pourLOreille(b.detail, 110));
  } else if (etat.bloquees.length > 1) {
    dire(`${combien(etat.bloquees.length, 'tâche est arrêtée', 'tâches sont arrêtées')} en chemin`);
    const noms = citer(etat.bloquees, multi);
    if (noms) dire(`Il s'agit de ${noms}`);
  }

  /* 3. Le travail fini, qui n'attend plus que vous. */
  if (etat.aClore.length === 1) {
    const c = etat.aClore[0];
    dire(`Une tâche est terminée${ou(c, multi)} : ${pourLOreille(c.titre)}`);
    // « que vous la clôturiez » se prononce mal (essai à l'écoute) ; la forme
    // directe passe sans accroc.
    dire('Vous pouvez maintenant la clôturer');
  } else if (etat.aClore.length > 1) {
    dire(`${combien(etat.aClore.length, 'tâche est terminée', 'tâches sont terminées')}`);
    const noms = citer(etat.aClore, multi);
    if (noms) dire(`Dont ${noms}`);
    dire('Vous pouvez maintenant les clôturer');
  }

  /* 4. Ce qui attend une décision de votre part. */
  if (etat.propositions.length === 1) {
    const p = etat.propositions[0];
    dire(`Un agent vous propose une tâche${ou(p, multi)} : ${pourLOreille(p.titre)}`);
  } else if (etat.propositions.length > 1) {
    dire(`${combien(etat.propositions.length, 'tâche vous est proposée', 'tâches vous sont proposées')}`);
    const noms = citer(etat.propositions, multi);
    if (noms) dire(`Par exemple ${noms}`);
  }

  if (etat.aPublier.length === 1) {
    const p = etat.aPublier[0];
    dire(`Une tâche est prête à être mise en ligne${ou(p, multi)} : ${pourLOreille(p.titre)}`);
  } else if (etat.aPublier.length > 1) {
    dire(`${combien(etat.aPublier.length, 'tâche est prête', 'tâches sont prêtes')} à être mises en ligne`);
  }

  if (etat.aValider.length) {
    dire(`${combien(etat.aValider.length, 'tâche attend', 'tâches attendent')} votre feu vert`);
  }

  /* 5. Ce qui avance tout seul : rassurant, mais après le reste. */
  if (etat.enCours.length === 1) {
    dire(`Une tâche travaille en ce moment : ${pourLOreille(etat.enCours[0].titre)}`);
  } else if (etat.enCours.length > 1) {
    dire(`${combien(etat.enCours.length, 'tâche travaille', 'tâches travaillent')} en ce moment`);
    const noms = citer(etat.enCours, multi);
    if (noms) dire(`Dont ${noms}`);
  }

  /* 6. Ce qui est déjà derrière nous. */
  if (etat.publiees.length === 1) {
    const p = etat.publiees[0];
    const quand = p.quand ? ` ${momentParle(p.quand, etat.maintenant)}` : '';
    dire(`Une tâche est partie en ligne${quand} : ${pourLOreille(p.titre)}`);
  } else if (etat.publiees.length > 1) {
    dire(`${combien(etat.publiees.length, 'tâche est partie', 'tâches sont parties')} en ligne depuis hier`);
  }

  /* 7. Le seul chiffre technique qui mérite d'être dit : un quota qui se ferme. */
  if (etat.quota && etat.quota.pourcent >= SEUIL_QUOTA) {
    dire(
      `Attention, le compte ${etat.quota.compte} a consommé ${enLettres(Math.round(etat.quota.pourcent))} pour cent de sa réserve`,
    );
  }

  /* Rien à dire : on le dit en une phrase, pas en liste de zéros. */
  if (!brut.length) {
    return `${ouverture} Rien de neuf depuis hier. Tout est calme.`;
  }

  return [ouverture, ...brut].join(' ');
}

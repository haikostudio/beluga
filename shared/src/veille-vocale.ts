/**
 * LA VEILLE DU MODULE DE VOIX — règles pures (carte « Veille privée et réveil « Dis Jarvis » », 16/11/2026).
 *
 * Le module de voix a trois états : COUPÉ (bouton « Voix » désactivé : rien ne parle, rien n'écoute), EN VEILLE
 * (micro ouvert, conversation fermée : le mot de réveil est attendu SUR L'APPAREIL, aucun son n'en sort) et EN
 * CONVERSATION (le direct avec Codex). Ce fichier dit, sans micro ni réseau :
 *   — quels mots la reconnaissance locale doit attendre (`grammaireDuReveil`, avec ses mots leurres) ;
 *   — où commence le mot dans un résultat horodaté, pour ne transmettre que le mot et ce qui le SUIT ;
 *   — si une phrase demande la veille (« mets-toi en veille ») ;
 *   — quand le silence referme la conversation (30 s).
 */
import { formeSonore, normaliserParole } from './reveil-vocal.js';

/** Le silence (ni parole de l'utilisateur, ni voix de Jarvis, ni réponse attendue) qui referme la conversation. */
export const DELAI_VEILLE_MS = 30_000;
/**
 * Une réponse attendue (question posée, Codex au travail) retient la veille, mais pas indéfiniment : au-delà, le
 * silence l'emporte quand même — une conversation oubliée ne reste jamais ouverte.
 */
export const ATTENTE_DE_REPONSE_MAX_MS = 3 * 60_000;
/** Le volume (0 à 1) au-dessus duquel quelqu'un parle — le seuil de l'ancienne écoute, mesuré à un mètre. */
export const SEUIL_DE_PAROLE = 0.06;
/** Ce que la mémoire locale garde de son, au plus, AVANT le mot (jamais transmis) : de quoi retrouver la fin du mot. */
export const TAMPON_AVANT_REVEIL_S = 8;
/** Ce qu'elle garde au plus APRÈS le mot, le temps que la conversation s'ouvre. */
export const TAMPON_APRES_REVEIL_S = 30;

/** Les mots du réveil réglé, un par un, normalisés : « Dis Jarvis » → ['dis', 'jarvis']. */
export function motsDuReveil(mot: string): string[] {
  return normaliserParole(mot).split(' ').filter(Boolean);
}

/**
 * LES MOTS LEURRES. Avec une grammaire réduite au seul mot de réveil, la reconnaissance FORCE tout mot voisin vers
 * lui : mesuré le 16/11/2026 sur les trois voix du serveur, « le devis est parti » et « dix janvier, dis à Marvin »
 * devenaient « dis jarvis ». Donner à ces mots voisins (et aux mots courants) leur propre place les fait reconnaître
 * pour ce qu'ils sont : zéro faux réveil sur une minute de parole de bureau, tous les vrais réveils gardés, chacun
 * avec une confiance de 1.
 */
export const MOTS_LEURRES: readonly string[] = (
  'devis avis service jardin jardiner janvier javel garage gare jarre marvin harvey travis davis paris chavire gravir ' +
  'servir vis vie dix dit dire disons dites dis-lui disque jamais jaune jacques gervais jarret ' +
  'je tu il elle on nous vous ils le la les un une des du de et ou mais donc car que qui quoi est sont a ai as avons ' +
  'ont fait faire va vais pas plus très bien bon oui non merci bonjour salut alors voilà ça cela ce cette ces mon ma ' +
  'mes ton ta tes son sa ses client site page accueil couleurs facture factures semaine mois réunion planning ' +
  'vacances bureau imprimante projet tâche tâches cours carte cartes quelles quel quelle quand comment pourquoi où ' +
  'combien aussi encore ensuite puis avec sans pour par sur sous dans entre film parti partir revoir relancer ' +
  'vérifier parler parle dernière nouvelle nouveau'
).split(' ');

/**
 * LA GRAMMAIRE donnée à la reconnaissance locale : la phrase entière, chacun de ses mots seul, les mots leurres, et
 * « [unk] » pour tout le reste. Rend une chaîne JSON, le format attendu.
 */
export function grammaireDuReveil(mot: string): string {
  const mots = motsDuReveil(mot);
  const phrases = [mots.join(' '), ...mots, ...MOTS_LEURRES, '[unk]'];
  return JSON.stringify([...new Set(phrases.filter(Boolean))]);
}

/** La confiance minimale de CHAQUE mot du réveil dans un résultat (les vrais réveils mesurés valent 1). */
export const CONFIANCE_DU_REVEIL = 0.9;

/** Les mots d'un résultat contiennent-ils la suite du réveil, dans l'ordre et collés ? Rend l'indice qui la suit, sinon -1. */
function finDeLaSuite(mots: string[], attendus: string[]): number {
  if (attendus.length === 0) return -1;
  for (let i = mots.length - attendus.length; i >= 0; i -= 1) {
    if (attendus.every((a, k) => mots[i + k] === a || (a.length > 3 && formeSonore(mots[i + k]) === formeSonore(a)))) {
      return i + attendus.length;
    }
  }
  return -1;
}

/** Un mot d'un résultat DÉFINITIF de la reconnaissance : horodaté, avec sa confiance (0 à 1). */
export interface MotReconnu {
  word: string;
  start: number;
  end: number;
  conf?: number;
}

/**
 * LE RÉVEIL, LU DANS UN RÉSULTAT DÉFINITIF : l'instant (en secondes, sur l'horloge de la reconnaissance) où COMMENCE
 * la dernière occurrence du mot de réveil, chacun de ses mots reconnu avec au moins `CONFIANCE_DU_REVEIL`. `null`
 * sinon. Les résultats PARTIELS ne comptent jamais : ce sont eux qui faisaient les faux réveils. C'est la frontière : rien d'avant ne part ; le mot lui-même
 * part, puis la demande. Le mot transmis sert la réponse « Oui ? » : appelé sans rien demander, Jarvis répond de sa
 * propre voix (consigne de la voix), sans aucun geste venu du dehors — le direct n'en accepte pas (essai du
 * 16/11/2026 : un `response.create` envoyé par le canal ferme la session).
 */
export function debutDuMotDeReveil(resultat: MotReconnu[], mot: string): number | null {
  const surs = resultat.map((m) => ((m.conf ?? 1) >= CONFIANCE_DU_REVEIL ? normaliserParole(m.word) : '[douteux]'));
  const attendus = motsDuReveil(mot);
  const fin = finDeLaSuite(surs, attendus);
  return fin >= 0 ? resultat[fin - attendus.length]!.start : null;
}

/** Les verbes qui, suivis de « en veille », demandent la veille. */
const VERBES_DE_VEILLE = new Set([
  'mets', 'met', 'mettre', 'mettez', 'remets', 'remet', 'remettre', 'remettez',
  'passe', 'passes', 'passer', 'passez', 'repasse', 'repasser', 'repassez',
  'va', 'vas', 'aller', 'allez', 'retourne', 'retournes', 'retourner', 'retournez',
  'reste', 'restes', 'rester', 'restez', 'repars', 'retombe',
]);
/** Ce qui peut se glisser entre le verbe et « en veille » sans changer la demande. */
const PRONOMS = new Set(['toi', 'vous', 'te', 't', 'moi']);
/**
 * CE QUI NE FAIT QU'APPELER OU PONCTUER (carte « Relier Beluga Pass dans les réglages », 16/11/2026) : « Ok, mais toi,
 * en veille » n'a aucun verbe, et Jarvis continuait à répondre (DISC-0007). Une phrase faite SEULEMENT de ces mots puis
 * de « (en) (mode) veille » demande la veille ; un seul autre mot (« le serveur est en veille ») et elle n'en parle
 * qu'en passant.
 */
const ADRESSES = new Set([
  'ok', 'okay', 'oke', 'd', 'accord', 'mais', 'toi', 'vous', 'te', 'jarvis', 'allez', 'aller', 'bon', 'alors', 'et',
  'maintenant', 'hop', 'eh', 'he', 'donc', 'bien', 'oui', 'stop', 'bah', 'ben', 'euh', 'voila', 'merci', 'tu', 'peux',
  'pouvez', 'vas', 'y', 'dis', 'hey', 'bref',
]);
/** Ce qui peut suivre la demande sans la changer : « … en veille, s'il te plaît », « … en veille maintenant ». */
const APRES_LA_DEMANDE = new Set([
  's', 'il', 'te', 'vous', 'plait', 'stp', 'svp', 'merci', 'maintenant', 'jarvis', 'tout', 'de', 'suite', 'la', 'pour',
  'l', 'instant', 'un', 'peu', 'please', 'ok', 'allez',
]);
/** « veille » tel que la transcription l'écrit parfois, en plus de ce qui le SONNE. */
const ECRITURES_DE_VEILLE = new Set(['veille', 'veilles', 'vieille', 'veil', 'veye']);

/**
 * LA PHRASE QUI REMET EN VEILLE : « mets-toi en veille », « met toi en veille », « passe en veille », « va en
 * veille », « tu peux te mettre en veille », « reste en mode veille »… et, sans verbe, « Ok, mais toi, en veille »,
 * « Jarvis, en veille », « mode veille ». La transcription du direct n'écrit pas toujours « veille » juste : on le
 * compare aussi à l'oreille (`formeSonore`). Le sujet d'une autre phrase (« mets la machine en veille », « le serveur
 * est en veille », « veille sur le serveur », « la veille de Noël ») ne déclenche rien : entre le verbe et « en »,
 * seul un pronom est admis, et sans verbe, seuls des mots d'adresse.
 */
export function demandeDeVeille(texte: string): boolean {
  const mots = normaliserParole(texte).split(' ').filter(Boolean);
  const veille = formeSonore('veille');
  const estVeille = (m: string | undefined) => !!m && (ECRITURES_DE_VEILLE.has(m) || (m.length > 3 && formeSonore(m) === veille));
  for (let j = 0; j < mots.length; j += 1) {
    if (!estVeille(mots[j])) continue;
    /* Le début de l'expression : « veille », « mode veille », « en veille », « en mode veille ». */
    let debut = j;
    if (mots[debut - 1] === 'mode') debut -= 1;
    const avecEn = mots[debut - 1] === 'en' || mots[debut - 1] === 'an';
    if (avecEn) debut -= 1;
    /* 1. Un verbe de veille juste avant (un pronom au plus entre les deux). */
    if (avecEn) {
      let k = debut - 1;
      while (k >= 0 && PRONOMS.has(mots[k]!)) k -= 1;
      if (k >= 0 && debut - k <= 2 && VERBES_DE_VEILLE.has(mots[k]!)) return true;
    }
    /* 2. Sans verbe : rien que des mots d'adresse avant, et rien que de la politesse après. */
    const avant = mots.slice(0, debut);
    const apres = mots.slice(j + 1);
    const sansVerbeAdmis = avecEn || mots[j - 1] === 'mode' || avant.length > 0 || apres.length === 0;
    if (sansVerbeAdmis && avant.every((m) => ADRESSES.has(m) || VERBES_DE_VEILLE.has(m)) && apres.every((m) => APRES_LA_DEMANDE.has(m))) return true;
  }
  return false;
}

/**
 * LE SILENCE REFERME-T-IL LA CONVERSATION ? Oui après `DELAI_VEILLE_MS` sans activité — sauf si une réponse est
 * attendue (Codex travaille), auquel cas on attend jusqu'à `ATTENTE_DE_REPONSE_MAX_MS`.
 */
export function retourEnVeilleDu(maintenant: number, derniereActivite: number, reponseAttendue: boolean): boolean {
  const ecoule = maintenant - derniereActivite;
  return ecoule >= (reponseAttendue ? ATTENTE_DE_REPONSE_MAX_MS : DELAI_VEILLE_MS);
}

/*
 * LA PHRASE DE FIN D'UNE CONVERSATION DE PRÉPARATION (carte « Mode voix Jarvis dans le champ d'écriture », 17/11/2026) :
 * « c'est bon », « on arrête », « termine », « fais la synthèse »… Elle ferme la conversation comme « mets-toi en veille »,
 * et la fermeture fait rédiger la synthèse collée dans le champ. Prudente : la phrase entière, adresses et politesse
 * mises à part, doit être l'expression de fin — « c'est bon pour moi, et ajoute… » ne ferme rien.
 */
const EXPRESSIONS_DE_FIN = new Set([
  'c est bon', 'c est tout', 'c est fini', 'on arrete', 'on arrete la', 'on arrete ici', 'arrete', 'arretons',
  'arretons nous la', 'termine', 'terminer', 'on termine', 'on a termine', 'on a fini', 'j ai fini', 'j ai termine',
  'fin de la conversation', 'fais la synthese', 'fais moi la synthese', 'fais une synthese', 'synthetise', 'synthetise ca',
  'tu peux synthetiser', 'tu peux faire la synthese', 'ca suffit',
  /* « C'EST OK » VALIDE (17/11/2026) : la conversation se ferme et la synthèse remplit le champ. « ça me va » reste
     écarté (réponse fréquente à une question de Jarvis), comme « ok » ou « parfait » dits seuls. */
  'c est ok', 'c est okay', 'c est oke', 'c est parfait', 'c est valide', 'valide', 'je valide', 'on valide',
]);
/* « ok » est aussi un mot de politesse retiré en bout de phrase : « c'est ok » se juge donc AVANT ce retrait. */
const FINS_EN_OK = new Set(['c est ok', 'c est okay', 'c est oke']);
const POLITESSE_DE_FIN = new Set([...ADRESSES, ...APRES_LA_DEMANDE].filter((m) => !['tout', 'bon', 'stop'].includes(m)));

export function demandeDeFin(texte: string): boolean {
  const mots = normaliserParole(texte).split(' ').filter(Boolean);
  if (!mots.length || mots.length > 9) return false;
  let debut = 0;
  let fin = mots.length;
  while (debut < fin && POLITESSE_DE_FIN.has(mots[debut]!)) debut += 1;
  let finAvecOk = fin;
  while (finAvecOk > debut && POLITESSE_DE_FIN.has(mots[finAvecOk - 1]!) && !['ok', 'okay', 'oke'].includes(mots[finAvecOk - 1]!)) finAvecOk -= 1;
  if (FINS_EN_OK.has(mots.slice(debut, finAvecOk).join(' '))) return true;
  while (fin > debut && POLITESSE_DE_FIN.has(mots[fin - 1]!)) fin -= 1;
  const coeur = mots.slice(debut, fin).join(' ');
  if (EXPRESSIONS_DE_FIN.has(coeur)) return true;
  /* « Stop », dit seul (avec ses mots d'adresse), ferme aussi. */
  return coeur === 'stop' || (coeur === '' && mots.includes('stop'));
}

/*
 * « COUPE-TOI » COUPE VRAIMENT (carte « Ménage de la mémoire de la voix », 18/11/2026). Constat (DISC-0038) :
 * « Ah mais j'en sais rien, coupe toi, j'y reviendrai à toi quand j'aurai trouvé une solution » — Jarvis répondait
 * « Entendu, j'arrête. » puis « je me tais et j'attends que tu reviennes », et la conversation restait ouverte :
 * `demandeDeFin` ne lit que des phrases COURTES et fixes. La demande de coupure se lit donc AUSSI au milieu d'une
 * phrase longue — mais seulement par des tournures qui ne parlent que de LUI (« coupe-toi », « tais-toi », « je
 * reviens vers toi ») : « coupe la vidéo », « coupe le son du site », « arrête la tâche » ne ferment rien.
 */
const DEMANDES_DE_COUPURE = [
  'coupe toi', 'coupes toi', 'coupez vous', 'couper toi', 'tu peux te couper', 'tu peux couper', 'tu te coupes', 'te couper',
  'tais toi', 'taisez vous', 'tu peux te taire', 'tu te tais', 'chut',
  'je reviens vers toi', 'je reviendrai vers toi', 'je reviens a toi', 'je reviendrai a toi', 'j y reviendrai a toi',
  'je te rappelle', 'je te rappellerai', 'je t appelle plus tard', 'je te reparle', 'je te reparlerai',
  'on se reparle', 'on en reparle plus tard', 'a plus tard jarvis', 'a tout a l heure jarvis', 'raccroche', 'tu peux raccrocher',
  'arrete toi', 'arrete de m ecouter', 'arrete d ecouter', 'ferme la conversation', 'coupe la conversation', 'mets fin a la conversation',
];

/** L'utilisateur demande-t-il à Jarvis de se COUPER (même au milieu d'une phrase longue) ? */
export function demandeDeCoupure(texte: string): boolean {
  const net = ` ${normaliserParole(texte)} `;
  if (!net.trim()) return false;
  return DEMANDES_DE_COUPURE.some((expression) => net.includes(` ${expression} `));
}

/*
 * …ET UNE PAROLE DE JARVIS N'EST PAS UNE ACTION : quand LUI annonce qu'il se coupe (« D'accord, je me coupe. »,
 * « Entendu, j'arrête. », « je me tais et j'attends que tu reviennes »), la conversation se ferme pour de bon, même si
 * la demande de l'utilisateur a été mal transcrite. Une phrase de Jarvis qui parle d'arrêter AUTRE CHOSE (« j'arrête
 * la tâche », « j'arrête ce que je faisais à l'écran ») ne ferme rien.
 */
const ANNONCES_DE_COUPURE = ['je me coupe', 'je me tais', 'j attends que tu reviennes', 'j attends ton retour', 'je me mets en veille', 'je raccroche'];
const ACCORDS = new Set(['d', 'accord', 'entendu', 'ok', 'okay', 'tres', 'bien', 'pas', 'de', 'souci', 'probleme', 'compris', 'parfait', 'alors', 'bon']);

export function jarvisAnnonceSaCoupure(texte: string): boolean {
  const mots = normaliserParole(texte).split(' ').filter(Boolean);
  if (!mots.length) return false;
  const net = ` ${mots.join(' ')} `;
  if (ANNONCES_DE_COUPURE.some((expression) => net.includes(` ${expression} `))) return true;
  // « Entendu, j'arrête. » : « j'arrête » SEUL (après un accord), jamais suivi de ce qu'on arrête.
  let debut = 0;
  while (debut < mots.length && ACCORDS.has(mots[debut]!)) debut += 1;
  const reste = mots.slice(debut).join(' ');
  return reste === 'j arrete' || reste === 'j arrete la' || reste === 'j arrete ici';
}

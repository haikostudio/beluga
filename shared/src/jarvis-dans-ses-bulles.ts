/*
 * JARVIS PARLE DANS SES BULLES (carte « Jarvis : parler dans ses bulles », décisions de l'utilisateur des 22 et
 * 23/11/2026). Les règles pures de la conversation vocale qui ne touchent ni base ni disque :
 *
 * - `annonceUnAffichage` : Jarvis annonce-t-il avoir montré quelque chose (« je te les ai mis », « les voilà ») ? Le
 *   22/11 au soir il l'a dit sans aucun outil d'affichage : le démon le reprend désormais pendant l'appel.
 * - `ecritureDemandee` : la dernière phrase de l'utilisateur demande-t-elle d'ÉCRIRE dans un champ ou une carte ?
 *   Sans elle, Jarvis n'écrit nulle part (il a réécrit le champ et effacé les captures, DISC-0062).
 * - `fermetureGardeLeTravail` : le bouton Arrêter (et « coupe-toi ») coupe TOUT ; toute autre fermeture (silence,
 *   veille, écran caché, page rechargée, bulle démontée) laisse le cerveau finir son travail.
 * - `separateurDeDiscussion` : la ligne de date posée entre deux appels dans la pile de bulles (« Hier, 22 h 31 »).
 * - `recitDesDerniersJours` : ce qui s'est dit ces trois derniers jours, relu localement AVANT toute recherche payante.
 */

/** Le rôle d'un tour gardé dans une discussion vocale : « information » = une bulle d'information de Jarvis. */
export type RoleDUnTourVocal = 'user' | 'assistant' | 'information';

/** Comment un tour se lit dans un récit rendu à la voix. */
export function quiParle(role: string): string {
  if (role === 'user') return 'Toi';
  if (role === 'information') return 'Jarvis (bulle affichée)';
  return 'Jarvis';
}

const plat = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/*
 * LES ANNONCES D'AFFICHAGE : relevées sur DISC-0062 (« je te les ai mis dans la conversation », « tu les vois
 * juste là ») et leurs voisines. Une annonce au FUTUR (« je vais te les mettre ») n'en est pas une : c'est une
 * promesse, l'outil viendra après.
 */
const ANNONCES: readonly RegExp[] = [
  /\bje (te |vous )?(les |l'|la |le )?(ai|viens d'|vien d') ?(mis|mise|mises|affiche|affiches|affichee|affichees|montre|montres|montree|montrees|poses|pose|posee|posees|envoye|envoyes)\b/,
  /\bje (te |vous )?(les |l'|la |le )?viens de (les )?(mettre|afficher|montrer|poser|envoyer)\b/,
  /\b(les|le|la) voila\b/,
  /\bvoila (les|le|la|tes|ton|ta) /,
  /\b(c'est|c est|ils sont|elles sont|il est|elle est|tout est) (bien )?(affiche|affiches|affichee|affichees|a l'ecran|sous tes yeux)\b/,
  /\btu (les |le |la )?vois (juste )?(la|ici|a l'ecran|dans)\b/,
  /\bdans (la|ta|notre) conversation\b/,
  /\bici,? a l'ecran\b/,
  /\b(juste )?(au-dessus|en dessous|ci-dessous|ci-dessus)\b.*\b(bulle|liens?|tableau|liste)\b/,
  /\b(bulle|liens?|tableau|liste)\b.*\b(juste )?(au-dessus|en dessous|ci-dessous|ci-dessus)\b/,
];

/** Jarvis annonce-t-il avoir affiché quelque chose à l'écran ? */
export function annonceUnAffichage(phrase: string): boolean {
  const p = plat(phrase);
  if (!p) return false;
  return ANNONCES.some((r) => r.test(p));
}

/** La correction glissée à la voix quand elle annonce un affichage qui n'a pas eu lieu (une fois par tour). */
export const CORRECTION_D_AFFICHAGE_PRETENDU =
  'CORRECTION DE BELUGA : tu viens d’annoncer un affichage qui n’a PAS eu lieu — aucune bulle n’a été posée à l’écran. Appelle « voix_montrer » MAINTENANT avec ce que tu voulais montrer, ou dis en une phrase que ce n’est pas encore affiché. Ne parle jamais d’une « conversation » ni d’un « fil » : ce qui s’affiche, ce sont tes bulles.';

/*
 * LES DEMANDES D'ÉCRITURE (décision de l'utilisateur, 22/11/2026) : Jarvis n'écrit dans un champ ou une carte QUE
 * si on le lui demande. Les verbes d'écriture, les « mets-le dans la carte », et l'accord à une confirmation
 * (« oui vas-y », « c'est ok ») après une question qui proposait d'écrire.
 */
const ECRITURES: readonly RegExp[] = [
  /\b(ecris|ecrit|ecrire|ecrivez|redige|rediges|rediger|redigez|note|notes|noter|notez|ajoute|ajoutes|ajouter|ajoutez|tape|tapes|taper|tapez|saisis|saisir|saisissez|recopie|recopier|colle|coller|complete|completer|remplis|remplir|envoie|envoyer|envoyez)\b/,
  /\b(mets|met|mettre|mettez|place|placer|insere|inserer)[- ]?(le|la|les|ca|moi|lui)?\b.*\b(carte|champ|demande|message|zone|brouillon|texte)\b/,
  /\bc'?est ok\b/,
  /^(oui|ok|d'accord|vas[- ]y|go|parfait|valide|confirme)\b/,
];

/** La phrase de l'utilisateur demande-t-elle d'écrire dans un champ ou une carte ? */
export function ecritureDemandee(phrase: string | undefined): boolean {
  const p = plat(phrase ?? '');
  if (!p) return false;
  return ECRITURES.some((r) => r.test(p));
}

/** Le refus rendu à Jarvis quand il veut écrire sans qu'on le lui ait demandé. */
export const REFUS_D_ECRITURE_NON_DEMANDEE =
  'Refusé : l’utilisateur ne t’a pas demandé d’écrire dans un champ ni dans une carte. Ses champs ne sont pas à toi. Pour lui MONTRER une information (liens, tableau, liste, chiffres), appelle « voix_montrer » : elle s’affiche dans une bulle au-dessus de toi. S’il faut vraiment écrire, demande-le d’abord par « voix_confirmer ».';

/** La raison posée par le bouton Arrêter de la bulle vocale. */
export const RAISON_DU_BOUTON_ARRETER = 'bouton Arrêter';
/** La raison posée quand l'utilisateur demande à voix haute de couper (« coupe-toi »). */
export const RAISON_DE_LA_COUPURE_DEMANDEE = 'coupure demandée à la voix';

/**
 * LA FERMETURE GARDE-T-ELLE LE TRAVAIL DU CERVEAU ? (décision de l'utilisateur, 23/11/2026) Le bouton Arrêter — et
 * « coupe-toi », le même geste dit à voix haute — coupe TOUT. Toute autre fermeture est automatique (silence, veille,
 * écran caché, page rechargée, bulle démontée, panne du micro) : le travail continue, le bouton du bord tourne, et
 * Jarvis rappelle à la fin.
 */
export function fermetureGardeLeTravail(raison: string | undefined | null): boolean {
  const r = (raison ?? '').trim();
  return r !== RAISON_DU_BOUTON_ARRETER && r !== RAISON_DE_LA_COUPURE_DEMANDEE;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 22 h 31 » */
function heureCourte(d: Date): string {
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * LA LIGNE DE DATE ENTRE DEUX APPELS (maquette #f1e9) : « Aujourd'hui, 9 h 12 », « Hier, 22 h 31 », sinon
 * « 20 nov., 16 h 54 » (l'année seulement si elle n'est pas celle d'aujourd'hui).
 */
export function separateurDeDiscussion(debut: number, maintenant: number = Date.now()): string {
  const d = new Date(debut);
  const m = new Date(maintenant);
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(m) - jour(d)) / 86_400_000);
  if (ecart === 0) return `Aujourd’hui, ${heureCourte(d)}`;
  if (ecart === 1) return `Hier, ${heureCourte(d)}`;
  const annee = d.getFullYear() !== m.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}${annee}, ${heureCourte(d)}`;
}

/** Combien de tours une page de l'historique des bulles rend au plus. */
export const TOURS_PAR_PAGE_D_HISTORIQUE = 40;
/** Au-delà, la pile cesse de monter : elle ne garde jamais plus de tours anciens que ceci. */
export const TOURS_MAX_D_HISTORIQUE_A_L_ECRAN = 400;

/** Le récit des derniers jours couvre cette fenêtre. */
export const FENETRE_DU_RECIT_MS = 72 * 3600_000;
/** Et ne dépasse pas ce nombre de signes. */
export const SIGNES_MAX_DU_RECIT = 4000;

/**
 * LE RÉCIT DES TROIS DERNIERS JOURS (décision de l'utilisateur, 23/11/2026 : « avant toute recherche, remonter le
 * flux de la discussion pour savoir de quoi on parlait »). Les discussions de la fenêtre, la plus récente d'abord,
 * chacune sous sa date, avec ses DERNIERS échanges (le dernier mot compte) ; le budget est partagé à parts égales,
 * une bulle d'information garde ses liens.
 */
export function recitDesDerniersJours(
  discussions: readonly { id?: string; debut: number; echanges: readonly { role: string; texte: string }[] }[],
  maintenant: number = Date.now(),
  max = SIGNES_MAX_DU_RECIT,
  fenetreMs = FENETRE_DU_RECIT_MS,
): string {
  const utiles = discussions
    .filter((d) => maintenant - d.debut <= fenetreMs && d.echanges.some((e) => e.texte.trim()))
    .sort((a, b) => b.debut - a.debut);
  if (!utiles.length) return '';
  const parDiscussion = Math.max(200, Math.floor(max / utiles.length));
  const blocs: string[] = [];
  for (const d of utiles) {
    const tete = `— ${d.id ? `${d.id} · ` : ''}${separateurDeDiscussion(d.debut, maintenant)} :`;
    const lignes: string[] = [];
    let reste = parDiscussion - tete.length - 1;
    for (let i = d.echanges.length - 1; i >= 0 && reste > 40; i -= 1) {
      const e = d.echanges[i]!;
      const texte = e.texte.replace(/\s+/g, ' ').trim();
      if (!texte) continue;
      let ligne = `${quiParle(e.role)} : ${texte}`;
      if (ligne.length + 1 > reste) ligne = `${ligne.slice(0, Math.max(0, reste - 2)).replace(/\s+\S*$/, '')}…`;
      lignes.unshift(ligne);
      reste -= ligne.length + 1;
    }
    if (lignes.length) blocs.push([tete, ...lignes].join('\n'));
  }
  return blocs.join('\n').slice(0, max);
}

/**
 * CE QUE JARVIS ÉCRIT S'AJOUTE À LA SUITE (décision de l'utilisateur, 22/11/2026) : jamais rien effacé ni remplacé —
 * les pastilles « [fichier: …] » des captures restent en place. Un saut de ligne sépare l'ajout d'un champ à plusieurs
 * lignes, une espace d'un champ d'une ligne ; un champ vide reçoit le texte tel quel.
 */
export function texteApresAjout(avant: string, ajout: string, multiligne: boolean): string {
  const debut = avant ?? '';
  if (!debut.trim()) return ajout;
  if (!ajout) return debut;
  const sep = multiligne ? (debut.endsWith('\n') ? '' : '\n') : debut.endsWith(' ') ? '' : ' ';
  return `${debut}${sep}${ajout}`;
}

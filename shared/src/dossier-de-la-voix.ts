/*
 * LE DOSSIER DE VÉRIFICATION DE JARVIS (carte « Jarvis plus fiable et vérifié », 18/11/2026).
 *
 * Mesure du 18/11 (`scripts/verif-raisonnement-jarvis.mjs`, 91 demandes vocales du 03/11 au 18/11) : la mémoire de
 * Beluga n'était ouverte qu'UNE fois sur 91, et 54 % des réponses ne vérifiaient RIEN. La recherche faite par Beluga
 * ne partait que pour une phrase tournée vers le passé (`questionSurLePasse`), et la consigne du cerveau plafonnait
 * ses coups d'œil à « un, deux au plus ». Le dossier réunit, en parallèle et sous délai, les quatre sources (mémoire,
 * discussions, tableau, activité) ; l'écran en montre les étapes cochées une à une.
 *
 * DÉCISION DE L'UTILISATEUR DU 18/11/2026 (carte « Jarvis : répondre sans tout raconter ») : le dossier NE PART PLUS
 * D'OFFICE à chaque phrase — seulement quand le cerveau appelle `voix_dossier`, c'est-à-dire quand la demande l'exige
 * (le passé, l'état de Beluga, une tâche, une action). Plus aucune étape n'est DITE à voix haute.
 *
 * Ce fichier porte les règles pures : quelle phrase pourrait se vérifier, le texte du dossier et le court résultat
 * d'une étape.
 */
import { normaliserParole } from './reveil-vocal.js';

/** Les quatre sources du dossier, dans l'ordre où l'écran les montre. */
export const SOURCES_DU_DOSSIER = [
  { cle: 'memoire', libelle: 'Mémoire de Beluga' },
  { cle: 'discussions', libelle: 'Discussions passées' },
  { cle: 'cartes', libelle: 'Tableau des tâches, tous les projets' },
  { cle: 'activite', libelle: 'Mises en ligne, en production et ce qui attend' },
] as const;
export type SourceDuDossier = (typeof SOURCES_DU_DOSSIER)[number]['cle'];

/** La dernière étape de la liste : cochée quand la réponse finale part. */
export const ETAPE_DU_RECOUPEMENT = 'Je recoupe les réponses';

const ACCUSES = new Set([
  'ok', 'okay', 'oui', 'ouais', 'non', 'merci', 'super', 'parfait', 'cool', 'top', 'nickel', 'bien', 'daccord', 'd', 'accord',
  'genial', 'tres', 'bon', 'vas', 'y', 'ca', 'marche', 'entendu', 'compris', 'hum', 'mm', 'hm', 'euh', 'ah', 'oh',
]);
const FINS = ['c est ok', 'c est bon', 'on arrete', 'termine', 'fais la synthese', 'c est tout'];
const COUPURES = ['coupe toi', 'tais toi', 'je reviens vers toi', 'j y reviendrai', 'en veille', 'mets toi en veille'];

/**
 * CETTE PHRASE APPELLE-T-ELLE UNE VÉRIFICATION ? Oui pour toute phrase qui a un contenu — plus seulement celles qui
 * renvoient au passé. Non pour ce qui n'est qu'un appel (« Jarvis »), un accusé (« ok merci »), la mise en veille, la
 * coupure ou la fin de l'échange : rien à vérifier, et une recherche inutile ferait parler la voix à contretemps.
 */
export function demandeAVerifier(texte: string, nom = 'Jarvis'): boolean {
  const net = normaliserParole(texte ?? '');
  if (!net) return false;
  const lui = normaliserParole(nom || 'Jarvis');
  const mots = net.split(' ').filter((m) => m && m !== lui && m !== 'dis' && m !== 'hey');
  if (!mots.length) return false;
  if (mots.length <= 4 && mots.every((m) => ACCUSES.has(m))) return false;
  const phrase = ` ${mots.join(' ')} `;
  if (mots.length <= 6 && FINS.some((f) => phrase.includes(` ${f} `))) return false;
  if (mots.length <= 8 && COUPURES.some((c) => phrase.includes(` ${c} `))) return false;
  return true;
}

/** Ce que la recherche a rendu, source par source (lignes déjà rédigées). */
export interface TrouveDuDossier {
  memoire: readonly string[];
  discussions: readonly string[];
  cartes: readonly string[];
  /** Le résumé court de l'activité (tâches en cours, publications, ce qui attend), ou vide. */
  activite?: string;
  /** Les sources qui n'ont pas répondu à temps. */
  enRetard?: readonly SourceDuDossier[];
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Le court résultat d'une source, tel que la liste de l'écran et la voix le disent (« 3 éléments trouvés »). */
export function resultatDeLaSource(cle: SourceDuDossier, trouve: TrouveDuDossier): string {
  if (trouve.enRetard?.includes(cle)) return 'pas de réponse à temps';
  switch (cle) {
    case 'memoire':
      return trouve.memoire.length ? pluriel(trouve.memoire.length, 'élément trouvé', 'éléments trouvés') : 'rien de précis';
    case 'discussions':
      return trouve.discussions.length ? pluriel(trouve.discussions.length, 'discussion retrouvée', 'discussions retrouvées') : 'aucune sur ce sujet';
    case 'cartes':
      return trouve.cartes.length ? pluriel(trouve.cartes.length, 'tâche approchante', 'tâches approchantes') : 'aucune tâche approchante';
    default:
      return resumeDeLActivite(trouve.activite ?? '');
  }
}

/** « 2 tâches au travail · 1 publication en cours · 3 décisions attendent », lu dans le résumé court. */
export function resumeDeLActivite(activite: string): string {
  if (!activite.trim()) return 'illisible';
  const nombre = (re: RegExp) => Number(re.exec(activite)?.[1] ?? 0);
  const taches = nombre(/TÂCHES EN COURS[^\n]*En cours \((\d+)\)/);
  const publications = nombre(/MISES EN LIGNE ET EN PRODUCTION[^\n]*En cours \((\d+)\)/);
  const attentes = nombre(/CE QUI T'ATTEND \(décisions, questions, plans — (\d+)\)/);
  const morceaux = [
    taches ? pluriel(taches, 'tâche au travail', 'tâches au travail') : 'aucune tâche au travail',
    publications ? pluriel(publications, 'publication en cours', 'publications en cours') : 'aucune publication en cours',
  ];
  const aDeployer = nombre(/À DÉPLOYER \((\d+) projets?/);
  const aProduire = nombre(/EN ATTENTE DE MISE EN PRODUCTION \((\d+) projets?/);
  if (aDeployer) morceaux.push(pluriel(aDeployer, 'projet à déployer', 'projets à déployer'));
  if (aProduire) morceaux.push(pluriel(aProduire, 'projet attend la production', 'projets attendent la production'));
  if (attentes) morceaux.push(`${pluriel(attentes, 'décision attend', 'décisions attendent')}`);
  return morceaux.join(' · ');
}

/** Ce que le dossier ne dépasse pas : le cerveau le lit à chaque phrase. */
export const SIGNES_MAX_DU_DOSSIER = 6000;

/**
 * LE DOSSIER RENDU AU CERVEAU (`voix_dossier`) : ce que Beluga a trouvé pour la phrase, source par source, avec les
 * identifiants à OUVRIR quand la question l'exige. Il ne dit pas quoi répondre : il donne de quoi vérifier.
 */
export function texteDuDossier(demande: string, trouve: TrouveDuDossier, max = SIGNES_MAX_DU_DOSSIER): string {
  const blocs: string[] = [`DOSSIER DE BELUGA pour « ${demande.replace(/\s+/g, ' ').trim().slice(0, 200)} »`];
  const bloc = (titre: string, lignes: readonly string[], vide: string) => blocs.push(`${titre} :\n${lignes.length ? lignes.join('\n') : vide}`);
  bloc('MÉMOIRE DE BELUGA (unités ; « memoire » « lire » avec l’id pour le texte entier)', trouve.memoire, '- rien de précis trouvé sur ces mots');
  bloc('DISCUSSIONS VOCALES PASSÉES (« memoire » « lire » avec l’id DISC-…)', trouve.discussions, '- aucune sur ce sujet');
  bloc('TÂCHES APPROCHANTES, TOUS PROJETS', trouve.cartes, '- aucune carte ne porte ces mots');
  blocs.push(`ACTIVITÉ EN CE MOMENT :\n${trouve.activite?.trim() || '- illisible : appelle « assistant_resume »'}`);
  if (trouve.enRetard?.length) blocs.push(`Sans réponse à temps : ${trouve.enRetard.join(', ')} — interroge-les toi-même si la question en dépend.`);
  const texte = blocs.join('\n\n');
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

/**
 * LE COURT RÉSULTAT D'UN OUTIL DU CERVEAU, pour la liste cochée et la voix (« 4 éléments trouvés », « 2 tâches
 * trouvées »). `null` quand le résultat ne se résume pas en quelques mots : l'étape est alors seulement cochée.
 */
export function resultatDeLOutil(outil: string, args: Record<string, unknown>, texte: string | null | undefined): string | null {
  const t = String(texte ?? '');
  if (!t) return null;
  const action = typeof args.action === 'string' ? args.action : '';
  if (outil === 'memoire' && args.geste === 'chercher') {
    const n = Number(/(\d+) unité\(s\)/.exec(t)?.[1] ?? 0);
    const disc = (t.match(/^- DISC-\d+/gm) ?? []).length;
    if (!n && !disc) return 'rien trouvé';
    return [n ? pluriel(n, 'élément trouvé', 'éléments trouvés') : '', disc ? pluriel(disc, 'discussion', 'discussions') : ''].filter(Boolean).join(' · ');
  }
  if (outil === 'memoire' && args.geste === 'lire') return 'lu';
  if (outil === 'assistant_gestes' && action === 'trouver') {
    const n = (t.match(/^- « /gm) ?? []).length;
    return n ? pluriel(n, 'tâche trouvée', 'tâches trouvées') : 'aucune tâche trouvée';
  }
  if (outil === 'assistant_resume') return resumeDeLActivite(t);
  if (outil === 'voix_dossier') return 'dossier lu';
  return null;
}


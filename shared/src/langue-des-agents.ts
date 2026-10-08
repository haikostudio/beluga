/**
 * LA LANGUE DANS LAQUELLE LES AGENTS ÉCRIVENT.
 *
 * L'interface parle cinq langues (`shared/src/langues.ts`), mais les agents
 * écrivaient toujours en français : leur consigne système le disait en toutes
 * lettres (« Réponds en français simple »). Un utilisateur qui avait mis
 * l'application en anglais lisait donc son écran en anglais et les réponses de
 * ses agents en français — et les modèles, laissés sans consigne, répondaient
 * parfois dans la langue de leur propre entraînement.
 *
 * LA RÈGLE : un agent écrit TOUT dans la langue réglée par l'utilisateur —
 * réponse principale, questions posées avec « ask_user », lignes de la liste de
 * tâches, messages d'erreur, explications, textes de facturation. Rien n'est
 * laissé au hasard du modèle.
 *
 * CE QUI RESTE EN FRANÇAIS, ET C'EST VOULU : le code, les commentaires, les
 * messages de commit, la documentation et la mémoire du projet. Ils sont ÉCRITS
 * en français, source de tout le reste, et un projet dont la moitié des
 * fichiers changerait de langue au gré d'un réglage d'affichage deviendrait
 * illisible. C'est le même parti pris que le dictionnaire : on traduit ce qui
 * s'AFFICHE, jamais ce qui est ENREGISTRÉ.
 */
import { LANGUE_DORIGINE, langueValide, type LangueId } from './langues.js';

/**
 * Le nom de chaque langue DANS ELLE-MÊME, tel qu'on l'emploie dans la consigne.
 * On le donne au modèle dans sa propre langue ET en français : les deux se
 * renforcent, et aucun modèle ne se trompe alors de cible.
 */
const NOM_DE_LA_LANGUE: Record<LangueId, { dansElleMeme: string; enFrancais: string }> = {
  fr: { dansElleMeme: 'français', enFrancais: 'français' },
  en: { dansElleMeme: 'English', enFrancais: 'anglais' },
  es: { dansElleMeme: 'español', enFrancais: 'espagnol' },
  de: { dansElleMeme: 'Deutsch', enFrancais: 'allemand' },
  zh: { dansElleMeme: '中文', enFrancais: 'chinois' },
};

/**
 * LE BLOC DE CONSIGNE POSÉ EN TÊTE DE CHAQUE ACCUEIL D'AGENT.
 *
 * Il est court exprès : il part dans TOUTES les consignes système, de l'agent
 * de tâche au dépanneur de publication, et chaque signe y est payé à chaque
 * tour. Il est aussi le PREMIER bloc, avant la méthode : ce qui est dit en tête
 * est ce qu'un modèle applique le plus fidèlement.
 */
export function consigneDeLangue(valeur: unknown): string {
  const langue = langueValide(valeur);
  const { dansElleMeme, enFrancais } = NOM_DE_LA_LANGUE[langue];
  const cible = langue === LANGUE_DORIGINE ? enFrancais : `${enFrancais} (${dansElleMeme})`;
  return (
    `LANGUE DE TES RÉPONSES : ${cible.toUpperCase()}, et rien d'autre. ` +
    `C'est la langue que l'utilisateur a réglée dans l'application, et TOUT ce qu'il lit de toi la suit : ` +
    'ta réponse, ses titres, les questions posées avec « ask_user », les lignes de ta liste de tâches, ' +
    'les messages d\'erreur, les explications et les textes destinés au client. ' +
    "Tu n'écris JAMAIS dans une autre langue, même si la demande, un fichier ou un message d'outil t'arrive dans celle-là. " +
    'Le CODE, les commentaires, les messages d\'enregistrement, la documentation et la mémoire du projet restent, eux, ' +
    'dans la langue où le projet est écrit : on traduit ce qui s\'AFFICHE, jamais ce qui est ENREGISTRÉ.'
  );
}

/**
 * LE TON DE CE QUE L'UTILISATEUR LIT : VULGARISÉ, D'ADULTE À ADULTE.
 *
 * La consigne commune disait « Réponds en phrases simples, pour un lecteur non
 * technique » — une demi-phrase noyée dans la méthode, que les modèles ne
 * suivaient pas, et que l'agent de cadrage ne recevait même pas. Les
 * compréhensions, plans et comptes rendus arrivaient truffés de noms de
 * fichiers, de fonctions et de technologies.
 *
 * Écrite UNE fois, posée juste après la langue en tête de chaque accueil
 * (`rolePrompt`) : aucune copie ne diverge. Courte exprès, elle se paie à
 * chaque tour.
 *
 * LA LIMITE : le détail technique ne disparaît pas, il change de destinataire.
 * Code, commentaires, messages d'enregistrement, mémoire, changelog, règles et
 * notes techniques du plan restent techniques : ce sont les agents qui les
 * lisent.
 */
export const CONSIGNE_DE_VULGARISATION =
  "PARLE SIMPLEMENT À L'UTILISATEUR : il est intelligent, mais il ne programme pas et ne connaît pas l'intérieur du projet. " +
  'Tout ce qu\'il lit de toi — réponse, compréhension, plan, compte rendu, questions — dit ce que chaque chose FAIT et À QUOI elle sert, avec des mots courants. ' +
  "Aucun nom de fichier, de fonction, de variable, de commande ni de technologie, sauf s'il le demande ou si c'est indispensable, et alors expliqué en quelques mots. " +
  "Ton d'adulte à adulte, jamais enfantin ni condescendant. " +
  "Réponds brièvement, comme dans un dialogue : jamais de reformulation de sa demande en début de réponse, pas de préambule ni de récapitulatif. " +
  "Exemple : « le relevé des quotas de pickAccount est plafonné à 20 s » devient « le lancement d'une carte n'attend plus des minutes quand un compte ne répond pas ». " +
  "Le détail technique ne se perd pas : il va où les AGENTS le lisent — code, commentaires, messages d'enregistrement, mémoire, changelog, règles, notes techniques du plan.";

/**
 * SITUER UN ÉVÉNEMENT PASSÉ, C'EST COMPARER DEUX DATES. Un agent a écrit « la
 * correction de la semaine dernière » pour une correction du matin, alors que
 * la date du jour et celle de la correction étaient toutes deux dans son
 * contexte. Le démon écrit l'écart à côté des dates qu'il sert (accueil,
 * outil « memoire ») ; cette règle couvre le reste (git, fichiers, messages).
 *
 * STATIQUE, aucune date dedans : elle part dans la consigne système, préfixe du
 * cache, qui ne change pas d'un tour à l'autre.
 */
export const CONSIGNE_DES_DATES =
  "DATES : un événement passé ne se situe JAMAIS dans le temps (« hier », « la semaine dernière », « récemment ») sans avoir comparé sa date à la date du jour ; dans le doute, dis « la correction précédente ».";

/** Le même engagement en une ligne, pour le rappel des tours suivants. */
export const RAPPEL_DE_VULGARISATION =
  "PARLE SIMPLEMENT À L'UTILISATEUR : il ne programme pas ; explique ce que chaque chose fait et à quoi elle sert, sans nom de fichier, de fonction ni de technologie non expliqué, d'adulte à adulte ; réponds bref, sans redire sa demande.";

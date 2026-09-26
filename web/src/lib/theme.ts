import * as React from 'react';
import {
  APPARENCE_PAR_DEFAUT,
  apparenceRetenue,
  causeDeLaBascule,
  couleurDeBandeau,
  estThemeSombre,
  REGLAGE_APPARENCE_PAR_DEFAUT,
  reglageApparenceValide,
  themeAAppliquer,
  themeChoisiDepuisReglage,
  themeValide,
  type CauseDeBascule,
  type EntreeDeTheme,
  type ThemeApplique,
  type ThemeId,
  type ReglageApparence,
} from '@beluga/shared';
import { usePref } from './prefs';
import { useApp } from './use-app';

/**
 * LE REPÈRE LOCAL DE PREMIER AFFICHAGE — jamais la source de vérité.
 *
 * `web/index.html` le lit de façon SYNCHRONE, avant tout module, pour deviner
 * juste au tout premier instant et éviter un flash systématique en sombre. Il
 * est écrit ici, et nulle part ailleurs : la même clé, dupliquée dans
 * `index.html` comme `web/public/sw.js` duplique ses propres tables, faute de
 * pouvoir importer ce fichier depuis un script qui doit rester synchrone.
 */
const CLE_REPERE_PREMIER_AFFICHAGE = 'beluga-theme-flash';

/* ------------------------------------------------------------------ */
/* CHAQUE BASCULE D'APPARENCE DIT D'OÙ ELLE VIENT                     */
/* ------------------------------------------------------------------ */

/**
 * POURQUOI CE JOURNAL EXISTE.
 *
 * « L'interface a changé de thème toute seule » est une phrase impossible à
 * instruire après coup : rien ne dit laquelle des trois entrées — le projet
 * ouvert, le réglage général, le clair / sombre de l'ordinateur — a bougé, ni
 * même si l'une a bougé. On note donc CHAQUE pose de thème qui en remplace un
 * autre, avec sa cause nommée. Le PREMIER affichage, lui, ne se note pas : il
 * ne remplace rien, et le journal se remplirait pour rien à chaque ouverture.
 *
 * Une bascule SANS cause est un défaut, et c'est exactement ce que ce journal
 * sert à rendre visible : la ligne le dit en clair.
 */
export type MotifDeBascule = {
  causes: CauseDeBascule[];
  /**
   * LA TOUTE PREMIÈRE POSE, celle qui suit la réponse du serveur. Elle peut
   * différer de la devinette locale — thème changé depuis un autre appareil,
   * repère écrit par une autre session — sans que rien n'ait « bougé » : ce
   * n'est pas une bascule, c'est la vérité qui arrive.
   */
  premiereReponse?: boolean;
};

export type BasculeDApparence = {
  quand: number;
  avant: string;
  apres: string;
  causes: CauseDeBascule[];
  sansCause: boolean;
};

const JOURNAL_DES_BASCULES: BasculeDApparence[] = [];
/** Assez pour raconter une session, trop peu pour peser sur la mémoire. */
const BASCULES_RETENUES = 20;

function tracerLaBascule(avant: string, apres: string, cause?: MotifDeBascule): void {
  const causes = cause?.causes ?? [];
  const sansCause = !cause?.premiereReponse && causes.length === 0;
  const ligne: BasculeDApparence = { quand: Date.now(), avant, apres, causes, sansCause };
  JOURNAL_DES_BASCULES.push(ligne);
  if (JOURNAL_DES_BASCULES.length > BASCULES_RETENUES) JOURNAL_DES_BASCULES.shift();
  const raison = cause?.premiereReponse
    ? 'première réponse du serveur'
    : causes.length
      ? causes.join(' + ')
      : 'AUCUNE ENTRÉE N’A BOUGÉ — anomalie';
  const dire = sansCause ? console.warn : console.info;
  dire(`[apparence] ${avant} → ${apres} (${raison})`);
}

/** Ce que le journal a retenu, du plus ancien au plus récent. */
export function basculesDApparence(): readonly BasculeDApparence[] {
  return JOURNAL_DES_BASCULES;
}

/**
 * LE THÈME S'APPLIQUE EN UN SEUL ENDROIT.
 *
 * Il était posé dans un effet du bandeau des quotas, à côté de son interrupteur.
 * Avec cinq choix et TROIS sources qui peuvent décider — le projet ouvert, le
 * réglage général, le réglage clair / sombre de l'ordinateur —, deux copies de ce
 * geste finiraient par se contredire.
 *
 * Trois marques sont posées ensemble, et jamais séparément :
 *  - `data-theme` : le nom du thème, qui choisit son bloc de jetons ;
 *  - la classe `dark` : elle dit seulement que le thème est SOMBRE. Plusieurs
 *    contrôles du projet basculent en clair en la retirant, et le thème clair y
 *    est accroché (`html:not(.dark)`, `web/src/styles.css`) — on la garde ;
 *  - `color-scheme` : ce qui décide de l'aspect des ascenseurs et des champs du
 *    système.
 * Et la couleur du bandeau du téléphone suit, sinon la barre d'état reste noire
 * au-dessus d'une application beige.
 *
 * Chaque pose retient aussi le REPÈRE de premier affichage (ci-dessus) : la
 * source de vérité reste le serveur, ce repère ne sert qu'à deviner juste avant
 * qu'elle n'ait répondu.
 */
/**
 * LE THÈME DU PREMIER AFFICHAGE, SANS LE SERVEUR.
 *
 * L'espace client n'a pas accès aux préférences du serveur — un compte client
 * n'a pas le droit de les lire — mais son écran doit s'afficher dans les douze
 * palettes comme le reste. Il part donc du REPÈRE local, et à défaut du
 * clair / sombre du système.
 */
export function themeInitial(): ThemeId {
  try {
    const repere = window.localStorage.getItem(CLE_REPERE_PREMIER_AFFICHAGE);
    if (repere) return themeValide(repere);
  } catch {
    /* stockage local indisponible : on retombe sur le système */
  }
  const sombre = window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false;
  return sombre ? APPARENCE_PAR_DEFAUT : 'clair';
}

export function appliquerLeTheme(theme: ThemeId, cause?: MotifDeBascule): ThemeId {
  const precedent = document.documentElement.dataset.theme;
  if (precedent && precedent !== theme) tracerLaBascule(precedent, theme, cause);
  const sombre = estThemeSombre(theme);
  const racine = document.documentElement;
  racine.dataset.theme = theme;
  racine.classList.toggle('dark', sombre);
  racine.style.colorScheme = sombre ? 'dark' : 'light';
  const bandeau = document.querySelector('meta[name="theme-color"]');
  if (bandeau) bandeau.setAttribute('content', couleurDeBandeau(theme));
  try {
    window.localStorage.setItem(CLE_REPERE_PREMIER_AFFICHAGE, theme);
  } catch {
    /* stockage local indisponible (navigation privée, quota) : le flash reste
       plus long, rien d'autre ne dépend de ce repère */
  }
  return theme;
}

/**
 * LE RÉGLAGE CLAIR / SOMBRE DE L'ORDINATEUR, ÉCOUTÉ SEULEMENT QUAND IL DÉCIDE.
 *
 * Le lire une fois ne suffit pas : sur macOS et Windows, ce réglage bascule tout
 * seul à la tombée du jour. Sans écoute, l'application resterait claire jusqu'au
 * prochain rechargement de la page — et le mode automatique ne tiendrait pas sa
 * promesse. Un navigateur qui ne connaît pas cette question répond « clair », ce
 * qui est le comportement le plus sûr.
 *
 * MAIS L'ABONNEMENT EST CONDITIONNEL. Tant que l'automatique est ÉTEINT, cette
 * valeur n'entre dans aucun calcul : l'écouter quand même ne servirait qu'à
 * réveiller React — et une seule ligne oubliée ailleurs suffirait alors à faire
 * basculer une page immobile à la tombée du jour. On ne s'abonne donc que
 * lorsque le réglage suit vraiment le système, et la valeur reste FIGÉE le
 * reste du temps. Allumer l'automatique relance l'effet, qui resynchronise
 * aussitôt : rien n'est perdu.
 */
export function useSystemeSombre(actif = true): boolean {
  const [sombre, setSombre] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );

  React.useEffect(() => {
    if (!actif) return;
    const question = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!question) return;
    const suivre = (evenement: MediaQueryListEvent) => setSombre(evenement.matches);
    question.addEventListener('change', suivre);
    setSombre(question.matches);
    return () => question.removeEventListener('change', suivre);
  }, [actif]);

  return sombre;
}

/**
 * Le réglage GÉNÉRAL de l'application, et de quoi le changer. Il vit EN BASE
 * comme les autres (`usePref`) : on retrouve son ambiance, son mode manuel et
 * son interrupteur automatique sur le téléphone comme sur l'ordinateur. Les
 * anciennes valeurs (« dark », « light », « systeme » et les sept anciens
 * thèmes) sont reprises par `reglageApparenceValide`.
 *
 * Il ne POSE rien : un projet peut le recouvrir. Seul `useThemeApplique` pose.
 */
export function useThemeGeneral(): [ReglageApparence, (reglage: ReglageApparence) => void] {
  /*
   * PAS DE VALEUR DE REPLI ICI. Un repli rendrait le sombre d'origine
   * indiscernable d'un réglage ABSENT — or les deux n'ont pas le même sens :
   * absent veut dire « le serveur n'a pas encore répondu, ou sa réponse est
   * repartie sans cette clé », et cela ne doit jamais écraser un choix déjà
   * connu. On garde donc le brut tel quel, et `apparenceRetenue` tranche.
   */
  const [brut, ecrire] = usePref<string | undefined>('theme', undefined);
  const dernierConnu = React.useRef<unknown>(undefined);
  const retenu = apparenceRetenue(dernierConnu.current, brut);
  dernierConnu.current = retenu;
  const reglage = reglageApparenceValide(retenu) ?? REGLAGE_APPARENCE_PAR_DEFAUT;
  const regler = React.useCallback(
    (suivant: ReglageApparence) => ecrire(themeChoisiDepuisReglage(suivant)),
    [ecrire],
  );
  return [reglage, regler];
}

/**
 * LES TROIS ENTRÉES DU THÈME, CHACUNE PROTÉGÉE DE SES PROPRES ABSENCES.
 *
 * Le thème du PROJET ouvert ne vaut que si la liste des projets est réellement
 * arrivée. Pendant une reconnexion, le magasin se réhydrate : la liste peut
 * repasser vide un instant, et lire alors « ce projet n'impose rien » ferait
 * rendre la main au réglage général, puis rebasculer. On garde donc la dernière
 * valeur connue tant que la liste n'est pas là — un projet qui n'impose rien
 * pour de vrai, lui, est bien lu comme tel.
 */
function useEntreeDeTheme(): { entree: EntreeDeTheme; applique: ThemeApplique } {
  const state = useApp();
  const [general] = useThemeGeneral();
  const projetOuvert = state.projects.find((projet) => projet.id === state.activeProjectId);
  const listeConnue = state.pret && state.projects.length > 0;
  const dernierDuProjet = React.useRef<unknown>(undefined);
  if (listeConnue) dernierDuProjet.current = projetOuvert?.theme;
  const duProjet = listeConnue ? projetOuvert?.theme : dernierDuProjet.current;

  /*
   * L'écoute du système se décide SUR LE RÉGLAGE, donc avant de connaître la
   * clarté du système : un premier calcul sans elle suffit à savoir si elle a
   * seulement son mot à dire.
   */
  const sansSysteme = themeAAppliquer({ duProjet, general: themeChoisiDepuisReglage(general) });
  const systemeSombre = useSystemeSombre(sansSysteme.ecouteLeSysteme);
  const entree: EntreeDeTheme = {
    duProjet,
    general: themeChoisiDepuisReglage(general),
    systemeSombre: sansSysteme.ecouteLeSysteme ? systemeSombre : undefined,
  };
  return { entree, applique: themeAAppliquer(entree) };
}

/**
 * LE THÈME RÉELLEMENT EN VIGUEUR — et c'est lui qui le POSE sur la page.
 *
 * À appeler UNE SEULE FOIS, depuis la racine de l'application : le projet ouvert
 * décide avant le réglage général, donc changer de projet change l'apparence de
 * TOUTE l'interface — colonne de gauche, tableau, conversation, réglages,
 * fenêtres — et non d'un morceau d'écran.
 *
 * Rendu aussi aux écrans qui expliquent le choix (l'onglet « Apparence » doit
 * pouvoir dire « ce projet impose son thème, c'est lui que vous voyez »), mais
 * l'effet, lui, ne tourne que là où le crochet est appelé.
 */
export function useThemeApplique(): ThemeApplique {
  const state = useApp();
  const { entree, applique } = useEntreeDeTheme();

  /* LES ENTRÉES DE LA DERNIÈRE POSE, pour nommer ce qui a bougé. */
  const posee = React.useRef<EntreeDeTheme | null>(null);

  /*
   * TANT QUE LE SERVEUR N'A PAS RÉPONDU (`state.pret`), `general` ET
   * `projetOuvert` ne sont que des VALEURS PAR DÉFAUT (prefs et projets encore
   * vides) — jamais le vrai choix. Poser ce défaut écraserait la devinette déjà
   * posée par le script de `index.html` (le REPÈRE local de premier affichage)
   * et produirait un second flash inutile : sombre par défaut, puis le vrai
   * thème. On laisse donc le repère en place jusqu'à la vraie réponse.
   */
  React.useEffect(() => {
    if (!state.pret) return;
    const precedentes = posee.current;
    posee.current = entree;
    appliquerLeTheme(
      applique.theme,
      precedentes ? { causes: causeDeLaBascule(precedentes, entree) } : { causes: [], premiereReponse: true },
    );
    // `entree` est recalculée à chaque rendu : c'est le THÈME POSÉ qui décide
    // s'il y a lieu de refaire quoi que ce soit, et la trace ne parle que
    // lorsqu'il change vraiment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applique.theme, state.pret]);

  return applique;
}

/**
 * Le thème en vigueur, SANS le poser : pour un écran qui veut seulement en
 * parler. Poser deux fois n'aurait pas d'effet visible, mais un seul endroit
 * responsable de l'écriture reste la règle.
 */
export function useThemeEnVigueur(): ThemeApplique {
  return useEntreeDeTheme().applique;
}

/*
 * LE JOURNAL DES BASCULES, LISIBLE DEPUIS LA PAGE — en développement seulement.
 *
 * C'est ce que lit `scripts/verif-theme-sans-geste.mjs` pour juger non pas
 * l'écran, mais l'HISTOIRE de l'écran : une apparence qui revient au même thème
 * après un aller-retour ne se voit pas sur une capture, alors qu'elle se lit
 * ici. On juge sur le MODE et non sur `import.meta.env.DEV`, comme le point
 * d'essai du magasin : cet indicateur suit `NODE_ENV`, qui vaut « production »
 * dans l'environnement des agents.
 */
if (import.meta.env.MODE !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { belugaTheme?: unknown }).belugaTheme = {
    journal: () => basculesDApparence().map((ligne) => ({ ...ligne })),
    courant: () => ({
      theme: document.documentElement.dataset.theme,
      sombre: document.documentElement.classList.contains('dark'),
    }),
  };
}

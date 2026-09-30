/**
 * LE SUIVI DES VISITES POSÉ PAR DÉFAUT sur chaque site en production.
 *
 * Tout projet qui déclare l'adresse publique de sa production reçoit d'office
 * son espace de suivi (clé, origine autorisée) ; le démon relit alors la page
 * d'accueil servie et juge le code qu'elle porte. Un code absent, faux ou resté
 * sur l'ancien outil de statistiques fait naître UNE carte de correction dans le
 * projet — visible, à lancer par l'utilisateur, jamais une écriture en cachette.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

export const DIAGNOSTICS_SUIVI = ['ok', 'absent', 'mauvaise-cle', 'ancien-outil', 'injoignable'] as const;
export type DiagnosticSuivi = (typeof DIAGNOSTICS_SUIVI)[number];

/** L'ancien outil de statistiques (Umami auto-hébergé) : à retirer partout. */
const ANCIEN_OUTIL = [/stats\.haikostudio\.cloud\/script\.js/i, /\bdata-website-id\s*=/i];

/** Les balises `<script …>` d'une page, telles qu'écrites. */
function balisesScript(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

function attribut(balise: string, nom: string): string | null {
  const m = balise.match(new RegExp(`\\b${nom}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

/**
 * QUE PORTE CETTE PAGE ? L'ancien outil passe devant tout : même à côté du bon
 * code, il doit partir. Ensuite, le script de Beluga avec la clé de l'espace
 * est juste ; avec une autre clé, il compte les visites ailleurs ; sans lui,
 * rien n'est compté. Google Analytics et les autres outils ne sont pas jugés :
 * ils restent là où ils sont.
 */
export function diagnostiquerSuivi(html: string, cleAttendue: string, racineBeluga: string): DiagnosticSuivi {
  const balises = balisesScript(html);
  if (balises.some((b) => ANCIEN_OUTIL.some((motif) => motif.test(b)))) return 'ancien-outil';
  const racine = racineBeluga.replace(/\/+$/, '').toLowerCase();
  const nos = balises.filter((b) => (attribut(b, 'src') ?? '').toLowerCase().startsWith(`${racine}/m/s.js`));
  if (!nos.length) return 'absent';
  return nos.some((b) => attribut(b, 'data-cle') === cleAttendue) ? 'ok' : 'mauvaise-cle';
}

/** Ce que le diagnostic dit à l'écran, en mots courants. */
export const LIBELLE_DIAGNOSTIC_SUIVI: Record<DiagnosticSuivi, string> = {
  ok: 'Suivi en place',
  absent: 'Code de suivi absent',
  'mauvaise-cle': 'Mauvais code de suivi',
  'ancien-outil': 'Ancien outil de statistiques',
  injoignable: 'Site injoignable',
};

/**
 * L'ÉTAT DU SUIVI SUIT CE QUE PORTE LE SITE, PAS LA CARTE. Poser la carte
 * d'installation ne pose rien : le projet se disait « posé » dès la création de
 * la carte, alors que son site ne portait aucun code (Haiko Studio, HaikoDev,
 * 27/09/2026). Le code lu sur la page fait passer à « posé » ; un code absent,
 * faux ou remplacé par l'ancien outil ramène un « posé » à « absent ». Une
 * mesure déjà confirmée par une visite (« vérifié ») n'est jamais rétrogradée
 * ici, et un site injoignable ne change rien.
 */
export function etatSuiviApresDiagnostic<E extends 'absent' | 'pose' | 'verifie'>(etat: E, diagnostic: DiagnosticSuivi): 'absent' | 'pose' | 'verifie' {
  if (etat === 'verifie') return etat;
  if (diagnostic === 'ok') return 'pose';
  if (diagnosticACorriger(diagnostic)) return 'absent';
  return etat;
}

/** Un diagnostic qui demande une carte de correction. Un site injoignable se relira plus tard. */
export function diagnosticACorriger(d: DiagnosticSuivi | null | undefined): boolean {
  return d === 'absent' || d === 'mauvaise-cle' || d === 'ancien-outil';
}

/**
 * L'ADRESSE DE PRODUCTION D'UN PROJET, JAMAIS DEVINÉE. Dans l'ordre : celle
 * saisie dans ses réglages, celle déjà déclarée à l'atelier marketing, puis le
 * site de la surveillance que l'utilisateur a rattaché À LA MAIN à ce projet
 * (un rattachement deviné ne compte pas). L'adresse de la VITRINE liée n'en est
 * pas une : c'est un autre site, qui a son propre projet. Beluga lui-même porte
 * déjà son suivi : il n'en reçoit pas.
 */
export function adresseDeProductionDuProjet(
  projet: { adresseProduction?: string; adresseProductionRattrapee?: boolean; isSelf?: boolean; archived?: boolean },
  adresseDeLEspace?: string | null,
  sitesRattachesALaMain: readonly string[] = [],
): string | null {
  if (projet.isSelf || projet.archived) return null;
  const surveille = sitesRattachesALaMain.map((url) => {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  });
  /* Une adresse RATTRAPÉE (remplie sans l'utilisateur) n'ouvre aucun suivi :
     seule une adresse saisie, changée ou écrite par l'agent le fait. */
  const declaree = projet.adresseProductionRattrapee ? undefined : projet.adresseProduction;
  const candidates = [declaree, adresseDeLEspace, ...surveille];
  return candidates.map((a) => a?.trim() ?? '').find((a) => a.length > 0) || null;
}

/** Ce que la carte de correction demande de faire, selon ce que la page porte aujourd'hui. */
export function consigneDeCorrection(diagnostic: DiagnosticSuivi): string {
  const commun =
    'Garder Google Analytics (gtag) et tout autre outil déjà en place : on ajoute le suivi de Beluga, on ne retire que l’ancien outil de statistiques.';
  switch (diagnostic) {
    case 'ancien-outil':
      return [
        'La page en production porte encore l’ANCIEN outil de statistiques (script « stats.haikostudio.cloud/script.js », attribut « data-website-id ») : le retirer partout, avec ses appels et sa configuration (fonctions d’événements, adresse de l’outil dans l’administration), puis poser le script de Beluga ci-dessous s’il manque.',
        commun,
      ].join('\n');
    case 'mauvaise-cle':
      return ['La page porte le script de Beluga avec une AUTRE clé : remplacer la clé par celle ci-dessous.', commun].join('\n');
    default:
      return ['La page en production ne porte aucun script de suivi de Beluga : le poser dans le <head> de chaque page.', commun].join('\n');
  }
}

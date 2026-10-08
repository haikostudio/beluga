/**
 * LE CONTRÔLE WORDPRESS D'UNE SURVEILLANCE — l'état INTERNE d'un site, en plus
 * de « répond-il ? ».
 *
 * Une surveillance de site WordPress peut porter, à côté de sa recette, une
 * CONFIGURATION WORDPRESS : la fiche SSH du coffre-fort, le dossier du site,
 * l'outil en ligne de commande de WordPress et les journaux à lire. L'agent de
 * surveillance la pose UNE fois (c'est le seul moment d'IA) ; ensuite tout
 * tourne seul, sans agent et sans dépense :
 *
 *  - les JOURNAUX sont relus toutes les `PERIODE_JOURNAUX_WP_MS`, seulement les
 *    octets nouveaux depuis le dernier passage (un journal de 44 Mo ne se relit
 *    jamais en entier) ;
 *  - les EXTENSIONS, thèmes et le cœur de WordPress toutes les
 *    `PERIODE_EXTENSIONS_WP_MS` ;
 *  - la base de FAILLES de Wordfence est téléchargée une fois par jour pour
 *    TOUS les sites, puis croisée ici, sans rien envoyer de nos sites ;
 *  - les journaux PROPRES À WORDPRESS sont ALLÉGÉS une fois par jour : seuls
 *    les `JOURS_GARDES_JOURNAL` derniers jours restent. C'est la SEULE écriture
 *    du contrôle sur le serveur du site.
 *
 * DEUX NIVEAUX, ET SEULEMENT DEUX :
 *  - une ERREUR FATALE dans les journaux est une PANNE (raison « journaux ») :
 *    point rouge, courriel de panne et enquête après trois passages ratés
 *    d'affilée, comme une page qui ne répond plus ;
 *  - tout le reste est un SOUCI qui met le site « à surveiller » (pastille
 *    jaune), sans enquête. Les soucis IMPORTANTS (`GENRES_IMPORTANTS`) font
 *    partir un courriel à leur APPARITION, une seule fois.
 *
 * AUCUNE COMMANDE LIBRE : les scripts envoyés au serveur sont écrits ICI, à
 * partir de chemins validés (`cheminSur`). La configuration ne porte aucun
 * secret — l'accès est relu au coffre-fort à chaque passage.
 *
 * Le serveur (`server/src/surveillance-wordpress.ts`) se connecte, range et
 * écrit ; l'écran (`web/src/components/surveillance.tsx`) affiche.
 */

import { blocDAdresse, boutonsDeSurveillance, lienDeLaSurveillance, piedDeSurveillance } from './alerte-courriel-site.js';
import {
  COULEURS,
  TEINTES,
  blocAIcone,
  courrielEnBlocs,
  echapper,
  lienDiscret,
  lienEnClair,
  pastille,
  texteEnHtml,
} from './gabarit-courriel.js';

/** Les journaux sont relus tous les quarts d'heure. */
export const PERIODE_JOURNAUX_WP_MS = 15 * 60_000;
/** Les extensions, une fois par heure : l'outil de WordPress est lent et charge le serveur. */
export const PERIODE_EXTENSIONS_WP_MS = 60 * 60_000;
/** La base de failles et le catalogue de WordPress, une fois par jour. */
export const PERIODE_FAILLES_MS = 24 * 3_600_000;
/** L'allègement des journaux, une fois par jour. */
export const PERIODE_NETTOYAGE_JOURNAUX_MS = 24 * 3_600_000;
/** Ce que l'allègement garde d'un journal : ses dix derniers jours. */
export const JOURS_GARDES_JOURNAL = 10;
/** Le suivi des soucis : trente jours, puis effacé au fil de l'eau. */
export const SUIVI_WORDPRESS_MS = 30 * 24 * 3_600_000;
/** Une extension que son auteur n'a pas touchée depuis deux ans est dite abandonnée. */
export const ABANDON_MS = 2 * 365 * 24 * 3_600_000;
/** Ce qu'un passage lit au plus dans UN journal. Le reste attend le passage suivant. */
export const LECTURE_JOURNAL_MAX = 50_000_000;
/** Au plus autant de journaux par site. */
export const JOURNAUX_MAX = 8;
/** Au plus autant d'extensions attendues. */
export const EXTENSIONS_ATTENDUES_MAX = 300;
/** Le temps laissé à un passage sur le serveur du site. */
export const DELAI_WORDPRESS_MS = 90_000;
/** Combien d'exemples d'erreur fatale un passage rapporte. */
export const EXEMPLES_FATALES_MAX = 3;

/**
 * LE PIC D'AVERTISSEMENTS. Certains sites écrivent des milliers d'avis PHP en
 * temps normal (InVia : ~30 000 « Deprecated » et ~18 000 « Notice » dans son
 * journal) : alerter sur ces lignes enverrait un courriel par passage. Seuls les
 * « Warning » comptent, et seulement quand un passage en voit BEAUCOUP plus que
 * d'habitude — au moins `PIC_PLANCHER`, et `PIC_FACTEUR` fois la moyenne.
 */
export const PIC_PLANCHER = 50;
export const PIC_FACTEUR = 5;
/** Le poids d'un passage dans la moyenne glissante des avertissements. */
export const POIDS_MOYENNE = 0.2;

/* ------------------------------------------------------------------ */
/* La configuration                                                     */
/* ------------------------------------------------------------------ */

/** Ce que l'agent pose une fois : aucun secret, seulement la référence de la fiche SSH. */
export interface ConfigWordpress {
  /** La fiche SSH du coffre-fort (hote, port, utilisateur, et cle ou motDePasse). */
  acces: { id: string };
  /** Le dossier de WordPress sur le serveur (« ~/sites/exemple.ch »). */
  racine: string;
  /** L'outil en ligne de commande de WordPress (« wp », « /opt/php8.4/bin/wp-cli »). */
  wpCli: string;
  /** Les journaux lus, relatifs au dossier du site ou commençant par « ~/ » ou « / ». */
  journaux: string[];
  /** Les extensions actives à la mise en place : une qui se désactive ou disparaît est un souci. */
  extensionsAttendues: string[];
  /**
   * LA COPIE DE TEST du site, sur ce serveur : c'est là que les agents
   * corrigent, le site surveillé restant en lecture seule hors mise en
   * production (`garde-production.ts`, MEM-4501). Facultative.
   */
  copieDeTest?: CopieDeTest;
}

/** Où se trouve la copie de test d'un site, sur ce serveur. */
export interface CopieDeTest {
  /** Le dossier de WordPress de la copie (« /var/www/invia »). */
  racine: string;
  /** L'outil en ligne de commande de WordPress sur ce serveur (« wp »). */
  wpCli: string;
  /** L'adresse de la copie (« https://invia.haikostudio.cloud »). */
  url?: string;
}

/** La copie de test lue dans une configuration : abîmée, elle n'existe pas. */
export function jugerCopieDeTest(brut: unknown): CopieDeTest | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const c = brut as Record<string, unknown>;
  const racine = String(c.racine ?? '').trim().replace(/\/+$/, '');
  const wpCli = String(c.wpCli ?? '').trim() || 'wp';
  if (!cheminSur(racine) || !cheminSur(wpCli)) return undefined;
  const url = String(c.url ?? '').trim();
  return { racine, wpCli, ...(/^https?:\/\/[^\s]+$/.test(url) ? { url } : {}) };
}

/** La phrase qui dit où corriger à la place du vrai site. */
export function phraseDeLaCopieDeTest(copie: Partial<CopieDeTest> | undefined, projet?: string): string {
  const registre = `puis ajoute une entrée au registre « production/a-rejouer/ » du dépôt${projet ? ` ${projet}` : ' du projet'} (la commande exacte à rejouer en ligne) : c'est ce registre que la mise en production rejoue.`;
  const reperes = [
    copie?.racine ? `dossier ${copie.racine}, « ${copie.wpCli || 'wp'} --path=${copie.racine} … »` : '',
    copie?.url ?? '',
  ].filter(Boolean);
  return `Fais le changement sur la COPIE DE TEST${reperes.length ? ` (${reperes.join(', ')})` : ' du projet'}, ${registre}`;
}

/** Un chemin dit sans guillemet ni caractère de commande : il entre tel quel dans un script. */
const CHEMIN_SUR = /^[A-Za-z0-9_.\/~@+-]+$/;
const SLUG = /^[A-Za-z0-9_.@-]{1,200}$/;

/** Un chemin qu'on peut poser dans un script sans rien risquer. */
export function cheminSur(chemin: string): boolean {
  if (!chemin || chemin.length > 300 || !CHEMIN_SUR.test(chemin)) return false;
  if (chemin.split('/').includes('..')) return false;
  // « ~ » seulement en tête : « ~/… » ou « ~ » seul.
  return !chemin.slice(1).includes('~') && (chemin[0] !== '~' || chemin === '~' || chemin.startsWith('~/'));
}

/**
 * LE CHEMIN, ÉCRIT POUR LE SHELL DISTANT. Entre apostrophes — rien ne s'y
 * interprète —, sauf le « ~ » de tête, rendu par « $HOME » qui, lui, se déplie.
 */
export function cheminShell(chemin: string): string {
  if (chemin === '~') return '"$HOME"';
  if (chemin.startsWith('~/')) return `"$HOME"/'${chemin.slice(2)}'`;
  return `'${chemin}'`;
}

export type JugementConfigWordpress = { ok: true; config: ConfigWordpress } | { ok: false; raison: string };

/** UNE CONFIGURATION MAL FORMÉE EST REFUSÉE EN TOUTES LETTRES, jamais gardée pour échouer au passage suivant. */
export function jugerConfigWordpress(brut: unknown): JugementConfigWordpress {
  const c = (brut ?? {}) as Record<string, unknown>;
  const acces = (c.acces ?? {}) as Record<string, unknown>;
  const id = String(acces.id ?? '').trim();
  if (!id) return { ok: false, raison: 'il faut la fiche SSH du coffre-fort (« acces »: { id })' };
  const racine = String(c.racine ?? '').trim().replace(/\/+$/, '');
  if (!cheminSur(racine)) return { ok: false, raison: `dossier de WordPress illisible : « ${racine} »` };
  const wpCli = String(c.wpCli ?? '').trim();
  if (!cheminSur(wpCli)) return { ok: false, raison: `outil de WordPress illisible : « ${wpCli} »` };
  const journaux = Array.isArray(c.journaux) ? c.journaux.map((j) => String(j ?? '').trim()).filter(Boolean) : [];
  if (journaux.length > JOURNAUX_MAX) return { ok: false, raison: `pas plus de ${JOURNAUX_MAX} journaux` };
  for (const journal of journaux)
    if (!cheminSur(journal)) return { ok: false, raison: `journal illisible : « ${journal} »` };
  const attendues = Array.isArray(c.extensionsAttendues)
    ? [...new Set(c.extensionsAttendues.map((e) => String(e ?? '').trim()).filter(Boolean))]
    : [];
  if (attendues.length > EXTENSIONS_ATTENDUES_MAX)
    return { ok: false, raison: `pas plus de ${EXTENSIONS_ATTENDUES_MAX} extensions attendues` };
  for (const slug of attendues) if (!SLUG.test(slug)) return { ok: false, raison: `extension illisible : « ${slug} »` };
  const copieDeTest = jugerCopieDeTest(c.copieDeTest);
  return {
    ok: true,
    config: { acces: { id }, racine, wpCli, journaux: [...new Set(journaux)], extensionsAttendues: attendues, ...(copieDeTest ? { copieDeTest } : {}) },
  };
}

/** La configuration lue en base : abîmée, elle n'existe pas — la surveillance de base continue. */
export function configWordpressDeLigne(json: string | null | undefined): ConfigWordpress | undefined {
  if (!json) return undefined;
  try {
    const avis = jugerConfigWordpress(JSON.parse(json));
    return avis.ok ? avis.config : undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Les scripts envoyés au serveur                                       */
/* ------------------------------------------------------------------ */

/**
 * `--skip-plugins --skip-themes` : l'outil de WordPress ne charge ni les
 * extensions ni le thème. Sans eux, les avis PHP des extensions s'écrivaient
 * AU MILIEU de la liste (constaté sur InVia) et la rendaient illisible.
 */
const SANS_EXTENSIONS = '--skip-plugins --skip-themes';

/** Le script du relevé des extensions, des thèmes et du cœur. Une seule connexion. */
export function scriptExtensions(config: Pick<ConfigWordpress, 'racine' | 'wpCli'>): string {
  const wp = cheminShell(config.wpCli);
  const champs = '--fields=name,status,update,version,update_version --format=json';
  return [
    `cd ${cheminShell(config.racine)} 2>/dev/null || { echo "@@ERR racine"; exit 0; }`,
    `echo "@@PLUGINS"; ${wp} plugin list ${champs} ${SANS_EXTENSIONS} 2>/dev/null`,
    `echo; echo "@@THEMES"; ${wp} theme list ${champs} ${SANS_EXTENSIONS} 2>/dev/null`,
    `echo; echo "@@CORE"; ${wp} core version ${SANS_EXTENSIONS} 2>/dev/null`,
    `echo; echo "@@COREMAJ"; ${wp} core check-update --format=json ${SANS_EXTENSIONS} 2>/dev/null`,
    'echo; echo "@@FIN"',
  ].join('\n');
}

/**
 * LE SCRIPT DE LECTURE DES JOURNAUX. Pour chaque journal : sa taille, puis les
 * octets NOUVEAUX depuis la position donnée, comptés SUR LE SERVEUR (seuls les
 * totaux et quelques exemples voyagent). Une position négative veut dire « juste
 * la taille » : c'est le premier passage, qui part de la FIN du fichier — une
 * erreur ancienne déjà écrite ne fait pas tomber le site à la mise en place.
 * Un journal plus court que la position a été vidé ou tourné : on repart de zéro.
 */
export function scriptJournaux(config: Pick<ConfigWordpress, 'racine' | 'journaux'>, positions: readonly number[]): string {
  const awk =
    "awk 'BEGIN{f=0;w=0;n=0;d=0} /PHP (Fatal|Parse) error/{f++; if (f<=" +
    EXEMPLES_FATALES_MAX +
    ') print "@@F " substr($0,1,400)} /PHP Warning/{w++} /PHP Notice/{n++} /PHP Deprecated/{d++} END{print "@@C " f " " w " " n " " d}\'';
  const lignes = [`cd ${cheminShell(config.racine)} 2>/dev/null || { echo "@@ERR racine"; exit 0; }`];
  config.journaux.forEach((journal, i) => {
    const o = Math.floor(positions[i] ?? -1);
    lignes.push(
      `f=${cheminShell(journal)}; o=${o}`,
      'if [ -f "$f" ] && [ -r "$f" ]; then',
      '  s=$(wc -c < "$f" | tr -d " ")',
      '  if [ "$o" -gt "$s" ]; then o=0; fi',
      `  echo "@@J ${i} $s $o"`,
      `  if [ "$o" -ge 0 ] && [ "$s" -gt "$o" ]; then tail -c +$((o+1)) "$f" | head -c ${LECTURE_JOURNAL_MAX} | ${awk}; fi`,
      'else',
      `  echo "@@J ${i} absent"`,
      'fi',
    );
  });
  lignes.push('echo "@@FIN"');
  return lignes.join('\n');
}

/**
 * LE SCRIPT D'ALLÈGEMENT DES JOURNAUX — la seule ÉCRITURE du contrôle sur le
 * serveur du site. Il ne vise QUE les journaux relatifs au dossier de WordPress
 * (« wp-content/debug.log ») : ceux de l'hébergeur (« ~/… », « /… ») ne sont
 * jamais touchés.
 *
 * Chaque entrée de WordPress s'ouvre sur « [06-Oct-2026 08:12:33 UTC] » ; une
 * ligne sans date (la suite d'une trace) appartient à l'entrée qui la précède.
 * awk cherche l'OCTET de la première entrée datée du `seuil` (AAAAMMJJ) ou après,
 * et tout ce qui le précède part. Un journal sans aucune entrée datée ne perd
 * rien ; un journal dont toutes les entrées sont plus vieilles est vidé.
 *
 * `cat tmp > f`, jamais `mv` : le fichier garde son inode, son propriétaire et
 * ses droits, et PHP, qui écrit en ajout, continue d'y écrire. Les lignes écrites
 * pendant les quelques millisecondes de la copie se perdent : c'est accepté.
 *
 * Sortie : « @@N <rang> <avant> <après> <coupé> » pour un journal allégé,
 * « @@N <rang> garde <taille> » pour un journal qui n'avait rien de trop vieux,
 * « @@N <rang> echec » pour une écriture impossible, puis « @@FIN ».
 */
export function scriptNettoyageJournaux(config: Pick<ConfigWordpress, 'racine' | 'journaux'>, seuil: string): string {
  if (!/^\d{8}$/.test(seuil)) throw new Error(`seuil de date invalide : ${seuil}`);
  const awk =
    "LC_ALL=C awk -v seuil=" +
    seuil +
    " 'BEGIN{o=0; vieux=0; trouve=0} /^\\[[0-9][0-9]-[A-Z][a-z][a-z]-[0-9][0-9][0-9][0-9] / {" +
    ' m=index("JanFebMarAprMayJunJulAugSepOctNovDec", substr($0,5,3)); if (m>0) {' +
    ' d=substr($0,9,4) sprintf("%02d",(m+2)/3) substr($0,2,2); if (d>=seuil) {trouve=1; print o; exit} vieux=1 } }' +
    " {o+=length($0)+1} END{if (vieux && !trouve) print o}'";
  const lignes = [`cd ${cheminShell(config.racine)} 2>/dev/null || { echo "@@ERR racine"; exit 0; }`];
  config.journaux.forEach((journal, i) => {
    if (!journalDeWordpress(journal)) return;
    lignes.push(
      `f=${cheminShell(journal)}`,
      'if [ -f "$f" ] && [ -r "$f" ] && [ -w "$f" ]; then',
      '  s=$(wc -c < "$f" | tr -d " ")',
      `  n=$(${awk} "$f")`,
      '  if [ -n "$n" ] && [ "$n" -gt 0 ]; then',
      '    t="$f.beluga-tmp"',
      '    if tail -c +$((n+1)) "$f" > "$t" && cat "$t" > "$f"; then',
      `      echo "@@N ${i} $s $(wc -c < "$f" | tr -d " ") $n"`,
      '    else',
      `      echo "@@N ${i} echec"`,
      '    fi',
      '    rm -f "$t"',
      '  else',
      `    echo "@@N ${i} garde $s"`,
      '  fi',
      'fi',
    );
  });
  lignes.push('echo "@@FIN"');
  return lignes.join('\n');
}

/** Un journal propre à WordPress : relatif à son dossier, jamais « ~/… » ni « /… » (ceux de l'hébergeur). */
export function journalDeWordpress(chemin: string): boolean {
  return cheminSur(chemin) && !chemin.startsWith('~') && !chemin.startsWith('/');
}

/** Le seuil de l'allègement : le jour, en temps universel, `JOURS_GARDES_JOURNAL` jours avant `maintenant`. */
export function seuilDuNettoyage(maintenant: number): string {
  return new Date(maintenant - JOURS_GARDES_JOURNAL * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * LE SCRIPT DE DÉCOUVERTE, joué par l'essai de l'agent quand la configuration
 * est incomplète : où est WordPress, où est son outil, quels journaux existent.
 * Lecture seule, rien n'est écrit sur le serveur.
 */
export function scriptDecouverte(): string {
  return [
    'echo "@@HOME $HOME"',
    'for d in "$HOME"/sites/* "$HOME"/www "$HOME"/www/* "$HOME"/public_html "$HOME"/web "$HOME"/htdocs "$HOME"/*; do',
    '  if [ -f "$d/wp-config.php" ]; then echo "@@RACINE $d"; [ -f "$d/wp-content/debug.log" ] && echo "@@DEBUG $d"; fi',
    'done',
    'command -v wp >/dev/null 2>&1 && echo "@@WPCLI $(command -v wp)"',
    'for w in /opt/php*/bin/wp-cli /usr/local/bin/wp "$HOME"/bin/wp "$HOME"/wp-cli.phar; do [ -x "$w" ] && echo "@@WPCLI $w"; done',
    'for f in "$HOME"/ik-logs/php-fpm.log "$HOME"/ik-logs/error.log "$HOME"/logs/error.log "$HOME"/logs/php_errors.log "$HOME"/logs/php-error.log; do [ -f "$f" ] && echo "@@JOURNAL $f"; done',
    'echo "@@FIN"',
  ].join('\n');
}

/** Un chemin du serveur, rendu relatif au dossier personnel quand il y est. */
function relatifAuDossierPersonnel(chemin: string, home: string): string {
  return home && chemin.startsWith(`${home}/`) ? `~/${chemin.slice(home.length + 1)}` : chemin;
}

/** Un numéro de version lu dans un chemin (« /opt/php8.4/bin/wp-cli » → [8, 4]). */
function versionDuChemin(chemin: string): number[] {
  const m = /php(\d+(?:\.\d+)*)/.exec(chemin);
  return m ? m[1].split('.').map(Number) : [];
}

export interface Decouverte {
  racines: string[];
  wpCli?: string;
  journaux: string[];
  /** La racine retenue : celle qui porte le domaine du site, ou la seule trouvée. */
  racine?: string;
}

/**
 * CE QUE LA DÉCOUVERTE A TROUVÉ, et ce qu'elle en retient. Plusieurs sites sur
 * le même hébergement : celui dont le dossier porte le domaine. L'outil de
 * WordPress : « wp » s'il existe, sinon la version de PHP la plus récente.
 */
export function lireDecouverte(sortie: string, domaine: string): Decouverte {
  const lignes = sortie.split('\n').map((l) => l.trim());
  const valeurs = (marque: string) => lignes.filter((l) => l.startsWith(`${marque} `)).map((l) => l.slice(marque.length + 1).trim());
  const home = valeurs('@@HOME')[0] ?? '';
  const racinesBrutes = [...new Set(valeurs('@@RACINE'))];
  const debug = new Set(valeurs('@@DEBUG'));
  const hote = domaine.toLowerCase().replace(/^www\./, '');
  const racineBrute =
    racinesBrutes.find((r) => r.toLowerCase().split('/').pop() === hote) ??
    racinesBrutes.find((r) => r.toLowerCase().includes(hote)) ??
    (racinesBrutes.length === 1 ? racinesBrutes[0] : undefined);
  const outils = [...new Set(valeurs('@@WPCLI'))];
  const wpCli =
    outils.find((o) => o.endsWith('/wp') && !o.includes('/opt/php')) ??
    [...outils].sort((a, b) => {
      const va = versionDuChemin(a);
      const vb = versionDuChemin(b);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
      return 0;
    })[0];
  const journaux = [
    ...(racineBrute && debug.has(racineBrute) ? ['wp-content/debug.log'] : []),
    ...valeurs('@@JOURNAL').map((j) => relatifAuDossierPersonnel(j, home)),
  ];
  return {
    racines: racinesBrutes.map((r) => relatifAuDossierPersonnel(r, home)),
    racine: racineBrute ? relatifAuDossierPersonnel(racineBrute, home) : undefined,
    wpCli: wpCli ? relatifAuDossierPersonnel(wpCli, home) : undefined,
    journaux: [...new Set(journaux)].slice(0, JOURNAUX_MAX),
  };
}

/* ------------------------------------------------------------------ */
/* Lire ce que le serveur a rendu                                       */
/* ------------------------------------------------------------------ */

/** Une extension ou un thème, tel que l'outil de WordPress le décrit. */
export interface ElementWordpress {
  slug: string;
  statut: string;
  version: string;
  /** La version proposée, quand une mise à jour attend. */
  miseAJour?: string;
}

export interface InventaireWordpress {
  extensions: ElementWordpress[];
  themes: ElementWordpress[];
  core: { version: string; miseAJour?: string };
}

/** Une section entre deux marques « @@… ». */
function section(sortie: string, marque: string): string {
  const debut = sortie.indexOf(`@@${marque}`);
  if (debut < 0) return '';
  const reste = sortie.slice(debut + marque.length + 2);
  const fin = reste.search(/^@@[A-Z]+/m);
  return fin < 0 ? reste : reste.slice(0, fin);
}

/**
 * LE JSON D'UNE SECTION, MÊME ENTOURÉ DE BRUIT. Un avis PHP peut s'imprimer
 * avant ou après la liste malgré `--skip-plugins` : on essaie chaque ligne qui
 * commence par « [ » ou « { », puis le plus grand morceau entre crochets.
 */
export function extraireJson(texte: string): unknown {
  for (const ligne of texte.split('\n')) {
    const l = ligne.trim();
    if (!l.startsWith('[') && !l.startsWith('{')) continue;
    try {
      return JSON.parse(l);
    } catch {
      /* ligne suivante */
    }
  }
  const debut = texte.indexOf('[');
  const fin = texte.lastIndexOf(']');
  if (debut >= 0 && fin > debut) {
    try {
      return JSON.parse(texte.slice(debut, fin + 1));
    } catch {
      /* rien de lisible */
    }
  }
  return undefined;
}

function elements(brut: unknown): ElementWordpress[] | undefined {
  if (!Array.isArray(brut)) return undefined;
  return brut
    .map((e) => (e ?? {}) as Record<string, unknown>)
    .filter((e) => typeof e.name === 'string' && e.name)
    .map((e) => ({
      slug: String(e.name),
      statut: String(e.status ?? ''),
      version: String(e.version ?? ''),
      ...(e.update === 'available' && e.update_version ? { miseAJour: String(e.update_version) } : {}),
    }));
}

export type LectureInventaire = { ok: true; inventaire: InventaireWordpress } | { ok: false; erreur: string };

/** La sortie du relevé des extensions, rendue en inventaire — ou l'erreur dite en clair. */
export function lireInventaire(sortie: string): LectureInventaire {
  if (sortie.includes('@@ERR racine')) return { ok: false, erreur: 'le dossier de WordPress est introuvable sur le serveur' };
  const extensions = elements(extraireJson(section(sortie, 'PLUGINS')));
  if (!extensions) return { ok: false, erreur: 'l’outil de WordPress n’a pas rendu la liste des extensions' };
  const themes = elements(extraireJson(section(sortie, 'THEMES'))) ?? [];
  const version = (section(sortie, 'CORE').split('\n').map((l) => l.trim()).find((l) => /^\d+(\.\d+)+/.test(l)) ?? '').trim();
  const majs = extraireJson(section(sortie, 'COREMAJ'));
  const cibles = Array.isArray(majs)
    ? majs.map((m) => String((m as Record<string, unknown>)?.version ?? '')).filter(Boolean)
    : [];
  const miseAJour = cibles.sort((a, b) => comparerVersions(b, a))[0];
  return { ok: true, inventaire: { extensions, themes, core: { version, ...(miseAJour ? { miseAJour } : {}) } } };
}

export interface LectureJournal {
  chemin: string;
  absent: boolean;
  taille: number;
  /** La position à reprendre au passage suivant. */
  position: number;
}

export interface LectureJournaux {
  journaux: LectureJournal[];
  fatales: number;
  avertissements: number;
  notices: number;
  deprecies: number;
  /** Les premières erreurs fatales, telles qu'écrites. */
  exemples: string[];
  /** Vrai quand au moins un journal a été LU (et pas seulement mesuré). */
  lu: boolean;
}

/**
 * LA SORTIE DE LA LECTURE DES JOURNAUX. Chaque « @@J » ouvre un journal ; ses
 * « @@C » et « @@F » le suivent. La position suivante avance de ce qui a été
 * lu, plafonné à `LECTURE_JOURNAL_MAX` : un journal qui a énormément grossi se
 * rattrape sur plusieurs passages au lieu de tout relire d'un coup.
 */
export function lireJournaux(sortie: string, config: Pick<ConfigWordpress, 'journaux'>): LectureJournaux | null {
  if (sortie.includes('@@ERR racine') || !sortie.includes('@@FIN')) return null;
  const lecture: LectureJournaux = { journaux: [], fatales: 0, avertissements: 0, notices: 0, deprecies: 0, exemples: [], lu: false };
  for (const ligne of sortie.split('\n')) {
    const l = ligne.trimEnd();
    if (l.startsWith('@@J ')) {
      const [, rang, taille, depart] = l.split(' ');
      const chemin = config.journaux[Number(rang)] ?? '';
      if (taille === 'absent') {
        lecture.journaux.push({ chemin, absent: true, taille: 0, position: 0 });
        continue;
      }
      const s = Number(taille) || 0;
      const o = Number(depart);
      const position = o < 0 ? s : Math.min(s, o + LECTURE_JOURNAL_MAX);
      if (o >= 0 && s > o) lecture.lu = true;
      lecture.journaux.push({ chemin, absent: false, taille: s, position });
    } else if (l.startsWith('@@C ')) {
      const [f, w, n, d] = l.slice(4).split(' ').map((v) => Number(v) || 0);
      lecture.fatales += f;
      lecture.avertissements += w;
      lecture.notices += n;
      lecture.deprecies += d;
    } else if (l.startsWith('@@F ') && lecture.exemples.length < EXEMPLES_FATALES_MAX) {
      lecture.exemples.push(l.slice(4).trim());
    }
  }
  return lecture;
}

/** Un journal allégé : sa taille avant, après, et les octets retirés en tête. */
export interface JournalNettoye {
  chemin: string;
  avant: number;
  apres: number;
  coupe: number;
}

export interface LectureNettoyage {
  nettoyes: JournalNettoye[];
  /** Les journaux qu'on n'a pas pu réécrire. */
  echecs: string[];
}

/** LA SORTIE DE L'ALLÈGEMENT. Rien de lisible (dossier introuvable, sortie coupée) : null. */
export function lireNettoyage(sortie: string, config: Pick<ConfigWordpress, 'journaux'>): LectureNettoyage | null {
  if (sortie.includes('@@ERR racine') || !sortie.includes('@@FIN')) return null;
  const lecture: LectureNettoyage = { nettoyes: [], echecs: [] };
  for (const ligne of sortie.split('\n')) {
    const l = ligne.trimEnd();
    if (!l.startsWith('@@N ')) continue;
    const [, rang, avant, apres, coupe] = l.split(' ');
    const chemin = config.journaux[Number(rang)];
    if (!chemin) continue;
    if (avant === 'echec') lecture.echecs.push(chemin);
    else if (avant !== 'garde' && Number(coupe) > 0)
      lecture.nettoyes.push({ chemin, avant: Number(avant) || 0, apres: Number(apres) || 0, coupe: Number(coupe) });
  }
  return lecture;
}

/**
 * LA POSITION DE LECTURE APRÈS UN ALLÈGEMENT. Les octets retirés en tête
 * décalent tout le fichier : la position recule d'autant, sans jamais passer
 * sous zéro. Sans ce recalage, la lecture suivante verrait une position plus
 * loin que la fin, repartirait de zéro et recompterait dix jours d'erreurs
 * fatales déjà vues — une fausse panne. Une position négative (journal encore
 * jamais lu) reste telle quelle.
 */
export function positionApresNettoyage(position: number | undefined, coupe: number): number | undefined {
  if (position === undefined || position < 0) return position;
  return Math.max(0, position - coupe);
}

/* ------------------------------------------------------------------ */
/* Les versions et les failles                                          */
/* ------------------------------------------------------------------ */

/** Compare deux versions à la manière de WordPress : « 6.10 » vient après « 6.9 ». */
export function comparerVersions(a: string, b: string): number {
  const pa = String(a).split(/[.\-+_]/);
  const pb = String(b).split(/[.\-+_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Une plage de versions touchées, telle que Wordfence la donne. « * » : sans borne. */
export interface PlageTouchee {
  de: string;
  deInclus: boolean;
  a: string;
  aInclus: boolean;
}

export function versionDansPlage(version: string, plage: PlageTouchee): boolean {
  if (!version) return false;
  if (plage.de && plage.de !== '*') {
    const c = comparerVersions(version, plage.de);
    if (c < 0 || (c === 0 && !plage.deInclus)) return false;
  }
  if (plage.a && plage.a !== '*') {
    const c = comparerVersions(version, plage.a);
    if (c > 0 || (c === 0 && !plage.aInclus)) return false;
  }
  return true;
}

/** Une faille gardée de la base Wordfence : le strict nécessaire pour la reconnaître et la dire. */
export interface FailleConnue {
  id: string;
  titre: string;
  plages: PlageTouchee[];
  /** La première version qui corrige, quand il y en a une. */
  corrigeeEn?: string;
  /** La gravité dite par Wordfence (« Critical », « High »…), quand elle est donnée. */
  gravite?: string;
}

/** La base compacte : « plugin:contact-form-7 » → ses failles connues. */
export type IndexFailles = Record<string, FailleConnue[]>;

/**
 * LE FLUX WORDFENCE, RÉDUIT À CE QUI SERT. Le flux pèse des dizaines de Mo ; on
 * n'en garde que l'identifiant, le titre, la gravité et les plages touchées,
 * rangés par logiciel. Les entrées « informatives » (sans version touchée) sont
 * écartées : elles ne disent pas qu'une version installée est vulnérable.
 */
export function compacterFluxWordfence(flux: unknown): IndexFailles {
  const index: IndexFailles = {};
  const entrees = Array.isArray(flux) ? flux : Object.values((flux ?? {}) as Record<string, unknown>);
  for (const brute of entrees) {
    const v = (brute ?? {}) as Record<string, any>;
    if (v.informational === true || !Array.isArray(v.software)) continue;
    const id = String(v.id ?? '');
    if (!id) continue;
    const titre = String(v.title ?? id).slice(0, 300);
    const gravite = typeof v.cvss?.rating === 'string' ? v.cvss.rating : undefined;
    for (const logiciel of v.software as Record<string, any>[]) {
      const type = String(logiciel?.type ?? '');
      const slug = String(logiciel?.slug ?? '');
      if (!type || !slug) continue;
      const plages: PlageTouchee[] = Object.values((logiciel.affected_versions ?? {}) as Record<string, any>).map((p) => ({
        de: String(p?.from_version ?? '*'),
        deInclus: p?.from_inclusive !== false,
        a: String(p?.to_version ?? '*'),
        aInclus: p?.to_inclusive !== false,
      }));
      if (!plages.length) continue;
      const corrections = Array.isArray(logiciel.patched_versions) ? logiciel.patched_versions.map(String).filter(Boolean) : [];
      const corrigeeEn = corrections.sort(comparerVersions)[0];
      (index[`${type}:${slug}`] ??= []).push({ id, titre, plages, ...(corrigeeEn ? { corrigeeEn } : {}), ...(gravite ? { gravite } : {}) });
    }
  }
  return index;
}

/** Les failles connues qui touchent CETTE version de CE logiciel. */
export function faillesDe(index: IndexFailles, type: 'plugin' | 'theme' | 'core', slug: string, version: string): FailleConnue[] {
  return (index[`${type}:${slug}`] ?? []).filter((f) => f.plages.some((p) => versionDansPlage(version, p)));
}

/* ------------------------------------------------------------------ */
/* Le catalogue de WordPress : les extensions abandonnées               */
/* ------------------------------------------------------------------ */

export type EtatCatalogue = 'ok' | 'fermee' | 'ancienne' | 'inconnue';

/**
 * LA FICHE D'UNE EXTENSION DANS LE CATALOGUE PUBLIC DE WORDPRESS. « Fermée » :
 * retirée du catalogue (plus aucune mise à jour possible). « Ancienne » : pas
 * touchée depuis `ABANDON_MS`. « Inconnue » : absente du catalogue — une
 * extension payante ou maison, sur laquelle on ne conclut rien.
 */
export function jugerFicheCatalogue(fiche: unknown, maintenant: number): { etat: EtatCatalogue; date?: string } {
  const f = (fiche ?? {}) as Record<string, unknown>;
  if (f.closed === true || f.error === 'closed')
    return { etat: 'fermee', ...(typeof f.closed_date === 'string' ? { date: f.closed_date } : {}) };
  if (typeof f.error === 'string' || typeof f.last_updated !== 'string') return { etat: 'inconnue' };
  const date = f.last_updated.slice(0, 10);
  const instant = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(instant)) return { etat: 'inconnue' };
  return maintenant - instant > ABANDON_MS ? { etat: 'ancienne', date } : { etat: 'ok', date };
}

/* ------------------------------------------------------------------ */
/* Les soucis                                                           */
/* ------------------------------------------------------------------ */

export type GenreSouci =
  | 'faille'
  | 'desactivee'
  | 'disparue'
  | 'pic'
  | 'fatale'
  | 'maj'
  | 'abandon'
  | 'acces';

/** Les soucis qui font partir un courriel à leur apparition. */
export const GENRES_IMPORTANTS: readonly GenreSouci[] = ['faille', 'desactivee', 'disparue', 'pic'];

/** Les soucis que chaque passage tient à jour (les autres, il n'y touche pas). */
export const GENRES_DES_EXTENSIONS: readonly GenreSouci[] = ['faille', 'desactivee', 'disparue', 'maj', 'abandon'];
export const GENRES_DES_JOURNAUX: readonly GenreSouci[] = ['pic', 'fatale'];

/** Un souci constaté. Ses mots sont composés à l'affichage, pour se traduire. */
export interface SouciWordpress {
  /** Unique par site tant que le souci dure (« maj:plugin:akismet »). */
  cle: string;
  genre: GenreSouci;
  /** Ce qui est touché : une extension, un thème, « WordPress », un journal. */
  sujet: string;
  version?: string;
  versionCible?: string;
  /** Un chiffre : avertissements vus, ou erreurs fatales. */
  nombre?: number;
  /** L'habitude du site, pour un pic. */
  habituel?: number;
  /** Le titre d'une faille, l'état d'une extension abandonnée (« fermee », « ancienne »), un message d'erreur. */
  detail?: string;
  /** Une date (« 2024-07-25 ») : la fermeture ou la dernière mise à jour d'une extension abandonnée. */
  date?: string;
}

/** Un souci en cours, avec la date de sa première apparition. */
export interface SouciEnCours extends SouciWordpress {
  depuis: number;
}

/** Une ligne du suivi de 30 jours. */
export interface ConstatWordpress extends SouciWordpress {
  premiereVue: number;
  derniereVue: number;
  resoluLe?: number;
}

export function estImportant(souci: Pick<SouciWordpress, 'genre'>): boolean {
  return GENRES_IMPORTANTS.includes(souci.genre);
}

/**
 * LE BLOC « ÉTAT WORDPRESS » DU TIROIR S'OUVRE-T-IL D'OFFICE ? Seulement sur
 * une faille connue ou une erreur grave dans les journaux : une mise à jour,
 * une extension désactivée ou un pic d'avertissements le laissent replié.
 * Jugé UNE fois, à l'ouverture du tiroir — jamais à chaque relevé.
 */
export function alerteGraveWordpress(soucis: readonly Pick<SouciWordpress, 'genre'>[]): boolean {
  return soucis.some((s) => s.genre === 'faille' || s.genre === 'fatale');
}

/**
 * LES SOUCIS D'UN INVENTAIRE. Chaque mise à jour en attente, chaque faille
 * connue sur la version installée, chaque extension attendue qui n'est plus
 * active, chaque extension abandonnée. Une extension retirée exprès se règle
 * d'un geste (« accepter l'état actuel ») qui met à jour la liste attendue.
 */
export function soucisDeLInventaire(entree: {
  inventaire: InventaireWordpress;
  attendues: readonly string[];
  failles?: IndexFailles | null;
  catalogue?: Readonly<Record<string, { etat: EtatCatalogue; date?: string }>>;
}): SouciWordpress[] {
  const { inventaire } = entree;
  const soucis: SouciWordpress[] = [];
  const actif = (e: ElementWordpress) => e.statut.startsWith('active') || e.statut === 'must-use';
  for (const e of inventaire.extensions) {
    if (e.miseAJour)
      soucis.push({ cle: `maj:plugin:${e.slug}`, genre: 'maj', sujet: e.slug, version: e.version, versionCible: e.miseAJour });
  }
  for (const e of inventaire.themes) {
    if (e.miseAJour)
      soucis.push({ cle: `maj:theme:${e.slug}`, genre: 'maj', sujet: e.slug, version: e.version, versionCible: e.miseAJour });
  }
  if (inventaire.core.miseAJour)
    soucis.push({ cle: 'maj:core', genre: 'maj', sujet: 'WordPress', version: inventaire.core.version, versionCible: inventaire.core.miseAJour });

  if (entree.failles) {
    const voir = (type: 'plugin' | 'theme' | 'core', slug: string, version: string, sujet: string) => {
      for (const f of faillesDe(entree.failles!, type, slug, version))
        soucis.push({
          cle: `faille:${f.id}:${type}:${slug}`,
          genre: 'faille',
          sujet,
          version,
          ...(f.corrigeeEn ? { versionCible: f.corrigeeEn } : {}),
          detail: f.gravite ? `${f.titre} (${f.gravite})` : f.titre,
        });
    };
    for (const e of inventaire.extensions) voir('plugin', e.slug, e.version, e.slug);
    for (const e of inventaire.themes) voir('theme', e.slug, e.version, e.slug);
    if (inventaire.core.version) voir('core', 'wordpress', inventaire.core.version, 'WordPress');
  }

  const parSlug = new Map(inventaire.extensions.map((e) => [e.slug, e]));
  for (const slug of entree.attendues) {
    const e = parSlug.get(slug);
    if (!e) soucis.push({ cle: `disparue:${slug}`, genre: 'disparue', sujet: slug });
    else if (!actif(e)) soucis.push({ cle: `desactivee:${slug}`, genre: 'desactivee', sujet: slug, version: e.version });
  }

  for (const e of inventaire.extensions) {
    const fiche = entree.catalogue?.[e.slug];
    if (fiche && (fiche.etat === 'fermee' || fiche.etat === 'ancienne'))
      soucis.push({ cle: `abandon:${e.slug}`, genre: 'abandon', sujet: e.slug, version: e.version, detail: fiche.etat, ...(fiche.date ? { date: fiche.date } : {}) });
  }
  return soucis;
}

/** Les extensions actives d'un inventaire : la liste attendue de la mise en place. */
export function extensionsActives(inventaire: InventaireWordpress): string[] {
  return inventaire.extensions.filter((e) => e.statut.startsWith('active') || e.statut === 'must-use').map((e) => e.slug);
}

/** La nouvelle moyenne glissante des avertissements. Le premier passage la pose. */
export function prochaineMoyenne(moyenne: number | undefined, avertissements: number): number {
  return moyenne === undefined ? avertissements : moyenne * (1 - POIDS_MOYENNE) + avertissements * POIDS_MOYENNE;
}

/** Un pic : bien au-dessus de l'habitude du site, et jamais au premier passage. */
export function estUnPic(avertissements: number, moyenne: number | undefined): boolean {
  if (moyenne === undefined) return false;
  return avertissements >= Math.max(PIC_PLANCHER, PIC_FACTEUR * moyenne);
}

/** Les soucis d'une lecture des journaux. */
export function soucisDesJournaux(lecture: LectureJournaux, moyenne: number | undefined): SouciWordpress[] {
  const soucis: SouciWordpress[] = [];
  if (estUnPic(lecture.avertissements, moyenne))
    soucis.push({ cle: 'pic', genre: 'pic', sujet: 'journaux', nombre: lecture.avertissements, habituel: Math.round(moyenne ?? 0) });
  if (lecture.fatales > 0)
    soucis.push({ cle: 'fatale', genre: 'fatale', sujet: 'journaux', nombre: lecture.fatales, ...(lecture.exemples[0] ? { detail: lecture.exemples[0] } : {}) });
  return soucis;
}

/**
 * LE RAPPROCHEMENT D'UN PASSAGE AVEC CE QUI ÉTAIT OUVERT, pour les seuls
 * genres que ce passage surveille : ce qui est nouveau s'ouvre, ce qui a
 * disparu se résout, ce qui dure garde sa date de première apparition.
 */
export function rapprocher(
  ouverts: readonly SouciEnCours[],
  vus: readonly SouciWordpress[],
  genres: readonly GenreSouci[],
): { ouvrir: SouciWordpress[]; garder: SouciWordpress[]; resoudre: SouciEnCours[] } {
  const vusParCle = new Map(vus.map((s) => [s.cle, s]));
  const ouvertsParCle = new Map(ouverts.map((s) => [s.cle, s]));
  return {
    ouvrir: vus.filter((s) => !ouvertsParCle.has(s.cle)),
    garder: vus.filter((s) => ouvertsParCle.has(s.cle)),
    resoudre: ouverts.filter((s) => genres.includes(s.genre) && !vusParCle.has(s.cle)),
  };
}

/** Le résumé qui voyage avec la surveillance jusqu'à l'écran. */
export interface ResumeWordpress {
  extensionsLe: number;
  journauxLe: number;
  soucis: SouciEnCours[];
  /** Faux tant que la clé Wordfence manque : les failles ne sont pas cherchées. */
  faillesActives: boolean;
  /** Le nombre d'extensions vues au dernier relevé. */
  extensions?: number;
  /** Le dernier passage de l'allègement des journaux (réussi ou non). */
  journauxNettoyesLe?: number;
  /** Le dernier allègement qui a vraiment retiré quelque chose. */
  dernierNettoyage?: DernierNettoyage;
}

/** Ce que l'écran dit du dernier allègement : la date et les tailles avant/après. */
export interface DernierNettoyage {
  le: number;
  journaux: { chemin: string; avant: number; apres: number }[];
}

/**
 * LA MÉMOIRE DES PASSAGES, gardée sur la fiche du site (colonne `wp_suivi`).
 * Elle ne voyage pas telle quelle jusqu'à l'écran : seul son résumé part.
 */
export interface SuiviWordpress {
  extensionsLe: number;
  journauxLe: number;
  /** La position lue dans chaque journal, par chemin. */
  positions: Record<string, number>;
  /** La moyenne glissante des avertissements par passage. */
  moyenne?: number;
  /** Les passages d'affilée qui ont lu une erreur fatale. */
  echecsJournaux: number;
  /** L'erreur fatale en cours : le site est en panne « journaux » tant qu'elle dure. */
  journauxEnErreur?: { depuis: number; detail?: string };
  inventaire?: InventaireWordpress;
  soucis: SouciEnCours[];
  faillesActives: boolean;
  /** Le dernier passage de l'allègement des journaux, réussi ou non. */
  journauxNettoyesLe?: number;
  dernierNettoyage?: DernierNettoyage;
}

export function suiviVide(): SuiviWordpress {
  return { extensionsLe: 0, journauxLe: 0, positions: {}, echecsJournaux: 0, soucis: [], faillesActives: false };
}

/** Le suivi lu en base. Abîmé, il repart de zéro : le passage suivant le reconstruit. */
export function suiviDeLigne(json: string | null | undefined): SuiviWordpress {
  if (!json) return suiviVide();
  try {
    const lu = JSON.parse(json) as Partial<SuiviWordpress>;
    return {
      ...suiviVide(),
      ...lu,
      positions: lu.positions && typeof lu.positions === 'object' ? lu.positions : {},
      soucis: Array.isArray(lu.soucis) ? lu.soucis : [],
      echecsJournaux: Number(lu.echecsJournaux) || 0,
    };
  } catch {
    return suiviVide();
  }
}

/** Ce qui part à l'écran. */
export function resumeDuSuivi(suivi: SuiviWordpress): ResumeWordpress {
  return {
    extensionsLe: suivi.extensionsLe,
    journauxLe: suivi.journauxLe,
    soucis: suivi.soucis,
    faillesActives: suivi.faillesActives,
    ...(suivi.inventaire ? { extensions: suivi.inventaire.extensions.length } : {}),
    ...(suivi.journauxNettoyesLe ? { journauxNettoyesLe: suivi.journauxNettoyesLe } : {}),
    ...(suivi.dernierNettoyage ? { dernierNettoyage: suivi.dernierNettoyage } : {}),
  };
}

/** Un site « à surveiller » : debout, mais avec au moins un souci en cours. */
export function aSurveiller(site: { etat: string; wpResume?: ResumeWordpress }): boolean {
  return site.etat !== 'panne' && !!site.wpResume?.soucis.length;
}

/* ------------------------------------------------------------------ */
/* Les mots                                                             */
/* ------------------------------------------------------------------ */

/** Un souci dit en clair, en français — pour les courriels et l'agent. */
export function phraseDuSouci(s: SouciWordpress): string {
  const v = s.version ? ` ${s.version}` : '';
  switch (s.genre) {
    case 'faille':
      return `Faille connue : ${s.sujet}${v}${s.detail ? ` — ${s.detail}` : ''}${s.versionCible ? ` (corrigée en ${s.versionCible})` : ' (aucun correctif : désactiver l’extension)'}`;
    case 'desactivee':
      return `Extension désactivée : ${s.sujet} n’est plus active`;
    case 'disparue':
      return `Extension disparue : ${s.sujet} n’est plus installée`;
    case 'pic':
      return `Pic d’avertissements dans les journaux : ${s.nombre ?? 0} en un passage (habituellement ${s.habituel ?? 0})`;
    case 'fatale':
      return `Erreur grave dans les journaux (${s.nombre ?? 1})${s.detail ? ` : ${s.detail}` : ''}`;
    case 'maj':
      return `Mise à jour disponible : ${s.sujet}${v} → ${s.versionCible ?? '?'}`;
    case 'abandon':
      return s.detail === 'fermee'
        ? `Extension retirée du catalogue WordPress${s.date ? ` le ${s.date}` : ''} : ${s.sujet}`
        : `Extension abandonnée (dernière mise à jour${s.date ? ` le ${s.date}` : ' il y a plus de deux ans'}) : ${s.sujet}`;
    case 'acces':
      return `Contrôle WordPress impossible : ${s.detail ?? 'serveur injoignable'}`;
  }
}

/**
 * UN SOUCI EN HTML : son genre en gras (« Faille connue »), puis ce qu'il
 * touche. La phrase est celle du texte simple, coupée à son premier « : ».
 */
function souciEnHtml(s: SouciWordpress): string {
  const phrase = phraseDuSouci(s);
  const coupe = phrase.indexOf(' : ');
  const genre = coupe > 0 ? phrase.slice(0, coupe) : phrase;
  const reste = coupe > 0 ? phrase.slice(coupe + 3) : '';
  const teinte = estImportant(s) ? 'rouge' : 'ambre';
  return (
    '<tr>' +
    `<td width="22" valign="top" style="width:22px;padding:1px 0 8px 0;font-size:12px;color:${TEINTES[teinte].fort};">●</td>` +
    `<td valign="top" style="padding:0 0 8px 0;"><strong>${echapper(genre)}</strong>${reste ? ` — ${echapper(reste)}` : ''}</td>` +
    '</tr>'
  );
}

function soucisEnHtml(soucis: readonly SouciWordpress[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" data-soucis>${soucis.map(souciEnHtml).join('')}</table>`;
}

/** LE COURRIEL IMMÉDIAT : les soucis importants qui VIENNENT d'apparaître sur un site. */
export function courrielDeSoucisWordpress(entree: {
  site: { id?: string; nom: string; url: string };
  soucis: readonly SouciWordpress[];
}): { sujet: string; texte: string; html: string } {
  const { site, soucis } = entree;
  const sujet =
    soucis.length === 1 ? `${site.nom} : ${phraseDuSouci(soucis[0]).split(' : ')[0].toLowerCase()}` : `${site.nom} : ${soucis.length} soucis WordPress`;
  const lignes = [
    `Le contrôle WordPress de ${site.nom} vient de relever :`,
    '',
    ...soucis.map((s) => `• ${phraseDuSouci(s)}`),
    '',
    `Adresse : ${site.url}`,
    'Le détail et le suivi des 30 derniers jours sont dans le tiroir du site, fenêtre « Surveillance ».',
    'Ce courriel ne part qu’une fois par souci : tant qu’il dure, il reste affiché sans nouveau message.',
  ];
  const html = courrielEnBlocs({
    titre: 'Surveillance WordPress',
    apercu: lignes[0],
    bandeau: {
      teinte: 'ambre',
      surtitre: 'Contrôle WordPress',
      titre: soucis.length === 1 ? `Un souci sur ${site.nom}` : `${soucis.length} soucis sur ${site.nom}`,
      texteHtml: echapper(lignes[0]),
      pastille: { libelle: 'À regarder', teinte: 'ambre' },
      illustration: 'wordpress-soucis',
    },
    ...(site.id ? { lienEnTete: { libelle: 'Voir dans Beluga', lien: lienDeLaSurveillance(site.id) } } : {}),
    blocs: [
      blocAIcone({
        icone: 'bouclier',
        teinte: 'ambre',
        titre: 'Ce qui a été relevé',
        contenu: soucisEnHtml(soucis),
      }),
      blocDAdresse(site.url),
      blocAIcone({
        icone: 'horloge',
        teinte: 'gris',
        titre: 'Suivi',
        contenu:
          texteEnHtml(lignes[lignes.length - 2]) +
          `<div style="color:${COULEURS.attenue};font-size:13px;padding:6px 0 0 0;">${echapper(lignes[lignes.length - 1])}</div>` +
          boutonsDeSurveillance(site),
      }),
    ],
    pied: piedDeSurveillance(site.nom),
  });
  return { sujet, texte: lignes.join('\n'), html };
}

/**
 * LE RÉCAPITULATIF DE LA SEMAINE, le lundi matin : chaque site WordPress, ses
 * soucis en cours et ce qui a été réglé dans la semaine — un bloc par site.
 *
 * SON POIDS : environ 2,7 Ko de HTML par site. Gmail coupe un message vers
 * 102 Ko : au-delà d'une trentaine de sites, il faudra une présentation plus
 * compacte (une ligne par site sans souci).
 */
export function recapitulatifWordpress(entree: {
  sites: readonly { id?: string; nom: string; url: string; soucis: readonly SouciEnCours[]; resolus: number; panne: boolean }[];
}): { sujet: string; texte: string; html: string } {
  const aVoir = entree.sites.filter((s) => s.soucis.length || s.panne).length;
  const sujet = aVoir
    ? `WordPress : ${aVoir} site${aVoir > 1 ? 's' : ''} à surveiller cette semaine`
    : 'WordPress : rien à signaler cette semaine';
  const lignes: string[] = [`Le point de la semaine sur ${entree.sites.length} site${entree.sites.length > 1 ? 's' : ''} WordPress.`, ''];
  for (const site of entree.sites) {
    const etat = site.panne ? 'en panne' : site.soucis.length ? `${site.soucis.length} souci${site.soucis.length > 1 ? 's' : ''} en cours` : 'rien à signaler';
    lignes.push(`${site.nom} (${site.url}) — ${etat}${site.resolus ? `, ${site.resolus} réglé${site.resolus > 1 ? 's' : ''} cette semaine` : ''}`);
    const tries = [...site.soucis].sort((a, b) => Number(estImportant(b)) - Number(estImportant(a)));
    for (const s of tries) lignes.push(`• ${phraseDuSouci(s)}`);
    lignes.push('');
  }
  const blocs = entree.sites.map((site) => {
    const teinte = site.panne ? 'rouge' : site.soucis.length ? 'ambre' : 'vert';
    const etat = site.panne
      ? 'En panne'
      : site.soucis.length
        ? `${site.soucis.length} souci${site.soucis.length > 1 ? 's' : ''} en cours`
        : 'Rien à signaler';
    const tries = [...site.soucis].sort((a, b) => Number(estImportant(b)) - Number(estImportant(a)));
    return blocAIcone({
      icone: 'globe',
      teinte,
      titre: site.nom,
      contenu:
        `<div style="padding:0 0 2px 0;">${lienEnClair(site.url)}</div>` +
        `<div style="padding:6px 0 ${tries.length ? 10 : 0}px 0;">${pastille(etat, teinte)}` +
        (site.resolus
          ? `&nbsp; <span style="font-size:13px;color:${COULEURS.attenue};white-space:nowrap;">${site.resolus} réglé${site.resolus > 1 ? 's' : ''} cette semaine</span>`
          : '') +
        '</div>' +
        (tries.length ? soucisEnHtml(tries) : '') +
        (site.id ? `<div style="padding:${tries.length ? 2 : 10}px 0 0 0;">${lienDiscret('Voir dans Beluga →', lienDeLaSurveillance(site.id))}</div>` : ''),
    });
  });
  const html = courrielEnBlocs({
    titre: 'Surveillance WordPress',
    apercu: lignes[0],
    bandeau: {
      teinte: aVoir ? 'ambre' : 'vert',
      surtitre: 'Point de la semaine',
      titre: aVoir ? `${aVoir} site${aVoir > 1 ? 's' : ''} à surveiller` : 'Rien à signaler cette semaine',
      texteHtml: echapper(lignes[0]),
      illustration: 'wordpress-recapitulatif',
    },
    blocs,
    pied: 'Surveillance automatisée des sites WordPress, par Beluga Build',
  });
  return { sujet, texte: lignes.join('\n'), html };
}

/** Une heure de Zurich : le jour de la semaine (0 = dimanche) et l'heure. */
function jourEtHeureAZurich(instant: number): { jour: number; heure: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(
    new Date(instant),
  );
  const jours = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    jour: jours.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? ''),
    heure: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24,
  };
}

/** Le récapitulatif part le LUNDI à partir de 8 h (heure de Zurich), une seule fois par semaine. */
export function doitEnvoyerLeRecapitulatif(maintenant: number, dernierEnvoi: number | undefined): boolean {
  const { jour, heure } = jourEtHeureAZurich(maintenant);
  if (jour !== 1 || heure < 8) return false;
  return !dernierEnvoi || maintenant - dernierEnvoi > 3 * 24 * 3_600_000;
}

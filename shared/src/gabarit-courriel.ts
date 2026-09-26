/**
 * LE GABARIT DES COURRIELS — en-tête, cartes, bulles, boutons, encadrés.
 *
 * Les trois courriels de l'espace client (point du jour, récapitulatif client,
 * identifiants) partagent CETTE présentation : un bandeau léger aux couleurs de
 * Haiko Studio, une salutation et une phrase qui résume, puis des cartes
 * aérées. Les demandes se lisent comme une CONVERSATION : la bulle de l'autre à
 * gauche, la sienne à droite, et sous chaque demande ce qui a bougé dessus.
 *
 * UN SEUL BOUTON PRINCIPAL À LA FOIS : celui de la carte. L'accès général à
 * l'espace est un LIEN DISCRET (`lienDiscret`), jamais un deuxième gros bouton
 * qui ferait concurrence à ceux des demandes.
 *
 * CE FICHIER EST PUR : aucune base, aucun réseau, aucune horloge. Il ne fait
 * que fabriquer du texte — il se teste donc seul.
 *
 * CE QU'UN CLIENT DE MESSAGERIE SAIT FAIRE, ET RIEN DE PLUS :
 *
 *  - des TABLEAUX imbriqués, jamais de `flex` ni de `grid` : Outlook les ignore
 *    et empile tout à gauche ;
 *  - des STYLES EN LIGNE, jamais une feuille de style ni une variable CSS :
 *    Gmail retire le `<style>` d'un message transféré, et `var(--accent)` n'a
 *    aucun sens hors du navigateur — les couleurs sont donc en hexadécimal ;
 *  - AUCUNE RESSOURCE EXTERNE : ni image, ni police à télécharger. Le « logo »
 *    est du texte, les pictogrammes sont des émojis ;
 *  - LARGEUR MAXIMALE de 600 px, et un rendu qui tient déjà en une colonne de
 *    320 px sans `media query` : la mise en page ne doit dépendre d'aucune
 *    règle qu'un client pourrait jeter.
 *
 * L'ALIGNEMENT SE FAIT PAR DES CELLULES VIDES, pas par `float` ni par
 * `margin-left:auto` : c'est la seule façon d'obtenir une bulle à droite qui
 * tienne dans Outlook comme dans Gmail.
 */

import type {
  BlocDeMessages,
  ChangementAuCourriel,
  DemandeAuCourriel,
  MessageAuCourriel,
} from './courriels-clients.js';
import { dateAmicale, estUnPredicat, nombre } from './phrases-courriel.js';

/* ------------------------------------------------------------------ */
/* Les repères visuels, figés                                           */
/* ------------------------------------------------------------------ */

/** La largeur du courriel. Au-delà, un téléphone ou Outlook coupe la colonne. */
export const LARGEUR_COURRIEL = 600;

/**
 * LES COULEURS, EN HEXADÉCIMAL. Un fond chaud et calme, des cartes blanches,
 * le noir de référence de la marque pour le bandeau, et un seul bleu d'action.
 */
export const COULEURS = {
  fond: '#f6f4f1',
  carte: '#ffffff',
  texte: '#1f1d1a',
  attenue: '#77716a',
  trait: '#ebe6df',
  /** Le bandeau du haut : le noir de référence de Haiko Studio. */
  marque: '#09090b',
  texteMarque: '#ffffff',
  pastilleMarque: '#f59e0b',
  /** La bulle de l'AUTRE, à gauche : un gris chaud. */
  bulleAutre: '#f1efeb',
  texteAutre: '#1f1d1a',
  /** LA SIENNE, à droite : l'accent atténué, lisible en noir. */
  bulleSoi: '#e3edfd',
  texteSoi: '#16294a',
  bouton: '#2563eb',
  texteBouton: '#ffffff',
  lien: '#2563eb',
  /** Le bloc « Ce qui a bougé », sous les bulles : plus discret qu'une bulle. */
  fondChangements: '#faf8f5',
  /** Les encadrés doux : invitation à répondre, identifiants. */
  fondDoux: '#eef4ff',
  bordDoux: '#d6e4fb',
  /** La pastille d'initiale d'un client. */
  fondInitiale: '#ffedd5',
  texteInitiale: '#9a3412',
} as const;

/** Une seule pile de polices, toutes présentes sur les systèmes courants. */
export const POLICE = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** Pour un identifiant ou un mot de passe : chaque caractère se distingue. */
export const POLICE_CHASSE_FIXE = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace";

/** Un tableau de mise en page : jamais lu comme un tableau de données. */
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/* ------------------------------------------------------------------ */
/* Les briques                                                          */
/* ------------------------------------------------------------------ */

/** Un texte posé dans du HTML ne doit jamais pouvoir en devenir. */
export function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Un texte de message : échappé, puis ses retours à la ligne rendus visibles. */
export function texteEnHtml(texte: string): string {
  return echapper(texte).replace(/\r?\n/g, '<br>');
}

/** Un paragraphe de corps de courriel. */
export function paragraphe(texte: string, discret = false): string {
  return (
    `<div style="font-family:${POLICE};font-size:${discret ? 13 : 15}px;line-height:1.55;` +
    `color:${discret ? COULEURS.attenue : COULEURS.texte};padding:0 0 12px 0;">${texteEnHtml(texte)}</div>`
  );
}

/**
 * UNE BULLE. `cotePropre` est le rôle du DESTINATAIRE du courriel : chez le
 * client c'est `client`, chez Haiko c'est `admin`. Un message écrit par lui
 * part à droite, tout le reste à gauche — le courriel se lit comme sa propre
 * messagerie, pas comme celle d'un tiers.
 */
export function bulle(message: MessageAuCourriel, cotePropre: 'admin' | 'client'): string {
  const soi = message.role === cotePropre;
  const fond = soi ? COULEURS.bulleSoi : COULEURS.bulleAutre;
  const couleur = soi ? COULEURS.texteSoi : COULEURS.texteAutre;
  const marge = '<td width="12%" style="font-size:0;line-height:0;">&nbsp;</td>';
  const contenu =
    `<td data-bulle="${soi ? 'propre' : 'autre'}" style="background:${fond};border-radius:14px;` +
    `padding:10px 13px;font-family:${POLICE};font-size:14px;line-height:1.5;color:${couleur};">` +
    `<div style="font-size:12px;color:${COULEURS.attenue};padding-bottom:3px;">` +
    `<strong style="color:${couleur};">${echapper(message.auteur)}</strong> · ${echapper(dateAmicale(message.date))}` +
    `</div>${texteEnHtml(message.texte)}</td>`;
  return `<table ${TABLE} width="100%" style="margin:0 0 8px 0;"><tr>${soi ? marge + contenu : contenu + marge}</tr></table>`;
}

/** Ce qui a été écarté au-dessus d'un bloc, accordé. */
function phraseDesEcartes(ecartes: number): string {
  return `${nombre(ecartes, 'message plus ancien', 'messages plus anciens')} ${ecartes > 1 ? 'ne sont' : 'n’est'} pas repris ici`;
}

/** Les bulles d'un bloc, et la mention de ce qui a été écarté au-dessus. */
export function bullesDuBloc(bloc: BlocDeMessages, cotePropre: 'admin' | 'client'): string {
  const ecartes = bloc.ecartes
    ? `<div data-messages-ecartes="${bloc.ecartes}" style="font-family:${POLICE};font-size:12px;color:${COULEURS.attenue};padding:0 0 8px 0;">` +
      `↑ ${phraseDesEcartes(bloc.ecartes)}.</div>`
    : '';
  return ecartes + bloc.messages.map((m) => bulle(m, cotePropre)).join('');
}

/** Un changement se lit avec son auteur quand c'est quelqu'un qui a agi. */
export function phraseAvecAuteur(changement: ChangementAuCourriel): string {
  return estUnPredicat(changement.detail) ? `${changement.auteur} ${changement.detail}` : changement.detail;
}

/**
 * CE QUI A BOUGÉ SUR LA DEMANDE, SOUS SES BULLES. Ce n'est pas une bulle : ce
 * n'est pas quelqu'un qui parle, c'est le journal de la fiche — il se lit donc
 * comme une note, pleine largeur, une phrase par ligne.
 */
export function changements(liste: readonly ChangementAuCourriel[]): string {
  if (!liste.length) return '';
  const lignes = liste
    .map((c) => {
      const phrase = estUnPredicat(c.detail)
        ? `<strong>${echapper(c.auteur)}</strong> ${echapper(c.detail)}`
        : echapper(c.detail);
      return (
        `<div data-changement style="padding:3px 0;">• ${phrase}` +
        `<span style="color:${COULEURS.attenue};font-size:12px;"> · ${echapper(dateAmicale(c.date))}</span></div>`
      );
    })
    .join('');
  return (
    `<table ${TABLE} width="100%" style="margin:6px 0 0 0;">` +
    `<tr><td style="background:${COULEURS.fondChangements};border:1px solid ${COULEURS.trait};border-radius:10px;padding:10px 12px;` +
    `font-family:${POLICE};font-size:14px;line-height:1.5;color:${COULEURS.texte};">` +
    `<div style="font-size:13px;font-weight:700;color:${COULEURS.texte};padding-bottom:2px;">🔄 Ce qui a bougé</div>` +
    `${lignes}</td></tr></table>`
  );
}

/** UN BOUTON. Un lien déguisé : aucun client de messagerie ne sait faire mieux. */
export function bouton(libelle: string, lien: string, principal = true): string {
  const fond = principal ? COULEURS.bouton : COULEURS.carte;
  const couleur = principal ? COULEURS.texteBouton : COULEURS.texte;
  const bord = principal ? `1px solid ${COULEURS.bouton}` : `1px solid ${COULEURS.trait}`;
  return (
    `<table ${TABLE} style="margin:14px 0 2px 0;"><tr>` +
    `<td data-bouton style="background:${fond};border:${bord};border-radius:10px;">` +
    `<a href="${echapper(lien)}" style="display:inline-block;padding:11px 18px;font-family:${POLICE};` +
    `font-size:14px;font-weight:600;color:${couleur};text-decoration:none;">${echapper(libelle)}</a>` +
    '</td></tr></table>'
  );
}

/** UN LIEN DISCRET : l'accès général, qui ne fait pas concurrence aux boutons. */
export function lienDiscret(libelle: string, lien: string): string {
  return (
    `<a data-lien-discret href="${echapper(lien)}" style="font-family:${POLICE};font-size:14px;font-weight:600;` +
    `color:${COULEURS.lien};text-decoration:none;">${echapper(libelle)}</a>`
  );
}

/** Le trait qui sépare deux blocs. Un vrai trait, pas une bordure de tableau. */
export function separateur(): string {
  return (
    `<table ${TABLE} width="100%" style="margin:18px 0;">` +
    `<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${COULEURS.trait};">&nbsp;</td></tr></table>`
  );
}

/** Un titre de section, au-dessus d'un bloc : en casse normale, lisible. */
export function titreDeSection(texte: string): string {
  return (
    `<div data-titre-section style="font-family:${POLICE};font-size:17px;font-weight:700;color:${COULEURS.texte};` +
    `line-height:1.3;padding:22px 0 10px 2px;">${echapper(texte)}</div>`
  );
}

/** Une carte blanche, quel que soit son contenu : c'est le cadre commun. */
export function carte(contenu: string, marqueur = ''): string {
  return (
    `<table ${TABLE} width="100%"${marqueur ? ` ${marqueur}` : ''} ` +
    `style="margin:0 0 12px 0;background:${COULEURS.carte};border:1px solid ${COULEURS.trait};border-radius:14px;">` +
    '<tr><td style="padding:18px;">' +
    contenu +
    '</td></tr></table>'
  );
}

/** Un encadré doux, teinté : ce qui mérite qu'on s'y arrête sans crier. */
export function encadre(contenu: string, marqueur = ''): string {
  return (
    `<table ${TABLE} width="100%"${marqueur ? ` ${marqueur}` : ''} ` +
    `style="margin:16px 0 0 0;background:${COULEURS.fondDoux};border:1px solid ${COULEURS.bordDoux};border-radius:14px;">` +
    `<tr><td style="padding:16px 18px;">${contenu}</td></tr></table>`
  );
}

/** Une liste de points courts, chacun avec son émoji. */
export function listeDePoints(points: readonly { emoji: string; texte: string }[]): string {
  const lignes = points
    .map(
      (p) =>
        '<tr>' +
        `<td width="30" valign="top" style="font-size:17px;line-height:1.5;padding:0 0 8px 0;">${p.emoji}</td>` +
        `<td valign="top" style="font-family:${POLICE};font-size:15px;line-height:1.5;color:${COULEURS.texte};padding:0 0 8px 0;">` +
        `${echapper(p.texte)}</td></tr>`,
    )
    .join('');
  return `<table ${TABLE} width="100%" data-liste-points>${lignes}</table>`;
}

/**
 * LE BANDEAU D'UN CLIENT dans le point du jour : son initiale dans une pastille,
 * son nom EN CLAIR (sa casse est gardée) et ce qui l'attend, accordé.
 */
export function enteteDeClient(nom: string, resume: string): string {
  const initiale = echapper((nom.trim().charAt(0) || '?').toUpperCase());
  return (
    `<table ${TABLE} width="100%" data-client style="margin:26px 0 10px 0;"><tr>` +
    `<td width="46" valign="middle">` +
    `<table ${TABLE}><tr><td width="36" height="36" align="center" valign="middle" ` +
    `style="width:36px;height:36px;border-radius:18px;background:${COULEURS.fondInitiale};color:${COULEURS.texteInitiale};` +
    `font-family:${POLICE};font-size:16px;font-weight:700;">${initiale}</td></tr></table></td>` +
    `<td valign="middle" style="font-family:${POLICE};">` +
    `<div style="font-size:18px;font-weight:700;color:${COULEURS.texte};line-height:1.25;">${echapper(nom)}</div>` +
    `<div style="font-size:13px;color:${COULEURS.attenue};padding-top:2px;">${echapper(resume)}</div>` +
    '</td></tr></table>'
  );
}

/** L'encadré des identifiants : chaque valeur en gros, en chasse fixe. */
export function encadreDIdentifiants(input: { lien: string; identifiant: string; motDePasse: string }): string {
  const ligne = (libelle: string, valeur: string, marqueur: string) =>
    `<div style="font-family:${POLICE};font-size:12px;color:${COULEURS.attenue};padding:0 0 2px 0;">${libelle}</div>` +
    `<div ${marqueur} style="font-family:${POLICE_CHASSE_FIXE};font-size:19px;font-weight:700;color:${COULEURS.texte};` +
    `letter-spacing:0.3px;padding:0 0 12px 0;word-break:break-all;">${echapper(valeur)}</div>`;
  return encadre(
    `<div style="font-family:${POLICE};font-size:15px;font-weight:700;color:${COULEURS.texte};padding:0 0 12px 0;">🔑 Vos identifiants</div>` +
      ligne('Identifiant', input.identifiant, 'data-identifiant') +
      ligne('Mot de passe', input.motDePasse, 'data-mot-de-passe') +
      `<div style="font-family:${POLICE};font-size:12px;color:${COULEURS.attenue};padding:0 0 2px 0;">Adresse</div>` +
      lienDiscret(input.lien.replace(/^https?:\/\//, ''), input.lien),
    'data-identifiants',
  );
}

/* ------------------------------------------------------------------ */
/* Les blocs des courriels                                              */
/* ------------------------------------------------------------------ */

/**
 * LA CARTE D'UNE DEMANDE : son titre, son projet, ses bulles, ce qui a bougé
 * dessous, et LE bouton qui ouvre sa fiche. Rien d'autre : une carte de
 * courriel n'est pas une fiche, c'est une invitation à l'ouvrir.
 */
export function carteDeDemande(
  demande: DemandeAuCourriel,
  options: {
    cotePropre: 'admin' | 'client';
    bloc: BlocDeMessages;
    lien?: string;
    libelleBouton?: string;
    /** « livraison annoncée le … », déjà rédigé par l'appelant. */
    pied?: string;
  },
): string {
  const sousTitre = [demande.projet ? `📁 ${demande.projet}` : '', options.pied].filter(Boolean).join(' · ');
  const entete =
    `<div style="font-family:${POLICE};font-size:17px;font-weight:700;color:${COULEURS.texte};line-height:1.3;">` +
    `${echapper(demande.titre)}</div>` +
    (sousTitre
      ? `<div style="font-family:${POLICE};font-size:13px;color:${COULEURS.attenue};line-height:1.45;padding:4px 0 12px 0;">${echapper(sousTitre)}</div>`
      : '<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>');
  const corps =
    entete +
    bullesDuBloc(options.bloc, options.cotePropre) +
    changements(demande.changements ?? []) +
    (options.lien ? bouton(options.libelleBouton ?? 'Ouvrir la demande', options.lien) : '');
  return carte(corps, 'data-carte-demande');
}

/** LE BLOC DE DISCUSSION DIRECTE : le fil qui ne tient à aucune demande. */
export function carteDeDiscussion(options: {
  titre: string;
  cotePropre: 'admin' | 'client';
  bloc: BlocDeMessages;
  lien?: string;
  libelleBouton?: string;
}): string {
  const corps =
    `<div style="font-family:${POLICE};font-size:17px;font-weight:700;color:${COULEURS.texte};padding:0 0 12px 0;">` +
    `${echapper(options.titre)}</div>` +
    bullesDuBloc(options.bloc, options.cotePropre) +
    (options.lien ? bouton(options.libelleBouton ?? 'Ouvrir la discussion', options.lien) : '');
  return carte(corps, 'data-carte-discussion');
}

/* ------------------------------------------------------------------ */
/* L'enveloppe                                                          */
/* ------------------------------------------------------------------ */

/**
 * LE DOCUMENT ENTIER. Une colonne de 600 px au plus : le bandeau de la marque,
 * la salutation et sa phrase qui résume, le corps, la formule de fin, puis une
 * mention discrète. Rien n'est chargé du dehors.
 *
 * L'APERÇU est la phrase que la messagerie montre sous l'objet, dans la liste :
 * cachée dans le corps, sans quoi elle y afficherait le début du bandeau.
 */
export function documentDeCourriel(options: {
  /** Le titre du document, repris en petit à droite du bandeau. */
  titre: string;
  apercu?: string;
  salutation: string;
  intro: string;
  corps: string;
  /** La formule de fin ; un retour à la ligne se garde. */
  fin: string;
  mention?: string;
}): string {
  const apercu = options.apercu
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COULEURS.fond};opacity:0;">` +
      `${echapper(options.apercu)}</div>`
    : '';
  const bandeau =
    `<table ${TABLE} width="100%"><tr>` +
    `<td style="background:${COULEURS.marque};border-radius:16px 16px 0 0;padding:14px 22px;font-family:${POLICE};">` +
    `<table ${TABLE} width="100%"><tr>` +
    `<td style="font-size:15px;font-weight:700;color:${COULEURS.texteMarque};letter-spacing:0.2px;">` +
    `<span style="color:${COULEURS.pastilleMarque};">●</span>&nbsp;Haiko Studio</td>` +
    `<td align="right" style="font-size:12px;color:#a1a1aa;">${echapper(options.titre)}</td>` +
    '</tr></table></td></tr>' +
    `<tr><td data-accueil style="background:${COULEURS.carte};border:1px solid ${COULEURS.trait};border-top:0;` +
    `border-radius:0 0 16px 16px;padding:22px 22px 12px 22px;">` +
    `<div style="font-family:${POLICE};font-size:23px;font-weight:700;color:${COULEURS.texte};line-height:1.25;padding:0 0 10px 0;">` +
    `${echapper(options.salutation)}</div>` +
    paragraphe(options.intro) +
    '</td></tr></table>';
  const fin =
    `<div data-fin style="font-family:${POLICE};font-size:15px;line-height:1.55;color:${COULEURS.texte};padding:26px 2px 0 2px;">` +
    `${texteEnHtml(options.fin)}</div>` +
    (options.mention
      ? `<div style="font-family:${POLICE};font-size:12px;line-height:1.5;color:${COULEURS.attenue};padding:18px 2px 0 2px;">` +
        `${echapper(options.mention)}</div>`
      : '');
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${echapper(options.titre)}</title></head>` +
    `<body style="margin:0;padding:0;background:${COULEURS.fond};">` +
    apercu +
    `<table ${TABLE} width="100%" style="background:${COULEURS.fond};">` +
    '<tr><td align="center" style="padding:20px 10px 28px 10px;">' +
    `<table ${TABLE} width="${LARGEUR_COURRIEL}" style="width:100%;max-width:${LARGEUR_COURRIEL}px;">` +
    '<tr><td align="left">' +
    bandeau +
    options.corps +
    fin +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

/* ------------------------------------------------------------------ */
/* La version texte : la même chose, sans une seule balise               */
/* ------------------------------------------------------------------ */

/** Un titre de section en texte : souligné, comme dans un vrai message. */
export function titreTexte(texte: string): string[] {
  return [texte, '─'.repeat(Math.min(40, [...texte].length))];
}

/** Une bulle en texte simple : qui, quand, puis ce qui a été dit. */
export function bulleTexte(message: MessageAuCourriel): string {
  const corps = message.texte
    .split(/\r?\n/)
    .map((ligne) => `    ${ligne}`)
    .join('\n');
  return `  ${message.auteur} · ${dateAmicale(message.date)}\n${corps}`;
}

/** Les bulles d'un bloc en texte, précédées de ce qui a été écarté. */
export function bullesDuBlocTexte(bloc: BlocDeMessages): string[] {
  const lignes: string[] = [];
  if (bloc.ecartes) lignes.push(`  (${phraseDesEcartes(bloc.ecartes)})`);
  for (const message of bloc.messages) lignes.push(bulleTexte(message));
  return lignes;
}

/** Ce qui a bougé, en texte : une phrase par ligne. */
export function changementsTexte(liste: readonly ChangementAuCourriel[]): string[] {
  if (!liste.length) return [];
  return ['  🔄 Ce qui a bougé :', ...liste.map((c) => `    • ${phraseAvecAuteur(c)} · ${dateAmicale(c.date)}`)];
}

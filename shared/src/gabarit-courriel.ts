/**
 * LE GABARIT DES COURRIELS — enveloppe, bandeau d'état, blocs à pictogramme,
 * bulles, boutons, encadrés.
 *
 * LES SEPT COURRIELS QUE BELUGA ENVOIE partagent CETTE présentation : les trois
 * de l'espace client (point du jour, récapitulatif client, identifiants) et
 * les quatre de la surveillance (panne et rappel, retour, soucis WordPress,
 * récapitulatif WordPress), d'après la MAQUETTE du 2026-10-07 passée au
 * neutre : une seule carte blanche arrondie sur un fond gris pâle ; en tête,
 * le logo violet et un lien discret « Mon espace → » ; un ACCUEIL — surtitre
 * en capitales, GRAND TITRE et ILLUSTRATION 3D grise à droite — posé sur une
 * bande ROUGE, VERTE ou AMBRE quand il annonce un état, blanc sinon ; puis des
 * ENCADRÉS GRIS sans bordure, chacun ouvert par un pictogramme gris nu ; un
 * bouton violet pleine largeur ; la formule de fin sous un trait ; et la bande
 * grise du pied, logo et devise. Le violet ne reste qu'au logo, aux liens et
 * au bouton.
 *
 * Les demandes se lisent comme une CONVERSATION : la bulle de l'autre à
 * gauche, la sienne à droite, et sous chaque demande ce qui a bougé dessus.
 *
 * UN SEUL BOUTON PRINCIPAL À LA FOIS dans un courriel client : celui de la
 * carte. L'accès général à l'espace est un LIEN DISCRET (`lienDiscret`),
 * jamais un deuxième gros bouton qui ferait concurrence à ceux des demandes.
 *
 * CE FICHIER EST PUR : aucune base, aucun réseau, aucune horloge. Il ne fait
 * que fabriquer du texte — il se teste donc seul.
 *
 * CE QU'UN CLIENT DE MESSAGERIE SAIT FAIRE, ET RIEN DE PLUS :
 *
 *  - des TABLEAUX imbriqués, jamais de `flex` ni de `grid` : Outlook les ignore
 *    et empile tout à gauche. Seule exception, `deuxColonnes` : deux `div` en
 *    `inline-block` qui s'empilent d'eux-mêmes sous 600 px, doublés d'un
 *    tableau réservé à Outlook dans un commentaire conditionnel `[if mso]` ;
 *  - des STYLES EN LIGNE, jamais une feuille de style ni une variable CSS :
 *    Gmail retire le `<style>` d'un message transféré, et `var(--accent)` n'a
 *    aucun sens hors du navigateur — les couleurs sont donc en hexadécimal ;
 *  - AUCUNE POLICE À TÉLÉCHARGER, et des IMAGES D'UN SEUL DOSSIER,
 *    `web/public/courriel/`, en PNG (Gmail n'affiche pas le SVG), à taille
 *    fixe : les PICTOGRAMMES DÉCORATIFS (`carreDIcone`) et les ILLUSTRATIONS
 *    (`illustration`), qui ne portent JAMAIS d'information — le titre la dit
 *    déjà, d'où `alt=""` —, puis le LOGO HAIKO (`logoHaiko`), BLANC sur
 *    fond foncé, VIOLET de marque sur fond clair (la carte et son pied) —
 *    lui porte la marque, donc un `alt` « Haiko Studio » stylé
 *    pour rester lisible quand les images sont bloquées.
 *    `ressourcesInterditesDuCourriel` refuse toute autre image ;
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
import { HOTE_ESPACE_CLIENT } from './porte-client.js';

/* ------------------------------------------------------------------ */
/* Les repères visuels, figés                                           */
/* ------------------------------------------------------------------ */

/** La largeur du courriel. Au-delà, un téléphone ou Outlook coupe la colonne. */
export const LARGEUR_COURRIEL = 600;

/**
 * LES COULEURS, EN HEXADÉCIMAL — la maquette du 2026-10-07, passée au NEUTRE
 * (décision du 2026-10-07) : un fond gris très pâle, UNE carte blanche qui
 * porte tout le courriel, des encadrés gris sans bordure. Le violet de la
 * marque ne reste qu'au LOGO, aux LIENS et au BOUTON.
 */
export const COULEURS = {
  fond: '#f3f3f1',
  carte: '#ffffff',
  /** Le cadre de la carte : à peine visible, il la détache du fond. */
  bordCarte: '#e7e5e4',
  texte: '#1c1917',
  attenue: '#6b6762',
  trait: '#ecebe9',
  /** Le fond foncé de référence, pour ce qui en garde un (logo blanc). */
  marque: '#09090b',
  texteMarque: '#ffffff',
  pastilleMarque: '#f59e0b',
  /** Le violet de la marque (violet-500 du site haiko.studio). */
  violetMarque: '#7e00fd',
  /** La bulle de l'AUTRE, à gauche : blanche, posée sur l'encadré gris. */
  bulleAutre: '#ffffff',
  texteAutre: '#1c1917',
  /** LA SIENNE, à droite : un gris plus soutenu. */
  bulleSoi: '#e7e5e4',
  texteSoi: '#1c1917',
  bouton: '#7e00fd',
  texteBouton: '#ffffff',
  lien: '#6b00d9',
  /** Le bloc « Ce qui a bougé », sous les bulles : blanc sur le gris. */
  fondChangements: '#ffffff',
  /** Les encadrés doux : blocs, notes, identifiants. Gris pâle, sans bordure. */
  fondDoux: '#f5f5f4',
  bordDoux: '#f5f5f4',
  /** Le pied de la carte : la bande gris pâle du bas. */
  fondPied: '#f5f5f4',
  /** La pastille d'initiale d'un client. */
  fondInitiale: '#e7e5e4',
  texteInitiale: '#44403c',
} as const;

/**
 * LES TEINTES D'ÉTAT : VIOLET pour l'information et l'action (la marque),
 * rouge pour une panne, vert pour un retour, ambre pour ce qui demande
 * attention, bleu et gris gardés pour les anciens appels. Chacune a son fond,
 * son bord, le fond de ses pastilles, sa couleur franche (le pictogramme, le
 * surtitre) et sa couleur foncée (le texte posé sur la pastille).
 */
export const TEINTES = {
  violet: { fond: '#f6f3ff', bord: '#ece5ff', carre: '#ede7ff', fort: '#7e00fd', fonce: '#4c1d95' },
  rouge: { fond: '#fef2f2', bord: '#fecaca', carre: '#fee2e2', fort: '#dc2626', fonce: '#991b1b' },
  vert: { fond: '#f0fdf4', bord: '#bbf7d0', carre: '#dcfce7', fort: '#16a34a', fonce: '#166534' },
  ambre: { fond: '#fffbeb', bord: '#fde68a', carre: '#fef3c7', fort: '#d97706', fonce: '#92400e' },
  bleu: { fond: '#eff6ff', bord: '#bfdbfe', carre: '#dbeafe', fort: '#2563eb', fonce: '#1e40af' },
  gris: { fond: '#faf8f5', bord: '#ebe6df', carre: '#f1efeb', fort: '#57534e', fonce: '#1f1d1a' },
} as const;
export type Teinte = keyof typeof TEINTES;

/**
 * LES PICTOGRAMMES DESSINÉS, un PNG par pictogramme ET par teinte
 * (`<nom>-<teinte>.png`, 60 px de côté affichés en 20 : net sur un écran
 * dense). Ils sont fabriqués par `scripts/dessiner-pictogrammes-courriel.mjs`
 * dans `web/public/courriel/`, servis sans session, et n'existent EN LIGNE
 * qu'une fois publiés.
 */
export const PICTOGRAMMES = [
  'lien',
  'alerte',
  'document',
  'liste',
  'diagnostic',
  'horloge',
  'coche',
  'globe',
  'cle',
  'bulle',
  'dossier',
  'cadenas',
  'bouclier',
  'cloche',
] as const;
export type Pictogramme = (typeof PICTOGRAMMES)[number];

/** D'où les pictogrammes sont servis : l'adresse publique de l'espace client. */
export const ADRESSE_DES_PICTOGRAMMES = `https://${HOTE_ESPACE_CLIENT}/courriel`;

export function adresseDuPictogramme(nom: Pictogramme, teinte: Teinte): string {
  return `${ADRESSE_DES_PICTOGRAMMES}/${nom}-${teinte}.png`;
}

/**
 * LE LOGO HAIKO, en image : BLANC sur un fond foncé, VIOLET sur un fond clair
 * (décision du 2026-10-07). Fichiers à 240 × 87 px, affichés à la moitié pour
 * rester nets sur écran dense ; tirés de `scripts/systeme/maintenance/logo-haiko.png`.
 * L'`alt` stylé prend sa place quand la messagerie bloque les images.
 */
export function logoHaiko(fond: 'fonce' | 'clair', largeur = 96): string {
  const hauteur = Math.round((largeur * 87) / 240);
  const fichier = fond === 'fonce' ? 'logo-haiko-blanc.png' : 'logo-haiko-violet.png';
  const couleur = fond === 'fonce' ? COULEURS.texteMarque : COULEURS.violetMarque;
  return (
    `<img src="${ADRESSE_DES_PICTOGRAMMES}/${fichier}" width="${largeur}" height="${hauteur}" alt="Haiko Studio" ` +
    `style="display:block;border:0;outline:none;width:${largeur}px;height:${hauteur}px;` +
    `font-family:${POLICE};font-size:15px;font-weight:700;line-height:${hauteur}px;color:${couleur};">`
  );
}

/**
 * LES ILLUSTRATIONS, une par sorte de courriel, posées à droite du grand titre
 * (objet 3D gris, seule sa pastille d'état en couleur, fond TRANSPARENT pour
 * se poser aussi bien sur la carte blanche que sur la bande d'état). Fabriquées par
 * `scripts/illustrations-courriel.mjs` (générateur d'images de Codex), 320 px
 * affichées en 150 : `web/public/courriel/illustration-<nom>.png`. Décoratives :
 * `alt=""`, le titre dit déjà tout.
 */
export const ILLUSTRATIONS = [
  'client',
  'haiko',
  'identifiants',
  'panne',
  'rappel',
  'retour',
  'wordpress-soucis',
  'wordpress-recapitulatif',
] as const;
export type Illustration = (typeof ILLUSTRATIONS)[number];

/**
 * La VERSION des illustrations, au bout de leur adresse : les messageries (le
 * relais d'images de Gmail) gardent une image tant que son adresse ne change
 * pas. À monter à chaque nouvelle fournée de dessins.
 */
export const VERSION_ILLUSTRATIONS = 2;

/**
 * `fluide` : l'image remplit sa cellule jusqu'à `cote` (`width:100%`,
 * `height:auto`) au lieu d'une taille fixe ; les ATTRIBUTS gardent `cote`, pour
 * Outlook qui ignore `max-width`.
 */
export function illustration(nom: Illustration, cote = 150, fluide = false): string {
  const taille = fluide ? `width:100%;max-width:${cote}px;height:auto;` : `width:${cote}px;height:${cote}px;`;
  return (
    `<img data-illustration="${nom}" src="${ADRESSE_DES_PICTOGRAMMES}/illustration-${nom}.png?v=${VERSION_ILLUSTRATIONS}" width="${cote}" height="${cote}" alt="" ` +
    `style="display:block;border:0;outline:none;${taille}">`
  );
}

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
    `<tr><td style="background:${COULEURS.fondChangements};border-radius:12px;padding:10px 14px;` +
    `font-family:${POLICE};font-size:14px;line-height:1.5;color:${COULEURS.texte};">` +
    `<div style="font-size:13px;font-weight:700;color:${COULEURS.texte};padding-bottom:2px;">Ce qui a bougé</div>` +
    `${lignes}</td></tr></table>`
  );
}

/**
 * UN BOUTON, sans marge autour. Un lien déguisé : aucun client de messagerie
 * ne sait faire mieux. Le principal est plein, au violet de la marque, avec sa
 * flèche ; un secondaire est en contour.
 */
function boutonNu(libelle: string, lien: string, principal: boolean, pleineLargeur = false): string {
  const fond = principal ? COULEURS.bouton : COULEURS.carte;
  const couleur = principal ? COULEURS.texteBouton : COULEURS.lien;
  const bord = principal ? `1px solid ${COULEURS.bouton}` : `1px solid ${TEINTES.violet.bord}`;
  return (
    `<table ${TABLE}${pleineLargeur ? ' width="100%"' : ''}><tr>` +
    `<td data-bouton${principal ? '' : '="secondaire"'} align="center" style="background:${fond};border:${bord};border-radius:12px;">` +
    `<a href="${echapper(lien)}" style="display:${pleineLargeur ? 'block' : 'inline-block'};padding:14px 22px;font-family:${POLICE};` +
    `font-size:15px;font-weight:700;color:${couleur};text-decoration:none;text-align:center;">${echapper(libelle)}${principal ? '&nbsp;&nbsp;→' : ''}</a>` +
    '</td></tr></table>'
  );
}

/** UN BOUTON posé seul, sous le contenu d'une carte : pleine largeur, comme la maquette. */
export function bouton(libelle: string, lien: string, principal = true): string {
  return `<div style="padding:16px 0 2px 0;">${boutonNu(libelle, lien, principal, true)}</div>`;
}

/** UN LIEN DISCRET : l'accès général, qui ne fait pas concurrence aux boutons. */
export function lienDiscret(libelle: string, lien: string): string {
  return (
    `<a data-lien-discret href="${echapper(lien)}" style="font-family:${POLICE};font-size:14px;font-weight:600;` +
    `color:${COULEURS.lien};text-decoration:none;">${echapper(libelle)}</a>`
  );
}

/** Un titre de section, au-dessus d'un bloc : en casse normale, lisible. */
export function titreDeSection(texte: string): string {
  return (
    `<div data-titre-section style="font-family:${POLICE};font-size:17px;font-weight:700;color:${COULEURS.texte};` +
    `line-height:1.3;padding:22px 0 10px 2px;">${echapper(texte)}</div>`
  );
}

/** Un bloc blanc sans pictogramme : une liste qui porte déjà les siens. */
export function cadreBlanc(contenu: string, marqueur = ''): string {
  return (
    `<table ${TABLE} width="100%"${marqueur ? ` ${marqueur}` : ''} ` +
    `style="margin:0 0 14px 0;background:${COULEURS.fondDoux};border-radius:16px;">` +
    `<tr><td style="padding:18px 20px 8px 20px;">${contenu}</td></tr></table>`
  );
}

/** Un encadré doux, teinté : ce qui mérite qu'on s'y arrête sans crier. */
export function encadre(contenu: string, marqueur = ''): string {
  return (
    `<table ${TABLE} width="100%"${marqueur ? ` ${marqueur}` : ''} ` +
    `style="margin:16px 0 0 0;background:${COULEURS.fondDoux};border-radius:16px;">` +
    `<tr><td style="padding:18px 20px;">${contenu}</td></tr></table>`
  );
}

/**
 * Une liste de points courts. Chacun s'ouvre sur son PICTOGRAMME dans un petit
 * carré quand il en a un, sur son émoji sinon.
 */
export function listeDePoints(
  points: readonly { emoji: string; texte: string; icone?: Pictogramme; teinte?: Teinte }[],
): string {
  const lignes = points
    .map(
      (p) =>
        '<tr>' +
        (p.icone
          ? `<td width="40" valign="top" style="width:40px;padding:0 0 10px 0;">${carreDIcone(p.icone, p.teinte ?? 'gris', 'petit')}</td>`
          : `<td width="30" valign="top" style="font-size:17px;line-height:1.5;padding:0 0 8px 0;">${p.emoji}</td>`) +
        `<td valign="${p.icone ? 'middle' : 'top'}" style="font-family:${POLICE};font-size:15px;line-height:1.5;color:${COULEURS.texte};padding:0 0 ${p.icone ? 10 : 8}px 0;">` +
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

/**
 * LE BLOC DES IDENTIFIANTS : chaque valeur en gros, en chasse fixe, sur un fond
 * doux qui la détache du reste. Le pictogramme de la clé remplace l'émoji.
 */
export function encadreDIdentifiants(input: {
  lien: string;
  identifiant: string;
  motDePasse: string;
  /** Le bouton de connexion, posé sous les valeurs, dans le même bloc. */
  libelleBouton?: string;
}): string {
  const ligne = (libelle: string, valeur: string, marqueur: string) =>
    `<div style="font-family:${POLICE};font-size:12px;color:${COULEURS.attenue};padding:0 0 2px 0;">${libelle}</div>` +
    `<div ${marqueur} style="font-family:${POLICE_CHASSE_FIXE};font-size:20px;font-weight:700;color:${COULEURS.violetMarque};` +
    `letter-spacing:0.3px;padding:0 0 12px 0;word-break:break-all;">${echapper(valeur)}</div>`;
  const valeurs =
    `<table ${TABLE} width="100%"><tr><td style="background:${COULEURS.carte};` +
    'border-radius:14px;padding:16px 18px 4px 18px;">' +
    ligne('Identifiant', input.identifiant, 'data-identifiant') +
    ligne('Mot de passe', input.motDePasse, 'data-mot-de-passe') +
    `<div style="font-family:${POLICE};font-size:12px;color:${COULEURS.attenue};padding:0 0 2px 0;">Adresse</div>` +
    `<div style="padding:0 0 12px 0;">${lienDiscret(input.lien.replace(/^https?:\/\//, ''), input.lien)}</div>` +
    '</td></tr></table>';
  return blocAIcone({
    icone: 'cle',
    teinte: 'gris',
    titre: 'Vos identifiants',
    contenu: valeurs + (input.libelleBouton ? bouton(input.libelleBouton, input.lien) : ''),
    pleineLargeur: true,
    marqueur: 'data-identifiants',
  });
}

/* ------------------------------------------------------------------ */
/* Les briques en blocs : pictogrammes, colonnes, étapes, boutons       */
/* ------------------------------------------------------------------ */

/**
 * UN PICTOGRAMME, NU, comme dans la maquette : un trait de la teinte posé
 * directement sur l'encadré gris, sans carré autour. `alt=""` : il est
 * décoratif, le titre du bloc porte l'information. Une cellule de taille fixe
 * garde la place quand la messagerie bloque les images.
 */
export function carreDIcone(nom: Pictogramme, teinte: Teinte, taille: 'normal' | 'petit' = 'normal'): string {
  const image = taille === 'petit' ? 20 : 24;
  return (
    `<table ${TABLE} data-pictogramme="${nom}"><tr>` +
    `<td width="${image}" height="${image}" style="width:${image}px;height:${image}px;line-height:0;font-size:0;">` +
    `<img src="${adresseDuPictogramme(nom, teinte)}" width="${image}" height="${image}" alt="" ` +
    `style="display:block;border:0;outline:none;text-decoration:none;width:${image}px;height:${image}px;">` +
    '</td></tr></table>'
  );
}

/**
 * UN BLOC À PICTOGRAMME, la brique du modèle : un cadre blanc arrondi, le
 * carré teinté à gauche, le titre (et un sous-titre discret) à sa droite.
 * Le contenu se pose sous le titre, ou sur TOUTE la largeur du bloc
 * (`pleineLargeur`) quand il a besoin de place — des bulles, par exemple.
 */
export function blocAIcone(options: {
  icone: Pictogramme;
  teinte: Teinte;
  titre: string;
  /** Une ligne discrète sous le titre, déjà écrite en texte simple. */
  sousTitre?: string;
  /** Le contenu, DÉJÀ en HTML (et donc déjà échappé par l'appelant). */
  contenu?: string;
  pleineLargeur?: boolean;
  /** Un attribut posé sur le bloc (« data-carte-demande »). */
  marqueur?: string;
}): string {
  const contenu = options.contenu ?? '';
  const sousTitre = options.sousTitre
    ? `<div style="font-size:13px;color:${COULEURS.attenue};line-height:1.45;padding:2px 0 0 0;">${echapper(options.sousTitre)}</div>`
    : '';
  const titre =
    `<div style="font-size:16px;font-weight:700;color:${COULEURS.texte};line-height:1.3;` +
    `padding:${options.sousTitre ? 0 : 5}px 0 0 0;">${echapper(options.titre)}</div>`;
  const aCote = !options.pleineLargeur && contenu ? `<div style="padding:8px 0 0 0;">${contenu}</div>` : '';
  const dessous = options.pleineLargeur && contenu ? `<div style="padding:14px 0 0 0;">${contenu}</div>` : '';
  return (
    `<table ${TABLE} width="100%"${options.marqueur ? ` ${options.marqueur}` : ''} data-bloc ` +
    `style="margin:0 0 14px 0;background:${COULEURS.fondDoux};border-radius:16px;">` +
    `<tr><td style="padding:18px 20px;font-family:${POLICE};font-size:14px;line-height:1.55;color:${COULEURS.texte};">` +
    `<table ${TABLE} width="100%"><tr>` +
    `<td width="40" valign="top" style="width:40px;padding-top:${options.sousTitre ? 2 : 4}px;">${carreDIcone(options.icone, options.teinte)}</td>` +
    `<td valign="top" style="font-family:${POLICE};font-size:14px;line-height:1.55;color:${COULEURS.texte};overflow-wrap:anywhere;">` +
    titre +
    sousTitre +
    aCote +
    '</td></tr></table>' +
    dessous +
    '</td></tr></table>'
  );
}

/**
 * DEUX BLOCS CÔTE À CÔTE, qui s'EMPILENT D'EUX-MÊMES sur un téléphone, sans
 * `media query` : deux `div` en `inline-block` séparés par un espace de 12 px
 * (264 + 12 + 264, sous les 542 px utiles de la carte). Leur largeur suit la
 * technique « fab four » : `calc((524px - 100%) * 524)` est très négative quand
 * la colonne dépasse 524 px (`min-width` la ramène à 264 : côte à côte), et
 * énorme dessous (`max-width`
 * la ramène à 100 % : empilés, pleine largeur). Une messagerie qui jette
 * `calc` garde le `width:100%` d'avant : empilés. Outlook ignore
 * `inline-block` : il lit à la place le tableau à deux cellules caché dans les
 * commentaires `[if mso]`. Le conteneur est à `font-size:0` pour qu'aucun
 * espace ne s'insère entre les deux.
 */
export function deuxColonnes(gauche: string, droite: string): string {
  const COLONNE = COLONNE_MIN;
  const colonne = (contenu: string) =>
    '<div style="display:inline-block;vertical-align:top;font-size:14px;line-height:1.55;' +
    `width:100%;min-width:${COLONNE}px;max-width:100%;width:calc((${SEUIL_COLONNES}px - 100%) * ${SEUIL_COLONNES});">${contenu}</div>`;
  return (
    '<div data-deux-colonnes style="font-size:0;line-height:0;">' +
    `<!--[if mso]><table ${TABLE} width="100%"><tr><td width="${COLONNE}" valign="top"><![endif]-->` +
    colonne(gauche) +
    `<!--[if mso]></td><td width="12">&nbsp;</td><td width="${COLONNE}" valign="top"><![endif]-->` +
    '<div style="display:inline-block;width:12px;font-size:0;line-height:0;">&nbsp;</div>' +
    colonne(droite) +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '</div>'
  );
}

/** Des étapes numérotées, chacune ouverte par sa pastille ronde. */
export function listeNumerotee(etapes: readonly string[], teinte: Teinte = 'gris'): string {
  const lignes = etapes
    .map(
      (etape, rang) =>
        '<tr>' +
        `<td width="34" valign="top" style="width:34px;min-width:34px;padding:0 0 8px 0;">` +
        `<table ${TABLE}><tr><td width="24" height="24" align="center" valign="middle" ` +
        `style="width:24px;height:24px;border-radius:12px;background:${TEINTES[teinte].carre};color:${TEINTES[teinte].fonce};` +
        `font-family:${POLICE};font-size:12px;font-weight:700;line-height:24px;">${rang + 1}</td></tr></table></td>` +
        `<td valign="top" style="font-family:${POLICE};font-size:14px;line-height:1.5;color:${COULEURS.texte};padding:2px 0 8px 0;` +
        `word-break:break-word;overflow-wrap:anywhere;">${echapper(etape)}</td></tr>`,
    )
    .join('');
  return `<table ${TABLE} width="100%" data-etapes>${lignes}</table>`;
}

/** Un code, un chemin, un statut HTTP : en chasse fixe, dans une pastille teintée. */
export function codeEnLigne(texte: string, teinte: Teinte = 'gris'): string {
  return (
    `<span data-code style="font-family:${POLICE_CHASSE_FIXE};font-size:12px;font-weight:600;` +
    `background:${TEINTES[teinte].carre};color:${TEINTES[teinte].fonce};border-radius:6px;padding:1px 6px;white-space:nowrap;">` +
    `${echapper(texte)}</span>`
  );
}

/**
 * LES STATUTS HTTP D'UNE PHRASE, mis en pastille : « les erreurs 500 » fait
 * ressortir le 500. Le texte est échappé ICI ; seuls les nombres de 400 à 599
 * qui ne sont suivis d'aucune unité (ms, Ko, %…) deviennent des pastilles.
 */
export function texteAvecCodes(texte: string, teinte: Teinte = 'rouge'): string {
  return texteEnHtml(texte).replace(/\b([45]\d\d)\b(?!\s?(?:ms|s\b|px|Ko|Mo|Go|%|€|CHF|\d))/g, (_tout, code: string) =>
    codeEnLigne(code, teinte),
  );
}

/** Une pastille d'état : un point de couleur et quelques mots. */
export function pastille(libelle: string, teinte: Teinte): string {
  return (
    `<span data-pastille style="display:inline-block;background:${TEINTES[teinte].carre};color:${TEINTES[teinte].fonce};` +
    `border-radius:999px;padding:3px 10px;font-family:${POLICE};font-size:12px;font-weight:700;line-height:1.5;white-space:nowrap;">` +
    `<span style="color:${TEINTES[teinte].fort};">●</span>&nbsp;${echapper(libelle)}</span>`
  );
}

/**
 * UNE RANGÉE DE BOUTONS : le premier plein, les suivants en contour. Chaque
 * bouton est un `inline-block` : ils restent sur une ligne en 600 px, et
 * passent à la ligne d'eux-mêmes sur un téléphone.
 */
export function rangeeDeBoutons(boutons: readonly { libelle: string; lien: string }[]): string {
  if (!boutons.length) return '';
  return (
    '<div data-boutons style="padding:6px 0 0 0;font-size:0;">' +
    boutons
      .map(
        (b, rang) =>
          `<div style="display:inline-block;vertical-align:top;padding:8px 8px 0 0;">${boutonNu(b.libelle, b.lien, rang === 0)}</div>`,
      )
      .join('') +
    '</div>'
  );
}

/** Une petite note précédée de son pictogramme : un rappel, une précaution. */
export function noteAIcone(icone: Pictogramme, teinte: Teinte, texte: string): string {
  return (
    `<table ${TABLE} width="100%" data-note style="margin:16px 0 0 0;background:${COULEURS.fondDoux};border-radius:16px;"><tr>` +
    `<td width="36" valign="top" style="width:36px;padding:18px 0 18px 20px;">${carreDIcone(icone, teinte, 'petit')}</td>` +
    `<td valign="middle" style="padding:18px 20px 18px 8px;font-family:${POLICE};font-size:14px;line-height:1.6;color:${COULEURS.attenue};">` +
    `${texteEnHtml(texte)}</td></tr></table>`
  );
}

/** Une ligne « libellé : valeur » dans un bloc, le libellé en petit au-dessus. */
export function champ(libelle: string, valeurHtml: string): string {
  return (
    `<div style="font-family:${POLICE};font-size:12px;color:${COULEURS.attenue};padding:0 0 2px 0;">${echapper(libelle)}</div>` +
    `<div style="font-family:${POLICE};font-size:14px;line-height:1.5;color:${COULEURS.texte};padding:0 0 10px 0;">${valeurHtml}</div>`
  );
}

/** Un lien en clair, l'adresse elle-même comme libellé : on voit où il mène. */
export function lienEnClair(lien: string): string {
  return (
    `<a href="${echapper(lien)}" style="font-family:${POLICE};font-size:14px;font-weight:600;color:${COULEURS.lien};` +
    `text-decoration:none;word-break:break-all;">${echapper(lien.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
  );
}

/**
 * CE QU'UN COURRIEL N'A PAS LE DROIT D'EMBARQUER. Rend la liste de ce qui
 * dépasse — vide quand tout va bien. Une image n'est tolérée que si elle est
 * un pictogramme de `ADRESSE_DES_PICTOGRAMMES`, à taille fixe et avec son
 * `alt` ; aucune autre source, aucune feuille de style, aucune police, aucun
 * `flex` ni `grid`, aucune `media query`. Lu par les tests et par
 * `scripts/apercu-courriels.mjs`.
 */
export function ressourcesInterditesDuCourriel(html: string): string[] {
  const trouves: string[] = [];
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const prefixe = `src="${ADRESSE_DES_PICTOGRAMMES}/`;
  if (images.some((img) => !img.includes(prefixe) || !/\bwidth="\d+"/.test(img) || !/\bheight="\d+"/.test(img) || !/\balt="/.test(img)))
    trouves.push('une image qui n’est pas un pictogramme');
  const sansPictogrammes = html.replace(/<img\b[^>]*>/gi, '');
  if (/@font-face/i.test(html)) trouves.push('une police téléchargée');
  if (/<style\b/i.test(html)) trouves.push('une feuille de style');
  if (/@media/i.test(html)) trouves.push('une media query');
  // Dans une BALISE seulement : un texte échappé (« &lt;img src=… ») ne charge rien.
  if (/<[a-z][^>]*\s(src|background)=/i.test(sansPictogrammes) || /style="[^"]*url\(/i.test(sansPictogrammes))
    trouves.push('une ressource externe');
  if (/display:\s*(flex|grid)/i.test(html)) trouves.push('un display que les clients de messagerie ignorent');
  if (/var\(--/i.test(html)) trouves.push('une variable CSS');
  return trouves;
}

/* ------------------------------------------------------------------ */
/* Les blocs des courriels                                              */
/* ------------------------------------------------------------------ */

/**
 * LA CARTE D'UNE DEMANDE : son titre et son projet à côté du pictogramme du
 * dossier, ses bulles sur toute la largeur, ce qui a bougé dessous, et LE
 * bouton qui ouvre sa fiche. Rien d'autre : une carte de courriel n'est pas une
 * fiche, c'est une invitation à l'ouvrir.
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
  const sousTitre = [demande.projet ?? '', options.pied ?? ''].filter(Boolean).join(' · ');
  return blocAIcone({
    icone: 'dossier',
    teinte: 'gris',
    titre: demande.titre,
    ...(sousTitre ? { sousTitre } : {}),
    contenu:
      bullesDuBloc(options.bloc, options.cotePropre) +
      changements(demande.changements ?? []) +
      (options.lien ? bouton(options.libelleBouton ?? 'Ouvrir la demande', options.lien) : ''),
    pleineLargeur: true,
    marqueur: 'data-carte-demande',
  });
}

/** LE BLOC DE DISCUSSION DIRECTE : le fil qui ne tient à aucune demande. */
export function carteDeDiscussion(options: {
  titre: string;
  cotePropre: 'admin' | 'client';
  bloc: BlocDeMessages;
  lien?: string;
  libelleBouton?: string;
}): string {
  return blocAIcone({
    icone: 'bulle',
    teinte: 'gris',
    titre: options.titre,
    contenu:
      bullesDuBloc(options.bloc, options.cotePropre) +
      (options.lien ? bouton(options.libelleBouton ?? 'Ouvrir la discussion', options.lien) : ''),
    pleineLargeur: true,
    marqueur: 'data-carte-discussion',
  });
}

/* ------------------------------------------------------------------ */
/* L'enveloppe                                                          */
/* ------------------------------------------------------------------ */

/**
 * L'ACCUEIL DU COURRIEL, sous l'en-tête de la marque : ce que le courriel
 * annonce, d'un coup d'œil. Un SURTITRE en capitales espacées (violet, ou la
 * couleur de l'état : rouge pour une panne, vert pour un retour, ambre pour
 * une attention — et alors tout l'accueil est sur une bande de cette teinte),
 * le GRAND TITRE, l'ILLUSTRATION à sa droite, puis une phrase et une pastille.
 * Teinte `marque` : le violet des courriels clients, sur fond blanc.
 */
export interface BandeauDEtat {
  teinte: Teinte | 'marque';
  surtitre?: string;
  /** À la suite du surtitre, en petit : l'heure du constat. */
  date?: string;
  titre: string;
  /** La phrase sous le titre, DÉJÀ en HTML (échappée par l'appelant). */
  texteHtml?: string;
  pastille?: { libelle: string; teinte: Teinte };
  /** L'illustration posée à droite du titre. */
  illustration?: Illustration;
}

/** La largeur utile de la carte : 600 moins son cadre et ses deux marges de 24 px. */
const INTERIEUR = LARGEUR_COURRIEL - 2 - 48;
/**
 * LE SEUIL DES COLONNES « fab four » : au-dessus, côte à côte ; dessous,
 * empilées. Un peu sous la largeur utile, pour qu'un arrondi ne fasse jamais
 * tout empiler en grand écran.
 */
const SEUIL_COLONNES = INTERIEUR - 20;
/**
 * LA LARGEUR D'UNE COLONNE côte à côte. Le `min-width` d'une colonne « fab
 * four » s'impose AUSSI une fois empilée : il doit donc tenir dans un
 * téléphone de 320 px (250 px utiles), sans quoi tout le courriel déborde.
 */
const COLONNE_MIN = 240;
/** La place de l'illustration, à droite du titre : son plafond en grand écran… */
const COLONNE_ILLUSTRATION = 150;
/** …et sa part de la largeur utile, qui la réduit d'elle-même sur un téléphone. */
const PART_ILLUSTRATION = 30;

/**
 * LE TITRE ET SON ILLUSTRATION CÔTE À CÔTE, sur TOUS les écrans, téléphone
 * compris : l'illustration n'empile plus au-dessus du titre (retour du
 * 2026-10-07, captures Gmail iOS). Elle se pose dans un tableau `align="right"`
 * — l'habillage d'image qu'Outlook comprend aussi, pas un `float` CSS — et le
 * surtitre comme le grand titre coulent À SA GAUCHE puis dessous, si bien
 * qu'un mot long (« compta.haikostudio.cloud ») passe à la ligne entier au lieu
 * d'être haché dans une colonne étroite. Sa largeur est une PART de la
 * carte (`PART_ILLUSTRATION`) bornée à `COLONNE_ILLUSTRATION` : 150 px en grand
 * écran, ~80 px sur un téléphone de 340 px. Outlook, qui ignore `max-width`,
 * lit l'attribut `width` : 150 px. La phrase et la pastille qui suivent
 * habillent l'image elles aussi : un titre court ne laisse pas un grand vide
 * sous lui en grand écran. C'est la cellule de l'accueil (`data-accueil`) qui
 * borne l'habillage : rien ne déborde dans le corps.
 */
function titreIllustre(texte: string, nom: Illustration): string {
  return (
    `<table ${TABLE} align="right" width="${PART_ILLUSTRATION}%" data-titre-illustre style="width:${PART_ILLUSTRATION}%;max-width:${COLONNE_ILLUSTRATION}px;">` +
    `<tr><td align="right" style="padding:0 0 4px 12px;">${illustration(nom, COLONNE_ILLUSTRATION, true)}</td></tr></table>` +
    texte
  );
}

/**
 * LES ÉTATS QUI COLORENT TOUT L'ACCUEIL : rouge (incident), vert (rétabli),
 * ambre (à regarder). L'accueil devient une BANDE pleine largeur de la teinte,
 * filet du même ton dessus et dessous, comme l'ancien bandeau d'état ; son
 * surtitre passe à la couleur FONCÉE de la teinte, seule à tenir 4,5 de
 * contraste en 12 px sur ce fond pâle. Les autres teintes laissent l'accueil
 * blanc. L'illustration est détourée (fond transparent) : elle se pose sur la
 * bande sans carré blanc autour.
 */
const ETATS_COLORES: readonly Teinte[] = ['rouge', 'vert', 'ambre'];

function bandeauDEtat(b: BandeauDEtat): string {
  const marque = b.teinte === 'marque';
  const colore = !marque && ETATS_COLORES.includes(b.teinte as Teinte);
  const teinte = marque ? undefined : TEINTES[b.teinte as Teinte];
  const fort = !teinte ? COULEURS.violetMarque : colore ? teinte.fonce : teinte.fort;
  const surtitre =
    b.surtitre || b.date
      ? `<div style="font-family:${POLICE};font-size:12px;font-weight:800;letter-spacing:1.6px;line-height:1.4;color:${fort};padding:0 0 10px 0;">` +
        (b.surtitre ? echapper(b.surtitre.toLocaleUpperCase('fr')) : '') +
        (b.date
          ? `<span style="font-weight:500;letter-spacing:0;color:${COULEURS.attenue};">${b.surtitre ? '&nbsp;&nbsp;·&nbsp;&nbsp;' : ''}${echapper(b.date)}</span>`
          : '') +
        '</div>'
      : '';
  // Une adresse (« compta.haikostudio.cloud ») plus large qu'un téléphone se
  // coupe après un point plutôt qu'au milieu d'un mot.
  const titre =
    `<div style="font-family:${POLICE};font-size:28px;font-weight:800;color:${COULEURS.texte};line-height:1.18;letter-spacing:-0.3px;word-break:break-word;overflow-wrap:anywhere;">` +
    `${echapper(b.titre).replace(/(\w)\.(?=\w)/g, '$1.<wbr>')}</div>`;
  const tete = surtitre + titre;
  return (
    `<tr><td data-accueil data-etat="${b.teinte}" style="` +
    (colore && teinte
      ? `background:${teinte.fond};border-top:1px solid ${teinte.bord};border-bottom:1px solid ${teinte.bord};padding:22px 24px 20px 24px;">`
      : 'padding:22px 24px 6px 24px;">') +
    (b.illustration ? titreIllustre(tete, b.illustration) : tete) +
    (b.texteHtml
      ? `<div style="font-family:${POLICE};font-size:16px;line-height:1.6;color:${COULEURS.texte};padding:16px 0 4px 0;">${b.texteHtml}</div>`
      : '') +
    (b.pastille ? `<div style="padding:10px 0 2px 0;">${pastille(b.pastille.libelle, b.pastille.teinte)}</div>` : '') +
    '</td></tr>'
  );
}

/** La devise du pied, à droite du logo. */
const DEVISE = 'Votre studio, à portée de main.';

/**
 * LE PIED DE LA CARTE : une bande gris pâle, le logo violet à gauche, la
 * devise à droite, et la ligne qui dit d'où vient le courriel en dessous.
 */
function piedDeCourriel(ligne?: string): string {
  return (
    `<tr><td data-pied style="background:${COULEURS.fondPied};border-radius:0 0 20px 20px;padding:20px 24px;font-family:${POLICE};">` +
    `<table ${TABLE} width="100%"><tr>` +
    `<td valign="middle" width="84" style="width:84px;">${logoHaiko('clair', 80)}</td>` +
    `<td align="right" valign="middle" style="font-family:${POLICE};font-size:12px;line-height:1.5;color:${COULEURS.attenue};">${DEVISE}</td>` +
    '</tr></table>' +
    (ligne ? `<div style="padding-top:12px;font-size:12px;line-height:1.5;color:${COULEURS.attenue};">${echapper(ligne)}</div>` : '') +
    '</td></tr>'
  );
}

/**
 * L'ENVELOPPE COMMUNE, d'après la maquette : UNE carte blanche arrondie de
 * 600 px au plus sur un fond gris pâle. En tête, le logo violet et un lien
 * discret « Mon espace → » ; puis l'accueil (surtitre, grand titre,
 * illustration), le corps, la formule de fin sous un trait, et la bande du
 * pied.
 *
 * L'APERÇU est la phrase que la messagerie montre sous l'objet, dans la liste :
 * cachée dans le corps, sans quoi elle y afficherait le début de l'en-tête.
 */
function enveloppe(options: {
  titre: string;
  apercu?: string;
  bandeau: BandeauDEtat;
  corps: string;
  fin?: string;
  pied?: string;
  lienEnTete?: { libelle: string; lien: string };
}): string {
  const apercu = options.apercu
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COULEURS.fond};opacity:0;">` +
      `${echapper(options.apercu)}</div>`
    : '';
  const droite = options.lienEnTete
    ? `<a data-lien-entete href="${echapper(options.lienEnTete.lien)}" style="font-family:${POLICE};font-size:13px;color:${COULEURS.attenue};text-decoration:none;">` +
      `${echapper(options.lienEnTete.libelle)}&nbsp;→</a>`
    : `<span style="font-family:${POLICE};font-size:13px;color:${COULEURS.attenue};">${echapper(options.titre)}</span>`;
  // Autant d'air au-dessus qu'au-dessous : le logo (sans marge transparente)
  // se centre dans la bande blanche, au lieu de paraître collé à l'accueil.
  const entete =
    `<tr><td data-entete style="padding:20px 24px 20px 24px;">` +
    `<table ${TABLE} width="100%"><tr>` +
    `<td valign="middle" width="100" style="width:100px;">${logoHaiko('clair', 96)}</td>` +
    `<td align="right" valign="middle">${droite}</td>` +
    '</tr></table></td></tr>';
  const fin = options.fin
    ? `<tr><td style="padding:10px 24px 30px 24px;">` +
      `<div style="border-top:1px solid ${COULEURS.trait};padding:22px 0 0 0;font-family:${POLICE};font-size:16px;line-height:1.6;color:${COULEURS.texte};" data-fin>` +
      `${options.fin}</div></td></tr>`
    : `<tr><td style="padding:0 0 22px 0;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${echapper(options.titre)}</title></head>` +
    `<body style="margin:0;padding:0;background:${COULEURS.fond};">` +
    apercu +
    `<table ${TABLE} width="100%" style="background:${COULEURS.fond};">` +
    '<tr><td align="center" style="padding:24px 10px 32px 10px;">' +
    `<table ${TABLE} width="${LARGEUR_COURRIEL}" data-carte-courriel style="width:100%;max-width:${LARGEUR_COURRIEL}px;` +
    `background:${COULEURS.carte};border:1px solid ${COULEURS.bordCarte};border-radius:20px;">` +
    entete +
    bandeauDEtat(options.bandeau) +
    `<tr><td data-corps align="left" style="padding:14px 24px 0 24px;">${options.corps}</td></tr>` +
    fin +
    piedDeCourriel(options.pied) +
    '</table></td></tr></table></body></html>'
  );
}

/**
 * LE COURRIEL D'UN CLIENT (ou du point de Haiko) : le surtitre et le grand
 * titre avec son illustration, la salutation et sa phrase qui résume, le corps,
 * puis la formule de fin sous un trait et le pied.
 */
export function documentDeCourriel(options: {
  /** Le titre du document, repris dans l'onglet et à droite de l'en-tête sans lien. */
  titre: string;
  apercu?: string;
  /** Le surtitre en capitales (« VOTRE SEMAINE »). */
  surtitre?: string;
  /** Le grand titre ; à défaut, la salutation en tient lieu. */
  grandTitre?: string;
  illustration?: Illustration;
  salutation: string;
  intro: string;
  corps: string;
  /** La formule de fin ; un retour à la ligne se garde. */
  fin: string;
  mention?: string;
  lienEnTete?: { libelle: string; lien: string };
}): string {
  const salutationAPart = Boolean(options.grandTitre);
  const intro = salutationAPart
    ? `${texteEnHtml(options.salutation)}<div style="padding-top:8px;">${texteEnHtml(options.intro)}</div>`
    : texteEnHtml(options.intro);
  return enveloppe({
    titre: options.titre,
    apercu: options.apercu,
    bandeau: {
      teinte: 'marque',
      ...(options.surtitre ? { surtitre: options.surtitre } : {}),
      titre: options.grandTitre ?? options.salutation,
      texteHtml: intro,
      ...(options.illustration ? { illustration: options.illustration } : {}),
    },
    corps: options.corps,
    fin: texteEnHtml(options.fin),
    pied: options.mention,
    ...(options.lienEnTete ? { lienEnTete: options.lienEnTete } : {}),
  });
}

/**
 * LE COURRIEL D'UN CONSTAT (la surveillance) : l'accueil teinté de l'état,
 * des blocs, et le pied qui dit qui surveille. Pas de salutation ni de
 * formule : c'est un constat, il va droit au fait.
 */
export function courrielEnBlocs(options: {
  titre: string;
  apercu?: string;
  bandeau: BandeauDEtat;
  blocs: readonly string[];
  pied?: string;
  lienEnTete?: { libelle: string; lien: string };
}): string {
  return enveloppe({
    titre: options.titre,
    apercu: options.apercu,
    bandeau: options.bandeau,
    corps: options.blocs.join(''),
    pied: options.pied,
    ...(options.lienEnTete ? { lienEnTete: options.lienEnTete } : {}),
  });
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

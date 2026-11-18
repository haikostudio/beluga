/**
 * UNE ÉTUDE DE SÉCURITÉ RÉDIGÉE DEVIENT UN RAPPORT DU SERVICE « SÉCURITÉ » (carte « Audits passés et synchro Beluga
 * Pass », 15/11/2026).
 *
 * Les études complètes (cartes « Étude de sécurité … ») sont rendues par un agent en markdown libre : aucune n'a la même
 * forme. On y retrouve pourtant toujours les mêmes repères, que cette règle sait lire :
 *
 *  - un titre de section ou une ligne en gras qui dit une GRAVITÉ (« ### Critique — titre », « ### Failles élevées »,
 *    « **Moyenne : titre** », « ### Gravité faible — titre », « **Critique** » seul…) ;
 *  - sous une gravité, chaque POINT : la section elle-même quand elle porte un titre et rien d'autre, sinon chaque
 *    paragraphe qui commence en gras (« **3. Titre** — … »), chaque `####`, chaque ligne de liste de premier niveau ;
 *  - dans un point, « Ce qui risque » et « Ce qu'on propose » (gras, italique, suivis de « : » ou de « . ») ;
 *  - la section « Ce qui a été vérifié » (liste « ✓ … » / « Non vérifié : … », ou tableau) : les ÉTAPES du rapport.
 *
 * Tout le reste (relevés écartés, « À décider », « Corrections à lancer », chiffrage final) est laissé de côté.
 *
 * L'EMPREINTE d'un point d'étude est `etude:<titre en lettres, sans aucun chiffre>` : stable d'une lecture à l'autre,
 * jamais un numéro (« 3. ») ni un compte (« 24 avis ») qui ferait naître de faux « Nouveau ».
 */
import type { ConstatSecurite, EtapeDuControle, GraviteSecurite, RapportDeSecurite } from './controle-securite.js';

/** La catégorie de tout point venu d'une étude rédigée : jamais confondue avec celles du contrôle automatique. */
export const CATEGORIE_ETUDE = 'etude' as const;

/** La gravité qu'annonce un texte de titre (« Failles critiques », « Gravité moyenne — … », « Élevée : … »), ou null. */
export function graviteAnnoncee(texte: string): GraviteSecurite | null {
  const t = sansMarques(texte).toLowerCase();
  // Le mot de gravité doit ouvrir le titre, ou suivre « failles / risques / gravité / points », ou le fermer.
  const m =
    /^(?:(?:failles?|risques?|points?|gravit[ée])\s+(?:de\s+gravit[ée]\s+)?)?(critiques?|[ée]lev[ée]e?s?|hautes?|moyennes?|faibles?)\b/.exec(t) ??
    /^(?:failles?|risques?|points?)\s+(critiques?|[ée]lev[ée]e?s?|moyennes?|faibles?)\s*$/.exec(t);
  if (!m) return null;
  const mot = m[1]!;
  if (mot.startsWith('critique')) return 'critique';
  if (/^[ée]lev/.test(mot) || mot.startsWith('haute')) return 'elevee';
  if (mot.startsWith('moyenne')) return 'moyenne';
  return 'faible';
}

/** Le titre d'un point sans ses marques : gras, italique, numéro, « — confirmé », point final. */
export function titreNettoye(brut: string): string {
  let t = sansMarques(brut).replace(/^\d+\s*[.)]\s*/, '').trim();
  t = t.replace(/\s+[—–-]\s+(confirm[ée]e?s?|\d+ relev[ée]s.*|relev[ée]s confirm[ée]s)\.?$/i, '');
  t = t.replace(/[.:;]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** L'identifiant stable d'un titre : ses lettres seules, en minuscules sans accent, sans aucun chiffre. */
export function identifiantDuTitre(titre: string): string {
  const s = titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 80).replace(/-+$/, '') || 'point';
}

function sansMarques(s: string): string {
  return s
    .replace(/^#+\s*/, '')
    .replace(/\*\*|__/g, '')
    .replace(/(^|\s)\*(\S)/g, '$1$2')
    .replace(/(\S)\*(\s|$)/g, '$1$2')
    .replace(/`/g, '')
    .trim();
}

/** Un titre de section qui sépare un groupe de gravité de son titre : « Critique — titre », « Élevée : titre ». */
function titreApresGravite(texte: string): string {
  const t = sansMarques(texte);
  const m = /^[^—–:]*?(?:critiques?|[ée]lev[ée]e?s?|hautes?|moyennes?|faibles?)(?:,[^—–:]*)?\s*[—–:]\s*(.+)$/i.exec(t);
  return m ? m[1]!.trim() : '';
}

/** Un titre qui ne nomme pas un point : « aucune confirmée », « points à planifier », « à savoir »… */
function titreDeGroupe(titre: string): boolean {
  return (
    !titre ||
    /^aucune?\s+(confirm|point|faille|risque|relev)/i.test(titre) ||
    /^(points?|failles?|risques?)\b.*(planifier|savoir|mineurs?|ouvertes?|confirm)/i.test(titre) ||
    /^[àa] savoir$/i.test(titre) ||
    /^les autres/i.test(titre) ||
    /\b(quatre|trois|deux|cinq|six|sept|huit|\d+)\s+(failles|points)\b/i.test(titre)
  );
}

const RE_RISQUE = /(?:\*\*|\*|_)?\s*Ce qui risque\s*(?:\*\*|\*|_)?\s*[:.]\s*(?:\*\*|\*|_)?\s*/i;
const RE_PROPOSE = /(?:\*\*|\*|_)?\s*Ce qu[’']on propose\s*(?:\*\*|\*|_)?\s*[:.]\s*(?:\*\*|\*|_)?\s*/i;
const RE_LIEU = /`([^`\s]+(?:\/[^`\s]*|\.[a-z]{1,5}(?::\d+)?))`/gi;

interface Brouillon {
  gravite: GraviteSecurite;
  titre: string;
  lignes: string[];
}

function texteSimple(lignes: readonly string[]): string {
  return lignes
    .map((l) => sansMarques(l.replace(/^\s*[-*]\s+/, '')))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coupe un texte trop long sur une fin de phrase (le rapport se lit dans un volet, pas comme un roman). */
function borne(texte: string, max = 900): string {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max);
  const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('.'));
  return (fin > max / 2 ? coupe.slice(0, fin + 1) : `${coupe.trimEnd()}…`).trim();
}

function constatDuBrouillon(b: Brouillon): ConstatSecurite {
  const corps = b.lignes.join('\n');
  const iR = corps.search(RE_RISQUE);
  const iP = corps.search(RE_PROPOSE);
  const morceau = (debut: number, re: RegExp, autres: number[]): string => {
    if (debut < 0) return '';
    const apres = corps.slice(debut).replace(re, '');
    const longueurEnTete = corps.slice(debut).length - apres.length;
    const fin = autres.filter((i) => i > debut).sort((a, b) => a - b)[0];
    const brut = fin !== undefined ? corps.slice(debut + longueurEnTete, fin) : apres;
    return texteSimple(brut.split('\n'));
  };
  let risque = morceau(iR, RE_RISQUE, [iP]);
  const proposition = morceau(iP, RE_PROPOSE, [iR]);
  // Sans « Ce qui risque » : le texte du point (avant la proposition) en tient lieu.
  if (!risque) {
    const avant = iP >= 0 ? corps.slice(0, iP) : corps;
    risque = texteSimple(avant.split('\n'));
  }
  const ou = [...new Set([...corps.matchAll(RE_LIEU)].map((m) => m[1]!))].slice(0, 8);
  return {
    id: identifiantDuTitre(b.titre),
    categorie: CATEGORIE_ETUDE as ConstatSecurite['categorie'],
    gravite: b.gravite,
    titre: b.titre,
    risque: borne(risque || b.titre),
    proposition: borne(proposition),
    ou,
  };
}

/** Les étapes de « Ce qui a été vérifié » : liste « ✓ … » / « Non vérifié : … », ou tableau « | sujet | ✓ | ». */
function etapesVerifiees(lignes: readonly string[]): EtapeDuControle[] {
  const etapes: EtapeDuControle[] = [];
  let nonVerifieEnCours = false;
  for (const brut of lignes) {
    const l = brut.trim();
    if (/^\|/.test(l)) {
      const cases = l.split('|').map((c) => sansMarques(c)).filter(Boolean);
      if (cases.length < 2 || /^-+$/.test(cases[0]!.replace(/[:\s]/g, '')) || /^sujet$/i.test(cases[0]!)) continue;
      const resultat = cases.slice(1).join(' — ');
      const fait = /✓|✔|oui|fait/i.test(resultat) && !/non v[ée]rifi/i.test(resultat);
      const note = resultat.replace(/^[✓✔]\s*(—\s*)?/, '').trim();
      etapes.push({ nom: cases[0]!, etat: fait ? 'fait' : 'non-verifie', ...(note ? { note } : {}) });
      continue;
    }
    // « **Non vérifié :** » seul sur sa ligne : la liste qui suit est non vérifiée.
    if (!/^[-*]\s+/.test(l) && /^(\*\*)?\s*non v[ée]rifi[ée]e?s?\s*:?\s*(\*\*)?\s*:?\s*$/i.test(l)) {
      nonVerifieEnCours = true;
      continue;
    }
    if (!/^[-*]\s+/.test(l) && !/^[✓✔✗✘]/.test(l)) {
      if (l) nonVerifieEnCours = false;
      continue;
    }
    let texte = sansMarques(l.replace(/^[-*]\s+/, ''));
    let etat: EtapeDuControle['etat'] = nonVerifieEnCours && !/^[✓✔]/.test(texte) ? 'non-verifie' : 'fait';
    if (/^(non v[ée]rifi[ée]e?s?|✗|✘|pas v[ée]rifi)/i.test(texte)) {
      etat = 'non-verifie';
      texte = texte.replace(/^(non v[ée]rifi[ée]e?s?|✗|✘|pas v[ée]rifi[ée]e?s?)\s*[:—–-]?\s*/i, '');
    }
    texte = texte.replace(/^[✓✔]\s*/, '').replace(/[;.]$/, '').trim();
    if (texte) etapes.push({ nom: borne(texte, 300), etat });
  }
  return etapes;
}

/**
 * LE RAPPORT D'UNE ÉTUDE RÉDIGÉE. Rend les points classés par la gravité annoncée, chacun avec « ce qui risque » et
 * « ce qu'on propose », et les étapes de « Ce qui a été vérifié ». Deux points au même titre ne font qu'une empreinte :
 * le second reçoit un suffixe en lettres (jamais un chiffre).
 */
export function rapportDepuisEtude(
  markdown: string,
  options: { projet: string; date: string; depotPublic?: boolean | null; adresse?: string },
): RapportDeSecurite {
  const lignes = markdown.replace(/\r\n/g, '\n').split('\n');
  const brouillons: Brouillon[] = [];
  const verifie: string[] = [];
  let gravite: GraviteSecurite | null = null;
  let courant: Brouillon | null = null;
  /** Le point que porte la section elle-même (« ### Critique — titre ») tant qu'aucun sous-point n'est apparu. */
  let pointDeSection: Brouillon | null = null;
  let dansVerifie = false;
  let dansCode = false;

  const clore = () => {
    courant = null;
  };
  const ouvrir = (titre: string) => {
    if (!gravite) return;
    const nettoye = titreNettoye(titre);
    if (!nettoye || titreDeGroupe(nettoye)) return;
    // Le point de section devient un simple groupe dès qu'un vrai sous-point apparaît… s'il n'avait rien d'autre.
    if (pointDeSection && !pointDeSection.lignes.some((l) => l.trim())) {
      brouillons.splice(brouillons.indexOf(pointDeSection), 1);
    }
    pointDeSection = null;
    courant = { gravite, titre: nettoye, lignes: [] };
    brouillons.push(courant);
  };

  for (const ligne of lignes) {
    if (/^\s*```/.test(ligne)) {
      dansCode = !dansCode;
      continue;
    }
    if (dansCode) continue;
    const titre = /^(#{1,4})\s+(.*)$/.exec(ligne);
    const grasSeul = /^\s*\*\*([^*]+)\*\*\s*$/.exec(ligne);
    // Un titre de section ### (ou ##) : change de gravité, ou sort des points.
    if (titre && titre[1]!.length <= 3) {
      clore();
      pointDeSection = null;
      const texte = titre[2]!;
      dansVerifie = /ce qui a [ée]t[ée] v[ée]rifi[ée]/i.test(texte);
      const g = graviteAnnoncee(texte);
      gravite = g;
      if (g) {
        const t = titreApresGravite(texte);
        if (t && !titreDeGroupe(titreNettoye(t))) {
          ouvrir(t);
          pointDeSection = courant;
        }
      }
      continue;
    }
    if (dansVerifie) {
      verifie.push(ligne);
      continue;
    }
    // Une ligne en gras seule qui annonce une gravité (« **Critique** », « **Élevée : titre** »).
    if (grasSeul && graviteAnnoncee(grasSeul[1]!)) {
      clore();
      pointDeSection = null;
      gravite = graviteAnnoncee(grasSeul[1]!);
      const t = titreApresGravite(grasSeul[1]!);
      if (t) ouvrir(t);
      continue;
    }
    if (!gravite) continue;
    // #### Titre : un point.
    if (titre) {
      ouvrir(titre[2]!);
      continue;
    }
    // Paragraphe ouvert par du gras (« **3. Titre** — … ») : un point, sauf « Ce qui risque » / « Ce qu'on propose ».
    const grasEnTete = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(ligne);
    if (grasEnTete && !RE_RISQUE.test(`**${grasEnTete[1]}**`) && !RE_PROPOSE.test(`**${grasEnTete[1]}**`) && !/^(ce qui a [ée]t[ée] constat[ée]|la cause|constat|confirm[ée]|[ée]cart[ée]|v[ée]rifi[ée]|non v[ée]rifi|hypoth[eè]se|en pratique|exemple|pourquoi|cause)/i.test(grasEnTete[1]!)) {
      ouvrir(grasEnTete[1]!);
      const reste = grasEnTete[2]!.replace(/^[—–:-]\s*/, '');
      if (courant && reste && !/^confirm[ée]/i.test(reste)) (courant as Brouillon).lignes.push(reste);
      continue;
    }
    // Ligne de liste de premier niveau : un point (son titre en gras, ou sa première phrase) — sauf sous un point
    // ouvert par un paragraphe, dont elle est le détail.
    const liste = /^[-*]\s+(.*)$/.exec(ligne);
    const sousUnParagraphe = courant !== null && (courant as Brouillon) !== pointDeSection && !(courant as Brouillon & { deListe?: boolean }).deListe;
    if (liste && !RE_RISQUE.test(liste[1]!.slice(0, 40)) && !RE_PROPOSE.test(liste[1]!.slice(0, 40)) && !sousUnParagraphe && !(pointDeSection && courant === pointDeSection)) {
      const item = liste[1]!;
      const gras = /^\*\*([^*]+)\*\*\s*[:.—–-]?\s*(.*)$/.exec(item);
      if (gras) {
        ouvrir(gras[1]!);
        if (courant && gras[2]) (courant as Brouillon).lignes.push(gras[2]);
      } else {
        const premiere = sansMarques(item).split(/(?<=[.!?])\s|\s:\s/)[0]!;
        ouvrir(premiere.length > 140 ? `${premiere.slice(0, 137).trimEnd()}…` : premiere);
        if (courant) (courant as Brouillon).lignes.push(item);
      }
      if (courant) (courant as Brouillon & { deListe?: boolean }).deListe = true;
      continue;
    }
    if (courant) (courant as Brouillon).lignes.push(ligne);
  }

  // Empreintes uniques : le second titre identique prend « -b », le troisième « -c »…
  const vus = new Map<string, number>();
  const constats = brouillons
    .filter((b) => b.titre)
    .map(constatDuBrouillon)
    .map((c) => {
      const n = vus.get(c.id) ?? 0;
      vus.set(c.id, n + 1);
      return n ? { ...c, id: `${c.id}-${String.fromCharCode(97 + Math.min(n, 25))}` } : c;
    });

  return {
    projet: options.projet,
    date: options.date,
    depotPublic: options.depotPublic ?? null,
    ...(options.adresse ? { adresse: options.adresse } : {}),
    constats,
    etapes: etapesVerifiees(verifie),
  };
}

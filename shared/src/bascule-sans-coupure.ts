/**
 * BASCULER UN SITE SANS COUPURE — LA FAÇADE RETIENT, ELLE NE REFUSE PLUS.
 *
 * Mettre une version en ligne finit toujours par le même geste : le programme
 * qui sert le site s'arrête, et un autre reprend sa place. Entre les deux, le
 * port n'écoute plus. Mesuré sur ce serveur le 21.09.2026 : de 0,9 s (un site
 * statique) à 6,4 s (une application Node qui relit sa base au démarrage). Une
 * visite qui tombe dans cette fenêtre ne reçoit pas une page lente — elle
 * reçoit une ERREUR 502, et c'est ce que voit le client.
 *
 * On ne supprime pas la fenêtre, on la REND INVISIBLE. La façade (Caddy) sait
 * GARDER une requête dont le destinataire ne répond pas encore et la rejouer
 * jusqu'à ce qu'il réponde. Trois réglages, sur chaque site :
 *
 *   · `lb_try_duration` — combien de temps on garde la requête en main ;
 *   · `lb_try_interval` — à quelle cadence on retente ;
 *   · `fail_duration 0` — on ne met JAMAIS le site « hors service » après un
 *     échec : avec un seul destinataire, le marquer mort transforme une
 *     seconde de redémarrage en trente secondes d'erreurs.
 *
 * CE QUE ÇA NE FAIT PAS. Ce n'est pas un doublon du site sur un second port :
 * une requête DÉJÀ partie vers l'ancien programme au moment où il s'arrête est
 * perdue comme avant — la façade ne rejoue que ce qu'elle n'a pas pu remettre.
 * Ce n'est pas non plus une rustine à un démarrage qui échoue : passé le délai
 * de retenue, l'erreur ressort, et elle se voit.
 *
 * CE FICHIER NE DÉCIDE QUE DU TEXTE. Ni disque, ni commande, ni rechargement :
 * `scripts/facade-sans-coupure.mjs` porte les gestes, et se contente d'appeler
 * ce qui suit.
 */

/** Combien de temps la façade garde une requête dont le site ne répond pas. */
export const RETENUE_MS = 30_000;
/** À quelle cadence elle retente, tant qu'elle la garde. */
export const CADENCE_MS = 250;

/**
 * LES TROIS LIGNES, DANS L'ORDRE OÙ ELLES S'ÉCRIVENT.
 *
 * Elles vivent DANS le bloc du destinataire (`reverse_proxy … { … }`) et
 * nulle part ailleurs : hors de ce bloc, la façade ne les comprend pas.
 */
export function lignesDeRetenue(): string[] {
  return [
    `lb_try_duration ${Math.round(RETENUE_MS / 1000)}s`,
    `lb_try_interval ${CADENCE_MS}ms`,
    'fail_duration 0',
  ];
}

/** Le nom des trois réglages, pour reconnaître ceux qui sont déjà posés. */
const NOMS = ['lb_try_duration', 'lb_try_interval', 'fail_duration'];

/** Ce qu'on a trouvé, et ce qu'on a changé, dans un fichier de façade. */
export interface BilanDeRetenue {
  /** Le texte réécrit. Identique à l'entrée quand il n'y avait rien à faire. */
  texte: string;
  /** Les sites où la retenue vient d'être posée. */
  poses: string[];
  /** Les sites qui l'avaient déjà : on ne les touche pas deux fois. */
  dejaPoses: string[];
}

/** Est-ce une ligne qui ouvre un destinataire ? Rend son indentation. */
function ouvertureDeDestinataire(ligne: string): { indent: string; cible: string; bloc: boolean } | null {
  const m = /^(\s*)reverse_proxy\s+(.*?)\s*(\{)?\s*$/.exec(ligne);
  if (!m) return null;
  const reste = m[2] ?? '';
  /* Un destinataire sans cible (`reverse_proxy {`) déclare la sienne dans le
     bloc : on le traite quand même, la retenue s'y pose pareil. */
  return { indent: m[1] ?? '', cible: reste.trim(), bloc: m[3] === '{' };
}

/**
 * POSER LA RETENUE SUR CHAQUE SITE D'UN FICHIER DE FAÇADE.
 *
 * On lit ligne à ligne, en comptant les accolades : un destinataire qui porte
 * déjà un de ces trois réglages est laissé TEL QUEL — la main de quelqu'un
 * passe avant la nôtre. Un destinataire écrit sans bloc en reçoit un.
 */
export function poserLaRetenue(texte: string): BilanDeRetenue {
  const lignes = (texte ?? '').split('\n');
  const sortie: string[] = [];
  const poses: string[] = [];
  const dejaPoses: string[] = [];

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    const ouverture = ouvertureDeDestinataire(ligne);
    if (!ouverture) {
      sortie.push(ligne);
      continue;
    }
    const nom = ouverture.cible || '(destinataire du bloc)';

    if (!ouverture.bloc) {
      /* `reverse_proxy 127.0.0.1:14999` — une ligne nue : on lui ouvre un bloc. */
      sortie.push(`${ouverture.indent}reverse_proxy ${ouverture.cible} {`);
      for (const l of lignesDeRetenue()) sortie.push(`${ouverture.indent}\t${l}`);
      sortie.push(`${ouverture.indent}}`);
      poses.push(nom);
      continue;
    }

    /* Un bloc : on le recopie jusqu'à son accolade fermante, en comptant. */
    const corps: string[] = [];
    let profondeur = 1;
    let j = i + 1;
    for (; j < lignes.length && profondeur > 0; j++) {
      const courante = lignes[j];
      for (const c of courante) {
        if (c === '{') profondeur++;
        else if (c === '}') profondeur--;
      }
      if (profondeur === 0) break;
      corps.push(courante);
    }
    const deja = corps.some((l) => NOMS.some((n) => new RegExp(`^\\s*${n}\\b`).test(l)));
    sortie.push(ligne, ...corps);
    if (deja) {
      dejaPoses.push(nom);
    } else {
      for (const l of lignesDeRetenue()) sortie.push(`${ouverture.indent}\t${l}`);
      poses.push(nom);
    }
    /* La fermante du bloc, telle qu'elle était écrite. */
    if (j < lignes.length) sortie.push(lignes[j]);
    i = j;
  }

  return { texte: sortie.join('\n'), poses, dejaPoses };
}

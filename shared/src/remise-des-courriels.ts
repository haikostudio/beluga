/**
 * L'ENVOI DIRECT DES COURRIELS — les règles pures : ce que dit vraiment un
 * courriel d'essai, et ce dont un domaine a besoin pour que les courriels de ce
 * serveur soient acceptés.
 *
 * LE DÉFAUT D'ORIGINE. En mode « par ce serveur », l'agent d'envoi local
 * (postfix) rend la main dès qu'il a MIS LE MESSAGE EN FILE : l'essai disait
 * « remis », alors que la boîte du destinataire pouvait le refuser une seconde
 * plus tard — ce qu'elle fait d'un serveur neuf que son domaine n'autorise pas
 * (SPF), qui ne signe pas (DKIM) ou dont l'adresse n'a pas de nom inverse.
 * L'essai SUIT donc le message jusqu'à la réponse de la boîte de destination
 * (`issueDeLEssai`), et l'écran montre, avant l'essai, ce que le domaine doit
 * porter (`enregistrementsAttendus`, `verdictDesControles`).
 *
 * Rien ici ne lit le journal, le DNS ni le disque : le démon lit, ces règles jugent.
 */

/* ------------------------------------------------------------------ */
/* Le suivi d'un courriel d'essai                                      */
/* ------------------------------------------------------------------ */

/** Ce que le journal de l'agent d'envoi dit d'un message, ligne par ligne. */
export interface RemiseLue {
  /** Le dernier état connu : `sent` (remis), `bounced` (refusé), `deferred` (reporté), `expired` (abandonné). */
  statut: 'sent' | 'bounced' | 'deferred' | 'expired' | null;
  /** Le serveur qui a répondu (« gmail-smtp-in.l.google.com[142.250.0.26]:25 »). */
  relais?: string;
  /** Le code de remise (« 2.0.0 », « 5.7.26 »). */
  dsn?: string;
  /** Ce que le serveur distant a répondu, tel quel (sans les parenthèses). */
  reponse?: string;
}

/**
 * LES LIGNES DU JOURNAL QUI PARLENT DE CE MESSAGE. On part de son entête
 * `Message-ID` (posé par le démon, unique) : la ligne du nettoyeur le relie à
 * l'identifiant de file (`4AbC12: message-id=<…>`), puis chaque ligne de
 * remise de cet identifiant dit un état. La DERNIÈRE ligne qui porte un état
 * fait foi : un report suivi d'une remise est une remise.
 */
export function remiseLueDansLeJournal(journal: string, messageId: string): RemiseLue {
  const id = messageId.replace(/^<|>$/g, '');
  const lignes = (journal ?? '').split('\n');
  const files = new Set<string>();
  for (const ligne of lignes) {
    const lu = /\b([0-9A-Za-z]{6,}):\s+message-id=<([^>]+)>/.exec(ligne);
    if (lu && lu[2] === id) files.add(lu[1]!);
  }
  let remise: RemiseLue = { statut: null };
  if (!files.size) return remise;
  for (const ligne of lignes) {
    const file = /\b([0-9A-Za-z]{6,}):\s/.exec(ligne)?.[1];
    if (!file || !files.has(file)) continue;
    const statut = /\bstatus=(sent|bounced|deferred|expired)\b/.exec(ligne)?.[1] as RemiseLue['statut'] | undefined;
    if (!statut) continue;
    remise = {
      statut,
      relais: /\brelay=([^,\s]+)/.exec(ligne)?.[1],
      dsn: /\bdsn=([0-9.]+)/.exec(ligne)?.[1],
      reponse: /\bstatus=\w+\s+\((.*)\)\s*$/.exec(ligne)?.[1]?.trim(),
    };
  }
  return remise;
}

/** L'issue d'un essai, telle que l'écran l'affiche. */
export interface IssueDeLEssai {
  /**
   * `arrive` : la boîte du destinataire l'a accepté ;
   * `accepte` : un service extérieur l'a pris en charge, la suite ne se voit pas d'ici ;
   * `refuse` : refusé, avec la raison ; `attente` : encore en route ;
   * `inconnu` : rien n'a pu être lu — et ce n'est PAS un succès.
   */
  issue: 'arrive' | 'accepte' | 'refuse' | 'attente' | 'inconnu';
  ok: boolean;
  texte: string;
}

/**
 * LA RAISON D'UN REFUS, EN MOTS COURANTS, et ce qu'il faut corriger. Les
 * grandes messageries disent toutes à peu près la même chose : domaine qui
 * n'autorise pas ce serveur, absence de signature, adresse sans nom inverse,
 * adresse sur une liste de bloqués.
 */
export function raisonDuRefusDeRemise(reponse: string, dsn = ''): string {
  const texte = `${dsn} ${reponse}`.toLowerCase();
  if (/ptr|reverse dns|rdns|reverse lookup|hostname.*does not|5\.7\.25/.test(texte)) {
    return 'l’adresse de ce serveur n’a pas de nom inverse (PTR) correct : posez-le chez votre hébergeur, au nom de ce serveur';
  }
  if (/spamhaus|blocklist|blacklist|block list|listed|rbl|dnsbl|poor reputation|5\.7\.1.*ip/.test(texte)) {
    return 'l’adresse de ce serveur est sur une liste de bloqués : passez par un service de courriel';
  }
  if (/spf|dkim|dmarc|unauthenticated|not authenticated|authentication|5\.7\.26|5\.7\.27|5\.7\.23/.test(texte)) {
    return 'le domaine de l’adresse d’expédition n’autorise pas encore ce serveur : posez les réglages du domaine indiqués plus haut (SPF, DKIM, DMARC)';
  }
  if (/user unknown|no such user|does not exist|unknown user|mailbox unavailable|5\.1\.1/.test(texte)) {
    return 'cette adresse n’existe pas chez son fournisseur';
  }
  if (/connection timed out|connection refused|network is unreachable|port 25/.test(texte)) {
    return 'ce serveur n’arrive pas à joindre la messagerie du destinataire : votre hébergeur bloque sans doute l’envoi direct (port 25)';
  }
  return reponse ? `réponse de la messagerie du destinataire : « ${reponse.slice(0, 220)} »` : 'la messagerie du destinataire n’a pas donné de raison';
}

/** Le domaine d'une adresse (« bonjour@exemple.com » → « exemple.com »). */
export function domaineDeLAdresse(adresse: string): string {
  return (/@([^\s@<>]+)>?\s*$/.exec(adresse.trim())?.[1] ?? '').toLowerCase();
}

/**
 * CE QUE L'ESSAI DIT, SELON CE QUI A ÉTÉ CONSTATÉ — jamais plus.
 *  - par ce serveur : l'état lu dans le journal de l'agent d'envoi ;
 *  - par Resend : le dernier événement que Resend rend pour ce message ;
 *  - par un service SMTP : l'acceptation seule, car rien d'autre ne se voit d'ici.
 */
export function issueDeLEssai(
  entree:
    | { mode: 'serveur'; destinataire: string; remise: RemiseLue | null }
    | { mode: 'resend'; destinataire: string; evenement: string | null }
    | { mode: 'smtp'; destinataire: string; hote: string },
): IssueDeLEssai {
  const domaine = domaineDeLAdresse(entree.destinataire) || entree.destinataire;
  const arrive: IssueDeLEssai = {
    issue: 'arrive',
    ok: true,
    texte: `Courriel accepté par la messagerie de ${domaine} : il est arrivé. S’il n’est pas dans la boîte de réception, regardez dans le courrier indésirable.`,
  };
  if (entree.mode === 'smtp') {
    return {
      issue: 'accepte',
      ok: true,
      texte: `Courriel accepté par votre service de courriel (${entree.hote}). La suite dépend de lui : regardez votre boîte, courrier indésirable compris.`,
    };
  }
  if (entree.mode === 'resend') {
    const evenement = (entree.evenement ?? '').toLowerCase();
    if (evenement === 'delivered') return arrive;
    if (evenement === 'bounced' || evenement === 'failed')
      return { issue: 'refuse', ok: false, texte: `Courriel refusé par la messagerie de ${domaine} : vérifiez l’adresse, et le domaine d’expédition chez Resend.` };
    if (evenement === 'complained')
      return { issue: 'arrive', ok: true, texte: `Courriel arrivé chez ${domaine}, mais marqué comme indésirable par le destinataire.` };
    if (evenement === 'delivery_delayed')
      return { issue: 'attente', ok: false, texte: `Courriel retardé : la messagerie de ${domaine} ne l’a pas encore accepté. Resend réessaie de lui-même.` };
    if (evenement)
      return { issue: 'attente', ok: false, texte: `Courriel pris en charge par Resend, pas encore remis à ${domaine} (dernier état : ${evenement}). Regardez votre boîte dans quelques minutes.` };
    return { issue: 'inconnu', ok: false, texte: 'Resend a pris le courriel, mais n’a pas dit s’il est arrivé : regardez votre boîte.' };
  }
  const remise = entree.remise;
  if (!remise) {
    return {
      issue: 'inconnu',
      ok: false,
      texte: 'Le courriel a été confié à l’agent d’envoi de ce serveur, mais son journal n’a pas pu être lu : impossible de dire s’il est arrivé.',
    };
  }
  if (remise.statut === 'sent') return arrive;
  if (remise.statut === 'bounced' || remise.statut === 'expired') {
    return { issue: 'refuse', ok: false, texte: `Courriel refusé par la messagerie de ${domaine} : ${raisonDuRefusDeRemise(remise.reponse ?? '', remise.dsn)}.` };
  }
  if (remise.statut === 'deferred') {
    return {
      issue: 'attente',
      ok: false,
      texte: `Courriel pas encore remis : ${raisonDuRefusDeRemise(remise.reponse ?? '', remise.dsn)}. L’agent d’envoi réessaiera de lui-même.`,
    };
  }
  return {
    issue: 'attente',
    ok: false,
    texte: `Courriel en file d’attente sur ce serveur : la messagerie de ${domaine} n’a pas encore répondu. Refaites l’essai dans quelques minutes si rien n’arrive.`,
  };
}

/* ------------------------------------------------------------------ */
/* Ce que le domaine doit porter                                        */
/* ------------------------------------------------------------------ */

/** Le sélecteur de la signature posée par Beluga Build : le nom sous lequel sa clé publique se publie. */
export const SELECTEUR_DKIM = 'beluga';

/** Le dossier des clés de signature sur le serveur, un sous-dossier par domaine. */
export const DOSSIER_DES_CLES_DKIM = '/etc/opendkim/keys';

/** Un enregistrement TXT attendu dans le domaine de l'expéditeur. */
export interface EnregistrementAttendu {
  genre: 'spf' | 'dkim' | 'dmarc';
  /** Le nom RELATIF au domaine (« @ » pour le domaine lui-même). */
  nom: string;
  /** Le nom complet (« beluga._domainkey.exemple.com »). */
  nomComplet: string;
  /** La valeur à poser. */
  valeur: string;
}

/** Un TXT tel qu'un fournisseur ou un résolveur le rend : guillemets retirés, morceaux recollés. */
export function texteDuTxt(brut: string): string {
  const morceaux = [...brut.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
  return morceaux.length ? morceaux.join('') : brut.trim();
}

/** Un TXT écrit pour un fournisseur qui veut des guillemets : par morceaux de 255 signes au plus. */
export function txtEntreGuillemets(valeur: string): string {
  const morceaux: string[] = [];
  for (let i = 0; i < valeur.length; i += 255) morceaux.push(valeur.slice(i, i + 255));
  return morceaux.map((morceau) => `"${morceau.replace(/(["\\])/g, '\\$1')}"`).join(' ');
}

/**
 * LE SPF FUSIONNÉ : l'adresse de ce serveur ajoutée à celui qui existe, sans
 * rien retirer. Un domaine ne doit porter qu'UN SPF (deux SPF = aucun SPF
 * valable) : on ne crée jamais un second enregistrement à côté du premier.
 * `null` : l'adresse y est déjà (directement), rien à changer.
 */
export function spfFusionne(existant: string | null, ip: string): string | null {
  const mecanisme = ip.includes(':') ? `ip6:${ip}` : `ip4:${ip}`;
  if (!existant) return `v=spf1 ${mecanisme} ~all`;
  const termes = existant.trim().split(/\s+/);
  if (termes.some((terme) => terme.replace(/^\+/, '') === mecanisme)) return null;
  const fin = termes.findIndex((terme) => /^[~?+-]?all$/i.test(terme) || /^redirect=/i.test(terme));
  if (fin === -1) return [...termes, mecanisme].join(' ');
  return [...termes.slice(0, fin), mecanisme, ...termes.slice(fin)].join(' ');
}

/** Le SPF parmi les TXT d'un nom — le premier « v=spf1 ». */
export function spfParmi(txts: readonly string[]): string | null {
  return txts.map(texteDuTxt).find((txt) => /^v=spf1(\s|$)/i.test(txt)) ?? null;
}

/**
 * LES TXT D'UN NOM APRÈS LA FUSION DU SPF : tous les autres (vérification de
 * site, autres services) restent tels quels, le SPF est remplacé par sa forme
 * fusionnée. `null` : rien à écrire.
 */
export function txtsAvecSpf(txts: readonly string[], ip: string): string[] | null {
  const lus = txts.map(texteDuTxt);
  const spf = spfParmi(lus);
  const fusionne = spfFusionne(spf, ip);
  if (!fusionne) return null;
  const autres = lus.filter((txt) => !/^v=spf1(\s|$)/i.test(txt));
  return [...autres, fusionne];
}

/** Le TXT de la clé publique DKIM, à partir du fichier que `opendkim-genkey` écrit (`beluga.txt`). */
export function dkimDepuisLeFichier(fichier: string): string | null {
  const morceaux = [...(fichier ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
  const valeur = morceaux.replace(/\s+/g, ' ').trim();
  return /\bp=[A-Za-z0-9+/=]{40,}/.test(valeur) ? valeur : null;
}

/** La clé publique d'un TXT DKIM (« p=… »), pour comparer ce qui est publié à ce qui signe. */
export function clePubliqueDkim(txt: string | null | undefined): string | null {
  return /\bp=([A-Za-z0-9+/=]+)/.exec((txt ?? '').replace(/\s+/g, ''))?.[1] ?? null;
}

/** Les trois enregistrements que le domaine de l'expéditeur doit porter pour ce serveur. */
export function enregistrementsAttendus(entree: {
  domaine: string;
  ip: string;
  spfExistant: string | null;
  dkimLocal: string | null;
  dmarcExistant: string | null;
}): EnregistrementAttendu[] {
  const { domaine } = entree;
  const attendus: EnregistrementAttendu[] = [];
  const spf = spfFusionne(entree.spfExistant, entree.ip);
  attendus.push({ genre: 'spf', nom: '@', nomComplet: domaine, valeur: spf ?? entree.spfExistant ?? '' });
  if (entree.dkimLocal) {
    attendus.push({
      genre: 'dkim',
      nom: `${SELECTEUR_DKIM}._domainkey`,
      nomComplet: `${SELECTEUR_DKIM}._domainkey.${domaine}`,
      valeur: entree.dkimLocal,
    });
  }
  attendus.push({
    genre: 'dmarc',
    nom: '_dmarc',
    nomComplet: `_dmarc.${domaine}`,
    valeur: entree.dmarcExistant ?? `v=DMARC1; p=none; rua=mailto:postmaster@${domaine}`,
  });
  return attendus;
}

/* ------------------------------------------------------------------ */
/* Les contrôles d'avant l'essai                                        */
/* ------------------------------------------------------------------ */

/** Ce que le démon a constaté sur la machine et dans le DNS. */
export interface ConstatDeLEnvoiDirect {
  agent: boolean;
  port25: boolean;
  /** Le domaine de l'adresse d'expédition ; vide s'il n'est pas réglé. */
  domaine: string;
  ip: string;
  spf: string | null;
  /** La clé publique que la signature locale utilise ; `null` sans signature installée. */
  dkimLocal: string | null;
  /** Le TXT DKIM publié sous le sélecteur de Beluga. */
  dkimPublie: string | null;
  dmarc: string | null;
  /** Le nom inverse de l'adresse du serveur. */
  ptr: string | null;
  /** Ce nom inverse mène-t-il bien à l'adresse ? */
  ptrMeneIci: boolean;
}

/** Un point de la liste d'avant l'essai. */
export interface PointDeControle {
  id: 'agent' | 'port25' | 'spf' | 'dkim' | 'dmarc' | 'ptr';
  ok: boolean;
  /** Ce qui manque, en une phrase ; vide quand le point est vert. */
  manque: string;
}

/** Le SPF autorise-t-il cette adresse, directement ? (Un `include:` de tiers ne la couvre pas.) */
export function spfAutorise(spf: string | null, ip: string): boolean {
  if (!spf) return false;
  return spfFusionne(spf, ip) === null;
}

/** LA LISTE D'AVANT L'ESSAI : chaque point, vert ou avec ce qui lui manque. */
export function verdictDesControles(constat: ConstatDeLEnvoiDirect): PointDeControle[] {
  const point = (id: PointDeControle['id'], ok: boolean, manque: string): PointDeControle => ({ id, ok, manque: ok ? '' : manque });
  const local = clePubliqueDkim(constat.dkimLocal);
  return [
    point('agent', constat.agent, 'Aucun agent d’envoi n’est installé sur ce serveur.'),
    point('port25', constat.port25, 'Votre hébergeur bloque la sortie des courriels (port 25).'),
    point(
      'spf',
      Boolean(constat.domaine) && spfAutorise(constat.spf, constat.ip),
      constat.domaine ? `Le domaine ${constat.domaine} n’autorise pas encore ce serveur (SPF).` : 'L’adresse d’expédition n’est pas réglée.',
    ),
    point(
      'dkim',
      Boolean(local) && clePubliqueDkim(constat.dkimPublie) === local,
      !local
        ? 'La signature des courriels n’est pas installée sur ce serveur.'
        : constat.dkimPublie
          ? 'La clé publiée dans le domaine ne correspond pas à celle de ce serveur (DKIM).'
          : 'La clé de signature n’est pas encore publiée dans le domaine (DKIM).',
    ),
    point('dmarc', Boolean(constat.dmarc && /^v=DMARC1/i.test(constat.dmarc)), 'Le domaine n’a pas de règle DMARC.'),
    point(
      'ptr',
      Boolean(constat.ptr) && constat.ptrMeneIci,
      constat.ptr
        ? `Le nom inverse de l’adresse ${constat.ip} (${constat.ptr}) ne mène pas à ce serveur.`
        : `L’adresse ${constat.ip || 'de ce serveur'} n’a pas de nom inverse (PTR) : posez-le chez votre hébergeur.`,
    ),
  ];
}

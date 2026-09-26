/**
 * UN MONTAGE MORT SE REMONTE AVANT D'ÊTRE DÉCLARÉ INJOIGNABLE.
 *
 * Les dossiers des projets ne sont pas sur le disque local : chaque
 * `/root/<projet>` est un montage « bind » vers `/mnt/sauvegardes/Beluga/
 * <projet>`, lui-même monté en sshfs sur un stockage distant. Quand la
 * connexion distante tombe puis revient, le montage distant se répare tout seul
 * (option `reconnect`) — mais les « bind » posés dessus restent accrochés à
 * l'ANCIENNE connexion, morte. Le dossier répond alors « Transport endpoint is
 * not connected », git échoue, et le lancement de TOUTE carte est refusé.
 *
 * Constat qui a produit ce fichier : le 02/09/2026, dix-huit dossiers de projet
 * sur dix-neuf étaient dans cet état d'un seul coup. Plus aucune carte ne
 * partait, sur aucun projet, jusqu'à ce qu'une main remonte les binds. Le
 * refus était juste — il nommait bien la panne — mais il attendait un humain
 * pour une réparation entièrement mécanique.
 *
 * Ce module ne touche ni au disque ni aux commandes : il DÉCIDE seulement quoi
 * remonter et dans quel ordre. Le démon exécute le plan, puis retente — comme
 * il le fait déjà pour la « dubious ownership » de git.
 */

/** Un point de montage déclaré dans `/etc/fstab`. */
export interface MontageDeclare {
  /** Là où il est rattaché : `/root/projetc`. */
  point: string;
  /** Ce qu'il rattache : `/mnt/sauvegardes/Beluga/projetc`. */
  source: string;
  /** Un « bind » relaie un autre montage ; sinon c'est le montage porteur. */
  bind: boolean;
}

/** Une commande du plan de remontage, prête à être jouée par le démon. */
export interface EtapeDeRemontage {
  commande: string;
  arguments: string[];
  /**
   * Un détachement qui échoue n'arrête rien : le point était peut-être déjà
   * libre. Un montage qui échoue, lui, condamne le plan.
   */
  tolereLEchec: boolean;
  /** Ce qui s'écrit dans le journal quand l'étape passe. */
  intention: string;
}

/**
 * Un chemin comparable : sans barre finale ni espaces. La RACINE fait
 * exception — la dépouiller de sa barre la ferait disparaître entièrement.
 */
function propre(chemin: string | undefined | null): string {
  const brut = (chemin ?? '').trim();
  const sansBarre = brut.replace(/\/+$/, '');
  return sansBarre || (brut.startsWith('/') ? '/' : '');
}

/**
 * LES MONTAGES DÉCLARÉS, LUS DANS LE TEXTE DE `/etc/fstab`.
 *
 * Une seule lecture pour tout le monde : le script de contrôle et le démon
 * lisaient chacun ce fichier à leur façon, et seul le script savait reconnaître
 * un « bind ». Les lignes vides et les commentaires sont écartés ; une ligne
 * trop courte pour porter ses quatre champs est ignorée plutôt que devinée.
 */
export function montagesDeclares(fstab: string): MontageDeclare[] {
  return (fstab ?? '')
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0 && !ligne.startsWith('#'))
    .map((ligne) => ligne.split(/\s+/))
    .filter((champs) => champs.length >= 4 && propre(champs[1]).startsWith('/'))
    .map((champs) => ({
      source: champs[0],
      point: propre(champs[1]),
      bind: /(^|,)bind(,|$)/.test(champs[3]),
    }));
}

/**
 * QUEL MONTAGE PORTE CE DOSSIER ?
 *
 * Le dossier cherché n'est pas toujours le point lui-même : la copie de travail
 * d'une carte vit SOUS le dossier du projet (`/root/projetc/.worktrees/…`). On
 * retient donc le point déclaré le plus PROFOND qui contient le chemin.
 *
 * LA RACINE N'EST JAMAIS UN PORTEUR. Elle contient tout, donc elle gagnerait
 * chaque fois qu'aucun montage précis ne couvre le chemin — et le plan
 * proposerait alors de détacher puis de remonter le système de fichiers entier
 * pour réparer un dossier de projet. Un chemin que rien d'autre ne porte ne se
 * remonte pas : il se refuse.
 */
export function pointDeMontagePorteur(
  dossier: string,
  montages: MontageDeclare[],
): MontageDeclare | undefined {
  const cible = propre(dossier);
  if (!cible) return undefined;
  let retenu: MontageDeclare | undefined;
  for (const montage of montages ?? []) {
    const point = propre(montage.point);
    if (!point || point === '/') continue;
    if (cible !== point && !cible.startsWith(`${point}/`)) continue;
    if (!retenu || point.length > propre(retenu.point).length) retenu = montage;
  }
  return retenu;
}

/**
 * LE PLAN DE REMONTAGE D'UN DOSSIER MORT, DU MOINS CHER AU PLUS LOURD.
 *
 * Le « bind » seul suffit dans le cas courant : le montage distant, lui, se
 * répare tout seul. On ne le rouvre donc QUE si l'appelant a constaté qu'il ne
 * répondait plus lui non plus — le remonter pour rien détacherait d'un coup les
 * dix-neuf projets, y compris ceux qui allaient bien.
 *
 * Un dossier qu'aucun montage déclaré ne porte rend un plan VIDE : il n'y a
 * rien à remonter, et le refus doit alors être servi tel quel.
 */
export function planDeRemontage(
  dossier: string,
  montages: MontageDeclare[],
  options?: { porteurInjoignable?: boolean },
): EtapeDeRemontage[] {
  const porteur = pointDeMontagePorteur(dossier, montages);
  if (!porteur) return [];

  const etapes: EtapeDeRemontage[] = [];

  const remonter = (point: string, quoi: string) => {
    etapes.push({
      commande: 'sudo',
      arguments: ['-n', 'umount', '-l', point],
      tolereLEchec: true,
      intention: `détacher ${quoi} mort (${point})`,
    });
    etapes.push({
      commande: 'sudo',
      arguments: ['-n', 'mount', point],
      tolereLEchec: false,
      intention: `remonter ${quoi} (${point})`,
    });
  };

  /*
   * Le montage porteur d'abord, sinon le « bind » se raccrocherait à la même
   * connexion morte et le plan tournerait à vide.
   */
  if (options?.porteurInjoignable && porteur.bind) {
    const parent = pointDeMontagePorteur(
      porteur.source,
      (montages ?? []).filter((m) => !m.bind),
    );
    if (parent) remonter(parent.point, 'le montage distant');
  }

  remonter(porteur.point, porteur.bind ? 'le dossier du projet' : 'le montage');
  return etapes;
}

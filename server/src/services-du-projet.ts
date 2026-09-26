/**
 * LES SERVICES ET LES PORTS D'UN PROJET SUR CE SERVEUR — constatés, jamais
 * réglés. Extrait de l'ancien moteur de publication lors de la refonte du
 * 22/09/2026 : ces lectures servent au port des projets, aux dépôts, et à
 * PRÉ-REMPLIR le réglage « service » du déploiement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { lancerCommandeBornee } from './commande-bornee.js';

function runCommand(cwd: string, command: string, timeout = 20_000, signesGardes = 3000) {
  return lancerCommandeBornee(cwd, command, { timeout, signesGardes });
}

/** systemctl, et `sudo -n` quand le compte n'a pas les droits. */
async function systemctlRoot(_cwd: string, args: string, timeout = 60000) {
  const direct = await runCommand('/', `systemctl ${args}`, timeout);
  if (direct.ok || !/authentication required|access denied|permission denied|interactive/i.test(direct.out)) return direct;
  return runCommand('/', `sudo -n systemctl ${args}`, timeout);
}

/**
 * Le service système qui fait tourner un projet, reconnu à SON DOSSIER de
 * travail. Sans ce redémarrage, publier ne faisait que pousser le code sur le
 * dépôt : le serveur continuait de servir la version chargée à son lancement,
 * et rien ne changeait à l'écran (rencontré le 03/08/2026).
 */
export function serviceDuProjet(cheminProjet: string): string | null {
  const dossier = '/etc/systemd/system';
  let fichiers: string[];
  try {
    fichiers = fs.readdirSync(dossier).filter((nom) => nom.endsWith('.service'));
  } catch {
    return null;
  }
  const vise = path.resolve(cheminProjet);
  // Beaucoup de services tournent dans un SOUS-DOSSIER du projet (`web/`,
  // `server/`…) : les ignorer faisait conclure « aucun moyen de mettre en
  // ligne » sur des projets qui tournent pourtant. L'unité exacte reste
  // prioritaire, le sous-dossier ne sert que de repli.
  let repli: string | null = null;
  for (const fichier of fichiers) {
    try {
      const texte = fs.readFileSync(path.join(dossier, fichier), 'utf8');
      const ligne = texte.match(/^WorkingDirectory=(.+)$/m);
      if (!ligne) continue;
      /*
       * UN « ONESHOT » N'EST PAS LE SERVEUR DU PROJET. Un travail ponctuel qui
       * tourne dans le même dossier (la démo que le minuteur de nuit
       * reconstruit, par exemple) était pris pour le service à relancer : la
       * publication relançait la reconstruction au lieu du site, puis lisait
       * « inactive » — l'état normal d'un travail fini — comme une panne.
       */
      if (/^Type=oneshot\s*$/m.test(texte)) continue;
      const travail = path.resolve(ligne[1].trim());
      if (travail === vise) return fichier;
      if (!repli && travail.startsWith(`${vise}${path.sep}`)) repli = fichier;
    } catch {
      // Unité illisible : elle n'apprend rien de plus.
    }
  }
  return repli;
}

/** Le port annoncé par une unité systemd, s'il y en a un. */
export function portDansUnite(texte: string): number | null {
  const ligne = texte.match(/^Environment="?PORT=(\d+)/m);
  return ligne ? Number(ligne[1]) : null;
}

/**
 * Le port DÉCLARÉ par l'unité systemd d'un service — une préférence, pas un constat.
 *
 * Les FRAGMENTS (`<unité>.d/*.conf`) passent avant le fichier d'unité : c'est
 * là que le lanceur inscrit le port réellement retenu, et systemd leur donne le
 * dernier mot. Lire l'unité seule, c'est relire la valeur que le fragment vient
 * justement de corriger.
 */
function portDeclare(service: string): number | null {
  const dossier = '/etc/systemd/system';
  try {
    const fragments = fs
      .readdirSync(path.join(dossier, `${service}.d`))
      .filter((nom) => nom.endsWith('.conf'))
      .sort()
      .reverse();
    for (const nom of fragments) {
      const port = portDansUnite(fs.readFileSync(path.join(dossier, `${service}.d`, nom), 'utf8'));
      if (port) return port;
    }
  } catch {
    // Pas de fragment pour ce service : l'unité elle-même fait foi.
  }
  try {
    return portDansUnite(fs.readFileSync(path.join(dossier, service), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Les ports TCP réellement en écoute parmi les processus donnés.
 *
 * `ss -ltnpH` rend une ligne par socket ; on ne retient que celles dont un
 * `pid=` appartient au service. Isolée pour être vérifiable sans machine.
 */
export function portsEcoutes(sortieSs: string, pids: number[]): number[] {
  const miens = new Set(pids);
  const ports = new Set<number>();
  for (const ligne of sortieSs.split('\n')) {
    if (!ligne.trim()) continue;
    let aMoi = false;
    for (const m of ligne.matchAll(/pid=(\d+)/g)) if (miens.has(Number(m[1]))) aMoi = true;
    if (!aMoi) continue;
    const locale = ligne.trim().split(/\s+/)[3] ?? '';
    const port = Number(locale.slice(locale.lastIndexOf(':') + 1));
    if (Number.isInteger(port) && port > 0) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** Les numéros de processus listés par un `cgroup.procs`, une ligne par PID. */
export function pidsDansCgroup(texte: string): number[] {
  const pids: number[] = [];
  for (const ligne of texte.split('\n')) {
    const pid = Number(ligne.trim());
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/** Les processus qui composent le service EN MARCHE (son cgroup). */
async function pidsDuService(cwd: string, service: string): Promise<number[]> {
  const proprietes = await systemctlRoot(cwd, `show ${service} -p MainPID -p ControlGroup`, 30000);
  const pids = new Set<number>();
  const principal = Number(proprietes.out.match(/^MainPID=(\d+)$/m)?.[1] ?? 0);
  if (principal > 0) pids.add(principal);
  const groupe = proprietes.out.match(/^ControlGroup=(.+)$/m)?.[1]?.trim();
  if (groupe) {
    for (const base of ['/sys/fs/cgroup', '/sys/fs/cgroup/systemd']) {
      try {
        for (const pid of pidsDansCgroup(fs.readFileSync(path.join(base, groupe, 'cgroup.procs'), 'utf8'))) {
          pids.add(pid);
        }
        break;
      } catch {
        // Ce cgroup n'est pas monté là : on essaie l'autre emplacement.
      }
    }
  }
  return [...pids];
}

/** Le nom de projet porté par une unité `autoproject-<projet>.service`. */
export function nomDeProjetDuService(service: string): string | null {
  const nom = service.match(/^autoproject-(.+)\.service$/)?.[1]?.trim();
  return nom && /^[A-Za-z0-9._-]+$/.test(nom) ? nom : null;
}

/**
 * Les fichiers de vhost Caddy qui peuvent porter ce projet.
 *
 * Le nom du fichier ne suit pas toujours celui du projet : ces alias sont ceux
 * que le lanceur (`ensure-port.sh`) connaît déjà, recopiés ici pour que les
 * deux bouts de la chaîne cherchent au MÊME endroit.
 */
export function fichiersVhostDuProjet(projet: string): string[] {
  const alias: Record<string, string> = {
    projete: 'projete-mail',
    'projetc-dashboard': 'projetcadmin',
    haikonote: 'note',
  };
  const noms = [projet, alias[projet]].filter((nom): nom is string => Boolean(nom));
  return [...new Set(noms)].map((nom) => path.join('/etc/caddy/project-autostart.d', `${nom}.caddy`));
}

/**
 * Les ports visés par un vhost Caddy, dans la PLAGE DES PROJETS (15000-19999).
 *
 * Un vhost de projet porte souvent des routes vers des services voisins —
 * Centrifugo sur 8002, un serveur vidéo sur 8888/8889 chez projetc : les prendre
 * pour le port du projet ferait interroger la santé du voisin. Le lanceur
 * applique déjà exactement ce filtre quand il repointe le vhost.
 */
export function portsDansVhost(texte: string): number[] {
  const ports = new Set<number>();
  for (const m of texte.matchAll(/reverse_proxy\s+(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/g)) {
    const port = Number(m[1]);
    if (port >= 15000 && port <= 19999) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** Un port à interroger, et d'où vient ce numéro. */
type CandidatDePort = { port: number; origine: string };

/**
 * LES TROIS PALIERS, DANS L'ORDRE — la socket réelle gagne toujours.
 *
 * Sonder le port de l'unité alors qu'un projet VOISIN l'occupe donnait un faux
 * SUCCÈS : le contrôle de santé répondait, mais chez quelqu'un d'autre. Le
 * palier « port constaté en écoute » prime donc sur tout ; le vhost ne sert que
 * si aucune socket n'a pu être lue (pas de `ss`, droits refusés), et l'unité
 * reste le dernier repli. On ne MÉLANGE jamais deux paliers : descendre d'un
 * cran, c'est avoir constaté que le précédent ne dit rien.
 */
export function candidatsDePort(lu: {
  constates: number[];
  vhost: number[];
  declare: number | null;
  /**
   * LE PORT ENREGISTRÉ AVEC LE PROJET (`Project.port`), s'il en a un. Il passe
   * en TÊTE : c'est la porte d'entrée fixe du projet, plus une devinette. UNE
   * exception, pour ne pas rouvrir le faux succès chez un voisin : quand une
   * socket DU SERVICE est constatée ailleurs, c'est elle qui passe devant, et
   * le port enregistré la suit — le récit dit alors l'écart.
   */
  enregistre?: number | null;
}): CandidatDePort[] {
  const prefere = (ports: number[]) =>
    [...ports].sort((a, b) => {
      // À l'intérieur d'un palier, le port que l'unité ou le vhost désigne
      // aussi passe devant : c'est celui que le projet revendique.
      const poids = (port: number) => (port === lu.declare ? 0 : lu.vhost.includes(port) ? 1 : 2);
      return poids(a) - poids(b) || a - b;
    });
  const paliers: CandidatDePort[] = lu.constates.length
    ? prefere(lu.constates).map((port) => ({ port, origine: 'constaté en écoute' }))
    : lu.vhost.length
      ? prefere(lu.vhost).map((port) => ({ port, origine: 'lu sur le vhost Caddy du projet' }))
      : lu.declare
        ? [{ port: lu.declare, origine: 'déclaré par l’unité systemd' }]
        : [];
  if (!lu.enregistre) return paliers;
  const tete: CandidatDePort = { port: lu.enregistre, origine: 'enregistré avec le projet' };
  const reste = paliers.filter((candidat) => candidat.port !== lu.enregistre);
  const socketAilleurs = lu.constates.length > 0 && !lu.constates.includes(lu.enregistre);
  return socketAilleurs ? [...reste, tete] : [tete, ...reste];
}

/**
 * LE PORT D'UN SERVICE SE CONSTATE, IL NE SE CROIT PAS.
 *
 * Le lanceur d'un projet peut faire dériver son port (`ensure-port.sh` en
 * choisit un libre quand le port préféré est pris) : l'unité annonce alors un
 * port que plus personne ne sert, et le contrôle de redémarrage échouait sur
 * un service parfaitement sain — vu sur projetd-dev, unité à 15006, service à
 * 15018. On interroge donc les processus du service en marche ; le port
 * déclaré ne sert plus que de préférence et de repli.
 */
export async function portServi(
  cwd: string,
  service: string,
  /** Le port enregistré avec le projet : candidat de tête (`candidatsDePort`). */
  enregistre: number | null = null,
): Promise<{ candidats: CandidatDePort[]; constates: number[]; vhost: number[]; declare: number | null }> {
  const declare = portDeclare(service);
  let constates: number[] = [];
  try {
    const pids = await pidsDuService(cwd, service);
    if (pids.length) {
      for (const commande of ['ss -ltnpH', 'sudo -n ss -ltnpH']) {
        // `Infinity` : la liste des sockets d'une machine chargée dépasse
        // largement la coupure par défaut, et la ligne du service y passait.
        const sortie = await runCommand(cwd, commande, 20000, Infinity);
        constates = portsEcoutes(sortie.out, pids);
        if (constates.length) break;
      }
    }
  } catch {
    // Pas de `ss`, ou service derrière une socket Unix : les autres paliers parlent.
  }

  /*
   * Le vhost du projet est l'endroit où le lanceur écrit le port RETENU : il
   * dit donc la vérité même quand l'unité a vieilli. On ne le cherche que par
   * le NOM du projet — le trouver par le port, c'est lire le vhost d'un voisin
   * (incident du 6 septembre 2026), et le Caddyfile principal porte tous les
   * projets à la fois : il ne peut désigner personne.
   */
  const vhost: number[] = [];
  const projet = nomDeProjetDuService(service);
  if (projet) {
    for (const fichier of fichiersVhostDuProjet(projet)) {
      try {
        vhost.push(...portsDansVhost(fs.readFileSync(fichier, 'utf8')));
      } catch {
        // Ce projet n'a pas de vhost à ce nom : le palier suivant parlera.
      }
    }
  }

  return {
    candidats: candidatsDePort({ constates, vhost: [...new Set(vhost)], declare, enregistre }),
    constates,
    vhost,
    declare,
  };
}

/**
 * Un serveur web sert-il ce dossier TEL QUEL ?
 *
 * Un site statique (le tableau de bord Root, par exemple) n'a ni service
 * système ni construction : ses fichiers SONT le site, servis directement par
 * Caddy ou nginx. Sans cette reconnaissance, la publication d'un tel projet
 * n'avait aucun moyen d'agir et se déclarait pourtant réussie.
 */
/**
 * LE RÉGLAGE DE DÉPLOIEMENT D'UN PROJET QU'ON INSCRIT : le service système
 * constaté sur son dossier, s'il y en a un. La commande de mise à jour reste
 * vide — elle se choisit dans les réglages du projet.
 */
export function reglageDeDeploiementConstate(cheminProjet: string): { service?: string } {
  const service = serviceDuProjet(cheminProjet);
  return service ? { service: service.replace(/\.service$/, '') } : {};
}

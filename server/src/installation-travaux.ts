import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  FONCTIONS_INSTALLABLES,
  MOTEURS,
  DOSSIER_DES_CLES_DKIM,
  SELECTEUR_DKIM,
  domaineDeLAdresse,
  identiteDInstallation,
  nomDeDomaineValide,
  sortieBornee,
  type FonctionInstallable,
  type TravailDInstallation,
} from '@beluga/shared';
import { bus } from './bus.js';
import { CONFIG, DEMON_D_ESSAI } from './config.js';
import { log } from './logger.js';

/**
 * LES TRAVAUX D'INSTALLATION LANCÉS DEPUIS L'ÉCRAN.
 *
 * Qui vient d'installer Beluga Build n'a pas à retourner dans un terminal pour
 * poser un moteur ou une fonction : il clique « Installer », le démon lance
 * l'installation sous SON compte — celui du service, donc exactement là où il
 * cherchera l'outil ensuite — et la sortie s'affiche en direct à l'écran.
 *
 * TROIS RÈGLES TIENNENT CE MODULE :
 *
 *  - LE NAVIGATEUR NE FOURNIT JAMAIS LA COMMANDE. Il nomme un GENRE ; la ligne
 *    exécutée est écrite ici (`recetteDuGenre`), tirée du registre des moteurs
 *    ou des scripts du dépôt. Un genre inconnu est refusé avant tout lancement.
 *    La commande elle-même est réservée aux administrateurs par la grille des
 *    droits (`shared/src/droits-commandes.ts`, refus par défaut).
 *  - UN SEUL TRAVAIL À LA FOIS. Deux installateurs lancés ensemble se
 *    disputeraient npm et le disque, et leurs sorties se mêleraient à l'écran.
 *  - L'ÉTAT SE RELIT. La sortie accumulée est gardée (bornée) : un écran
 *    rechargé, ou un second appareil, retrouve le travail où il en est.
 */

/** Une étape d'un travail : un programme et ses arguments — jamais une ligne passée à un shell par l'écran. */
export interface EtapeDeTravail {
  /** Ce qui s'affiche avant la sortie de l'étape, comme l'invite d'un terminal. */
  titre: string;
  programme: string;
  args: string[];
  cwd?: string;
  /** Une étape dont l'échec n'arrête pas le travail (un contrôle, une relecture). */
  facultative?: boolean;
}

export interface RecetteDeTravail {
  etapes: EtapeDeTravail[];
  /**
   * Ce que le démon fait une fois les étapes passées. Un travail dont chaque
   * geste dépend du précédent (la copie personnelle) s'écrit ici en entier :
   * `lancer` exécute une étape et rend son code, `ecrire` parle à l'écran. Une
   * erreur levée fait échouer le travail, avec son message.
   */
  apres?: (outils: { ecrire: (texte: string) => void; lancer: (etape: EtapeDeTravail) => Promise<number> }) => Promise<void> | void;
}

let courant: TravailDInstallation | null = null;

/** Le travail en cours, ou le dernier terminé : c'est lui que `installation.etat` rend. */
export function travailDInstallation(): TravailDInstallation | null {
  return courant;
}

function script(nom: string): EtapeDeTravail {
  return { titre: `node scripts/${nom}`, programme: process.execPath, args: [path.join(CONFIG.selfPath, 'scripts', nom)], cwd: CONFIG.selfPath };
}

/**
 * LA COMMANDE D'UN MOTEUR, TELLE QUE LE DÉMON LA LANCE. C'est celle de
 * l'éditeur (registre des moteurs), dans un shell de connexion du compte du
 * service : l'installateur pose l'outil dans SON dossier personnel, là où le
 * démon le cherchera. Une installation globale par npm écrit hors de ce
 * dossier : elle passe par `sudo -n`, que l'installateur a accordé au compte.
 */
function etapeDuMoteur(commande: string): EtapeDeTravail {
  const globale = /^npm\s+(install|i)\s+(-g|--global)\b/.test(commande.trim());
  const ligne = globale && os.userInfo().username !== 'root' ? `sudo -n env "PATH=$PATH" ${commande.trim()}` : commande.trim();
  return { titre: commande.trim(), programme: 'bash', args: ['-lc', ligne], cwd: os.homedir() };
}

/** Un genre est-il une fonction installable ? */
function estUneFonction(genre: string): genre is FonctionInstallable {
  return (FONCTIONS_INSTALLABLES as readonly string[]).includes(genre);
}

/**
 * LA RECETTE D'UN GENRE, OU `null` S'IL N'EST PAS CONNU. Tout ce qui peut être
 * lancé depuis l'écran est écrit ICI.
 */
export function recetteDuGenre(genre: string): RecetteDeTravail | null {
  /*
   * LE FAUX INSTALLATEUR DES CONTRÔLES. Un contrôle ne télécharge pas un vrai
   * moteur pour juger le bouton : il donne au démon D'ESSAI une ligne inoffensive
   * par son environnement. Un démon en service n'écoute jamais cette variable.
   */
  const dEssai = DEMON_D_ESSAI ? (process.env.BELUGA_INSTALLATEUR_D_ESSAI ?? '').trim() : '';
  const moteur = MOTEURS.find((m) => m.id === genre);
  if (moteur) {
    if (dEssai) return { etapes: [{ titre: moteur.commandeDInstallation, programme: 'bash', args: ['-c', dEssai] }] };
    return { etapes: [etapeDuMoteur(moteur.commandeDInstallation)] };
  }
  if (!estUneFonction(genre)) return null;
  if (dEssai) return { etapes: [{ titre: `installation : ${genre}`, programme: 'bash', args: ['-c', dEssai] }] };
  switch (genre) {
    case 'memoire':
      return { etapes: [script('installer-modele-vecteurs.mjs')] };
    case 'dictee':
      return { etapes: [script('installer-transcription.mjs')] };
    case 'voix':
      // La voix s'appuie sur la dictée : les deux se posent dans cet ordre.
      return { etapes: [script('installer-transcription.mjs'), script('installer-voix.mjs')] };
    case 'voix-reparer':
      /*
       * RELANCER LA CONFIGURATION DE LA VOIX. Une voix posée à la main dans un
       * terminal (souvent sous un autre compte) peut être là sans parler : ses
       * fichiers sont d'abord rendus au compte du service, l'environnement
       * Python inutilisable est mis de côté et refait, les modèles manquants ou
       * vides retéléchargés — puis la voix est ESSAYÉE, et l'essai dit pourquoi
       * elle se tait encore s'il échoue.
       */
      return {
        etapes: [
          {
            ...enAdministrateur(
              'fichiers de la voix rendus au compte du service',
              SCRIPT_PROPRIETAIRE_DE_LA_VOIX,
              [os.userInfo().username, CONFIG.dataDir],
            ),
            facultative: true,
          },
          { ...script('installer-transcription.mjs'), titre: 'node scripts/installer-transcription.mjs --reparer', args: [...script('installer-transcription.mjs').args, '--reparer'] },
          script('installer-voix.mjs'),
        ],
        apres: async ({ ecrire }) => {
          const { speak } = await import('./voice.js');
          ecrire('\nEssai de la voix… ');
          const essai = await speak('La voix de Beluga Build est prête.');
          if (!essai.ok) throw new Error(`La voix ne parle toujours pas : ${essai.error ?? 'raison inconnue'}.`);
          ecrire('la voix parle.\n');
        },
      };
    case 'gh':
      return { etapes: [enAdministrateur("l'outil GitHub (dépôt officiel)", SCRIPT_GH, [])] };
    case 'signature-des-courriels': {
      const domaine = domaineDeLAdresse(identiteDInstallation().expediteurDesCourriels);
      if (!nomDeDomaineValide(domaine)) {
        // Rien à signer sans domaine : l'étape le dit dans le terminal, et le travail échoue.
        return {
          etapes: [
            {
              titre: 'signature des courriels',
              programme: 'bash',
              args: ['-c', 'echo "Réglez d’abord l’adresse d’expédition : la signature se fait pour son nom de domaine." >&2; exit 1'],
            },
          ],
        };
      }
      return { etapes: [enAdministrateur(`signature des courriels pour ${domaine}`, SCRIPT_SIGNATURE, [domaine])] };
    }
  }
}

/**
 * UNE ÉTAPE QUI DEMANDE L'ADMINISTRATEUR : le script est écrit ICI, les valeurs
 * passent en ARGUMENTS (`$1`…), jamais collées dans le texte du script.
 * L'installateur accorde `sudo` sans mot de passe au compte du service.
 */
function enAdministrateur(titre: string, contenu: string, args: string[]): EtapeDeTravail {
  const racine = typeof process.getuid === 'function' && process.getuid() === 0;
  return racine
    ? { titre, programme: 'bash', args: ['-c', contenu, 'beluga', ...args] }
    : { titre, programme: 'sudo', args: ['-n', 'bash', '-c', contenu, 'beluga', ...args] };
}

/**
 * Les fichiers de la voix (`venv`, `models`) rendus au compte du service : `$1`
 * le compte, `$2` le dossier de données. Seuls ces deux dossiers sont visés,
 * jamais leur parent.
 */
const SCRIPT_PROPRIETAIRE_DE_LA_VOIX = `for d in "$2/venv" "$2/models"; do [ -e "$d" ] && chown -R "$1" "$d"; done; echo "fichiers de la voix rendus à $1."`;

/** L'outil GitHub, depuis son dépôt officiel — la même recette que `scripts/installer.sh`. */
const SCRIPT_GH = `set -e
export DEBIAN_FRONTEND=noninteractive
if command -v gh >/dev/null 2>&1; then echo "outil GitHub déjà en place : $(gh --version | head -1)"; exit 0; fi
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" >/etc/apt/sources.list.d/github-cli.list
apt-get update -qq
apt-get install -y -qq gh
gh --version | head -1`;

/**
 * LA SIGNATURE DES COURRIELS (DKIM) pour le domaine passé en premier argument.
 *
 *  - LA CLÉ N'EST CRÉÉE QU'UNE FOIS : une clé déjà là est gardée — la
 *    régénérer rendrait fausse celle qui est publiée dans le domaine, et les
 *    courriels signés seraient refusés plus sûrement que sans signature ;
 *  - le signataire écoute sur 127.0.0.1:8891, posé par un réglage propre de
 *    son service (le service d'origine écoute sur un fichier que l'agent
 *    d'envoi, enfermé dans son dossier, ne voit pas) ;
 *  - l'agent d'envoi passe chaque courriel au signataire, et l'envoie quand
 *    même si celui-ci ne répond pas (« milter_default_action = accept »).
 */
const SCRIPT_SIGNATURE = `set -e
export DEBIAN_FRONTEND=noninteractive
DOMAINE="$1"
SELECTEUR=${JSON.stringify(SELECTEUR_DKIM)}
command -v postconf >/dev/null 2>&1 || { echo "Aucun agent d'envoi (postfix) sur ce serveur : la signature n'a rien à signer." >&2; exit 3; }
command -v opendkim >/dev/null 2>&1 || apt-get install -y -qq opendkim opendkim-tools
DOSSIER=${JSON.stringify(DOSSIER_DES_CLES_DKIM)}/"$DOMAINE"
mkdir -p "$DOSSIER"
if [ -f "$DOSSIER/$SELECTEUR.private" ]; then
  echo "clé de signature déjà en place pour $DOMAINE : gardée telle quelle."
else
  opendkim-genkey -b 2048 -d "$DOMAINE" -s "$SELECTEUR" -D "$DOSSIER"
  echo "clé de signature créée pour $DOMAINE."
fi
chown -R opendkim:opendkim /etc/opendkim
chmod 600 "$DOSSIER/$SELECTEUR.private"
chmod 644 "$DOSSIER/$SELECTEUR.txt"
touch /etc/opendkim/key.table /etc/opendkim/signing.table
grep -q "^$SELECTEUR._domainkey.$DOMAINE " /etc/opendkim/key.table || echo "$SELECTEUR._domainkey.$DOMAINE $DOMAINE:$SELECTEUR:$DOSSIER/$SELECTEUR.private" >>/etc/opendkim/key.table
grep -qF "*@$DOMAINE " /etc/opendkim/signing.table || echo "*@$DOMAINE $SELECTEUR._domainkey.$DOMAINE" >>/etc/opendkim/signing.table
cat >/etc/opendkim.conf <<'CONF'
# Posé par Beluga Build : la signature des courriels envoyés par ce serveur.
Syslog yes
UMask 007
Mode s
Canonicalization relaxed/simple
OversignHeaders From
KeyTable refile:/etc/opendkim/key.table
SigningTable refile:/etc/opendkim/signing.table
Socket inet:8891@127.0.0.1
PidFile /run/opendkim/opendkim.pid
UserID opendkim
CONF
mkdir -p /etc/systemd/system/opendkim.service.d
cat >/etc/systemd/system/opendkim.service.d/beluga.conf <<'CONF'
[Service]
ExecStart=
ExecStart=/usr/sbin/opendkim -P /run/opendkim/opendkim.pid -p inet:8891@127.0.0.1
CONF
systemctl daemon-reload
systemctl enable opendkim >/dev/null 2>&1 || true
systemctl restart opendkim
postconf -e 'milter_default_action = accept' 'milter_protocol = 6' 'smtpd_milters = inet:127.0.0.1:8891' 'non_smtpd_milters = inet:127.0.0.1:8891'
systemctl reload postfix || systemctl restart postfix
echo "signature des courriels en place pour $DOMAINE (sélecteur $SELECTEUR)."`;

function diffuser(travail: TravailDInstallation): void {
  // L'état part SANS la sortie : elle a déjà voyagé morceau par morceau, et se
  // relit en entier par `installation.etat`.
  bus.emit({ type: 'installation.travail', travail: { ...travail, sortie: '' } });
}

function lancerUneEtape(etape: EtapeDeTravail, ecrire: (texte: string) => void): Promise<number> {
  return new Promise((resolve) => {
    ecrire(`\u001b[2m$ ${etape.titre}\u001b[0m\n`);
    let enfant;
    try {
      enfant = spawn(etape.programme, etape.args, {
        cwd: etape.cwd ?? CONFIG.selfPath,
        // Aucune question ne peut être posée : il n'y a pas de clavier ici.
        env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', CI: '1', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      ecrire(`${err?.message ?? err}\n`);
      return resolve(127);
    }
    enfant.stdout.on('data', (d) => ecrire(String(d)));
    enfant.stderr.on('data', (d) => ecrire(String(d)));
    enfant.on('error', (err) => {
      ecrire(`${err.message}\n`);
      resolve(127);
    });
    enfant.on('close', (code) => resolve(code ?? 1));
  });
}

export type LancementDeTravail = { ok: true; travail: TravailDInstallation } | { ok: false; erreur: string };

/**
 * LANCE UN TRAVAIL et rend la main TOUT DE SUITE : l'écran affiche son départ
 * dès le clic, la suite arrive par les événements `installation.sortie` et
 * `installation.travail`. `fin` est appelée une fois le travail terminé — c'est
 * là que l'appelant relit ce que l'installation a changé.
 */
export function lancerUnTravail(
  genre: string,
  recette: RecetteDeTravail | null,
  fin?: (travail: TravailDInstallation) => Promise<void> | void,
): LancementDeTravail {
  if (!recette) return { ok: false, erreur: "Cette installation n'est pas connue de Beluga Build." };
  if (courant?.etat === 'en-cours') {
    return { ok: false, erreur: 'Une installation est déjà en cours : attendez qu’elle se termine.' };
  }
  const travail: TravailDInstallation = { genre, etat: 'en-cours', debut: Date.now(), sortie: '' };
  courant = travail;
  const ecrire = (texte: string) => {
    travail.sortie = sortieBornee(travail.sortie + texte);
    bus.emit({ type: 'installation.sortie', genre, donnees: texte });
  };
  diffuser(travail);
  log.info(`installation : travail « ${genre} » lancé depuis l'écran`);

  void (async () => {
    let erreur: string | undefined;
    try {
      for (const etape of recette.etapes) {
        const code = await lancerUneEtape(etape, ecrire);
        if (code !== 0 && !etape.facultative) {
          erreur = `« ${etape.titre} » s'est terminé sur le code ${code}.`;
          break;
        }
      }
      if (!erreur && recette.apres) await recette.apres({ ecrire, lancer: (etape) => lancerUneEtape(etape, ecrire) });
    } catch (err: any) {
      erreur = String(err?.message ?? err);
      ecrire(`${erreur}\n`);
    }
    travail.fin = Date.now();
    travail.etat = erreur ? 'echoue' : 'reussi';
    travail.erreur = erreur;
    ecrire(erreur ? `\n\u001b[31m✗ ${erreur}\u001b[0m\n` : '\n\u001b[32m✓ Terminé.\u001b[0m\n');
    log.info(`installation : travail « ${genre} » ${erreur ? `échoué (${erreur})` : 'réussi'}`);
    try {
      await fin?.(travail);
    } catch (err: any) {
      log.warn('installation : la relecture de fin de travail a échoué', err?.message ?? err);
    }
    diffuser(travail);
  })();

  return { ok: true, travail: { ...travail } };
}

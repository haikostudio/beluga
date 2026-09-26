import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  LIMITE_FRAPPE,
  SESSION_TERMINAL,
  encoderSortie,
  ligneDeTaille,
  lireMessageDuTerminal,
  tailleDeTerminal,
  type CompteAffiche,
  type MessageDuTerminal,
} from '@beluga/shared';
import {
  attacherUnClient,
  compteDuTerminal,
  garantirLaSession,
  retenirLeCompteDuTerminal,
  tuerLaSession,
} from './terminal.js';
import { log } from './logger.js';

/**
 * LA VOIE DU TERMINAL, À PART DE CELLE DE L'APPLICATION.
 *
 * Le canal `/ws` porte le protocole de Beluga Build : des ÉVÉNEMENTS structurés,
 * diffusés à tous les écrans par le bus. Un terminal, lui, est un FLOT d'octets
 * qui n'appartient qu'à une attache, et il en arrive des milliers par seconde
 * quand une construction défile. Le faire passer par le même canal aurait mêlé
 * ce flot au reste et forcé chaque écran à jeter ce qui ne le concerne pas.
 *
 * D'où une seconde voie, `/ws/terminal`, gardée par LA MÊME session que le reste
 * de l'application : l'accès au terminal du serveur n'est ouvert qu'à quelqu'un
 * déjà entré. Passé ce mur, l'accès est COMPLET et sans restriction — c'est ce
 * qui a été demandé : le terminal du serveur, tel quel, avec les mêmes droits
 * que les agents.
 */
export function attacherLaVoieDuTerminal(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, requete: http.IncomingMessage) => {
    const envoyer = (message: MessageDuTerminal) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    /*
     * LA TAILLE EST CONNUE AVANT L'ATTACHE. Le navigateur la met dans l'adresse
     * (`?colonnes=…&lignes=…`) : la session est donc créée ou redimensionnée à
     * la bonne taille du premier coup, au lieu de s'afficher en 80×24 puis de
     * sauter sous les yeux au premier message de redimension.
     */
    let colonnes = 80;
    let lignes = 24;
    const adresse = requete.url ?? '';
    if (adresse.includes('?')) {
      const parametres = new URLSearchParams(adresse.slice(adresse.indexOf('?') + 1));
      const taille = tailleDeTerminal(Number(parametres.get('colonnes')), Number(parametres.get('lignes')));
      colonnes = taille.colonnes;
      lignes = taille.lignes;
    }

    /*
     * LE COMPTE EST LU AVANT LA SESSION, ET IL S'ANNONCE. Le `claude` tapé dans
     * ce terminal doit dépenser sur le compte Max x20 de l'application, jamais
     * sur le coffre du compte système : l'écran affiche donc lequel, et le dit
     * en clair quand il n'y en a aucun.
     */
    let choix = compteDuTerminal();
    const afficher = (): CompteAffiche | undefined =>
      choix.compte ? { id: choix.compte.id, label: choix.compte.label, plan: choix.compte.plan } : undefined;

    const session = garantirLaSession(colonnes, lignes, choix);
    if (!session.ok) {
      envoyer({ type: 'panne', message: session.erreur ?? 'terminal indisponible' });
      ws.close();
      return;
    }

    let client;
    try {
      client = attacherUnClient(colonnes, lignes, choix);
    } catch (erreur) {
      envoyer({ type: 'panne', message: `attache impossible : ${(erreur as Error).message}` });
      ws.close();
      return;
    }

    envoyer({
      type: 'pret',
      session: SESSION_TERMINAL,
      colonnes,
      lignes,
      compte: afficher(),
      avertissement: choix.avertissement,
    });

    // Les octets partent BRUTS, sans être décodés en texte : voir `encoderSortie`.
    const relayer = (morceau: Buffer) => envoyer({ type: 'sortie', donnees: encoderSortie(morceau) });
    client.stdout?.on('data', relayer);
    client.stderr?.on('data', relayer);
    /** Le quatrième tuyau (fd 3) : le canal des tailles, lu par le relais. */
    const canalDesTailles = client.stdio[3] as NodeJS.WritableStream | undefined;
    canalDesTailles?.on('error', () => {});

    client.on('exit', (code) => {
      envoyer({ type: 'panne', message: `l’attache au terminal s’est terminée (code ${code ?? 0})` });
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    ws.on('message', (donnees) => {
      const lecture = lireMessageDuTerminal(donnees.toString());
      if (!lecture.ok) {
        // Un refus se DIT dans le terminal, il ne se perd pas : une commande
        // trop longue collée doit s'expliquer, pas disparaître.
        envoyer({ type: 'panne', message: lecture.refus });
        return;
      }
      if (lecture.message.type === 'frappe') {
        client.stdin?.write(Buffer.from(lecture.message.donnees, 'utf8'));
        return;
      }
      if (lecture.message.type === 'compte') {
        /*
         * CHANGER DE COMPTE, C'EST RECRÉER LA SESSION. tmux fige
         * l'environnement d'un shell au moment où il l'ouvre : le seul moyen
         * de faire pointer `claude` sur un autre coffre est de TUER la session
         * et de la refaire. Ce qui y tournait est perdu, pour tous les écrans
         * attachés — l'écran a demandé confirmation avant d'en arriver là.
         */
        retenirLeCompteDuTerminal(lecture.message.id);
        choix = compteDuTerminal();
        if (choix.compte && choix.compte.id !== lecture.message.id) {
          // Le compte demandé n'a pas été retenu (retiré, éteint, autre moteur) :
          // on ne garde pas un réglage qui ne veut plus rien dire.
          retenirLeCompteDuTerminal(undefined);
        }
        tuerLaSession();
        envoyer({ type: 'compte-change', compte: afficher(), avertissement: choix.avertissement });
        // L'écran se rattache de lui-même : la session repartira avec le coffre
        // du nouveau compte, à la taille de celui qui la redemande.
        if (ws.readyState === WebSocket.OPEN) ws.close();
        return;
      }
      if (lecture.message.colonnes === colonnes && lecture.message.lignes === lignes) return;
      colonnes = lecture.message.colonnes;
      lignes = lecture.message.lignes;
      canalDesTailles?.write(ligneDeTaille(colonnes, lignes));
    });

    const detacher = () => {
      /*
       * FERMER L'ÉCRAN DÉTACHE, ÇA NE TUE RIEN. On coupe le client `script` ;
       * la session tmux, elle, continue avec tout ce qui y tourne. C'est le
       * point entier de tmux : `claude` ou `npm run build` lancés ici survivent
       * à la fenêtre qui les a lancés.
       */
      client.stdout?.off('data', relayer);
      client.stderr?.off('data', relayer);
      if (client.exitCode === null) client.kill('SIGTERM');
    };
    ws.on('close', detacher);
    ws.on('error', detacher);
  });

  log.debug(`voie du terminal prête (frappe plafonnée à ${LIMITE_FRAPPE} signes)`);
  return wss;
}

/**
 * LE GARDIEN DU DÉMON : un fil à part, qui regarde si le fil principal respire.
 *
 * Le fil principal du démon écrit son heure dans une mémoire partagée toutes
 * les 200 ms. Quand cette heure ne bouge plus depuis `seuilMs`, le démon est
 * FIGÉ — et lui-même ne peut rien dire de ce qu'il était en train de faire : il
 * est figé. Ce gardien, lui, tourne dans un autre fil : il demande au débogueur
 * du fil figé de s'arrêter une demi-seconde, relève la pile d'appels, et la
 * consigne. C'est la seule façon de savoir QUI fige le serveur.
 *
 * Un appel natif long (base, commande synchrone) ne s'interrompt qu'à son
 * retour : la pile relevée alors est celle de la fonction qui l'a lancé, ce qui
 * est justement ce qu'on cherche.
 *
 * Ce fichier ne dépend de rien du démon : il tourne seul, et ne peut pas le
 * faire tomber (toute erreur se consigne ou s'ignore).
 */
import fs from 'node:fs';
import { Session } from 'node:inspector';
import { workerData } from 'node:worker_threads';

interface Donnees {
  battement: SharedArrayBuffer;
  fichier: string;
  seuilMs: number;
}

const { battement, fichier, seuilMs } = workerData as Donnees;
const pouls = new Float64Array(battement);
const session = new Session();
let connectee = false;
let captureEnCours = false;
let dejaCaptureCeBlocage = false;

function consigner(ligne: Record<string, unknown>): void {
  try {
    fs.appendFileSync(fichier, `${JSON.stringify({ at: new Date().toISOString(), ...ligne })}\n`);
  } catch {
    /* un journal ne doit jamais faire tomber le gardien */
  }
}

interface ImageDePile {
  functionName: string;
  url: string;
  location: { scriptId: string; lineNumber: number };
}

/* Le débogueur redit chaque script connu à son activation : on garde leur nom, car
   l'image de pile d'un module ne porte pas toujours son adresse. */
const scripts = new Map<string, string>();
session.on('Debugger.scriptParsed', (message) => {
  const { scriptId, url } = message.params as { scriptId: string; url: string };
  if (url) scripts.set(scriptId, url);
});

function relever(silenceMs: number): void {
  if (captureEnCours) return;
  captureEnCours = true;
  try {
    if (!connectee) {
      session.connectToMainThread();
      connectee = true;
    }
    session.once('Debugger.paused', (message) => {
      const images = ((message.params as { callFrames?: ImageDePile[] }).callFrames ?? []).slice(0, 14);
      consigner({
        silenceMs,
        pile: images.map((image) => {
          const adresse = image.url || scripts.get(image.location.scriptId) || '';
          const fichierCourt = adresse.split('/').slice(-2).join('/') || '(natif)';
          return `${image.functionName || '(anonyme)'} ${fichierCourt}:${image.location.lineNumber + 1}`;
        }),
      });
      session.post('Debugger.resume', () => {
        session.post('Debugger.disable', () => {
          // Le débogueur est rendu : aucune session ne reste branchée au fil principal.
          try {
            session.disconnect();
          } catch {
            /* déjà détachée */
          }
          connectee = false;
          captureEnCours = false;
        });
      });
    });
    session.post('Debugger.enable', () => session.post('Debugger.pause'));
  } catch (err) {
    captureEnCours = false;
    consigner({ silenceMs, erreur: (err as Error).message });
  }
}

/* Le minuteur reste « tenu » : un fil sans minuteur actif s'arrête aussitôt. C'est le démon
   (`worker.unref()`, puis `terminate()`) qui décide de la fin du gardien, jamais lui. */
setInterval(() => {
  const silence = Date.now() - (pouls[0] ?? Date.now());
  if (silence < seuilMs) {
    dejaCaptureCeBlocage = false;
    return;
  }
  // Un seul relevé par blocage : le premier est le plus parlant.
  if (dejaCaptureCeBlocage) return;
  dejaCaptureCeBlocage = true;
  relever(silence);
}, 250);

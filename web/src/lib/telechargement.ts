import * as React from 'react';
import { client } from '@/lib/client';
import { estInstallee } from '@/lib/application-installee';
import { t } from '@/lib/langue';
import { nomDepuisDisposition } from '@beluga/shared';

/**
 * TÉLÉCHARGER UN FICHIER — UN SEUL CHEMIN POUR TOUTE L'APPLICATION.
 *
 * Sur un téléphone (et dans l'application installée sur l'écran d'accueil), un
 * lien de téléchargement ne mène nulle part : l'application n'a pas de
 * gestionnaire de téléchargements, et la visionneuse qui rattrape ces liens ne
 * sait pas enregistrer une vidéo (elle la lit par morceaux, sans la recevoir).
 * Le bouton « Télécharger » d'un export ne faisait donc RIEN d'utile.
 *
 * Ici, le fichier est d'abord REÇU en entier (avec son pourcentage), puis remis
 * à la FEUILLE DE PARTAGE du système : « Enregistrer la vidéo », « Enregistrer
 * dans Fichiers », AirDrop… Plusieurs fichiers partent ensemble, dans la même
 * feuille. Sur un ordinateur, rien ne change : un téléchargement ordinaire (et
 * UNE archive quand il y a plusieurs fichiers).
 *
 * LA FEUILLE EXIGE UN GESTE RÉCENT : recevoir un gros fichier peut durer plus
 * que ce délai. Le partage est donc tenté dès la réception ; si le système le
 * refuse (`NotAllowedError`), les fichiers restent en mémoire et l'état passe à
 * « prêt » — le toucher suivant les enregistre aussitôt.
 */
export interface FichierATelecharger {
  /** L'adresse du fichier (même origine). */
  adresse: string;
  /** Le nom sous lequel il s'enregistre. */
  nom: string;
}

export type EtatDeTelechargement = 'repos' | 'reception' | 'pret';

/** Ce lien est fabriqué par le code : la visionneuse de l'application installée ne le rattrape pas. */
const HORS_VISIONNEUSE = 'data-hors-visionneuse';

/** La feuille de partage sait-elle recevoir des fichiers, et est-on sur un appareil qui en a besoin ? */
export function feuilleDePartage(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  return estInstallee() || window.matchMedia('(pointer: coarse)').matches;
}

/** Un téléchargement ordinaire : le navigateur enregistre le fichier sous son nom. */
function cliquerUnLien(adresse: string, nom: string): void {
  const ancre = document.createElement('a');
  ancre.href = adresse;
  ancre.download = nom;
  ancre.setAttribute(HORS_VISIONNEUSE, '');
  document.body.appendChild(ancre);
  ancre.click();
  ancre.remove();
}

/** Reçoit un fichier en entier, en disant où il en est (0 à 1). */
async function recevoir(fichier: FichierATelecharger, avancer: (part: number) => void, signal: AbortSignal): Promise<File> {
  const reponse = await fetch(fichier.adresse, { credentials: 'same-origin', signal });
  if (!reponse.ok) throw new Error(((await reponse.json().catch(() => ({}))) as { error?: string }).error ?? String(reponse.status));
  const mime = (reponse.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const total = Number(reponse.headers.get('content-length') ?? 0);
  /* UN NOM SANS EXTENSION ne s'enregistre pas comme une vidéo : celui du serveur (`content-disposition`) la porte. */
  const nom = /\.[a-z0-9]{2,5}$/i.test(fichier.nom) ? fichier.nom : (nomDepuisDisposition(reponse.headers.get('content-disposition')) ?? fichier.nom);
  const lecteur = reponse.body?.getReader();
  if (!lecteur) return new File([await reponse.blob()], nom, { type: mime });
  const morceaux: BlobPart[] = [];
  let recu = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    recu += value.byteLength;
    if (total > 0) avancer(Math.min(1, recu / total));
  }
  return new File(morceaux, nom, { type: mime });
}

async function recevoirTous(fichiers: FichierATelecharger[], avancer: (pourcent: number) => void, signal: AbortSignal): Promise<File[]> {
  const recus: File[] = [];
  for (const [i, f] of fichiers.entries()) {
    recus.push(await recevoir(f, (part) => avancer(Math.round(((i + part) / fichiers.length) * 100)), signal));
    avancer(Math.round(((i + 1) / fichiers.length) * 100));
  }
  return recus;
}

/** Remet des fichiers à la feuille de partage. `geste` : le système réclame un nouveau toucher. */
async function partager(fichiers: File[]): Promise<'parti' | 'geste' | 'refuse'> {
  try {
    await navigator.share({ files: fichiers });
    return 'parti';
  } catch (souci) {
    const nom = (souci as { name?: string })?.name;
    /* La feuille refermée sans rien choisir n'est pas une panne. */
    if (nom === 'AbortError') return 'parti';
    return nom === 'NotAllowedError' ? 'geste' : 'refuse';
  }
}

/** Dernier recours : chaque fichier reçu s'enregistre par un lien ordinaire. */
function enregistrerParLiens(fichiers: File[]): void {
  for (const f of fichiers) {
    const adresse = URL.createObjectURL(f);
    cliquerUnLien(adresse, f.name);
    window.setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
  }
}

/**
 * LE GESTE « TÉLÉCHARGER » d'un bouton. `fichiers` : ce qu'il enregistre (un ou
 * plusieurs). `archive` : la même chose en UN fichier — prise sur ordinateur dès
 * qu'il y a plusieurs fichiers, et en repli quand la feuille de partage refuse
 * plusieurs fichiers à la fois.
 */
export function useTelechargement(
  fichiers: FichierATelecharger[],
  archive?: FichierATelecharger,
): { etat: EtatDeTelechargement; pourcent: number; lancer: () => void } {
  const [etat, setEtat] = React.useState<EtatDeTelechargement>('repos');
  const [pourcent, setPourcent] = React.useState(0);
  const recus = React.useRef<File[] | null>(null);
  const abandon = React.useRef<AbortController | null>(null);
  const cle = fichiers.map((f) => f.adresse).join('|');
  const courant = React.useRef({ fichiers, archive });
  courant.current = { fichiers, archive };

  /* D'autres fichiers (un autre lot), ou l'écran refermé : ce qui était reçu ou en route est lâché. */
  React.useEffect(() => {
    return () => {
      abandon.current?.abort();
      abandon.current = null;
      recus.current = null;
      setEtat('repos');
    };
  }, [cle]);

  const lancer = React.useCallback(() => {
    const { fichiers: aPrendre, archive: enUn } = courant.current;
    if (!aPrendre.length || abandon.current) return;
    /* DÉJÀ REÇUS : ce toucher est le geste que la feuille attendait. */
    if (recus.current) {
      const prets = recus.current;
      void partager(prets).then((issue) => {
        if (issue === 'geste') return;
        if (issue === 'refuse') enregistrerParLiens(prets);
        recus.current = null;
        setEtat('repos');
      });
      return;
    }
    if (!feuilleDePartage()) {
      if (aPrendre.length > 1 && enUn) cliquerUnLien(enUn.adresse, enUn.nom);
      else aPrendre.forEach((f, i) => window.setTimeout(() => cliquerUnLien(f.adresse, f.nom), i * 400));
      return;
    }
    const controle = new AbortController();
    abandon.current = controle;
    setPourcent(0);
    setEtat('reception');
    void (async () => {
      try {
        let prets = await recevoirTous(aPrendre, setPourcent, controle.signal);
        /* Plusieurs fichiers refusés ensemble : la même chose en une archive. */
        if (!navigator.canShare({ files: prets }) && aPrendre.length > 1 && enUn) prets = await recevoirTous([enUn], setPourcent, controle.signal);
        if (controle.signal.aborted) return;
        if (!navigator.canShare({ files: prets })) {
          enregistrerParLiens(prets);
          setEtat('repos');
          return;
        }
        const issue = await partager(prets);
        if (controle.signal.aborted) return;
        if (issue === 'geste') {
          recus.current = prets;
          setEtat('pret');
          return;
        }
        if (issue === 'refuse') enregistrerParLiens(prets);
        setEtat('repos');
      } catch (souci) {
        if (controle.signal.aborted) return;
        client.pushToast('error', t('Téléchargement impossible : {raison}', { raison: String((souci as Error)?.message ?? souci) }));
        setEtat('repos');
      } finally {
        if (abandon.current === controle) abandon.current = null;
      }
    })();
  }, []);

  return { etat, pourcent, lancer };
}

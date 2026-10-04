import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { affichageSurPlace, lienAOuvrirSurPlace, nomDepuisDisposition, type LienSurPlace } from '@beluga/shared';
import { Button, Dialog, DialogContentLibre, DialogHeader, DialogTitle, ZoneDefilement } from '@/components/ui';
import { estInstallee } from '@/lib/application-installee';
import { bytes } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Le fichier une fois reçu : de quoi le montrer, et de quoi l'enregistrer. */
interface FichierRecu {
  nom: string;
  mime: string;
  /** L'adresse à montrer : celle du contenu reçu, ou celle du serveur pour une vidéo. */
  source: string;
  /** Le contenu lui-même — absent pour une vidéo, lue par morceaux. */
  contenu?: Blob;
}

/** Ce lien est le nôtre : il enregistre le fichier, il ne se rouvre pas ici. */
const HORS_VISIONNEUSE = 'data-hors-visionneuse';
/** Posé sur le bouton « télécharger » d'un aperçu DÉJÀ ouvert : on enregistre tout de suite. */
const ENREGISTRER_DIRECT = 'data-enregistrer-direct';

async function recevoir(lien: LienSurPlace, abandon: AbortController): Promise<FichierRecu> {
  const reponse = await fetch(lien.adresse, { signal: abandon.signal, credentials: 'same-origin' });
  if (!reponse.ok) throw new Error(String(reponse.status));
  const mime = (reponse.headers.get('content-type') ?? '').split(';')[0].trim();
  const nom =
    lien.nom ||
    nomDepuisDisposition(reponse.headers.get('content-disposition')) ||
    new URL(lien.adresse).pathname.split('/').filter(Boolean).pop() ||
    t('Fichier joint');
  /* UNE VIDÉO NE SE CHARGE PAS EN ENTIER : le lecteur la demande par morceaux. */
  if (affichageSurPlace(mime) === 'video') {
    abandon.abort();
    return { nom, mime, source: lien.adresse };
  }
  const contenu = await reponse.blob();
  return { nom, mime: mime || contenu.type, source: URL.createObjectURL(contenu), contenu };
}

/**
 * ENREGISTRER LE FICHIER. Sur un téléphone, c'est la feuille de partage du
 * système (« Enregistrer l'image », « Enregistrer dans Fichiers ») : elle se
 * referme toujours. Ailleurs, un téléchargement ordinaire. Rend `false` quand
 * rien n'a pu partir, pour que l'appelant montre le fichier à la place.
 */
async function enregistrer(fichier: FichierRecu): Promise<boolean> {
  if (fichier.contenu && typeof navigator.share === 'function') {
    const piece = new File([fichier.contenu], fichier.nom, { type: fichier.mime || fichier.contenu.type });
    if (navigator.canShare?.({ files: [piece] })) {
      try {
        await navigator.share({ files: [piece] });
        return true;
      } catch (souci) {
        /* La feuille refermée sans rien choisir n'est pas une panne. */
        if ((souci as { name?: string })?.name === 'AbortError') return true;
        return false;
      }
    }
  }
  if (!fichier.contenu) return false;
  const ancre = document.createElement('a');
  ancre.href = fichier.source;
  ancre.download = fichier.nom;
  ancre.setAttribute(HORS_VISIONNEUSE, '');
  document.body.appendChild(ancre);
  ancre.click();
  ancre.remove();
  return true;
}

/**
 * LA FENÊTRE QUI OUVRE LES LIENS SUR PLACE, POSÉE UNE FOIS POUR TOUTE
 * L'APPLICATION.
 *
 * Installée sur l'écran d'accueil, l'application n'a pas de bouton « retour » :
 * un lien vers l'un de ses fichiers remplaçait tout l'écran par la page de
 * téléchargement du système, sans rien pour revenir. Ce composant écoute TOUS
 * les clics sur un lien (`lienAOuvrirSurPlace`) et ouvre ceux-là ici, dans une
 * fenêtre qu'on referme comme les autres : l'image se voit, le document se lit,
 * et « Enregistrer » passe par la feuille de partage du système.
 *
 * Dans un navigateur ordinaire, rien ne change : il a son bouton « retour » et
 * ses téléchargements. Aucun lien n'a donc à connaître ce composant.
 *
 * Il ne dépend d'AUCUN canal : il est posé dans l'espace de travail comme dans
 * la porte servie aux clients.
 */
export function VisionneuseDeLien() {
  const [lien, setLien] = React.useState<LienSurPlace | null>(null);
  const [fichier, setFichier] = React.useState<FichierRecu | null>(null);
  const [echec, setEchec] = React.useState(false);
  const [enCours, setEnCours] = React.useState(false);

  React.useEffect(() => {
    if (!estInstallee()) return;
    const surClic = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const ancre = (event.target as Element | null)?.closest?.('a[href]');
      if (!(ancre instanceof HTMLAnchorElement) || ancre.hasAttribute(HORS_VISIONNEUSE)) return;
      const surPlace = lienAOuvrirSurPlace({
        href: ancre.getAttribute('href') ?? '',
        origine: window.location.origin,
        telechargement: ancre.hasAttribute('download') ? (ancre.getAttribute('download') ?? '') : null,
        nouvelleFenetre: ancre.target === '_blank',
      });
      if (!surPlace) return;
      /* Le lien ne navigue plus ; ses propres gestes (`onClick`) restent joués. */
      event.preventDefault();
      if (!ancre.hasAttribute(ENREGISTRER_DIRECT)) {
        setLien(surPlace);
        return;
      }
      /* L'aperçu est déjà ouvert : on enregistre sans rouvrir une fenêtre. Si
         le système refuse (le geste a expiré pendant le chargement), le fichier
         s'ouvre ici, où « Enregistrer » repart d'un vrai geste. */
      void recevoir(surPlace, new AbortController())
        .then(async (recu) => {
          const parti = await enregistrer(recu);
          if (recu.contenu) URL.revokeObjectURL(recu.source);
          if (!parti) setLien(surPlace);
        })
        /* Le fichier n'a pas pu être reçu : la fenêtre s'ouvre et le dit. */
        .catch(() => setLien(surPlace));
    };
    /* EN CAPTURE : avant tout autre geste, et avant que le lien ne navigue. */
    document.addEventListener('click', surClic, true);
    return () => document.removeEventListener('click', surClic, true);
  }, []);

  React.useEffect(() => {
    setFichier(null);
    setEchec(false);
    if (!lien) return;
    const abandon = new AbortController();
    let vivant = true;
    let source: string | undefined;
    recevoir(lien, abandon)
      .then((recu) => {
        if (recu.contenu) source = recu.source;
        if (vivant) setFichier(recu);
        else if (source) URL.revokeObjectURL(source);
      })
      .catch(() => vivant && setEchec(true));
    return () => {
      vivant = false;
      abandon.abort();
      if (source) URL.revokeObjectURL(source);
    };
  }, [lien]);

  if (!lien) return null;
  const affichage = fichier ? affichageSurPlace(fichier.mime) : 'aucun';

  return (
    <Dialog open onOpenChange={(open) => !open && setLien(null)}>
      <DialogContentLibre className="sm:w-[min(900px,100%)]" data-visionneuse-de-lien={fichier ? affichage : 'attente'}>
        <DialogHeader className="flex items-center gap-2 pb-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-[14.5px]">
            {fichier?.nom ?? lien.nom ?? t('Lecture…')}
          </DialogTitle>
          {fichier?.contenu ? (
            <Button
              variant="outline"
              size="sm"
              disabled={enCours}
              data-visionneuse-enregistrer
              onClick={async () => {
                setEnCours(true);
                try {
                  if (!(await enregistrer(fichier))) setEchec(true);
                } finally {
                  setEnCours(false);
                }
              }}
            >
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              {t('Enregistrer')}
            </Button>
          ) : null}
        </DialogHeader>
        <ZoneDefilement
          fond="hsl(var(--raised))"
          classeEnveloppe="mx-4 mb-4 rounded-md border border-border bg-raised"
          data-fenetre-corps
          className="overflow-x-auto p-2"
        >
          {echec ? (
            <p className="p-6 text-center text-[13.5px] text-faint" data-visionneuse-echec>
              {t('Ouverture impossible')}
            </p>
          ) : !fichier ? (
            <p className="p-6 text-center text-[13.5px] text-faint">{t('Lecture…')}</p>
          ) : affichage === 'image' ? (
            <img src={fichier.source} alt={fichier.nom} draggable={false} className="mx-auto max-w-full select-none" />
          ) : affichage === 'video' ? (
            <video src={fichier.source} controls playsInline className="mx-auto max-h-[70dvh] max-w-full" />
          ) : affichage === 'cadre' ? (
            <iframe title={fichier.nom} src={fichier.source} className="h-[70dvh] w-full rounded bg-white" />
          ) : (
            <p className="p-6 text-center text-[13.5px] text-faint">
              {t("Ce type de fichier ne s'affiche pas ici ({v0}).", { v0: bytes(fichier.contenu?.size ?? 0) })}
            </p>
          )}
        </ZoneDefilement>
      </DialogContentLibre>
    </Dialog>
  );
}

import * as React from 'react';
import { mediaDuLien, mimeDuGenre, type Attachment, type GenreDuMediaDuLien, type MediaDuLien } from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { useApp } from '@/lib/use-app';
import { EVENEMENT_OUVRIR_UN_MEDIA } from '@/lib/ouvrir-un-media';

/** Le type de contenu que le serveur annonce, lu sur l'en-tête seul (la réponse est coupée aussitôt). */
async function typeAnnonce(adresse: string): Promise<{ mime: string; nom: string | null } | null> {
  const abandon = new AbortController();
  try {
    const reponse = await fetch(adresse, { signal: abandon.signal, credentials: 'same-origin' });
    const mime = (reponse.headers.get('content-type') ?? '').split(';')[0].trim();
    const disposition = reponse.headers.get('content-disposition') ?? '';
    const nom = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
    abandon.abort();
    return reponse.ok ? { mime, nom: nom ? decodeURIComponent(nom) : null } : null;
  } catch {
    return null;
  }
}

/** Ce qui, dans un fil, désigne un média : une image posée, un média livré, un lien vers un média. */
const SELECTEUR_DES_MEDIAS_DU_FIL = '[data-illustration-du-plan], [data-media-livre], a[data-lien-media]';

/** Le média désigné par un élément du fil, ou rien. */
function mediaDeLElement(el: Element): MediaDuLien | null {
  const illustration = el.getAttribute('data-illustration-du-plan');
  if (illustration) return { adresse: `/api/attachment?id=${encodeURIComponent(illustration)}`, piece: illustration, genre: 'image', nom: illustration };
  const livre = el.getAttribute('data-media-livre');
  if (livre) {
    const genre = (el.getAttribute('data-media-livre-genre') ?? 'inconnu') as GenreDuMediaDuLien;
    return { adresse: `/api/attachment?id=${encodeURIComponent(livre)}`, piece: livre, genre: ['image', 'video', 'son', 'pdf'].includes(genre) ? genre : 'inconnu', nom: livre };
  }
  const href = el.getAttribute('href');
  return href ? mediaDuLien(href, window.location.origin) : null;
}

const cleDuMedia = (m: MediaDuLien) => m.piece ?? m.adresse;

/**
 * LA SUITE DES MÉDIAS DU FIL OÙ CELUI-CI A ÉTÉ OUVERT (demande du 03/11/2026) : « quand on ouvre un média du flux de
 * l'agent, on peut défiler les médias qui suivent, même s'ils ne font pas partie d'un composant ». Le fil
 * (`[data-fil]`, `[data-fil-sans-carte]`) qui porte le média est relu dans l'ordre d'affichage : images posées dans
 * le texte, médias livrés, liens vers un média. Hors d'un fil, le média reste seul.
 */
function suiteDuFil(media: MediaDuLien): MediaDuLien[] {
  const cle = cleDuMedia(media);
  const elements = [...document.querySelectorAll(SELECTEUR_DES_MEDIAS_DU_FIL)];
  const source = elements.find((el) => {
    const m = mediaDeLElement(el);
    return m && cleDuMedia(m) === cle;
  });
  /* UN MÉDIA D'UN PAQUET NE FEUILLETTE QUE SON PAQUET (carte « Images groupées dans le fil ») ; sinon tout le fil. */
  const fil = source?.closest('[data-paquet-images]') ?? source?.closest('[data-fil], [data-fil-sans-carte]');
  if (!fil) return [media];
  const suite: MediaDuLien[] = [];
  const vus = new Set<string>();
  for (const el of fil.querySelectorAll(SELECTEUR_DES_MEDIAS_DU_FIL)) {
    const m = mediaDeLElement(el);
    if (!m || vus.has(cleDuMedia(m))) continue;
    vus.add(cleDuMedia(m));
    suite.push(cleDuMedia(m) === cle ? media : m);
  }
  return suite.length ? suite : [media];
}

/**
 * LA VISIONNEUSE COMMUNE DES MÉDIAS (03/11/2026). Toute image, vidéo, tout son ou PDF d'une réponse d'agent qui n'a
 * pas de galerie autour de lui (`ContexteOuvrirUneImageDuTexte`) s'ouvre ICI, dans l'aperçu de l'application —
 * plus jamais dans un nouvel onglet du navigateur. Montée une fois par l'écran principal. Elle feuillette la suite
 * des médias du fil (`suiteDuFil`) : flèches au survol, ← →, glissé du doigt.
 */
export function VisionneuseDesMedias() {
  const state = useApp();
  const [ouvert, setOuvert] = React.useState<{ piece: Attachment; galerie: Attachment[]; sources: Record<string, string> } | null>(null);
  const pieces = state.attachments;
  const piecesRef = React.useRef(pieces);
  piecesRef.current = pieces;

  React.useEffect(() => {
    let vivant = true;
    const connue = (id: string | null) =>
      id
        ? Object.values(piecesRef.current ?? {})
            .flat()
            .find((p) => p?.id === id)
        : undefined;
    const pieceDe = (m: MediaDuLien, mime: string, nom: string): Attachment =>
      connue(m.piece) ?? { id: m.piece ?? m.adresse, projectId: '', name: nom, mime, size: 0, sha: '', createdAt: 0 };
    const surDemande = (event: Event) => {
      const media = (event as CustomEvent<MediaDuLien>).detail;
      if (!media?.adresse) return;
      const suite = suiteDuFil(media);
      const poser = (mime: string, nom: string) => {
        if (!vivant) return;
        const sources: Record<string, string> = {};
        const galerie = suite.map((m) => {
          const p = m === media ? pieceDe(m, mime, nom) : pieceDe(m, mimeDuGenre(m.genre, m.nom), m.nom);
          sources[p.id] = m.adresse;
          return p;
        });
        const piece = galerie[suite.indexOf(media)] ?? pieceDe(media, mime, nom);
        setOuvert({ piece, galerie: galerie.length ? galerie : [piece], sources: { ...sources, [piece.id]: media.adresse } });
      };
      const deja = connue(media.piece);
      if (deja) return poser(deja.mime, deja.name);
      if (media.genre !== 'inconnu') return poser(mimeDuGenre(media.genre, media.nom), media.nom);
      void typeAnnonce(media.adresse).then((lu) => poser(lu?.mime || 'application/octet-stream', lu?.nom || media.nom));
    };
    window.addEventListener(EVENEMENT_OUVRIR_UN_MEDIA, surDemande);
    return () => {
      vivant = false;
      window.removeEventListener(EVENEMENT_OUVRIR_UN_MEDIA, surDemande);
    };
  }, []);

  if (!ouvert) return null;
  return (
    <AttachmentPreview
      item={ouvert.piece}
      galerie={ouvert.galerie}
      onClose={() => setOuvert(null)}
      sourceDe={(p) => ouvert.sources[p.id] ?? `/api/attachment?id=${encodeURIComponent(p.id)}`}
      adresse="apercu-media"
    />
  );
}

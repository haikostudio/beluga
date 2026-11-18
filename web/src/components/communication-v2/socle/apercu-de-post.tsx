import * as React from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageCircle, MoreHorizontal, Music2, Repeat2, Send, Share2, ThumbsUp } from '@/components/ui/icones';
import type { CompteSocial } from '@beluga/shared';
import { LogoReseau } from '@/components/logos-reseaux';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import type { LigneDeMarque } from './contexte';
import { LogoDeMarque } from './logo-de-marque';
import { estUnReseau, libelleDuCanal, useLecture } from './pieces';

/** Un visuel du post : une image, ou une vidéo avec son affiche. */
export interface VisuelDePost {
  piece: string;
  genre: string;
  affiche?: string | null;
}

/**
 * L'APERÇU RÉALISTE D'UN POST (décision de l'utilisateur du 04/11/2026 : « une carte qui illustre le post en vrai sur
 * l'app pour voir le résultat ») — la publication telle qu'elle paraîtra sur le réseau : Instagram (fil 4:5, reels
 * 9:16, carrousel feuilletable avec ses points), TikTok (9:16, légende en bas, icônes à droite), et une forme sobre
 * pour les autres réseaux. DONNÉES RÉELLES SEULEMENT : le nom et l'avatar du compte relié s'il existe, sinon le nom et
 * le logo de la marque ; AUCUN faux compteur — les icônes paraissent sans chiffre.
 */
/**
 * LA LARGEUR D'UN APERÇU, RÉSEAU PAR RÉSEAU (la vraie taille d'un écran de téléphone) : TikTok 300 px, Instagram 360 px,
 * les autres 400 px. Le tiroir d'aperçu s'aligne dessus (15/11/2026, capture #0a85) : titre, navigation, réseaux,
 * date et « Valider » tiennent dans la même colonne que le post.
 */
export function largeurDeLApercu(reseau: string): number {
  return reseau === 'tiktok' ? 300 : reseau === 'instagram' ? 360 : 400;
}

export function ApercuDePost({
  reseau,
  compte,
  marque,
  visuels,
  texte,
  className,
  onRang,
}: {
  reseau: string;
  compte?: Pick<CompteSocial, 'nom' | 'avatar'> | null;
  marque: Pick<LigneDeMarque, 'nom' | 'favicon'>;
  visuels: readonly VisuelDePost[];
  texte: string;
  className?: string;
  /** Le rang de l'image affichée du carrousel, à chaque changement (la fiche d'un média cite l'image regardée). */
  onRang?: (rang: number) => void;
}) {
  const nom = compte?.nom || marque.nom;
  const identifiant = nom.toLowerCase().replace(/[^a-z0-9._]+/g, '');
  const avatar = (taille: number) =>
    compte?.avatar ? <img src={compte.avatar} alt="" className="shrink-0 rounded-full object-cover" style={{ width: taille, height: taille }} /> : <LogoDeMarque marque={marque} taille={taille} />;
  const video = visuels[0]?.genre === 'video';
  const repere = { 'data-communication-apercu-post': reseau, 'data-visuels': visuels.length };
  if (reseau === 'tiktok') {
    return (
      <div className={cn('relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-2xl bg-encre text-encre-fg', className)} {...repere}>
        <Visuels visuels={visuels} cadre="absolute inset-0" ajuster="cover" sombre onRang={onRang} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-encre/70 to-transparent" />
        <div className="absolute bottom-16 right-2 flex flex-col items-center gap-4" aria-hidden>
          <span className="rounded-full ring-2 ring-encre-fg/80">{avatar(36)}</span>
          <Heart className="h-7 w-7" />
          <MessageCircle className="h-7 w-7" />
          <Bookmark className="h-7 w-7" />
          <Share2 className="h-7 w-7" />
        </div>
        <div className="absolute inset-x-3 bottom-3 pr-12">
          <p className="text-[13px] font-semibold">@{identifiant || nom}</p>
          <Legende texte={texte} lignes={2} className="text-[12.5px] leading-snug" bouton="text-encre-fg/70" />
          <p className="mt-1 flex items-center gap-1 text-[11.5px] text-encre-fg/70">
            <Music2 className="h-3 w-3" />
            {t('son original · {nom}', { nom })}
          </p>
        </div>
      </div>
    );
  }
  if (reseau === 'instagram') {
    return (
      <div className={cn('mx-auto w-full max-w-[360px] overflow-hidden rounded-2xl bg-surface text-text shadow-sm', className)} {...repere}>
        <header className="flex items-center gap-2 px-3 py-2">
          {avatar(30)}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{identifiant || nom}</span>
          <MoreHorizontal className="h-4 w-4 text-muted" aria-hidden />
        </header>
        <Visuels visuels={visuels} cadre={video ? 'aspect-[9/16] max-h-[520px]' : 'aspect-[4/5]'} ajuster="cover" points onRang={onRang} />
        <div className="flex items-center gap-3.5 px-3 pb-1 pt-2.5" aria-hidden>
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
          <span className="flex-1" />
          <Bookmark className="h-6 w-6" />
        </div>
        <div className="px-3 pb-3">
          <Legende texte={texte} lignes={2} prefixe={identifiant || nom} className="text-[13px] leading-snug" />
        </div>
      </div>
    );
  }
  /* LES AUTRES RÉSEAUX : une forme sobre — en-tête, texte, visuel, gestes sans chiffres. */
  const format = reseau === 'youtube' ? 'aspect-video' : reseau === 'pinterest' ? 'aspect-[2/3]' : 'aspect-square';
  const gestes = reseau === 'x' || reseau === 'threads' ? [MessageCircle, Repeat2, Heart, Share2] : [ThumbsUp, MessageCircle, Share2];
  return (
    <div className={cn('mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl bg-surface text-text shadow-sm', className)} {...repere}>
      <header className="flex items-center gap-2 px-3 py-2.5">
        {avatar(32)}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{nom}</span>
          <span className="block truncate text-[11.5px] text-muted">{estUnReseau(reseau) ? libelleDuCanal(reseau) : reseau}</span>
        </span>
        {estUnReseau(reseau) ? <LogoReseau reseau={reseau} className="h-4 w-4" /> : null}
      </header>
      {texte ? (
        <div className="px-3 pb-2">
          <Legende texte={texte} lignes={3} className="text-[13px] leading-snug" />
        </div>
      ) : null}
      {visuels.length ? <Visuels visuels={visuels} cadre={format} ajuster="cover" points onRang={onRang} /> : null}
      <div className="flex items-center justify-around px-3 py-2 text-muted" aria-hidden>
        {gestes.map((Icone, i) => (
          <Icone key={i} className="h-5 w-5" />
        ))}
      </div>
    </div>
  );
}

/** La légende, repliée sur quelques lignes, avec « plus » — le bouton est À CÔTÉ du texte replié, jamais autour. */
function Legende({ texte, lignes, prefixe, className, bouton }: { texte: string; lignes: 2 | 3; prefixe?: string; className?: string; bouton?: string }) {
  const [ouverte, setOuverte] = React.useState(false);
  const long = texte.length > (lignes === 2 ? 90 : 160) || texte.split('\n').length > lignes;
  if (!texte) return null;
  return (
    <div className={className} data-communication-legende>
      <p className={cn('whitespace-pre-line break-words', !ouverte && (lignes === 2 ? 'line-clamp-2' : 'line-clamp-3'))}>
        {prefixe ? <b className="mr-1 font-semibold">{prefixe}</b> : null}
        {texte}
      </p>
      {long ? (
        <button type="button" className={cn('text-[12.5px]', bouton ?? 'text-muted')} onClick={() => setOuverte((o) => !o)} data-communication-legende-plus>
          {ouverte ? t('moins') : t('plus')}
        </button>
      ) : null}
    </div>
  );
}

/** Les visuels d'un post : un seul, ou un carrousel qu'on feuillette (flèches, points, glissé du doigt). */
function Visuels({
  visuels,
  cadre,
  ajuster,
  points,
  sombre,
  onRang,
}: {
  visuels: readonly VisuelDePost[];
  cadre: string;
  ajuster: 'cover' | 'contain';
  points?: boolean;
  sombre?: boolean;
  onRang?: (rang: number) => void;
}) {
  const [rang, setRang] = React.useState(0);
  const depart = React.useRef<number | null>(null);
  React.useEffect(() => setRang(0), [visuels.map((v) => v.piece).join('|')]);
  const signaler = React.useRef(onRang);
  signaler.current = onRang;
  React.useEffect(() => signaler.current?.(rang), [rang]);
  const v = visuels[Math.min(rang, visuels.length - 1)];
  const aller = (d: number) => setRang((r) => Math.max(0, Math.min(visuels.length - 1, r + d)));
  const objet = ajuster === 'cover' ? 'object-cover' : 'object-contain';
  return (
    <div
      className={cn('group/visuels relative w-full touch-pan-y overflow-hidden', sombre ? 'bg-encre' : 'bg-raised', cadre)}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') depart.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (depart.current === null) return;
        const dx = e.clientX - depart.current;
        depart.current = null;
        if (Math.abs(dx) > 40) aller(dx < 0 ? 1 : -1);
      }}
      data-communication-visuels-post={visuels.length}
      data-rang={rang}
    >
      {!v ? (
        <span className="flex h-full w-full items-center justify-center text-[12px] text-faint">{t('Visuel à venir')}</span>
      ) : v.genre === 'video' ? (
        <video key={v.piece} src={adresseDePiece(v.piece)} poster={v.affiche ? adresseDePiece(v.affiche, false, 640) : undefined} controls muted playsInline className={cn('h-full w-full', objet)} />
      ) : (
        <img key={v.piece} src={adresseDePiece(v.piece, false, 1080)} alt="" draggable={false} className={cn('h-full w-full', objet)} />
      )}
      {visuels.length > 1 ? (
        <>
          <span className="absolute right-2 top-2 rounded-full bg-encre/60 px-2 py-0.5 text-[11px] tabular-nums text-encre-fg">
            {rang + 1}/{visuels.length}
          </span>
          {rang > 0 ? (
            <button type="button" aria-label="Image précédente" onClick={() => aller(-1)} className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-encre/50 text-encre-fg opacity-0 transition-opacity group-hover/visuels:opacity-100 [@media(hover:none)]:hidden" data-communication-post-precedent>
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
          {rang < visuels.length - 1 ? (
            <button type="button" aria-label="Image suivante" onClick={() => aller(1)} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-encre/50 text-encre-fg opacity-0 transition-opacity group-hover/visuels:opacity-100 [@media(hover:none)]:hidden" data-communication-post-suivant>
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : null}
          {points ? (
            <span className="absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden>
              {visuels.map((x, i) => (
                <span key={x.piece} className={cn('h-1.5 w-1.5 rounded-full', i === rang ? 'bg-encre-fg' : 'bg-encre-fg/50')} />
              ))}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les données d'un post, lues une fois pour la page                    */
/* ------------------------------------------------------------------ */

interface ContenuDuPost {
  id: string;
  titre: string;
  texte: string;
  canal: string;
  canaux: string[];
  etape: string;
  datePrevue?: string | null;
  heurePrevue?: string | null;
  campagneId?: string | null;
  apercu: { attachmentId: string; genre: string } | null;
}

interface MediaDuPost {
  cle: string;
  genre: string;
  attachmentId: string | null;
  afficheId?: string | null;
  utilise: { contenuId: string; canal: string }[];
  carrousel?: { id: string; genre: string }[];
}

export interface PostLisible {
  contenu: ContenuDuPost;
  reseau: string;
  visuels: VisuelDePost[];
  compte: Pick<CompteSocial, 'nom' | 'avatar'> | null;
}

/**
 * CE QU'IL FAUT POUR MONTRER UN POST « EN VRAI » : ses textes (publications), ses visuels (le média qui le porte et
 * les autres images de son carrousel) et le compte relié du réseau. Deux lectures, partagées par toute la page.
 */
export function usePostsDeMarque(marqueId: string) {
  const { donnees: pubs } = useLecture<{ contenus: ContenuDuPost[]; comptes: CompteSocial[] }>({ type: 'communication.publications', marqueId, periode: 30 }, [marqueId]);
  const { donnees: meds } = useLecture<{ medias: MediaDuPost[]; visuelsDesPosts?: Record<string, { id: string; genre: string }[]> }>({ type: 'communication.medias', marqueId }, [marqueId]);
  return React.useMemo(() => {
    const comptes = pubs?.comptes ?? [];
    const compteDu = (reseau: string) => {
      const c = comptes.find((x) => x.reseau === reseau && x.etat === 'relie') ?? comptes.find((x) => x.reseau === reseau);
      return c ? { nom: c.nom, ...(c.avatar ? { avatar: c.avatar } : {}) } : null;
    };
    const visuelsDu = (contenu: ContenuDuPost): VisuelDePost[] => {
      /* L'ORDRE DU POST d'abord (carte du 04/11/2026) : un carrousel se feuillette 1 → N, l'affiche d'une vidéo reprise de son média. */
      const ordre = meds?.visuelsDesPosts?.[contenu.id];
      if (ordre?.length) return ordre.map((x) => ({ piece: x.id, genre: x.genre, affiche: meds?.medias.find((m) => m.attachmentId === x.id)?.afficheId ?? null }));
      const media = meds?.medias.find((m) => m.utilise.some((u) => u.contenuId === contenu.id));
      if (media?.attachmentId) {
        return [{ piece: media.attachmentId, genre: media.genre, affiche: media.afficheId ?? null }, ...(media.carrousel ?? []).map((x) => ({ piece: x.id, genre: x.genre }))];
      }
      return contenu.apercu ? [{ piece: contenu.apercu.attachmentId, genre: contenu.apercu.genre }] : [];
    };
    const post = (contenu: ContenuDuPost, reseau?: string): PostLisible => {
      const r = reseau ?? contenu.canaux.find(estUnReseau) ?? contenu.canal;
      return { contenu, reseau: r, visuels: visuelsDu(contenu), compte: compteDu(r) };
    };
    return { pret: !!pubs && !!meds, contenus: pubs?.contenus ?? [], compteDu, post, visuelsDu };
  }, [pubs, meds]);
}

/*
 * LE PORTRAIT D'UN AGENT D'ÉQUIPE (carte « Beluga piloté par des agents », 26/11/2026) : son visage dans un rond, cerné
 * de SA couleur quand il est à la table, gris quand il est au repos sur le banc ; et son ÉTAT EN FORMES — un point
 * (`--important`) quand il vous attend, un anneau qui tourne quand il travaille, rien au repos (préférence de
 * l'utilisateur : des formes, jamais un badge texte de plus). Les portraits sont l'exception colorée de l'interface,
 * demandée par l'utilisateur ; tout le reste garde les jetons gris.
 */
import * as React from 'react';
import { adresseDuPortrait, type EtatDuMembre } from '@beluga/shared';
import { cn } from '@/lib/utils';

export function PortraitDAgent({
  portrait,
  couleur,
  nom,
  taille = 32,
  cerne = false,
  gris = false,
  attend = false,
  className,
  fond = 'var(--fond-du-portrait, hsl(var(--bg)))',
}: {
  portrait: string | null | undefined;
  couleur: string;
  nom: string;
  taille?: number;
  /** Cerné de sa couleur : l'agent est à la table (ou ouvert). */
  cerne?: boolean;
  /** Au repos sur le banc : visage désaturé. */
  gris?: boolean;
  /** Il vous attend : le point au coin bas droit. */
  attend?: boolean;
  className?: string;
  /** La couleur du liseré entre le visage et l'anneau (le fond sur lequel il est posé). */
  fond?: string;
}) {
  const adresse = adresseDuPortrait(portrait);
  const [rate, setRate] = React.useState(false);
  const epaisseur = taille >= 44 ? 2.5 : 2;
  return (
    <span
      className={cn('relative inline-flex shrink-0 rounded-full', className)}
      style={{
        width: taille,
        height: taille,
        boxShadow: cerne ? `0 0 0 ${epaisseur}px ${fond}, 0 0 0 ${epaisseur * 2}px ${couleur}` : undefined,
      }}
      data-portrait-d-agent={portrait ?? ''}
    >
      {adresse && !rate ? (
        <img
          src={adresse}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setRate(true)}
          className={cn('h-full w-full rounded-full object-cover', gris && 'opacity-70 grayscale')}
        />
      ) : (
        <span
          aria-hidden
          className={cn('flex h-full w-full items-center justify-center rounded-full font-semibold text-white', gris && 'opacity-70 grayscale')}
          style={{ background: couleur, fontSize: Math.max(10, Math.round(taille * 0.42)) }}
        >
          {nom.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
      {attend ? (
        <span
          aria-hidden
          className="absolute rounded-full bg-important"
          style={{
            width: Math.max(7, Math.round(taille * 0.2)),
            height: Math.max(7, Math.round(taille * 0.2)),
            right: -1,
            bottom: -1,
            boxShadow: `0 0 0 2px ${fond}`,
          }}
          data-point-vous-attend=""
        />
      ) : null}
    </span>
  );
}

/** L'ÉTAT EN FORME, au bout d'une ligne : le point « vous attend », l'anneau « au travail », rien au repos. */
export function EtatEnForme({ etat, className }: { etat: EtatDuMembre; className?: string }) {
  if (etat === 'vous-attend')
    return <span aria-hidden className={cn('block h-2 w-2 shrink-0 rounded-full bg-important', className)} data-etat-en-forme="vous-attend" />;
  if (etat === 'au-travail')
    return (
      /* L'enveloppe garde sa taille : un contrôle mesure l'enveloppe, jamais l'anneau qui tourne. */
      <span aria-hidden className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center', className)} data-etat-en-forme="au-travail">
        <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted border-r-transparent" />
      </span>
    );
  return null;
}

/** UNE PILE DE PORTRAITS qui se chevauchent (« 16 autres », la cible « Toute l'équipe »). */
export function PileDePortraits({
  membres,
  taille = 20,
  max = 4,
  fond,
}: {
  membres: readonly { id: string; portrait: string | null; couleur: string; nom: string }[];
  taille?: number;
  max?: number;
  fond?: string;
}) {
  return (
    <span className="flex shrink-0 items-center" data-pile-de-portraits={membres.length}>
      {membres.slice(0, max).map((m, i) => (
        <span key={m.id} className="rounded-full" style={{ marginLeft: i ? -Math.round(taille * 0.32) : 0, boxShadow: `0 0 0 1.5px ${fond ?? 'hsl(var(--bg))'}` }}>
          <PortraitDAgent portrait={m.portrait} couleur={m.couleur} nom={m.nom} taille={taille} />
        </span>
      ))}
    </span>
  );
}

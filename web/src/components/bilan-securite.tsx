import * as React from 'react';
import { completerLeBilan, lireLeBilan, nomDeCategorie, rangerLeBilan, type LigneDuBilan, type PointDeLaCarte, type StatutDuBilan } from '@beluga/shared';
import { ContexteCarteDuFil } from '@/components/menu-du-media';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE BILAN D'UNE CORRECTION DE SÉCURITÉ, EN LISTE À COCHER (carte « Sécurité : bilan, écran et historique »,
 * 25/11/2026, maquette #83c01).
 *
 * Posé à la place du bloc ```bilan-securite``` que l'agent correcteur recopie dans « Ce qui est fait »
 * (`shared/src/bilan-securite.ts`). Un compteur, puis trois groupes dans l'ordre Pas fait → À finir → Fait ; chaque
 * point avec son signe à gauche (croix sur cercle filaire, « ! » sur la teinte importante, coche pleine), son titre,
 * sa catégorie en étiquette, puis « But : » et « Fait : ».
 *
 * Dans le fil d'une carte, les points qu'elle emporte sont relus au démon : un point que l'agent a oublié s'ajoute en
 * « Pas fait — non traité », et une ligne qui attendait la mise en production passe à la coche une fois son geste
 * appliqué. Un bloc illisible ne s'affiche jamais vide : `null`, et le texte reste du code.
 */

interface BilanDuDemon {
  points: PointDeLaCarte[];
  gestes: { id: string; empreinte: string | null; libelle: string; creeLe: number; appliqueLe: number | null }[];
}

function useBilanDeLaCarte(cardId: string | null): BilanDuDemon | null {
  const [bilan, setBilan] = React.useState<BilanDuDemon | null>(null);
  React.useEffect(() => {
    if (!cardId) return;
    let vivant = true;
    client
      .call<BilanDuDemon>({ type: 'securite.bilanDeLaCarte', cardId })
      .then((r) => vivant && setBilan({ points: r.points ?? [], gestes: r.gestes ?? [] }))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [cardId]);
  return bilan;
}

function dateCourte(at: number): string {
  return new Date(at).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short' });
}

/** Les lignes à montrer : celles de l'agent, complétées par la carte, et les gestes appliqués passés à la coche. */
export function lignesAffichees(lignes: LigneDuBilan[], demon: BilanDuDemon | null): (LigneDuBilan & { appliqueLe?: number })[] {
  const completes = demon?.points.length ? completerLeBilan(lignes, demon.points) : lignes;
  if (!demon?.gestes.length) return completes;
  return completes.map((l) => {
    if (!l.production) return l;
    const siens = demon.gestes.filter((g) => g.empreinte === l.empreinte);
    if (!siens.length || siens.some((g) => !g.appliqueLe)) return l;
    return { ...l, statut: 'fait' as const, appliqueLe: Math.max(...siens.map((g) => g.appliqueLe!)) };
  });
}

export function BilanDeSecurite({ texte }: { texte: string }) {
  const cardId = React.useContext(ContexteCarteDuFil);
  const demon = useBilanDeLaCarte(cardId);
  const lues = React.useMemo(() => lireLeBilan(texte), [texte]);
  const lignes = React.useMemo(() => (lues ? lignesAffichees(lues, demon) : null), [lues, demon]);
  if (!lignes) {
    return (
      <pre>
        <code>{texte}</code>
      </pre>
    );
  }
  const { groupes, compte } = rangerLeBilan(lignes);
  const nomDuGroupe = (s: StatutDuBilan) => (s === 'pas-fait' ? t('Pas fait') : s === 'a-finir' ? t('À finir') : t('Fait'));
  return (
    <div className="not-prose my-2 flex min-w-0 flex-col gap-4" data-bilan-securite={compte.total}>
      <div className="text-[14px] text-muted" data-bilan-compteur="">
        <span className="font-semibold text-text">
          {compte.fait > 1 ? t('{v0} faits', { v0: compte.fait }) : t('{v0} fait', { v0: compte.fait })} · {t('{v0} à finir', { v0: compte['a-finir'] })} ·{' '}
          {t('{v0} pas fait', { v0: compte['pas-fait'] })}
        </span>{' '}
        — {t('sur {v0} points détectés', { v0: compte.total })}
      </div>
      {groupes.map((g) => (
        <section key={g.statut} className="flex min-w-0 flex-col" data-bilan-groupe={g.statut}>
          <div className="border-b border-faint/30 pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
            {nomDuGroupe(g.statut)} <span className="ml-1 font-normal text-faint">{g.lignes.length}</span>
          </div>
          <div className="flex min-w-0 flex-col">
            {g.lignes.map((l, i) => (
              <LigneDeBilan key={`${l.empreinte}:${i}`} ligne={l} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SigneDuStatut({ statut }: { statut: StatutDuBilan }) {
  if (statut === 'fait')
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-text text-bg" aria-label="Fait">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
    );
  if (statut === 'a-finir')
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-important text-[13px] font-bold leading-none text-white" aria-label="À finir">
        !
      </span>
    );
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-text ring-[1.5px] ring-inset ring-text" aria-label="Pas fait">
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </span>
  );
}

function LigneDeBilan({ ligne: l }: { ligne: LigneDuBilan & { appliqueLe?: number } }) {
  const attendLaProduction = l.production && l.statut === 'a-finir';
  return (
    <div className="flex min-w-0 gap-3 border-t border-faint/30 py-3 first:border-t-0" data-bilan-ligne={l.empreinte} data-bilan-statut={l.statut}>
      <span className="pt-0.5">
        <SigneDuStatut statut={l.statut} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 select-text break-words text-[14.5px] font-semibold text-text">{l.titre}</span>
          {l.categorie ? (
            <span className="shrink-0 rounded-md bg-raised px-2 py-px text-[12px] text-muted" data-bilan-categorie={l.categorie}>
              {nomDeCategorie(l.categorie)}
            </span>
          ) : null}
        </div>
        {l.but ? (
          <div className="select-text text-[13.5px] leading-snug text-text">
            {t('But :')} {l.but}
          </div>
        ) : null}
        <div className="select-text text-[13.5px] leading-snug text-muted">
          <span className="text-text">{t('Fait :')}</span> {l.fait || '—'}
          {attendLaProduction ? <span className={cn('text-important')}> {t('Attend votre mise en production.')}</span> : null}
          {l.appliqueLe ? <span className="text-text"> {t('Appliqué en production le {v0}.', { v0: dateCourte(l.appliqueLe) })}</span> : null}
        </div>
      </div>
    </div>
  );
}

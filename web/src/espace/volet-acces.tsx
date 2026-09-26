/**
 * L'ESPACE « ACCÈS » — LES INFORMATIONS D'ACCÈS LIBRES D'UN PROJET HÉBERGÉ.
 *
 * VU PAR LE CLIENT, IL EST VERROUILLÉ PAR DÉFAUT. Il lit le texte de
 * responsabilité, coche la case, puis « J'assume et j'ouvre l'accès » : le
 * démon inscrit le geste au journal (compte, date, version du texte) et
 * prévient Haiko. Le contenu n'arrive qu'APRÈS — il n'est jamais envoyé puis
 * masqué par l'écran (`contenuDAccesVisible`, côté serveur).
 *
 * UNE FOIS OUVERT, UN BANDEAU PERMANENT LE DIT : les trois mentions de
 * `MENTIONS_ACCES_OUVERT` et « Ouvert par … le … ». Ce n'est pas un
 * avertissement qu'on ferme.
 *
 * VU PAR HAIKO : le même état, un éditeur du contenu, le journal des
 * ouvertures, et le bouton qui referme.
 */
import * as React from 'react';
import { KeyRound, Loader2, Lock, LockOpen, ShieldAlert, X } from 'lucide-react';
import {
  BOUTON_OUVRIR_ACCES,
  CONFIRMATION_ACCES,
  MENTIONS_ACCES_OUVERT,
  TEXTE_ACCES_MAX,
  TEXTE_DE_RESPONSABILITE,
  type EntreeJournalAcces,
  type EtatDeLAcces,
} from '@beluga/shared';
import { Button, Textarea, ZoneDefilement } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { canalEspace } from './canal-espace';
import { heureCourte, jourDe } from './formats';
import type { MoiDansLEspace } from './espace-client';

interface VueDeLAcces {
  projectId: string;
  etat: EtatDeLAcces;
  version: number;
  contenu: { texte: string; modifieLe?: number; modifiePar?: string } | null;
  journal?: EntreeJournalAcces[];
}

const quand = (at: number) => `${jourDe(at)} ${heureCourte(at)}`;

export function VoletAcces({
  moi,
  projectId,
  onFermer,
}: {
  moi: MoiDansLEspace;
  projectId: string;
  onFermer?: () => void;
}) {
  const [vue, setVue] = React.useState<VueDeLAcces | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [coche, setCoche] = React.useState(false);
  const [geste, setGeste] = React.useState<'ouvrir' | 'ecrire' | 'fermer' | null>(null);
  const [brouillon, setBrouillon] = React.useState<string | null>(null);
  const haiko = moi.role === 'admin';

  const recharger = React.useCallback(() => {
    void canalEspace
      .demander({ type: 'espace.acces.lire', projectId: projectId || undefined })
      .then((reponse: VueDeLAcces) => {
        setVue(reponse);
        setErreur(null);
      })
      .catch((err) => setErreur(err?.message ?? t('L’espace « Accès » n’a pas pu être lu.')));
  }, [projectId]);

  React.useEffect(() => {
    setVue(null);
    setCoche(false);
    setBrouillon(null);
    recharger();
  }, [recharger]);
  React.useEffect(() => canalEspace.surChangementDEtat((etat) => etat === 'en-ligne' && recharger()), [recharger]);
  React.useEffect(
    () =>
      canalEspace.ecouter((event) => {
        if (event.type === 'espace.acces' && (event as { projectId?: string }).projectId === projectId) recharger();
      }),
    [recharger, projectId],
  );

  const agir = async (quoi: 'ouvrir' | 'ecrire' | 'fermer', cmd: Parameters<typeof canalEspace.demander>[0]) => {
    setGeste(quoi);
    try {
      const reponse = await canalEspace.demander<VueDeLAcces>(cmd);
      setVue(reponse);
      setErreur(null);
      if (quoi === 'ecrire') setBrouillon(null);
    } catch (err: any) {
      setErreur(err?.message ?? t('Le geste n’a pas pu aboutir.'));
    } finally {
      setGeste(null);
    }
  };

  const ouvert = Boolean(vue?.etat.ouvert);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-volet-acces
      data-acces-etat={vue ? (ouvert ? 'ouvert' : 'verrouille') : undefined}
    >
      <div className="flex items-center gap-2 border-b border-faint/40 px-3 py-2">
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{t('Accès')}</span>
        {vue ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-[11px]',
              ouvert ? 'bg-danger/15 text-danger' : 'bg-raised text-muted',
            )}
          >
            {ouvert ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {ouvert ? t('Ouvert') : t('Verrouillé')}
          </span>
        ) : null}
        {onFermer ? (
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <ZoneDefilement className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {erreur ? <p className="text-[12.5px] text-danger">{erreur}</p> : null}

        {!vue ? (
          <div className="flex flex-col gap-1.5" aria-hidden data-silhouette-acces>
            <div className="h-20 animate-pulse rounded-md bg-raised" />
            <div className="h-10 animate-pulse rounded-md bg-raised" />
          </div>
        ) : (
          <>
            {ouvert ? (
              /* LE BANDEAU PERMANENT : il ne se ferme pas, il dit ce qui a changé. */
              <div className="flex flex-col gap-1.5 rounded-md bg-danger/10 px-3 py-2.5" data-bandeau-acces-ouvert>
                <p className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-danger">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {t('Accès ouvert')}
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-snug text-text">
                  {MENTIONS_ACCES_OUVERT.map((mention) => (
                    <li key={mention} data-mention-acces>
                      {t(mention)}
                    </li>
                  ))}
                </ul>
                {vue.etat.ouvertPar && vue.etat.ouvertLe ? (
                  <p className="text-[12px] text-muted" data-acces-ouvert-par>
                    {t('Ouvert par {nom} le {date}', { nom: vue.etat.ouvertPar, date: quand(vue.etat.ouvertLe) })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!haiko && !ouvert ? (
              /* L'ÉCRAN VERROUILLÉ : le texte, la case, le bouton. */
              <div className="flex flex-col gap-2.5" data-acces-verrouille>
                <p className="text-[13px] leading-relaxed text-text">{t(TEXTE_DE_RESPONSABILITE)}</p>
                <p className="text-[12px] font-medium uppercase tracking-wide text-faint">{t('Une fois l’accès ouvert')}</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-snug text-muted">
                  {MENTIONS_ACCES_OUVERT.map((mention) => (
                    <li key={mention}>{t(mention)}</li>
                  ))}
                </ul>
                <label className="flex cursor-pointer items-start gap-2 rounded-md bg-raised px-2.5 py-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--danger))]"
                    checked={coche}
                    onChange={(event) => setCoche(event.target.checked)}
                    data-acces-confirmation
                  />
                  <span>{t(CONFIRMATION_ACCES)}</span>
                </label>
                <Button
                  onClick={() =>
                    void agir('ouvrir', {
                      type: 'espace.acces.deverrouiller',
                      projectId: vue.projectId,
                      confirme: coche,
                      version: vue.version,
                    })
                  }
                  disabled={!coche || geste !== null}
                  className="w-full bg-danger text-bg hover:bg-danger/90"
                  data-acces-ouvrir
                >
                  {geste === 'ouvrir' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
                  {t(BOUTON_OUVRIR_ACCES)}
                </Button>
              </div>
            ) : null}

            {!haiko && ouvert ? (
              vue.contenu?.texte ? (
                <pre
                  className="select-text whitespace-pre-wrap break-words rounded-md bg-raised px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-text"
                  data-acces-contenu
                >
                  {vue.contenu.texte}
                </pre>
              ) : (
                <p className="text-[13px] text-muted" data-acces-contenu-vide>
                  {t('Haiko n’a encore rien inscrit dans cet espace.')}
                </p>
              )
            ) : null}

            {haiko ? (
              <div className="flex flex-col gap-2" data-acces-editeur>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  {ouvert
                    ? t('Le client voit ce contenu : il a ouvert l’accès et en a pris la responsabilité.')
                    : t('Le client ne voit pas ce contenu tant qu’il n’a pas ouvert l’accès.')}
                </p>
                <Textarea
                  value={brouillon ?? vue.contenu?.texte ?? ''}
                  onChange={(event) => setBrouillon(event.target.value)}
                  rows={8}
                  maxLength={TEXTE_ACCES_MAX}
                  className="font-mono text-[12.5px]"
                  placeholder={t('Hôte, identifiants, adresse d’administration…')}
                  data-acces-texte
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void agir('ecrire', { type: 'espace.acces.ecrire', projectId: vue.projectId, texte: brouillon ?? '' })
                    }
                    disabled={brouillon === null || geste !== null}
                    data-acces-enregistrer
                  >
                    {geste === 'ecrire' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t('Enregistrer')}
                  </Button>
                  {ouvert ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void agir('fermer', { type: 'espace.acces.reverrouiller', projectId: vue.projectId })}
                      disabled={geste !== null}
                      data-acces-refermer
                    >
                      {geste === 'fermer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                      {t('Refermer l’accès')}
                    </Button>
                  ) : null}
                  {vue.contenu?.modifieLe ? (
                    <span className="text-[11.5px] text-faint">
                      {t('Modifié par {nom} le {date}', {
                        nom: vue.contenu.modifiePar ?? '',
                        date: quand(vue.contenu.modifieLe),
                      })}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] font-medium uppercase tracking-wide text-faint">{t('Journal des ouvertures')}</p>
                {vue.journal?.length ? (
                  <ul className="flex flex-col gap-1" data-acces-journal>
                    {[...vue.journal].reverse().map((entree) => (
                      <li key={entree.id} className="text-[12.5px] text-muted">
                        {entree.geste === 'deverrouillage'
                          ? t('{nom} a ouvert l’accès le {date}', { nom: entree.nom, date: quand(entree.le) })
                          : t('{nom} a refermé l’accès le {date}', { nom: entree.nom, date: quand(entree.le) })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-faint">{t('Personne n’a encore ouvert cet accès.')}</p>
                )}
              </div>
            ) : null}
          </>
        )}
      </ZoneDefilement>
    </div>
  );
}

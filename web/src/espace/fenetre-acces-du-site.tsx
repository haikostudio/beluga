/**
 * LA FENÊTRE DES ACCÈS D'UNE VERSION DU SITE (carte « Connexion Haiko pour les sites clients », 25/11/2026,
 * maquette #2c1d).
 *
 * Un clic sur « Site en ligne » ou « Version de travail », dans « Voir mon site », ouvre cette fenêtre quand l'accès
 * administrateur de la version est noté : l'adresse de connexion, l'identifiant et le mot de passe, chacun avec son
 * bouton « copier », et un bouton principal qui OUVRE L'ADMINISTRATION EN COPIANT LE MOT DE PASSE.
 *
 * - Le secret n'est demandé qu'à l'ouverture (`espace.accesDuSite`), une silhouette tient sa place pendant ce temps.
 * - Le bouton principal lance la copie SANS L'ATTENDRE, puis ouvre l'onglet dans le même geste : attendre la copie
 *   ferait bloquer l'ouverture par le navigateur (fenêtre surgissante hors d'un clic). Une copie refusée (navigateur,
 *   iPhone) le dit, et laisse les boutons « copier ».
 * - Ordinateur : fenêtre centrée ; téléphone : la même fenêtre devient la feuille commune du bas (`DialogContent`).
 */
import * as React from 'react';
import { ArrowUpRight, Globe, KeyRound } from '@/components/ui/icones';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Label } from '@/components/ui';
import { ChampACopier } from '@/components/champ-a-copier';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { hoteDuSite, type AccesClient, type VersionDAcces } from '@beluga/shared';
import { canalEspace } from './canal-espace';

/** Une valeur en lecture, avec son bouton « copier » (et l'œil pour un mot de passe). */
function ValeurACopier({ libelle, valeur, secret, repere }: { libelle: string; valeur: string; secret?: boolean; repere: string }) {
  const id = React.useId();
  return (
    <div className="space-y-1.5" data-acces-valeur={repere}>
      <Label htmlFor={id}>{libelle}</Label>
      <ChampACopier id={id} valeur={valeur} secret={secret} readOnly repere={repere} />
    </div>
  );
}

export function FenetreAccesDuSite({
  projectId,
  version,
  libelle,
  adresseDuSite,
  onFermer,
}: {
  projectId: string;
  version: VersionDAcces;
  /** Le nom de la version, déjà traduit (« Site en ligne »). */
  libelle: string;
  adresseDuSite: string;
  onFermer: () => void;
}) {
  /* `undefined` : en chargement ; `null` : plus rien de noté (retiré entre-temps). */
  const [acces, setAcces] = React.useState<AccesClient | null | undefined>(undefined);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [copie, setCopie] = React.useState<'ok' | 'refus' | null>(null);

  React.useEffect(() => {
    let vivant = true;
    setAcces(undefined);
    setErreur(null);
    canalEspace
      .demander<AccesClient | null>({ type: 'espace.accesDuSite', projectId, version })
      .then((lu) => vivant && setAcces(lu ?? null))
      .catch((err) => vivant && setErreur(err?.message ?? t('Vos accès n’ont pas pu être lus.')));
    return () => {
      vivant = false;
    };
  }, [projectId, version]);

  const ouvrir = () => {
    if (!acces) return;
    /* La copie part SANS être attendue : l'onglet doit s'ouvrir dans le même geste, sinon le navigateur le bloque. */
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(acces.motDePasse).then(
        () => setCopie('ok'),
        () => setCopie('refus'),
      );
    } else setCopie('refus');
    window.open(acces.adresse, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="sm:w-[min(460px,100%)]" data-fenetre-acces-du-site={version}>
        <DialogHeader>
          <DialogTitle>{libelle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pb-1">
          <div className="flex min-w-0 items-center justify-between gap-3 text-[14px]">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <Globe className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{hoteDuSite(adresseDuSite)}</span>
            </span>
            <a
              href={adresseDuSite}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1 text-muted transition-colors hover:text-text"
              data-acces-voir-le-site
            >
              {t('Voir le site')}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>

          {erreur ? (
            <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[13px] text-danger" data-acces-erreur>
              {erreur}
            </p>
          ) : acces === undefined ? (
            <div className="space-y-4" aria-hidden data-acces-silhouette>
              <div className="h-4 w-3/5 animate-pulse rounded bg-raised" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-raised" />
                  <div className="h-[38px] animate-pulse rounded-lg bg-raised sm:h-8" />
                </div>
              ))}
            </div>
          ) : acces === null ? (
            <p className="text-[13.5px] leading-snug text-muted" data-acces-absent>
              {t('Les accès à l’administration de cette version ne sont plus notés. Le site, lui, reste ouvert.')}
            </p>
          ) : (
            <>
              <p className="text-[14px] text-muted">{t('Vos accès à l’administration de votre site :')}</p>
              <ValeurACopier libelle={t('Adresse de connexion')} valeur={acces.adresse} repere="adresse" />
              <ValeurACopier libelle={t('Identifiant')} valeur={acces.identifiant} repere="identifiant" />
              <ValeurACopier libelle={t('Mot de passe')} valeur={acces.motDePasse} secret repere="mot-de-passe" />
            </>
          )}
        </div>

        {acces ? (
          <DialogFooter pleineLargeur>
            <Button variant="principal" onClick={ouvrir} className="gap-2" data-acces-ouvrir>
              <KeyRound className="h-4 w-4" aria-hidden />
              {t('Ouvrir l’administration')}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <p
              className={cn('text-center text-[12.5px] leading-snug', copie === 'refus' ? 'text-danger' : 'text-faint')}
              data-acces-copie={copie ?? 'attente'}
            >
              {copie === 'refus'
                ? t('Copiez le mot de passe avec le bouton à côté.')
                : t('Le mot de passe est copié en même temps : collez-le dans la page qui s’ouvre.')}
            </p>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

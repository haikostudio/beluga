import * as React from 'react';
import { ArrowUpRight, Loader2, RefreshCw } from '@/components/ui/icones';
import { volumeLisible, type EtatDesNouveautes, type MesureDeLEspace, type PropositionDuCentral } from '@beluga/shared';
import { Groupe } from '@/components/reglages/communs';
import { LigneDEtat } from '@/components/installation/sections';
import { SortieDuTravail, useTravailDuGenre } from '@/components/installation/travail';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { installationEnDirect, useNouveautes } from '@/lib/travail-installation';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';

type RenduDeLOffre =
  | { ok: true; mesure: MesureDeLEspace; proposition: PropositionDuCentral }
  | { ok: false; mesure?: MesureDeLEspace; raison: string };

/** « 47 € », dans la langue de l'écran. */
function prix(euros: number): string {
  return euros.toLocaleString(formatRegional(), { style: 'currency', currency: 'EUR', maximumFractionDigits: euros % 1 ? 2 : 0 });
}

/**
 * « PASSER À L'OFFRE HÉBERGÉE » — la page d'une installation GRATUITE (carte « Fin de la version gratuite », 21/11/2026).
 *
 * Beluga devient un service hébergé et payant : la version gratuite ne reçoit plus de nouveautés. La page dit
 * pourquoi, montre la taille de l'espace (projets actifs, volume), la formule que le CENTRAL conseille — la plus petite
 * où tout tient — avec son prix, et le bouton « Transférer mon espace » : il ouvre l'abonnement dans un nouvel onglet
 * et lance le travail qui, une fois payé, emballe tout l'espace et l'envoie au serveur hébergé
 * (`server/src/transfert-vers-l-offre.ts`), avancement en direct sous le bouton.
 */
function PageDeLOffre() {
  const { travail, occupe } = useTravailDuGenre('transfert');
  const [rendu, setRendu] = React.useState<RenduDeLOffre | null>(null);
  const [lecture, setLecture] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);

  const lire = React.useCallback(async () => {
    setLecture(true);
    try {
      setRendu(await client.call<RenduDeLOffre>({ type: 'installation.offre' }, 180_000));
    } catch (err: any) {
      setRendu({ ok: false, raison: err?.message ?? t('L’équipe Beluga ne répond pas pour l’instant.') });
    } finally {
      setLecture(false);
    }
  }, []);

  React.useEffect(() => {
    void lire();
  }, [lire]);

  const transferer = async () => {
    if (!rendu?.ok) return;
    setEnvoi(true);
    // L'onglet s'ouvre DANS le geste du clic, sinon le navigateur le bloque.
    window.open(rendu.proposition.lien, '_blank', 'noopener');
    try {
      const r = await client.call<{ ok: boolean; erreur?: string }>({ type: 'installation.transfert', jeton: rendu.proposition.jeton });
      if (!r.ok) client.pushToast('warning', r.erreur ?? t('Le transfert n’a pas pu démarrer.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le transfert n’a pas pu démarrer.'));
    } finally {
      setEnvoi(false);
    }
  };

  const enCours = envoi || travail?.etat === 'en-cours';
  const mesure = rendu?.mesure;

  return (
    <div className="space-y-7" data-page-mise-a-jour="fin-gratuite" data-offre={rendu ? (rendu.ok ? 'proposee' : 'injoignable') : 'lecture'}>
      <Groupe titre={t('Passer à l’offre hébergée')}>
        <p className="text-[13.5px] leading-relaxed text-muted">
          {t(
            'Beluga devient un service hébergé : la version gratuite installée sur votre serveur ne reçoit plus de nouveautés ni de support. Elle continue de fonctionner telle quelle. Sur l’offre hébergée, Beluga tourne sur un serveur à vous, tenu à jour par l’équipe Beluga, et vous y retrouvez tout votre espace à l’identique : projets, fichiers, mémoire, coffre-fort et historique.',
          )}
        </p>
        <div className="space-y-1" data-mesure-de-l-espace>
          {mesure ? (
            <LigneDEtat fait>
              {t('Votre espace : {n} projet(s) actif(s), {volume} de données.', {
                n: String(mesure.projetsActifs),
                volume: volumeLisible(mesure.octets, formatRegional()),
              })}
            </LigneDEtat>
          ) : (
            <p className="flex items-center gap-2 text-[13.5px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('Mesure de votre espace…')}
            </p>
          )}
        </div>
      </Groupe>

      <Groupe titre={t('La formule conseillée')}>
        {rendu?.ok ? (
          <div className="space-y-1" data-formule-conseillee={rendu.proposition.formule.id}>
            <p className="text-[15px] font-medium text-text">
              {t('{nom} — {prix} par mois', { nom: rendu.proposition.formule.nom, prix: prix(rendu.proposition.formule.prixMensuel) })}
            </p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              {t('La plus petite formule où tout votre espace tient : {projets} projets et {go} Go compris.', {
                projets: String(rendu.proposition.formule.projets),
                go: String(rendu.proposition.formule.go),
              })}
              {rendu.proposition.stockage
                ? ` ${t('Avec l’option de stockage de {to} To, {prix} de plus par mois.', {
                    to: String(rendu.proposition.stockage.to),
                    prix: prix(rendu.proposition.stockage.prixMensuel),
                  })}`
                : ''}
            </p>
          </div>
        ) : rendu ? (
          <div className="space-y-2" data-offre-injoignable>
            <p className="text-[13.5px] leading-relaxed text-danger">{rendu.raison}</p>
            <Button variant="subtle" size="md" disabled={lecture} onClick={() => void lire()}>
              {lecture ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('Réessayer')}
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13.5px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('L’équipe Beluga calcule la formule qui vous convient…')}
          </p>
        )}
        <p className="text-[13px] leading-relaxed text-faint">
          {t('Vos données restent à vous : si vous quittez un jour l’offre hébergée, vous récupérez vos projets, vos fichiers et vos données.')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default" size="md" data-transferer-mon-espace disabled={!rendu?.ok || enCours || occupe} onClick={() => void transferer()}>
            {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
            {t('Transférer mon espace')}
          </Button>
        </div>
        {travail?.etat === 'echoue' ? (
          <p className="text-[13px] leading-relaxed text-danger">{travail.erreur ?? t('Le transfert n’a pas abouti.')}</p>
        ) : null}
        {travail ? <SortieDuTravail /> : null}
      </Groupe>
    </div>
  );
}

/**
 * LA PAGE « MISE À JOUR » DES RÉGLAGES.
 *
 * Elle est VISIBLE PARTOUT, et dit toujours la vérité sur l'installation :
 *  - une installation qui SUIVAIT le dépôt public est une installation GRATUITE : elle ne reçoit plus de nouveautés,
 *    la page devient « Passer à l'offre hébergée » (`PageDeLOffre`) ;
 *  - la machine qui ALIMENTE les versions (dépôt de travail privé, aucun distant `amont`) lit qu'elle en est la source ;
 *  - l'offre hébergée lit que l'équipe Beluga s'en charge.
 * La bande noire du haut mène ici.
 */
export function PageMiseAJour() {
  const state = useApp();
  const nouveautes = useNouveautes();
  const [lu, setLu] = React.useState(false);

  React.useEffect(() => {
    void client
      .call<{ etat: EtatDesNouveautes }>({ type: 'installation.nouveautes', forcer: false }, 20_000)
      .then((rendu) => installationEnDirect.recevoirLesNouveautes(rendu.etat))
      .catch(() => undefined)
      .finally(() => setLu(true));
  }, []);

  if (state.offreHebergee) {
    return (
      <div className="space-y-7" data-page-mise-a-jour="hebergee">
        <Groupe titre={t('Les mises à jour de Beluga')}>
          <LigneDEtat fait>{t('Sur l’offre hébergée, Beluga est tenu à jour par l’équipe Beluga : vous n’avez rien à faire.')}</LigneDEtat>
        </Groupe>
      </div>
    );
  }

  if (!nouveautes && !lu) {
    return (
      <div className="flex items-center gap-2 text-[13.5px] text-muted" data-page-mise-a-jour="chargement">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('Lecture de l’état des mises à jour…')}
      </div>
    );
  }

  /* LA MACHINE SOURCE : c'est d'elle que partent les versions, elle n'a rien à récupérer. */
  if (!nouveautes?.suivi) {
    return (
      <div className="space-y-7" data-page-mise-a-jour="source">
        <Groupe titre={t('Les mises à jour de Beluga')}>
          <LigneDEtat fait>
            {t('Cette installation est la source des mises à jour de Beluga : c’est d’ici que partent les nouveautés publiées, elle n’a donc rien à récupérer.')}
          </LigneDEtat>
        </Groupe>
      </div>
    );
  }

  return <PageDeLOffre />;
}

import * as React from 'react';
import { ArrowUpRight, Loader2, RefreshCw, RotateCw } from '@/components/ui/icones';
import { volumeLisible, type EtatDesNouveautes, type MesureDeLEspace, type PropositionDuCentral } from '@beluga/shared';
import { Groupe } from '@/components/reglages/communs';
import { LigneDEtat } from '@/components/installation/sections';
import { SortieDuTravail, useTravailDuGenre } from '@/components/installation/travail';
import { useRedemarrage } from '@/components/redemarrage';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { recupererLesNouveautes } from '@/lib/nouveautes';
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
 * « PASSER À BELUGA CLOUD » — une section FACULTATIVE sous la mise à jour, sur une installation qui suit le dépôt public.
 *
 * LOGICIEL LIBRE (23/11/2026) : la version gratuite est complète et reçoit toutes les nouveautés ; le Cloud n'est qu'une
 * offre de SERVICE (serveur tenu par l'équipe Beluga). La section ne contacte le central QU'APRÈS le clic sur « Voir
 * l'offre » : une installation libre n'appelle personne de son propre chef. Elle montre alors la taille de l'espace, la
 * formule que le CENTRAL conseille — la plus petite où tout tient — avec son prix, et « Transférer mon espace » : il ouvre
 * l'abonnement dans un nouvel onglet et lance le travail qui, une fois payé, emballe tout l'espace et l'envoie au serveur
 * hébergé (`server/src/transfert-vers-l-offre.ts`), avancement en direct sous le bouton.
 */
function SectionDeLOffreCloud() {
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

  const [ouverte, setOuverte] = React.useState(false);
  const ouvrir = () => {
    setOuverte(true);
    void lire();
  };

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
    <div className="space-y-7" data-offre-cloud={!ouverte ? 'fermee' : rendu ? (rendu.ok ? 'proposee' : 'injoignable') : 'lecture'}>
      <Groupe titre={t('Passer à Beluga Cloud')}>
        <p className="text-[13.5px] leading-relaxed text-muted">
          {t(
            'Vous préférez ne plus vous occuper du serveur ? Sur Beluga Cloud, Beluga tourne sur un serveur à vous, tenu à jour par l’équipe Beluga, et vous y retrouvez tout votre espace à l’identique : projets, fichiers, mémoire, coffre-fort et historique. Cette version reste libre et complète : passer au Cloud est un choix, jamais une obligation.',
          )}
        </p>
        {!ouverte ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="md" data-voir-l-offre-cloud onClick={ouvrir}>
              <ArrowUpRight className="h-3.5 w-3.5" />
              {t('Voir l’offre')}
            </Button>
          </div>
        ) : null}
        {ouverte ? (
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
        ) : null}
      </Groupe>

      {ouverte ? (
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
          {t('Vos données restent à vous : si vous quittez un jour Beluga Cloud, vous récupérez vos projets, vos fichiers et vos données.')}
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
      ) : null}
    </div>
  );
}

/** La tâche de mise à jour encore ouverte, telle que le démon la donne (`tacheDeMiseAJour`). */
interface TacheDeMiseAJour {
  projectId: string;
  cardId: string;
  column: string;
}

/** « il y a 12 min », pour la dernière vérification. */
function depuis(at: number | undefined): string | null {
  if (!at) return null;
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return t('à l’instant');
  if (minutes < 60) return t('il y a {n} min', { n: String(minutes) });
  return t('il y a {n} h', { n: String(Math.round(minutes / 60)) });
}

/**
 * LA PAGE « MISE À JOUR » DES RÉGLAGES — récupérer les nouveautés publiées sur
 * le dépôt public de Beluga Build.
 *
 * Elle est VISIBLE PARTOUT, et dit toujours la vérité sur l'installation :
 *  - une installation qui SUIT le dépôt public voit son état (à jour, N
 *    nouveautés, tâche en cours), « Vérifier maintenant » et « Mettre à jour » ;
 *  - la machine qui ALIMENTE le dépôt public (dépôt de travail privé, aucun
 *    distant `amont`) lit qu'elle est la source des mises à jour ;
 *  - l'offre hébergée lit que l'équipe Beluga s'en charge.
 *
 * « Mettre à jour » pose et lance la tâche de l'agent ; ce clic vaut aussi sa
 * mise en ligne, seule, une fois rendue sans blocage
 * (`shared/src/publication-de-la-mise-a-jour.ts`). Le bandeau du haut mène ici.
 */
export function PageMiseAJour() {
  const state = useApp();
  const nouveautes = useNouveautes();
  const { travail } = useTravailDuGenre('mise-a-jour');
  const redemarrage = useRedemarrage();
  const [tache, setTache] = React.useState<TacheDeMiseAJour | null>(null);
  const [lu, setLu] = React.useState(false);
  const [verification, setVerification] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);

  const lire = React.useCallback(async (forcer: boolean) => {
    const rendu = await client.call<{ etat: EtatDesNouveautes; tache?: TacheDeMiseAJour | null }>(
      { type: 'installation.nouveautes', forcer },
      forcer ? 120_000 : 20_000,
    );
    installationEnDirect.recevoirLesNouveautes(rendu.etat);
    setTache(rendu.tache ?? null);
    return rendu.etat;
  }, []);

  React.useEffect(() => {
    void lire(false)
      .catch(() => undefined)
      .finally(() => setLu(true));
  }, [lire]);

  const verifier = async () => {
    setVerification(true);
    try {
      const etat = await lire(true);
      if (etat.erreur) client.pushToast('warning', etat.erreur);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le dépôt public n’a pas pu être consulté.'));
    } finally {
      setVerification(false);
    }
  };

  const mettreAJour = async () => {
    setEnvoi(true);
    try {
      await recupererLesNouveautes();
      await lire(false).catch(() => undefined);
    } finally {
      setEnvoi(false);
    }
  };

  const explication = (
    <p className="text-[13.5px] leading-relaxed text-muted">
      {t(
        'Beluga récupère les nouveautés publiées sur son dépôt public. Un agent les met en place dans votre version sans toucher à ce que vous avez personnalisé : s’il rencontre un conflit, il s’arrête et vous demande quoi faire. Rien ne démarre sans votre clic sur « Mettre à jour » ; une fois la tâche terminée sans blocage, seule la mise à jour est mise en ligne, puis Beluga redémarre dès qu’aucun agent ne travaille.',
      )}
    </p>
  );

  if (state.offreHebergee) {
    return (
      <div className="space-y-7" data-page-mise-a-jour="hebergee">
        <Groupe titre={t('Mettre à jour la version de Beluga depuis le dépôt public')}>
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

  /* LA MACHINE SOURCE : elle alimente le dépôt public, elle n'en récupère rien. */
  if (!nouveautes?.suivi) {
    return (
      <div className="space-y-7" data-page-mise-a-jour="source">
        <Groupe titre={t('Mettre à jour la version de Beluga depuis le dépôt public')}>
          {explication}
          <LigneDEtat fait>
            {t('Cette installation est la source des mises à jour de Beluga : c’est d’ici que partent les nouveautés publiées, elle n’a donc rien à récupérer.')}
          </LigneDEtat>
        </Groupe>
      </div>
    );
  }

  const enCours = envoi || travail?.etat === 'en-cours' || Boolean(tache);
  const derniere = depuis(nouveautes.releveLe);

  return (
    <div
      className="space-y-7"
      data-page-mise-a-jour="suivi"
      data-nouveautes={tache ? 'en-cours' : nouveautes.disponibles ? 'disponibles' : 'a-jour'}
    >
      <Groupe titre={t('Mettre à jour la version de Beluga depuis le dépôt public')}>
        {explication}
        <div className="space-y-1">
          {tache ? (
            <LigneDEtat fait={false}>
              {tache.column === 'to_deploy'
                ? t('La mise à jour est prête : elle part en ligne dès qu’aucun agent ne travaille, puis Beluga redémarre.')
                : t('Une mise à jour est en cours : un agent met les nouveautés en place.')}
            </LigneDEtat>
          ) : nouveautes.disponibles ? (
            <LigneDEtat fait={false}>
              {nouveautes.nombre
                ? t('{n} nouveauté(s) de Beluga Build sont disponibles.', { n: String(nouveautes.nombre) })
                : t('Des nouveautés de Beluga Build sont disponibles.')}
            </LigneDEtat>
          ) : (
            <LigneDEtat fait>{t('Beluga Build est à jour.')}</LigneDEtat>
          )}
          {derniere ? (
            <p className="text-[12.5px] text-faint" data-derniere-verification>
              {t('Dernière vérification : {quand}. Beluga regarde de nouveau toutes les heures.', { quand: derniere })}
            </p>
          ) : null}
          {nouveautes.erreur ? <p className="text-[13px] leading-relaxed text-danger">{nouveautes.erreur}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="md"
            data-recuperer-les-nouveautes
            disabled={enCours || !nouveautes.disponibles}
            onClick={() => void mettreAJour()}
          >
            {envoi || travail?.etat === 'en-cours' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Mettre à jour')}
          </Button>
          <Button variant="subtle" size="md" data-verifier-les-nouveautes disabled={verification} onClick={() => void verifier()}>
            {verification ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t('Vérifier maintenant')}
          </Button>
          {tache ? (
            <Button
              variant="ghost"
              size="md"
              data-voir-la-tache-de-mise-a-jour
              onClick={() => client.allerVersDecision({ projectId: tache.projectId, cardId: tache.cardId })}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {t('Suivre la tâche')}
            </Button>
          ) : null}
          {travail?.etat === 'reussi' ? (
            <Button variant="default" size="md" data-redemarrer-apres-mise-a-jour onClick={redemarrage.ouvrir}>
              <RotateCw className="h-3.5 w-3.5" />
              {t('Redémarrer pour appliquer')}
            </Button>
          ) : null}
        </div>
        {travail?.etat === 'echoue' ? (
          <p className="text-[13px] leading-relaxed text-danger">{travail.erreur ?? t('L’installation a échoué.')}</p>
        ) : null}
        {travail ? <SortieDuTravail /> : null}
        {redemarrage.dialogue}
      </Groupe>
      <SectionDeLOffreCloud />
    </div>
  );
}

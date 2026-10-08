import * as React from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { raisonCopieBloquee, type EtatDeLaCopieDeTest } from '@beluga/shared';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * LA COPIE DE TEST DANS LE TIROIR DE MISE EN PRODUCTION
 * (`shared/src/copie-de-test.ts`).
 *
 * Deux choses, pour un projet dont la copie de test est séparée du vrai site :
 * - les changements notés par les cartes qui attendent d'être rejoués en ligne
 *   — c'est exactement ce que la mise en production enverra ;
 * - le bouton « Rafraîchir la copie de test », qui recopie le vrai site vers la
 *   copie, ÉTEINT tant qu'un changement attend (la copie le perdrait), avec la
 *   raison écrite dessous. Un premier clic arme, le second lance.
 *
 * Un projet sans cette convention n'affiche rien. L'état se relit à
 * l'ouverture, puis toutes les quatre secondes pendant un rafraîchissement.
 */
export function CopieDeTest({ projectId }: { projectId: string }) {
  const [etat, setEtat] = React.useState<EtatDeLaCopieDeTest | null>(null);
  const [arme, setArme] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const relire = React.useCallback(async () => {
    try {
      setEtat((await client.call({ type: 'copieDeTest.etat', projectId })) as EtatDeLaCopieDeTest);
    } catch {
      // Un état illisible n'affiche rien plutôt qu'un bouton faux.
    }
  }, [projectId]);

  React.useEffect(() => {
    void relire();
  }, [relire]);

  React.useEffect(() => {
    if (!etat?.enCours) return;
    const minuteur = window.setInterval(() => void relire(), 4000);
    return () => window.clearInterval(minuteur);
  }, [etat?.enCours, relire]);

  if (!etat?.disponible) return null;
  const raison = raisonCopieBloquee(etat);

  const lancer = async () => {
    if (!arme) {
      setArme(true);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      setEtat((await client.call({ type: 'copieDeTest.rafraichir', projectId })) as EtatDeLaCopieDeTest);
    } catch (err: any) {
      setErreur(err?.message ?? t('Rafraîchissement impossible.'));
    } finally {
      setEnvoi(false);
      setArme(false);
    }
  };

  return (
    <section className="mt-3 flex flex-col gap-2 rounded-md bg-raised/35 px-2.5 py-2" data-copie-de-test={raison ?? 'prete'}>
      <p className="text-[12.5px] font-medium text-text">{t('Copie de test')}</p>
      {etat.enAttente.length ? (
        <div className="flex flex-col gap-1" data-copie-en-attente={etat.enAttente.length}>
          <p className="text-[12.5px] leading-snug text-muted">
            {t('Changements notés par les cartes, rejoués sur le vrai site à la prochaine mise en production : {n}', { n: etat.enAttente.length })}
          </p>
          <ul className="flex flex-col gap-0.5">
            {etat.enAttente.map((nom) => (
              <li key={nom} className="break-all font-mono text-[11.5px] text-faint">
                {nom}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[12.5px] leading-snug text-muted" data-copie-en-attente="0">
          {t('Aucun changement n’attend : le vrai site a reçu tout ce que les cartes ont noté.')}
        </p>
      )}
      <Button
        size="sm"
        variant={arme ? 'default' : 'outline'}
        className="h-8 self-start text-[12.5px]"
        disabled={!!raison || envoi}
        onClick={() => void lancer()}
        onBlur={() => setArme(false)}
        data-rafraichir-copie={arme ? 'arme' : 'repos'}
      >
        {etat.enCours || envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {etat.enCours
          ? t('Rafraîchissement en cours…')
          : arme
            ? t('Confirmer : remplacer la copie de test par le vrai site')
            : t('Rafraîchir la copie de test')}
      </Button>
      {raison === 'en-attente' ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-snug text-warning" data-raison-copie="en-attente">
          <AlertTriangle className="mt-[3px] h-3 w-3 shrink-0" />
          <span>{t('Impossible tant que des changements attendent leur mise en production : la copie de test les perdrait.')}</span>
        </p>
      ) : !raison ? (
        <p className="text-[12px] leading-snug text-faint">
          {t('Recopie le vrai site (fichiers et contenu) vers la copie de test, sans rien y écrire. L’ancienne copie est sauvegardée d’abord.')}
        </p>
      ) : null}
      {erreur ? (
        <p className="text-[12px] leading-snug text-danger" data-erreur-copie>
          {erreur}
        </p>
      ) : null}
      {etat.derniere && !etat.enCours ? (
        <details className="text-[12px]" data-derniere-copie={etat.derniere.ok ? 'reussie' : 'echec'}>
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-muted">
            {etat.derniere.ok ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-danger" />}
            {etat.derniere.ok ? t('Dernier rafraîchissement réussi') : t('Dernier rafraîchissement en échec')}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-faint">{etat.derniere.texte}</pre>
        </details>
      ) : null}
    </section>
  );
}

/*
 * LA BANNIÈRE D'UNE EXTENSION CHROME EN RETARD (carte « Extension à jour et Jarvis tout en voix », 20/11/2026).
 *
 * Choix de l'utilisateur : une bande ORANGE sur toute la largeur, AU-DESSUS de toute l'application (colonne de gauche et
 * entête au fil d'Ariane compris), une icône d'attention, et à droite le bouton qui règle le problème. Sans croix : elle
 * disparaît d'elle-même quand plus aucun Chrome n'est en retard. Les données arrivent par le canal (`extension.change`),
 * jamais par un sondage.
 *
 *  - version trop ancienne, programme du Mac en ligne → « Mettre à jour » : Beluga remplace l'extension par le programme
 *    du Mac (`extension.mettreAJour`) ; le bouton le dit dès le clic, puis le résultat s'affiche ;
 *  - version trop ancienne, sans programme du Mac → « Mettre à jour » ouvre Réglages › Extension (mise à jour à la main) ;
 *  - à jour mais non autorisée en navigation privée → « Autoriser » ouvre, dans ce Chrome, la page de l'extension.
 *
 * Couleur : `--banniere-a-faire` (l'orange du témoin du serveur) et `--banniere-a-faire-texte` (presque noir, lisible).
 */
import * as React from 'react';
import type { RetardDExtension } from '@beluga/shared';
import { Loader2, TriangleAlert } from '@/components/ui/icones';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

type Retard = RetardDExtension & { enCours: boolean };

const ouvrirLaPageExtension = () => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'extension' } }));

function texteDuRetard(r: Retard): string {
  if (r.raison === 'navigation-privee') return t('L’extension Beluga de « {nom} » n’est pas autorisée en navigation privée : l’audit GEO ne peut pas tourner.', { nom: r.nom });
  return t('L’extension Beluga de « {nom} » est trop ancienne (version {v}, il faut la {w}) : l’audit GEO ne peut pas tourner.', {
    nom: r.nom,
    v: r.version ?? t('inconnue'),
    w: r.versionAttendue,
  });
}

export function BanniereExtension() {
  const [retards, setRetards] = React.useState<Retard[]>([]);
  const [envoi, setEnvoi] = React.useState<string | null>(null);

  const relire = React.useCallback(async () => {
    try {
      const r = await client.call<{ retards: Retard[] }>({ type: 'extension.retards' });
      setRetards(r.retards ?? []);
    } catch {
      /* hors ligne : la bannière garde ce qu'elle savait */
    }
  }, []);

  React.useEffect(() => {
    void relire();
    return client.onExtension(() => void relire());
  }, [relire]);

  const r = retards[0];
  if (!r) return null;
  const occupe = r.enCours || envoi === r.chromeId;

  const agir = async () => {
    if (r.raison === 'navigation-privee') {
      if (!r.enLigne) return ouvrirLaPageExtension();
      setEnvoi(r.chromeId);
      try {
        await client.call({ type: 'extension.ouvrirReglages', chromeId: r.chromeId });
        client.pushToast('info', t('La page de l’extension est ouverte dans Chrome : cochez « Autoriser en navigation privée ».'));
      } catch (e) {
        client.pushToast('warning', String((e as Error)?.message ?? e));
      } finally {
        setEnvoi(null);
      }
      return;
    }
    if (!r.programmeEnLigne) return ouvrirLaPageExtension();
    setEnvoi(r.chromeId);
    try {
      const issue = await client.call<{ ok: boolean; texte: string; sansProgramme?: boolean }>({ type: 'extension.mettreAJour', chromeId: r.chromeId });
      client.pushToast(issue.ok ? 'success' : 'warning', issue.texte);
      if (!issue.ok && issue.sansProgramme) ouvrirLaPageExtension();
    } catch (e) {
      client.pushToast('warning', String((e as Error)?.message ?? e));
    } finally {
      setEnvoi(null);
      void relire();
    }
  };

  const libelle = occupe ? t('Mise à jour…') : r.raison === 'navigation-privee' ? t('Autoriser') : t('Mettre à jour');
  const autres = retards.length - 1;

  return (
    <div
      data-banniere-extension={r.raison}
      role="status"
      className="flex shrink-0 items-center gap-3 bg-[hsl(var(--banniere-a-faire))] px-4 py-2 text-[13px] text-[hsl(var(--banniere-a-faire-texte))] sm:py-1.5"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        {texteDuRetard(r)}
        {autres > 0 ? <span className="opacity-70"> {t('(et {n} autre)', { n: autres })}</span> : null}
      </p>
      <button
        type="button"
        data-banniere-extension-bouton
        disabled={occupe}
        onClick={() => void agir()}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-opacity',
          'bg-[hsl(var(--banniere-a-faire-texte))] text-[hsl(var(--banniere-a-faire))] hover:opacity-90 disabled:opacity-80',
        )}
      >
        {occupe ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {libelle}
      </button>
    </div>
  );
}

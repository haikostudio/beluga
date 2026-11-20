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
 *
 * SOUS L'HEURE D'UN iPHONE (carte « Bande orange cachée sur téléphone », 20/11/2026, captures #8045 #ee90c #8da4) :
 * l'application native s'étend sous la barre d'état. La bannière est le conteneur qui touche le bord du haut : c'est
 * ELLE qui réserve la zone sûre (`--zone-sure-haut` ajoutée à son rembourrage), une seule fois (MEM-2659). Tant
 * qu'elle est là, `styles.css` remet `--zone-sure-entete` à zéro sous la racine (la barre du haut ne recompte plus
 * l'heure, plus de trou) et peint la bande sous l'heure — fixe, opaque, gardée contre le flou d'iOS — du même orange :
 * l'orange monte jusqu'au bord, l'heure dessus. Sur téléphone, le message est court et passe à la ligne (quatre au
 * plus, « (et 1 autre) » compris) au lieu d'être coupé ; sur ordinateur, texte long sur une seule ligne, comme avant.
 *
 * AU-DESSUS DE TOUT, SUR TOUTES LES PAGES (carte « Bande orange de l'extension, retouches », 20/11/2026, captures
 * #4734 #7842 #7b8b8) : la page d'une carte (`Drawer` page) et les pages de service sont FIXES et partaient du haut
 * de l'écran, recouvrant la bande sauf au-dessus de la colonne de gauche. La bannière MESURE donc sa hauteur et la
 * pose sur <html> (`--hauteur-banniere`) ; ces pages partent de là. Elle pose aussi `--marge-sous-banniere` : l'air
 * qui sépare la bande des boutons du haut (8 px au téléphone, rien sur ordinateur), qui REMPLACE la zone sûre sous
 * elle — l'heure, elle l'a déjà comptée (MEM-2659). Les deux tombent quand elle disparaît. Chaque changement émet
 * `beluga:hauteur-banniere` : ce qui mesure le haut de l'écran (haut du téléphone, bouton de l'assistant) relit.
 * Bouton : fond presque noir, texte BLANC (décision de l'utilisateur). Téléphone : une ligne, et un chevron qui
 * déplie le message entier ; le texte replié n'est jamais dans un bouton.
 */
import * as React from 'react';
import type { RetardDExtension } from '@beluga/shared';
import { ChevronDown, Loader2, TriangleAlert } from '@/components/ui/icones';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

type Retard = RetardDExtension & { enCours: boolean };

/** L'air entre la bande et les boutons du haut, au téléphone (le même que sous l'heure sans bande). */
const MARGE_SOUS_LA_BANDE_TELEPHONE = '0.5rem';
const EVENEMENT_HAUTEUR_BANNIERE = 'beluga:hauteur-banniere';

function poserLaHauteur(hauteur: number | null, telephone: boolean) {
  const racine = document.documentElement.style;
  const avant = racine.getPropertyValue('--hauteur-banniere');
  if (hauteur === null) {
    racine.removeProperty('--hauteur-banniere');
    racine.removeProperty('--marge-sous-banniere');
  } else {
    racine.setProperty('--hauteur-banniere', `${Math.round(hauteur)}px`);
    racine.setProperty('--marge-sous-banniere', telephone ? MARGE_SOUS_LA_BANDE_TELEPHONE : '0px');
  }
  if (avant !== racine.getPropertyValue('--hauteur-banniere')) window.dispatchEvent(new Event(EVENEMENT_HAUTEUR_BANNIERE));
}

const ouvrirLaPageExtension = () => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'extension' } }));

function texteDuRetard(r: Retard, court: boolean): string {
  if (court) {
    if (r.raison === 'navigation-privee') return t('Extension de « {nom} » non autorisée en navigation privée : l’audit GEO est bloqué.', { nom: r.nom });
    return t('Extension de « {nom} » trop ancienne ({v}, il faut la {w}) : l’audit GEO est bloqué.', {
      nom: r.nom,
      v: r.version ?? t('inconnue'),
      w: r.versionAttendue,
    });
  }
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
  const [deplie, setDeplie] = React.useState(false);
  const telephone = useTelephone();
  const [bande, setBande] = React.useState<HTMLDivElement | null>(null);

  /* LA HAUTEUR DE LA BANDE, pour que les pages fixes partent sous elle (voir l'en-tête). */
  React.useLayoutEffect(() => {
    if (!bande) {
      poserLaHauteur(null, telephone);
      return;
    }
    const mesurer = () => poserLaHauteur(bande.getBoundingClientRect().height, telephone);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(bande);
    return () => {
      observateur.disconnect();
      poserLaHauteur(null, telephone);
    };
  }, [bande, telephone]);

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
      ref={setBande}
      data-banniere-extension={r.raison}
      data-banniere-deplie={telephone && deplie ? '' : undefined}
      role="status"
      /* Le haut réserve la zone sûre (heure de l'iPhone) : 0 partout ailleurs, donc rien ne change hors iPhone. */
      className={cn(
        'flex shrink-0 gap-3',
        telephone && deplie ? 'items-start' : 'items-center',
        'bg-[hsl(var(--banniere-a-faire))] px-4 pb-2 pt-[calc(var(--zone-sure-haut,0px)+0.5rem)] text-[13px] text-[hsl(var(--banniere-a-faire-texte))] sm:pb-1.5 sm:pt-[calc(var(--zone-sure-haut,0px)+0.375rem)]',
      )}
    >
      <TriangleAlert className={cn('size-4 shrink-0', telephone && deplie && 'mt-[6px]')} aria-hidden />
      <p data-banniere-extension-texte className={cn('min-w-0 flex-1', telephone && deplie ? 'pt-[5px] leading-snug' : 'truncate')}>
        {texteDuRetard(r, telephone)}
        {autres > 0 ? <span className="opacity-70"> {t('(et {n} autre)', { n: autres })}</span> : null}
      </p>
      {telephone ? (
        /* LE CHEVRON QUI DÉPLIE LE MESSAGE (téléphone) : un bouton à part, le texte replié n'est jamais dedans. */
        <button
          type="button"
          data-banniere-extension-deplier
          aria-expanded={deplie}
          aria-label={deplie ? 'Replier le message' : 'Afficher tout le message'}
          onClick={() => setDeplie((v) => !v)}
          className="-mx-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-[hsl(var(--banniere-a-faire-texte)/0.1)]"
        >
          <ChevronDown className={cn('size-4 transition-transform', deplie && 'rotate-180')} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        data-banniere-extension-bouton
        disabled={occupe}
        onClick={() => void agir()}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-opacity',
          /* Fond presque noir, texte BLANC dans les douze palettes (décision de l'utilisateur, 20/11/2026). */
          'bg-[hsl(var(--banniere-a-faire-texte))] text-[hsl(var(--banniere-a-faire-bouton-texte))] hover:opacity-90 disabled:opacity-80',
        )}
      >
        {occupe ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {libelle}
      </button>
    </div>
  );
}

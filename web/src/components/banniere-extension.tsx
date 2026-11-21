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
 *
 * ELLE NE FAIT PLUS QU'INFORMER (carte « Liaison de l'extension Chrome simplifiée », 20/11/2026, maquette #d1aa) :
 * Beluga met l'extension à jour TOUT DE SUITE quand aucun agent ne travaille dans ce Chrome. L'orange ne paraît que
 * si un GESTE est nécessaire (`retard.geste`, shared) : relancer Chrome (extension d'avant 1.0.11), guider un
 * ordinateur sans Beluga Connect, autoriser la navigation privée, réessayer après un échec. Une mise à jour faite
 * seule s'annonce en bande NEUTRE (`data-banniere-extension="information"`, fond `bg-raised`, coche verte) avec « OK » ;
 * elle disparaît d'elle-même après huit secondes et ne revient pas (vue mémorisée par Chrome et version). L'orange,
 * plus urgent, passe toujours avant.
 */
import * as React from 'react';
import type { AvisDeMiseAJour, RetardDExtension } from '@beluga/shared';
import { Check, TriangleAlert } from '@/components/ui/icones';
import { BandeDuHaut } from '@/components/bande-du-haut';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';

type Retard = RetardDExtension & { enCours: boolean };

const ouvrirLaPageExtension = () => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'extension' } }));

function texteDuRetard(r: Retard, court: boolean): string {
  switch (r.geste) {
    case 'autoriser':
      return court
        ? t('Extension de « {nom} » non autorisée en navigation privée.', { nom: r.nom })
        : t('L’extension Beluga de « {nom} » n’est pas autorisée en navigation privée : l’audit GEO ne peut pas tourner.', { nom: r.nom });
    case 'relancer-chrome':
      return court
        ? t('Extension de « {nom} » : Chrome doit redémarrer une fois.', { nom: r.nom })
        : t('L’extension Beluga de « {nom} » est trop ancienne pour se mettre à jour seule : Chrome doit redémarrer une fois (vos onglets seront rouverts).', { nom: r.nom });
    case 'reessayer':
      return court
        ? t('La mise à jour de l’extension de « {nom} » n’a pas abouti.', { nom: r.nom })
        : t('La mise à jour de l’extension Beluga de « {nom} » n’a pas abouti : un clic la relance.', { nom: r.nom });
    default:
      return court
        ? t('Nouvelle version de l’extension pour « {nom} » : trois clics.', { nom: r.nom })
        : t('L’extension Beluga de « {nom} » a une nouvelle version : trois clics suffisent pour la poser.', { nom: r.nom });
  }
}

function libelleDuGeste(r: Retard): string {
  switch (r.geste) {
    case 'autoriser':
      return t('Autoriser');
    case 'relancer-chrome':
      return t('Mettre à jour');
    case 'reessayer':
      return t('Réessayer');
    default:
      return t('Me guider');
  }
}

/** Les avis déjà vus (Chrome + version) : un avis ne revient pas au rechargement. */
const CLE_AVIS_VUS = 'beluga:avis-extension-vus';
const DUREE_DE_L_AVIS_MS = 8_000;
const cleDeLAvis = (a: AvisDeMiseAJour) => `${a.chromeId}:${a.version}`;
function avisVus(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLE_AVIS_VUS) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function marquerVu(a: AvisDeMiseAJour) {
  try {
    const vus = [...avisVus(), cleDeLAvis(a)].slice(-40);
    localStorage.setItem(CLE_AVIS_VUS, JSON.stringify(vus));
  } catch {
    /* stockage refusé : l'avis disparaît quand même pour cette page */
  }
}

/**
 * La bande de l'extension, et l'ARBITRE des bandes du haut : l'orange d'un geste nécessaire passe avant tout, puis
 * l'avis d'une mise à jour faite seule (huit secondes), puis `sinon` — la bande d'information d'à côté (l'offre
 * hébergée). Une seule bande à la fois.
 */
export function BanniereExtension({ sinon }: { sinon?: React.ReactNode } = {}) {
  const [retards, setRetards] = React.useState<Retard[]>([]);
  const [avis, setAvis] = React.useState<AvisDeMiseAJour[]>([]);
  const [vus, setVus] = React.useState<Set<string>>(() => avisVus());
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const telephone = useTelephone();

  const relire = React.useCallback(async () => {
    try {
      const r = await client.call<{ retards: Retard[]; avis?: AvisDeMiseAJour[] }>({ type: 'extension.retards' });
      setRetards(r.retards ?? []);
      setAvis(r.avis ?? []);
    } catch {
      /* hors ligne : la bannière garde ce qu'elle savait */
    }
  }, []);

  React.useEffect(() => {
    void relire();
    return client.onExtension(() => void relire());
  }, [relire]);

  /* L'ORANGE SEULEMENT QUAND IL FAUT AGIR ; sinon, l'avis d'une mise à jour faite seule (s'il n'a pas été vu). */
  const r = retards.find((x) => x.geste !== 'aucun');
  const avisAMontrer = r ? undefined : avis.find((a) => !vus.has(cleDeLAvis(a)));
  const fermerLAvis = React.useCallback((a: AvisDeMiseAJour) => {
    marquerVu(a);
    setVus(avisVus());
  }, []);
  React.useEffect(() => {
    if (!avisAMontrer) return;
    const minuteur = window.setTimeout(() => fermerLAvis(avisAMontrer), DUREE_DE_L_AVIS_MS);
    return () => window.clearTimeout(minuteur);
  }, [avisAMontrer, fermerLAvis]);

  if (!r && avisAMontrer) {
    return (
      <BandeDuHaut
        genre="information"
        data-banniere-extension="information"
        icone={
          <span className="flex size-4 items-center justify-center rounded-full bg-coche text-white">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
        }
        texte={
          telephone
            ? t('Extension de « {nom} » mise à jour (version {v}).', { nom: avisAMontrer.nom, v: avisAMontrer.version })
            : t('L’extension Beluga de « {nom} » a été mise à jour en arrière-plan (version {v}). Rien à faire.', { nom: avisAMontrer.nom, v: avisAMontrer.version })
        }
        bouton={{ libelle: t('OK'), onClick: () => fermerLAvis(avisAMontrer), reperes: { 'data-banniere-extension-ok': '' } }}
      />
    );
  }
  if (!r) return <>{sinon ?? null}</>;
  const occupe = r.enCours || envoi === r.chromeId;

  const agir = async () => {
    if (r.geste === 'guider') return ouvrirLaPageExtension();
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

  const autres = retards.filter((x) => x.geste !== 'aucun').length - 1;

  return (
    <BandeDuHaut
      genre="avertissement"
      data-banniere-extension={r.raison}
      data-banniere-geste={r.geste}
      icone={<TriangleAlert className="size-4" />}
      texte={texteDuRetard(r, false)}
      texteCourt={texteDuRetard(r, true)}
      suite={autres > 0 ? t('(et {n} autre)', { n: autres }) : undefined}
      bouton={{
        libelle: occupe ? t('Mise à jour…') : libelleDuGeste(r),
        occupe,
        onClick: () => void agir(),
        reperes: { 'data-banniere-extension-bouton': '' },
      }}
    />
  );
}

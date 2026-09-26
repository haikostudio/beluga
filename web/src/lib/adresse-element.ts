import React from 'react';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * L'ÉLÉMENT OUVERT D'UN SERVICE, TENU EN PHASE AVEC L'ADRESSE.
 *
 * Chaque service (coffre, notes, sauvegardes, surveillance) garde en interne ce
 * qu'il affiche. Sans ce crochet, cette information ne sortait jamais de lui :
 * l'adresse ne pouvait donc ni la décrire, ni la reposer.
 *
 * Le crochet fait circuler la même information dans les deux sens :
 *
 *  — ce que l'adresse DÉSIGNE (`vise`) descend une fois les données arrivées,
 *    pour qu'un lien collé dans un onglet neuf rouvre l'élément avec son
 *    contexte autour ;
 *  — ce qui est OUVERT remonte (`onVise`) dès que l'écran change, pour que
 *    l'adresse dise la vérité.
 *
 * L'ORDRE EST TOUT. La remontée se tait TANT QUE LA CIBLE DE L'ADRESSE N'EST
 * PAS ATTEINTE : au premier affichage, rien n'est encore ouvert, et remonter ce
 * « rien » effaçait la cible avant même qu'on ait pu l'ouvrir — un lien partagé
 * retombait alors sur la liste. Elle reprend la parole dès que la cible est
 * atteinte (l'élément est là) ou abandonnée (il a disparu).
 *
 * UNE CIBLE DISPARUE N'EST PAS UN ÉCRAN VIDE : quand `ouvrir` répond qu'elle
 * n'existe plus, on reste sur l'écran parent et on DIT pourquoi. Sans ce mot,
 * un lien périmé ramenait silencieusement sur une liste, sans que personne
 * sache que la cible avait été supprimée.
 *
 * UNE ADRESSE QUI NE FAIT QU'ÉCHO À L'ÉCRAN N'EST PAS UNE DEMANDE. C'est la
 * règle qui manquait, et elle rouvrait ce qu'on venait de fermer : la fiche
 * ouverte AU CLIC remonte à l'adresse, donc `vise` porte son identifiant ; en
 * la refermant, `ouvertId` retombe à `null` AVANT que la remontée n'ait effacé
 * `vise`, et la descente prenait ce reste d'adresse pour un lien à ouvrir — le
 * tiroir se refermait puis se rouvrait aussitôt derrière (coffre-fort, notes,
 * sauvegardes, surveillance). La descente ignore donc une cible ÉGALE à ce que
 * le crochet a lui-même remonté en dernier : seule une cible venue du DEHORS
 * (lien collé, Précédent/Suivant du navigateur) ouvre quelque chose.
 */
export function useElementAdresse(options: {
  /** L'identifiant désigné par l'adresse, ou `null`. */
  vise?: string | null;
  /** Ce que le service annonce à l'adresse quand l'écran change. */
  onVise?: (id: string | null) => void;
  /** L'identifiant de ce qui est ouvert à l'écran, en ce moment. */
  ouvertId: string | null;
  /** Tente d'ouvrir la cible. `false` = elle n'existe plus. */
  ouvrir: (id: string) => boolean;
  /** Les données du service sont-elles arrivées ? Avant, on n'ouvre rien. */
  pret: boolean;
  /** Le mot affiché quand la cible a disparu. */
  absent?: string;
}): void {
  const { vise = null, onVise, ouvertId, ouvrir, pret, absent } = options;

  const remonter = React.useRef(onVise);
  remonter.current = onVise;
  const ouvrirRef = React.useRef(ouvrir);
  ouvrirRef.current = ouvrir;
  /** La cible déjà tentée : on n'ouvre pas deux fois la même. */
  const tentee = React.useRef<string | null>(null);
  /** La cible introuvable : la remontée peut reprendre la parole. */
  const abandonnee = React.useRef<string | null>(null);
  /** La cible atteinte : à partir de là, l'écran commande l'adresse. */
  const atteinte = React.useRef<string | null>(null);
  /** Ce qui a déjà été dit à l'adresse : on ne le redit pas. */
  const dit = React.useRef<string | null | undefined>(undefined);

  /* 1. CE QUE L'ADRESSE DÉSIGNE DESCEND — une fois et une seule par cible, et
        jamais quand l'adresse ne fait que répéter ce que l'écran a dit : ce
        reste d'adresse rouvrait l'élément qu'on venait de refermer. */
  React.useEffect(() => {
    if (!vise || !pret) return;
    if (vise === ouvertId || tentee.current === vise || vise === dit.current) return;
    tentee.current = vise;
    if (ouvrirRef.current(vise)) return;
    abandonnee.current = vise;
    client.pushToast('warning', absent ?? t('Cet élément n’existe plus.'));
    remonter.current?.(null);
  }, [vise, pret, ouvertId, absent]);

  /* 2. CE QUI EST À L'ÉCRAN REMONTE — mais jamais avant que la cible ait eu
        sa chance, sous peine de l'effacer au premier affichage. */
  React.useEffect(() => {
    if (!pret) return;
    if (ouvertId && ouvertId === vise) atteinte.current = vise;
    if (vise && atteinte.current !== vise && abandonnee.current !== vise) return;
    if (dit.current === ouvertId) return;
    dit.current = ouvertId;
    remonter.current?.(ouvertId);
  }, [ouvertId, vise, pret]);
}

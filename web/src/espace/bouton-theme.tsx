/**
 * LE THÈME DE L'ESPACE CLIENT — UN BOUTON, TROIS ÉTATS, AUCUN LIBELLÉ.
 *
 * Le client n'a pas de panneau de réglages : il lui faut donc un geste, et un
 * seul. Le bouton PARCOURT les trois états — clair, sombre, automatique — et
 * son ICÔNE dit lequel est en vigueur : un soleil, une lune, un demi-cercle
 * pour « comme mon appareil ». L'infobulle et le libellé lu à voix haute
 * nomment l'état COURANT et rien d'autre ; c'est ce que le lecteur d'écran
 * annonce.
 *
 * L'AMBIANCE N'EST PAS PROPOSÉE. L'administration en a six ; l'espace client
 * garde l'ambiance d'origine et ne joue que sur la clarté — un choix de plus
 * dans un entête qui doit tenir sur un seul rang n'apporterait rien.
 *
 * LE CHOIX VIT SUR LE COMPTE, pas dans le navigateur : c'est la porte cliente
 * qui l'enregistre (`espace.moi.apparence`). Ce composant ne connaît qu'un
 * état et un geste.
 */
import * as React from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';

/** Les trois états, dans l'ordre où le bouton les parcourt. */
export const ETATS_DE_THEME = ['clair', 'sombre', 'auto'] as const;
export type EtatDeTheme = (typeof ETATS_DE_THEME)[number];

/**
 * LES CLÉS DU DICTIONNAIRE, PAS DES PHRASES. Le préfixe `CLES_` est la
 * convention de la maison : il dit que ces textes sont des clés à passer à
 * `t()`, et non du français resté en dur (`scripts/verif-langues.mjs`).
 */
const CLES_NOM_DE_THEME: Record<EtatDeTheme, string> = {
  clair: 'Thème clair',
  sombre: 'Thème sombre',
  auto: 'Thème automatique',
};

export function BoutonTheme({ etat, onChanger }: { etat: EtatDeTheme; onChanger: (suivant: EtatDeTheme) => void }) {
  const suivant = ETATS_DE_THEME[(ETATS_DE_THEME.indexOf(etat) + 1) % ETATS_DE_THEME.length]!;
  const nom = t(CLES_NOM_DE_THEME[etat]);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      onClick={() => onChanger(suivant)}
      title={nom}
      /* UN REPÈRE TECHNIQUE NE CHANGE PAS AVEC LA LANGUE : les contrôles
         désignent ce bouton par son nom accessible, qui reste en français. */
      aria-label={CLES_NOM_DE_THEME[etat]}
      className="shrink-0"
      data-bouton-theme={etat}
    >
      {etat === 'clair' ? (
        <Sun className="h-4 w-4" />
      ) : etat === 'sombre' ? (
        <Moon className="h-4 w-4" />
      ) : (
        <SunMoon className="h-4 w-4" />
      )}
    </Button>
  );
}

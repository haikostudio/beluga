import * as React from 'react';
import {
  PILE_DUREE,
  REQUETE_SURVOL,
  annonceDeLaPile,
  appuiDeclencheLAction,
  gesteDOuverture,
  hauteurDeLaPile,
  pileApres,
  placeDansLaPile,
  resteDeLaPile,
  type EvenementDePile,
} from '@haikodev/shared';
import { cn } from '@/lib/utils';

/**
 * Une pile en profondeur, telle que la décrivent les règles pures
 * (`shared/src/pile-messages.ts` pour la géométrie, `shared/src/ouverture-pile.ts`
 * pour le geste d'ouverture).
 *
 * Le bloc en bas à droite en porte DEUX, distinctes : les messages courts, puis
 * les vignettes d'agents. Elles ne se fondent pas en une seule — un message et
 * un agent ne se lisent pas de la même façon — mais elles partagent ce
 * composant : une seule écriture de la géométrie, du survol et de l'appui.
 */

/**
 * Ce que le pointeur du moment sait faire. La question est reposée quand la
 * réponse change : brancher une souris sur une tablette rend le survol, la
 * débrancher le reprend.
 */
export function useGesteDOuverture() {
  const [survol, setSurvol] = React.useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(REQUETE_SURVOL).matches,
  );
  React.useEffect(() => {
    const requete = window.matchMedia(REQUETE_SURVOL);
    const suivre = () => setSurvol(requete.matches);
    suivre();
    requete.addEventListener('change', suivre);
    return () => requete.removeEventListener('change', suivre);
  }, []);
  return gesteDOuverture(survol);
}

/** Un élément posé dans la pile : son identité, son allure, son contenu. */
export interface ElementDePile {
  /** Ce qui le suit d'un rendu à l'autre — et sous quoi sa hauteur est retenue. */
  id: string;
  /** Les classes de son cadre : bordure, fond, couleur du texte. */
  classe?: string;
  contenu: React.ReactNode;
}

export function Pile({
  nom,
  mot,
  elements,
  attributRang = 'data-pile-rang',
  attributsSupplementaires,
}: {
  /** Ce qu'on empile, pour les repères de l'écran : « messages », « agents ». */
  nom: string;
  /** Le nom au singulier, tel qu'il se lit dans le compte et l'annonce. */
  mot: string;
  elements: ElementDePile[];
  /** L'attribut qui porte le rang de chaque élément, lu par les vérifications. */
  attributRang?: string;
  /** Repères posés sur le bloc entier (les scripts s'y accrochent). */
  attributsSupplementaires?: Record<string, string>;
}) {
  const geste = useGesteDOuverture();
  const [ouverte, setOuverte] = React.useState(false);
  const pileRef = React.useRef<HTMLDivElement | null>(null);
  const surLaPile = (evenement: EvenementDePile) =>
    setOuverte((etat) => pileApres(etat, evenement, geste));

  // La géométrie a besoin des hauteurs RÉELLES : un compte rendu de lot tient
  // sur cinq lignes, une erreur sur une seule.
  const [hauteurs, setHauteurs] = React.useState<Record<string, number>>({});
  const mesures = elements.map((element) => hauteurs[element.id] ?? 0);
  const mesurer = (id: string) => (element: HTMLDivElement | null) => {
    if (!element) return;
    const hauteur = element.offsetHeight;
    setHauteurs((current) => (current[id] === hauteur ? current : { ...current, [id]: hauteur }));
  };

  // Un appui ailleurs sur l'écran referme la pile : sans cette sortie, elle
  // resterait déployée au doigt, faute de curseur qui s'en aille.
  React.useEffect(() => {
    if (!ouverte) return;
    const dehors = (event: PointerEvent) => {
      const pile = pileRef.current;
      if (pile && event.target instanceof Node && pile.contains(event.target)) return;
      surLaPile('appui-dehors');
    };
    window.addEventListener('pointerdown', dehors);
    return () => window.removeEventListener('pointerdown', dehors);
  }, [ouverte, geste]);

  // Le dernier élément parti, la pile ne reste pas ouverte sur du vide.
  React.useEffect(() => {
    if (!elements.length && ouverte) setOuverte(false);
  }, [elements.length, ouverte]);

  if (!elements.length) return null;
  const reste = resteDeLaPile(elements.length, mot);

  return (
    <div
      ref={pileRef}
      className="pointer-events-auto w-full"
      data-pile={nom}
      data-pile-ouverte={ouverte ? 'oui' : 'non'}
      data-pile-geste={geste}
      aria-label={annonceDeLaPile(elements.length, ouverte, geste, mot)}
      {...attributsSupplementaires}
      onMouseEnter={() => surLaPile('survol-entre')}
      onMouseLeave={() => surLaPile('survol-sort')}
      // En CAPTURE : l'appui qui déploie doit être retenu AVANT que la croix de
      // l'élément de devant, seul entièrement visible, ne s'en saisisse.
      onClickCapture={(event) => {
        if (appuiDeclencheLAction(ouverte, geste)) return;
        event.preventDefault();
        event.stopPropagation();
        surLaPile('appui-dedans');
      }}
      // Pile déjà ouverte, un appui hors des boutons la referme.
      onClick={(event) => {
        if (geste !== 'appui' || !ouverte) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        surLaPile('appui-dedans');
      }}
    >
      <div
        className="relative w-full transition-[height] ease-out"
        style={{ height: hauteurDeLaPile(mesures, ouverte) || undefined, transitionDuration: `${PILE_DUREE}ms` }}
      >
        {elements.map((element, index) => {
          const place = placeDansLaPile(index, mesures, ouverte);
          return (
            <div
              key={element.id}
              ref={mesurer(element.id)}
              {...{ [attributRang]: index }}
              style={{
                transform: `translateY(${place.decalage}px) scale(${place.echelle})`,
                // Les bas alignés : c'est le liseré du dessous qu'on montre.
                transformOrigin: 'bottom center',
                opacity: place.opacite,
                zIndex: place.profondeur,
                pointerEvents: place.visible ? undefined : 'none',
                transitionDuration: `${PILE_DUREE}ms`,
              }}
              className={cn(
                'absolute inset-x-0 top-0 animate-fade-in transition-[transform,opacity] ease-out',
                element.classe,
              )}
            >
              {element.contenu}
            </div>
          );
        })}
      </div>
      {!ouverte && reste ? (
        <p data-reste={nom} className="pointer-events-none pr-1 pt-1 text-right text-[11.5px] text-faint">
          {reste}
        </p>
      ) : null}
    </div>
  );
}

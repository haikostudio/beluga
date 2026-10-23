import * as React from 'react';
import { questionAMontrer } from '@beluga/shared';
import { BarrePagination } from '@/components/ui/pagination-fleches';

/**
 * PLUSIEURS QUESTIONS NE S'EMPILENT PLUS : ELLES SE FEUILLETTENT.
 *
 * L'agent de cadrage peut poser jusqu'à trois questions dans un même tour.
 * Rendues l'une sous l'autre, elles remplissaient l'écran de champs à moitié
 * remplis et on ne savait plus laquelle attendait quoi.
 *
 * Ici, UNE SEULE est visible à la fois. La pagination est en HAUT À DROITE —
 * « 2 / 3 » entre deux flèches, en petit et sans cadre — et permet de revenir
 * sur une réponse déjà donnée. Répondre fait glisser tout seul sur la suivante
 * encore ouverte (`questionAMontrer`, règle pure) : aucun clic pour avancer.
 *
 * UNE seule question : ni cadre, ni pagination. Le carrousel s'efface, et la
 * question s'affiche exactement comme avant.
 */
export function CarouselQuestions<Q>({
  questions,
  repondue,
  rendu,
  cle,
  pilotage,
}: {
  questions: Q[];
  /** Cette question a-t-elle déjà sa réponse (ou a-t-elle été annulée) ? */
  repondue: (question: Q) => boolean;
  /** Comment dessiner une question — le composant existant, inchangé. */
  rendu: (question: Q) => React.ReactNode;
  /** La clé React d'une question. */
  cle: (question: Q) => string;
  /**
   * PAGINATION POSÉE AILLEURS (entête du panneau des décisions) : le parent
   * garde le choix manuel et dessine lui-même la barre — le carrousel ne la
   * redessine pas. Sans ce pilotage, rien ne change (retour d'analyse, fil).
   */
  pilotage?: { choisie: number | undefined; setChoisie: (index: number | undefined) => void };
}) {
  /*
   * Le choix MANUEL, quand on est revenu en arrière avec les flèches. Tant
   * qu'il n'y en a pas, l'affichage suit la première question sans réponse :
   * c'est ce qui fait avancer le carrousel tout seul.
   */
  const [choisieLocale, setChoisieLocale] = React.useState<number | undefined>(undefined);
  const choisie = pilotage ? pilotage.choisie : choisieLocale;
  const setChoisie = pilotage ? pilotage.setChoisie : setChoisieLocale;
  const repondues = questions.map(repondue);
  const index = questionAMontrer({ repondues, choisie });

  /*
   * Une question qui arrive ou qui disparaît remet le pilotage en automatique :
   * un index figé sur un ancien lot montrerait la mauvaise question.
   */
  React.useEffect(() => {
    setChoisie(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions.length]);

  if (!questions.length) return null;
  if (questions.length === 1) return <>{rendu(questions[0])}</>;

  const question = questions[index];
  if (pilotage) return <div data-carousel-questions key={cle(question)}>{rendu(question)}</div>;

  return (
    /* UI MINIMALISTE : plus de cadre gris supplémentaire autour de la question
       (elle en a déjà un), plus d'entête en capitales, plus de barres de
       progression. Il ne reste que ce qui manquerait vraiment : le rang de la
       question et deux flèches, en petit, alignés à droite au-dessus d'elle. */
    <div data-carousel-questions>
      <div className="mb-1">
        <BarrePagination
          index={index}
          total={questions.length}
          aller={setChoisie}
          repere="pagination-questions"
          libellePrecedent="question-precedente"
          libelleSuivant="question-suivante"
        />
      </div>
      <div key={cle(question)}>{rendu(question)}</div>
    </div>
  );
}

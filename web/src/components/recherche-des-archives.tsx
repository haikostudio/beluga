/**
 * RETROUVER UNE CARTE ARCHIVÉE PAR SON TITRE (demande du 29/10/2026).
 *
 * Le tableau ne pose que des paquets de vingt cartes : sur un projet ancien, une
 * carte archivée il y a deux semaines est déjà 181e de « Archivé », et rien ne
 * permettait de la retrouver sans faire défiler des centaines de cartes — elle
 * paraissait « disparue ». La loupe de la tête de colonne ouvre une fenêtre où
 * l'on tape quelques mots : le DÉMON cherche (`cards.rechercher`, SQL sur le
 * titre et la description), l'écran ne reçoit que les cartes trouvées — rien
 * de plus au premier envoi —, chacune avec son rang dans la colonne. Un clic
 * ouvre la carte, même hors du paquet chargé.
 */
import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { COLUMN_LABELS, type Card, type ColumnKey } from '@beluga/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@/components/ui';
import { client } from '@/lib/client';
import { t, formatRegional } from '@/lib/langue';

/** Le temps de frappe avant d'interroger le démon. */
const ATTENTE_FRAPPE_MS = 250;

type Trouvee = { card: Card; rang: number };

export function RechercheDesArchives({
  projectId,
  colonne = 'archived',
  onOpenCard,
}: {
  projectId: string;
  colonne?: ColumnKey;
  onOpenCard: (cardId: string) => void;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const [texte, setTexte] = React.useState('');
  const [trouvees, setTrouvees] = React.useState<Trouvee[] | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!ouvert) return;
    const voulu = texte.trim();
    if (!voulu) {
      setTrouvees(null);
      setErreur(null);
      return;
    }
    let abandon = false;
    const minuteur = window.setTimeout(() => {
      setEnCours(true);
      client
        .rechercherDesCartes(projectId, colonne, voulu)
        .then((cartes) => {
          if (abandon) return;
          setTrouvees(cartes);
          setErreur(null);
        })
        .catch((err: any) => {
          if (!abandon) setErreur(err?.message ?? String(err));
        })
        .finally(() => {
          if (!abandon) setEnCours(false);
        });
    }, ATTENTE_FRAPPE_MS);
    return () => {
      abandon = true;
      window.clearTimeout(minuteur);
    };
  }, [texte, ouvert, projectId, colonne]);

  const ouvrir = (card: Card) => {
    client.verserCarte(card);
    setOuvert(false);
    onOpenCard(card.id);
  };

  return (
    <>
      <button
        type="button"
        data-recherche-archives={projectId}
        title={t('Rechercher dans les archives')}
        onClick={() => setOuvert(true)}
        className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-text"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
      <Dialog
        open={ouvert}
        onOpenChange={(suite) => {
          setOuvert(suite);
          if (!suite) {
            setTexte('');
            setTrouvees(null);
          }
        }}
      >
        <DialogContent className="sm:w-[min(560px,100%)]" data-fenetre-recherche-archives>
          <DialogHeader>
            <DialogTitle>{t('Rechercher dans « {colonne} »', { colonne: t(COLUMN_LABELS[colonne]) })}</DialogTitle>
          </DialogHeader>
          <div className="relative mt-1">
            <Input
              autoFocus
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              placeholder={t('Quelques mots du titre…')}
              className="pr-8 text-[16px] sm:text-[13px]"
              data-champ-recherche-archives
            />
            {enCours ? <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-faint" /> : null}
          </div>
          <div className="mt-3 flex flex-col gap-0.5" data-resultats-recherche-archives>
            {erreur ? <p className="px-1 text-[13px] text-danger">{erreur}</p> : null}
            {trouvees && !trouvees.length && !erreur ? (
              <p className="px-1 text-[13px] text-faint" data-aucune-carte-trouvee>
                {t('Aucune carte ne correspond.')}
              </p>
            ) : null}
            {trouvees?.map(({ card, rang }) => (
              /* Un bloc cliquable et non un `button` : le titre s'y replie sur
                 deux lignes (`line-clamp`), ce qu'un bouton ne tient pas. */
              <div
                key={card.id}
                role="button"
                tabIndex={0}
                data-carte-trouvee={card.id}
                onClick={() => ouvrir(card)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    ouvrir(card);
                  }
                }}
                className="flex cursor-pointer flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-raised"
              >
                <span className="line-clamp-2 text-[13.5px] text-text">{card.title}</span>
                <span className="text-[12px] text-faint">
                  {t('{rang}e de la colonne · modifiée le {date}', {
                    rang,
                    date: new Date(card.updatedAt).toLocaleDateString(formatRegional()),
                  })}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

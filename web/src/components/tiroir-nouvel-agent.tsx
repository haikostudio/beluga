import * as React from 'react';
import { Bot, Loader2, Search } from 'lucide-react';
import { TITRE_CARTE_DE_CADRAGE, filtrerProjetsParNom, projetsParActivite, type Card } from '@beluga/shared';
import { Drawer, DialogTitle, Input, ZoneDefilement } from '@/components/ui';
import { PastilleProjet } from '@/components/pastille-projet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * FAIRE NAÎTRE UNE CARTE D'AGENT dans un projet, et l'ouvrir en tiroir : une
 * VRAIE carte de cadrage (`card.create`, `cadrage: true`, même geste que
 * « Nouvelle tâche » en tête de « Planifié »). Partagé par le rond du centre
 * du menu du bas (`BoutonRobot`, `web/src/app.tsx`) et par le volet
 * « Nouvel agent » du tableau de bord. `onCree` reçoit l'identifiant AVANT
 * l'ouverture : l'appelant la range si le tiroir se referme vide (voir
 * `carteRobotIdRef` dans `App`). Rien ne part au moteur avant la première
 * demande.
 */
export async function creerCarteAgent(projectId: string, onCree: (cardId: string) => void): Promise<void> {
  try {
    const data = await client.call<{ card: Card }>({
      type: 'card.create',
      projectId,
      title: TITRE_CARTE_DE_CADRAGE,
      cadrage: true,
    });
    if (data?.card) {
      onCree(data.card.id);
      client.openCard(data.card.id);
    }
  } catch (err: any) {
    client.pushToast('error', err?.message ?? t('création impossible'));
  }
}

/**
 * LE VOLET « NOUVEL AGENT » DU TABLEAU DE BORD (téléphone). Le tableau de bord
 * n'est dans aucun projet : on choisit donc d'abord le projet, du plus
 * récemment actif au plus ancien (`projetsParActivite`), puis sa carte
 * d'agent s'ouvre. Choisir un projet le rend aussi ACTIF — ouvrir une carte
 * ramène à son projet, et le tableau derrière le tiroir doit être le sien.
 *
 * Un champ de recherche FIXE (hors de la zone qui défile) filtre la liste par
 * nom (`filtrerProjetsParNom`), vidé à chaque ouverture. Il ne prend le focus
 * que sur grand écran : sur téléphone, le clavier cacherait la liste dès
 * l'ouverture. Entrée choisit le projet quand il n'en reste qu'un.
 */
export function TiroirNouvelAgent({
  open,
  onClose,
  onCree,
}: {
  open: boolean;
  onClose: () => void;
  onCree: (cardId: string) => void;
}) {
  const projets = useApp().projects;
  const [activite, setActivite] = React.useState<Record<string, number>>({});
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [filtre, setFiltre] = React.useState('');
  const champRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setEnCours(null);
    setFiltre('');
    let vivant = true;
    // Après le focus initial du tiroir, sinon il reprendrait la main.
    const focus = window.matchMedia('(min-width: 640px)').matches
      ? window.setTimeout(() => champRef.current?.focus(), 60)
      : undefined;
    client
      .call<{ activite: Record<string, number> }>({ type: 'projects.activite' })
      .then((data) => {
        if (vivant && data?.activite) setActivite(data.activite);
      })
      .catch(() => {});
    return () => {
      vivant = false;
      window.clearTimeout(focus);
    };
  }, [open]);

  const liste = React.useMemo(() => projetsParActivite(projets, activite), [projets, activite]);
  const listeFiltree = React.useMemo(() => filtrerProjetsParNom(liste, filtre), [liste, filtre]);

  const choisir = async (projectId: string) => {
    if (enCours) return;
    setEnCours(projectId);
    client.setActiveProject(projectId);
    await creerCarteAgent(projectId, onCree);
    setEnCours(null);
    onClose();
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Bot className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Dans quel projet ?')}</DialogTitle>
      </header>
      {liste.length ? (
        <div className="relative mx-3 mb-2 shrink-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
          <Input
            ref={champRef}
            data-recherche-nouvel-agent
            value={filtre}
            onChange={(event) => setFiltre(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && listeFiltree.length === 1) {
                event.preventDefault();
                void choisir(listeFiltree[0].id);
              }
            }}
            placeholder={t('Chercher un projet…')}
            className="pl-7"
          />
        </div>
      ) : null}
      <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
        {listeFiltree.length ? (
          <ul data-tiroir-nouvel-agent className="flex flex-col gap-0.5">
            {listeFiltree.map((projet) => (
              <li key={projet.id}>
                <button
                  type="button"
                  data-projet-nouvel-agent={projet.id}
                  aria-busy={enCours === projet.id}
                  disabled={!!enCours}
                  onClick={() => void choisir(projet.id)}
                  className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-text transition-colors hover:bg-raised disabled:cursor-not-allowed"
                >
                  <PastilleProjet project={projet} />
                  <span className="min-w-0 flex-1 truncate">{projet.name}</span>
                  {enCours === projet.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-faint" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-4 text-[13px] text-faint">
            {liste.length ? t('Aucun projet ne correspond à cette recherche.') : t('Aucun projet ouvert.')}
          </p>
        )}
      </ZoneDefilement>
    </Drawer>
  );
}

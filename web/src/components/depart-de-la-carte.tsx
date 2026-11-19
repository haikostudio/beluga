import * as React from 'react';
import { CalendarClock, Loader2 } from '@/components/ui/icones';
import { COLONNES_AVANT_LE_TRAVAIL, momentDuCreneau, type Card, type ColumnKey } from '@beluga/shared';
import { Button, Drawer, DropdownMenuItem, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { ChoixDHeure, GrilleDuMois, dateEnTexte } from '@/components/ui/elements-maison';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE DÉPART D'UNE CARTE, CHOISI DANS SA CONFIGURATION (demande du 19/11/2026, maquette #6292).
 *
 * Une ligne « Départ » sous « Compte » dans le menu « Configuration de l'agent » : « Dès le lancement », ou la date
 * retenue. Elle ouvre une FEUILLE « Départ de la tâche » : deux raccourcis (dès le lancement, créneau conseillé), un
 * calendrier, l'heure au quart d'heure, et un pied collé « Effacer » / « Partir le … ». Le choix s'écrit par la
 * commande existante `card.schedule` (`scheduling.departPrevu`) : la carte attend dans « Planifié » et part seule à
 * l'heure, exécutée par l'ordonnanceur. Rien ne pose de date tout seul : seul ce geste la fixe (DEC-034).
 */

/** La carte peut-elle encore recevoir une date ? Seulement avant le travail (« Planifié », « À faire »). */
export function departModifiable(card: Pick<Card, 'column'>): boolean {
  return card.column === 'todo' || COLONNES_AVANT_LE_TRAVAIL.includes(card.column as ColumnKey);
}

/** « jeu. 20 nov. · 09:00 » — la date d'un départ, dans la langue de l'interface. */
export function dateDeDepartLisible(date: number): string {
  const quand = new Date(date);
  const jour = quand.toLocaleDateString(formatRegional(), { weekday: 'short', day: 'numeric', month: 'short' });
  const heure = quand.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
  return `${jour} · ${heure}`;
}

/** La valeur de la ligne « Départ » : la date retenue, ou « Dès le lancement ». */
export function valeurDuDepart(card: Pick<Card, 'scheduling'>): string {
  const date = card.scheduling?.departPrevu;
  return date ? dateDeDepartLisible(date) : t('Dès le lancement');
}

/** La ligne « Départ » du menu de configuration : même gabarit que Moteur, Modèle, Réflexion et Compte. */
export function EntreeDuDepart({ card, onOuvrir }: { card: Card; onOuvrir: () => void }) {
  const valeur = valeurDuDepart(card);
  return (
    <DropdownMenuItem
      onSelect={() => onOuvrir()}
      className="min-w-0 rounded-md py-2"
      data-selecteur="depart"
      data-valeur={valeur}
    >
      <span className="shrink-0 text-faint">{t('Départ')}</span>
      <span className="min-w-0 flex-1 truncate text-right text-text">{valeur}</span>
    </DropdownMenuItem>
  );
}

const QUART_D_HEURE = 15 * 60 * 1000;
const deuxChiffres = (n: number) => String(n).padStart(2, '0');

/** Le prochain quart d'heure plein, au moins une demi-heure devant : la proposition d'un calendrier vierge. */
function prochainQuartDHeure(maintenant: number): number {
  return Math.ceil((maintenant + 30 * 60 * 1000) / QUART_D_HEURE) * QUART_D_HEURE;
}

/** Combine un jour (« AAAA-MM-JJ ») et une heure (« HH:MM ») en un instant LOCAL : 9 h chez l'utilisateur. */
function instantLocal(jour: string, heure: string): number | null {
  const j = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  const h = /^(\d{1,2}):(\d{2})$/.exec(heure);
  if (!j || !h) return null;
  const date = new Date(Number(j[1]), Number(j[2]) - 1, Number(j[3]), Number(h[1]), Number(h[2]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function FeuilleDuDepart({ card, open, onClose }: { card: Card; open: boolean; onClose: () => void }) {
  const depart = card.scheduling?.departPrevu;
  const creneau = card.scheduling?.creneauConseille;
  const [jour, setJour] = React.useState('');
  const [heure, setHeure] = React.useState('');
  const [mois, setMois] = React.useState(() => new Date());
  const [envoi, setEnvoi] = React.useState<'poser' | 'effacer' | null>(null);

  /* À CHAQUE OUVERTURE, la feuille repart de la date de la carte, ou du prochain quart d'heure. */
  React.useEffect(() => {
    if (!open) return;
    const base = new Date(depart && depart > Date.now() ? depart : prochainQuartDHeure(Date.now()));
    setJour(dateEnTexte(base));
    setHeure(`${deuxChiffres(base.getHours())}:${deuxChiffres(base.getMinutes())}`);
    setMois(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open, depart]);

  const aujourdHui = new Date();
  aujourdHui.setHours(0, 0, 0, 0);
  const instant = instantLocal(jour, heure);
  const passe = instant !== null && instant <= Date.now();
  const momentConseille = creneau ? momentDuCreneau(creneau, Date.now()) : null;

  const ecrire = async (date: number | undefined, genre: 'poser' | 'effacer') => {
    setEnvoi(genre);
    try {
      await client.call({ type: 'card.schedule', id: card.id, date });
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Réglage impossible'));
    } finally {
      setEnvoi(null);
    }
  };

  const raccourci = (libelle: string, valeur: string, geste: () => void, repere: string, actif: boolean) => (
    <button
      type="button"
      onClick={geste}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-md bg-surface px-3 py-2 text-left transition-colors hover:bg-fond-survol sm:py-1.5',
        actif && 'bg-fond-survol',
      )}
      data-raccourci-depart={repere}
    >
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text">{libelle}</span>
      <span className="shrink-0 text-[12.5px] text-faint">{valeur}</span>
    </button>
  );

  return (
    <Drawer open={open} onClose={onClose} feuille>
      <EnteteDeFeuille titre={t('Départ de la tâche')} data-entete-depart="" />
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-3 pb-3">
        <div className="flex flex-col gap-3" data-feuille-depart={card.id}>
          <div className="flex flex-col gap-1 rounded-lg bg-raised p-1.5">
            {raccourci(t('Dès le lancement'), t('au clic sur « Lancer »'), () => void ecrire(undefined, 'effacer'), 'lancement', !depart)}
            {momentConseille
              ? raccourci(
                  t('Créneau conseillé'),
                  dateDeDepartLisible(momentConseille),
                  () => {
                    const d = new Date(momentConseille);
                    setJour(dateEnTexte(d));
                    setHeure(`${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`);
                    setMois(new Date(d.getFullYear(), d.getMonth(), 1));
                  },
                  'creneau',
                  instant === momentConseille,
                )
              : null}
          </div>
          <div className="rounded-lg bg-raised p-2" data-calendrier-depart="">
            <GrilleDuMois
              mois={mois}
              setMois={setMois}
              valeur={jour}
              horsBornes={(d) => d < aujourdHui}
              onChoisir={(d) => setJour(dateEnTexte(d))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] text-faint">{t('Heure')}</span>
            <ChoixDHeure valeur={heure} onChange={setHeure} pasMinutes={15} aria-label="Heure du départ" data-heure-depart="" />
          </div>
          {passe ? (
            <p className="text-[12.5px] leading-snug text-danger" data-depart-passe="">
              {t('Ce moment est déjà passé : choisissez une heure à venir.')}
            </p>
          ) : null}
        </div>
      </ZoneDefilement>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2" data-pied-depart="">
        <Button
          variant="subtle"
          className="shrink-0"
          disabled={!!envoi || !depart}
          onClick={() => void ecrire(undefined, 'effacer')}
          data-effacer-depart=""
        >
          {envoi === 'effacer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('Effacer')}
        </Button>
        <Button
          className="min-w-0 flex-1"
          disabled={!!envoi || instant === null || passe}
          onClick={() => instant !== null && void ecrire(instant, 'poser')}
          data-poser-depart=""
        >
          {envoi === 'poser' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
          <span className="truncate">
            {instant !== null ? t('Partir le {date}', { date: dateDeDepartLisible(instant) }) : t('Partir')}
          </span>
        </Button>
      </div>
    </Drawer>
  );
}

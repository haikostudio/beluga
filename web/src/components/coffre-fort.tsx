import * as React from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  AccesCoffre,
  ChampAcces,
  ID_ACCES_VPS,
  LIBELLE_TYPE_ACCES,
  NOM_ACCES_MAX,
  TYPES_ACCES,
  TypeAcces,
  apercuAcces,
  champsDuType,
  filtrerAcces,
} from '@haikodev/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  Textarea,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE COFFRE-FORT — un tiroir, une liste, un tiroir empilé par fiche.
 *
 * Le premier tiroir montre TOUS les accès enregistrés, tous projets confondus,
 * avec une barre de recherche qui mord sur le nom, le projet et le type. Le
 * bouton de création propose les types d'accès ; l'ouverture d'une fiche —
 * nouvelle ou existante — se fait dans un SECOND tiroir posé par-dessus le
 * premier, jamais à sa place : on referme le détail et la liste est toujours
 * là, à la même ligne.
 *
 * Les règles (types, champs, recherche) vivent dans `shared/src/coffre-fort.ts`.
 */

/** Une fiche vierge du type demandé, telle que le second tiroir la reçoit. */
function ficheVierge(type: TypeAcces, projectId: string | null): AccesCoffre {
  return {
    id: '',
    nom: '',
    type,
    projectId,
    champs: {},
    note: '',
    creeLe: 0,
    modifieLe: 0,
    origine: 'coffre',
  };
}

export function CoffreFort({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApp();
  const [liste, setListe] = React.useState<AccesCoffre[]>([]);
  const [recherche, setRecherche] = React.useState('');
  const [chargement, setChargement] = React.useState(false);
  const [fiche, setFiche] = React.useState<AccesCoffre | null>(null);

  const nomProjet = React.useCallback(
    (projectId: string | null) => state.projects.find((p) => p.id === projectId)?.name,
    [state.projects],
  );

  // La liste se relit à CHAQUE ouverture : un accès posé depuis un autre onglet
  // ou par un agent doit être là, sans recharger la page.
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    setChargement(true);
    client
      .call<{ acces: AccesCoffre[] }>({ type: 'coffre.lister' })
      .then((data) => {
        if (vivant) setListe(data.acces ?? []);
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Coffre-fort illisible')))
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [open]);

  const visibles = filtrerAcces(liste, recherche, nomProjet);

  return (
    <>
      <Drawer open={open} onClose={onClose}>
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <Key className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Coffre-fort')}</DialogTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" data-coffre-creer>
                <Plus className="h-3 w-3" />
                {t('Nouvel accès')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('Type d’accès')}</DropdownMenuLabel>
              {TYPES_ACCES.map((type) => (
                <DropdownMenuItem
                  key={type}
                  data-coffre-type={type}
                  onSelect={() => setFiche(ficheVierge(type, state.activeProjectId ?? null))}
                >
                  {t(LIBELLE_TYPE_ACCES[type])}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t('Chercher par nom, projet ou type…')}
              className="h-8 pl-7 text-[13px]"
              autoComplete="off"
              data-coffre-recherche
            />
          </div>
        </div>

        <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
          {chargement && !liste.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">{t('Lecture du coffre…')}</p>
          ) : !visibles.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {recherche ? t('Aucun accès ne correspond.') : t('Aucun accès enregistré pour l’instant.')}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {visibles.map((acces) => (
                <LigneAcces
                  key={acces.id}
                  acces={acces}
                  projet={nomProjet(acces.projectId)}
                  onOuvrir={() => setFiche(acces)}
                />
              ))}
            </div>
          )}
        </ZoneDefilement>
      </Drawer>

      {/* Le détail : empilé par-dessus la liste, qui reste ouverte derrière. */}
      <FicheAcces
        fiche={fiche}
        onClose={() => setFiche(null)}
        onListe={(nouvelle) => setListe(nouvelle)}
      />
    </>
  );
}

/** Une ligne de la liste : ce qui identifie l'accès, jamais ce qu'il protège. */
function LigneAcces({
  acces,
  projet,
  onOuvrir,
}: {
  acces: AccesCoffre;
  projet?: string;
  onOuvrir: () => void;
}) {
  const apercu = apercuAcces(acces);
  return (
    <button
      type="button"
      onClick={onOuvrir}
      data-coffre-acces={acces.id}
      className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-raised"
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{acces.nom}</span>
        <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[acces.type])}</Badge>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 text-[12px] text-faint">
        <span className="truncate">{projet ?? t('Général')}</span>
        {apercu ? (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{apercu}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Le tiroir empilé : les champs du type, le projet, la note. Un champ secret
 * est masqué tant qu'on ne demande pas à le voir, et se copie sans jamais
 * s'afficher.
 */
function FicheAcces({
  fiche,
  onClose,
  onListe,
}: {
  fiche: AccesCoffre | null;
  onClose: () => void;
  onListe: (liste: AccesCoffre[]) => void;
}) {
  const state = useApp();
  const [nom, setNom] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [champs, setChamps] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState(false);

  // Le formulaire se REMPLIT à l'ouverture, et seulement là : une frappe en
  // cours ne doit pas se faire écraser par une relecture de la liste.
  React.useEffect(() => {
    if (!fiche) return;
    setNom(fiche.nom);
    setProjectId(fiche.projectId);
    setChamps({ ...fiche.champs });
    setNote(fiche.note);
  }, [fiche?.id, fiche?.type, fiche]);

  const type = fiche?.type ?? 'autre';
  const desReglages = fiche?.id === ID_ACCES_VPS;

  const enregistrer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      const data = await client.call<{ liste: AccesCoffre[] }>({
        type: 'coffre.enregistrer',
        acces: { id: fiche.id, nom, type, projectId, champs, note },
      });
      onListe(data.liste ?? []);
      client.pushToast('success', t('Accès enregistré.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non enregistré'));
    } finally {
      setEnCours(false);
    }
  };

  const supprimer = async () => {
    if (!fiche) return;
    try {
      const data = await client.call<{ liste: AccesCoffre[] }>({ type: 'coffre.supprimer', id: fiche.id });
      onListe(data.liste ?? []);
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non retiré'));
    }
  };

  return (
    <>
      <Drawer open={fiche !== null} onClose={onClose} empile>
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">
            {fiche?.id ? fiche.nom || t('Accès') : t('Nouvel accès')}
          </DialogTitle>
          <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[type])}</Badge>
        </header>

        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
          <div className="flex flex-col gap-3">
            <Champ libelle={t('Nom')}>
              <Input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                maxLength={NOM_ACCES_MAX}
                placeholder={t('Comment reconnaître cet accès')}
                className="h-8 text-[13px]"
                autoComplete="off"
                data-coffre-nom
              />
            </Champ>

            <Champ libelle={t('Projet')}>
              <select
                value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value || null)}
                disabled={desReglages}
                data-coffre-projet
                className="h-8 w-full rounded-md border border-border bg-bg px-2 text-[13px] text-text disabled:opacity-60"
              >
                <option value="">{t('Général')}</option>
                {state.projects.map((projet) => (
                  <option key={projet.id} value={projet.id}>
                    {projet.name}
                  </option>
                ))}
              </select>
            </Champ>

            {champsDuType(type).map((champ) => (
              <ChampValeur
                key={champ.cle}
                champ={champ}
                valeur={champs[champ.cle] ?? ''}
                onChange={(valeur) => setChamps((avant) => ({ ...avant, [champ.cle]: valeur }))}
              />
            ))}

            <Champ libelle={t('Note')}>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t('À quoi sert cet accès, où il s’utilise…')}
                className="text-[13px]"
                data-coffre-note
              />
            </Champ>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Button variant="secondary" size="sm" onClick={enregistrer} disabled={enCours || !nom.trim()} data-coffre-enregistrer>
                {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {t('Enregistrer')}
              </Button>
              {fiche?.id && !desReglages ? (
                <Button variant="ghost" size="sm" onClick={() => setASupprimer(true)} data-coffre-supprimer>
                  <Trash2 className="h-3 w-3" />
                  {t('Retirer')}
                </Button>
              ) : null}
            </div>

            {desReglages ? (
              <p className="text-[12px] leading-relaxed text-faint">
                {t('Ces accès sont ceux de l’onglet « Système » : les modifier ici les modifie là-bas.')}
              </p>
            ) : null}
          </div>
        </ZoneDefilement>
      </Drawer>

      <ConfirmDialog
        open={aSupprimer}
        onClose={() => setASupprimer(false)}
        title={t('Retirer cet accès ?')}
        description={t('La fiche et tout ce qu’elle contient disparaissent du coffre.')}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={supprimer}
      />
    </>
  );
}

/** Un libellé au-dessus de son champ, la même mise en page partout. */
function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">{libelle}</span>
      {children}
    </label>
  );
}

/**
 * Un champ de la fiche. Secret, il est masqué par défaut : un œil le dévoile,
 * un bouton le copie sans qu'il ait jamais à s'afficher.
 */
function ChampValeur({
  champ,
  valeur,
  onChange,
}: {
  champ: ChampAcces;
  valeur: string;
  onChange: (valeur: string) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const masque = champ.secret === true && !visible;

  const copier = () => {
    void navigator.clipboard?.writeText(valeur);
    client.pushToast('success', t('Copié'));
  };

  return (
    <Champ libelle={t(champ.libelle)}>
      <div className="flex items-start gap-1.5">
        {champ.multiligne && !masque ? (
          <Textarea
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder={champ.exemple}
            className={cn('flex-1 text-[13px]', champ.secret && 'font-mono')}
            data-coffre-champ={champ.cle}
          />
        ) : (
          <Input
            type={masque ? 'password' : 'text'}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            placeholder={champ.exemple}
            className={cn('h-8 flex-1 text-[13px]', champ.secret && 'font-mono')}
            autoComplete="off"
            data-coffre-champ={champ.cle}
          />
        )}
        {champ.secret ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={visible ? 'Masquer' : 'Afficher'}
            title={visible ? t('Masquer') : t('Afficher')}
            onClick={() => setVisible((v) => !v)}
            data-coffre-oeil={champ.cle}
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        ) : null}
        {valeur ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Copier"
            title={t('Copier')}
            onClick={copier}
            data-coffre-copier={champ.cle}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </Champ>
  );
}

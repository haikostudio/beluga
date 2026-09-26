import * as React from 'react';
import { Check, Copy, Eye, EyeOff, Key, Loader2, Archive, ArchiveRestore, Plus, Search, Trash2 } from 'lucide-react';
import {
  AccesCoffre,
  ChampAcces,
  LIBELLE_TYPE_ACCES,
  NOM_ACCES_MAX,
  TYPES_ACCES,
  TypeAcces,
  apercuAcces,
  champsDuType,
  echeanceArchive,
  filtrerAcces,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  ConfirmDialog,
  DialogFooter,
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
import { SilhouetteCoffre } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useElementAdresse } from '@/lib/adresse-element';

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
 * RETIRER N'EFFACE PAS : une fiche retirée part aux ARCHIVES, qui vivent dans
 * un TIROIR À ELLES, ouvert par le bouton « Archives » de l'entête et posé
 * par-dessus la liste des accès actifs — jamais à sa place : l'ancienne bascule
 * changeait le contenu de la liste sans que rien ne dise qu'on regardait autre
 * chose. Le tiroir porte sa propre recherche, la date d'effacement de chaque
 * fiche (six mois après son retrait) et le bouton qui la restaure ; on revient
 * aux accès actifs en le refermant, jamais en recliquant « Archives ».
 *
 * Les règles (types, champs, recherche, archives) vivent dans `shared/src/coffre-fort.ts`.
 */

/** La date d'effacement d'une archive, dans la langue en vigueur. */
function dateEffacement(acces: AccesCoffre): string {
  const echeance = echeanceArchive(acces);
  return echeance ? new Date(echeance).toLocaleDateString(formatRegional()) : '';
}

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

export function CoffreFort({
  open,
  onClose,
  enPage,
  vise,
  onVise,
}: {
  open: boolean;
  onClose: () => void;
  /** Écran plein du volet central, au lieu d'un tiroir posé par-dessus. */
  enPage?: boolean;
  /** LA FICHE DÉSIGNÉE PAR L'ADRESSE : « #coffre/<id> ». */
  vise?: string | null;
  /** …et, en sens inverse, la fiche ouverte, pour que l'adresse la décrive. */
  onVise?: (ficheId: string | null) => void;
}) {
  const state = useApp();
  const [liste, setListe] = React.useState<AccesCoffre[]>([]);
  const [archives, setArchives] = React.useState<AccesCoffre[]>([]);
  /* Le tiroir des archives : une COUCHE de plus, pas une autre liste à la
     place de celle-ci. Sa recherche est la sienne — partager celle du fond
     ferait disparaître des lignes derrière, sans raison visible. */
  const [archivesOuvertes, setArchivesOuvertes] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  /* VRAI DÈS LE PREMIER RENDU : l'effet qui lit le coffre ne tourne qu'APRÈS,
     et l'écran annonçait « aucun accès enregistré » le temps d'une image. */
  const [chargement, setChargement] = React.useState(true);
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
      .call<{ acces: AccesCoffre[]; archives?: AccesCoffre[] }>({
        type: 'coffre.lister',
      })
      .then((data) => {
        if (!vivant) return;
        setListe(data.acces ?? []);
        setArchives(data.archives ?? []);
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Coffre-fort illisible')))
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [open]);

  /*
   * L'ADRESSE ET LA FICHE OUVERTE SE SUIVENT. Une fiche ARCHIVÉE reste
   * atteignable par son lien : on cherche dans les deux listes, et l'on OUVRE
   * le tiroir des archives quand la cible y est — sinon la fiche se poserait
   * sur une liste qui ne la contient pas.
   */
  useElementAdresse({
    vise,
    onVise,
    ouvertId: fiche?.id || null,
    pret: !chargement,
    absent: t('Cet accès n’existe plus dans le coffre-fort.'),
    ouvrir: (id) => {
      const active = liste.find((acces) => acces.id === id);
      if (active) {
        setFiche(active);
        return true;
      }
      const archivee = archives.find((acces) => acces.id === id);
      if (!archivee) return false;
      setArchivesOuvertes(true);
      setFiche(archivee);
      return true;
    },
  });

  const visibles = filtrerAcces(liste, recherche, nomProjet);
  const recevoir = (nouvelle: AccesCoffre[], nouvellesArchives?: AccesCoffre[]) => {
    setListe(nouvelle);
    if (nouvellesArchives) setArchives(nouvellesArchives);
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <Key className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Coffre-fort')}</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setArchivesOuvertes(true)}
            aria-haspopup="dialog"
            data-coffre-voir-archives
          >
            <Archive className="h-3 w-3" />
            {t('Archives')}
            {archives.length ? <span className="text-faint">{archives.length}</span> : null}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="sm" data-coffre-creer>
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
            /* Les accès à venir en silhouette, jamais une phrase d'attente :
               l'état vide ne se dit qu'une fois la liste réellement reçue. */
            <SilhouetteCoffre />
          ) : !visibles.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {recherche ? t('Aucun accès ne correspond.') : t('Aucun accès enregistré pour l’instant.')}
            </p>
          ) : (
            <div className="flex flex-col gap-1" data-coffre-liste="actifs">
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

      {/* Les archives : un tiroir posé par-dessus la liste, qui reste entière
          derrière lui. */}
      <TiroirArchives
        open={archivesOuvertes}
        onClose={() => setArchivesOuvertes(false)}
        archives={archives}
        nomProjet={nomProjet}
        onOuvrir={setFiche}
      />

      {/* Le détail : empilé par-dessus la liste — ou par-dessus les archives. */}
      <FicheAcces fiche={fiche} onClose={() => setFiche(null)} onListe={recevoir} />
    </>
  );
}

/**
 * LE TIROIR DES ARCHIVES — tout ce qu'on peut faire d'une fiche retirée, au
 * même endroit : la chercher, lire la date où elle sera effacée, l'ouvrir pour
 * la restaurer. Il se referme comme n'importe quel tiroir, et la liste des
 * accès actifs est là, intacte, dessous.
 */
function TiroirArchives({
  open,
  onClose,
  archives,
  nomProjet,
  onOuvrir,
}: {
  open: boolean;
  onClose: () => void;
  archives: AccesCoffre[];
  nomProjet: (projectId: string | null) => string | undefined;
  onOuvrir: (acces: AccesCoffre) => void;
}) {
  const [recherche, setRecherche] = React.useState('');
  /* La recherche repart à blanc à chaque ouverture : un filtre oublié d'une
     fois sur l'autre ferait croire à des archives disparues. */
  React.useEffect(() => {
    if (!open) setRecherche('');
  }, [open]);

  const visibles = filtrerAcces(archives, recherche, nomProjet);

  return (
    <Drawer open={open} onClose={onClose} empile>
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
        <Archive className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Archives du coffre-fort')}</DialogTitle>
        {archives.length ? <Badge tone="neutral">{archives.length}</Badge> : null}
        <BulleInfo>{t('Une fiche retirée reste ici six mois, puis elle est effacée pour de bon.')}</BulleInfo>
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
            data-coffre-recherche-archives
          />
        </div>
      </div>

      <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
        {!visibles.length ? (
          <p className="px-1 py-3 text-[12.5px] text-faint">
            {recherche ? t('Aucun accès ne correspond.') : t('Aucune fiche archivée.')}
          </p>
        ) : (
          <div className="flex flex-col gap-1" data-coffre-liste="archives">
            {visibles.map((acces) => (
              <LigneAcces
                key={acces.id}
                acces={acces}
                projet={nomProjet(acces.projectId)}
                onOuvrir={() => onOuvrir(acces)}
              />
            ))}
          </div>
        )}
      </ZoneDefilement>
    </Drawer>
  );
}

/** Une ligne de la liste : ce qui identifie l'accès, jamais ce qu'il protège. */
function LigneAcces({ acces, projet, onOuvrir }: { acces: AccesCoffre; projet?: string; onOuvrir: () => void }) {
  const apercu = apercuAcces(acces);
  return (
    <button
      type="button"
      onClick={onOuvrir}
      data-coffre-acces={acces.id}
      className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border bg-bloc px-2.5 py-2 text-left transition-colors hover:bg-raised"
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{acces.nom}</span>
        <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[acces.type])}</Badge>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 text-[12px] text-faint">
        <span className="truncate">{projet ?? t('Général')}</span>
        {acces.archiveLe ? (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0" data-coffre-effacement>
              {t('effacée le {date}', { date: dateEffacement(acces) })}
            </span>
          </>
        ) : null}
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
  onListe: (liste: AccesCoffre[], archives?: AccesCoffre[]) => void;
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
  const archivee = Boolean(fiche?.archiveLe);

  const enregistrer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      const data = await client.call<{
        liste: AccesCoffre[];
        archives?: AccesCoffre[];
      }>({
        type: 'coffre.enregistrer',
        acces: { id: fiche.id, nom, type, projectId, champs, note },
      });
      onListe(data.liste ?? [], data.archives);
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
      const data = await client.call<{
        liste: AccesCoffre[];
        archives?: AccesCoffre[];
      }>({
        type: 'coffre.supprimer',
        id: fiche.id,
      });
      onListe(data.liste ?? [], data.archives);
      client.pushToast('success', t('Accès archivé.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non retiré'));
    }
  };

  const restaurer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      const data = await client.call<{
        liste: AccesCoffre[];
        archives?: AccesCoffre[];
      }>({
        type: 'coffre.restaurer',
        id: fiche.id,
      });
      onListe(data.liste ?? [], data.archives);
      client.pushToast('success', t('Accès restauré.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non restauré'));
    } finally {
      setEnCours(false);
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

            {archivee && fiche ? (
              <p className="text-[12px] leading-relaxed text-faint" data-coffre-archive-info>
                {t('Fiche archivée : elle sera effacée le {date}, sauf si vous la restaurez.', {
                  date: dateEffacement(fiche),
                })}
              </p>
            ) : null}

          </div>
        </ZoneDefilement>

        <DialogFooter className="justify-start px-3 pt-2">
          {archivee ? (
            <Button variant="subtle" size="sm" onClick={restaurer} disabled={enCours} data-coffre-restaurer>
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArchiveRestore className="h-3 w-3" />}
              {t('Restaurer')}
            </Button>
          ) : (
            <Button
              variant="subtle"
              size="sm"
              onClick={enregistrer}
              disabled={enCours || !nom.trim()}
              data-coffre-enregistrer
            >
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {t('Enregistrer')}
            </Button>
          )}
          {fiche?.id && !archivee ? (
            <Button variant="ghost" size="sm" onClick={() => setASupprimer(true)} data-coffre-supprimer>
              <Trash2 className="h-3 w-3" />
              {t('Retirer')}
            </Button>
          ) : null}
        </DialogFooter>
      </Drawer>

      <ConfirmDialog
        open={aSupprimer}
        onClose={() => setASupprimer(false)}
        title={t('Retirer cet accès ?')}
        description={t(
          'La fiche part aux archives : elle se restaure pendant six mois, puis elle est effacée pour de bon.',
        )}
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

import * as React from 'react';
import { AlertTriangle, Check, Database, Download, Loader2, Upload } from 'lucide-react';
import {
  BilanImport,
  CategorieExport,
  EXPLICATION_POLITIQUE,
  LIBELLE_POLITIQUE,
  PolitiqueConflit,
  definitionCategorie,
  dependancesManquantes,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  DialogTitle,
  Drawer,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * L'EXPORT ET L'IMPORT INTÉGRAL DES DONNÉES — un tiroir, deux onglets.
 *
 * « Exporter » montre les catégories avec ce que chacune emporte, TOUTES
 * COCHÉES : on retire ce dont on ne veut pas, on n'ajoute rien. Le bouton rend
 * une archive ZIP à télécharger.
 *
 * « Importer » se lit dans l'ordre où l'on hésite : on dépose le fichier, on
 * voit d'OÙ il vient et ce qu'il contient, on décoche, on choisit ce qu'on fait
 * des fiches déjà présentes, et seulement ensuite on lance. Le compte rendu dit
 * table par table combien de lignes sont entrées, ont été remplacées ou
 * laissées.
 *
 * Les règles (catégories, politiques, validation) vivent dans
 * `shared/src/export-donnees.ts`.
 */

interface EtatCategorie {
  cle: CategorieExport;
  libelle: string;
  description: string;
  lignes: number;
  tables: string[];
}

const POLITIQUES: PolitiqueConflit[] = ['ignorer', 'remplacer', 'remettre-a-zero'];

export function TiroirDonnees({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} className="max-w-2xl">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Database className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Export et import des données')}</DialogTitle>
        <BulleInfo>
          {t('Une archive ZIP de tout ce que cette installation garde, lisible telle quelle et remontable sur un autre serveur. Les valeurs sensibles y sont en clair : c’est ce qui permet de retrouver ses accès en face.')}
          {'\n\n'}
          {t('Déposez une archive écrite par un autre Beluga Build. Elle est vérifiée avant toute écriture : version, contenu et empreinte de chaque fichier.')}
        </BulleInfo>
      </header>

      <Tabs defaultValue="exporter" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 pb-2">
          <TabsList>
            <TabsTrigger value="exporter" data-donnees-onglet="exporter">
              {t('Exporter')}
            </TabsTrigger>
            <TabsTrigger value="importer" data-donnees-onglet="importer">
              {t('Importer')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="exporter" className="flex min-h-0 flex-1 flex-col outline-none">
          <PanneauExport open={open} />
        </TabsContent>
        <TabsContent value="importer" className="flex min-h-0 flex-1 flex-col outline-none">
          <PanneauImport />
        </TabsContent>
      </Tabs>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Exporter                                                            */
/* ------------------------------------------------------------------ */

function PanneauExport({ open }: { open: boolean }) {
  const [categories, setCategories] = React.useState<EtatCategorie[]>([]);
  const [origine, setOrigine] = React.useState('');
  const [cochees, setCochees] = React.useState<string[]>([]);
  const [lecture, setLecture] = React.useState(false);
  const [enCours, setEnCours] = React.useState(false);

  // Le décompte se relit à CHAQUE ouverture : une carte créée entre-temps doit
  // apparaître dans le nombre annoncé, sans recharger la page.
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    setLecture(true);
    client
      .call<{ categories: EtatCategorie[]; origine: string }>({ type: 'donnees.categories' })
      .then((data) => {
        if (!vivant) return;
        setCategories(data.categories ?? []);
        setOrigine(data.origine ?? '');
        setCochees((data.categories ?? []).map((c) => c.cle));
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Lecture des données impossible')))
      .finally(() => {
        if (vivant) setLecture(false);
      });
    return () => {
      vivant = false;
    };
  }, [open]);

  const basculer = (cle: string) =>
    setCochees((avant) => (avant.includes(cle) ? avant.filter((c) => c !== cle) : [...avant, cle]));

  const manquantes = dependancesManquantes(cochees);

  const exporter = async () => {
    setEnCours(true);
    try {
      const data = await client.call<{ token: string; name: string; size: number }>({
        type: 'donnees.exporter',
        categories: cochees,
      });
      window.location.href = `/api/download?token=${encodeURIComponent(data.token)}`;
      client.pushToast('success', t('Archive prête : {v0}', { v0: poids(data.size) }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Export impossible'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-2">

        {origine ? (
          <p className="pb-2 text-[12px] text-faint">{t('Machine d’origine : {v0}', { v0: origine })}</p>
        ) : null}

        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" data-donnees-tout-cocher onClick={() => setCochees(categories.map((c) => c.cle))}>
            {t('Tout cocher')}
          </Button>
          <Button variant="ghost" size="sm" data-donnees-tout-decocher onClick={() => setCochees([])}>
            {t('Tout décocher')}
          </Button>
        </div>

        {lecture && !categories.length ? (
          <p className="py-3 text-[12.5px] text-faint">{t('Lecture des données…')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {categories.map((categorie) => (
              <CaseCategorie
                key={categorie.cle}
                cle={categorie.cle}
                libelle={categorie.libelle}
                description={categorie.description}
                detail={
                  categorie.cle === 'branches'
                    ? t('{n} dépôt(s) git', { n: categorie.lignes })
                    : t('{n} ligne(s)', { n: categorie.lignes })
                }
                coche={cochees.includes(categorie.cle)}
                onBasculer={() => basculer(categorie.cle)}
              />
            ))}
          </div>
        )}

        {manquantes.length ? <Avertissement manquantes={manquantes} /> : null}
      </ZoneDefilement>

      <div className="shrink-0 border-t border-faint/40 px-3 pt-2">
        <Button className="w-full" disabled={!cochees.length || enCours} data-donnees-exporter onClick={() => void exporter()}>
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {enCours ? t('Fabrication de l’archive…') : t('Créer et télécharger l’archive')}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Importer                                                            */
/* ------------------------------------------------------------------ */

interface Apercu {
  manifeste: { origine: string; creeLe: number; versionOutil: string };
  contenu: { cle: CategorieExport; libelle: string; lignes: number }[];
  abimes: string[];
}

function PanneauImport() {
  const champ = React.useRef<HTMLInputElement | null>(null);
  const [depot, setDepot] = React.useState('');
  const [apercu, setApercu] = React.useState<Apercu | null>(null);
  const [cochees, setCochees] = React.useState<string[]>([]);
  const [politique, setPolitique] = React.useState<PolitiqueConflit>('ignorer');
  const [envoi, setEnvoi] = React.useState(false);
  const [enCours, setEnCours] = React.useState(false);
  const [refus, setRefus] = React.useState('');
  const [bilan, setBilan] = React.useState<BilanImport | null>(null);

  const deposer = async (fichier: File) => {
    setRefus('');
    setBilan(null);
    setEnvoi(true);
    try {
      const reponse = await fetch('/api/donnees/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: fichier,
      });
      const data = await reponse.json().catch(() => ({}));
      if (!reponse.ok || !data?.apercu?.ok) {
        setRefus(data?.error ?? t('Archive refusée.'));
        return;
      }
      setDepot(data.depot);
      setApercu(data.apercu);
      setCochees((data.apercu.contenu ?? []).map((c: { cle: string }) => c.cle));
    } catch (err: any) {
      setRefus(err?.message ?? t('Archive refusée.'));
    } finally {
      setEnvoi(false);
      // Sans cela, redéposer le MÊME fichier ne déclencherait plus rien.
      if (champ.current) champ.current.value = '';
    }
  };

  const importer = async () => {
    setEnCours(true);
    setRefus('');
    try {
      const data = await client.call<{ bilan: BilanImport }>({
        type: 'donnees.importer',
        depot,
        categories: cochees,
        politique,
      });
      setBilan(data.bilan);
      client.pushToast('success', t('Import terminé : {n} table(s) remontée(s).', { n: data.bilan.tables.length }));
    } catch (err: any) {
      setRefus(err?.message ?? t('Import impossible'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-2">

        <input
          ref={champ}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          data-donnees-fichier
          onChange={(event) => {
            const fichier = event.target.files?.[0];
            if (fichier) void deposer(fichier);
          }}
        />
        <Button variant="subtle" className="w-full" disabled={envoi} data-donnees-choisir onClick={() => champ.current?.click()}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {envoi ? t('Lecture de l’archive…') : t('Choisir une archive')}
        </Button>

        {refus ? (
          <p className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-[12.5px] text-danger" data-donnees-refus>
            {refus}
          </p>
        ) : null}

        {apercu ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[12px] text-faint">
              {t('Archive de « {v0} », écrite le {v1} par la version {v2}.', {
                v0: apercu.manifeste.origine,
                v1: new Date(apercu.manifeste.creeLe).toLocaleString(),
                v2: apercu.manifeste.versionOutil,
              })}</p>

            <div className="flex flex-col gap-1.5">
              {apercu.contenu.map((bloc) => (
                <CaseCategorie
                  key={bloc.cle}
                  cle={bloc.cle}
                  libelle={bloc.libelle}
                  description={definitionCategorie(bloc.cle)?.description ?? ''}
                  detail={t('{n} ligne(s)', { n: bloc.lignes })}
                  coche={cochees.includes(bloc.cle)}
                  onBasculer={() =>
                    setCochees((avant) =>
                      avant.includes(bloc.cle) ? avant.filter((c) => c !== bloc.cle) : [...avant, bloc.cle],
                    )
                  }
                />
              ))}
            </div>

            {dependancesManquantes(cochees).length ? <Avertissement manquantes={dependancesManquantes(cochees)} /> : null}

            <p className="pt-1 text-[12px] uppercase tracking-wide text-faint">{t('Fiches déjà présentes ici')}</p>
            <div className="flex flex-col gap-1.5">
              {POLITIQUES.map((choix) => (
                <label
                  key={choix}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors',
                    politique === choix ? 'border-accent bg-raised' : 'border-border bg-surface hover:bg-raised',
                  )}
                >
                  <input
                    type="radio"
                    name="politique-import"
                    checked={politique === choix}
                    onChange={() => setPolitique(choix)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    data-donnees-politique={choix}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-text">{t(LIBELLE_POLITIQUE[choix])}</span>
                    <span className="block text-[12px] leading-relaxed text-faint">{t(EXPLICATION_POLITIQUE[choix])}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {bilan ? <Bilan bilan={bilan} /> : null}
      </ZoneDefilement>

      {apercu ? (
        <div className="shrink-0 border-t border-faint/40 px-3 pt-2">
          <Button
            className="w-full"
            disabled={!cochees.length || enCours}
            data-donnees-importer
            onClick={() => void importer()}
          >
            {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {enCours ? t('Remontée en cours…') : t('Importer maintenant')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Les morceaux communs                                                */
/* ------------------------------------------------------------------ */

function CaseCategorie({
  cle,
  libelle,
  description,
  detail,
  coche,
  onBasculer,
}: {
  cle: string;
  libelle: string;
  description: string;
  detail: string;
  coche: boolean;
  onBasculer: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-bloc px-2.5 py-2 transition-colors hover:bg-raised">
      <input
        type="checkbox"
        checked={coche}
        onChange={onBasculer}
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        data-donnees-categorie={cle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{t(libelle)}</span>
          <span className="shrink-0 text-[12px] text-faint">{detail}</span>
        </span>
        {description ? <span className="block text-[12px] leading-relaxed text-faint">{t(description)}</span> : null}
      </span>
    </label>
  );
}

/** Ce qui arriverait orphelin : on le DIT, on ne coche rien de force. */
function Avertissement({ manquantes }: { manquantes: CategorieExport[] }) {
  return (
    <p
      className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[12.5px] leading-relaxed text-warning"
      data-donnees-orphelins
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {t('Sans « {v0} », ce qui s’y accroche arrivera sans son rattachement.', {
          v0: manquantes.map((cle) => t(definitionCategorie(cle)?.libelle ?? cle)).join(', '),
        })}</span>
    </p>
  );
}

function Bilan({ bilan }: { bilan: BilanImport }) {
  const total = (champ: 'ajoutees' | 'remplacees' | 'ignorees' | 'refusees') =>
    bilan.tables.reduce((somme, table) => somme + table[champ], 0);
  return (
    <div className="mt-3 rounded-md border border-border bg-raised px-2.5 py-2" data-donnees-bilan>
      <p className="text-[13px] text-text">
        {t('{v0} ajoutée(s), {v1} remplacée(s), {v2} laissée(s), {v3} refusée(s).', {
          v0: total('ajoutees'),
          v1: total('remplacees'),
          v2: total('ignorees'),
          v3: total('refusees'),
        })}</p>
      {bilan.git.length ? (
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          {t('Les dépôts git ne sont pas reclonés tout seuls : leur état et un script de reprise sont déposés dans les données du serveur.')}</p>
      ) : null}
      <div className="mt-2 flex flex-col gap-0.5">
        {bilan.tables.map((table) => (
          <p key={table.table} className="flex items-baseline gap-2 text-[12px] text-faint">
            <span className="min-w-0 flex-1 truncate">{table.table}</span>
            <span className="shrink-0">
              {t('{v0} / {v1}', { v0: table.ajoutees + table.remplacees, v1: table.lues })}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function poids(octets: number): string {
  if (octets < 1024) return t('{n} o', { n: octets });
  if (octets < 1024 * 1024) return t('{n} ko', { n: Math.round(octets / 1024) });
  return t('{n} Mo', { n: Math.round(octets / 1024 / 1024) });
}

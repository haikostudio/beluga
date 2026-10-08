import * as React from 'react';
import { BadgeCheck, Clapperboard, Copy, Download, FileAudio, Film, Image as IconeImage, KeyRound, Loader2, Pause, PenTool, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  type ExportStudio,
  type FormatStudio,
  type MediaStudio,
  type OperationStudio,
  type AvancementVoix,
  type DepenseStudio,
  type SegmentVoix,
  type ReglagesExport,
  CLES_FORMATS_STUDIO,
  REGLAGES_EXPORT_PAR_DEFAUT,
  fichierAvecQualite,
  fichierAvecSon,
  resumeReglagesExport,
  lireReglagesExport,
  montantLisible,
  avancementDesVoix,
  phraseDansUneAutreVoix,
  quatreKPossible,
  tousLesSegments,
  phrasesDeLaPrise,
  priseARefaire,
  voixFinaleDuProjet,
} from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { BulleInfo, Button, ListeDeroulante, Switch } from '@/components/ui';
import { formatRegional } from '@/lib/langue';
import { LecteurVideo } from '@/components/lecteur-video';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { usePref } from '@/lib/prefs';
import { ouvrirLeCoffre } from '@/lib/ouvrir-coffre';
import { ChampChoix, ChampCouleur, ChampPolice, ChampTexte, Ligne, Section } from './champs';
import { descriptionDeVoix, libelleDepense, libelleEtatVoix, libelleFormat } from './libelles';
import type { DevisDeVoix, DonneesCreation } from './types';

/* ------------------------------------------------------------------ */
/* Les dépenses en attente : le seul endroit où l'argent se décide     */
/* ------------------------------------------------------------------ */

/**
 * L'ENCADRÉ DE DÉPENSE. Un devis (de l'agent ou de l'écran) attend ici le clic
 * de l'utilisateur : prix, raison, modèle, et deux boutons. Rien de payant ne
 * part sans « Valider » — la garde est tenue côté serveur.
 */
export function DepensesEnAttente({ donnees }: { donnees: DonneesCreation }) {
  const enAttente = donnees.depenses.filter((d) => d.etat === 'en-attente');
  if (!enAttente.length) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2" data-studio-depenses-attente>
      {enAttente.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md bg-warning/15 px-3 py-2 text-[13px]" data-studio-depense={d.id}>
          <span className="min-w-0 flex-1">
            <strong>{libelleDepense(d.genre)}</strong> — {d.plafond === null ? t('prix non publié par le fournisseur') : d.plafond === 0 ? t('sans frais (abonnement)') : montantLisible(d.plafond)}
            <span className="block text-[12px] text-muted">{d.raison}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => client.call({ type: 'studio.depense.refuser', id: d.id })} data-studio-depense-refuser>
            {t('Refuser')}
          </Button>
          <Button size="sm" variant="default" onClick={() => client.call({ type: 'studio.depense.valider', id: d.id })} data-studio-depense-valider>
            {t('Valider')}
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les voix                                                             */
/* ------------------------------------------------------------------ */

/**
 * LA PRÉ-ÉCOUTE D'UNE VOIX, depuis l'endroit où on la choisit : la même phrase
 * fixe pour toutes, fabriquée une fois sur le serveur puis resservie. Un seul
 * extrait joue à la fois ; un second clic sur la même voix l'arrête. La raison
 * d'un extrait indisponible est DITE (quota, clé absente), jamais avalée.
 */
export function useEcouteDesVoix(): { ecoute: string | null; chargement: string | null; basculer: (voix: string) => void } {
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [ecoute, setEcoute] = React.useState<string | null>(null);
  const [chargement, setChargement] = React.useState<string | null>(null);
  const ecouteRef = React.useRef(ecoute);
  ecouteRef.current = ecoute;
  React.useEffect(() => () => audio.current?.pause(), []);
  const basculer = React.useCallback((voix: string) => {
    audio.current?.pause();
    audio.current = null;
    if (ecouteRef.current === voix) {
      setEcoute(null);
      return;
    }
    const adresse = `/api/studio/extrait?voix=${encodeURIComponent(voix)}`;
    setChargement(voix);
    setEcoute(voix);
    // La raison d'un refus se lit d'abord (le lecteur ne la donnerait pas), puis le son se joue.
    void fetch(adresse, { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? t('Extrait indisponible pour le moment.'));
        const url = URL.createObjectURL(await r.blob());
        const lecteur = new Audio(url);
        audio.current = lecteur;
        lecteur.onended = () => {
          URL.revokeObjectURL(url);
          setEcoute((x) => (x === voix ? null : x));
        };
        setChargement((x) => (x === voix ? null : x));
        if (ecouteRef.current !== voix) return;
        await lecteur.play();
      })
      .catch((err: any) => {
        client.pushToast('warning', t('Extrait de « {voix} » indisponible : {raison}', { voix, raison: String(err?.message ?? err) }));
        setChargement((x) => (x === voix ? null : x));
        setEcoute((x) => (x === voix ? null : x));
      });
  }, []);
  return { ecoute, chargement, basculer };
}

/** Le geste ▶ d'une ligne de voix, dans une liste déroulante. */
export function actionDEcoute(voix: string, e: ReturnType<typeof useEcouteDesVoix>) {
  return {
    libelle: e.ecoute === voix ? t('Arrêter l’écoute') : t('Écouter « {voix} »', { voix }),
    icone: e.chargement === voix ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : e.ecoute === voix ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />,
    onClick: () => e.basculer(voix),
    active: e.ecoute === voix,
  };
}

/**
 * L'AVANCEMENT DE LA VOIX FINALE en cours de fabrication, lu dans la dépense
 * « validée » que le serveur tient à jour phrase par phrase. Le fournisseur
 * rend chaque son d'un bloc : la phrase en cours s'ESTIME au temps écoulé
 * (plafonnée à 95 % tant que son son n'est pas rendu). Le tic (une demi-seconde)
 * ne vit QUE dans le composant qui appelle ce crochet, et seulement pendant la
 * fabrication : rien ne tourne au repos.
 */
export function useAvancementDesVoix(depenses: DepenseStudio[]): {
  depense: DepenseStudio;
  phrases: ReturnType<typeof avancementDesVoix>['phrases'];
  global: number;
} | null {
  const depense = depenses.find((d) => d.genre === 'voix' && d.etat === 'validee') ?? null;
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!depense) return;
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), 500);
    return () => window.clearInterval(minuterie);
  }, [depense?.id]);
  /* L'HORLOGE DU SERVEUR PEUT DIFFÉRER DE CELLE DE L'APPAREIL : une phrase vue
     DÉMARRER ici se compte depuis l'instant où on l'a vue ; seule celle déjà en
     cours à l'ouverture reprend l'heure du serveur. */
  const vue = React.useRef<{ depense: string; id: string; depuis: number } | null>(null);
  if (!depense) {
    vue.current = null;
    return null;
  }
  const av = (depense.details.avancement ?? {}) as Partial<AvancementVoix>;
  if (av.enCours && (vue.current?.depense !== depense.id || vue.current.id !== av.enCours.id)) {
    const dejaSuivie = vue.current?.depense === depense.id;
    vue.current = { depense: depense.id, id: av.enCours.id, depuis: dejaSuivie ? Date.now() : Math.min(av.enCours.depuis, Date.now()) };
  }
  const ids = ((depense.details.segments ?? []) as { id: string }[]).map((s) => s.id);
  const r = avancementDesVoix(ids, av.enCours && vue.current ? { ...av, enCours: { id: av.enCours.id, depuis: vue.current.depuis } } : av, Math.max(maintenant, Date.now()));
  return { depense, ...r };
}

/**
 * LES VOIX, dans la fenêtre « Mettre en production ». Chaque segment de voix
 * dit où il en est (essai, finale, à revalider, faite dans une autre voix). La
 * voix d'essai est gratuite ; la voix finale est UNE SEULE pour toute la
 * création — celle du projet, choisie ici à l'oreille — et ne part qu'au clic
 * sur « Valider la voix », qui affiche son COÛT MAXIMUM avant, et le montant
 * réellement débité après. Elle est dite en UNE SEULE PRISE pour toute la
 * vidéo : dès qu'une phrase est à refaire, toutes sont redites ensemble (une
 * phrase refaite seule changerait de timbre ou d'accent). Pendant la
 * fabrication, toutes les phrases avancent ensemble. Quand tout est déjà en
 * voix finale, le même bouton devient « Refaire la voix » : toujours actif, il
 * chiffre puis redit la prise ENTIÈRE (devis et validation avec `refaire`).
 * Elle passe toute par l'espace OpenRouter de Beluga
 * Build : sans sa clé au coffre-fort, l'écran le dit et y mène, rien ne part.
 */
export function PanneauVoix({ donnees, onVoixEssai }: { donnees: DonneesCreation; onVoixEssai: (segmentId?: string) => Promise<unknown> }) {
  const voix = tousLesSegments(donnees.composition).filter((s): s is SegmentVoix => s.genre === 'voix');
  const voixDuProjet = voixFinaleDuProjet(donnees.espace.voixFinale);
  // LA PRISE UNIQUE : une seule phrase à refaire, et c'est toute la voix qui repart.
  const aRefaire = priseARefaire(donnees.composition, voixDuProjet);
  // Tout est déjà final : la prise entière peut quand même être redite, sur un clic (« Refaire la voix »).
  const refaire = !aRefaire && voix.length > 0;
  const aValider = aRefaire || refaire ? phrasesDeLaPrise(donnees.composition) : [];
  const [devis, setDevis] = React.useState<DevisDeVoix | null>(null);
  const [raisonDevis, setRaisonDevis] = React.useState<string | null>(null);
  const ecoute = useEcouteDesVoix();
  const avancement = useAvancementDesVoix(donnees.depenses);
  const enCours = !!avancement;
  // Changer la voix du projet change le lot (phrases à refaire) : le devis se refait.
  const cle = `${voixDuProjet}#${refaire ? 'refaire' : 'valider'}#${aValider.map((v) => `${v.id}:${v.texte.length}:${v.dureeAudio ?? 0}`).join('|')}`;

  React.useEffect(() => {
    if (!aValider.length) {
      setDevis(null);
      return;
    }
    let vivant = true;
    setRaisonDevis(null);
    client
      .call<{ devis: DevisDeVoix }>({ type: 'studio.voix.devis', creationId: donnees.creation.id, ...(refaire ? { refaire: true } : {}) })
      .then((r) => vivant && setDevis(r.devis))
      .catch((err: any) => vivant && (setDevis(null), setRaisonDevis(String(err?.message ?? err))));
    return () => {
      vivant = false;
    };
  }, [cle, donnees.creation.id]);

  const depensesVoix = donnees.depenses.filter((d) => d.genre === 'voix' && d.etat !== 'en-attente').slice(0, 5);

  return (
    <div className="flex flex-col gap-2" data-studio-panneau="voix">
      <Section liste titre={t('Les voix de la création')}>
        {!voix.length ? <p className="text-[12.5px] text-faint">{t('Aucune voix : ajoutez un segment « Voix » ou demandez-le à l’agent.')}</p> : null}
        {voix.map((v) => {
          const autreVoix = phraseDansUneAutreVoix(v, voixDuProjet);
          const suivi = avancement?.phrases[v.id];
          return (
            <div key={v.id} className="flex flex-col gap-1 py-0.5 text-[12.5px]" data-studio-ligne-voix={v.id} data-etat={autreVoix ? 'autre-voix' : v.etat}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    autreVoix || v.etat === 'a-revalider' ? 'bg-warning' : v.etat === 'finale' ? 'bg-termine' : v.etat === 'essai' ? 'bg-en-cours' : 'bg-faint',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{v.texte || t('(texte vide)')}</span>
                {suivi ? (
                  <span className={cn('shrink-0 tabular-nums', suivi.etat === 'echec' ? 'text-danger' : 'text-muted')} data-studio-voix-pourcent={Math.round(suivi.pourcent)}>
                    {suivi.etat === 'echec' ? t('Échec') : suivi.etat === 'attente' ? t('En attente') : `${Math.round(suivi.pourcent)} %`}
                  </span>
                ) : (
                  <span className={cn('shrink-0', autreVoix ? 'text-warning' : 'text-faint')}>
                    {autreVoix ? t('Autre voix ({voix})', { voix: v.voixFinale ?? '?' }) : libelleEtatVoix(v.etat)}
                  </span>
                )}
              </div>
              {suivi ? (
                <BarreProgression
                  pourcent={suivi.pourcent}
                  erreur={suivi.etat === 'echec'}
                  teinte={suivi.etat === 'faite' ? 'success' : 'en-cours'}
                  className="ml-4 w-auto rounded-full"
                  data-studio-voix-barre={suivi.etat}
                />
              ) : null}
              {suivi?.raison ? <span className="ml-4 text-[12px] text-danger">{suivi.raison}</span> : null}
            </div>
          );
        })}
        {voix.some((v) => v.etat === 'aucune' || !v.mediaId) ? (
          <Button size="sm" variant="outline" onClick={() => onVoixEssai()} data-studio-voix-essai-toutes>
            {t('Fabriquer les voix d’essai (gratuit)')}
          </Button>
        ) : null}
      </Section>

      <Section
        titre={t('Voix finale')}
        action={<BulleInfo cote="end">{t('Écoutez les voix et choisissez celle du projet : toutes les phrases seront dites par elle. Elle remplace la voix d’essai au moment où vous la validez. Elle est payée par le crédit OpenRouter de Beluga Build, quel que soit le projet.')}</BulleInfo>}
      >
        <Ligne libelle={t('Voix du projet')}>
          <ChampChoix
            titre={t('Voix finale du projet')}
            valeur={voixDuProjet}
            data-studio-voix-projet
            options={donnees.voixFinales.map((v) => ({
              valeur: v.id,
              libelle: v.label,
              detail: descriptionDeVoix(v),
              groupe: v.genre === 'femme' ? t('Voix de femme') : t('Voix d’homme'),
              action: actionDEcoute(v.id, ecoute),
            }))}
            onValider={(v) => client.call({ type: 'studio.espace.ecrire', projectId: donnees.creation.projectId, voixFinale: v })}
          />
        </Ligne>
        <div className="mt-1 flex flex-col gap-1.5">
          {raisonDevis ? <p className="text-[12px] text-danger">{raisonDevis}</p> : null}
          {refaire && !enCours ? <p className="text-[12px] text-termine">{t('Toutes les voix sont en voix finale.')}</p> : null}
          {devis && !enCours ? (
            /* LE DEVIS EN PHRASES : ce qui sera dit, ce que ça coûtera au plus, ce qui reste. */
            <div className="flex flex-col gap-0.5 text-[12.5px] text-muted" data-studio-devis-voix={devis.plafond}>
              <span data-studio-prise-unique>{t('Toute la voix en une seule prise : {n} phrase(s), environ {s} s, dites ensemble par {voix}.', { n: devis.segments.length, s: Math.max(1, Math.round(devis.secondes)), voix: voixDuProjet })}</span>
              <span>{t('Coût maximum : {prix}, payé par le crédit OpenRouter de Beluga Build.', { prix: montantLisible(devis.plafond) })}</span>
              {devis.solde !== null ? <span>{t('Crédit restant : {solde}.', { solde: montantLisible(devis.solde) })}</span> : null}
            </div>
          ) : null}
          {devis && !devis.cle ? (
            <div className="flex flex-col items-start gap-1.5 rounded-md bg-warning/15 px-3 py-2 text-[12.5px]" data-studio-voix-sans-cle>
              <span>{t('OpenRouter n’est pas configuré : sa clé manque au coffre-fort. Ajoutez-la, puis revenez valider la voix.')}</span>
              <Button size="sm" variant="outline" onClick={ouvrirLeCoffre} data-studio-ouvrir-coffre>
                <KeyRound className="h-3.5 w-3.5" />
                {t('Ouvrir le coffre-fort')}
              </Button>
            </div>
          ) : null}
          <Button
            size="sm"
            variant="default"
            className="relative h-auto min-h-8 overflow-hidden whitespace-normal py-1.5"
            disabled={!devis || !devis.cle || enCours}
            onClick={() => client.call({ type: 'studio.voix.valider', creationId: donnees.creation.id, plafond: devis?.plafond ?? 0, ...(refaire ? { refaire: true } : {}) })}
            data-studio-valider-voix
            data-studio-refaire-voix={refaire ? '' : undefined}
          >
            {avancement
              ? t('Voix finale en cours… {p} %', { p: Math.round(avancement.global) })
              : refaire
                ? devis
                  ? t('Refaire la voix — jusqu’à {prix}', { prix: montantLisible(devis.plafond) })
                  : t('Refaire la voix')
                : devis
                  ? t('Valider la voix — jusqu’à {prix}', { prix: montantLisible(devis.plafond) })
                  : t('Valider la voix')}
            {avancement ? <BarreProgression pourcent={avancement.global} teinte="en-cours" className="absolute inset-x-0 bottom-0" data-studio-voix-avancement-global={String(Math.round(avancement.global))} /> : null}
          </Button>
        </div>
      </Section>

      {depensesVoix.length ? (
        <Section liste titre={t('Ce que les voix ont coûté')}>
          {depensesVoix.map((d) => (
            <p key={d.id} className="text-[12px] text-muted" data-studio-depense-voix={d.etat}>
              {d.etat === 'faite' || d.etat === 'echouee'
                ? t('{raison} — débité : {montant} (plafond {plafond})', { raison: d.raison, montant: montantLisible(d.montantReel ?? 0), plafond: montantLisible(d.plafond) })
                : t('{raison} — en cours', { raison: d.raison })}
              {d.erreur ? <span className="block text-danger">{d.erreur}</span> : null}
            </p>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les exports                                                          */
/* ------------------------------------------------------------------ */

function etatDeLExport(e: ExportStudio): string {
  switch (e.etat) {
    case 'en-file':
      return t('En attente de la machine');
    case 'en-cours':
      return t('Fabrication en cours');
    case 'pret':
      return t('Prêt');
    case 'annule':
      return t('Annulé');
    default:
      return t('Échoué');
  }
}

export function PanneauExports({ donnees, format, onFormat, temps }: { donnees: DonneesCreation; format: FormatStudio; onFormat: (f: FormatStudio) => void; temps: number }) {
  const state = useApp();
  const formats = donnees.creation.formats;
  /* LES DERNIERS RÉGLAGES SONT RETENUS (préférence en base, suivie d'un appareil à l'autre) ; lus avec tolérance pour ce format. */
  const [retenus, retenir] = usePref<Partial<ReglagesExport>>('studio.export.reglages', REGLAGES_EXPORT_PAR_DEFAUT);
  const reglages = lireReglagesExport(retenus, format);
  const regler = (champ: Partial<ReglagesExport>) => retenir({ ...reglages, ...champ });
  const exporter = (genre: 'video' | 'image') =>
    client.call({ type: 'studio.exporter', creationId: donnees.creation.id, format, genre, reglages: { ...reglages }, ...(genre === 'image' ? { instant: temps } : {}) });
  const ajouterFormat = (f: FormatStudio) => client.call({ type: 'studio.creation.modifier', id: donnees.creation.id, formats: [...formats, f] });
  const sans4K = !quatreKPossible(format);
  return (
    <div className="flex flex-col gap-2" data-studio-panneau="exports">
      <Section titre={t('Exporter')}>
        <Ligne libelle={t('Format')}>
          <ChampChoix titre={t('Format')} valeur={format} options={formats.map((f) => ({ valeur: f, libelle: `${libelleFormat(f)} (${f})` }))} onValider={(v) => onFormat(v as FormatStudio)} />
        </Ligne>
        {CLES_FORMATS_STUDIO.some((f) => !formats.includes(f)) ? (
          <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
            {t('Décliner aussi en :')}
            {CLES_FORMATS_STUDIO.filter((f) => !formats.includes(f)).map((f) => (
              <Button key={f} size="sm" variant="ghost" onClick={() => ajouterFormat(f)}>
                <Plus className="h-3 w-3" />
                {libelleFormat(f)}
              </Button>
            ))}
          </div>
        ) : null}
        {donnees.voixEnEssai ? (
          <p className="text-[12px] text-warning" data-studio-avertissement-voix>
            {t('{n} voix sont encore en voix d’essai : l’export les gardera telles quelles.', { n: donnees.voixEnEssai })}
          </p>
        ) : null}
        {!donnees.rendu.pret ? <p className="text-[12px] text-danger">{t('Le moteur de rendu n’est pas installé sur ce serveur.')}</p> : null}
      </Section>

      <Section titre={t('Vidéo')} data-studio-reglages-video="">
        <Ligne libelle={t('Type de fichier')}>
          <ChampChoix
            titre={t('Type de fichier')}
            valeur={reglages.fichier}
            options={[
              { valeur: 'mp4', libelle: 'MP4', detail: t('Lu partout : réseaux sociaux, téléphones, sites') },
              { valeur: 'webm', libelle: 'WebM', detail: t('Pour le web, souvent plus léger') },
              { valeur: 'mov', libelle: 'MOV', detail: t('Fond transparent, pour un logiciel de montage') },
              { valeur: 'gif', libelle: 'GIF', detail: t('Image animée sans son, légère') },
            ]}
            onValider={(v) => regler({ fichier: v as ReglagesExport['fichier'] })}
            data-studio-export-fichier={reglages.fichier}
          />
        </Ligne>
        <Ligne libelle={t('Qualité')}>
          <ListeDeroulante
            titre={t('Qualité')}
            valeur={reglages.qualite}
            desactivee={!fichierAvecQualite(reglages.fichier)}
            options={[
              { valeur: 'brouillon', libelle: t('Brouillon'), detail: t('Rapide à fabriquer, fichier léger') },
              { valeur: 'standard', libelle: t('Standard'), detail: t('Le bon équilibre') },
              { valeur: 'haute', libelle: t('Haute'), detail: t('Plus nette, fichier plus lourd') },
              { valeur: 'maximale', libelle: t('Maximale'), detail: t('La plus nette, la plus longue à fabriquer') },
            ]}
            onChoisir={(v) => regler({ qualite: v as ReglagesExport['qualite'] })}
            repere="studio-export-qualite"
          />
        </Ligne>
        <Ligne libelle={t('Définition')}>
          <ChampChoix
            titre={t('Définition')}
            valeur={reglages.definition}
            options={[
              { valeur: '1080p', libelle: 'Full HD (1080p)' },
              { valeur: '4k', libelle: '4K', detail: sans4K ? t('Pas de 4K pour le format Portrait : le moteur de rendu ne la propose pas') : t('Quatre fois plus de pixels, rendu bien plus long'), desactivee: sans4K },
            ]}
            onValider={(v) => regler({ definition: v as ReglagesExport['definition'] })}
            data-studio-export-definition={reglages.definition}
          />
        </Ligne>
        <Ligne libelle={t('Images par seconde')}>
          <ChampChoix
            titre={t('Images par seconde')}
            valeur={String(reglages.ips)}
            options={[
              { valeur: '24', libelle: '24', detail: t('Rendu cinéma') },
              { valeur: '30', libelle: '30', detail: t('Le standard des réseaux sociaux') },
              { valeur: '60', libelle: '60', detail: t('Très fluide, rendu deux fois plus long') },
            ]}
            onValider={(v) => regler({ ips: Number(v) as ReglagesExport['ips'] })}
            data-studio-export-ips={reglages.ips}
          />
        </Ligne>
        <Ligne libelle={t('Sans le son')}>
          <Switch
            checked={reglages.sansSon}
            disabled={!fichierAvecSon(reglages.fichier)}
            onCheckedChange={(v: boolean) => regler({ sansSon: v })}
            data-studio-export-sans-son={reglages.sansSon ? 'oui' : 'non'}
          />
        </Ligne>
        {!fichierAvecQualite(reglages.fichier) || !fichierAvecSon(reglages.fichier) ? (
          <p className="text-[12px] text-faint" data-studio-export-note>
            {reglages.fichier === 'gif'
              ? t('Un GIF n’a jamais de son, et sa qualité ne se règle pas.')
              : t('Un MOV garde sa qualité maximale fixe, qui préserve la transparence.')}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="default" disabled={!donnees.rendu.pret} onClick={() => exporter('video')} data-studio-exporter="video">
            <Film className="h-3.5 w-3.5" />
            {t('Exporter la vidéo')}
          </Button>
        </div>
        <p className="text-[11.5px] text-faint">
          {reglages.definition === '4k' || reglages.ips === 60
            ? t('En 4K ou à 60 images par seconde, la fabrication prend nettement plus de temps, une à la fois sur le serveur.')
            : t('Une vidéo prend environ trois fois et demie sa durée à fabriquer, une à la fois sur le serveur.')}
        </p>
      </Section>

      <Section titre={t('Image')} data-studio-reglages-image="">
        <Ligne libelle={t('Format de l’image')}>
          <ChampChoix
            titre={t('Format de l’image')}
            valeur={reglages.image}
            options={[
              { valeur: 'png', libelle: 'PNG', detail: t('Net, sans perte') },
              { valeur: 'jpg', libelle: 'JPG', detail: t('Plus léger') },
            ]}
            onValider={(v) => regler({ image: v as ReglagesExport['image'] })}
            data-studio-export-image={reglages.image}
          />
        </Ligne>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="outline" disabled={!donnees.rendu.pret} onClick={() => exporter('image')} data-studio-exporter="image">
            <IconeImage className="h-3.5 w-3.5" />
            {t('Exporter une image')}
          </Button>
        </div>
        <p className="text-[11.5px] text-faint">{t('L’image est prise à l’endroit de la tête de lecture ({t} s).', { t: (Math.round(temps * 10) / 10).toLocaleString(formatRegional()) })}</p>
      </Section>
      {donnees.exports.map((e) => {
        const p = state.studioProgression[e.id];
        return (
          <Section
            liste
            key={e.id}
            titre={`${libelleFormat(e.format)} · ${e.genre === 'video' ? t('Vidéo') : t('Image')} · v${e.version}${e.reglages ? ` · ${resumeReglagesExport(e.genre, e.reglages, t)}` : ''}`}
            action={
              e.etat === 'en-file' || e.etat === 'en-cours' ? (
                <Button size="icon" variant="ghost" aria-label="Annuler l’export" title={t('Annuler l’export')} onClick={() => client.call({ type: 'studio.export.annuler', id: e.id })}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : e.attachmentId ? (
                <a
                  href={`/api/attachment?id=${encodeURIComponent(e.attachmentId)}&download=1`}
                  aria-label="Télécharger"
                  title={t('Télécharger')}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-text"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              ) : null
            }
          >
            <div data-studio-export={e.id} data-etat={e.etat} className="flex flex-col gap-1.5">
              <p className={cn('text-[12px]', e.etat === 'echoue' ? 'text-danger' : e.etat === 'pret' ? 'text-termine' : 'text-en-cours')}>
                {etatDeLExport(e)}
                {e.etat === 'en-cours' && p ? ` — ${Math.round(p.valeur * 100)} % · ${p.etape}` : ''}
                {e.erreur ? ` — ${e.erreur}` : ''}
                {e.voixEnEssai && e.etat === 'pret' ? ` · ${t('{n} voix d’essai', { n: e.voixEnEssai })}` : ''}
              </p>
              {e.etat === 'en-cours' ? (
                <div className="h-1 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-en-cours transition-all" style={{ width: `${Math.round((p?.valeur ?? 0.03) * 100)}%` }} />
                </div>
              ) : null}
              {e.etat === 'pret' && e.attachmentId && e.genre === 'video' && e.reglages?.fichier !== 'gif' ? <LecteurVideo id={e.attachmentId} nom={`${donnees.creation.titre} ${e.format}`} /> : null}
              {e.etat === 'pret' && e.attachmentId && (e.genre === 'image' || e.reglages?.fichier === 'gif') ? (
                <img src={`/api/attachment?id=${encodeURIComponent(e.attachmentId)}`} alt="" className="max-h-64 self-start rounded-md" />
              ) : null}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bibliothèque et kit de marque                                        */
/* ------------------------------------------------------------------ */

async function envoyerFichier(projectId: string, fichier: File): Promise<string | null> {
  const reponse = await fetch(`/api/upload?project=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'content-type': fichier.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(fichier.name) },
    body: fichier,
  });
  if (!reponse.ok) return null;
  const data = (await reponse.json()) as { attachment?: { id: string } };
  return data.attachment?.id ?? null;
}

/**
 * CHOISIR UN FICHIER, L'ENVOYER, LE RANGER dans la bibliothèque du projet —
 * puis rendre le média (le « + » d'une piste le pose aussitôt à l'instant visé).
 */
export function choisirEtImporter(
  donnees: DonneesCreation,
  accept: string,
  surChaque?: (m: MediaStudio) => void,
  options: { multiple?: boolean; surEnvoi?: () => void } = {},
): Promise<void> {
  return new Promise((fini) => {
    const champ = document.createElement('input');
    champ.type = 'file';
    champ.multiple = !!options.multiple;
    champ.accept = accept;
    // Fenêtre de choix refermée sans fichier : rien n'est en cours.
    champ.addEventListener('cancel', () => fini());
    champ.onchange = async () => {
      const fichiers = Array.from(champ.files ?? []);
      if (!fichiers.length) return fini();
      options.surEnvoi?.();
      try {
        for (const f of fichiers) {
          const id = await envoyerFichier(donnees.creation.projectId, f);
          if (!id) {
            client.pushToast('error', t('Envoi du fichier impossible'));
            continue;
          }
          const r = await client.call<{ media: MediaStudio }>({ type: 'studio.media.importer', projectId: donnees.creation.projectId, attachmentId: id, creationId: donnees.creation.id });
          surChaque?.(r.media);
        }
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Import impossible'));
      } finally {
        fini();
      }
    };
    champ.click();
  });
}

/** La VIGNETTE d'un média : l'image elle-même, sinon l'icône de son genre, dans une case de même taille. */
function VignetteDuMedia({ m }: { m: MediaStudio }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-raised">
      {m.genre === 'image' && m.attachmentId ? (
        <img src={`/api/attachment?id=${encodeURIComponent(m.attachmentId)}`} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : m.genre === 'video' ? (
        <Film className="h-3.5 w-3.5 text-muted" />
      ) : m.genre === 'dessin' ? (
        <PenTool className="h-3.5 w-3.5 text-muted" />
      ) : m.genre === 'image' ? (
        <IconeImage className="h-3.5 w-3.5 text-muted" />
      ) : (
        <FileAudio className="h-3.5 w-3.5 text-muted" />
      )}
    </span>
  );
}

/**
 * LES MODÈLES DU PROJET : les vidéos VALIDÉES, d'où l'on repart. Chacun ouvre
 * une nouvelle création qui reprend sa composition entière, se copie vers un
 * autre projet (médias compris), ou se retire.
 */
function ModelesDuProjet({ donnees, onOuvrir }: { donnees: DonneesCreation; onOuvrir: (creationId: string) => void }) {
  const autresProjets = donnees.projets.filter((p) => p.id !== donnees.creation.projectId);
  return (
    <Section
      liste
      titre={t('Modèles du projet')}
      data-studio-modeles={String(donnees.modeles.length)}
      action={<BulleInfo cote="end">{t('Les vidéos gardées comme modèle, depuis « Mettre en production ». « Créer » repart de l’une d’elles ; la copie l’envoie vers un autre projet, fichiers compris.')}</BulleInfo>}
    >
      {!donnees.modeles.length ? <p className="text-[12.5px] text-faint">{t('Aucun modèle pour l’instant.')}</p> : null}
      {donnees.modeles.map((m) => (
        <div key={m.id} className="flex items-center gap-2 py-0.5 text-[12.5px]" data-studio-modele={m.id}>
          <span className="flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-raised">
            {m.afficheId ? <img src={`/api/attachment?id=${encodeURIComponent(m.afficheId)}`} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Clapperboard className="h-3.5 w-3.5 text-faint" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 truncate text-text">
              {m.creationId === donnees.creation.id ? <BadgeCheck className="h-3 w-3 shrink-0 text-termine" /> : null}
              <span className="truncate">{m.titre}</span>
            </span>
            <span className="block truncate text-faint">
              {t('{d} s · {n} scène(s)', { d: (Math.round(m.duree * 10) / 10).toLocaleString(formatRegional()), n: m.scenes })}
            </span>
          </span>
          <span className="flex shrink-0 items-center">
          <Button
            size="sm"
            variant="ghost"
            data-studio-modele-creer={m.id}
            onClick={() =>
              client
                .call<{ creation: { id: string } }>({ type: 'studio.creation.creer', projectId: m.projectId, depuisModele: m.id })
                .then((r) => onOuvrir(r.creation.id))
                .catch((err: any) => client.pushToast('error', err?.message ?? t('Création impossible')))
            }
          >
            <Plus className="h-3 w-3" />
            {t('Créer')}
          </Button>
          {autresProjets.length ? (
            <ListeDeroulante
              valeur=""
              titre={t('Copier vers un autre projet')}
              repere="modele-copier"
              options={autresProjets.map((p) => ({ valeur: p.id, libelle: p.name }))}
              onChoisir={(projectId) =>
                client
                  .call<{ manquants: number }>({ type: 'studio.modele.copier', id: m.id, projectId })
                  .then((r) =>
                    client.pushToast(
                      r.manquants ? 'warning' : 'success',
                      r.manquants
                        ? t('Modèle copié, mais {n} fichier(s) introuvable(s) n’ont pas suivi.', { n: r.manquants })
                        : t('Modèle copié vers « {projet} ».', { projet: autresProjets.find((p) => p.id === projectId)?.name ?? '' }),
                    ),
                  )
                  .catch((err: any) => client.pushToast('error', err?.message ?? t('Copie impossible')))
              }
              declencheur={(ouvrir) => (
                <Button size="icon" variant="ghost" aria-label="Copier vers un autre projet" title={t('Copier vers un autre projet')} onClick={ouvrir} data-studio-modele-copier={m.id}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            />
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Retirer ce modèle"
            title={t('Retirer ce modèle')}
            onClick={() => client.call({ type: 'studio.modele.supprimer', id: m.id })}
            data-studio-modele-supprimer={m.id}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          </span>
        </div>
      ))}
    </Section>
  );
}

export function PanneauBibliotheque({
  donnees,
  temps,
  onOperation,
  onOuvrir,
}: {
  donnees: DonneesCreation;
  temps: number;
  onOperation: (op: OperationStudio) => Promise<unknown> | void;
  /** Ouvrir une création (née d'un modèle). */
  onOuvrir: (creationId: string) => void;
}) {
  const [envoi, setEnvoi] = React.useState(false);
  const kit = donnees.espace.kit;
  const projectId = donnees.creation.projectId;
  const ecrireKit = (champ: string, valeur: string) => client.call({ type: 'studio.espace.ecrire', projectId, kit: { [champ]: valeur } });
  const pisteDe = (genre: 'visuel' | 'son') => donnees.composition.pistes.find((p) => p.genre === genre && (genre === 'visuel' || p.id === 'musique')) ?? donnees.composition.pistes.find((p) => p.genre === genre);

  const ajouter = (m: MediaStudio) => {
    if (m.genre === 'dessin' && m.dessin) {
      const piste = pisteDe('visuel');
      if (!piste) return;
      return onOperation({
        op: 'inserer',
        pisteId: piste.id,
        segment: { genre: 'dessin', debut: temps, duree: 4, nom: m.nom, gabarit: m.dessin.gabarit, parametres: m.dessin.parametres, valeurs: m.dessin.valeurs },
      });
    }
    const piste = pisteDe(m.genre === 'audio' ? 'son' : 'visuel');
    if (!piste) return;
    const duree = m.duree && m.duree > 0 ? Math.min(m.duree, 60) : 4;
    return onOperation({
      op: 'inserer',
      pisteId: piste.id,
      segment:
        m.genre === 'audio'
          ? { genre: 'audio', debut: temps, duree, mediaId: m.id, debutMedia: 0, volume: 0.8 }
          : m.genre === 'video'
            ? { genre: 'video', debut: temps, duree, mediaId: m.id, debutMedia: 0, volume: 1, ajustement: 'couvrir' }
            : { genre: 'image', debut: temps, duree, mediaId: m.id, ajustement: 'couvrir' },
    });
  };

  const choisirFichiers = () =>
    void choisirEtImporter(donnees, 'image/*,video/*,audio/*', undefined, { multiple: true, surEnvoi: () => setEnvoi(true) }).finally(() => setEnvoi(false));

  const bibliotheque = donnees.medias.filter((m) => m.provenance === 'import' || m.provenance === 'dessin' || m.provenance === 'genere');
  const couleurs: [string, string][] = [
    // Des libellés courts : la colonne des libellés est étroite, rien n'y passe sur deux lignes.
    ['primaire', t('Principale')],
    ['secondaire', t('Secondaire')],
    ['accent', t('Accent')],
    ['fond', t('Fond')],
    ['texte', t('Texte')],
  ];

  /* L'ONGLET « STYLE » : ce qui donne son allure au projet, du plus général au plus précis —
     le kit de marque (couleurs, polices, logo, ton), puis les médias du projet, puis les modèles. */
  return (
    <div className="flex flex-col gap-2" data-studio-panneau="bibliotheque">
      <Section
        titre={t('Kit de marque')}
        data-studio-kit=""
        action={<BulleInfo cote="end">{t('Ces couleurs, polices et ce logo arrivent dans chaque dessin du projet : l’agent les utilise d’office.')}</BulleInfo>}
      >
        {couleurs.map(([champ, libelle]) => (
          <Ligne key={champ} libelle={libelle}>
            <ChampCouleur valeur={(kit as Record<string, string | undefined>)[champ] ?? '#ffffff'} onValider={(v) => ecrireKit(champ, v)} />
          </Ligne>
        ))}
        <Ligne libelle={t('Police des titres')}>
          <ChampPolice titre={t('Police des titres')} valeur={kit.policeTitre ?? 'Montserrat'} onValider={(v) => ecrireKit('policeTitre', v)} />
        </Ligne>
        <Ligne libelle={t('Police des textes')}>
          <ChampPolice titre={t('Police des textes')} valeur={kit.policeTexte ?? 'Inter'} onValider={(v) => ecrireKit('policeTexte', v)} />
        </Ligne>
        <Ligne libelle={t('Logo')}>
          <ChampChoix
            titre={t('Logo')}
            valeur={kit.logoMediaId ?? ''}
            options={[{ valeur: '', libelle: t('Aucun') }, ...donnees.medias.filter((m) => m.genre === 'image').map((m) => ({ valeur: m.id, libelle: m.nom }))]}
            onValider={(v) => ecrireKit('logoMediaId', v)}
          />
        </Ligne>
        <Ligne libelle={t('Ton')}>
          <ChampTexte valeur={kit.ton ?? ''} placeholder={t('Chaleureux, direct, expert…')} onValider={(v) => ecrireKit('ton', v)} />
        </Ligne>
      </Section>

      <Section
        liste
        titre={t('Médias du projet')}
        data-studio-medias={String(bibliotheque.length)}
        action={
          <span className="flex shrink-0 items-center gap-0.5">
            <BulleInfo cote="end">{t('Vos photos, vidéos et sons, et les dessins gardés par l’agent. « Ajouter » les pose à la tête de lecture.')}</BulleInfo>
            <Button size="sm" variant="outline" onClick={choisirFichiers} disabled={envoi} data-studio-importer>
              <Upload className="h-3.5 w-3.5" />
              {envoi ? t('Envoi…') : t('Importer')}
            </Button>
          </span>
        }
      >
        {!bibliotheque.length ? <p className="text-[12.5px] text-faint">{t('Aucun média pour l’instant : importez une photo, une vidéo ou un son.')}</p> : null}
        {bibliotheque.map((m) => (
          <div key={m.id} className="flex items-center gap-2 py-0.5 text-[12.5px]" data-studio-media={m.id}>
            <VignetteDuMedia m={m} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text" title={m.nom}>
                {m.nom}
              </span>
              {m.genre === 'audio' ? (
                <span className="block">
                  <ChampTexte valeur={m.licence ?? ''} placeholder={t('Licence de ce son (obligatoire pour publier)')} onValider={(v) => client.call({ type: 'studio.media.modifier', id: m.id, licence: v })} />
                </span>
              ) : m.usage ? (
                <span className="block truncate text-faint">{m.usage}</span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center">
              <Button size="sm" variant="ghost" onClick={() => ajouter(m)} title={t('Poser à la tête de lecture')} data-studio-media-ajouter={m.id}>
                <Plus className="h-3 w-3" />
                {t('Ajouter')}
              </Button>
              <Button size="icon" variant="ghost" aria-label="Retirer de la bibliothèque" title={t('Retirer du projet')} onClick={() => client.call({ type: 'studio.media.supprimer', id: m.id })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          </div>
        ))}
      </Section>

      <ModelesDuProjet donnees={donnees} onOuvrir={onOuvrir} />
    </div>
  );
}

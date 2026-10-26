import * as React from 'react';
import { Check, Clapperboard, Download, Footprints, Loader2, MessageSquarePlus, Move3d, RotateCw, ScanFace, SlidersHorizontal, SunMedium, Undo2 } from 'lucide-react';
import {
  ANGLES_DE_VUE,
  PARAMETRES_DES_ANGLES,
  catalogueDeGeneration,
  heureExacte,
  estUneRetoucheDImage,
  informationsDuMedia,
  type Attachment,
  type CapaciteDeGeneration,
  type InformationDeMedia,
  type MediaDuSuivi,
  type OperationDeRetouche,
} from '@beluga/shared';
import {
  ActionTiroir,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MenuActions,
  Textarea,
  ZoneDefilement,
  ListeDeroulante,
} from '@/components/ui';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { joindreAuChamp } from '@/lib/joindre-au-champ';
import { useProduction } from '@/lib/production-de-carte';
import { useTelechargement } from '@/lib/telechargement';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE MENU « … » D'UN MÉDIA FABRIQUÉ (agent créatif, 24/10/2026).
 *
 * En haut à droite de chaque image, vidéo ou son — dans la discussion comme
 * dans le suivi de la production —, les trois points ouvrent ses options :
 *  - « Réglages » : TOUTES ses données (consigne, service, modèle, format,
 *    dimensions, durée, réglages de retouche, prix, version, origine), les
 *    modifiables se changent et « Relancer avec ces réglages » repart par
 *    l'agent, devis compris ;
 *  - « Ajouter au suivi » / « Retirer du suivi » : le suivi de droite est le
 *    cahier de la production, il ne garde que ce qu'on y ajoute ; retirer ne
 *    touche jamais au fichier ;
 *  - « Redemander avec une consigne » : le média rejoint le champ d'écriture,
 *    on écrit ce qu'on veut changer ;
 *  - « Télécharger » ;
 *  - pour une IMAGE : « Animer ce plan » (l'agent demande l'image de fin, le
 *    modèle et le nombre de propositions), « Autres angles », « Changer la
 *    lumière », « Remplacer le visage » — l'agent demande alors le modèle
 *    (avec la différence de prix), le réglage puis le nombre d'images ;
 *  - pour une VIDÉO : « Reprendre ses gestes » (contrôle du mouvement : un
 *    personnage d'une image refait les gestes de cette vidéo) ;
 *  rien ne part sans devis validé.
 *
 * Sous le média, une LIGNE D'INFORMATIONS selon son genre (format, dimensions,
 * durée, images par seconde, débit, poids) : seulement ce qui est mesuré.
 *
 * Chaque geste qui parle à l'agent passe par un vrai message de l'utilisateur
 * (`agent.prompt`) : il se lit dans le fil, et deux demandes rapprochées se
 * suivent au lieu de se doubler.
 */

/** L'agent qui porte la discussion de la carte : c'est à lui que parlent les gestes du menu. */
export const ContexteAgentDuFil = React.createContext<string | null>(null);

/** Le média de la production qui correspond à une pièce jointe ou à un identifiant de média. */
export function useMediaDeProduction(cardId: string | null | undefined, ou: { mediaId?: string | null; attachmentId?: string | null }): MediaDuSuivi | null {
  const production = useProduction(cardId);
  return React.useMemo(() => {
    if (!production) return null;
    if (ou.mediaId) return production.medias.find((m) => m.id === ou.mediaId) ?? null;
    if (ou.attachmentId) return production.medias.find((m) => m.attachmentId === ou.attachmentId) ?? null;
    return null;
  }, [production, ou.mediaId, ou.attachmentId]);
}

const MIME_DU_GENRE: Record<MediaDuSuivi['genre'], string> = { image: 'image/png', video: 'video/mp4', son: 'audio/mpeg' };

/** La légende d'un média : son plan et sa version. */
export function legendeDuMedia(m: Pick<MediaDuSuivi, 'plan' | 'version'>): string {
  return `${m.plan}${m.version > 1 ? ` · v${m.version}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Parler à l'agent                                                     */
/* ------------------------------------------------------------------ */

async function direALAgent(agentId: string, texte: string, attachments: string[] = []): Promise<void> {
  await client.call({ type: 'agent.prompt', agentId, text: texte, attachments });
}

/*
 * AJOUTS ET RETRAITS GROUPÉS : trois images ajoutées d'affilée font UN message
 * à l'agent, pas trois tours. On attend un instant de calme avant de le lui dire.
 */
const enAttente = new Map<string, { lignes: string[]; minuterie: ReturnType<typeof setTimeout> | null }>();
function annoncerAuSuivi(agentId: string, ligne: string) {
  const file = enAttente.get(agentId) ?? { lignes: [], minuterie: null };
  file.lignes.push(ligne);
  if (file.minuterie) clearTimeout(file.minuterie);
  file.minuterie = setTimeout(() => {
    enAttente.delete(agentId);
    void direALAgent(agentId, file.lignes.join('\n')).catch(() => client.pushToast('error', t('L’agent n’a pas pu être prévenu : écrivez-lui ce que vous avez retenu.')));
  }, 1500);
  enAttente.set(agentId, file);
}

/* ------------------------------------------------------------------ */
/* La ligne d'informations                                              */
/* ------------------------------------------------------------------ */

function nombre(n: number, decimales = 1): string {
  return (Math.round(n * 10 ** decimales) / 10 ** decimales).toLocaleString(undefined, { maximumFractionDigits: decimales });
}

export function texteDUneInformation(i: InformationDeMedia): string {
  switch (i.genre) {
    case 'format':
      return i.valeur;
    case 'dimensions':
      return `${i.largeur} × ${i.hauteur} px`;
    case 'duree':
      return i.secondes >= 60 ? `${Math.floor(i.secondes / 60)} min ${nombre(i.secondes % 60, 0)} s` : `${nombre(i.secondes)} s`;
    case 'ips':
      return t('{n} im/s', { n: nombre(i.valeur) });
    case 'debit':
      return i.kbps >= 1000 ? `${nombre(i.kbps / 1000)} Mb/s` : `${i.kbps} kb/s`;
    case 'poids':
      return i.octets >= 1_000_000 ? t('{n} Mo', { n: nombre(i.octets / 1_000_000) }) : t('{n} ko', { n: nombre(i.octets / 1000, 0) });
  }
}

/** LA LIGNE D'INFORMATIONS SOUS UN MÉDIA : copiable, sur une ligne qui passe à la ligne plutôt que de déborder. */
export function InformationsDuMedia({ media, className }: { media: MediaDuSuivi; className?: string }) {
  const infos = informationsDuMedia({ genre: media.genre, format: media.format ?? null, mesure: media.mesure ?? null, taille: media.taille ?? null });
  if (!infos.length) return null;
  return (
    <p className={cn('flex min-w-0 select-text flex-wrap gap-x-1.5 text-[11.5px] tabular-nums leading-snug text-faint', className)} data-meta-media={media.id}>
      {infos.map((i, n) => (
        <React.Fragment key={i.genre}>
          {n ? <span aria-hidden>·</span> : null}
          <span data-meta-genre={i.genre}>{texteDUneInformation(i)}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

/** La petite marque d'un média retenu, monochrome. */
export function MarqueDansLeSuivi({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded bg-surface/85 px-1 text-[10.5px] leading-4 text-muted', className)} data-media-dans-le-suivi="">
      <Check className="h-3 w-3" aria-hidden />
      {t('Dans le suivi')}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Le menu                                                              */
/* ------------------------------------------------------------------ */

const LIBELLES_RETOUCHES: Record<OperationDeRetouche, () => string> = {
  angles: () => t('Autres angles'),
  lumiere: () => t('Changer la lumière'),
  visage: () => t('Remplacer le visage'),
};

/** Les gestes de fabrication à partir d'un média : animer une image, reprendre les gestes d'une vidéo. */
function demandeDeFabrication(geste: 'animer' | 'mouvement', media: MediaDuSuivi): string {
  const nom = `« ${legendeDuMedia(media)} » (${t('média')} ${media.id})`;
  return geste === 'animer'
    ? t('Animer le plan à partir de l’image {media} comme image de départ : demandez-moi l’image de fin (ou aucune), puis le modèle avec son prix, puis le nombre de propositions.', { media: nom })
    : t('Reprendre les gestes de la vidéo {media} (contrôle du mouvement) : demandez-moi l’image du personnage, l’orientation, puis le modèle avec son prix.', { media: nom });
}

/** Ce que le message à l'agent dit pour chaque retouche demandée depuis le menu. */
function demandeDeRetouche(operation: OperationDeRetouche, media: MediaDuSuivi): string {
  const nom = `« ${legendeDuMedia(media)} » (${t('média')} ${media.id})`;
  switch (operation) {
    case 'angles':
      return t('Autres angles de l’image {media} : demandez-moi les angles voulus, puis le modèle avec son prix, puis le nombre d’images.', { media: nom });
    case 'lumiere':
      return t('Changer la lumière de l’image {media} : demandez-moi le modèle avec son prix, puis ouvrez la sphère de lumière, puis le nombre d’images.', { media: nom });
    case 'visage':
      return t('Remplacer un visage dans l’image {media} : demandez-moi le modèle avec son prix, les photos du visage à poser et la personne à remplacer, puis le nombre d’images.', { media: nom });
  }
}

export function MenuDuMedia({ cardId, media, className }: { cardId: string; media: MediaDuSuivi; className?: string }) {
  const state = useApp();
  const agentDuFil = React.useContext(ContexteAgentDuFil);
  const carte = state.cards[cardId];
  const agentId = agentDuFil ?? carte?.agentId ?? media.agentId ?? null;
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [reglages, setReglages] = React.useState(false);
  const pret = media.etat === 'fini' && !!media.attachmentId;
  const piece: Attachment | null = media.attachmentId
    ? (state.attachments[carte?.projectId ?? ''] ?? []).find((p: Attachment) => p.id === media.attachmentId) ??
      ({ id: media.attachmentId, projectId: carte?.projectId ?? '', name: `${media.plan}.${media.genre === 'image' ? 'png' : media.genre === 'video' ? 'mp4' : 'mp3'}`, mime: MIME_DU_GENRE[media.genre], size: media.taille ?? 0, sha: media.attachmentId, createdAt: media.creeLe } as Attachment)
    : null;
  const { etat: telechargement, lancer: telecharger } = useTelechargement(piece ? [{ adresse: adresseDePiece(piece.id, true), nom: piece.name }] : []);
  if (!pret) return null;
  const retenu = !!media.retenuLe;

  const basculerLeSuivi = async (fermer: () => void) => {
    if (enCours) return;
    setEnCours('suivi');
    try {
      await client.call({ type: 'production.retenir', cardId, mediaId: media.id, retenu: !retenu });
      if (agentId) annoncerAuSuivi(agentId, retenu ? t('Retiré du suivi : « {media} » ({id}).', { media: legendeDuMedia(media), id: media.id }) : t('Ajouté au suivi : « {media} » ({id}).', { media: legendeDuMedia(media), id: media.id }));
      fermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le suivi n’a pas pu être mis à jour'));
    } finally {
      setEnCours(null);
    }
  };
  const retoucher = async (operation: OperationDeRetouche | 'animer' | 'mouvement', fermer: () => void) => {
    if (enCours || !agentId) return;
    setEnCours(operation);
    try {
      await direALAgent(agentId, operation === 'animer' || operation === 'mouvement' ? demandeDeFabrication(operation, media) : demandeDeRetouche(operation, media), [media.attachmentId!]);
      fermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La demande n’a pas pu partir'));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <>
      <MenuActions titre={t('Options du média')} repere={`media-${media.id}`} className={cn('bg-surface/85', className)} taille="icon-sm">
        {(fermer) => (
          <div className="flex flex-col gap-0.5" data-menu-media={media.id}>
            <ActionTiroir
              icone={<SlidersHorizontal className="h-4 w-4" />}
              onClick={() => {
                fermer();
                setReglages(true);
              }}
              data-media-reglages=""
            >
              {t('Réglages')}
            </ActionTiroir>
            <ActionTiroir
              icone={enCours === 'suivi' ? <Loader2 className="h-4 w-4 animate-spin" /> : retenu ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              onClick={() => void basculerLeSuivi(fermer)}
              disabled={!!enCours}
              {...(retenu ? { 'data-media-retirer': '' } : { 'data-media-retenir': '' })}
            >
              {retenu ? t('Retirer du suivi') : t('Ajouter au suivi')}
            </ActionTiroir>
            {agentId && piece ? (
              <ActionTiroir
                icone={<MessageSquarePlus className="h-4 w-4" />}
                onClick={() => {
                  joindreAuChamp({ agentId, piece });
                  fermer();
                }}
                data-media-redemander=""
              >
                {t('Redemander avec une consigne')}
              </ActionTiroir>
            ) : null}
            <ActionTiroir
              icone={telechargement === 'reception' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              onClick={() => {
                telecharger();
                fermer();
              }}
              data-media-telecharger=""
            >
              {t('Télécharger')}
            </ActionTiroir>
            {media.genre === 'image' && agentId ? (
              <ActionTiroir
                icone={enCours === 'animer' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                onClick={() => void retoucher('animer', fermer)}
                disabled={!!enCours}
                data-media-animer=""
              >
                {t('Animer ce plan')}
              </ActionTiroir>
            ) : null}
            {media.genre === 'video' && agentId ? (
              <ActionTiroir
                icone={enCours === 'mouvement' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Footprints className="h-4 w-4" />}
                onClick={() => void retoucher('mouvement', fermer)}
                disabled={!!enCours}
                data-media-mouvement=""
              >
                {t('Reprendre ses gestes')}
              </ActionTiroir>
            ) : null}
            {/* Les retouches d'IMAGE : aucun modèle en place ne retouche une vidéo ou un son. */}
            {media.genre === 'image' && agentId
              ? (['angles', 'lumiere', 'visage'] as const).map((operation) => (
                  <ActionTiroir
                    key={operation}
                    icone={
                      enCours === operation ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : operation === 'angles' ? (
                        <Move3d className="h-4 w-4" />
                      ) : operation === 'lumiere' ? (
                        <SunMedium className="h-4 w-4" />
                      ) : (
                        <ScanFace className="h-4 w-4" />
                      )
                    }
                    onClick={() => void retoucher(operation, fermer)}
                    disabled={!!enCours}
                    {...{ [`data-media-${operation === 'angles' ? 'autres-angles' : operation}`]: '' }}
                  >
                    {LIBELLES_RETOUCHES[operation]()}
                  </ActionTiroir>
                ))
              : null}
          </div>
        )}
      </MenuActions>
      <ReglagesDuMedia ouvert={reglages} onFermer={() => setReglages(false)} media={media} agentId={agentId} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Les réglages                                                         */
/* ------------------------------------------------------------------ */

const FORMATS = ['16:9', '9:16', '1:1', '4:5'] as const;

function LigneDeReglage({ cle, children }: { cle: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,34%)_1fr] gap-x-3 gap-y-0.5 py-1 text-[13px]">
      <span className="text-faint">{cle}</span>
      <span className="min-w-0 select-text break-words text-text">{children}</span>
    </div>
  );
}

/**
 * « RÉGLAGES » D'UN MÉDIA : tout ce qui l'a fabriqué, lisible et copiable ; la
 * consigne, le format, la durée, le modèle et le réglage d'une retouche se
 * modifient, et « Relancer avec ces réglages » le dit à l'agent, qui refait
 * un devis — rien ne part sans le clic sur le devis.
 */
function ReglagesDuMedia({ ouvert, onFermer, media, agentId }: { ouvert: boolean; onFermer: () => void; media: MediaDuSuivi; agentId: string | null }) {
  const consigneDeDepart = media.consigneOriginale || media.consigne || '';
  const [consigne, setConsigne] = React.useState(consigneDeDepart);
  const [format, setFormat] = React.useState(media.format ?? '');
  const [duree, setDuree] = React.useState(media.duree ? String(media.duree) : '');
  const [modele, setModele] = React.useState(media.modele ?? '');
  const [angle, setAngle] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  React.useEffect(() => {
    if (!ouvert) return;
    setConsigne(consigneDeDepart);
    setFormat(media.format ?? '');
    setDuree(media.duree ? String(media.duree) : '');
    setModele(media.modele ?? '');
    setAngle('');
  }, [ouvert, media.id]);
  const capacite = media.capacite as CapaciteDeGeneration;
  const modeles = catalogueDeGeneration().filter((m) => m.capacite === capacite);
  const changements: string[] = [];
  if (consigne.trim() && consigne.trim() !== consigneDeDepart.trim()) changements.push(t('consigne : {v}', { v: consigne.trim() }));
  if (format && format !== (media.format ?? '')) changements.push(t('format : {v}', { v: format }));
  if (duree && Number(duree) !== media.duree) changements.push(t('durée : {v} s', { v: duree }));
  if (modele && modele !== media.modele) changements.push(t('modèle : {v}', { v: modeles.find((m) => m.id === modele)?.nom ?? modele }));
  if (angle) changements.push(t('angle : {v}', { v: PARAMETRES_DES_ANGLES[angle as keyof typeof PARAMETRES_DES_ANGLES]?.libelle ?? angle }));
  const prix = media.coutReel ?? media.prixAnnonce ?? media.prix;
  const relancer = async () => {
    if (!agentId || envoi || !changements.length) return;
    setEnvoi(true);
    try {
      await direALAgent(
        agentId,
        t('Relancer « {media} » ({id}) avec ces réglages — {changements}. Refaites le devis (version suivante) et demandez-moi combien de propositions.', {
          media: legendeDuMedia(media),
          id: media.id,
          changements: changements.join(' ; '),
        }),
        media.attachmentId ? [media.attachmentId] : [],
      );
      onFermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La demande n’a pas pu partir'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Dialog open={ouvert} onOpenChange={(next) => !next && onFermer()}>
      <DialogContent className="sm:w-[min(560px,100%)]" data-reglages-media={media.id}>
        <DialogHeader>
          <DialogTitle>{t('Réglages de « {media} »', { media: legendeDuMedia(media) })}</DialogTitle>
          <DialogDescription>{t('Tout ce qui a fabriqué ce média. Changez ce qui se règle, puis relancez : l’agent refait un devis avant toute dépense.')}</DialogDescription>
        </DialogHeader>
        <ZoneDefilement className="max-h-[60dvh]">
          <div className="flex flex-col pr-1">
            <LigneDeReglage cle={t('Service et modèle')}>{[media.service, media.modeleNom].filter(Boolean).join(' · ')}</LigneDeReglage>
            <LigneDeReglage cle={t('Informations')}>
              {informationsDuMedia({ genre: media.genre, format: media.format ?? null, mesure: media.mesure ?? null, taille: media.taille ?? null }).map(texteDUneInformation).join(' · ') || '—'}
            </LigneDeReglage>
            {(media.reglages ?? []).map((r) => (
              <LigneDeReglage key={r.cle} cle={t(r.cle)}>
                {r.valeur}
              </LigneDeReglage>
            ))}
            <LigneDeReglage cle={t('Prix')}>{prix === null || prix === undefined ? t('prix non publié') : `${prix} $${media.coutReel !== null && media.coutReel !== undefined ? ` (${t('coût réel')})` : ''}`}</LigneDeReglage>
            <LigneDeReglage cle={t('Version')}>{`v${media.version} · ${heureExacte(media.creeLe)}`}</LigneDeReglage>
            {media.consigneOriginale && media.consigne ? (
              <LigneDeReglage cle={t('Envoyé au service (anglais)')}>
                <span className="whitespace-pre-line" lang="en">
                  {media.consigne}
                </span>
              </LigneDeReglage>
            ) : null}

            <p className="mt-3 text-[12px] uppercase tracking-wide text-faint">{t('Ce qui se règle')}</p>
            <label className="mt-1 flex flex-col gap-1 text-[13px] text-muted">
              {t('Consigne')}
              <Textarea value={consigne} onChange={(e) => setConsigne(e.target.value)} rows={4} data-reglage-consigne="" />
            </label>
            {media.genre !== 'son' ? (
              <div className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {t('Format')}
                <ListeDeroulante titre={t('Format')} valeur={format} onChoisir={setFormat} empile className="h-9" data-reglage-format="" options={FORMATS.map((f) => ({ valeur: f, libelle: f }))} />
              </div>
            ) : null}
            {media.genre !== 'image' ? (
              <label className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {t('Durée (secondes)')}
                <Input type="number" min={1} value={duree} onChange={(e) => setDuree(e.target.value)} data-reglage-duree="" />
              </label>
            ) : null}
            {modeles.length > 1 ? (
              <div className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {t('Modèle')}
                <ListeDeroulante
                  titre={t('Modèle')}
                  valeur={modele}
                  onChoisir={setModele}
                  empile
                  className="h-9"
                  data-reglage-modele=""
                  options={modeles.filter((m, i) => modeles.findIndex((x) => x.id === m.id) === i).map((m) => ({ valeur: m.id, libelle: m.nom }))}
                />
              </div>
            ) : null}
            {capacite === 'angles' || (media.genre === 'image' && estUneRetoucheDImage(capacite)) ? (
              capacite === 'angles' ? (
                <div className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                  {t('Angle')}
                  <ListeDeroulante
                    titre={t('Angle')}
                    valeur={angle}
                    onChoisir={setAngle}
                    empile
                    className="h-9"
                    data-reglage-angle=""
                    options={[{ valeur: '', libelle: t('Inchangé') }, ...ANGLES_DE_VUE.map((a) => ({ valeur: a, libelle: t(PARAMETRES_DES_ANGLES[a].libelle) }))]}
                  />
                </div>
              ) : null
            ) : null}
          </div>
        </ZoneDefilement>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onFermer}>
            {t('Fermer')}
          </Button>
          <Button size="sm" className="gap-1.5" disabled={!agentId || !changements.length || envoi} onClick={() => void relancer()} data-relancer-media="">
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            {t('Relancer avec ces réglages')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Posé sur un média du fil                                             */
/* ------------------------------------------------------------------ */

/**
 * LE MENU ET LA LIGNE D'INFORMATIONS D'UNE PIÈCE DU FIL : le bloc d'un média
 * fabriqué et les médias livrés sous une réponse ne connaissent que la pièce
 * jointe ; on retrouve le média de la production qu'elle porte. Hors d'une
 * production (Studio, agent sans carte), rien ne s'affiche.
 */
export function MenuDeLaPiece({ cardId, attachmentId, className }: { cardId: string | null | undefined; attachmentId: string | null | undefined; className?: string }) {
  const media = useMediaDeProduction(cardId, { attachmentId });
  if (!cardId || !media) return null;
  return (
    <div className={cn('absolute right-1 top-1 z-[1] flex items-center gap-1', className)}>
      {media.retenuLe ? <MarqueDansLeSuivi /> : null}
      <MenuDuMedia cardId={cardId} media={media} />
    </div>
  );
}

export function InformationsDeLaPiece({ cardId, attachmentId, className }: { cardId: string | null | undefined; attachmentId: string | null | undefined; className?: string }) {
  const media = useMediaDeProduction(cardId, { attachmentId });
  return media ? <InformationsDuMedia media={media} className={className} /> : null;
}

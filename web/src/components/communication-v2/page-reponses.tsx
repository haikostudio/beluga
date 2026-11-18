import * as React from 'react';
import { ExternalLink, EyeOff, Loader2, Send, Sparkles, Trash2 } from '@/components/ui/icones';
import { FICHES_RESEAUX, raisonModerationImpossible, type MessageSocial } from '@beluga/shared';
import { Button, ConfirmDialog, Drawer, EnteteDeFeuille, Textarea, ZoneDefilement } from '@/components/ui';
import { SilhouetteMarketing } from '@/components/silhouettes';
import { PageV2 as PageEnPlace } from './page-v2';
import { EcranVide, PastilleReseau, instantCourt, jouerUnGeste, libelleDuCanal, useLecture } from '@/components/communication-v2/socle/pieces';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { enPreparation, useV2 } from './contexte';
import { ChampDeDemande, EnPreparation, MotDuChef, VIOLET } from './pieces';

interface LigneDeMessage {
  id: string;
  genre: string;
  reseau: string;
  auteur: string;
  texte: string;
  instant: number;
  lu: boolean;
  brouillon: string | null;
  repondu: boolean;
  masqueLe?: number | null;
  contenu: { id: string; titre: string } | null;
}

interface Fil {
  message: MessageSocial;
  fil: MessageSocial[];
  contenu: { id: string; titre: string } | null;
  limite: number | null;
}

const libelleDuType = (genre: string) => (genre === 'commentaire' ? t('Commentaire') : genre === 'avis' ? t('Avis') : t('Message privé'));

/**
 * « RÉPONSES » — LES MESSAGES PRIVÉS ET LES COMMENTAIRES RÉUNIS (décision de l'utilisateur) : une seule liste, le plus
 * récent en haut, chacun avec son réseau, son genre et son état. Ouvert : l'échange, puis la réponse — écrite à la
 * main, ou PROPOSÉE par le chef en coulisses —, qui ne part qu'au clic « Envoyer ». Un commentaire se masque ou se
 * supprime là où le réseau le permet. Au téléphone, l'échange s'ouvre dans la feuille du bas.
 */
export function PageReponses({ element }: { element: string[] }) {
  const { marque, aller } = useV2();
  const telephone = useTelephone();
  const { donnees, erreur } = useLecture<{ lignes: LigneDeMessage[] }>({ type: 'communication.messages', marqueId: marque.id }, [marque.id]);
  const ouvert = element[0] ?? null;
  const lignes = React.useMemo(() => [...(donnees?.lignes ?? [])].sort((a, b) => b.instant - a.instant), [donnees]);
  const choisi = ouvert ?? (telephone ? null : lignes.find((l) => !l.repondu)?.id ?? lignes[0]?.id ?? null);
  const aTraiter = lignes.filter((l) => !l.repondu && !l.masqueLe).length;
  return (
    <PageEnPlace
      barre={false}
      titre={t('Réponses')}
      sousTitre={donnees ? (aTraiter ? t('{n} à traiter', { n: aTraiter }) : t('Tout est à jour')) : undefined}
      invite={null}
      /* LE CHAT SUR CHAQUE PAGE (décision du 08/11/2026) : une demande sur l'ensemble des réponses (« prépare une
         réponse à tous les commentaires d'hier »…) ; chaque réponse préparée attend sous son message. */
      pied={<ChampDeDemande invite={t('Demander au chef de préparer des réponses…')} genre="reponses" preparation={t('Le chef prépare vos réponses…')} repere="reponses" />}
      data-v2-reponses={lignes.length}
    >
      <MotDuChef genres={['reponses']} />
      {erreur && !donnees ? (
        <p className="text-[13px] text-danger">{erreur}</p>
      ) : !donnees ? (
        <SilhouetteMarketing />
      ) : !lignes.length ? (
        <EcranVide titre={t('Personne ne vous a encore écrit')} texte={t('Les messages privés et les commentaires de vos réseaux reliés arrivent ici, avec une réponse proposée.')} data-v2-reponses-vides />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <ul className="flex min-w-0 flex-col self-start overflow-hidden rounded-xl bg-surface" data-v2-liste-reponses>
            {lignes.map((l) => {
              const actif = !telephone && choisi === l.id;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => aller('reponses', l.id)}
                    aria-current={actif ? 'true' : undefined}
                    className={cn('flex w-full min-w-0 items-start gap-2.5 border-t border-faint/15 px-3 py-2.5 text-left hover:bg-raised', actif && cn(VIOLET.fondPale, VIOLET.anneau))}
                    data-v2-message={l.id}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold text-text">{l.auteur.charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <b className={cn('min-w-0 truncate text-[13.5px]', !l.lu ? 'font-semibold' : 'font-medium', actif ? VIOLET.texte : 'text-text')}>{l.auteur}</b>
                        <PastilleReseau canal={l.reseau} />
                        <span className="shrink-0 text-[11.5px] text-faint">{libelleDuType(l.genre)}</span>
                        <span className="ml-auto shrink-0 text-[11.5px] text-faint">{instantCourt(l.instant)}</span>
                      </span>
                      <span className="line-clamp-2 text-[12.5px] leading-snug text-muted">{l.texte}</span>
                      <span className="mt-1 block text-[11.5px] font-medium text-faint" data-v2-etat-message={l.repondu ? 'repondu' : l.brouillon ? 'prete' : 'a-traiter'}>
                        {l.masqueLe ? t('Masqué') : l.repondu ? t('Répondu') : l.brouillon ? t('Réponse prête, à envoyer') : t('À traiter')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!telephone && choisi ? (
            <div className="min-w-0">
              <div className="sticky top-0 rounded-xl bg-surface p-3">
                <FilV2 key={choisi} messageId={choisi} />
              </div>
            </div>
          ) : null}
        </div>
      )}
      {telephone ? (
        <Drawer feuille open={!!ouvert} onClose={() => aller('reponses')}>
          {ouvert ? (
            <>
              <EnteteDeFeuille titre={lignes.find((l) => l.id === ouvert)?.auteur ?? t('Réponses')} data-v2-feuille-message />
              <ZoneDefilement className="px-4 pb-4">
                <FilV2 key={ouvert} messageId={ouvert} />
              </ZoneDefilement>
            </>
          ) : null}
        </Drawer>
      ) : null}
    </PageEnPlace>
  );
}

/** UN ÉCHANGE OUVERT : les messages, puis la réponse — proposée par le chef ou écrite à la main —, envoyée au seul clic. */
function FilV2({ messageId }: { messageId: string }) {
  const { marque, aller, coulisses, demander } = useV2();
  const { donnees: f, erreur, relire } = useLecture<Fil>({ type: 'communication.fil', marqueId: marque.id, messageId }, [messageId]);
  const [texte, setTexte] = React.useState<string | null>(null);
  const [envoi, setEnvoi] = React.useState(false);
  const [moderation, setModeration] = React.useState<'masquer' | 'supprimer' | null>(null);
  const [aSupprimer, setASupprimer] = React.useState(false);
  const prepare = enPreparation(coulisses, ['reponse'], { messageId });
  const lu = f?.message.lu;
  const projet = f?.message.projectId;
  React.useEffect(() => {
    if (lu === false && projet) void jouerUnGeste('messages.lus', undefined, { projectId: projet, ids: [messageId] });
  }, [lu, projet, messageId]);
  /* LA RÉPONSE PROPOSÉE ARRIVE PENDANT QU'ON REGARDE : elle remplit le champ tant qu'on n'y a rien tapé. */
  const brouillon = f?.message.brouillon ?? '';
  const redaction = texte ?? brouillon;
  if (erreur && !f) return <p className="text-[13px] text-danger">{erreur}</p>;
  if (!f) return <SilhouetteMarketing />;
  const m = f.message;
  const commentaire = m.genre === 'commentaire';
  const refusMasquer = commentaire ? raisonModerationImpossible(m.reseau, 'masquer') : null;
  const refusSupprimer = commentaire ? raisonModerationImpossible(m.reseau, 'supprimer') : null;
  const envoyer = async () => {
    setEnvoi(true);
    const r = await jouerUnGeste('message.repondre', m.id, { texte: redaction });
    setEnvoi(false);
    if (r) {
      client.pushToast('success', t('Réponse envoyée.'));
      setTexte(null);
      relire();
    }
  };
  const moderer = async (geste: 'masquer' | 'supprimer') => {
    setModeration(geste);
    const r = await jouerUnGeste(geste === 'masquer' ? 'commentaire.masquer' : 'commentaire.supprimer', m.id);
    setModeration(null);
    if (!r) return;
    client.pushToast('success', geste === 'masquer' ? t('Commentaire masqué.') : t('Commentaire supprimé.'));
    if (geste === 'supprimer') aller('reponses');
    else relire();
  };
  return (
    <div className="flex min-w-0 flex-col gap-3" data-v2-fil={m.id}>
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px] font-semibold text-text">{m.auteur}</b>
          <span className="block truncate text-[12px] text-muted">
            {libelleDuCanal(m.reseau)} · {libelleDuType(m.genre)}
            {f.contenu ? ` · ${f.contenu.titre}` : ''}
          </span>
        </span>
        {m.url ? (
          <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text">
            <ExternalLink className="h-3.5 w-3.5" />
            {t('Ouvrir sur {reseau}', { reseau: FICHES_RESEAUX[m.reseau].libelle })}
          </a>
        ) : null}
      </header>
      <div className="flex min-w-0 flex-col gap-1.5" data-v2-echanges>
        {f.fil.map((x) => (
          <div key={x.id} className={cn('max-w-[85%] rounded-xl px-3 py-1.5 text-[13px]', x.sortant ? 'self-end bg-fond-survol' : 'self-start bg-raised')} data-sortant={x.sortant ? 'oui' : 'non'}>
            <p className="whitespace-pre-wrap break-words text-text">{x.texte}</p>
            <small className="mt-0.5 block text-[10px] text-faint">
              {instantCourt(x.instant)}
              {x.sortant ? ` · ${t('vous')}` : ''}
            </small>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-bg px-3 py-2.5" data-v2-reponse>
        <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
          <Sparkles className="h-3.5 w-3.5" />
          {brouillon ? t('Réponse proposée par le chef') : t('Votre réponse')}
        </p>
        {prepare ? <EnPreparation className="mb-1" texte={t('Le chef prépare une réponse…')} /> : null}
        <Textarea rows={3} value={redaction} onChange={(e) => setTexte(e.target.value)} placeholder={t('Écrivez votre réponse, ou demandez-la au chef.')} className="border-0 bg-transparent px-0 text-[13.5px] max-sm:text-[16px]" data-v2-champ-reponse />
        <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
          <Button size="sm" disabled={envoi || !redaction.trim()} onClick={() => void envoyer()} data-v2-envoyer-reponse>
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {t('Envoyer')}
          </Button>
          <Button size="sm" variant="ghost" disabled={prepare} onClick={() => void demander('reponse', redaction ? t('Rends cette réponse plus courte et plus chaleureuse : {texte}', { texte: redaction.slice(0, 600) }) : undefined, { messageId: m.id })} data-v2-proposer-reponse>
            {redaction ? t('Améliorer avec le chef') : t('Proposer une réponse')}
          </Button>
          {commentaire ? (
            <>
              <span className="flex-1" />
              <span title={refusMasquer ?? undefined}>
                <Button size="sm" variant="ghost" disabled={!!refusMasquer || !!m.masqueLe || moderation !== null} onClick={() => void moderer('masquer')} data-v2-masquer={refusMasquer ? 'impossible' : 'possible'}>
                  {moderation === 'masquer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {m.masqueLe ? t('Masqué') : t('Masquer')}
                </Button>
              </span>
              <span title={refusSupprimer ?? undefined}>
                <Button size="sm" variant="ghost" disabled={!!refusSupprimer || moderation !== null} onClick={() => setASupprimer(true)} data-v2-supprimer={refusSupprimer ? 'impossible' : 'possible'}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('Supprimer')}
                </Button>
              </span>
            </>
          ) : null}
        </div>
        <MotDuChef genres={['reponse']} cibles={{ messageId: m.id }} />
      </div>
      <ConfirmDialog
        open={aSupprimer}
        onClose={() => setASupprimer(false)}
        danger
        title={t('Supprimer ce commentaire ?')}
        description={t('Il disparaît aussi sur {reseau}, pour tout le monde.', { reseau: FICHES_RESEAUX[m.reseau].libelle })}
        confirmLabel={t('Supprimer')}
        onConfirm={() => {
          setASupprimer(false);
          void moderer('supprimer');
        }}
      />
    </div>
  );
}

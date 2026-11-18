import * as React from 'react';
import { CalendarDays, Check, Loader2 } from '@/components/ui/icones';
import { Button } from '@/components/ui';
import { LogoReseau } from '@/components/logos-reseaux';
import { ApercuDePost, largeurDeLApercu, usePostsDeMarque } from '@/components/communication-v2/socle/apercu-de-post';
import { estUnReseau, jouerUnGeste, libelleDuCanal, nombreLisible } from '@/components/communication-v2/socle/pieces';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { enPreparation, useV2 } from './contexte';
import { cleDuMedia, useMediasDeLaMarque, type PublicationV2 } from './donnees';
import { ChampDeDemande, EtatDePublication, MotDuChef, VIOLET } from './pieces';

/** La date d'une publication, en clair : « mardi 12 novembre · 18:00 ». */
export function dateDePublication(p: Pick<PublicationV2, 'datePrevue' | 'heurePrevue'>): string {
  if (!p.datePrevue) return t('Pas encore de date');
  const jour = new Date(`${p.datePrevue}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return p.heurePrevue ? `${jour} · ${p.heurePrevue}` : jour;
}

/**
 * L'APERÇU D'UNE PUBLICATION, TEL QU'IL PARAÎTRA (piste B #f3af) : le post réaliste du réseau choisi (ses déclinaisons
 * se choisissent par leur logo), sa date, « Valider » s'il attend — la publication passe prête et son média validé, d'un
 * seul geste, comme dans l'espace actuel — puis « Demander une retouche… », qui part au chef en coulisses.
 */
export function ApercuV2({
  membres,
  campagneId,
  fabrication,
  sansRetouche = false,
  navigation,
}: {
  membres: readonly PublicationV2[];
  campagneId?: string;
  fabrication?: boolean;
  /**
   * LA NAVIGATION DU TIROIR (« Précédente / n sur N / Suivante »), posée EN TÊTE de l'aperçu : elle prend la largeur du
   * post, comme le reste (15/11/2026, capture #0a85).
   */
  navigation?: React.ReactNode;
  /** LA PAGE D'UNE CAMPAGNE (10/11/2026) : la retouche se demande à l'agent de la campagne, dans sa conversation. */
  sansRetouche?: boolean;
}) {
  const { marque, coulisses } = useV2();
  const posts = usePostsDeMarque(marque.id);
  const { donnees: medias } = useMediasDeLaMarque();
  const [reseau, setReseau] = React.useState<string | null>(null);
  const [valide, setValide] = React.useState(false);
  const tete = membres[0]!;
  const choisie = membres.find((m) => (m.canaux.find(estUnReseau) ?? m.canal) === reseau) ?? tete;
  const r = choisie.canaux.find(estUnReseau) ?? choisie.canal;
  const post = posts.post(choisie as never, r);
  const aValider = membres.filter((m) => m.etape === 'a_valider');
  const retouche = enPreparation(coulisses, ['retouche'], { contenuId: tete.id });
  const valider = async () => {
    setValide(true);
    for (const m of aValider) {
      const cle = cleDuMedia(m.id, medias?.medias);
      await jouerUnGeste('publication.valider', m.id, cle ? { media: cle } : undefined);
    }
    setValide(false);
  };
  return (
    /* UNE SEULE COLONNE, DE LA LARGEUR DU POST (15/11/2026) : la navigation, les réseaux, le post, la date et « Valider »
       s'alignent sur ses bords — plus un petit aperçu perdu au milieu de rangées plus larges. */
    <div
      className="mx-auto flex w-full min-w-0 flex-col gap-3"
      style={{ maxWidth: largeurDeLApercu(r) }}
      data-v2-apercu={tete.id}
      data-v2-apercu-largeur={largeurDeLApercu(r)}
    >
      {navigation}
      {membres.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Réseaux" data-v2-apercu-reseaux>
          {membres.map((m) => {
            const rr = m.canaux.find(estUnReseau) ?? m.canal;
            const actif = m === choisie;
            return (
              <button key={m.id} type="button" onClick={() => setReseau(rr)} aria-pressed={actif} className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px]', actif ? cn(VIOLET.fondLeger, VIOLET.texte, 'font-medium') : 'bg-raised text-muted hover:text-text')} data-v2-apercu-reseau={rr}>
                {estUnReseau(rr) ? <LogoReseau reseau={rr} className="h-3.5 w-3.5" /> : null}
                {libelleDuCanal(rr)}
              </button>
            );
          })}
        </div>
      ) : null}
      <ApercuDePost reseau={r} compte={post.compte} marque={marque} visuels={post.visuels} texte={choisie.texte} />
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate first-letter:uppercase">{dateDePublication(choisie)}</span>
        <EtatDePublication etape={choisie.etape} fabrication={fabrication} />
      </div>
      {choisie.etape === 'publie' && choisie.chiffres ? (
        <p className="text-[12.5px] text-muted" data-v2-chiffres-publication>
          {t('{v} vues · {r} réactions · {c} clics', { v: nombreLisible(choisie.chiffres.vues), r: nombreLisible(choisie.chiffres.reactions), c: nombreLisible(choisie.chiffres.clics) })}
        </p>
      ) : null}
      {aValider.length ? (
        <Button className="w-full" disabled={valide} onClick={() => void valider()} data-v2-valider={tete.id}>
          {valide ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {aValider.length > 1 ? t('Valider les {n} versions', { n: aValider.length }) : t('Valider')}
        </Button>
      ) : null}
      {choisie.etape !== 'publie' && !sansRetouche ? (
        <>
          <MotDuChef genres={['retouche']} cibles={{ contenuId: tete.id }} />
          <ChampDeDemande
            dansLaPage
            invite={t('Demander une retouche…')}
            genre="retouche"
            cibles={{ contenuId: tete.id, ...(campagneId ? { campagneId } : {}) }}
            preparation={retouche ? t('Le chef retouche cette publication…') : t('Envoi au chef…')}
            repere="retouche"
          />
        </>
      ) : null}
    </div>
  );
}

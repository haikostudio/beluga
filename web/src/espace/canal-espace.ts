/**
 * LE CANAL DE L'ESPACE CLIENT.
 *
 * Un canal à lui, court et sans état d'application : l'espace n'a besoin ni du
 * tableau, ni des agents, ni des quotas, et le magasin général de l'interface
 * d'administration ne doit surtout pas être embarqué dans l'écran d'un client.
 *
 * Il applique la règle du CANAL ZOMBIE : on ne se fie pas à `onclose` pour
 * savoir si le lien répond encore — un battement régulier le vérifie, et c'est
 * lui qui décide de l'état affiché.
 */
import {
  DELAI_OUVERTURE_DU_CANAL,
  delaiRestantAvantAbandonDeLOuverture,
  repliDuCanal,
  type ClientCommand,
  type ServerEvent,
} from '@beluga/shared';
import { t } from '@/lib/langue';
import { estEnVeille, surLaVeille } from '@/lib/veille';

export type EtatCanalEspace = 'connexion' | 'en-ligne' | 'coupe';

type Ecouteur = (event: ServerEvent) => void;

/** Le battement : au-delà, on considère que le canal ne répond plus. */
const BATTEMENT_MS = 15000;
const SILENCE_TOLERE_MS = 40000;

class CanalEspace {
  private socket: WebSocket | null = null;
  private ecouteurs = new Set<Ecouteur>();
  private attentes = new Map<string, { resoudre: (v: any) => void; rejeter: (e: Error) => void }>();
  private dernierSigne = 0;
  private minuteur: number | null = null;
  private etatCourant: EtatCanalEspace = 'connexion';
  private surEtat = new Set<(etat: EtatCanalEspace) => void>();
  private ouvert = false;
  /** Le plafond de la tentative en cours, et la reprise planifiée après une coupure. */
  private minuteurOuverture: number | null = null;
  private minuteurReprise: number | null = null;
  /** Coupures d'affilée depuis la dernière liaison réussie : elles règlent le repli. */
  private tentatives = 0;
  /**
   * DEPUIS QUAND L'ESPACE N'A PLUS SA LIAISON — compté jusqu'à ce que l'identité
   * (`ready.client`) revienne, pas seulement jusqu'à l'ouverture du socket.
   * `null` : tout va bien, ou la page dort (une veille n'est pas un blocage).
   * C'est sur lui que l'écran compte ses 30 s (`espace-connexion-bloquee.ts`).
   */
  private sansLiaison: number | null = null;
  private surLiaison = new Set<() => void>();

  ouvrir(): void {
    if (this.ouvert) return;
    this.ouvert = true;
    // Page hors de l'écran : le canal se ferme, et le retour le rouvre — les
    // écrans de l'espace se rechargent déjà à chaque retour « en ligne ».
    surLaVeille((enVeille) => (enVeille ? this.dormir() : this.connecter()));
    this.connecter();
  }

  /** L'instant depuis lequel l'espace attend sa liaison, ou `null`. */
  sansLiaisonDepuis(): number | null {
    return this.sansLiaison;
  }

  surChangementDeLiaison(abonne: () => void): () => void {
    this.surLiaison.add(abonne);
    return () => this.surLiaison.delete(abonne);
  }

  private poserSansLiaison(instant: number | null): void {
    if (this.sansLiaison === instant) return;
    this.sansLiaison = instant;
    for (const abonne of this.surLiaison) abonne();
  }

  /**
   * « RÉESSAYER » : la tentative en cours est abandonnée (elle peut être
   * suspendue par le navigateur sans jamais échouer), le repli est oublié, et
   * une connexion neuve part tout de suite. Le compte des 30 s repart de zéro.
   */
  reessayer(): void {
    this.abandonnerLeSocket();
    this.annulerLesMinuteurs();
    this.tentatives = 0;
    this.poserSansLiaison(Date.now());
    this.poserEtat('connexion');
    this.connecter();
  }

  /** Détache les gestionnaires AVANT de fermer : l'ancien `onclose` ne relancera rien. */
  private abandonnerLeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    try {
      socket.close(1000);
    } catch {
      /* déjà fermé */
    }
  }

  private annulerLesMinuteurs(): void {
    if (this.minuteurOuverture !== null) window.clearTimeout(this.minuteurOuverture);
    if (this.minuteurReprise !== null) window.clearTimeout(this.minuteurReprise);
    this.minuteurOuverture = null;
    this.minuteurReprise = null;
  }

  /** Après une coupure : la tentative suivante attend un repli croissant et plafonné. */
  private planifierLaReprise(): void {
    if (!this.ouvert || estEnVeille() || this.minuteurReprise !== null) return;
    const delai = repliDuCanal(this.tentatives);
    this.tentatives += 1;
    this.minuteurReprise = window.setTimeout(() => {
      this.minuteurReprise = null;
      this.connecter();
    }, delai);
  }

  /** La veille (`lib/veille.ts`) : une fermeture VOULUE, jamais dite « coupée ». */
  private dormir(): void {
    if (this.minuteur !== null) window.clearInterval(this.minuteur);
    this.minuteur = null;
    this.annulerLesMinuteurs();
    this.abandonnerLeSocket();
    this.tentatives = 0;
    this.poserEtat('connexion');
    this.poserSansLiaison(null);
  }

  private connecter(): void {
    if (estEnVeille()) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    if (this.sansLiaison === null) this.poserSansLiaison(Date.now());
    const protocole = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocole}//${location.host}/ws`);
    this.socket = socket;
    this.poserEtat('connexion');

    /*
     * UNE OUVERTURE QUI NE S'ACHÈVE PAS EST ABANDONNÉE. Le battement ne
     * regarde qu'un canal OUVERT : une tentative suspendue par le navigateur
     * (réseau, antivirus, connexion précédente restée pendue) laissait l'écran
     * sur « Connexion à votre espace… » sans fin. Passé le plafond, elle est
     * détachée, fermée, et une neuve part après le repli.
     */
    const ouverteA = Date.now();
    const surveiller = (delai: number) => {
      this.minuteurOuverture = window.setTimeout(() => {
        this.minuteurOuverture = null;
        if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
        const reste = delaiRestantAvantAbandonDeLOuverture(ouverteA, Date.now());
        if (reste > 0) return surveiller(reste);
        this.abandonnerLeSocket();
        this.poserEtat('coupe');
        this.planifierLaReprise();
      }, delai);
    };
    surveiller(DELAI_OUVERTURE_DU_CANAL);

    socket.onopen = () => {
      if (this.minuteurOuverture !== null) window.clearTimeout(this.minuteurOuverture);
      this.minuteurOuverture = null;
      this.tentatives = 0;
      this.dernierSigne = Date.now();
      this.poserEtat('en-ligne');
      this.envoyer({ type: 'hello', protocol: 1 });
    };
    socket.onmessage = (message) => {
      this.dernierSigne = Date.now();
      let event: ServerEvent & { id?: string; ok?: boolean; data?: unknown; error?: string };
      try {
        event = JSON.parse(message.data as string);
      } catch {
        return;
      }
      if (event.type === 'ack' && event.id) {
        const attente = this.attentes.get(event.id);
        if (attente) {
          this.attentes.delete(event.id);
          if (event.ok) attente.resoudre(event.data);
          else attente.rejeter(new Error(event.error ?? t('Action refusée.')));
        }
        return;
      }
      // L'IDENTITÉ EST REVENUE : la liaison est complète, le compte des 30 s s'arrête.
      if (event.type === 'ready.client') this.poserSansLiaison(null);
      for (const ecouteur of this.ecouteurs) ecouteur(event);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      if (this.minuteurOuverture !== null) window.clearTimeout(this.minuteurOuverture);
      this.minuteurOuverture = null;
      this.socket = null;
      this.poserEtat('coupe');
      if (this.sansLiaison === null) this.poserSansLiaison(Date.now());
      this.planifierLaReprise();
    };
    socket.onerror = () => socket.close();

    if (this.minuteur === null) {
      this.minuteur = window.setInterval(() => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        /*
         * LE CLIENT VÉRIFIE LUI-MÊME QUE SON CANAL RÉPOND ENCORE. Un canal
         * zombie — ouvert selon le navigateur, muet en réalité — laisserait
         * l'écran croire qu'il est à jour. Le « ping » sert de preuve de vie.
         */
        this.envoyer({ type: 'ping' });
        if (Date.now() - this.dernierSigne > SILENCE_TOLERE_MS) {
          this.poserEtat('coupe');
          this.socket.close();
        }
      }, BATTEMENT_MS);
    }
  }

  private poserEtat(etat: EtatCanalEspace): void {
    if (this.etatCourant === etat) return;
    this.etatCourant = etat;
    for (const abonne of this.surEtat) abonne(etat);
  }

  etat(): EtatCanalEspace {
    return this.etatCourant;
  }

  surChangementDEtat(abonne: (etat: EtatCanalEspace) => void): () => void {
    this.surEtat.add(abonne);
    return () => this.surEtat.delete(abonne);
  }

  ecouter(ecouteur: Ecouteur): () => void {
    this.ecouteurs.add(ecouteur);
    return () => this.ecouteurs.delete(ecouteur);
  }

  envoyer(cmd: ClientCommand): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ cmd }));
  }

  /** Une commande dont on attend la réponse — un refus se lit, il ne se devine pas. */
  demander<T = any>(cmd: ClientCommand, delaiMs = 30000): Promise<T> {
    return new Promise<T>((resoudre, rejeter) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        rejeter(new Error(t('Pas encore connecté.')));
        return;
      }
      const id = Math.random().toString(36).slice(2);
      this.attentes.set(id, { resoudre, rejeter });
      this.socket.send(JSON.stringify({ id, cmd }));
      window.setTimeout(() => {
        if (!this.attentes.has(id)) return;
        this.attentes.delete(id);
        rejeter(new Error(t('Le serveur ne répond pas.')));
      }, delaiMs);
    });
  }
}

export const canalEspace = new CanalEspace();

/**
 * L'ENVOI D'UN FICHIER, AVEC SA VRAIE PROGRESSION.
 *
 * `fetch` ne dit rien de l'avancement d'un téléversement : une barre nourrie
 * par lui serait une animation décorative. On passe donc par `XMLHttpRequest`,
 * dont l'événement `upload.onprogress` donne les octets réellement partis —
 * c'est ce que la barre affiche, et c'est ce qu'un contrôle peut vérifier.
 */
export function envoyerLeFichier(
  fichier: File,
  projectId: string,
  surProgression: (part: number) => void,
): Promise<{ id: string; name: string; mime: string; size: number }> {
  return new Promise((resoudre, rejeter) => {
    const requete = new XMLHttpRequest();
    requete.open('POST', `/api/upload?project=${encodeURIComponent(projectId)}`);
    requete.setRequestHeader('content-type', fichier.type || 'application/octet-stream');
    requete.setRequestHeader('x-file-name', encodeURIComponent(fichier.name));
    requete.upload.onprogress = (e) => {
      if (e.lengthComputable) surProgression(e.loaded / e.total);
    };
    requete.onload = () => {
      if (requete.status < 200 || requete.status >= 300) {
        rejeter(new Error(t("L'envoi a échoué ({statut}).", { statut: requete.status })));
        return;
      }
      try {
        const corps = JSON.parse(requete.responseText);
        surProgression(1);
        resoudre(corps.attachment);
      } catch {
        rejeter(new Error(t("La réponse du serveur n'est pas lisible.")));
      }
    };
    requete.onerror = () => rejeter(new Error(t("L'envoi a échoué.")));
    requete.onabort = () => rejeter(new Error(t('Envoi interrompu.')));
    requete.send(fichier);
  });
}

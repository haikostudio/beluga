import { ServerEvent } from '@beluga/shared';
import { log } from './logger.js';

type Sink = (event: ServerEvent) => void;

const sinks = new Set<Sink>();

/** Le démon est la source de vérité : l'interface s'abonne, il pousse. */
export const bus = {
  subscribe(sink: Sink): () => void {
    sinks.add(sink);
    return () => sinks.delete(sink);
  },
  emit(event: ServerEvent): void {
    for (const sink of sinks) {
      try {
        sink(event);
      } catch (err) {
        log.error('diffusion impossible vers un client', err);
      }
    }
  },
  /*
   * Un message passager. Le `motif` est facultatif : sans lui, le niveau
   * tranche (un refus se dit, une réussite se tait — `genreDuMessage`,
   * `shared/src/notification-tri.ts`). On le nomme là où le niveau seul
   * mentirait : une tâche terminée est un « success » qui doit s'afficher, un
   * agent coupé d'autorité un « info » qui doit s'afficher aussi.
   */
  toast(level: 'info' | 'success' | 'warning' | 'error', text: string, cardId?: string, motif?: string): void {
    bus.emit({ type: 'toast', level, text, cardId, motif });
  },
  clientCount(): number {
    return sinks.size;
  },
};

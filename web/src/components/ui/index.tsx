import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Le socle visuel, posé AVANT les écrans (PLAN §17, §30). Les composants sont
 * copiés dans le projet, pas importés d'une boîte noire : on les possède.
 */

/* ----------------------------- Bouton ----------------------------- */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-raised text-text',
        ghost: 'hover:bg-raised text-muted hover:text-text',
        subtle: 'bg-raised text-text hover:bg-border',
        danger: 'bg-danger text-white hover:opacity-90',
        success: 'bg-success text-white hover:opacity-90',
      },
      size: {
        sm: 'h-7 px-2.5 text-[13.5px]',
        md: 'h-8 px-3 text-[14.5px]',
        lg: 'h-9 px-4 text-[14.5px]',
        icon: 'h-7 w-7',
        'icon-sm': 'h-6 w-6',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

/* ----------------------------- Champs ----------------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-border bg-raised px-3 text-[14.5px] text-text placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-md border border-border bg-raised px-3 py-2.5 text-[14.5px] text-text placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[12.5px] font-medium text-muted', className)} {...props} />;
}

/* ----------------------------- Badge ------------------------------ */

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-raised text-muted',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        danger: 'border-danger/30 bg-danger/10 text-danger',
        strong: 'border-transparent bg-accent text-accent-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ----------------------------- Onglets ---------------------------- */

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex h-9 items-center gap-0.5 rounded-md bg-surface p-1', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-7 items-center justify-center gap-1.5 rounded px-3 text-[13.5px] font-medium text-muted transition-colors hover:text-text data-[state=active]:bg-raised data-[state=active]:text-text',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = TabsPrimitive.Content;

/* ----------------------------- Dialogue --------------------------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-24px))] max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-2xl animate-slide-up',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded p-1 text-faint hover:bg-raised hover:text-text">
          <X className="h-3.5 w-3.5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Le tiroir : il monte depuis le bas et occupe presque tout l'écran. On y
 * travaille, contrairement à une fenêtre qui interrompt.
 */
export function Drawer({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  /*
   * Le tiroir se referme en le tirant vers le bas, comme une vraie feuille :
   * on suit le doigt, et on ne referme que si le geste est franc.
   */
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) setDecalage(0);
  }, [open]);

  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      depart.current = event.clientY;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (depart.current === null) return;
      setDecalage(Math.max(0, event.clientY - depart.current));
    },
    onPointerUp: () => {
      if (depart.current === null) return;
      depart.current = null;
      setDecalage((valeur) => {
        if (valeur > 110) onClose();
        return 0;
      });
    },
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content
          className={cn(
            // Sur téléphone il occupe toute la largeur ; sur grand écran il se
            // pose au centre, plafonné à 960 px : au-delà, les lignes de texte
            // deviennent trop longues pour être lues confortablement.
            'fixed inset-x-0 z-50 mx-auto flex w-full max-w-[960px] flex-col overflow-hidden border-border bg-bg shadow-2xl',
            'rounded-t-xl border-t sm:rounded-t-2xl sm:border-x',
            'data-[state=open]:animate-slide-up',
            className,
          )}
          style={{
            // Collé au bas de la fenêtre, et remonté quand le clavier s'ouvre.
            top: '8%',
            bottom: 'var(--clavier, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            transform: decalage ? `translateY(${decalage}px)` : undefined,
            transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
          }}
        >
          {/* La poignée : on la tire vers le bas pour refermer. */}
          <div
            {...poignee}
            onPointerCancel={poignee.onPointerUp}
            className="flex shrink-0 cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
          >
            <DialogPrimitive.Close className="h-1 w-10 rounded-full bg-border transition-colors hover:bg-muted" />
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Le panneau latéral : il glisse depuis la GAUCHE par-dessus l'écran en cours,
 * un voile derrière. C'est un choix qu'on fait au passage, pas une destination :
 * on le referme en touchant le voile, en tirant sa poignée vers la gauche, ou
 * en choisissant ce qu'on était venu chercher.
 */
export function SidePanel({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Nommé pour les lecteurs d'écran : le panneau n'affiche pas de titre. */
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [decalage, setDecalage] = React.useState(0);
  const depart = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) setDecalage(0);
  }, [open]);

  /*
   * Le glissement part de la POIGNÉE du bord droit, jamais du contenu : la
   * liste des projets se range déjà au doigt, et les deux gestes se
   * marcheraient dessus.
   */
  const poignee = {
    onPointerDown: (event: React.PointerEvent) => {
      depart.current = event.clientX;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (depart.current === null) return;
      setDecalage(Math.min(0, event.clientX - depart.current));
    },
    onPointerUp: () => {
      if (depart.current === null) return;
      depart.current = null;
      setDecalage((valeur) => {
        if (valeur < -70) onClose();
        return 0;
      });
    },
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content
          aria-label={title}
          className={cn(
            'fixed left-0 top-0 z-50 flex w-[min(320px,86vw)] flex-col overflow-hidden border-r border-border bg-bg shadow-2xl',
            'data-[state=open]:animate-slide-in-left',
            className,
          )}
          style={{
            // La hauteur mesurée en direct : l'unité dvh seule laisse une bande
            // vide en bas sur téléphone.
            height: 'var(--hauteur-app, 100dvh)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            transform: decalage ? `translateX(${decalage}px)` : undefined,
            transition: depart.current === null ? 'transform 180ms ease-out' : undefined,
          }}
        >
          {/* La bande de droite est réservée à la poignée : sans ce retrait, le
              geste recouvrirait les petits boutons au bout des lignes. */}
          <div className="flex min-h-0 flex-1 overflow-hidden pr-3">{children}</div>
          <div
            {...poignee}
            onPointerCancel={poignee.onPointerUp}
            aria-hidden
            className="absolute inset-y-0 right-0 flex w-3 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span className="h-10 w-1 rounded-full bg-border" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-[15.5px] font-semibold text-text', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-1 text-[14px] text-muted', className)} {...props} />;
}

/* ----------------------------- Infobulle -------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={280}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-[280px] rounded-md border border-border bg-raised px-2 py-1.5 text-[13px] text-text shadow-xl animate-fade-in"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ----------------------------- Menu ------------------------------- */

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      {/* Sur téléphone, un menu déroulant devient un TIROIR : posé en bas, sur
          toute la largeur, avec sa poignée. Les classes « ! » sont nécessaires
          pour couvrir le placement calculé par la bibliothèque. */}
      <DropdownPrimitive.Content
        sideOffset={4}
        className={cn(
          'z-50 min-w-[170px] overflow-hidden border border-border bg-surface p-1 shadow-xl animate-fade-in',
          'max-sm:w-full max-sm:max-h-[72dvh] max-sm:overflow-y-auto max-sm:rounded-t-xl',
          'max-sm:border-x-0 max-sm:border-b-0 max-sm:p-2 max-sm:pb-[calc(10px+env(safe-area-inset-bottom))]',
          'max-sm:animate-slide-up sm:rounded-md',
          className,
        )}
        {...props}
      >
        <div className="mb-1.5 flex justify-center sm:hidden">
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>
        {props.children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[14px] text-muted outline-none data-[highlighted]:bg-raised data-[highlighted]:text-text',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-2 py-1 text-[12px] uppercase tracking-wide text-faint', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;
}

/* ----------------------------- Divers ----------------------------- */

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors data-[state=checked]:bg-accent data-[state=unchecked]:bg-raised',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-[13px] w-[13px] rounded-full bg-muted shadow transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-accent-fg data-[state=unchecked]:translate-x-[2px]" />
    </SwitchPrimitive.Root>
  );
}

export function Separator({ className, ...props }: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return <SeparatorPrimitive.Root className={cn('bg-border', 'h-px w-full', className)} {...props} />;
}

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full [&>div]:!block">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-1.5 touch-none select-none p-px transition-colors"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

/** Jauge maison, écrite aux mêmes règles que la bibliothèque (PLAN §17). */
export function Gauge({
  value,
  tone = 'auto',
  className,
  height = 'h-1.5',
}: {
  value: number;
  tone?: 'auto' | 'neutral';
  className?: string;
  height?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    tone === 'neutral'
      ? 'bg-muted'
      : pct >= 90
        ? 'bg-danger'
        : pct >= 70
          ? 'bg-warning'
          : 'bg-muted';
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-raised', height, className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Voyant d'état : la couleur ne sert qu'à DIRE quelque chose. */
export function Dot({ tone, pulse }: { tone: 'idle' | 'running' | 'done' | 'failed' | 'waiting'; pulse?: boolean }) {
  const color =
    tone === 'running'
      ? 'bg-success'
      : tone === 'failed'
        ? 'bg-danger'
        : tone === 'waiting'
          ? 'bg-warning'
          : tone === 'done'
            ? 'bg-muted'
            : 'bg-faint';
  return <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', color, pulse && 'animate-pulse-soft')} />;
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-[14.5px] font-medium text-muted">{title}</p>
      {hint ? <p className="max-w-[260px] text-[13.5px] text-faint">{hint}</p> : null}
    </div>
  );
}

/* ----------------------- Demande et confirmation ------------------ */

/**
 * Remplace les fenêtres du navigateur : même vocabulaire visuel partout,
 * jamais d'alerte native (elle casse le thème et bloque la page).
 */
export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Valider',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(defaultValue);
  React.useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-16px))]">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) {
              onConfirm(value.trim());
              onClose();
            }
          }}
          className="mt-3"
        />
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!value.trim()}
            onClick={() => {
              onConfirm(value.trim());
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-16px))]">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={danger ? 'danger' : 'default'}
            size="sm"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Optional framework-free Recovery Deck editor.
 *
 * The component renders one already-random deck, permits local reordering, and
 * can request a completely fresh CSPRNG deck. It never persists or logs card
 * order and has no account, authentication, or storage policy.
 */

import { generateRecoveryDeck } from "./crypto-backend";

export const RECOVERY_DECK_UI_CARD_IDS = Object.freeze([
  "AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS",
  "AH", "2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH", "QH", "KH",
  "AD", "2D", "3D", "4D", "5D", "6D", "7D", "8D", "9D", "10D", "JD", "QD", "KD",
  "AC", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C", "JC", "QC", "KC",
]) as readonly string[];

const CARD_SET = new Set(RECOVERY_DECK_UI_CARD_IDS);
const DEFAULT_STYLE_ID = "voideddev-recovery-deck-default-styles";
let instanceCount = 0;

type SuitCode = "S" | "H" | "D" | "C";
export type RecoveryDeckUIChangeReason = "shuffle" | "reorder";
export type RecoveryDeckUIPresentation = "modal" | "inline";

const SUITS: Record<
  SuitCode,
  { name: string; symbol: string; color: "black" | "red" }
> = {
  S: { name: "Spades", symbol: "♠", color: "black" },
  H: { name: "Hearts", symbol: "♥", color: "red" },
  D: { name: "Diamonds", symbol: "♦", color: "red" },
  C: { name: "Clubs", symbol: "♣", color: "black" },
};

const RANK_NAMES: Record<string, string> = {
  A: "Ace",
  J: "Jack",
  Q: "Queen",
  K: "King",
};

export interface RecoveryDeckUICard {
  id: string;
  rank: string;
  rankName: string;
  suit: SuitCode;
  suitName: string;
  suitSymbol: string;
  color: "black" | "red";
}

export interface RecoveryDeckUICardRenderState {
  position: number;
  selected: boolean;
  presentation: RecoveryDeckUIPresentation;
}

export interface RecoveryDeckUIClassNames {
  root: string;
  overlay: string;
  inline: string;
  panel: string;
  header: string;
  title: string;
  closeButton: string;
  description: string;
  warning: string;
  hint: string;
  deckGrid: string;
  card: string;
  selectedCard: string;
  cardPosition: string;
  cardRank: string;
  cardSuit: string;
  actions: string;
  button: string;
  shuffleButton: string;
  confirmButton: string;
  error: string;
}

export interface RecoveryDeckUILabels {
  title: string;
  description: string;
  warning: string;
  reorderHint: string;
  shuffle: string;
  shuffling: string;
  confirm: string;
  close: string;
  invalidDeck: string;
  shuffleError: string;
  confirmError: string;
}

export interface RecoveryDeckUIOptions {
  /** Optional initial valid permutation. Omit to generate one securely on open. */
  deck?: readonly string[];
  /** Additional class placed on the component root for theme scoping. */
  rootClassName?: string;
  /** Additional classes appended to stable Voided classes. */
  classNames?: Partial<RecoveryDeckUIClassNames>;
  /** Override any default copy. */
  labels?: Partial<RecoveryDeckUILabels>;
  /** Inject minimal structural defaults once. Disable for fully owned CSS. */
  injectDefaultStyles?: boolean;
  /** Allow drag, click-to-move, and keyboard reordering. */
  allowReorder?: boolean;
  /** Show the fresh secure shuffle action. */
  showShuffle?: boolean;
  /** Close modal presentation when the backdrop is selected. */
  closeOnBackdrop?: boolean;
  /** Override secure generation for a controlled integration or test. */
  shuffleDeck?: () => Promise<string[]>;
  /** Optional custom contents inside each behavior-owning card button. */
  renderCardContent?: (
    card: RecoveryDeckUICard,
    state: RecoveryDeckUICardRenderState,
    documentRef: Document,
  ) => Node;
  /** Receives a transient copy after a shuffle or reorder. */
  onChange?: (
    deck: string[],
    reason: RecoveryDeckUIChangeReason,
  ) => void | Promise<void>;
  /** If provided, renders a confirmation action and receives the final deck. */
  onConfirm?: (deck: string[]) => void | Promise<void>;
  /** Defaults to true for show() and false for mount(). */
  closeOnConfirm?: boolean;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_CLASSES: RecoveryDeckUIClassNames = {
  root: "voideddev-recovery-root",
  overlay: "voideddev-recovery-overlay",
  inline: "voideddev-recovery-inline",
  panel: "voideddev-recovery-panel",
  header: "voideddev-recovery-header",
  title: "voideddev-recovery-title",
  closeButton: "voideddev-recovery-close",
  description: "voideddev-recovery-description",
  warning: "voideddev-recovery-warning",
  hint: "voideddev-recovery-hint",
  deckGrid: "voideddev-recovery-deck-grid",
  card: "voideddev-recovery-card",
  selectedCard: "voideddev-recovery-card-selected",
  cardPosition: "voideddev-recovery-card-position",
  cardRank: "voideddev-recovery-card-rank",
  cardSuit: "voideddev-recovery-card-suit",
  actions: "voideddev-recovery-actions",
  button: "voideddev-recovery-button",
  shuffleButton: "voideddev-recovery-shuffle",
  confirmButton: "voideddev-recovery-confirm",
  error: "voideddev-recovery-error",
};

const DEFAULT_LABELS: RecoveryDeckUILabels = {
  title: "Recovery Deck",
  description:
    "This exact 52-card order is the recovery secret. Record it physically before continuing.",
  warning:
    "Avoid screenshots, photographs, clipboard tools, cloud notes, and shared printers.",
  reorderHint:
    "Drag a card, select one card and then its destination, or use the arrow keys.",
  shuffle: "Shuffle",
  shuffling: "Shuffling…",
  confirm: "Use this deck",
  close: "Close",
  invalidDeck: "The deck must contain every standard card exactly once.",
  shuffleError: "A fresh secure deck could not be generated.",
  confirmError: "The deck could not be confirmed. Please try again.",
};

/**
 * Minimal layout defaults. They are placed in a low-priority cascade layer so
 * normal application CSS wins regardless of injection order.
 */
export const RECOVERY_DECK_DEFAULT_CSS = String.raw`
@layer voideddev-recovery-defaults {
  .voideddev-recovery-root {
    --voided-recovery-surface: #fff;
    --voided-recovery-text: #111;
    --voided-recovery-muted: #666;
    --voided-recovery-border: #ccc;
    --voided-recovery-overlay: rgba(0, 0, 0, 0.55);
    --voided-recovery-red-suit: #a11;
    --voided-recovery-radius: 8px;
    box-sizing: border-box;
    color: var(--voided-recovery-text);
    font: inherit;
  }
  .voideddev-recovery-root *, .voideddev-recovery-root *::before, .voideddev-recovery-root *::after { box-sizing: border-box; }
  .voideddev-recovery-overlay { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; overflow: auto; background: var(--voided-recovery-overlay); }
  .voideddev-recovery-inline { width: 100%; }
  .voideddev-recovery-panel { width: min(1040px, 100%); max-height: calc(100vh - 40px); overflow: auto; padding: 20px; border: 1px solid var(--voided-recovery-border); border-radius: var(--voided-recovery-radius); background: var(--voided-recovery-surface); }
  .voideddev-recovery-inline > .voideddev-recovery-panel { max-height: none; }
  .voideddev-recovery-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .voideddev-recovery-title { margin: 0; font: inherit; font-size: 1.4rem; font-weight: 700; }
  .voideddev-recovery-close { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
  .voideddev-recovery-description, .voideddev-recovery-warning, .voideddev-recovery-hint { margin: 10px 0; line-height: 1.45; }
  .voideddev-recovery-warning { font-weight: 600; }
  .voideddev-recovery-hint { color: var(--voided-recovery-muted); font-size: 0.9rem; }
  .voideddev-recovery-deck-grid { display: grid; grid-template-columns: repeat(13, minmax(46px, 1fr)); gap: 6px; margin-top: 16px; }
  .voideddev-recovery-card { position: relative; min-width: 0; aspect-ratio: 5 / 7; display: grid; place-items: center; padding: 6px 3px; border: 1px solid var(--voided-recovery-border); border-radius: var(--voided-recovery-radius); background: var(--voided-recovery-surface); color: inherit; cursor: grab; font: inherit; }
  .voideddev-recovery-card:active { cursor: grabbing; }
  .voideddev-recovery-card[data-voideddev-color="red"] { color: var(--voided-recovery-red-suit); }
  .voideddev-recovery-card-selected { outline: 2px solid currentColor; outline-offset: 1px; }
  .voideddev-recovery-card-position { position: absolute; top: 4px; left: 5px; color: var(--voided-recovery-muted); font-size: 0.65rem; }
  .voideddev-recovery-card-rank { align-self: end; font-weight: 700; }
  .voideddev-recovery-card-suit { align-self: start; font-size: 1.25rem; line-height: 1; }
  .voideddev-recovery-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .voideddev-recovery-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--voided-recovery-border); border-radius: var(--voided-recovery-radius); background: var(--voided-recovery-surface); color: inherit; cursor: pointer; font: inherit; }
  .voideddev-recovery-button:disabled { cursor: not-allowed; opacity: 0.5; }
  .voideddev-recovery-confirm { border-color: currentColor; font-weight: 700; }
  .voideddev-recovery-error { min-height: 1.4em; margin: 10px 0 0; color: var(--voided-recovery-red-suit); font-weight: 600; }
  .voideddev-recovery-root :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  @media (max-width: 760px) { .voideddev-recovery-deck-grid { grid-template-columns: repeat(7, minmax(42px, 1fr)); } }
  @media (max-width: 480px) {
    .voideddev-recovery-overlay { padding: 0; place-items: stretch; }
    .voideddev-recovery-overlay > .voideddev-recovery-panel { min-height: 100vh; max-height: none; border: 0; border-radius: 0; }
    .voideddev-recovery-deck-grid { grid-template-columns: repeat(4, minmax(44px, 1fr)); }
  }
}
`.trim();

function mergeClasses(
  overrides: Partial<RecoveryDeckUIClassNames> | undefined,
): RecoveryDeckUIClassNames {
  const merged = { ...DEFAULT_CLASSES };
  if (!overrides) return merged;
  for (const key of Object.keys(overrides) as Array<keyof RecoveryDeckUIClassNames>) {
    const custom = overrides[key]?.trim();
    if (custom) merged[key] = `${merged[key]} ${custom}`;
  }
  return merged;
}

function addClass(base: string, extra?: string): string {
  const custom = extra?.trim();
  return custom ? `${base} ${custom}` : base;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tagName: K,
  className: string,
  component: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.dataset.voideddevComponent = component;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createButton(
  documentRef: Document,
  className: string,
  component: string,
  action: string,
  text: string,
): HTMLButtonElement {
  const button = createElement(documentRef, "button", className, component, text);
  button.type = "button";
  button.dataset.voideddevAction = action;
  return button;
}

function parseCard(id: string): RecoveryDeckUICard {
  if (!CARD_SET.has(id)) throw new Error("Unknown canonical Recovery Deck card");
  const suit = id.slice(-1) as SuitCode;
  const rank = id.slice(0, -1);
  const suitInfo = SUITS[suit];
  return {
    id,
    rank,
    rankName: RANK_NAMES[rank] ?? rank,
    suit,
    suitName: suitInfo.name,
    suitSymbol: suitInfo.symbol,
    color: suitInfo.color,
  };
}

export function validateRecoveryDeckUICards(deck: readonly string[]): boolean {
  if (deck.length !== RECOVERY_DECK_UI_CARD_IDS.length) return false;
  const seen = new Set<string>();
  for (const id of deck) {
    if (!CARD_SET.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return seen.size === RECOVERY_DECK_UI_CARD_IDS.length;
}

/** Return a reordered copy without mutating the caller's deck. */
export function moveRecoveryDeckUICard(
  deck: readonly string[],
  from: number,
  to: number,
): string[] {
  if (!validateRecoveryDeckUICards(deck)) {
    throw new Error("Cannot reorder an invalid Recovery Deck");
  }
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= deck.length ||
    to >= deck.length
  ) {
    throw new Error("Recovery Deck card positions are out of range");
  }
  const reordered = [...deck];
  const [card] = reordered.splice(from, 1);
  reordered.splice(to, 0, card);
  return reordered;
}

export function installRecoveryDeckDefaultStyles(
  documentRef: Document = document,
): void {
  if (documentRef.getElementById(DEFAULT_STYLE_ID)) return;
  const style = documentRef.createElement("style");
  style.id = DEFAULT_STYLE_ID;
  style.dataset.voideddevComponent = "recovery-deck-default-styles";
  style.textContent = RECOVERY_DECK_DEFAULT_CSS;
  documentRef.head.append(style);
}

/**
 * One generic deck component. Use show() for a modal or mount(container) for
 * inline/full-page composition.
 */
export class VoidedRecoveryDeckUI {
  private deck: string[];
  private readonly classes: RecoveryDeckUIClassNames;
  private readonly labels: RecoveryDeckUILabels;
  private readonly options: RecoveryDeckUIOptions;
  private readonly shuffleDeck: () => Promise<string[]>;
  private root: HTMLElement | null = null;
  private grid: HTMLElement | null = null;
  private error: HTMLElement | null = null;
  private shuffleButton: HTMLButtonElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;
  private documentRef: Document | null = null;
  private presentation: RecoveryDeckUIPresentation = "modal";
  private selectedIndex: number | null = null;
  private dragIndex: number | null = null;
  private busy = false;
  private previousBodyOverflow: string | null = null;
  private lifecycleGeneration = 0;

  constructor(options: RecoveryDeckUIOptions = {}) {
    if (options.deck && !validateRecoveryDeckUICards(options.deck)) {
      throw new Error("Recovery Deck UI requires exactly 52 unique canonical cards");
    }
    this.deck = options.deck ? [...options.deck] : [];
    this.classes = mergeClasses(options.classNames);
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
    this.options = options;
    this.shuffleDeck = options.shuffleDeck ?? generateRecoveryDeck;
  }

  /** Open the component as a modal. */
  async show(parent?: HTMLElement): Promise<void> {
    if (this.root) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    const documentRef = parent?.ownerDocument ?? document;
    await this.ensureDeck();
    if (lifecycleGeneration !== this.lifecycleGeneration) return;
    const root = createElement(
      documentRef,
      "div",
      addClass(`${this.classes.root} ${this.classes.overlay}`, this.options.rootClassName),
      "recovery-root",
    );
    root.dataset.voideddevPresentation = "modal";
    root.setAttribute("role", "presentation");
    const panel = this.buildPanel(documentRef, "modal");
    root.append(panel);
    const mountPoint = parent ?? documentRef.body;
    mountPoint.append(root);
    this.attach(root, documentRef, "modal");
    if (mountPoint === documentRef.body) {
      this.previousBodyOverflow = documentRef.body.style.overflow;
      documentRef.body.style.overflow = "hidden";
    }
    documentRef.addEventListener("keydown", this.handleDocumentKeydown);
    root.addEventListener("click", this.handleBackdropClick);
    this.focusFirstAction();
  }

  /** Mount the same component inline; the container may be a full page shell. */
  async mount(container: HTMLElement): Promise<void> {
    if (this.root) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    await this.ensureDeck();
    if (lifecycleGeneration !== this.lifecycleGeneration) return;
    const documentRef = container.ownerDocument;
    this.presentation = "inline";
    const root = createElement(
      documentRef,
      "section",
      addClass(`${this.classes.root} ${this.classes.inline}`, this.options.rootClassName),
      "recovery-root",
    );
    root.dataset.voideddevPresentation = "inline";
    const panel = this.buildPanel(documentRef, "inline");
    root.append(panel);
    container.append(root);
    this.attach(root, documentRef, "inline");
    this.focusFirstAction();
  }

  /** Remove the component and clear its retained card-order array. */
  unmount(notify = true): void {
    this.lifecycleGeneration++;
    if (this.documentRef) {
      this.documentRef.removeEventListener("keydown", this.handleDocumentKeydown);
    }
    this.root?.removeEventListener("click", this.handleBackdropClick);
    this.root?.replaceChildren();
    this.root?.remove();
    if (this.previousBodyOverflow !== null && this.documentRef?.body) {
      this.documentRef.body.style.overflow = this.previousBodyOverflow;
    }
    this.deck.fill("");
    this.deck = [];
    this.root = null;
    this.grid = null;
    this.error = null;
    this.shuffleButton = null;
    this.confirmButton = null;
    this.documentRef = null;
    this.previousBodyOverflow = null;
    this.selectedIndex = null;
    this.dragIndex = null;
    this.busy = false;
    if (notify) this.options.onClose?.();
  }

  destroy(): void {
    this.unmount(false);
  }

  private async ensureDeck(): Promise<void> {
    if (validateRecoveryDeckUICards(this.deck)) return;
    await this.replaceWithFreshDeck(false);
  }

  private buildPanel(
    documentRef: Document,
    presentation: RecoveryDeckUIPresentation,
  ): HTMLElement {
    if (this.options.injectDefaultStyles !== false) {
      installRecoveryDeckDefaultStyles(documentRef);
    }
    const panel = createElement(
      documentRef,
      "div",
      this.classes.panel,
      "recovery-panel",
    );
    const header = createElement(
      documentRef,
      "header",
      this.classes.header,
      "recovery-header",
    );
    const title = createElement(
      documentRef,
      "h2",
      this.classes.title,
      "recovery-title",
      this.labels.title,
    );
    title.id = `voideddev-recovery-title-${++instanceCount}`;
    header.append(title);
    if (presentation === "modal") {
      const close = createButton(
        documentRef,
        this.classes.closeButton,
        "recovery-close",
        "close",
        this.labels.close,
      );
      close.setAttribute("aria-label", this.labels.close);
      close.addEventListener("click", () => this.unmount());
      header.append(close);
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
    } else {
      panel.setAttribute("role", "region");
    }
    panel.setAttribute("aria-labelledby", title.id);

    const description = createElement(
      documentRef,
      "p",
      this.classes.description,
      "recovery-description",
      this.labels.description,
    );
    const warning = createElement(
      documentRef,
      "p",
      this.classes.warning,
      "recovery-warning",
      this.labels.warning,
    );
    warning.setAttribute("role", "note");
    const hint = createElement(
      documentRef,
      "p",
      this.classes.hint,
      "recovery-reorder-hint",
      this.options.allowReorder === false ? "" : this.labels.reorderHint,
    );
    this.grid = createElement(
      documentRef,
      "div",
      this.classes.deckGrid,
      "recovery-deck-grid",
    );
    this.error = createElement(
      documentRef,
      "p",
      this.classes.error,
      "recovery-error",
    );
    this.error.setAttribute("role", "alert");
    const actions = createElement(
      documentRef,
      "div",
      this.classes.actions,
      "recovery-actions",
    );
    if (this.options.showShuffle !== false) {
      this.shuffleButton = createButton(
        documentRef,
        `${this.classes.button} ${this.classes.shuffleButton}`,
        "recovery-shuffle",
        "shuffle",
        this.labels.shuffle,
      );
      this.shuffleButton.addEventListener("click", () => {
        void this.replaceWithFreshDeck(true);
      });
      actions.append(this.shuffleButton);
    }
    if (this.options.onConfirm) {
      this.confirmButton = createButton(
        documentRef,
        `${this.classes.button} ${this.classes.confirmButton}`,
        "recovery-confirm",
        "confirm",
        this.labels.confirm,
      );
      this.confirmButton.addEventListener("click", () => void this.confirm());
      actions.append(this.confirmButton);
    }
    panel.append(header, description, warning);
    if (hint.textContent) panel.append(hint);
    panel.append(this.grid, this.error, actions);
    this.renderDeck();
    return panel;
  }

  private attach(
    root: HTMLElement,
    documentRef: Document,
    presentation: RecoveryDeckUIPresentation,
  ): void {
    this.root = root;
    this.documentRef = documentRef;
    this.presentation = presentation;
  }

  private renderDeck(focusPosition?: number): void {
    if (!this.grid) return;
    const documentRef = this.grid.ownerDocument;
    this.grid.replaceChildren();
    for (const [position, id] of this.deck.entries()) {
      const card = parseCard(id);
      const selected = position === this.selectedIndex;
      const button = createButton(
        documentRef,
        addClass(this.classes.card, selected ? this.classes.selectedCard : undefined),
        "recovery-card",
        "move-card",
        "",
      );
      button.draggable = this.options.allowReorder !== false;
      button.dataset.voideddevCardId = card.id;
      button.dataset.voideddevPosition = String(position + 1);
      button.dataset.voideddevSuit = card.suit;
      button.dataset.voideddevColor = card.color;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute(
        "aria-label",
        `Position ${position + 1}: ${card.rankName} of ${card.suitName}`,
      );
      const customContent = this.options.renderCardContent?.(
        card,
        { position, selected, presentation: this.presentation },
        documentRef,
      );
      if (customContent) {
        button.append(customContent);
      } else {
        button.append(
          createElement(
            documentRef,
            "span",
            this.classes.cardPosition,
            "recovery-card-position",
            String(position + 1),
          ),
          createElement(
            documentRef,
            "span",
            this.classes.cardRank,
            "recovery-card-rank",
            card.rank,
          ),
          createElement(
            documentRef,
            "span",
            this.classes.cardSuit,
            "recovery-card-suit",
            card.suitSymbol,
          ),
        );
      }
      if (this.options.allowReorder !== false) {
        button.addEventListener("click", () => this.selectOrMove(position));
        button.addEventListener("keydown", (event) =>
          this.handleCardKeydown(event, position),
        );
        button.addEventListener("dragstart", (event) => {
          this.dragIndex = position;
          event.dataTransfer?.setData(
            "application/x-voided-recovery-position",
            String(position),
          );
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });
        button.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        button.addEventListener("drop", (event) => {
          event.preventDefault();
          const encoded = event.dataTransfer?.getData(
            "application/x-voided-recovery-position",
          );
          const from = this.dragIndex ?? Number(encoded);
          if (Number.isInteger(from)) this.moveCard(from, position);
        });
        button.addEventListener("dragend", () => {
          this.dragIndex = null;
        });
      }
      this.grid.append(button);
    }
    if (focusPosition !== undefined) {
      this.grid
        .querySelector<HTMLButtonElement>(
          `[data-voideddev-position="${focusPosition + 1}"]`,
        )
        ?.focus();
    }
  }

  private selectOrMove(position: number): void {
    if (this.selectedIndex === null) {
      this.selectedIndex = position;
      this.renderDeck(position);
      return;
    }
    if (this.selectedIndex === position) {
      this.selectedIndex = null;
      this.renderDeck(position);
      return;
    }
    this.moveCard(this.selectedIndex, position);
  }

  private handleCardKeydown(event: KeyboardEvent, position: number): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const target = event.key === "ArrowLeft" ? position - 1 : position + 1;
    if (target >= 0 && target < this.deck.length) this.moveCard(position, target);
  }

  private moveCard(from: number, to: number): void {
    if (from === to) {
      this.selectedIndex = null;
      this.renderDeck(to);
      return;
    }
    const reordered = moveRecoveryDeckUICard(this.deck, from, to);
    this.deck.fill("");
    this.deck = reordered;
    this.selectedIndex = null;
    this.dragIndex = null;
    this.renderDeck(to);
    this.notifyChange("reorder");
  }

  private async replaceWithFreshDeck(notify: boolean): Promise<void> {
    if (this.busy) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    this.setBusy(true, this.labels.shuffling);
    let generated: string[] | null = null;
    try {
      generated = await this.shuffleDeck();
      if (lifecycleGeneration !== this.lifecycleGeneration) return;
      if (!validateRecoveryDeckUICards(generated)) {
        throw new Error(this.labels.invalidDeck);
      }
      this.deck.fill("");
      this.deck = [...generated];
      this.selectedIndex = null;
      this.renderDeck();
      if (notify) this.notifyChange("shuffle");
    } catch (error) {
      if (this.error) this.error.textContent = this.labels.shuffleError;
      this.options.onError?.(error);
      if (!notify) throw error;
    } finally {
      generated?.fill("");
      if (lifecycleGeneration === this.lifecycleGeneration) {
        this.setBusy(false);
      }
    }
  }

  private async confirm(): Promise<void> {
    if (!this.options.onConfirm || this.busy || !this.error) return;
    if (!validateRecoveryDeckUICards(this.deck)) {
      this.error.textContent = this.labels.invalidDeck;
      return;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    const submitted = [...this.deck];
    this.setBusy(true);
    this.error.textContent = "";
    try {
      await this.options.onConfirm(submitted);
      if (lifecycleGeneration !== this.lifecycleGeneration) return;
      const shouldClose =
        this.options.closeOnConfirm ?? this.presentation === "modal";
      if (shouldClose) this.unmount();
    } catch (error) {
      if (lifecycleGeneration === this.lifecycleGeneration && this.error) {
        this.error.textContent = this.labels.confirmError;
      }
      this.options.onError?.(error);
    } finally {
      submitted.fill("");
      if (
        lifecycleGeneration === this.lifecycleGeneration &&
        this.root
      ) {
        this.setBusy(false);
      }
    }
  }

  private notifyChange(reason: RecoveryDeckUIChangeReason): void {
    if (!this.options.onChange) return;
    const copy = [...this.deck];
    try {
      Promise.resolve(this.options.onChange(copy, reason))
        .catch((error) => this.options.onError?.(error))
        .finally(() => copy.fill(""));
    } catch (error) {
      copy.fill("");
      this.options.onError?.(error);
    }
  }

  private setBusy(busy: boolean, shuffleLabel?: string): void {
    this.busy = busy;
    if (this.shuffleButton) {
      this.shuffleButton.disabled = busy;
      this.shuffleButton.textContent =
        busy && shuffleLabel ? shuffleLabel : this.labels.shuffle;
    }
    if (this.confirmButton) this.confirmButton.disabled = busy;
  }

  private focusFirstAction(): void {
    this.shuffleButton?.focus();
    if (!this.shuffleButton) this.confirmButton?.focus();
  }

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (this.presentation === "modal" && event.key === "Escape") this.unmount();
  };

  private handleBackdropClick = (event: MouseEvent): void => {
    if (
      this.presentation === "modal" &&
      this.options.closeOnBackdrop !== false &&
      event.target === this.root
    ) {
      this.unmount();
    }
  };
}

export function createRecoveryDeckUI(
  options?: RecoveryDeckUIOptions,
): VoidedRecoveryDeckUI {
  return new VoidedRecoveryDeckUI(options);
}

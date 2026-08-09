import {
  RECOVERY_DECK_DEFAULT_CSS,
  RECOVERY_DECK_UI_CARD_IDS,
  VoidedRecoveryDeckUI,
  moveRecoveryDeckUICard,
  validateRecoveryDeckUICards,
} from "../recovery-deck-ui";

describe("generic Recovery Deck UI contract", () => {
  test("publishes the permanent canonical 52-card UI set", () => {
    expect(RECOVERY_DECK_UI_CARD_IDS).toHaveLength(52);
    expect(new Set(RECOVERY_DECK_UI_CARD_IDS).size).toBe(52);
    expect(RECOVERY_DECK_UI_CARD_IDS.slice(0, 13)).toEqual([
      "AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS",
    ]);
    expect(RECOVERY_DECK_UI_CARD_IDS.slice(-13)).toEqual([
      "AC", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "10C", "JC", "QC", "KC",
    ]);
  });

  test("validates exact permutations without normalizing display strings", () => {
    const canonical = [...RECOVERY_DECK_UI_CARD_IDS];
    expect(validateRecoveryDeckUICards(canonical)).toBe(true);
    expect(validateRecoveryDeckUICards([...canonical].reverse())).toBe(true);
    expect(validateRecoveryDeckUICards(canonical.slice(0, 51))).toBe(false);
    expect(validateRecoveryDeckUICards([...canonical.slice(0, 51), "AS"])).toBe(false);
    expect(validateRecoveryDeckUICards(["A♠", ...canonical.slice(1)])).toBe(false);
    expect(validateRecoveryDeckUICards(["as", ...canonical.slice(1)])).toBe(false);
  });

  test("moves a card without mutating or invalidating the source deck", () => {
    const canonical = [...RECOVERY_DECK_UI_CARD_IDS];
    const moved = moveRecoveryDeckUICard(canonical, 0, 3);
    expect(canonical).toEqual(RECOVERY_DECK_UI_CARD_IDS);
    expect(moved.slice(0, 5)).toEqual(["2S", "3S", "4S", "AS", "5S"]);
    expect(validateRecoveryDeckUICards(moved)).toBe(true);
    expect(() => moveRecoveryDeckUICard(canonical, -1, 2)).toThrow(
      "positions are out of range",
    );
  });

  test("rejects malformed initial decks", () => {
    expect(
      () => new VoidedRecoveryDeckUI({ deck: RECOVERY_DECK_UI_CARD_IDS.slice(0, 51) }),
    ).toThrow("exactly 52 unique canonical cards");
  });

  test("minimal defaults remain fully overridable", () => {
    for (const token of [
      "@layer voideddev-recovery-defaults",
      "--voided-recovery-surface",
      ".voideddev-recovery-overlay",
      ".voideddev-recovery-inline",
      ".voideddev-recovery-card",
    ]) {
      expect(RECOVERY_DECK_DEFAULT_CSS).toContain(token);
    }
    expect(RECOVERY_DECK_DEFAULT_CSS).not.toContain("font-family");
    expect(RECOVERY_DECK_DEFAULT_CSS).not.toContain("linear-gradient");
    expect(RECOVERY_DECK_DEFAULT_CSS).not.toContain("url(");
  });

  test("does not retain a delayed shuffle result after unmount", async () => {
    let resolveShuffle!: (deck: string[]) => void;
    const ui = new VoidedRecoveryDeckUI({
      deck: RECOVERY_DECK_UI_CARD_IDS,
      shuffleDeck: () =>
        new Promise<string[]>((resolve) => {
          resolveShuffle = resolve;
        }),
    });
    const internals = ui as unknown as {
      deck: string[];
      replaceWithFreshDeck(notify: boolean): Promise<void>;
    };

    const pending = internals.replaceWithFreshDeck(true);
    ui.unmount(false);
    resolveShuffle([...RECOVERY_DECK_UI_CARD_IDS].reverse());
    await pending;

    expect(internals.deck).toEqual([]);
  });

  test("handles a confirmation rejection after unmount without touching cleared UI", async () => {
    let rejectConfirmation!: (error: Error) => void;
    const errors: unknown[] = [];
    const ui = new VoidedRecoveryDeckUI({
      deck: RECOVERY_DECK_UI_CARD_IDS,
      onConfirm: () =>
        new Promise<void>((_resolve, reject) => {
          rejectConfirmation = reject;
        }),
      onError: (error) => errors.push(error),
    });
    const internals = ui as unknown as {
      deck: string[];
      error: { textContent: string } | null;
      confirm(): Promise<void>;
    };
    internals.error = { textContent: "" };

    const pending = internals.confirm();
    ui.unmount(false);
    rejectConfirmation(new Error("confirmation failed after close"));

    await expect(pending).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(internals.deck).toEqual([]);
  });
});

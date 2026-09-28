// The account panel's skin preview: one character on its own small canvas.
//
// Stub for now (the real one draws the skin in Idle, turning slowly, holding
// the rifle). The signature is the contract with the skin picker.

/** Draws `skin` on `canvas` until `dispose()`. `setSkin` swaps the character. */
export function mountSkinPreview(canvas: HTMLCanvasElement, skin: string): { setSkin(id: string): void; dispose(): void } {
  void canvas;
  void skin;
  return {
    setSkin(id: string) {
      void id;
    },
    dispose() {},
  };
}

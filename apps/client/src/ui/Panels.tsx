// The panels: How to play, Settings and Account, one at a time, in Astryx's
// Dialog (a native modal <dialog>: focus stays inside, Esc and the close
// button close it, focus goes back to what opened it). Which one is open is
// uiState.ts' `ui.panel`, so the game loop can keep the input off meanwhile.

import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { useRef } from "react";
import { closePanel, ui, type PanelName } from "../uiState.ts";
import { AccountPanel } from "./account/AccountPanel.tsx";
import { useSelector } from "./hooks.ts";
import { HowToPlay } from "./menu/HowToPlay.tsx";
import { Settings } from "./Settings.tsx";

const TITLES: Record<PanelName, string> = {
  howto: "How to play",
  settings: "Settings",
  account: "Account",
};

export function Panels() {
  const panel = useSelector(ui, (s) => s.panel);
  // Keep the last panel's content while the dialog animates out.
  const shown = useRef<PanelName>("howto");
  if (panel) shown.current = panel;
  const name = shown.current;
  const onOpenChange = (open: boolean) => {
    if (!open) closePanel();
  };

  return (
    <Dialog
      isOpen={panel !== null}
      onOpenChange={onOpenChange}
      width={620}
      maxHeight="min(88dvh, 780px)"
      data-testid={`panel-${name}`}
      data-panel={name}
    >
      <Layout
        header={
          // Its title is in the stencil (the theme's dialog-header override).
          <DialogHeader title={TITLES[name]} onOpenChange={onOpenChange} />
        }
        content={
          <LayoutContent>
            {name === "howto" && <HowToPlay />}
            {name === "settings" && <Settings />}
            {name === "account" && <AccountPanel />}
          </LayoutContent>
        }
      />
    </Dialog>
  );
}

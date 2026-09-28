// The skin picker in the account panel: the 16 skins by name plus "Random",
// and a 3D preview of the one under the pointer (or focus), else the chosen
// one. Only the previewed skin loads, never 16 models at once.
//
// Signed in, a choice is saved on the account (POST /account/skin, through
// auth.ts) and applies from the next match. Guests see the list disabled,
// with a prompt to sign in: they get a random skin every match.

import { Banner } from "@astryxdesign/core/Banner";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Text } from "@astryxdesign/core/Text";
import { SKINS, skinOf } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { account } from "../../auth.ts";
import { mountSkinPreview } from "../../skinPreview.ts";
import { ui } from "../../uiState.ts";
import { useSelector } from "../hooks.ts";

/** The radio value for "no saved skin" (null on the account). */
const RANDOM = "random";

const PREVIEW_W = 180;
const PREVIEW_H = 230;

const styles = stylex.create({
  title: { fontSize: "16px", fontWeight: 800 },
  body: {
    flexWrap: { default: "nowrap", "@media (max-width: 520px)": "wrap" },
  },
  stage: { flexShrink: 0, alignItems: "center" },
  canvas: {
    display: "block",
    width: `${PREVIEW_W}px`,
    height: `${PREVIEW_H}px`,
    borderRadius: "var(--radius-element)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  caption: { fontWeight: 700, textAlign: "center" },
  // The list scrolls beside the preview rather than stretching the panel.
  list: {
    flexGrow: 1,
    minWidth: 0,
    maxHeight: `${PREVIEW_H + 30}px`,
    overflowY: "auto",
    paddingInlineEnd: "var(--spacing-2)",
  },
});

/** One character on its own canvas: mounted once, told to swap skins, disposed on unmount. */
function SkinPreview({ skin }: { skin: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<ReturnType<typeof mountSkinPreview> | null>(null);
  const first = useRef(skin);

  useEffect(() => {
    if (!canvas.current) return;
    const p = mountSkinPreview(canvas.current, first.current);
    preview.current = p;
    return () => {
      preview.current = null;
      p.dispose();
    };
  }, []);

  useEffect(() => {
    preview.current?.setSkin(skin);
  }, [skin]);

  return (
    <canvas
      ref={canvas}
      width={PREVIEW_W * 2}
      height={PREVIEW_H * 2}
      aria-hidden="true"
      data-testid="skin-preview"
      data-skin={skin}
      {...stylex.props(styles.canvas)}
    />
  );
}

export function SkinPicker() {
  const acc = useSelector(account, (s) => (s.status === "signedIn" ? s.account : null));
  // The panel's content stays mounted after the dialog closes: draw only while it's up.
  const open = useSelector(ui, (u) => u.panel === "account");
  const saved = acc?.skin ?? null;
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  // What "Random" shows in the preview: one skin, drawn once.
  const [randomShown] = useState(() => SKINS[Math.floor(Math.random() * SKINS.length)].id);

  const current = pending !== undefined ? pending : saved;
  const value = acc ? (current ?? RANDOM) : RANDOM;
  const highlighted = hovered ?? value;
  const shown = highlighted === RANDOM ? randomShown : highlighted;
  const caption = highlighted === RANDOM ? "Random" : (skinOf(highlighted)?.name ?? "");

  const choose = async (v: string) => {
    if (!acc) return;
    const skin = v === RANDOM ? null : v;
    if (skin === current) return;
    setPending(skin);
    setError("");
    const err = await account.setSkin(skin);
    setPending(undefined);
    if (err) setError(err);
  };

  return (
    <VStack gap={3} data-testid="skin-picker" data-skin={acc ? (saved ?? RANDOM) : undefined}>
      <Text xstyle={styles.title}>Your skin</Text>
      {acc ? (
        <Text color="secondary">Saved on your account. A new choice applies from your next match.</Text>
      ) : (
        <Text color="secondary" data-testid="skin-sign-in">
          Sign in to choose your skin. Guests get a random one every match.
        </Text>
      )}
      <HStack gap={4} align="start" xstyle={styles.body}>
        <VStack gap={2} xstyle={styles.stage}>
          {open && <SkinPreview skin={shown} />}
          <Text xstyle={styles.caption} data-testid="skin-preview-name">
            {caption}
          </Text>
        </VStack>
        <VStack xstyle={styles.list} onPointerLeave={() => setHovered(null)}>
          <RadioList
            label="Skin"
            isLabelHidden
            value={value}
            onChange={(v) => void choose(v)}
            isDisabled={!acc}
            disabledMessage={acc ? undefined : "Sign in to choose your skin"}
            size="sm"
            width="100%"
            data-testid="skin-list"
          >
            <RadioListItem
              label="Random"
              description="A new one every match"
              value={RANDOM}
              data-testid="skin-option"
              data-skin={RANDOM}
              onPointerEnter={() => setHovered(RANDOM)}
            />
            {SKINS.map((s) => (
              <RadioListItem
                key={s.id}
                label={s.name}
                value={s.id}
                data-testid="skin-option"
                data-skin={s.id}
                onPointerEnter={() => setHovered(s.id)}
              />
            ))}
          </RadioList>
        </VStack>
      </HStack>
      {error && <Banner status="error" title={error} data-testid="skin-error" />}
    </VStack>
  );
}

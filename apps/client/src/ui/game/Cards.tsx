// The cards over the live scene, one at a time: joining, waiting for an
// opponent (with the invite link), the Esc menu, the match result, and the
// "this game is full / gone" notices. While any card is up the game's input
// is off (engine.ts' frame loop); the match itself keeps running.
//
// Which card shows comes from the flow (app.ts' screen) and the per-frame
// game view (GameView.card): each card re-renders only when what it shows
// changes, not every frame. Focus moves into a card when it appears (its
// main button), and leaves it when the card goes, so Space and Enter never
// press a stale button while playing.

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { MATCH_END_DELAY, type PlayerView } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Notice } from "../../app.ts";
import { countRender } from "../../renders.ts";
import { scoreboardModel } from "../../scoreboard.ts";
import { openPanel } from "../../uiState.ts";
import { jsonEqual, shallowEqual, useEngine, useSelector } from "../hooks.ts";
import { UsersIcon } from "../icons.tsx";
import { shared, slotDot } from "../styles.ts";
import { Scoreboard } from "./Scoreboard.tsx";
import { WeaponPicker } from "./WeaponPicker.tsx";

type CardName = "joining" | "waiting" | "pause" | "result" | "notice";

const styles = stylex.create({
  layer: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    display: "grid",
    placeItems: "center",
    padding: "16px",
    overflowY: "auto",
    backgroundColor: "rgba(8, 9, 12, 0.3)",
  },
  layerNotice: { backgroundColor: "rgba(8, 9, 12, 0.55)" },
  card: {
    width: "min(440px, 100%)",
    padding: "22px 24px 20px",
    borderWidth: 0,
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-card)",
    boxShadow: "var(--shadow-med)",
    animationName: {
      default: stylex.keyframes({ from: { opacity: 0, transform: "translateY(8px) scale(0.985)" } }),
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "220ms",
    animationTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  wide: { width: "min(680px, 100%)" },
  centered: { textAlign: "center", alignItems: "center" },
  title: { margin: 0, fontSize: "22px", fontWeight: 800, letterSpacing: "-0.01em", textWrap: "balance" },
  sub: { marginBlockStart: "6px", lineHeight: 1.45 },
  warn: { color: "var(--color-text-yellow)", marginBlockStart: "6px" },
  actions: { marginBlockStart: "20px" },
  stack: { marginBlockStart: "18px" },
  stackButton: { width: "100%" },
  danger: {
    backgroundColor: { default: "transparent", ":hover": { default: null, "@media (hover: hover)": "rgba(255, 107, 74, 0.16)" } },
    color: "#ffab98",
    boxShadow: "inset 0 0 0 1px rgba(255, 107, 74, 0.45)",
  },
  hint: { marginBlockStart: "14px", color: "rgba(242, 242, 242, 0.5)" },
  spinner: { flexShrink: 0, marginBlockStart: "2px" },
  seats: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" },
  seat: {
    minWidth: 0,
    padding: "8px 10px",
    borderRadius: "var(--radius-element)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    fontWeight: 700,
    fontSize: "14px",
  },
  seatOpen: { color: "rgba(242, 242, 242, 0.5)", fontWeight: 600 },
  seatName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  invite: { flexGrow: 1, minWidth: 0 },
  resultTitle: {
    fontSize: "48px",
    lineHeight: 1,
    color: "#d8deea",
    textShadow: "0 1px 0 #7d8799, 0 2px 0 #636d80, 0 3px 0 #4b5467, 0 4px 0 #373e4f, 0 12px 20px rgba(0, 0, 0, 0.5)",
  },
  resultWin: {
    color: "var(--bagarre-sand)",
    textShadow: "0 1px 0 #e0853a, 0 2px 0 #c96a24, 0 3px 0 #a64c14, 0 4px 0 #7f370c, 0 12px 20px rgba(0, 0, 0, 0.5)",
  },
  resultSub: { marginBlockStart: "10px" },
  boardGap: { marginBlockStart: "18px" },
});

// --- Which card --------------------------------------------------------------------

export function Cards() {
  const { app, view } = useEngine();
  const screen = useSelector(app, (s) => s.screen);
  const gameCard = useSelector(view, (v) => v?.card ?? null);
  let card: CardName | null = null;
  if (screen === "joining") card = "joining";
  else if (screen === "notice") card = "notice";
  else if (screen === "game" && gameCard && gameCard !== "none") card = gameCard === "loading" ? "joining" : gameCard;
  if (!card) return null;
  return (
    <Layer card={card}>
      {card === "joining" && <JoiningCard />}
      {card === "waiting" && <WaitingCard />}
      {card === "pause" && <PauseCard />}
      {card === "result" && <ResultCard />}
      {card === "notice" && <NoticeCard />}
    </Layer>
  );
}

/** The layer under a card: moves focus in when the card changes, and out when the layer goes. */
function Layer({ card, children }: { card: CardName; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    const target =
      el?.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ??
      el?.querySelector<HTMLElement>("button:not([disabled])");
    target?.focus({ preventScroll: true });
  }, [card]);
  useEffect(
    () => () => {
      // Nothing focused while playing: Space and Enter must not press a stale button.
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.current?.contains(active)) active.blur();
    },
    [],
  );
  return (
    <VStack ref={root} xstyle={[styles.layer, card === "notice" && styles.layerNotice]} data-card={card} data-testid="card-layer">
      {children}
    </VStack>
  );
}

function CardBox({ name, wide, centered, children }: { name: CardName; wide?: boolean; centered?: boolean; children: ReactNode }) {
  return (
    <Card
      role="dialog"
      aria-modal="true"
      aria-labelledby={`card-${name}-title`}
      data-testid={`${name}-card`}
      xstyle={[styles.card, wide && styles.wide, centered && styles.centered]}
    >
      {children}
    </Card>
  );
}

function Title({ name, children, xstyle }: { name: CardName; children: ReactNode; xstyle?: stylex.StyleXStyles }) {
  return (
    <Heading level={2} id={`card-${name}-title`} xstyle={[styles.title, xstyle]} aria-live="polite">
      {children}
    </Heading>
  );
}

// --- Joining -----------------------------------------------------------------------

function JoiningCard() {
  countRender("card.joining");
  const { app } = useEngine();
  const joining = useSelector(app, (s) => (s.screen === "joining" ? s.joining : null));
  const title = joining?.title || "Joining the game…";
  const sub = joining?.sub ?? "";
  return (
    <CardBox name="joining" centered>
      <Spinner size="xl" aria-label="Joining" />
      <VStack gap={0} align="center" xstyle={styles.stack}>
        <Title name="joining">{title}</Title>
        {sub && (
          <Text color="secondary" xstyle={styles.sub}>
            {sub}
          </Text>
        )}
      </VStack>
      <HStack justify="center" xstyle={styles.actions}>
        <Button label="Cancel" variant="secondary" onClick={() => app.leave()} data-testid="joining-cancel" />
      </HStack>
    </CardBox>
  );
}

// --- Waiting -----------------------------------------------------------------------

async function copyText(text: string, fallback: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback?.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

function Seats() {
  countRender("card.seats");
  const { view } = useEngine();
  const seats = useSelector(
    view,
    (v) => {
      const players: PlayerView[] = [];
      v?.snapshot?.players.forEach((p) => players.push(p));
      players.sort((a, b) => a.slot - b.slot);
      const me = v?.snapshot?.players.get(v.you);
      return players.map((p) => ({ slot: p.slot, name: p === me ? `${p.name} (you)` : p.name }));
    },
    jsonEqual,
  );
  const open = Math.max(0, 2 - seats.length);
  return (
    <VStack as="ul" xstyle={styles.seats} aria-label="Players" data-testid="seats">
      {seats.map((s) => (
        <HStack as="li" key={s.slot} gap={2} align="center" xstyle={styles.seat} data-testid="seat">
          <HStack as="span" xstyle={[shared.dot, slotDot(s.slot)]} aria-hidden="true" />
          <Text as="span" color="inherit" xstyle={styles.seatName}>
            {s.name}
          </Text>
        </HStack>
      ))}
      {Array.from({ length: open }, (_, i) => (
        <HStack as="li" key={`open-${i}`} gap={2} align="center" xstyle={[styles.seat, styles.seatOpen]} data-testid="seat-open">
          <HStack as="span" xstyle={[shared.dot, shared.dotOpen]} aria-hidden="true" />
          <Text as="span" color="inherit" xstyle={styles.seatName}>
            Open seat
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

function InviteLink() {
  const { app } = useEngine();
  const url = useSelector(app, (s) => s.inviteUrl);
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  // Clicking into the read-only field selects the whole link.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const select = () => el.select();
    el.addEventListener("focus", select);
    return () => el.removeEventListener("focus", select);
  }, []);
  return (
    <HStack gap={2} align="center">
      <VStack xstyle={styles.invite}>
        <TextInput ref={input} label="Invite link" isLabelHidden value={url} isReadOnly width="100%" data-testid="invite-link" />
      </VStack>
      <Button
        label={copied ? "Copied" : "Copy invite link"}
        icon={<Icon icon={copied ? "check" : "copy"} size="sm" />}
        xstyle={shared.blueButton}
        data-testid="copy-invite"
        onClick={() => void copyText(url, input.current).then(setCopied)}
      />
    </HStack>
  );
}

function WaitingCard() {
  countRender("card.waiting");
  const { app } = useEngine();
  const { opponentLeft, isPrivate } = useSelector(app, (s) => ({ opponentLeft: s.opponentLeft, isPrivate: s.isPrivate }), shallowEqual);
  const [title, sub] = opponentLeft
    ? ["Your opponent left", isPrivate ? "Waiting for someone to join with the link…" : "Looking for a new opponent…"]
    : isPrivate
      ? ["Waiting for your friend…", "Send them the link. The match starts as soon as they join."]
      : ["Looking for an opponent…", "Anyone can join from the menu's open games, or send a friend the link."];
  return (
    <CardBox name="waiting">
      <HStack gap={3} align="start">
        <Spinner size="lg" xstyle={styles.spinner} aria-label="Waiting" />
        <VStack>
          <Title name="waiting">{title}</Title>
          <Text color="secondary" xstyle={styles.sub}>
            {sub}
          </Text>
        </VStack>
      </HStack>
      <Text as="p" xstyle={shared.eyebrow}>
        Players
      </Text>
      <Seats />
      <Text as="p" xstyle={shared.eyebrow}>
        Invite link
      </Text>
      <InviteLink />
      <Text as="p" xstyle={shared.eyebrow}>
        Your weapon
      </Text>
      <WeaponPicker />
      <HStack xstyle={styles.actions}>
        <Button label="Cancel" variant="secondary" onClick={() => app.leave()} data-testid="waiting-cancel" />
      </HStack>
    </CardBox>
  );
}

// --- Pause (Esc) -----------------------------------------------------------------------

function PauseCard() {
  countRender("card.pause");
  const { app, gesture } = useEngine();
  return (
    <CardBox name="pause">
      <VStack data-testid="esc-menu">
        <Title name="pause">Match menu</Title>
        <HStack gap={2} align="start" xstyle={styles.warn}>
          <Icon icon={UsersIcon} size="sm" />
          <Text color="inherit">This is multiplayer: there's no pause. The match keeps running while this is open.</Text>
        </HStack>
        <VStack gap={2} xstyle={styles.stack}>
          <Button
            label="Resume"
            variant="primary"
            xstyle={styles.stackButton}
            data-autofocus=""
            data-testid="esc-resume"
            onClick={() => app.setPaused(false)}
          />
          <Button
            label="Settings"
            variant="secondary"
            aria-haspopup="dialog"
            xstyle={styles.stackButton}
            data-testid="esc-settings"
            onClick={() => {
              gesture();
              openPanel("settings");
            }}
          />
          <Button
            label="Leave match"
            variant="destructive"
            xstyle={[styles.stackButton, styles.danger]}
            data-testid="esc-leave"
            onClick={() => app.leave()}
          />
        </VStack>
        <Text type="supporting" xstyle={styles.hint}>
          <Kbd keys="esc" /> goes back to the game.
        </Text>
      </VStack>
    </CardBox>
  );
}

// --- Result ----------------------------------------------------------------------------

function ResultCard() {
  countRender("card.result");
  const { app, view, gesture } = useEngine();
  const staying = useSelector(app, (s) => s.staying);
  const won = useSelector(view, (v) => !!v?.snapshot && v.snapshot.winner === v.you);
  const left = useSelector(view, (v) => Math.max(0, Math.ceil(MATCH_END_DELAY - (performance.now() - (v?.endedAt ?? 0)) / 1000)));
  const model = useSelector(view, (v) => scoreboardModel(v?.snapshot ?? null, v?.you ?? ""), jsonEqual);
  return (
    <CardBox name="result" wide={!staying}>
      <Title name="result" xstyle={[shared.display, styles.resultTitle, won && styles.resultWin]}>
        {won ? "You win!" : "You lose"}
      </Title>
      <Text color="secondary" xstyle={[styles.resultSub, shared.tabular]} data-testid="result-countdown">
        {staying
          ? `Rematch in ${left} s, same game, next map.`
          : `Next match in ${left} s. Stay for a rematch, or head back to the menu.`}
      </Text>
      {!staying && (
        <>
          <VStack xstyle={styles.boardGap}>
            <Scoreboard model={model} label="Match result" flat />
          </VStack>
          <Text as="p" xstyle={shared.eyebrow}>
            Weapon for the next match
          </Text>
          <WeaponPicker />
        </>
      )}
      <HStack gap={2} wrap="wrap" xstyle={styles.actions}>
        <Button
          label={staying ? "Staying" : "Rematch"}
          variant="primary"
          isDisabled={staying}
          data-autofocus=""
          data-testid="rematch"
          onClick={() => {
            gesture();
            app.rematch();
          }}
        />
        <Button label="Main menu" variant="secondary" onClick={() => app.leave()} data-testid="main-menu" />
      </HStack>
    </CardBox>
  );
}

// --- Notice -----------------------------------------------------------------------------

function NoticeCard() {
  countRender("card.notice");
  const { app } = useEngine();
  const notice = useSelector(app, (s) => s.notice) as Notice | null;
  if (!notice) return null;
  return (
    <CardBox name="notice" centered>
      <VStack data-testid="notice" key={notice.title + notice.body}>
        <Title name="notice">{notice.title}</Title>
        <Text color="secondary" xstyle={styles.sub}>
          {notice.body}
        </Text>
        <HStack gap={2} justify="center" xstyle={styles.actions}>
          {notice.retry && (
            <Button label="Try again" variant="primary" data-autofocus="" onClick={() => app.retry()} data-testid="notice-retry" />
          )}
          <Button
            label="Back to menu"
            variant={notice.retry ? "secondary" : "primary"}
            onClick={() => app.leave()}
            data-testid="notice-back"
          />
        </HStack>
      </VStack>
    </CardBox>
  );
}

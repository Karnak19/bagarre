// The cards over the live scene, one at a time: joining, reconnecting, waiting for an
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
import {
  FFA_MAX_PLAYERS,
  FFA_MIN_PLAYERS,
  NO_TEAM,
  RECONNECT_GRACE_S,
  ROYALE_MAX_PLAYERS,
  ROYALE_MIN_PLAYERS,
  ROYALE_MIN_RECORDED,
  TEAM_BLUE,
  TEAM_MIN_PER_TEAM,
  TEAM_NAMES,
  TEAM_RED,
  TEAM_SIZE,
  TICK_RATE,
  rulesOf,
  royaleRecorded,
  type PlayerView,
  type TiebreakReason,
} from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Notice } from "../../app.ts";
import { TEAM_PAINT, paintOf } from "../../paint.ts";
import { countRender } from "../../renders.ts";
import { scoreboardModel } from "../../scoreboard.ts";
import { openPanel } from "../../uiState.ts";
import { jsonEqual, shallowEqual, useEngine, useSelector } from "../hooks.ts";
import { UsersIcon } from "../icons.tsx";
import { shared, slotDot, slotText } from "../styles.ts";
import { Scoreboard } from "./Scoreboard.tsx";
import { GrenadePicker, PerkPicker, WeaponPicker } from "./WeaponPicker.tsx";

type CardName = "joining" | "reconnecting" | "waiting" | "pause" | "result" | "notice";

const styles = stylex.create({
  layer: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    display: "grid",
    // One column no wider than the screen: a card's content (the invite row) never pushes it past the edge on a phone.
    gridTemplateColumns: "minmax(0, 1fr)",
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
      // A fade only: the card's buttons are where they will stay from the first frame.
      default: stylex.keyframes({ from: { opacity: 0 } }),
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
  teamsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  teamSeats: { display: "grid", gridTemplateColumns: "1fr", gap: "6px" },
  teamHead: { fontSize: "13px", letterSpacing: "0.06em", marginBlockEnd: "2px" },
  teamYou: { color: "var(--color-text-secondary)", fontSize: "12px", fontWeight: 600, marginInlineStart: "6px", textTransform: "none", letterSpacing: 0 },
  switch: { marginBlockStart: "10px" },
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
  seatAway: { opacity: 0.6 },
  seatHostMark: { marginInlineStart: "auto", flexShrink: 0, color: "var(--bagarre-gold)", fontSize: "12px", fontWeight: 600 },
  seatBotMark: {
    marginInlineStart: "auto",
    flexShrink: 0,
    padding: "1px 5px",
    borderRadius: "4px",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "var(--color-text-secondary)",
    fontSize: "11px",
    fontWeight: 700,
  },
  seatAwayMark: { marginInlineStart: "auto", flexShrink: 0, color: "var(--color-text-yellow)", fontSize: "12px", fontWeight: 600 },
  countdown: { fontSize: "44px", lineHeight: 1, color: "var(--bagarre-sand)" },
  countdownNumber: { color: "var(--bagarre-gold)" },
  resultSmall: { fontSize: "40px" },
  invite: { flexGrow: 1, minWidth: 0 },
  nowrap: { whiteSpace: "nowrap", font: "inherit", letterSpacing: "inherit" },
  startBlock: { marginBlockStart: "18px", marginBlockEnd: "14px" },
  botButtons: { marginBlockStart: "8px" },
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
      {card === "reconnecting" && <ReconnectingCard />}
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

function Title({ name, children, xstyle, testId }: { name: CardName; children: ReactNode; xstyle?: stylex.StyleXStyles; testId?: string }) {
  return (
    <Heading level={2} id={`card-${name}-title`} xstyle={[styles.title, xstyle]} aria-live="polite" data-testid={testId}>
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

// --- Reconnecting ------------------------------------------------------------------

/** Our connection dropped: the SDK is retrying, the server holds the seat. Replaced by the game, or by a notice. */
function ReconnectingCard() {
  countRender("card.reconnecting");
  const { app } = useEngine();
  return (
    <CardBox name="reconnecting" centered>
      <Spinner size="xl" aria-label="Reconnecting" />
      <VStack gap={0} align="center" xstyle={styles.stack}>
        <Title name="reconnecting">Reconnecting…</Title>
        <Text color="secondary" xstyle={styles.sub}>
          The connection dropped. Your seat is kept for {RECONNECT_GRACE_S} seconds while we get you back in.
        </Text>
      </VStack>
      <HStack justify="center" xstyle={styles.actions}>
        <Button label="Leave match" variant="secondary" onClick={() => app.leave()} data-testid="reconnecting-leave" />
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

/**
 * The seats: players in seat order, then the open ones up to `total`.
 * `showAway` marks dropped connections, `showHost` the host (the battle
 * royale's, who starts the match). `team`: only that team's players (a team
 * deathmatch lists each team on its own).
 */
function Seats({ total = 2, showAway = false, showHost = false, team }: { total?: number; showAway?: boolean; showHost?: boolean; team?: number }) {
  countRender("card.seats");
  const { view } = useEngine();
  const seats = useSelector(
    view,
    (v) => {
      const players: PlayerView[] = [];
      v?.snapshot?.players.forEach((p) => (team === undefined || p.team === team ? players.push(p) : 0));
      players.sort((a, b) => a.slot - b.slot);
      const me = v?.snapshot?.players.get(v.you);
      const host = v?.snapshot ? v.snapshot.players.get(v.snapshot.host) : undefined;
      return players.map((p) => ({
        slot: p.slot,
        paint: paintOf(p),
        name: p === me ? `${p.name} (you)` : p.name,
        away: !p.connected,
        host: p === host,
        bot: !!p.bot,
      }));
    },
    jsonEqual,
  );
  const open = Math.max(0, total - seats.length);
  return (
    <VStack
      as="ul"
      xstyle={team === undefined ? styles.seats : styles.teamSeats}
      aria-label={team === undefined ? "Players" : `${TEAM_NAMES[team]} team`}
      data-testid={team === undefined ? "seats" : "team-seats"}
      data-team={team}
    >
      {seats.map((s) => (
        <HStack
          as="li"
          key={s.slot}
          gap={2}
          align="center"
          xstyle={[styles.seat, showAway && s.away && styles.seatAway]}
          data-testid="seat"
          data-away={(showAway && s.away) || undefined}
          data-host={(showHost && s.host) || undefined}
          data-bot={s.bot || undefined}
        >
          <HStack as="span" xstyle={[shared.dot, slotDot(s.paint)]} aria-hidden="true" />
          <Text as="span" color="inherit" xstyle={[styles.seatName, showAway && slotText(s.paint)]}>
            {s.name}
          </Text>
          {s.bot && (
            <Text as="span" xstyle={styles.seatBotMark}>
              BOT
            </Text>
          )}
          {showHost && s.host && !(showAway && s.away) && (
            <Text as="span" xstyle={styles.seatHostMark}>
              host
            </Text>
          )}
          {showAway && s.away && (
            <Text as="span" xstyle={styles.seatAwayMark}>
              reconnecting…
            </Text>
          )}
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
  const { view } = useEngine();
  const mode = useSelector(view, (v) => v?.snapshot?.mode ?? "duel");
  return mode === "ffa" ? <FfaWaitingCard /> : mode === "tdm" ? <TeamWaitingCard /> : mode === "royale" ? <RoyaleWaitingCard /> : <DuelWaitingCard />;
}

function DuelWaitingCard() {
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
      <GrenadePicker heading="Your grenade" />
      <PerkPicker heading="Your perk" />
      <HStack xstyle={styles.actions}>
        <Button label="Cancel" variant="secondary" onClick={() => app.leave()} data-testid="waiting-cancel" />
      </HStack>
    </CardBox>
  );
}

/**
 * A free-for-all waiting for players: who's in, how many are needed, then
 * the pre-match countdown once FFA_MIN_PLAYERS are in (players can still
 * join during it).
 */
function FfaWaitingCard() {
  countRender("card.waitingFfa");
  const { app, view } = useEngine();
  const { opponentLeft, isPrivate } = useSelector(app, (s) => ({ opponentLeft: s.opponentLeft, isPrivate: s.isPrivate }), shallowEqual);
  const players = useSelector(view, (v) => v?.snapshot?.players.size ?? 0);
  // Whole seconds: this re-renders once a second while counting, not every tick.
  const seconds = useSelector(view, (v) => Math.ceil((v?.snapshot?.countdown ?? 0) / TICK_RATE));
  const count = `${players}/${FFA_MAX_PLAYERS} players`;
  const [title, sub] =
    seconds > 0
      ? [null, `${count}. Others can still join until it starts.`]
      : opponentLeft
        ? ["Too few players left", `Waiting for more to join. It starts again when ${FFA_MIN_PLAYERS} are in (${count}).`]
        : [
            isPrivate ? "Waiting for your friends…" : "Waiting for players…",
            `Starts when ${FFA_MIN_PLAYERS} are in · ${count}.${isPrivate ? " Send them the link." : ""}`,
          ];
  return (
    <CardBox name="waiting">
      <HStack gap={3} align="start">
        {seconds === 0 && <Spinner size="lg" xstyle={styles.spinner} aria-label="Waiting" />}
        <VStack>
          {title ? (
            <Title name="waiting">{title}</Title>
          ) : (
            <Title name="waiting" xstyle={[shared.display, styles.countdown, shared.tabular]} testId="ffa-countdown">
              Starting in{" "}
              <Text as="span" color="inherit" xstyle={styles.countdownNumber}>
                {seconds}
              </Text>
            </Title>
          )}
          <Text color="secondary" xstyle={[styles.sub, shared.tabular]} data-testid="ffa-players">
            {sub}
          </Text>
        </VStack>
      </HStack>
      <Text as="p" xstyle={shared.eyebrow}>
        Players
      </Text>
      <Seats total={FFA_MAX_PLAYERS} showAway />
      <Text as="p" xstyle={shared.eyebrow}>
        Invite link
      </Text>
      <InviteLink />
      <Text as="p" xstyle={shared.eyebrow}>
        Your weapon
      </Text>
      <WeaponPicker />
      <GrenadePicker heading="Your grenade" />
      <PerkPicker heading="Your perk" />
      <HStack xstyle={styles.actions}>
        <Button label="Cancel" variant="secondary" onClick={() => app.leave()} data-testid="waiting-cancel" />
      </HStack>
    </CardBox>
  );
}

/**
 * A battle royale waiting for players: who's in, and the host's Start. The
 * host (the first player in, then the next one in when they leave) sees
 * Start, usable once ROYALE_MIN_PLAYERS are in, and starts the match when
 * they like (more can join until then); everyone else sees who they are
 * waiting for. Start goes straight into the warmup. No loadout: everyone
 * starts with the Pistol.
 */
function RoyaleWaitingCard() {
  countRender("card.waitingRoyale");
  const { app, view, gesture } = useEngine();
  const isPrivate = useSelector(app, (s) => s.isPrivate);
  const seats = useSelector(
    view,
    (v) => {
      const away: string[] = [];
      let connected = 0;
      let bots = 0;
      v?.snapshot?.players.forEach((p) => {
        if (p.connected) connected++;
        else away.push(p.name);
        if (p.bot) bots++;
      });
      return { players: v?.snapshot?.players.size ?? 0, connected, away, bots };
    },
    jsonEqual,
  );
  const players = seats.players;
  const host = useSelector(
    view,
    (v) => {
      const id = v?.snapshot?.host ?? "";
      return { you: !!id && id === v?.you, name: (id && v?.snapshot?.players.get(id)?.name) || "" };
    },
    shallowEqual,
  );
  // The client's only copy of the start threshold, for display: the server enforces it (acceptsStart,
  // ready()), on connected players, so a dropped one (held for the reconnect grace) doesn't count here either.
  const need = Math.max(0, ROYALE_MIN_PLAYERS - seats.connected);
  const canStart = need === 0;
  const reason =
    seats.away.length >= need
      ? `Waiting for ${seats.away.join(", ")} to reconnect`
      : `Start needs ${need === 1 ? "one more player" : `${need} more players`}: send them the invite link, or add a bot`;
  const count = `${players}/${ROYALE_MAX_PLAYERS} players`;
  const start = useRef<HTMLButtonElement>(null);
  // Made host while the card is up (the host left): Start takes the focus, so Enter presses it.
  const wasHost = useRef(host.you);
  useEffect(() => {
    if (host.you && !wasHost.current) start.current?.focus({ preventScroll: true });
    wasHost.current = host.you;
  }, [host.you]);
  const title: ReactNode = host.you ? (
    canStart ? (
      "Start when you're ready"
    ) : isPrivate ? (
      "Waiting for your friends…"
    ) : (
      "Waiting for players…"
    )
  ) : host.name ? (
    <>
      Waiting for{" "}
      <Text as="span" color="inherit" xstyle={styles.nowrap}>
        {host.name}
      </Text>{" "}
      to start
    </>
  ) : (
    "Waiting for players…"
  );
  const sub = host.you
    ? canStart
      ? `${count}. You're the host: others can still join until you start, not after.`
      : `You're the host · ${count}.${isPrivate ? " Send them the link." : ""}`
    : `${count}. The host starts the match; others can still join until then.`;
  return (
    <CardBox name="waiting">
      <HStack gap={3} align="start">
        {!(host.you && canStart) && <Spinner size="lg" xstyle={styles.spinner} aria-label="Waiting" />}
        <VStack>
          <Title name="waiting" testId={host.you ? undefined : "royale-waiting-host"}>
            {title}
          </Title>
          <Text color="secondary" xstyle={[styles.sub, shared.tabular]} data-testid="royale-players" data-players={players}>
            {sub}
          </Text>
        </VStack>
      </HStack>
      {host.you && (
        <VStack gap={1} xstyle={styles.startBlock}>
          <Button
            ref={start}
            label={`Start · ${count}`}
            variant="primary"
            size="lg"
            xstyle={[shared.blueButton, styles.stackButton]}
            // Always a tooltip: a disabled Button with one stays focusable (aria-disabled, never native
            // disabled), and the same element throughout, so the card's focus lands on it and Enter
            // presses it as soon as enough players are in.
            isDisabled={!canStart}
            tooltip={canStart ? "Starts the match now: nobody can join after" : reason}
            data-autofocus=""
            data-testid="royale-start"
            data-ready={canStart}
            data-players={players}
            onClick={() => {
              gesture();
              app.startMatch();
            }}
          />
          {!canStart && (
            <Text type="supporting" color="secondary" data-testid="royale-start-hint">
              {reason}.
            </Text>
          )}
          {/* Bots fill the seats nobody takes: the host's alone (the server ignores anyone else's). */}
          <HStack gap={2} xstyle={styles.botButtons}>
            <Button
              label="Add bot"
              variant="secondary"
              isDisabled={players >= ROYALE_MAX_PLAYERS}
              tooltip={players >= ROYALE_MAX_PLAYERS ? "Every seat is taken" : "A bot takes an open seat"}
              data-testid="royale-add-bot"
              onClick={() => {
                gesture();
                app.addBot();
              }}
            />
            <Button
              label="Remove bot"
              variant="secondary"
              isDisabled={seats.bots === 0}
              tooltip={seats.bots === 0 ? "No bot to remove" : "Removes the last bot added"}
              data-testid="royale-remove-bot"
              data-bots={seats.bots}
              onClick={() => {
                gesture();
                app.removeBot();
              }}
            />
          </HStack>
        </VStack>
      )}
      <Text color="secondary" xstyle={styles.sub}>
        One life. Everyone starts with the Pistol: find guns, grenades, bandages, medkits and shield charges in chests,
        stay inside the zone. The last one standing wins.
      </Text>
      <Text as="p" xstyle={shared.eyebrow}>
        Players
      </Text>
      <Seats total={ROYALE_MAX_PLAYERS} showAway showHost />
      <Text as="p" xstyle={shared.eyebrow}>
        Invite link
      </Text>
      <InviteLink />
      <HStack xstyle={styles.actions}>
        <Button label="Cancel" variant="secondary" onClick={() => app.leave()} data-testid="waiting-cancel" />
      </HStack>
    </CardBox>
  );
}

/**
 * A team deathmatch waiting for players: red and blue side by side, the
 * switch button (only when it keeps the teams within one, like the server's
 * rule), and the countdown once both teams have TEAM_MIN_PER_TEAM in
 * (players can still join during it, up to 4v4).
 */
function TeamWaitingCard() {
  countRender("card.waitingTeam");
  const { app, view } = useEngine();
  const { opponentLeft, isPrivate } = useSelector(app, (s) => ({ opponentLeft: s.opponentLeft, isPrivate: s.isPrivate }), shallowEqual);
  const t = useSelector(
    view,
    (v) => {
      const n = [0, 0];
      v?.snapshot?.players.forEach((p) => (p.team === TEAM_RED || p.team === TEAM_BLUE ? n[p.team]++ : 0));
      return { red: n[TEAM_RED], blue: n[TEAM_BLUE], you: v?.snapshot?.players.get(v.you)?.team ?? NO_TEAM };
    },
    shallowEqual,
  );
  const seconds = useSelector(view, (v) => Math.ceil((v?.snapshot?.countdown ?? 0) / TICK_RATE));
  const count = `${t.red}v${t.blue}`;
  const [title, sub] =
    seconds > 0
      ? [null, `${count}. Others can still join, up to ${TEAM_SIZE}v${TEAM_SIZE}.`]
      : opponentLeft
        ? ["Too few players left", `Waiting for more to join. It starts again at ${TEAM_MIN_PER_TEAM}v${TEAM_MIN_PER_TEAM} (${count}).`]
        : [
            isPrivate ? "Waiting for your friends…" : "Waiting for players…",
            `Starts at ${TEAM_MIN_PER_TEAM}v${TEAM_MIN_PER_TEAM} · ${count}, up to ${TEAM_SIZE}v${TEAM_SIZE}.${isPrivate ? " Send them the link." : ""}`,
          ];
  // Same rule as the server: after the move the teams differ by at most one.
  const other = t.you === TEAM_RED ? TEAM_BLUE : TEAM_RED;
  const mine = t.you === TEAM_RED ? t.red : t.blue;
  const theirs = t.you === TEAM_RED ? t.blue : t.red;
  const canSwitch = t.you !== NO_TEAM && Math.abs(mine - 1 - (theirs + 1)) <= 1;
  return (
    <CardBox name="waiting" wide>
      <HStack gap={3} align="start">
        {seconds === 0 && <Spinner size="lg" xstyle={styles.spinner} aria-label="Waiting" />}
        <VStack>
          {title ? (
            <Title name="waiting">{title}</Title>
          ) : (
            <Title name="waiting" xstyle={[shared.display, styles.countdown, shared.tabular]} testId="team-countdown">
              Starting in{" "}
              <Text as="span" color="inherit" xstyle={styles.countdownNumber}>
                {seconds}
              </Text>
            </Title>
          )}
          <Text color="secondary" xstyle={[styles.sub, shared.tabular]} data-testid="team-players">
            {sub}
          </Text>
        </VStack>
      </HStack>
      <Text as="p" xstyle={shared.eyebrow}>
        Teams
      </Text>
      <VStack xstyle={styles.teamsGrid}>
        {[TEAM_RED, TEAM_BLUE].map((team) => (
          <VStack key={team} gap={1}>
            <Text as="span" xstyle={[shared.display, styles.teamHead, slotText(TEAM_PAINT[team])]}>
              {TEAM_NAMES[team]}
              {t.you === team && (
                <Text as="span" xstyle={styles.teamYou}>
                  your team
                </Text>
              )}
            </Text>
            <Seats team={team} total={TEAM_SIZE} showAway />
          </VStack>
        ))}
      </VStack>
      {t.you !== NO_TEAM && (
        <HStack gap={2} align="center" xstyle={styles.switch}>
          <Button
            label={`Switch to ${TEAM_NAMES[other]}`}
            variant="secondary"
            isDisabled={!canSwitch}
            data-testid="switch-team"
            data-team={other}
            onClick={() => app.switchTeam(other)}
          />
          {!canSwitch && (
            <Text type="supporting" color="secondary" data-testid="switch-team-hint">
              Teams must stay even: you can switch when yours has one more.
            </Text>
          )}
        </HStack>
      )}
      <Text as="p" xstyle={shared.eyebrow}>
        Invite link
      </Text>
      <InviteLink />
      <Text as="p" xstyle={shared.eyebrow}>
        Your weapon
      </Text>
      <WeaponPicker />
      <GrenadePicker heading="Your grenade" />
      <PerkPicker heading="Your perk" />
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
  const spectating = useSelector(app, (s) => s.spectating);
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
            label={spectating ? "Stop watching" : "Leave match"}
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

/**
 * Why a tie for the most kills went the winner's way, for the result card:
 * "Won on damage dealt", "Won by reaching 18 kills first", "Won on a coin
 * flip" ("Red won ..." with teams). `score` is the tied kill score (the
 * winner's kills, or the winning team's score). Null when won outright.
 */
function tiebreakLine(reason: TiebreakReason, score: number, team: string | null): string | null {
  const won = team ? `${team} won` : "Won";
  // Battle royale: the last two went out on the same tick.
  if (reason === "kills") return "The last ones went down together: won on kills.";
  if (reason === "damage") return `${won} on damage dealt.`;
  if (reason === "first") return `${won} by reaching ${score} ${score === 1 ? "kill" : "kills"} first.`;
  if (reason === "lot") return `${won} on a coin flip.`;
  return null;
}

function ResultCard() {
  countRender("card.result");
  const { app, view, gesture } = useEngine();
  const staying = useSelector(app, (s) => s.staying);
  const won = useSelector(view, (v) => !!v?.snapshot && v.snapshot.winner === v.you);
  const tiebreak = useSelector(view, (v) => v?.snapshot?.tiebreak ?? "");
  const endDelay = useSelector(view, (v) => rulesOf(v?.snapshot?.mode ?? "duel").endDelay);
  const left = useSelector(view, (v) => Math.max(0, Math.ceil(endDelay - (performance.now() - (v?.endedAt ?? 0)) / 1000)));
  const model = useSelector(view, (v) => scoreboardModel(v?.snapshot ?? null, v?.you ?? ""), jsonEqual);
  // A battle royale's result reads like a free for all's: our place.
  const royale = model.mode === "royale";
  const ffa = model.mode === "ffa" || royale;
  const teams = model.teams;
  // Places recorded: a royale started with too few people isn't counted (bots don't count toward it).
  const counted = useSelector(view, (v) => {
    let humans = 0;
    v?.snapshot?.players.forEach((p) => (humans += p.bot ? 0 : 1));
    return royaleRecorded(humans);
  });
  // FFA: our place, the server's (every place is its own: no draws).
  const mine = model.rows.find((r) => r.you);
  // Teams: our team's result; a spectator (or a player without a team) reads which team won.
  const winner = teams?.find((t) => t.won) ?? null;
  const [headline, top] = teams
    ? !winner
      ? ["Match over", false]
      : model.youTeam === NO_TEAM
        ? [`${winner.name} team wins`, false]
        : winner.team === model.youTeam
          ? ["Your team wins!", true]
          : ["Your team lost", false]
    : !ffa
      ? [won ? "You win!" : "You lose", won]
      : !mine
        ? ["Match over", false]
        : mine.place === 1
          ? ["You won!", true]
          : [`You placed ${mine.placeLabel}`, false];
  const leader = ffa && mine?.place !== 1 ? model.rows[0] : null;
  // A tie broken: say how (the tied score is the winner's, or the winning team's).
  const why = teams
    ? winner && tiebreakLine(tiebreak, winner.score, winner.name)
    : tiebreakLine(tiebreak, model.rows.find((r) => r.place === 1)?.kills ?? 0, null);
  return (
    <CardBox name="result" wide={!staying}>
      <Title name="result" xstyle={[shared.display, styles.resultTitle, (ffa || !!teams) && styles.resultSmall, top && styles.resultWin]}>
        {headline}
      </Title>
      {teams && (
        <Text xstyle={[styles.resultSub, shared.tabular]} data-testid="result-teams" data-winner={winner?.team}>
          <Text as="span" color="inherit" weight="bold" xstyle={slotText(teams[0].slot)}>
            {teams[0].name} {teams[0].score}
          </Text>{" "}
          –{" "}
          <Text as="span" color="inherit" weight="bold" xstyle={slotText(teams[1].slot)}>
            {teams[1].score} {teams[1].name}
          </Text>
        </Text>
      )}
      {leader && (
        <Text xstyle={styles.resultSub} data-testid="result-winner">
          <Text as="span" color="inherit" weight="bold" xstyle={slotText(leader.slot)}>
            {leader.name}
          </Text>{" "}
          {royale ? "was the last one standing" : "won"} with {leader.kills} {leader.kills === 1 ? "kill" : "kills"}.
        </Text>
      )}
      {royale && (
        <Text color="secondary" xstyle={styles.resultSub} data-testid="result-stats">
          {counted
            ? "Places follow the order you went out in. 1st place counts as a win in your stats, any other place as a loss."
            : `Places follow the order you went out in. Not counted in the stats: it takes ${ROYALE_MIN_RECORDED} players, bots not included.`}
        </Text>
      )}
      {why && (
        <Text color="secondary" xstyle={styles.resultSub} data-testid="result-tiebreak" data-reason={tiebreak}>
          {why}
        </Text>
      )}
      <Text
        color="secondary"
        xstyle={[styles.resultSub, shared.tabular]}
        data-testid="result-countdown"
        // Battle royale: no Rematch to focus, and Enter must not land on Main menu: the card's focus goes here.
        {...(royale ? { tabIndex: -1, "data-autofocus": "" } : null)}
      >
        {royale
          ? // Battle royale: back to the lobby, where the host starts the next match.
            `Back to the lobby in ${left} s, where the host starts the next match.`
          : staying
            ? `Rematch in ${left} s, same game, next map.`
            : `Next match in ${left} s. Stay for a rematch, or head back to the menu.`}
      </Text>
      {!staying && (
        <>
          <VStack xstyle={styles.boardGap}>
            <Scoreboard model={model} label="Match result" flat rowTestId={ffa ? "placement-row" : undefined} />
          </VStack>
          {!royale && (
            <>
              <Text as="p" xstyle={shared.eyebrow}>
                Weapon for the next match
              </Text>
              <WeaponPicker />
              <GrenadePicker heading="Grenade for the next match" />
              <PerkPicker heading="Perk for the next match" />
            </>
          )}
        </>
      )}
      <HStack gap={2} wrap="wrap" xstyle={styles.actions}>
        {/* Battle royale: no Rematch. The room goes back to the lobby when the result is over, whatever you press. */}
        {!royale && (
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
        )}
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

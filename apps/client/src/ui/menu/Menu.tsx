// The menu screen (`/`): title, Play (quick duel), Free for all, Team deathmatch, Private game (duel, FFA or teams), How to play
// and Settings, the account chip and the open games list. The live 3D scene
// behind it is attract.ts. Shown while the flow is on the menu; during a
// quick match's join the joining card takes over (ui/game/Cards.tsx).

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { FFA_MAX_PLAYERS, FFA_MIN_PLAYERS, KILLS_TO_WIN, MAPS, TEAM_SIZE, type GameMode } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { openPanel } from "../../uiState.ts";
import { AccountChip } from "../account/AccountChip.tsx";
import { useEngine, useSelector, useStore } from "../hooks.ts";
import { KeyboardIcon, LockIcon } from "../icons.tsx";
import { shared } from "../styles.ts";
import { OpenGames } from "./OpenGames.tsx";

const PHONE = "@media (max-width: 760px)";

const styles = stylex.create({
  screen: {
    position: "fixed",
    inset: 0,
    zIndex: 20,
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(320px, 440px) 1fr minmax(280px, 330px)",
      "@media (max-width: 1100px)": "minmax(300px, 400px) 1fr minmax(260px, 300px)",
      [PHONE]: "minmax(0, 1fr)",
    },
    alignContent: { default: "stretch", [PHONE]: "start" },
    gap: { default: "var(--spacing-6)", [PHONE]: "var(--spacing-5)" },
    padding: {
      default: "clamp(24px, 6vh, 64px) clamp(24px, 4vw, 64px) clamp(20px, 4vh, 40px)",
      [PHONE]: "28px 16px 24px",
    },
    overflowY: "auto",
    // A surface under the text, darkest behind the title and the buttons.
    backgroundImage: {
      default:
        "linear-gradient(90deg, rgba(10, 11, 16, 0.78) 0%, rgba(10, 11, 16, 0.45) 30%, rgba(10, 11, 16, 0) 55%), linear-gradient(0deg, rgba(10, 11, 16, 0.5) 0%, rgba(10, 11, 16, 0) 22%)",
      [PHONE]: "linear-gradient(180deg, rgba(10, 11, 16, 0.55) 0%, rgba(10, 11, 16, 0.78) 45%, rgba(10, 11, 16, 0.9) 100%)",
    },
  },
  main: {
    gridColumn: "1",
    gap: { default: "28px", [PHONE]: "20px" },
    minHeight: { default: "100%", [PHONE]: 0 },
  },
  side: {
    gridColumn: { default: "3", [PHONE]: "1" },
    alignSelf: "start",
  },
  title: {
    margin: 0,
    fontSize: { default: "clamp(60px, 8.4vw, 112px)", [PHONE]: "clamp(52px, 17vw, 84px)" },
    lineHeight: 0.9,
    letterSpacing: "0.01em",
    color: "var(--bagarre-sand)",
    // A stamped, extruded block: six steps of burnt orange, then a soft drop.
    textShadow:
      "0 1px 0 #e0853a, 0 2px 0 #d0702a, 0 3px 0 #bd5d1d, 0 4px 0 #a64c14, 0 5px 0 #8c3e0f, 0 6px 0 #6e300b, 0 16px 26px rgba(0, 0, 0, 0.55)",
  },
  tagline: {
    fontSize: { default: "17px", [PHONE]: "15px" },
    fontWeight: 600,
    maxWidth: "34ch",
  },
  actions: { maxWidth: { default: "400px", [PHONE]: "none" } },
  row: { display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: "var(--spacing-3)" },
  rowEven: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" },
  fill: { width: "100%" },
  play: {
    height: "auto",
    minHeight: 0,
    justifyContent: "flex-start",
    padding: "14px 22px 16px",
    borderRadius: "10px",
    color: "var(--color-on-accent)",
    backgroundColor: {
      default: "var(--bagarre-p0)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-p0-hover)" },
    },
    boxShadow: {
      default: "inset 0 -4px 0 rgba(0, 0, 0, 0.22), 0 14px 28px -14px rgba(0, 0, 0, 0.8)",
      ":active": "inset 0 -2px 0 rgba(0, 0, 0, 0.22), 0 10px 20px -12px rgba(0, 0, 0, 0.8)",
    },
    transform: { default: "none", ":active": "translateY(2px)" },
  },
  playLabel: { fontSize: "40px", lineHeight: 1 },
  // Free for all: the blue twin of Play, a size down.
  ffa: {
    color: "var(--bagarre-on-p1)",
    backgroundColor: {
      default: "var(--bagarre-p1)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-p1-hover)" },
    },
  },
  // Team deathmatch: the red team's colour, a size down again.
  tdm: {
    color: "var(--color-on-accent)",
    padding: "10px 18px 12px",
    backgroundColor: {
      default: "var(--bagarre-p6)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-p6-hover)" },
    },
  },
  tdmLabel: { fontSize: "22px", lineHeight: 1, whiteSpace: "normal", textAlign: "start", overflow: "visible" },
  // Wraps to two lines ("Free for / all") rather than being cut off in the narrow button.
  ffaLabel: { fontSize: "24px", lineHeight: 1, whiteSpace: "normal", textAlign: "start", overflow: "visible" },
  playSub: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    opacity: 0.78,
    color: "inherit",
  },
  wide: {
    height: "auto",
    justifyContent: "flex-start",
    padding: "11px 16px",
    backgroundColor: {
      default: "var(--bagarre-hud-panel)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-hud-panel-hover)" },
    },
  },
  links: { marginInlineStart: "-6px" },
  touch: {
    maxWidth: "380px",
    padding: "10px 12px",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--color-warning-muted)",
    color: "var(--color-text-yellow)",
  },
  maps: {
    marginBlockStart: { default: "auto", [PHONE]: 0 },
    maxWidth: "44ch",
    color: "rgba(242, 242, 242, 0.5)",
  },
  mapsCount: { color: "var(--color-text-secondary)", fontWeight: 700 },
  loading: { color: "rgba(242, 242, 242, 0.5)" },
});

/** A phone or tablet (no fine pointer), or a window too small to play in. */
function isTouchOrSmall(): boolean {
  const coarse = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
  return coarse || innerWidth < 760 || innerHeight < 480;
}

const subscribeResize = (fn: () => void) => {
  addEventListener("resize", fn);
  return () => removeEventListener("resize", fn);
};

/** Set once the flow has been anywhere but the menu: from then on, the menu focuses Play when it comes back. */
let leftMenuOnce = false;

/** The `/` route's page: the menu while the flow is on it. */
export function MenuScreen() {
  const { app } = useEngine();
  const onMenu = useSelector(app, (s) => s.screen === "menu");
  if (!onMenu) leftMenuOnce = true;
  return onMenu ? <Menu focusPlay={leftMenuOnce} /> : null;
}

function Menu({ focusPlay }: { focusPlay: boolean }) {
  const { app, lobby, loading, gesture } = useEngine();
  const progress = useStore(loading);
  const touch = useSyncExternalStore(subscribeResize, isTouchOrSmall);
  const play = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusPlay) play.current?.focus({ preventScroll: true });
  }, [focusPlay]);

  // The open games list polls only while the menu is up.
  useEffect(() => {
    lobby.watch(true);
    return () => lobby.watch(false);
  }, [lobby]);

  const panel = (name: "howto" | "settings") => () => {
    gesture();
    openPanel(name);
  };

  return (
    <VStack as="main" aria-label="Main menu" data-testid="menu" xstyle={styles.screen}>
      <VStack xstyle={styles.main}>
        <VStack as="header" gap={2}>
          <Heading level={1} xstyle={[shared.display, styles.title]}>
            Bagarre
          </Heading>
          <Text color="secondary" xstyle={styles.tagline}>
            Isometric 1v1 duels, first to {KILLS_TO_WIN} kills. Or a free for all, up to {FFA_MAX_PLAYERS} players, or red
            against blue, up to {TEAM_SIZE}v{TEAM_SIZE}.
          </Text>
        </VStack>

        {touch && (
          <HStack gap={2} align="start" xstyle={styles.touch} data-testid="touch-note">
            <Icon icon={KeyboardIcon} size="md" />
            <Text color="inherit">
              Bagarre is played with a keyboard and a mouse. Have a look around here, then come back on a computer to
              play.
            </Text>
          </HStack>
        )}

        <VStack gap={3} xstyle={styles.actions}>
          <VStack xstyle={styles.row}>
            <Button
              ref={play}
              label="Play: quick match"
              variant="primary"
              size="lg"
              xstyle={[styles.play, styles.fill]}
              data-testid="play"
              onClick={() => {
                gesture();
                app.quickMatch();
              }}
            >
              <VStack as="span" gap={0.5} align="start">
                <Text xstyle={[shared.display, styles.playLabel]} color="inherit">
                  Play
                </Text>
                <Text xstyle={styles.playSub}>Quick duel</Text>
              </VStack>
            </Button>
            <Button
              label="Free for all: quick match"
              variant="primary"
              size="lg"
              xstyle={[styles.play, styles.ffa, styles.fill]}
              data-testid="play-ffa"
              onClick={() => {
                gesture();
                app.quickMatch("ffa");
              }}
            >
              <VStack as="span" gap={1} align="start">
                <Text xstyle={[shared.display, styles.ffaLabel]} color="inherit">
                  Free for all
                </Text>
                <Text xstyle={styles.playSub}>
                  {FFA_MIN_PLAYERS} to {FFA_MAX_PLAYERS} players
                </Text>
              </VStack>
            </Button>
          </VStack>
          <VStack xstyle={styles.row}>
            <Button
              label={`Team deathmatch: quick match, up to ${TEAM_SIZE}v${TEAM_SIZE}`}
              variant="primary"
              size="lg"
              xstyle={[styles.play, styles.tdm, styles.fill]}
              data-testid="play-tdm"
              onClick={() => {
                gesture();
                app.quickMatch("tdm");
              }}
            >
              <VStack as="span" gap={1} align="start">
                <Text xstyle={[shared.display, styles.tdmLabel]} color="inherit">
                  Team deathmatch
                </Text>
                <Text xstyle={styles.playSub}>
                  Up to {TEAM_SIZE}v{TEAM_SIZE}
                </Text>
              </VStack>
            </Button>
            <PrivateButton mode="tdm" />
          </VStack>
          <VStack xstyle={[styles.row, styles.rowEven]}>
            <PrivateButton mode="duel" />
            <PrivateButton mode="ffa" />
          </VStack>
          <HStack gap={1} xstyle={styles.links}>
            <Button label="How to play" variant="ghost" aria-haspopup="dialog" data-testid="open-howto" onClick={panel("howto")} />
            <Button label="Settings" variant="ghost" aria-haspopup="dialog" data-testid="open-settings" onClick={panel("settings")} />
          </HStack>
          {progress !== null && (
            <Text type="supporting" xstyle={[styles.loading, shared.tabular]} data-testid="menu-loading">
              Loading the arena… {Math.round(progress * 100)}%
            </Text>
          )}
        </VStack>

        <Text type="supporting" xstyle={styles.maps}>
          <Text as="span" type="supporting" xstyle={styles.mapsCount}>
            {MAPS.length} maps
          </Text>{" "}
          {MAPS.map((m) => m.name).join(" · ")}
        </Text>
      </VStack>

      <VStack as="aside" gap={3} xstyle={styles.side}>
        <AccountChip />
        <OpenGames />
      </VStack>
    </VStack>
  );
}

const PRIVATE = {
  duel: { title: "Private game", short: "Private game", sub: "Duel a friend with a link", testId: "private-game" },
  ffa: { title: "Private free for all", short: "Private FFA", sub: `Up to ${FFA_MAX_PLAYERS}, with a link`, testId: "private-ffa" },
  tdm: { title: "Private team deathmatch", short: "Private teams", sub: `Up to ${TEAM_SIZE}v${TEAM_SIZE}, with a link`, testId: "private-tdm" },
} as const;

/** Private game of a mode: a room joined by its link only. */
function PrivateButton({ mode }: { mode: GameMode }) {
  const { app, gesture } = useEngine();
  const p = PRIVATE[mode];
  return (
    <Button
      label={p.title}
      variant="secondary"
      size="lg"
      xstyle={[styles.wide, styles.fill]}
      data-testid={p.testId}
      icon={<Icon icon={LockIcon} size="sm" />}
      onClick={() => {
        gesture();
        app.privateGame(mode);
      }}
    >
      <VStack as="span" gap={0.5} align="start">
        <Text weight="semibold" color="inherit">
          {p.short}
        </Text>
        <Text type="supporting" color="secondary">
          {p.sub}
        </Text>
      </VStack>
    </Button>
  );
}

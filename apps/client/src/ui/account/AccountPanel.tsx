// The account panel: who you play as, Clerk's sign-in and user button, the
// username form (Convex `users.claimUsername`) and your stats (`users.me`).
// The Clerk side lives in ClerkRoot.tsx; this reads the account store.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { USERNAME_MAX, USERNAME_MIN, usernameError } from "@bagarre/backend/username";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { account, type Profile } from "../../auth.ts";
import { closePanel, ui } from "../../uiState.ts";
import { useSelector, useStore } from "../hooks.ts";
import { shared } from "../styles.ts";
import { describeAccount, kd } from "./describe.ts";

const styles = stylex.create({
  panel: { userSelect: "text" },
  name: { fontSize: "22px", fontWeight: 800, letterSpacing: "-0.01em", overflowWrap: "anywhere" },
  line: { maxWidth: "46ch" },
  stats: {
    gridTemplateColumns: {
      default: "repeat(5, minmax(0, 1fr))",
      "@media (max-width: 520px)": "repeat(3, minmax(0, 1fr))",
    },
  },
  stat: {
    padding: "10px 12px",
    borderRadius: "var(--radius-element)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  statValue: { fontSize: "24px", fontWeight: 800, lineHeight: 1.1 },
  statLabel: { fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" },
  field: { flexGrow: 1, minWidth: 0 },
  // Level with the input, under its label.
  save: { marginBlockStart: "calc(var(--text-label-size) * var(--text-label-leading) + var(--spacing-1))" },
  slot: { flexShrink: 0 },
});

function Stats({ profile }: { profile: Profile }) {
  const st = profile.stats;
  const items: [string, string][] = [
    ["Wins", String(st.wins)],
    ["Losses", String(st.losses)],
    ["Kills", String(st.kills)],
    ["K/D", kd(st.kills, st.deaths)],
    ["Matches", String(st.matches)],
  ];
  return (
    <Grid gap={2} xstyle={styles.stats} data-testid="account-stats">
      {items.map(([label, value]) => (
        <VStack key={label} gap={0.5} xstyle={styles.stat}>
          <Text xstyle={[styles.statValue, shared.tabular]}>{value}</Text>
          <Text color="secondary" xstyle={styles.statLabel}>
            {label}
          </Text>
        </VStack>
      ))}
    </Grid>
  );
}

function UsernameForm({ current, onDone }: { current: string | null; onDone: () => void }) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    const name = value.trim();
    const invalid = usernameError(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError("");
    const res = await account.claimUsername(name);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onDone();
  };

  return (
    <VStack
      as="form"
      gap={2}
      data-testid="username-form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <HStack gap={2} align="start">
        <VStack xstyle={styles.field}>
          <TextInput
          label={current ? "New username" : "Choose your username"}
          value={value}
          onChange={(v) => {
            setValue(v);
            const t = v.trim();
            setError(t ? (usernameError(t) ?? "") : "");
          }}
          placeholder={`${USERNAME_MIN}-${USERNAME_MAX} letters, digits or _`}
          autoComplete="username"
          htmlName="username"
          hasAutoFocus
          status={error ? { type: "error", message: error } : undefined}
          statusVariant="detached"
          width="100%"
          data-testid="username-input"
          />
        </VStack>
        <Button
          label="Save"
          type="submit"
          isLoading={saving}
          xstyle={[shared.blueButton, styles.save]}
          data-testid="username-save"
        />
      </HStack>
    </VStack>
  );
}

export function AccountPanel() {
  const s = useStore(account);
  const forced = useSelector(ui, (u) => u.forceUsernameForm);
  const { name, line, needsUsername } = describeAccount(s);
  const profile = s.status === "signedIn" ? s.profile : null;
  const [renaming, setRenaming] = useState(false);
  // The dev-forced form (window.__bagarre.accountUi.forceUsernameForm) shows whatever the state.
  const showForm = needsUsername || (renaming && !!profile) || (forced && !profile);

  // Where ClerkRoot portals Clerk's user button.
  const slot = useRef<HTMLElement>(null);
  const signedIn = s.status === "signedIn";
  useEffect(() => {
    if (!signedIn) return;
    account.userButtonSlot.set(slot.current);
    return () => account.userButtonSlot.set(null);
  }, [signedIn]);

  return (
    <VStack gap={5} xstyle={styles.panel} data-testid="account-panel">
      <HStack gap={4} justify="between" align="center">
        <VStack gap={1}>
          <Text xstyle={styles.name} data-testid="account-name">
            {name}
          </Text>
          <Text color="secondary" xstyle={styles.line} data-testid="account-line">
            {line}
          </Text>
        </VStack>
        {signedIn && <HStack as="span" ref={slot} xstyle={styles.slot} data-testid="account-user-button" />}
      </HStack>

      {s.notice && (
        <Banner
          status="warning"
          title={s.notice}
          isDismissable
          onDismiss={() => account.setNotice("")}
          data-testid="account-notice"
        />
      )}

      {profile && <Stats profile={profile} />}

      {showForm && (
        <UsernameForm
          current={profile?.username ?? null}
          onDone={() => {
            setRenaming(false);
            ui.patch({ forceUsernameForm: false });
          }}
        />
      )}

      {(s.status === "signedOut" || profile) && (
        <HStack gap={2} wrap="wrap">
          {s.status === "signedOut" && (
            <Button
              label="Sign in"
              xstyle={shared.blueButton}
              data-testid="sign-in"
              onClick={() => {
                // Our panel is a modal <dialog>: everything outside it, Clerk's
                // modal included, would be inert. Close it first.
                closePanel();
                account.openSignIn();
              }}
            />
          )}
          {profile && (
            <Button
              label={renaming ? "Cancel" : "Change username"}
              variant="ghost"
              data-testid="rename"
              onClick={() => setRenaming((r) => !r)}
            />
          )}
        </HStack>
      )}
    </VStack>
  );
}

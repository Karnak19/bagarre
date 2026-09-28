// The account panel: who you play as, and every account screen but the
// password reset page (routes/reset-password.tsx): sign in, sign up, forgot
// password, choose a username, your stats, your skin (SkinPicker.tsx) and
// sign out. It reads and drives the account store (auth.ts), which talks to
// the game server.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, usernameError, type Stats as StatsData } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { account } from "../../auth.ts";
import { ui } from "../../uiState.ts";
import { useSelector, useStore } from "../hooks.ts";
import { shared } from "../styles.ts";
import { describeAccount, kd } from "./describe.ts";
import { SkinPicker } from "./SkinPicker.tsx";

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
  formTitle: { fontSize: "16px", fontWeight: 800 },
  links: { marginInlineStart: "-10px" },
});

function Stats({ stats }: { stats: StatsData }) {
  const items: [string, string][] = [
    ["Wins", String(stats.wins)],
    ["Losses", String(stats.losses)],
    ["Kills", String(stats.kills)],
    ["K/D", kd(stats.kills, stats.deaths)],
    ["Matches", String(stats.matches)],
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
            autoComplete="off"
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

type AuthView = "signIn" | "signUp" | "forgot";

const VIEWS: Record<AuthView, { title: string; submit: string; testId: string }> = {
  signIn: { title: "Sign in", submit: "Sign in", testId: "sign-in" },
  signUp: { title: "Create an account", submit: "Create account", testId: "sign-up" },
  forgot: { title: "Reset your password", submit: "Send the reset link", testId: "forgot-password" },
};

/** Sign in, sign up and forgot password: one form, three views. */
function AuthForms() {
  const discord = useSelector(account, (s) => s.providers.discord);
  const [view, setView] = useState<AuthView>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = VIEWS[view];

  const go = (next: AuthView) => {
    setView(next);
    setError("");
    setSent(false);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    let err: string | null;
    if (view === "signIn") err = await account.signIn(email, password);
    else if (view === "signUp") err = await account.signUp(email, password);
    else {
      err = await account.forgotPassword(email);
      if (!err) setSent(true);
    }
    setBusy(false);
    if (err) setError(err);
  };

  const discordSignIn = async () => {
    setBusy(true);
    setError("");
    const err = await account.signInWithDiscord();
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <VStack gap={4}>
      <VStack
        as="form"
        gap={3}
        data-testid={v.testId}
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Text xstyle={styles.formTitle}>{v.title}</Text>
        {view === "forgot" && (
          <Text color="secondary" xstyle={styles.line}>
            Enter your account's email: we'll send you a link to set a new password.
          </Text>
        )}
        <TextInput
          type="email"
          label="Email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          htmlName="email"
          width="100%"
          data-testid="auth-email"
        />
        {view !== "forgot" && (
          <TextInput
            type="password"
            label="Password"
            description={view === "signUp" ? `At least ${PASSWORD_MIN} characters.` : undefined}
            value={password}
            onChange={setPassword}
            autoComplete={view === "signUp" ? "new-password" : "current-password"}
            htmlName="password"
            width="100%"
            data-testid="auth-password"
          />
        )}
        {error && <Banner status="error" title={error} data-testid="auth-error" />}
        {sent && (
          <Banner
            status="success"
            title="If an account uses that email, a reset link is on its way. It works for 30 minutes."
            data-testid="auth-sent"
          />
        )}
        <HStack gap={2} wrap="wrap" align="center">
          <Button label={v.submit} type="submit" isLoading={busy} xstyle={shared.blueButton} data-testid="auth-submit" />
          <HStack gap={0} wrap="wrap" xstyle={styles.links}>
            {view === "signIn" && (
              <>
                <Button label="Create an account" variant="ghost" data-testid="auth-to-sign-up" onClick={() => go("signUp")} />
                <Button label="Forgot password?" variant="ghost" data-testid="auth-forgot" onClick={() => go("forgot")} />
              </>
            )}
            {view === "signUp" && (
              <Button label="I already have an account" variant="ghost" data-testid="auth-to-sign-in" onClick={() => go("signIn")} />
            )}
            {view === "forgot" && (
              <Button label="Back to sign in" variant="ghost" data-testid="auth-to-sign-in" onClick={() => go("signIn")} />
            )}
          </HStack>
        </HStack>
      </VStack>
      {discord && view !== "forgot" && (
        <>
          <Divider label="or" />
          <Button
            label="Continue with Discord"
            variant="secondary"
            isLoading={busy}
            data-testid="auth-discord"
            onClick={() => void discordSignIn()}
          />
        </>
      )}
    </VStack>
  );
}

export function AccountPanel() {
  const s = useStore(account);
  const forced = useSelector(ui, (u) => u.forceUsernameForm);
  const { name, line, needsUsername } = describeAccount(s);
  const acc = s.status === "signedIn" ? s.account : null;
  const [renaming, setRenaming] = useState(false);
  // The dev-forced form (window.__bagarre.accountUi.forceUsernameForm) shows whatever the state.
  const showForm = needsUsername || (renaming && !!acc?.username) || (forced && !acc);

  // Fresh stats each time the panel opens.
  useEffect(() => {
    if (account.state.status === "signedIn") void account.refresh();
  }, []);

  return (
    <VStack gap={5} xstyle={styles.panel} data-testid="account-panel">
      <VStack gap={1}>
        <Text xstyle={styles.name} data-testid="account-name">
          {name}
        </Text>
        <Text color="secondary" xstyle={styles.line} data-testid="account-line">
          {line}
        </Text>
        {acc?.email && (
          <Text type="supporting" color="secondary" data-testid="account-email">
            {acc.email}
          </Text>
        )}
      </VStack>

      {s.notice && (
        <Banner
          status="warning"
          title={s.notice}
          isDismissable
          onDismiss={() => account.setNotice("")}
          data-testid="account-notice"
        />
      )}

      {acc?.username && <Stats stats={acc.stats} />}

      {showForm && (
        <UsernameForm
          current={acc?.username ?? null}
          onDone={() => {
            setRenaming(false);
            ui.patch({ forceUsernameForm: false });
          }}
        />
      )}

      {s.status === "signedOut" && !forced && <AuthForms />}

      {!forced && <SkinPicker />}

      {(acc || s.status === "error") && (
        <HStack gap={2} wrap="wrap">
          {acc?.username && (
            <Button
              label={renaming ? "Cancel" : "Change username"}
              variant="ghost"
              data-testid="rename"
              onClick={() => setRenaming((r) => !r)}
            />
          )}
          {s.status === "error" && (
            <Button label="Try again" variant="secondary" data-testid="account-retry" onClick={() => void account.refresh()} />
          )}
          <Button label="Sign out" variant="ghost" data-testid="sign-out" onClick={() => void account.signOut()} />
        </HStack>
      )}
    </VStack>
  );
}

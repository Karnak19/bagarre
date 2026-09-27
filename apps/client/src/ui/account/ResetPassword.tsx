// The password reset page (`/reset-password?token=...`), where the reset
// email lands: a new password, twice, then a way back to the menu or to the
// account panel to sign in with it.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { PASSWORD_MIN } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { account } from "../../auth.ts";
import { openPanel } from "../../uiState.ts";

const styles = stylex.create({
  screen: {
    position: "fixed",
    inset: 0,
    zIndex: 20,
    display: "grid",
    placeItems: "center",
    padding: "16px",
    overflowY: "auto",
    backgroundColor: "rgba(8, 9, 12, 0.55)",
  },
  card: {
    width: "min(440px, 100%)",
    padding: "22px 24px 20px",
    borderWidth: 0,
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-card)",
    boxShadow: "var(--shadow-med)",
  },
  title: { margin: 0, fontSize: "22px", fontWeight: 800, letterSpacing: "-0.01em" },
});

export function ResetPasswordScreen() {
  const { token } = useSearch({ from: "/reset-password" });
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const toMenu = (signIn: boolean) =>
    void navigate({ to: "/", search: (s) => ({ ...s, token: undefined }) }).then(() => signIn && openPanel("account"));

  const submit = async () => {
    if (busy || !token) return;
    if (password.length < PASSWORD_MIN) return setError(`Passwords need at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const res = await account.resetPassword(token, password);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setDone(true);
    // The reset signs every session of that account out: check ours.
    if (account.state.status !== "signedOut") void account.refresh();
  };

  return (
    <VStack as="main" aria-label="Reset your password" xstyle={styles.screen} data-testid="reset-password">
      <Card xstyle={styles.card}>
        <VStack gap={4}>
          <Heading level={1} xstyle={styles.title}>
            {done ? "Password changed" : "Set a new password"}
          </Heading>
          {!token ? (
            <Banner
              status="error"
              title="This link is missing its reset token. Ask for a new one from the account panel."
              data-testid="reset-password-error"
            />
          ) : done ? (
            <Text color="secondary" data-testid="reset-password-done">
              You can sign in with your new password now.
            </Text>
          ) : (
            <VStack
              as="form"
              gap={3}
              data-testid="reset-password-form"
              onSubmit={(e: React.FormEvent) => {
                e.preventDefault();
                void submit();
              }}
            >
              <TextInput
                type="password"
                label="New password"
                description={`At least ${PASSWORD_MIN} characters.`}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                htmlName="password"
                hasAutoFocus
                width="100%"
                data-testid="reset-password-input"
              />
              <TextInput
                type="password"
                label="Same password again"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                htmlName="confirm"
                width="100%"
                data-testid="reset-password-confirm"
              />
              {error && <Banner status="error" title={error} data-testid="reset-password-error" />}
              <HStack>
                <Button label="Set the password" type="submit" variant="primary" isLoading={busy} data-testid="reset-password-submit" />
              </HStack>
            </VStack>
          )}
          <HStack gap={2} wrap="wrap">
            {(done || !token) && (
              <Button label="Sign in" variant="primary" data-testid="reset-password-sign-in" onClick={() => toMenu(true)} />
            )}
            <Button label="Back to the menu" variant="ghost" data-testid="reset-password-back" onClick={() => toMenu(false)} />
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordScreen } from "../ui/account/ResetPassword.tsx";

// `/reset-password?token=...`, where the password reset email links to
// (RESET_PASSWORD_PAGE in @bagarre/shared). Over the menu's attract scene,
// like the menu itself: entering it leaves any game.
export const Route = createFileRoute("/reset-password")({
  validateSearch: (raw: Record<string, unknown>): { token?: string } => {
    const t = raw.token;
    return typeof t === "string" && t ? { token: t } : typeof t === "number" ? { token: String(t) } : {};
  },
  onEnter: ({ context }) => context.engine.app.routeMenu(),
  component: ResetPasswordScreen,
});

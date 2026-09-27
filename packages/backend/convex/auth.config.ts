import type { AuthConfig } from "convex/server";

// Clerk issues the tokens. CLERK_JWT_ISSUER_DOMAIN is the Clerk Frontend API
// URL (https://<something>.clerk.accounts.dev in development), set in the
// Convex deployment env (`bunx convex env set CLERK_JWT_ISSUER_DOMAIN=...`);
// a push fails while it's unset. `applicationID: "convex"` means the token must
// carry `aud: "convex"`, which the Clerk "convex" JWT template (or Clerk's
// Convex integration) provides.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;

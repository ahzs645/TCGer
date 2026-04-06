import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { demoAwareFetch } from "./demo-mode";
import { resolvePublicSiteOrigin } from "./utils";

export const authClient = createAuthClient({
  baseURL: resolvePublicSiteOrigin(),
  basePath: "/api/auth",
  fetchOptions: {
    customFetchImpl: demoAwareFetch,
  },
  plugins: [convexClient(), usernameClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { demoAwareFetch } from "./demo-mode";
import { resolvePublicSiteOrigin } from "./utils";
import { authLifecycleFetch } from "./auth-lifecycle";

export const authClient = createAuthClient({
  baseURL: resolvePublicSiteOrigin(),
  basePath: "/api/auth",
  fetchOptions: {
    customFetchImpl: (input, init) =>
      authLifecycleFetch(demoAwareFetch, input, init),
  },
  plugins: [convexClient(), usernameClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

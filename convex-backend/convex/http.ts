import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return Response.json({
      status: "ok",
      backend: "convex-native",
      capabilities: ["users", "binders", "collections", "tags"]
    });
  })
});

export default http;

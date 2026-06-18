import fastify, { type FastifyInstance } from "fastify";
import type { ControlPlane } from "../core/control-plane.js";
import { definedEntries } from "../core/defined.js";
import { NotFoundError } from "../core/errors.js";

export interface DaemonAppOptions {
  plane: ControlPlane;
}

export const createDaemonApp = ({ plane }: DaemonAppOptions): FastifyInstance => {
  const app = fastify({ logger: false });

  // Use typed error classes for HTTP status detection instead of string matching.
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof NotFoundError ? 404 : 400;
    reply.status(status).send({ error: { message } });
  });

  app.get("/status", async () => ({
    status: "ok",
    adapters: plane.listAdapters().adapters
  }));

  app.post("/sessions", async (request) => plane.createSession(request.body as Parameters<ControlPlane["createSession"]>[0]));

  app.post("/task-groups", async (request) =>
    plane.submitTaskGroup(request.body as Parameters<ControlPlane["submitTaskGroup"]>[0])
  );

  app.get("/tasks", async (request) => {
    const query = request.query as { session_id?: string; group_id?: string };
    return plane.queryTasks(query);
  });

  app.get("/tasks/:task_id/result", async (request) => {
    const params = request.params as { task_id: string };
    const query = request.query as { attempt_id?: string };
    return plane.getTaskResult(definedEntries({ task_id: params.task_id, attempt_id: query.attempt_id }) as {
      task_id: string;
      attempt_id?: string;
    });
  });

  app.get("/tasks/:task_id/logs", async (request) => {
    const params = request.params as { task_id: string };
    const query = request.query as { attempt_id?: string; max_bytes?: string };
    return plane.getTaskLogs(definedEntries({
      task_id: params.task_id,
      attempt_id: query.attempt_id,
      max_bytes: query.max_bytes ? Number(query.max_bytes) : undefined
    }) as { task_id: string; attempt_id?: string; max_bytes?: number });
  });

  app.get("/artifacts", async (request) => {
    const query = request.query as { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string };
    return plane.listArtifacts(query);
  });

  app.get("/artifacts/by-uri", async (request) => {
    const query = request.query as { resource_uri: string; include_path?: string };
    return plane.getArtifact({ resource_uri: query.resource_uri, include_path: query.include_path === "true" });
  });

  app.get("/sessions/:session_id/digest", async (request) => {
    const params = request.params as { session_id: string };
    return plane.getSessionDigest({ session_id: params.session_id });
  });

  app.post("/cancel", async (request) => plane.cancelTasks(request.body as Parameters<ControlPlane["cancelTasks"]>[0]));

  app.get("/adapters", async () => plane.listAdapters());

  return app;
};

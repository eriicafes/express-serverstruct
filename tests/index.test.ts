import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bootstrap,
  context,
  controller,
  Controller,
  createRoutes,
  createServer,
  errorHandler,
  group,
  handler,
  HTTPError,
  jsonRequest,
  jsonResponse,
  openapi,
  type OpenAPIDocumentOptions,
  openapiRoutes,
  router,
  type Routes,
  schemas,
  type Server,
  validate,
} from "../src";

function testServer(
  routes: Routes,
  openapiOptions?: OpenAPIDocumentOptions,
): Server {
  return createServer({
    routes: () => routes,
    configure(app) {
      app.use(express.json());
      return {
        port: 0,
        openapi: openapiOptions,
      };
    },
    onNotFound() {
      return handler(() => {
        throw HTTPError.status(404, "Not found");
      });
    },
    onError() {
      return errorHandler((error, _req, res, _next) => {
        if (error instanceof HTTPError) {
          return res.status(error.status).json(error.toJSON());
        }
        res.status(500).json({
          message:
            error instanceof Error ? error.message : "Unexpected server error",
        });
      });
    },
    async onStart() {},
  });
}

describe("core api", () => {
  it("creates routes from a value or factory", () => {
    const routes = router("/", () => {});

    expect(createRoutes(routes)).toBe(routes);
    expect(createRoutes(() => routes)).toBe(routes);
  });

  it("creates a server from a value or factory", () => {
    const server = testServer(router("/", () => {}));

    expect(createServer(server)).toBe(server);
    expect(createServer(() => server)).toBe(server);
  });
});

describe("routing", () => {
  it("mounts grouped routes and controller routes", async () => {
    class UsersController implements Controller {
      public routes() {
        return router("/users", (app) => {
          app.get("/", this.listUsers());
        });
      }

      private listUsers() {
        return handler((_req, res) => {
          res.json([{ id: "1" }]);
        });
      }
    }

    const healthRoutes = router("/health", (app) => {
      app.get(
        "/",
        handler((_req, res) => {
          res.json({ ok: true });
        }),
      );
    });

    const { app } = bootstrap(
      testServer(
        group("/api", healthRoutes, controller(new UsersController())),
      ),
    );

    const healthResponse = await request(app).get("/api/health");
    const usersResponse = await request(app).get("/api/users");

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toEqual({ ok: true });
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body).toEqual([{ id: "1" }]);
  });

  it("mounts nested routes through the router mount callback", async () => {
    const childRoutes = router("/child", (app) => {
      app.get(
        "/",
        handler((_req, res) => {
          res.json({ ok: true });
        }),
      );
    });

    const parentRoutes = router("/parent", (_app, mount) => {
      mount(childRoutes);
    });

    const { app } = bootstrap(testServer(parentRoutes));
    const response = await request(app).get("/parent/child");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns terminal not-found responses through HTTPError", async () => {
    const { app } = bootstrap(testServer(router("/", () => {})));
    const response = await request(app).get("/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      status: 404,
      code: undefined,
      message: "Not found",
      errors: undefined,
    });
  });
});

describe("error handling", () => {
  it("forwards thrown handler errors to the terminal error middleware", async () => {
    const routes = router("/", (app) => {
      app.get(
        "/boom",
        handler(() => {
          throw new Error("boom");
        }),
      );
    });

    const { app } = bootstrap(testServer(routes));
    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "boom" });
  });

  it("forwards thrown error-handler errors to the terminal error middleware", async () => {
    const routes = router("/", (app) => {
      app.get(
        "/boom",
        handler(() => {
          throw new Error("boom");
        }),
      );

      app.use(
        errorHandler(() => {
          throw new Error("secondary");
        }),
      );
    });

    const { app } = bootstrap(testServer(routes));
    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "secondary" });
  });
});

describe("validation", () => {
  it("validates params, query, and body with validate()", async () => {
    const routes = router("/", (app) => {
      app.post(
        "/orgs/:orgId/users",
        handler((req, res) => {
          const input = validate(req, {
            params: z.object({ orgId: z.string() }),
            query: z.object({ active: z.string() }),
            body: z.object({ name: z.string() }),
          });

          res.status(201).json(input);
        }),
      );
    });

    const { app } = bootstrap(testServer(routes));
    const response = await request(app)
      .post("/orgs/acme/users?active=true")
      .send({ name: "Ada" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      params: { orgId: "acme" },
      query: { active: "true" },
      body: { name: "Ada" },
    });
  });

  it("surfaces validation failures as HTTPError responses", async () => {
    const routes = router("/", (app) => {
      app.post(
        "/users/:id",
        handler((req, res) => {
          validate(req, {
            params: z.object({ id: z.string().uuid() }),
            body: z.object({ name: z.string().min(2) }),
          });

          res.status(204).end();
        }),
      );
    });

    const { app } = bootstrap(testServer(routes));
    const response = await request(app)
      .post("/users/not-a-uuid")
      .send({ name: "" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Failed to validate params");
    expect(response.body.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "id" })]),
    );
  });
});

describe("context", () => {
  it("throws the configured error when get() is called before set()", () => {
    const currentUser = context<{ id: string }>({
      onError: "Missing authenticated user",
    });

    expect(() => currentUser.get({} as any)).toThrow(
      "Missing authenticated user",
    );
  });

  it("returns undefined from lookup() when the value is missing", () => {
    const currentUser = context<{ id: string }>();

    expect(currentUser.lookup({} as any)).toBeUndefined();
  });

  it("stores request-scoped values with context()", async () => {
    const currentUser = context<{ id: string }>({
      onError: "Missing authenticated user",
    });

    const routes = router("/", (app) => {
      app.use(
        handler((req, _res, next) => {
          currentUser.set(req, { id: "user_123" });
          next();
        }),
      );

      app.get(
        "/me",
        handler((req, res) => {
          res.json(currentUser.get(req));
        }),
      );
    });

    const { app } = bootstrap(testServer(routes));
    const response = await request(app).get("/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "user_123" });
    expect(currentUser.lookup({} as any)).toBeUndefined();
  });
});

describe("openapi", () => {
  it("builds an OpenAPI document with grouped prefixes", () => {
    const api = openapi();
    api.get("/users/{id}", {
      summary: "Get user",
      responses: {
        200: {
          description: "User",
        },
      },
    });

    const { doc } = bootstrap(
      testServer(
        group(
          "/api",
          api.router("/", () => {}),
        ),
        {
          openapi: "3.1.0",
          info: { title: "Test API", version: "1.0.0" },
        },
      ),
    );

    expect(doc!.doc().paths?.["/api/users/{id}"]?.get?.summary).toBe(
      "Get user",
    );
  });

  it("registers all operations in the OpenAPI document and mounts their handlers", async () => {
    const api = openapi();
    const UserSchemas = schemas({
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string() }),
    });
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const getUser = api.get("/users/{id}", {
      summary: "Get user",
      requestParams: {
        path: UserSchemas.params,
      },
      responses: {
        200: jsonResponse(
          z.object({ method: z.literal("get"), id: z.string() }),
          {
            description: "User",
          },
        ),
      },
    });
    const createUser = api.post("/users/{id}", {
      summary: "Create user",
      requestParams: {
        path: UserSchemas.params,
      },
      requestBody: jsonRequest(UserSchemas.body, {
        description: "Create payload",
      }),
      responses: {
        201: jsonResponse(
          z.object({
            method: z.literal("post"),
            id: z.string(),
            name: z.string(),
          }),
          {
            description: "Created",
          },
        ),
      },
    });
    const updateUser = api.put("/users/{id}", {
      summary: "Update user",
      requestParams: {
        path: UserSchemas.params,
      },
      requestBody: jsonRequest(UserSchemas.body, {
        description: "Update payload",
      }),
      responses: {
        200: jsonResponse(
          z.object({
            method: z.literal("put"),
            id: z.string(),
            name: z.string(),
          }),
          {
            description: "Updated",
          },
        ),
      },
    });
    const patchUser = api.patch("/users/{id}", {
      summary: "Patch user",
      requestParams: {
        path: UserSchemas.params,
      },
      requestBody: jsonRequest(UserSchemas.body, {
        description: "Patch payload",
      }),
      responses: {
        200: jsonResponse(
          z.object({
            method: z.literal("patch"),
            id: z.string(),
            name: z.string(),
          }),
          {
            description: "Patched",
          },
        ),
      },
    });
    const deleteUser = api.delete("/users/{id}", {
      summary: "Delete user",
      requestParams: {
        path: UserSchemas.params,
      },
      responses: {
        204: {
          description: "Deleted",
        },
      },
    });

    const { app, doc } = bootstrap(
      testServer(
        api.router("/", (app) => {
          app.get(
            "/users/:id",
            getUser.handler((ctx) => {
              const params = ctx.param();
              return ctx.reply(200, { method: "get", id: params.id });
            }),
          );
          app.post(
            "/users/:id",
            createUser.handler((ctx) => {
              const params = ctx.param();
              const body = ctx.body();
              return ctx.reply(201, {
                method: "post",
                id: params.id,
                name: body.name,
              });
            }),
          );
          app.put(
            "/users/:id",
            updateUser.handler((ctx) => {
              const params = ctx.param();
              const body = ctx.body();
              return ctx.reply(200, {
                method: "put",
                id: params.id,
                name: body.name,
              });
            }),
          );
          app.patch(
            "/users/:id",
            patchUser.handler((ctx) => {
              const params = ctx.param();
              const body = ctx.body();
              return ctx.reply(200, {
                method: "patch",
                id: params.id,
                name: body.name,
              });
            }),
          );
          app.delete(
            "/users/:id",
            deleteUser.handler((ctx) => {
              ctx.reply(204, undefined);
              return;
            }),
          );
        }),
        {
          openapi: "3.1.0",
          info: { title: "Test API", version: "1.0.0" },
        },
      ),
    );

    const invalidParamResponse = await request(app).get("/users/not-a-uuid");
    expect(invalidParamResponse.status).toBe(400);
    expect(invalidParamResponse.body.message).toBe("Failed to validate params");

    const getResponse = await request(app).get(`/users/${userId}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual({ method: "get", id: userId });

    const postResponse = await request(app)
      .post(`/users/${userId}`)
      .send({ name: "Ada" });
    expect(postResponse.status).toBe(201);
    expect(postResponse.body).toEqual({
      method: "post",
      id: userId,
      name: "Ada",
    });

    const putResponse = await request(app)
      .put(`/users/${userId}`)
      .send({ name: "Grace" });
    expect(putResponse.status).toBe(200);
    expect(putResponse.body).toEqual({
      method: "put",
      id: userId,
      name: "Grace",
    });

    const patchResponse = await request(app)
      .patch(`/users/${userId}`)
      .send({ name: "Linus" });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body).toEqual({
      method: "patch",
      id: userId,
      name: "Linus",
    });

    const deleteResponse = await request(app).delete(`/users/${userId}`);
    expect(deleteResponse.status).toBe(204);

    expect(doc!.doc().paths?.["/users/{id}"]?.get?.summary).toBe("Get user");
    expect(doc!.doc().paths?.["/users/{id}"]?.post?.summary).toBe(
      "Create user",
    );
    expect(doc!.doc().paths?.["/users/{id}"]?.put?.summary).toBe("Update user");
    expect(doc!.doc().paths?.["/users/{id}"]?.patch?.summary).toBe(
      "Patch user",
    );
    expect(doc!.doc().paths?.["/users/{id}"]?.delete?.summary).toBe(
      "Delete user",
    );
  });

  it("serves generated OpenAPI docs and reference routes", async () => {
    const api = openapi();
    const UserSchemas = schemas({
      params: z.object({ id: z.string() }),
      query: z.object({ active: z.enum(["true", "false"]) }),
      body: z.object({ name: z.string() }),
      response: z.object({
        id: z.string(),
        active: z.boolean(),
        name: z.string(),
      }),
    });
    const upsertUser = api.post("/users/{id}", {
      operationId: "upsertUser",
      summary: "Upsert user",
      requestParams: {
        path: UserSchemas.params,
        query: UserSchemas.query,
      },
      requestBody: jsonRequest(UserSchemas.body, {
        description: "User payload",
      }),
      responses: {
        200: jsonResponse(UserSchemas.response, {
          description: "User",
        }),
      },
    });

    const routes = group(
      "/",
      api.router("/", (app, mount) => {
        app.post(
          "/users/:id",
          upsertUser.handler((ctx) => {
            const params = ctx.param();
            const query = ctx.query();
            const body = ctx.body();

            return ctx.reply(200, {
              id: params.id,
              active: query.active === "true",
              name: body.name,
            });
          }),
        );
        mount(openapiRoutes());
      }),
    );

    const { app } = bootstrap(
      testServer(routes, {
        openapi: "3.1.0",
        info: { title: "Test API", version: "1.0.0" },
      }),
    );

    const routeResponse = await request(app)
      .post("/users/user_1?active=true")
      .send({ name: "Ada" });
    const docsResponse = await request(app).get("/docs");
    const referenceResponse = await request(app).get("/docs/reference");

    expect(routeResponse.status).toBe(200);
    expect(routeResponse.body).toEqual({
      id: "user_1",
      active: true,
      name: "Ada",
    });
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.body.info).toEqual({
      title: "Test API",
      version: "1.0.0",
    });
    expect(docsResponse.body.paths["/users/{id}"].post.summary).toBe(
      "Upsert user",
    );
    expect(referenceResponse.status).toBe(200);
    expect(referenceResponse.headers["content-type"]).toContain("text/html");
    expect(referenceResponse.text).toContain("/docs");
  });

  describe("path joining", () => {
    const openapiOptions: OpenAPIDocumentOptions = {
      openapi: "3.1.0",
      info: { title: "Test API", version: "1.0.0" },
    };

    it("does not add a trailing slash when the method path is /", () => {
      const api = openapi();
      api.get("/", { responses: { 200: { description: "ok" } } });

      const { doc } = bootstrap(
        testServer(
          api.router("/users", () => {}),
          openapiOptions,
        ),
      );

      const paths = Object.keys(doc!.doc().paths ?? {});
      expect(paths).toContain("/users");
      expect(paths).not.toContain("/users/");
    });

    it("does not add a base prefix when the router base is /", () => {
      const api = openapi();
      api.get("/users/{id}", { responses: { 200: { description: "User" } } });

      const { doc } = bootstrap(
        testServer(
          api.router("/", () => {}),
          openapiOptions,
        ),
      );

      expect(Object.keys(doc!.doc().paths ?? {})).toContain("/users/{id}");
    });

    it("does not produce // when the router base has a trailing slash", () => {
      const api = openapi();
      api.get("/items", { responses: { 200: { description: "ok" } } });

      const { doc } = bootstrap(
        testServer(
          api.router("/users/", () => {}),
          openapiOptions,
        ),
      );

      const paths = Object.keys(doc!.doc().paths ?? {});
      expect(paths).toContain("/users/items");
      expect(paths.some((p) => p.includes("//"))).toBe(false);
    });

    it("does not produce // when the group base has a trailing slash", () => {
      const api = openapi();
      api.get("/items", { responses: { 200: { description: "ok" } } });

      const { doc } = bootstrap(
        testServer(
          group(
            "/api/",
            api.router("/users", () => {}),
          ),
          openapiOptions,
        ),
      );

      const paths = Object.keys(doc!.doc().paths ?? {});
      expect(paths).toContain("/api/users/items");
      expect(paths.some((p) => p.includes("//"))).toBe(false);
    });

    it("resolves to / when both the router base and the method path are /", () => {
      const api = openapi();
      api.get("/", { responses: { 200: { description: "ok" } } });

      const { doc } = bootstrap(
        testServer(
          api.router("/", () => {}),
          openapiOptions,
        ),
      );

      expect(Object.keys(doc!.doc().paths ?? {})).toContain("/");
    });
  });
});

---
name: express-serverstruct
description: Use when building an HTTP server with express-serverstruct — covers routes and controllers, async handlers, validation, request context, structured HTTP errors, and where to look for OpenAPI details.
---

# Express Serverstruct

## When to Use

Use this skill when the user wants to:

- build an HTTP server with Express using `express-serverstruct`
- create or modify an `express-serverstruct` server
- add routes, route groups, or controllers
- validate params, query, or body input with Zod
- share typed request-scoped values with `context()`
- wire generated OpenAPI docs and Scalar reference routes

Make sure the needed dependencies are installed:

- core usage: `express-serverstruct`, `express`, `zod`
- OpenAPI usage: `zod-openapi`

Open this reference when needed:

- `references/openapi.md` when the task needs generated OpenAPI docs. Use it because those APIs and conventions are separate from the core `handler()`, `router()`, `validate()` patterns.

## Core Guidance

Prefer a class-based `Server` for the root app and class-based `Controller` objects for substantial route modules. `Controller` is an interface, so classes `implement Controller`. Wrap controllers with `controller()` to produce a `Routes` value before mounting. Use `createServer()` and `createRoutes()` when the codebase is intentionally following a functional style.

Put cross-cutting middleware like `express.json()` in `configure()`, return the top-level route tree from `routes()`, and keep terminal 404 and error handlers in `onNotFound()` and `onError()`. `onNotFound()` can throw `HTTPError` so `onError()` formats not-found responses centrally.

Use `onStart()` for startup work. It may return an async `onShutdown` function, which `listen()` will call during `SIGINT` and `SIGTERM` shutdown.

```ts
import express from "express";
import {
  bootstrap,
  controller,
  Controller,
  errorHandler,
  group,
  HTTPError,
  handler,
  router,
  type Server,
} from "express-serverstruct";

class UsersController implements Controller {
  public routes() {
    return router("/users", (app) => {
      app.get("/", this.listUsers());
    });
  }

  private listUsers() {
    return handler((_req, res) => {
      res.json([]);
    });
  }
}

class AppServer implements Server {
  routes() {
    return group("/api", controller(new UsersController()));
  }
  configure(app) {
    app.use(express.json());
    return { port: 3000 };
  }
  onNotFound() {
    return handler(() => {
      throw HTTPError.status(404, "Not found");
    });
  }
  onError() {
    return errorHandler((error, _req, res, _next) => {
      if (error instanceof HTTPError) {
        return res.status(error.status).json(error.toJSON());
      }

      console.error(error);
      res.status(500).json({
        message: "Unexpected server error",
      });
    });
  }
  async onStart() {
    return async () => {
      // Cleanup work goes here.
    };
  }
}

bootstrap(new AppServer()).listen();
```

## Routes, Controllers, and Errors

Use `handler()` for normal middleware and route handlers, and `errorHandler()` for async Express error middleware. Both wrappers forward thrown exceptions to `next()`.

Middleware should generally be defined with `handler(...)` outside a controller, but it can be returned from a controller method when it is small and scoped to that controller.

Keep HTTP concerns in handlers only. Other services should return domain results or domain errors, and handlers should translate those into `HTTPError` responses.

Functional style works well for smaller modules, closure-heavy setup, or codebases that already model composition with factories. In that style, `createServer(() => ...)` and `createRoutes(() => ...)` are preferred.

## Validation

Use `validate(req, schema)` inside a handler when the route needs typed params, query, or body data. Only the keys you ask for are parsed and returned. Validation failures become `HTTPError` 400 errors with `errors` entries derived from Zod issues.

## Context

Use `context<T>()` for request-scoped data such as the authenticated user or correlation IDs. Prefer `get(req)` by default. Use `lookup(req)` only when the context is conditionally set or conditionally accessed. `set(req, value)` writes the value, `get(req)` throws if it is missing, and `lookup(req)` returns `undefined` when it is optional.

```ts
import {
  context,
  controller,
  Controller,
  handler,
  router,
} from "express-serverstruct";

const currentUser = context<{ id: string }>({
  onError: "Missing authenticated user",
});

const attachCurrentUser = handler((req, _res, next) => {
  currentUser.set(req, { id: "user_123" });
  next();
});

class UsersController implements Controller {
  public routes() {
    return router("/users", (app) => {
      app.use(attachCurrentUser);
      app.get("/me", this.getMe());
    });
  }

  private getMe() {
    return handler((req, res) => {
      res.json(currentUser.get(req));
    });
  }
}
```

## Errors

Handlers should throw `HTTPError`. Use `HTTPError.status(...)` for the short form, or `new HTTPError(...)` when you need to attach extra fields such as `body`, `errors`, or `cause`.

Make sure `onError()` checks for `HTTPError` and responds from its structured fields before falling back to a generic 500 response.

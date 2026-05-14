# Expressstruct

Typesafe and modular servers with [Express](https://expressjs.com/).

`expressstruct` provides simple helpers for structuring Express applications around reusable route modules, request validation with Zod, and OpenAPI generation.

## Skills

Install the expressstruct agent skills with:

```sh
npx skills add eriicafes/expressstruct
```

See [skills/README.md](./skills/README.md) for the available skills.

## Installation

```sh
npm i expressstruct express zod
```

To use OpenAPI generation, also install:

```sh
npm i zod-openapi
```

## Quick Start

```ts
import express from "express";
import {
  bootstrap,
  Controller,
  errorHandler,
  group,
  handler,
  HTTPError,
  router,
  type Server,
} from "expressstruct";

class UsersController extends Controller {
  public routes() {
    return router("/users", (app) => {
      app.get("/", this.lisUsers());
    });
  }

  private lisUsers() {
    return handler((_req, res) => {
      res.json([]);
    });
  }
}

class App implements Server {
  routes() {
    return group("/", new UsersController());
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
      res.status(500).json({ message: "Unexpected server error" });
    });
  }

  async onStart() {
    return async () => {
      // Cleanup work goes here.
    };
  }
}

bootstrap(new App()).listen();
```

## Server

A server is the root of an `expressstruct` app. Use it to configure global middleware, mount the top-level route tree, and define error handling, and startup behavior.

```ts
import express from "express";
import {
  bootstrap,
  errorHandler,
  group,
  handler,
  HTTPError,
  type Server,
} from "expressstruct";

class App implements Server {
  routes() {
    return group("/api", new UsersController());
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
      res.status(500).json({ message: "Unexpected server error" });
    });
  }

  async onStart() {}
}

bootstrap(new App()).listen();
```

Use `bootstrap()` with a server to create the Express app, apply configuration, and mount routes. It returns:

- `app` - the configured Express application
- `listen()` - a helper that starts the HTTP server with graceful shutdown
- `doc` - the OpenAPI document builder when `configure()` returns `openapi`

Use `createServer()` when you want the functional style instead of a class.

## Routes

A route module can register its routes to a parent app or router. Use route modules to compose larger route trees.

Use `router()` to define a route module:

```ts
import { handler, router } from "expressstruct";

const healthRoutes = router("/health", (app) => {
  app.get(
    "/",
    handler((_req, res) => {
      res.json({ status: "ok" });
    }),
  );
});
```

Use `group()` to mount several route modules under one prefix:

```ts
import { group } from "expressstruct";

const routes = group("/api", healthRoutes, usersRoutes);
```

Use `createRoutes()` when you want the functional style instead of a class.

## Controllers

A controller is a class-based route module. It extends the abstract `Controller` base class and returns routes from the `routes()` method.

```ts
import { Controller, handler, router } from "expressstruct";

class UsersController extends Controller {
  public routes() {
    return router("/users", (app) => {
      app.get("/", this.listUsers());
    });
  }

  private listUsers() {
    return handler((_req, res) => res.json([]));
  }
}
```

Use `group()` to mount several controllers under one prefix:

```ts
const routes = group("/api", new UsersController(), new HealthController());
```

Use `router()` to mount a controller under another route:

```ts
import express from "express";
import { router } from "expressstruct";

const routes = router("/api", (app, mount) => {
  app.use(express.json());
  mount(new UsersController());
});
```

## Request Helpers

### Async Handlers

`handler()` and `errorHandler()` wrap async Express handlers and forward thrown errors to `next()`:

```ts
import { errorHandler, handler, HTTPError } from "expressstruct";

const getUser = handler(async (req, res) => {
  res.json({ id: req.params.id });
});

const onError = errorHandler(async (error, _req, res, _next) => {
  if (error instanceof HTTPError) {
    return res.status(error.status).json(error.toJSON());
  }
  console.error(error);
  res.status(500).json({ message: "Unexpected server error" });
});
```

### HTTP Errors

Throw `HTTPError` when you want structured application errors:

```ts
import { HTTPError, handler } from "expressstruct";

const getUser = handler((req, res) => {
  if (req.params.id !== "1") {
    throw HTTPError.status(404, "User not found", "USER_NOT_FOUND");
  }

  res.json({ id: "1" });
});
```

### Validation

`validate()` parses request data with Zod and returns only the requested pieces:

```ts
import { handler, validate } from "expressstruct";
import { z } from "zod";

const createUserSchema = {
  params: z.object({ orgId: z.string() }),
  query: z.object({ active: z.string().optional() }),
  body: z.object({ name: z.string() }),
};

const createUser = handler((req, res) => {
  const { params, query, body } = validate(req, createUserSchema);

  res.status(201).json({
    orgId: params.orgId,
    active: query.active === "true",
    name: body.name,
  });
});
```

Validation failures throw `HTTPError` with `status: 400` and field-level `errors`.

### Request Context

`context()` creates a typed request-scoped store backed by a unique property on the request object:

```ts
import { context, handler, router } from "expressstruct";

const currentUser = context<{ id: string }>({
  onError: "Missing authenticated user",
});

const authRoutes = router("/", (app) => {
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
```

Use `lookup()` when the value is optional and `get()` when a missing value should throw.

## OpenAPI

Use the OpenAPI helpers to add generated API documentation to your Express app. Define documented routes with `openapi()`, mount them with `api.router()`, and add `openapiRoutes()` last to serve the generated document and API reference. The helpers use `zod-openapi` under the hood, so Zod schemas can include OpenAPI metadata.

```ts
import express from "express";
import { z } from "zod";
import {
  bootstrap,
  Controller,
  group,
  jsonResponse,
  openapi,
  openapiRoutes,
  schemas,
  type Server,
} from "expressstruct";

class UserRouteSchemas {
  static getUser = schemas({
    params: z.object({
      id: z.string().meta({
        description: "User ID",
        example: "1",
      }),
    }),
    response: z
      .object({
        id: z.string().meta({
          description: "User ID",
          example: "1",
        }),
      })
      .meta({
        id: "User",
        description: "A user record",
      }),
  });
}

class UsersController extends Controller {
  private api = openapi();

  public routes() {
    return this.api.router("/users", (app) => {
      app.get("/:id", this.getUser());
    });
  }

  private getUser() {
    const route = this.api.get("/users/{id}", {
      operationId: "getUser",
      summary: "Get a user",
      requestParams: {
        path: UserRouteSchemas.getUser.params,
      },
      responses: {
        200: jsonResponse(UserRouteSchemas.getUser.response, {
          description: "User",
        }),
      },
    });

    return route.handler((ctx) => {
      const params = ctx.param();
      return ctx.reply(200, { id: params.id });
    });
  }
}

class App implements Server {
  routes() {
    return group("/", new UsersController(), openapiRoutes());
  }
  configure(app) {
    app.use(express.json());
    return {
      port: 3000,
      openapi: {
        openapi: "3.1.0",
        info: { title: "Example API", version: "1.0.0" },
      },
    };
  }
  onNotFound() { ... },
  onError() { ... },
  onStart() { ... },
}

bootstrap(new App()).listen();
```

`openapiRoutes()` serves:

- `/docs` - the generated OpenAPI JSON document
- `/docs/reference` - the Scalar API reference UI

You can customize those paths with `openapiRoutes({ path, reference })`.

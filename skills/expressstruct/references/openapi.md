# Express Serverstruct OpenAPI Reference

Use this when the task specifically involves `openapi()`, `OpenAPIRoute`, `schemas()`, `jsonRequest()`, `jsonResponse()`, or `openapiRoutes()`.

## Installation

```sh
npm i zod zod-openapi
```

## Main Rules

- Create one `api` registry with `openapi()` for each logical route module.
- Prefer a dedicated class to hold route schemas, with one static property per `operationId`.
- Build each static property with `schemas()` so request and response shapes stay grouped together.
- Declare operations with OpenAPI-style paths such as `/users/{id}`.
- Remember that OpenAPI paths use `{id}` while Express routes use `:id`.
- Mount the matching Express routes through `api.router()` so the document builder collects those operations.
- Return `openapi` metadata from `Server.configure()` or no document will be generated.
- Mount `openapiRoutes()` last when you want `/docs` and the Scalar reference UI exposed.

Functional style is still supported here, but prefer it only when the surrounding code already uses factories or when closure-based setup is clearer than class-based composition.

## Schema Helpers

Use `schemas()` to organize request and response Zod schemas together. Prefer a class whose static property names match the route `operationId`:

```ts
import { schemas } from "express-serverstruct";
import { z } from "zod";

class UserRouteSchemas {
  static getUser = schemas({
    params: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), name: z.string() }),
    notFound: z.object({ message: z.string() }),
  });

  static createUser = schemas({
    body: z.object({ name: z.string().min(1) }),
    response: z.object({ id: z.string(), name: z.string() }),
    badRequest: z.object({ message: z.string() }),
  });
}
```

Use `jsonRequest()` to build a typed `requestBody` for JSON routes and `jsonResponse()` to build JSON response entries:

```ts
import { jsonRequest, jsonResponse } from "express-serverstruct";

requestBody: jsonRequest(UserRouteSchemas.createUser.body, {
  description: "Create a user",
})

responses: {
  201: jsonResponse(UserRouteSchemas.createUser.response, {
    description: "User created",
  }),
  400: jsonResponse(UserRouteSchemas.createUser.badRequest, {
    description: "Bad request",
  }),
}
```

## Typical Pattern

```ts
import express from "express";
import { z } from "zod";
import {
  bootstrap,
  Controller,
  errorHandler,
  HTTPError,
  handler,
  jsonResponse,
  openapi,
  openapiRoutes,
  router,
  schemas,
  type Server,
} from "express-serverstruct";

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
        404: jsonResponse(UserRouteSchemas.getUser.notFound, {
          description: "User not found",
        }),
      },
    });

    return route.handler((ctx) => {
      const params = ctx.param();
      return ctx.reply(200, { id: params.id });
    });
  }
}

class AppServer implements Server {
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
  routes() {
    return router("/", (_app, mount) => {
      mount(new UsersController(), openapiRoutes());
    });
  }
  onNotFound() {
    return handler(() => {});
  }
  onError() {
    return errorHandler(() => {});
  }
  async onStart() {}
}

bootstrap(new AppServer()).listen();
```

## Typed Helpers

- `route.handler((ctx) => ...)` builds an Express handler with typed accessors.
- `body()` validates and returns the JSON request body when a schema is declared.
- `param()` validates and returns path params from `requestParams.path`.
- `query()` validates and returns query params from `requestParams.query`.
- `reply(status, body)` sends a typed JSON response for one of the declared response status codes.

## Rules of Thumb

- Prefer a schema class with static properties named after `operationId` values.
- Prefer `schemas()` when a route has multiple related schemas or named error payloads.
- Prefer `jsonRequest()` and `jsonResponse()` over handwritten JSON content objects for readability and stronger typing.
- Prefer a route method that creates the OpenAPI route and returns `route.handler(...)` instead of storing route helpers as class properties.
- Put `routes()` at the top of the controller, directly below `private api = openapi()`.
- Do not destructure OpenAPI handler context helpers from `ctx`; call `ctx.param()`, `ctx.query()`, `ctx.body()`, and `ctx.reply()` explicitly.
- Keep OpenAPI path templates and Express route paths aligned, but use `{id}` in the schema layer and `:id` in Express.
- Prefer class-based examples and composition by default; switch to functional style when closures are the main organizing tool or the surrounding codebase already uses factories.

## Docs Routes

`openapiRoutes()` serves:

- `/docs` by default for the generated OpenAPI JSON
- `/docs/reference` by default for the Scalar API reference page

Customize with:

```ts
openapiRoutes({
  path: "/openapi.json",
  reference: {
    path: "/reference",
  },
});
```

Set `reference: false` to disable the UI and serve only the document.

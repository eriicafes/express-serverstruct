import express, {
  Application,
  ErrorRequestHandler,
  Request,
  RequestHandler,
  Router,
} from "express";
import z from "zod";
import { HTTPError } from "./error";
import { document, OpenAPIDocument, OpenAPIDocumentOptions } from "./openapi";
export { HTTPError } from "./error";

export {
  apiReferenceHandler,
  document,
  jsonRequest,
  jsonResponse,
  openapi,
  OpenAPIDocument,
  OpenAPIPaths,
  OpenAPIRoute,
  openapiRoutes,
  renderApiReference,
  schemas,
  type AnyApiReferenceConfiguration,
  type OpenAPIDocumentOptions,
  type OpenAPIReferenceOptions,
  type OpenAPIRoutesOptions,
} from "./openapi";

type RouteTarget = { use(path: string, router: Router): any };

/**
 * Route definitions for Express applications with first-class OpenAPI support.
 *
 * A `Routes` implementation can mount into a parent Express target and, when
 * OpenAPI generation is enabled, register path metadata with the active
 * document builder.
 */
export interface Routes {
  /**
   * Mounts the route collection onto a parent router or application.
   *
   * @param target - Express application or router to mount into.
   * @param doc - OpenAPI document builder, when documentation is enabled.
   */
  mount(target: RouteTarget, doc: OpenAPIDocument | undefined): void;
}

/**
 * Interface for reusable route modules.
 *
 * A controller defines its routes via {@link routes}. Use {@link controller}
 * to compose one or more controllers into a {@link Routes} value.
 */
export interface Controller {
  /**
   * Returns the routes exposed by the controller.
   */
  routes(): Routes;
}

/**
 * Creates a route instance from a value or factory function.
 *
 * @param routes - Routes instance or lazy factory.
 * @returns The resolved routes.
 */
export function createRoutes(routes: Routes | (() => Routes)): Routes {
  return typeof routes === "function" ? routes() : routes;
}

/**
 * Runtime configuration returned from {@link Server.configure}.
 */
export type ServerConfig = {
  /**
   * Port passed to `app.listen()`.
   */
  port: number;
  /**
   * OpenAPI document metadata. When omitted, OpenAPI collection is disabled.
   */
  openapi?: OpenAPIDocumentOptions;
};

/**
 * Optional asynchronous cleanup callback produced by {@link Server.onStart}.
 */
export type OnServerShutdown = Promise<(() => Promise<void>) | void>;

/**
 * Server contract consumed by {@link bootstrap}.
 */
export interface Server {
  /**
   * Returns the top-level application routes.
   */
  routes(): Routes;
  /**
   * Configures the application and returns runtime settings.
   *
   * @param app - Express application created by {@link bootstrap}.
   */
  configure(app: Application): ServerConfig;
  /**
   * Builds the terminal 404 handler registered after all routes.
   */
  onNotFound(): RequestHandler;
  /**
   * Builds the terminal error handler for request and middleware failures.
   */
  onError(): ErrorRequestHandler;
  /**
   * Runs after the HTTP server starts listening.
   *
   * May return an asynchronous cleanup callback that is invoked during
   * `SIGINT` and `SIGTERM` shutdown.
   */
  onStart(): OnServerShutdown;
}

/**
 * Creates a server instance from a value or factory function.
 *
 * @param server - Server instance or lazy factory.
 * @returns The resolved server.
 */
export function createServer(server: Server | (() => Server)): Server {
  return typeof server === "function" ? server() : server;
}

export type BootstrapResult = {
  /**
   * Configured Express application.
   */
  app: Application;
  /**
   * Starts the HTTP server with graceful shutdown handling.
   */
  listen: () => void;
  /**
   * OpenAPI document builder, when OpenAPI generation is enabled.
   */
  doc: OpenAPIDocument | undefined;
};

/**
 * Creates an Express application from a {@link Server} definition.
 *
 * `bootstrap()` creates an Express app, applies the server configuration,
 * mounts routes, registers terminal handlers, and returns a `listen()` helper
 * wired for graceful shutdown.
 *
 * @param server - Server definition to bootstrap.
 * @returns The Express app, a `listen()` function, and the OpenAPI document builder when enabled.
 */
export function bootstrap(server: Server): BootstrapResult {
  const app = express();
  const config = server.configure(app);

  const doc = config.openapi ? document(config.openapi) : undefined;
  server.routes().mount(app, doc);

  app.use(server.onNotFound());
  app.use(server.onError());

  const listen = () => {
    const httpServer = app.listen(config.port, async () => {
      const onShutdown = await server.onStart();

      const handleShutdown = () => {
        httpServer.close(async () => {
          try {
            await onShutdown?.();
          } catch (error) {
            console.error("Error during shutdown:", error);
            process.exit(1);
          }
        });
      };

      process.on("SIGTERM", handleShutdown);
      process.on("SIGINT", handleShutdown);
    });
  };

  return { app, listen, doc };
}

/**
 * Creates a route group mounted at a base path.
 *
 * The `setup` callback receives a fresh Express router and a helper for
 * mounting nested {@link Routes} values onto that router.
 *
 * @param base - Base path used when mounting the router.
 * @param setup - Function that configures the router.
 * @returns A route definition with first-class OpenAPI support.
 */
export function router(
  base: string,
  setup: (router: Router, mount: (...routes: Routes[]) => void) => void,
): Routes {
  return {
    mount(parent, doc) {
      doc = doc?.sub(base);
      const router = Router();
      setup(router, (...routes) => {
        for (const route of routes) route.mount(router, doc);
      });
      parent.use(base, router);
    },
  };
}

/**
 * Groups multiple route collections under a shared base path.
 *
 * When OpenAPI generation is enabled, the same prefix is applied to the
 * collected path definitions.
 *
 * @param base - Base path applied to the nested routes.
 * @param routes - Route collections to mount under the base path.
 * @returns A route definition with first-class OpenAPI support.
 */
export function group(base: string, ...routes: Routes[]): Routes {
  return {
    mount(parent, doc) {
      doc = doc?.sub(base);
      const router = Router();
      for (const route of routes) route.mount(router, doc);
      parent.use(base, router);
    },
  };
}

/**
 * Combines one or more controllers into a single route collection.
 *
 * Each controller's {@link Controller.routes} is mounted in order onto the
 * target.
 *
 * @param controllers - Controllers to compose.
 * @returns A route definition with first-class OpenAPI support.
 */
export function controller(...controllers: Controller[]): Routes {
  return {
    mount(target, doc) {
      for (const c of controllers) c.routes().mount(target, doc);
    },
  };
}

/**
 * Wraps an Express request handler with automatic async error forwarding.
 *
 * The generic `Res` parameter controls the typed response body.
 *
 * @param handler - Request handler to wrap.
 * @returns An Express handler that forwards thrown errors to `next()`.
 *
 * @example
 * ```ts
 * app.get("/health", handler((_req, res) => {
 *   res.json({ ok: true });
 * }));
 * ```
 */
export function handler<Res>(
  handler: RequestHandler<any, Res>,
): RequestHandler<any, Res> {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Wraps an Express error handler with automatic async error forwarding.
 *
 * @param handler - Error handler to wrap.
 * @returns An Express error handler that forwards secondary failures to `next()`.
 *
 * @example
 * ```ts
 * const onError = errorHandler((err, _req, res, _next) => {
 *   res.status(500).json({ message: err.message });
 * });
 * ```
 */
export function errorHandler<Res>(
  handler: ErrorRequestHandler<any, Res>,
): ErrorRequestHandler<any, Res> {
  return async (err, req, res, next) => {
    try {
      return await handler(err, req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

type ValidationSchema = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

type ValidationResult<T extends ValidationSchema> = {
  [K in keyof T as undefined extends T[K] ? never : K]: z.output<T[K]>;
};

/**
 * Parses request data with Zod schemas.
 *
 * Only the keys provided in `schema` are parsed and returned. Validation
 * errors are thrown and can be handled by the application's error middleware.
 *
 * @param req - Express request to read from.
 * @param schema - Zod schemas for `params`, `query`, and/or `body`.
 * @returns Parsed request values for the provided schema keys.
 *
 * @example
 * ```ts
 * const { params, body } = validate(req, {
 *   params: z.object({ id: z.string() }),
 *   body: z.object({ name: z.string() }),
 * });
 * ```
 */
export function validate<T extends ValidationSchema>(
  req: Request,
  schema: T,
): ValidationResult<T> {
  const { params, query, body } = schema;

  const result: Record<string, unknown> = {};
  if (params)
    result.params = parseOrThrow(
      params,
      req.params,
      "Failed to validate params",
    );
  if (query)
    result.query = parseOrThrow(query, req.query, "Failed to validate query");
  if (body)
    result.body = parseOrThrow(body, req.body, "Failed to validate body");
  return result as ValidationResult<T>;
}

export function parseOrThrow<T>(
  schema: z.ZodType,
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data as T;
  throw new HTTPError({
    status: 400,
    message,
    cause: result.error,
    errors: result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    })),
  });
}

/**
 * Creates a typed request-scoped context store.
 *
 * The returned store uses a unique symbol-backed property on the Express
 * request object, which makes it useful for values such as the authenticated
 * user, correlation IDs, or per-request services.
 *
 * @param options - Optional error configuration for missing values.
 * @returns A typed context store for Express requests.
 */
export function context<T>(options?: { onError?: string }) {
  return new Context<T>(options);
}

class Context<T> {
  private key = Symbol();

  constructor(private options?: { onError?: string }) {}

  /**
   * Stores a value on the current request.
   *
   * @param req - Express request.
   * @param value - Value to associate with the request.
   */
  public set(req: Request, value: T): void {
    (req as any)[this.key] = value;
  }

  /**
   * Reads the value associated with the current request.
   *
   * @param req - Express request.
   * @returns The stored value.
   * @throws Error when no value has been set.
   */
  public get(req: Request): T {
    const value = (req as any)[this.key] as T | undefined;
    if (value === undefined)
      throw new Error(this.options?.onError ?? "Context value not set");
    return value;
  }

  /**
   * Looks up the value associated with the current request.
   *
   * @param req - Express request.
   * @returns The stored value, or `undefined` when no value has been set.
   */
  public lookup(req: Request): T | undefined {
    return (req as any)[this.key] as T | undefined;
  }
}

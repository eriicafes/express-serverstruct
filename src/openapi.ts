import {
  AnyApiReferenceConfiguration,
  renderApiReference,
} from "@scalar/client-side-rendering";
import {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from "express";
import { z, ZodType } from "zod";
import {
  createDocument,
  CreateDocumentOptions,
  ZodOpenApiMediaTypeObject,
  ZodOpenApiObject,
  ZodOpenApiOperationObject,
  ZodOpenApiRequestBodyObject,
  ZodOpenApiResponseObject,
} from "zod-openapi";
import { isAnyZodType } from "zod-openapi/api";
import { handler, parseOrThrow, type Routes } from "./index";

export {
  renderApiReference,
  type AnyApiReferenceConfiguration,
} from "@scalar/client-side-rendering";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type SchemaOutput<S> = S extends z.ZodType ? z.output<S> : unknown;
type ResponseStatus<T extends ZodOpenApiOperationObject> =
  Exclude<keyof T["responses"], "default"> extends infer S
    ? S extends number
      ? S
      : S extends `${infer Code extends number}`
        ? Code
        : never
    : never;
type ResponseSchema<
  T extends ZodOpenApiOperationObject,
  S extends ResponseStatus<T>,
> =
  | T["responses"][S & keyof T["responses"]]
  | T["responses"][`${S}` & keyof T["responses"]] extends {
  content?: { "application/json"?: { schema?: infer Schema } };
}
  ? Schema
  : unknown;

type RouteContext<T extends ZodOpenApiOperationObject> = {
  req: Request;
  res: Response;
  next: NextFunction;
  body: () => ReturnType<OpenAPIRoute<T>["body"]>;
  param: () => ReturnType<OpenAPIRoute<T>["params"]>;
  query: () => ReturnType<OpenAPIRoute<T>["query"]>;
  reply: <S extends ResponseStatus<T>>(
    status: S,
    body: SchemaOutput<ResponseSchema<T, S>>,
  ) => Response;
};

/**
 * Typed helper around a single OpenAPI operation definition.
 *
 * `OpenAPIRoute` reads request validation details from the supplied OpenAPI
 * operation and exposes helpers for parsing request data, writing typed JSON
 * responses, and building Express handlers with a typed route context.
 */
export class OpenAPIRoute<T extends ZodOpenApiOperationObject> {
  constructor(private op: T) {}

  /**
   * Parses route parameters using the operation's `requestParams.path` schema.
   *
   * @param req - Express request.
   * @returns Parsed route params, or the raw params object when no schema is defined.
   */
  public params(req: Request) {
    const schema = this.op.requestParams?.path;
    return (
      isAnyZodType(schema)
        ? parseOrThrow(
            schema as unknown as z.ZodType,
            req.params,
            "Failed to validate params",
          )
        : req.params
    ) as SchemaOutput<
      T["requestParams"] extends { path: infer P } ? P : undefined
    >;
  }

  /**
   * Parses query parameters using the operation's `requestParams.query` schema.
   *
   * @param req - Express request.
   * @returns Parsed query params, or the raw query object when no schema is defined.
   */
  public query(req: Request) {
    const schema = this.op.requestParams?.query;
    return (
      isAnyZodType(schema)
        ? parseOrThrow(
            schema as unknown as z.ZodType,
            req.query,
            "Failed to validate query",
          )
        : req.query
    ) as SchemaOutput<
      T["requestParams"] extends { query: infer Q } ? Q : undefined
    >;
  }

  /**
   * Parses the JSON request body using the operation's request body schema.
   *
   * @param req - Express request.
   * @returns Parsed request body, or the raw body when no JSON schema is defined.
   */
  public body(req: Request) {
    const schema = this.op.requestBody?.content?.["application/json"]?.schema;
    return (
      isAnyZodType(schema)
        ? parseOrThrow(
            schema as unknown as z.ZodType,
            req.body,
            "Failed to validate body",
          )
        : req.body
    ) as SchemaOutput<
      T["requestBody"] extends {
        content: { "application/json": { schema: infer B } };
      }
        ? B
        : undefined
    >;
  }

  /**
   * Sends a typed JSON response for a declared status code.
   *
   * @param res - Express response.
   * @param status - Declared response status code.
   * @param body - JSON body matching the schema for the selected status code.
   * @returns The Express response.
   */
  public reply<S extends ResponseStatus<T>>(
    res: Response,
    status: S,
    body: SchemaOutput<ResponseSchema<T, S>>,
  ) {
    return res.status(status).json(body);
  }

  /**
   * Builds an Express handler with typed accessors derived from the operation.
   *
   * @param fn - Route implementation.
   * @returns An Express request handler with automatic async error forwarding.
   */
  public handler(
    fn: (ctx: RouteContext<T>) => unknown | Promise<unknown>,
  ): RequestHandler {
    return handler(async (req, res, next) => {
      return await fn({
        req,
        res,
        next,
        body: () => this.body(req),
        param: () => this.params(req),
        query: () => this.query(req),
        reply: (status, body) => this.reply(res, status, body),
      });
    });
  }
}

/**
 * Creates a new OpenAPI path registry.
 *
 * @returns A mutable path registry for declaring OpenAPI-backed routes.
 */
export function openapi() {
  return new OpenAPIPaths();
}

type OpenAPIOperations = { [K in HttpMethod]?: ZodOpenApiOperationObject };

/**
 * Registry of OpenAPI operations keyed by path and method.
 */
export class OpenAPIPaths {
  private paths: Record<string, OpenAPIOperations> = {};

  /**
   * Returns the registered path entries.
   */
  public entries() {
    return Object.entries(this.paths).map(([path, methods]) => ({
      path,
      methods,
    }));
  }

  /**
   * Declares a `GET` operation.
   *
   * @param path - OpenAPI path template.
   * @param config - OpenAPI operation object.
   * @returns A typed route helper for the operation.
   */
  public get<C extends ZodOpenApiOperationObject>(path: string, config: C) {
    return this.route("get", path, config);
  }

  /**
   * Declares a `POST` operation.
   *
   * @param path - OpenAPI path template.
   * @param config - OpenAPI operation object.
   * @returns A typed route helper for the operation.
   */
  public post<C extends ZodOpenApiOperationObject>(path: string, config: C) {
    return this.route("post", path, config);
  }

  /**
   * Declares a `PUT` operation.
   *
   * @param path - OpenAPI path template.
   * @param config - OpenAPI operation object.
   * @returns A typed route helper for the operation.
   */
  public put<C extends ZodOpenApiOperationObject>(path: string, config: C) {
    return this.route("put", path, config);
  }

  /**
   * Declares a `PATCH` operation.
   *
   * @param path - OpenAPI path template.
   * @param config - OpenAPI operation object.
   * @returns A typed route helper for the operation.
   */
  public patch<C extends ZodOpenApiOperationObject>(path: string, config: C) {
    return this.route("patch", path, config);
  }

  /**
   * Declares a `DELETE` operation.
   *
   * @param path - OpenAPI path template.
   * @param config - OpenAPI operation object.
   * @returns A typed route helper for the operation.
   */
  public delete<C extends ZodOpenApiOperationObject>(path: string, config: C) {
    return this.route("delete", path, config);
  }

  /**
   * Declares an operation for an arbitrary supported HTTP method.
   *
   * @param method - HTTP method.
   * @param path - OpenAPI path template.
   * @param config - OpenAPI operation object.
   * @returns A typed route helper for the operation.
   */
  public route<C extends ZodOpenApiOperationObject>(
    method: HttpMethod,
    path: string,
    config: C,
  ) {
    if (!this.paths[path]) this.paths[path] = {};
    this.paths[path][method] = config;
    return new OpenAPIRoute(config);
  }

  /**
   * Creates a route definition that mounts an Express router and registers the
   * registry with the active OpenAPI document.
   *
   * @param base - Base path used when mounting the router.
   * @param setup - Function that configures the router.
   * @returns A route definition with first-class OpenAPI support.
   */
  public router(
    base: string,
    setup: (router: Router, mount: (...routes: Routes[]) => void) => void,
  ): Routes {
    return {
      mount: (parent, doc) => {
        doc = doc?.sub(base);
        const router = Router();
        setup(router, (...routes) => {
          for (const route of routes) route.mount(router, doc);
        });
        parent.use(base, router);
        if (doc) doc.add(this);
      },
    };
  }
}

/**
 * Options used to create an OpenAPI document.
 */
export type OpenAPIDocumentOptions = Omit<ZodOpenApiObject, "paths">;

/**
 * Creates a new OpenAPI document builder.
 *
 * @param options - Base OpenAPI document fields.
 * @returns A document builder that can collect routes.
 */
export function document(options: OpenAPIDocumentOptions) {
  return new OpenAPIDocument(options, "");
}

/**
 * Collects path definitions into an OpenAPI document.
 */
export class OpenAPIDocument {
  constructor(
    private _doc: ZodOpenApiObject,
    public readonly base: string,
  ) {}

  /**
   * Merges path definitions into the document using the current base path.
   *
   * @param paths - Path registry to merge.
   */
  public add(paths: OpenAPIPaths) {
    for (const { path, methods } of paths.entries()) {
      const fullPath = joinPath(this.base, path);
      if (!this._doc.paths) this._doc.paths = {};
      if (!this._doc.paths[fullPath]) this._doc.paths[fullPath] = {};
      for (const [method, op] of Object.entries(methods)) {
        this._doc.paths[fullPath][method as HttpMethod] = op;
      }
    }
  }

  /**
   * Creates a document view with an additional path prefix.
   *
   * @param base - Path prefix to append.
   * @returns A prefixed view of the same document.
   */
  public sub(base: string) {
    return new OpenAPIDocument(this._doc, joinPath(this.base, base));
  }

  /**
   * Generates the final OpenAPI document.
   *
   * @returns The OpenAPI document object produced by `zod-openapi`.
   */
  public doc(opts?: CreateDocumentOptions): ReturnType<typeof createDocument> {
    return createDocument(this._doc, opts);
  }
}

/**
 * Creates a request handler that serves the Scalar API reference page.
 *
 * @param options - Scalar HTML rendering options.
 * @param customTheme - Optional custom theme stylesheet.
 * @returns An Express request handler that responds with HTML.
 */
export function apiReferenceHandler(
  options: {
    /**
     * Configuration passed to the Scalar HTML renderer.
     */
    config: AnyApiReferenceConfiguration;
    /**
     * HTML document title. Defaults to `"Scalar API Reference"`.
     */
    pageTitle?: string;
    /**
     * URL of the standalone Scalar bundle. Defaults to jsDelivr.
     */
    cdn?: string;
  },
  customTheme?: string,
): RequestHandler {
  const document = renderApiReference(options, customTheme);
  return (_req, res) => res.type("html").send(document);
}

/**
 * Options for the mounted Scalar reference page.
 */
export type OpenAPIReferenceOptions = {
  /**
   * URL path for the rendered API reference page.
   *
   * Defaults to `${docPath}/reference`.
   */
  path?: string;
  /**
   * Scalar reference configuration.
   *
   * Defaults to a configuration that points at the generated OpenAPI document.
   */
  config?: AnyApiReferenceConfiguration;
  /**
   * HTML document title. Defaults to `"Scalar API Reference"`.
   */
  pageTitle?: string;
  /**
   * URL of the standalone Scalar bundle. Defaults to jsDelivr.
   */
  cdn?: string;
};

/**
 * Options for {@link openapiRoutes}.
 */
export type OpenAPIRoutesOptions = {
  /**
   * URL path for the generated OpenAPI document.
   *
   * Defaults to `/docs`.
   */
  path?: string;
  /**
   * Scalar reference page configuration.
   *
   * Set to `false` to disable the reference page entirely.
   */
  reference?: false | OpenAPIReferenceOptions;
};

/**
 * Creates routes for serving the generated OpenAPI document and Scalar UI.
 *
 * Add these routes near the end of your route tree so broader application
 * routes do not intercept the documentation paths.
 *
 * @param options - Documentation route configuration.
 * @returns A route definition with first-class OpenAPI support.
 */
export function openapiRoutes(options?: OpenAPIRoutesOptions): Routes {
  return {
    mount(parent, doc) {
      if (!doc) return;

      const docPath = normalizePath(options?.path ?? "docs");
      const router = Router();
      router.get(docPath, (_req, res) => res.json(doc.doc()));

      if (options?.reference !== false) {
        const reference = options?.reference ?? {};
        const { path, ...referenceOptions } = reference;
        const referencePath = normalizePath(path ?? `${docPath}/reference`);

        router.get(
          referencePath,
          apiReferenceHandler({
            ...referenceOptions,
            config: referenceOptions.config ?? {
              url: joinPath(doc.base, docPath),
            },
          }),
        );
      }

      parent.use("/", router);
    },
  };
}

function joinPath(base: string, path: string) {
  if (!base || base === "/") return normalizePath(path);
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "/") return normalizedBase;
  return normalizedBase + normalizedPath;
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

// ---- Helpers ----

type Pretty<T> = { [K in keyof T]: T[K] } & {};
type Merge<T, U> = Omit<T, keyof U> & U;
type PrettyOmit<T, U extends keyof any> = Pretty<Omit<T, U>>;
type PrettyMerge<T, U> = Pretty<Merge<T, U>>;

/**
 * Build a typed `requestBody` object with `application/json` content.
 *
 * Additional media type options (e.g. `example`) can be passed via `opts.content`.
 *
 * @example
 * ```ts
 * jsonRequest(inputSchema)
 * jsonRequest(inputSchema, { description: "Create a post", content: { example: { title: "Hello" } } })
 * ```
 */
export function jsonRequest<
  S extends { _zod: any },
  O extends PrettyMerge<
    ZodOpenApiRequestBodyObject,
    { content?: PrettyOmit<ZodOpenApiMediaTypeObject, "schema"> }
  >,
>(
  schema: S,
  opts?: O,
): PrettyMerge<
  ZodOpenApiRequestBodyObject,
  {
    content: {
      "application/json": PrettyMerge<{ schema: S }, O["content"]>;
    };
  }
> {
  const { content, ...rest } = opts || {};
  return {
    required: true,
    ...rest,
    content: {
      "application/json": { schema, ...content } as PrettyMerge<
        { schema: S },
        O["content"]
      >,
    },
  };
}

/**
 * Build a typed response object with `application/json` content.
 *
 * Additional media type options (e.g. `example`) can be passed via `opts.content`.
 *
 * @example
 * ```ts
 * jsonResponse(outputSchema, { description: "Success" })
 * jsonResponse(outputSchema, {
 *   description: "Success",
 *   headers: z.object({ "x-request-id": z.string() }),
 * })
 * ```
 */
export function jsonResponse<
  S extends { _zod: any },
  H extends { _zod: any } | undefined,
  O extends PrettyMerge<
    ZodOpenApiResponseObject,
    { content?: PrettyOmit<ZodOpenApiMediaTypeObject, "schema">; headers?: H }
  >,
>(
  schema: S,
  opts: O,
): PrettyMerge<
  ZodOpenApiResponseObject,
  {
    content: { "application/json": PrettyMerge<{ schema: S }, O["content"]> };
    headers: O["headers"];
  }
> {
  const { content, headers, ...rest } = opts;
  return {
    ...rest,
    headers,
    content: {
      "application/json": { schema, ...content } as PrettyMerge<
        { schema: S },
        O["content"]
      >,
    },
  };
}

/**
 * Creates a typed schemas object for grouping route schemas together.
 *
 * The common keys are `params`, `query`, `headers`, `cookies`, `body`, and
 * `response`. Other schema properties can also be added.
 */
export function schemas<
  T extends {
    params?: ZodType;
    query?: ZodType;
    headers?: ZodType;
    cookies?: ZodType;
    body?: ZodType;
    response?: ZodType;
    [k: string]: ZodType | undefined;
  },
>(s: T): T {
  return s;
}

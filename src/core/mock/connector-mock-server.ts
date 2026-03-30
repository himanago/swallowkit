/**
 * コネクタモデル用モックサーバー
 * - コネクタモデルへのリクエスト → Zodベースのインメモリ CRUD で応答
 * - その他のリクエスト → 実Azure Functions へプロキシ
 */

import * as http from "http";
import { ModelInfo, toCamelCase } from "../scaffold/model-parser";
import { generateMockDocuments } from "./zod-mock-generator";
import { loadDevSeedFiles } from "../../cli/commands/dev-seeds";

export interface ConnectorMockServerOptions {
  /** モックサーバーのリッスンポート */
  port: number;
  /** Azure Functions の転送先ホスト:ポート（例: "localhost:7071"） */
  functionsTarget: string;
  /** コネクタモデル一覧 */
  connectorModels: ModelInfo[];
  /** 全モデル一覧（dev-seeds 読み込み用） */
  allModels?: ModelInfo[];
  /** dev-seeds 環境名（指定時はシードデータを初期データとして読み込む） */
  seedEnv?: string;
  /** dev-seeds ディレクトリ */
  seedsDir?: string;
  /** 各モデルの初期生成レコード数（デフォルト: 5） */
  mockCount?: number;
  /** ホスト名 */
  host?: string;
  /** Auth config — auth functions use RDB connector, mocked the same way */
  authConfig?: {
    /** JWT secret for mock token generation/verification */
    jwtSecret: string;
    /** Token expiry (e.g., '24h') */
    tokenExpiry?: string;
    /** Custom JWT config from swallowkit.config.js */
    customJwt?: {
      /** RDB table name that holds user records (e.g., "users") */
      userTable: string;
      loginIdColumn: string;
      passwordHashColumn: string;
      rolesColumn: string;
    };
    /** Default auth policy: 'authenticated' = all models need auth, 'anonymous' = only models with authPolicy */
    defaultPolicy?: "authenticated" | "anonymous";
  };
}

type MockDocument = Record<string, unknown>;

/**
 * コネクタモデル用モックサーバー
 */
export class ConnectorMockServer {
  private server: http.Server | null = null;
  private stores = new Map<string, MockDocument[]>();
  private routeMap = new Map<string, ModelInfo>(); // route → model
  private options: ConnectorMockServerOptions;

  constructor(options: ConnectorMockServerOptions) {
    this.options = options;

    // ルートマップを構築: モデル名(camelCase) → ModelInfo
    for (const model of options.connectorModels) {
      const route = toCamelCase(model.name);
      this.routeMap.set(route, model);
    }
  }

  /**
   * モックデータを初期化し、サーバーを起動
   */
  async start(): Promise<void> {
    await this.initializeStores();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", reject);
      this.server.listen(this.options.port, this.options.host || "localhost", () => {
        resolve();
      });
    });
  }

  /**
   * サーバーを停止
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Force close keep-alive connections (Node.js 18.2+)
        if (typeof (this.server as any).closeAllConnections === "function") {
          (this.server as any).closeAllConnections();
        }
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * 特定モデルの現在のストアデータを取得（テスト用）
   */
  getStore(modelName: string): MockDocument[] {
    const route = toCamelCase(modelName);
    return this.stores.get(route) || [];
  }

  // ─── Internal ─────────────────────────────────────────────

  private async initializeStores() {
    const allModels = this.options.allModels || this.options.connectorModels;
    const mockCount = this.options.mockCount ?? 5;

    // まず Zod ベースのモックデータで初期化
    for (const model of this.options.connectorModels) {
      const route = toCamelCase(model.name);
      this.stores.set(route, generateMockDocuments(model, mockCount, allModels));
    }

    // dev-seeds があれば上書き
    if (this.options.seedEnv) {
      try {
        const seedFiles = await loadDevSeedFiles(
          this.options.seedEnv,
          this.options.connectorModels,
          this.options.seedsDir
        );
        for (const seedFile of seedFiles) {
          const route = toCamelCase(seedFile.model.name);
          if (this.stores.has(route)) {
            this.stores.set(route, seedFile.documents as MockDocument[]);
            console.log(`  📂 Loaded ${seedFile.documents.length} seed doc(s) for ${seedFile.model.name}`);
          }
        }
      } catch (err) {
        console.warn(`⚠️  Failed to load dev-seeds for connectors: ${(err as Error).message}`);
      }
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const { route, id } = this.parseRoute(req.url || "");

    // Auth endpoints (when authConfig is set)
    if (this.options.authConfig && route === "auth") {
      this.handleAuthRequest(req, res, id);
      return;
    }

    // コネクタモデルのルートか判定
    if (route && this.routeMap.has(route)) {
      this.handleMockCrud(req, res, route, id);
    } else {
      this.proxyToFunctions(req, res);
    }
  }

  /**
   * URL パス解析: /api/backlogIssue/123 → { route: "backlogIssue", id: "123" }
   */
  private parseRoute(url: string): { route: string | null; id: string | null } {
    const parsed = new URL(url, "http://localhost");
    const segments = parsed.pathname.split("/").filter(Boolean);

    // /api/<route> or /api/<route>/<id>
    if (segments.length >= 2 && segments[0] === "api") {
      return {
        route: segments[1],
        id: segments.length >= 3 ? segments[2] : null,
      };
    }

    return { route: null, id: null };
  }

  private handleMockCrud(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    route: string,
    id: string | null
  ) {
    const method = (req.method || "GET").toUpperCase();
    const store = this.stores.get(route) || [];
    const model = this.routeMap.get(route)!;
    const ops = model.connectorConfig?.operations || [];

    const isWrite = method === "POST" || method === "PUT" || method === "DELETE";
    const requiredRoles = this.resolveRequiredRoles(model, isWrite);
    const authResult = this.checkAuth(req, res, model, requiredRoles);
    if (authResult === "error") return; // 401/403 already sent

    switch (method) {
      case "GET":
        req.resume();
        if (id) {
          if (!ops.includes("getById")) {
            return this.sendJson(res, 405, { error: "getById not supported" });
          }
          const item = store.find((doc) => doc.id === id);
          return item
            ? this.sendJson(res, 200, item)
            : this.sendJson(res, 404, { error: "Item not found" });
        }
        if (!ops.includes("getAll")) {
          return this.sendJson(res, 405, { error: "getAll not supported" });
        }
        return this.sendJson(res, 200, store);

      case "POST":
        if (!ops.includes("create")) {
          return this.drainAndRespond(req, res, 405, { error: "create not supported" });
        }
        this.readBody(req, (body) => {
          if (!body.id) {
            body.id = `${route}-${Date.now()}`;
          }
          body.createdAt = body.createdAt || new Date().toISOString();
          body.updatedAt = body.updatedAt || new Date().toISOString();
          store.push(body);
          this.sendJson(res, 201, body);
        });
        return;

      case "PUT":
        if (!ops.includes("update")) {
          return this.drainAndRespond(req, res, 405, { error: "update not supported" });
        }
        if (!id) return this.drainAndRespond(req, res, 400, { error: "id required" });
        this.readBody(req, (body) => {
          const idx = store.findIndex((doc) => doc.id === id);
          if (idx === -1) return this.sendJson(res, 404, { error: "Item not found" });
          body.updatedAt = new Date().toISOString();
          store[idx] = { ...store[idx], ...body, id };
          this.sendJson(res, 200, store[idx]);
        });
        return;

      case "DELETE":
        req.resume();
        if (!ops.includes("delete")) {
          return this.sendJson(res, 405, { error: "delete not supported" });
        }
        if (!id) return this.sendJson(res, 400, { error: "id required" });
        const deleteIdx = store.findIndex((doc) => doc.id === id);
        if (deleteIdx === -1) return this.sendJson(res, 404, { error: "Item not found" });
        store.splice(deleteIdx, 1);
        return this.sendJson(res, 204, null);

      default:
        req.resume();
        return this.sendJson(res, 405, { error: `Method ${method} not allowed` });
    }
  }

  /**
   * コネクタモデル以外のリクエストをAzure Functionsへプロキシ
   */
  private proxyToFunctions(req: http.IncomingMessage, res: http.ServerResponse) {
    const [targetHost, targetPort] = this.options.functionsTarget.split(":");

    const proxyOpts: http.RequestOptions = {
      hostname: targetHost,
      port: parseInt(targetPort, 10),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: this.options.functionsTarget },
    };

    const proxyReq = http.request(proxyOpts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (err) => {
      // Functions がまだ起動していない場合
      this.sendJson(res, 502, {
        error: "Azure Functions not available",
        detail: err.message,
      });
    });

    req.pipe(proxyReq, { end: true });
  }

  // ─── Auth Routes (RDB user queries + JWT generation) ───

  private handleAuthRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    endpoint: string | null
  ) {
    const method = (req.method || "GET").toUpperCase();

    // Handle CORS preflight
    if (method === "OPTIONS") {
      req.resume();
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    if (endpoint === "login" && method === "POST") {
      this.handleLogin(req, res);
    } else if (endpoint === "me" && method === "GET") {
      this.handleMe(req, res);
    } else if (endpoint === "logout" && method === "POST") {
      req.resume();
      this.sendJson(res, 200, { message: "Logged out" });
    } else {
      req.resume();
      this.sendJson(res, 404, { error: "Auth endpoint not found" });
    }
  }

  private handleLogin(req: http.IncomingMessage, res: http.ServerResponse) {
    this.readBody(req, (body) => {
      const loginId = body.loginId as string;
      const password = body.password as string;

      if (!loginId || !password) {
        return this.sendJson(res, 400, { error: "loginId and password are required" });
      }

      const users = this.resolveUserStore();
      if (!users) {
        return this.sendJson(res, 500, {
          error: "No user model found — ensure a connector model with the configured userTable exists",
        });
      }

      const loginField = this.options.authConfig?.customJwt?.loginIdColumn || "loginId";
      const passwordField = this.options.authConfig?.customJwt?.passwordHashColumn || "password";
      const rolesField = this.options.authConfig?.customJwt?.rolesColumn || "roles";

      const user = users.find(
        (u) => (u[loginField] || u.loginId) === loginId
      );

      if (!user) {
        return this.sendJson(res, 401, { error: "Invalid credentials" });
      }

      // Plaintext password comparison (mock mode only)
      const storedPassword = (user[passwordField] || user.password) as string;
      if (storedPassword !== password) {
        return this.sendJson(res, 401, { error: "Invalid credentials" });
      }

      // Parse roles
      let roles: string[] = [];
      const rolesValue = user[rolesField] || user.roles;
      if (Array.isArray(rolesValue)) {
        roles = rolesValue as string[];
      } else if (typeof rolesValue === "string") {
        try {
          roles = JSON.parse(rolesValue);
        } catch {
          roles = (rolesValue as string).split(",").map((r: string) => r.trim());
        }
      }

      const authUser = {
        id: String(user.id),
        loginId: String(user[loginField] || user.loginId),
        name: String(user.name || user[loginField] || user.loginId),
        email: String(user.email || ""),
        roles,
      };

      // Generate JWT
      const jwt = require("jsonwebtoken");
      const secret = this.options.authConfig!.jwtSecret;
      const expiry = this.options.authConfig!.tokenExpiry || "24h";

      const token = jwt.sign(
        {
          sub: authUser.id,
          loginId: authUser.loginId,
          name: authUser.name,
          email: authUser.email,
          roles: authUser.roles,
        },
        secret,
        { expiresIn: expiry }
      );

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      this.sendJson(res, 200, { user: authUser, token, expiresAt });
    });
  }

  private handleMe(req: http.IncomingMessage, res: http.ServerResponse) {
    req.resume();

    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return this.sendJson(res, 401, { error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.slice(7);
    try {
      const jwt = require("jsonwebtoken");
      const secret = this.options.authConfig!.jwtSecret;
      const payload = jwt.verify(token, secret) as Record<string, unknown>;
      this.sendJson(res, 200, {
        sub: payload.sub,
        loginId: payload.loginId,
        name: payload.name,
        email: payload.email,
        roles: payload.roles,
      });
    } catch {
      this.sendJson(res, 401, { error: "Invalid or expired token" });
    }
  }

  // ─── Utilities ────────────────────────────────────────────

  /**
   * authConfig.customJwt.userTable に対応するモデルのストアを返す。
   * ユーザーテーブルが見つからない場合は null を返す。
   */
  private resolveUserStore(): MockDocument[] | null {
    const userTable = this.options.authConfig?.customJwt?.userTable;
    if (!userTable) return null;

    for (const model of this.options.connectorModels) {
      const cfg = model.connectorConfig;
      if (cfg && "table" in cfg && cfg.table === userTable) {
        return this.stores.get(toCamelCase(model.name)) || null;
      }
    }
    return null;
  }

  /**
   * JWT を検証し、ペイロード（roles 含む）を返す。
   * 認証不要な場合は null を返す。401/403 の場合はレスポンスを送信して 'error' を返す。
   */
  private checkAuth(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    model: ModelInfo,
    requiredRoles: string[] | undefined
  ): Record<string, unknown> | null | "error" {
    const authCfg = this.options.authConfig;
    if (!authCfg) return null; // auth 未設定 → 全スルー

    const policy = model.authPolicy;
    const defaultPolicy = authCfg.defaultPolicy || "anonymous";

    // モデルに authPolicy がなく defaultPolicy が anonymous → 認証不要
    if (!policy && defaultPolicy === "anonymous") return null;

    // JWT 検証
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      this.sendJson(res, 401, { error: "Missing or invalid Authorization header" });
      return "error";
    }

    const token = authHeader.slice(7);
    try {
      const jwt = require("jsonwebtoken");
      const payload = jwt.verify(token, authCfg.jwtSecret) as Record<string, unknown>;

      // ロールチェック
      if (requiredRoles && requiredRoles.length > 0) {
        const userRoles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
        const hasRole = requiredRoles.some((r) => userRoles.includes(r));
        if (!hasRole) {
          this.sendJson(res, 403, {
            error: `Requires one of roles: ${requiredRoles.join(", ")}`,
          });
          return "error";
        }
      }

      return payload;
    } catch {
      this.sendJson(res, 401, { error: "Invalid or expired token" });
      return "error";
    }
  }

  /**
   * モデルの authPolicy から read/write に必要なロールを解決
   */
  private resolveRequiredRoles(
    model: ModelInfo,
    isWrite: boolean
  ): string[] | undefined {
    const policy = model.authPolicy;
    if (!policy) return undefined; // defaultPolicy: authenticated → 認証のみ、ロールチェック不要

    if (isWrite) {
      return policy.write || policy.roles;
    }
    return policy.read || policy.roles;
  }

  private readBody(req: http.IncomingMessage, callback: (body: MockDocument) => void) {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        callback(JSON.parse(data));
      } catch {
        callback({});
      }
    });
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Connection": "close",
    });
    if (body !== null && body !== undefined) {
      res.end(JSON.stringify(body));
    } else {
      res.end();
    }
  }

  /**
   * リクエストボディを完全に読み捨ててからレスポンスを送信
   * POST/PUT の 405 等で未読ボディがある場合に Linux で RST を防ぐ
   */
  private drainAndRespond(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    body: unknown
  ) {
    if (req.readableEnded) {
      this.sendJson(res, status, body);
      return;
    }
    req.resume();
    req.on("end", () => {
      this.sendJson(res, status, body);
    });
  }
}

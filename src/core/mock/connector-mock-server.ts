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

  // ─── Utilities ────────────────────────────────────────────

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

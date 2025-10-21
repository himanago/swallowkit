import { IncomingMessage, ServerResponse } from 'http';

export interface RpcRequest {
  fnName: string;
  args: any[];
}

export interface RpcResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * SwallowKit RPC APIハンドラー
 * useServerFnからの呼び出しを処理
 */
export class RpcHandler {
  private serverFunctions: Map<string, Function> = new Map();

  /**
   * サーバー関数を登録
   */
  registerFunction(name: string, fn: Function): void {
    this.serverFunctions.set(name, fn);
  }

  /**
   * 複数のサーバー関数を一括登録
   */
  registerFunctions(functions: Record<string, Function>): void {
    Object.entries(functions).forEach(([name, fn]) => {
      this.registerFunction(name, fn);
    });
  }

  /**
   * Express.js スタイルのミドルウェア
   */
  expressMiddleware() {
    return async (req: any, res: any, next?: any) => {
      if (req.method !== 'POST') {
        if (next) return next();
        return this.sendError(res, 405, 'Method not allowed');
      }

      if (req.path !== '/api/_swallowkit' && req.url !== '/api/_swallowkit') {
        if (next) return next();
        return this.sendError(res, 404, 'Not found');
      }

      try {
        const body = req.body;
        const result = await this.handleRequest(body);
        this.sendSuccess(res, result);
      } catch (error) {
        this.sendError(res, 500, error instanceof Error ? error.message : 'Internal server error');
      }
    };
  }

  /**
   * Next.js API Routes 対応
   */
  nextApiHandler() {
    return async (req: any, res: any) => {
      if (req.method !== 'POST') {
        return this.sendError(res, 405, 'Method not allowed');
      }

      try {
        const result = await this.handleRequest(req.body);
        this.sendSuccess(res, result);
      } catch (error) {
        this.sendError(res, 500, error instanceof Error ? error.message : 'Internal server error');
      }
    };
  }

  /**
   * Azure Static Web Apps API 対応
   */
  azureStaticWebAppsHandler() {
    return async (context: any, req: any) => {
      context.log('SwallowKit RPC handler processing request');

      if (req.method !== 'POST') {
        context.res = {
          status: 405,
          body: { error: 'Method not allowed' }
        };
        return;
      }

      try {
        const result = await this.handleRequest(req.body);
        context.res = {
          status: 200,
          body: result
        };
      } catch (error) {
        context.log.error('RPC handler error:', error);
        context.res = {
          status: 500,
          body: { error: error instanceof Error ? error.message : 'Internal server error' }
        };
      }
    };
  }

  /**
   * Node.js http サーバー対応
   */
  nodeHttpHandler() {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        return this.sendError(res, 405, 'Method not allowed');
      }

      try {
        const body = await this.parseRequestBody(req);
        const result = await this.handleRequest(body);
        this.sendSuccess(res, result);
      } catch (error) {
        this.sendError(res, 500, error instanceof Error ? error.message : 'Internal server error');
      }
    };
  }

  /**
   * リクエストを処理
   */
  private async handleRequest(body: RpcRequest): Promise<any> {
    const { fnName, args } = body;

    if (!fnName) {
      throw new Error('Function name is required');
    }

    const serverFn = this.serverFunctions.get(fnName);
    if (!serverFn) {
      throw new Error(`Unknown function: ${fnName}`);
    }

    // 関数を実行
    const result = await serverFn(...(args || []));
    return result;
  }

  /**
   * 成功レスポンスを送信
   */
  private sendSuccess(res: any, data: any): void {
    const response = { success: true, data };
    
    if (typeof res.json === 'function') {
      // Express.js/Next.js スタイル
      res.status(200).json(response);
    } else {
      // Node.js http スタイル
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    }
  }

  /**
   * エラーレスポンスを送信
   */
  private sendError(res: any, status: number, message: string): void {
    const response = { success: false, error: message };
    
    if (typeof res.json === 'function') {
      // Express.js/Next.js スタイル
      res.status(status).json(response);
    } else {
      // Node.js http スタイル
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    }
  }

  /**
   * Node.js リクエストボディをパース
   */
  private parseRequestBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error('Invalid JSON'));
        }
      });
      
      req.on('error', reject);
    });
  }

  /**
   * 登録された関数一覧を取得
   */
  getRegisteredFunctions(): string[] {
    return Array.from(this.serverFunctions.keys());
  }

  /**
   * 関数の登録を削除
   */
  unregisterFunction(name: string): boolean {
    return this.serverFunctions.delete(name);
  }

  /**
   * 全ての関数登録をクリア
   */
  clearFunctions(): void {
    this.serverFunctions.clear();
  }
}

// デフォルトインスタンス
export const defaultRpcHandler = new RpcHandler();

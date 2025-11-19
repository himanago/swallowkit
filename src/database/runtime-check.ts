/**
 * ランタイム環境の検証
 * クライアント側でのDB操作を防ぐ
 */

/**
 * サーバー側で実行されているかチェック
 */
export function isServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * サーバー側での実行を強制
 * クライアント側で呼ばれた場合はエラーを投げる
 */
export function ensureServerSide(operationName: string = 'Database operation'): void {
  if (!isServer()) {
    throw new Error(
      `${operationName} can only be executed on the server side. ` +
      `Please use this within Server Components, Server Actions, or API Routes. ` +
      `Client Components cannot directly access the database.`
    );
  }
}

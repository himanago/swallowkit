# useServerFn フック - 完全ガイド

SwallowKitの`useServerFn`フックは、Azure Static Web Apps向けに最適化された型安全なサーバー関数呼び出しシステムです。

## 🔧 現在の実装状況

### ✅ 完成している機能

1. **基本的なサーバー関数呼び出し**
   - SSR/CSR自動判別
   - エラーハンドリング
   - ローディング状態管理

2. **型安全なサーバー関数システム**
   - `defineServerFunction()` による型安全な関数定義
   - `useTypedServerFn()` による型推論
   - コンパイル時の型チェック

3. **関数名解決の堅牢性**
   - 一意のID生成（minify対応）
   - 自動登録機能
   - フォールバック機能

4. **開発者体験の向上**
   - 開発時の警告システム
   - デバッグ情報の提供
   - 詳細なエラーメッセージ

### 🚀 主要な改善点

#### 1. 型安全なサーバー関数定義

```typescript
// 推奨: defineServerFunction を使用
const getTodos = defineServerFunction("getTodos", async (): Promise<Todo[]> => {
  // 実装
  return todos;
});

// フック内で自動的に型推論
const { data, loading, error } = useTypedServerFn(getTodos, []);
//      ^^^^^                                                ^^^^
//    Todo[] | null                                          []
```

#### 2. minify対応の関数名解決

```typescript
// 一意のIDによる識別（minify時も安全）
const serverFn = defineServerFunction("myFunction", async () => {
  // 内部で一意のID生成: swk_myFunction_1637123456789_abc123
});
```

#### 3. 開発時の警告とデバッグ

```typescript
// 未登録関数の警告
if (process.env.NODE_ENV === 'development' && !isServerFunctionRegistered(serverFn)) {
  console.warn('SwallowKit: Server function is not registered...');
}

// デバッグ情報の取得
const debugInfo = getRegistryDebugInfo();
console.log('Registered functions:', debugInfo);
```

## 📚 使用方法

### 基本的な使用例

```typescript
import { defineServerFunction, useTypedServerFn } from "swallowkit";

// 1. サーバー関数の定義
const fetchUserData = defineServerFunction(
  "fetchUserData", 
  async (userId: string): Promise<User> => {
    // Cosmos DB からデータを取得
    return await userRepository.findById(userId);
  }
);

// 2. React コンポーネントで使用
function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading, error, refetch } = useTypedServerFn(
    fetchUserData, 
    [userId],
    {
      enabled: !!userId, // userIdが存在する時のみ実行
    }
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

### 高度な使用例

```typescript
// 複数の引数を持つサーバー関数
const searchUsers = defineServerFunction(
  "searchUsers",
  async (query: string, page: number, limit: number): Promise<{
    users: User[];
    total: number;
    hasMore: boolean;
  }> => {
    // 検索実装
    return await userRepository.search(query, page, limit);
  }
);

// フック使用
const { data: searchResult } = useTypedServerFn(
  searchUsers,
  [searchQuery, currentPage, pageSize],
  {
    enabled: searchQuery.length > 2, // 3文字以上で検索
  }
);
```

## 🔄 従来の方式との互換性

```typescript
// 従来の方式（互換性維持）
async function legacyFunction(id: string): Promise<Data> {
  return data;
}

// 手動登録が必要
registerServerFunction(legacyFunction, "legacyFunction");

// 従来のフック使用
const { data } = useServerFn(legacyFunction, [id]);

// 推奨: 新しい方式に移行
const modernFunction = defineServerFunction("modernFunction", legacyFunction);
const { data } = useTypedServerFn(modernFunction, [id]);
```

## ⚙️ 設定オプション

### RPCエンドポイントの設定

```typescript
import { setRpcEndpoint } from "swallowkit";

// カスタムエンドポイント
setRpcEndpoint("/api/custom-rpc");

// Azure Functions v4 デフォルト
setRpcEndpoint("/api/swallowkit-rpc");
```

### 実行モードの制御

```typescript
const { data } = useTypedServerFn(myFunction, [args], {
  mode: "auto",           // 自動判別（デフォルト）
  // mode: "force-server", // 強制的にサーバー実行
  // mode: "force-client", // 強制的にRPC呼び出し
});
```

## 🔍 デバッグとトラブルシューティング

### 1. 登録状況の確認

```typescript
import { getRegistryDebugInfo, isServerFunctionRegistered } from "swallowkit";

// 全体の登録状況
console.log(getRegistryDebugInfo());

// 特定の関数の登録状況
console.log(isServerFunctionRegistered(myFunction));
```

### 2. 一般的な問題と解決方法

**問題**: 関数名が取得できない
```typescript
// ❌ 悪い例
const anonymousFunction = async () => { /* ... */ };
useServerFn(anonymousFunction, []); // エラー

// ✅ 良い例
const namedFunction = defineServerFunction("myFunction", async () => { /* ... */ });
useTypedServerFn(namedFunction, []);
```

**問題**: minify時に関数名が変更される
```typescript
// ❌ 問題のあるコード
function myFunc() { /* ... */ }
// minify後: function a() { /* ... */ }

// ✅ 解決方法
const myFunc = defineServerFunction("myFunc", () => { /* ... */ });
// 内部でIDベースの識別を使用
```

## 📋 チェックリスト

useServerFnを使用する際の確認事項：

- [ ] `defineServerFunction` を使用してサーバー関数を定義している
- [ ] `useTypedServerFn` を使用して型安全性を確保している
- [ ] エラーハンドリングを適切に実装している
- [ ] ローディング状態を表示している
- [ ] 必要に応じて `enabled` オプションを使用している
- [ ] デバッグ情報を確認している（開発時）

## 🎯 次のステップ

1. **パフォーマンス最適化**: キャッシュ機能の実装
2. **リアルタイム対応**: SignalR連携
3. **バッチ処理**: 複数のサーバー関数を一度に呼び出し
4. **オフライン対応**: Service Worker連携

SwallowKitの`useServerFn`は、型安全性、開発者体験、本番環境での信頼性を重視して設計されており、現在のバージョンで基本的な機能は完成しています。

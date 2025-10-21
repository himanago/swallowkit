// デフォルトのサーバー関数テンプレート（Cosmos DB使用)
export const DEFAULT_SERVER_FUNCTIONS_TEMPLATE = `// サーバー側で実行される関数（Cosmos DB使用）
// SwallowKit は Cosmos DB を標準データストアとして使用します
// 
// 【重要】事前にデータベースとコンテナを作成してください:
// 1. Cosmos DB Emulator を起動
// 2. Data Explorer で以下を作成:
//    - Database: swallowkit-db (または環境変数 COSMOS_DATABASE)
//    - Container: todos (または環境変数 COSMOS_CONTAINER)
//    - Partition Key: /id

import { CosmosClient } from '@azure/cosmos';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

// Cosmos DB クライアント
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT || 'http://localhost:8081',
  key: process.env.COSMOS_KEY || 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
});

const databaseId = process.env.COSMOS_DATABASE || 'swallowkit-db';
const containerId = process.env.COSMOS_CONTAINER || 'todos';

const database = cosmosClient.database(databaseId);
const container = database.container(containerId);

export async function getTodos(): Promise<Todo[]> {
  const { resources } = await container.items
    .readAll<Todo>()
    .fetchAll();
  return resources;
}

export async function addTodo({ text }: { text: string }): Promise<Todo> {
  const newTodo: Todo = {
    id: Date.now().toString(),
    text,
    completed: false,
  };
  const { resource } = await container.items.create(newTodo);
  return resource as Todo;
}

export async function deleteTodo({ id }: { id: string }): Promise<{ success: boolean }> {
  await container.item(id, id).delete();
  return { success: true };
}

export async function toggleTodo({ id }: { id: string }): Promise<Todo | null> {
  const { resource: todo } = await container.item(id, id).read<Todo>();
  if (todo) {
    todo.completed = !todo.completed;
    const { resource } = await container.item(id, id).replace(todo);
    return resource as Todo;
  }
  return null;
}
`;

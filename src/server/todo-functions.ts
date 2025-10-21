import { Todo, TodoSchema, CreateTodoRequestSchema, UpdateTodoRequestSchema } from '../schemas/example';
import { z } from 'zod';

// Todo CRUD サーバー関数の例

export async function getTodos(): Promise<Todo[]> {
  // 実際の実装ではCosmos DBから取得
  return [
    {
      id: "1",
      text: "SwallowKitを学ぶ",
      completed: false,
      priority: "high",
      tags: ["学習", "フレームワーク"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "2",
      text: "Azureにデプロイする",
      completed: true,
      priority: "medium",
      tags: ["デプロイ", "Azure"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

export async function getTodoById(id: string): Promise<Todo | null> {
  // 実際の実装ではCosmos DBから取得
  const todos = await getTodos();
  return todos.find(todo => todo.id === id) || null;
}

export async function createTodo(data: z.infer<typeof CreateTodoRequestSchema>): Promise<Todo> {
  // バリデーション
  const validatedData = CreateTodoRequestSchema.parse(data);
  
  // 実際の実装ではCosmos DBに保存
  const newTodo: Todo = {
    id: Date.now().toString(),
    ...validatedData,
    completed: false,
    priority: validatedData.priority || 'medium',
    tags: validatedData.tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return newTodo;
}

export async function updateTodo(id: string, data: z.infer<typeof UpdateTodoRequestSchema>): Promise<Todo | null> {
  // バリデーション
  const validatedData = UpdateTodoRequestSchema.parse(data);
  
  // 既存のTodoを取得
  const existingTodo = await getTodoById(id);
  if (!existingTodo) {
    return null;
  }

  // 実際の実装ではCosmos DBで更新
  const updatedTodo: Todo = {
    ...existingTodo,
    ...validatedData,
    updatedAt: new Date().toISOString(),
  };

  return updatedTodo;
}

export async function deleteTodo(id: string): Promise<boolean> {
  // 実際の実装ではCosmos DBから削除
  const existingTodo = await getTodoById(id);
  return existingTodo !== null;
}

export async function toggleTodoComplete(id: string): Promise<Todo | null> {
  const existingTodo = await getTodoById(id);
  if (!existingTodo) {
    return null;
  }

  return updateTodo(id, { completed: !existingTodo.completed });
}

// 複雑なビジネスロジックの例
export async function getTodoStats(): Promise<{
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  byPriority: Record<string, number>;
}> {
  const todos = await getTodos();
  const now = new Date();

  const stats = {
    total: todos.length,
    completed: todos.filter(t => t.completed).length,
    pending: todos.filter(t => !t.completed).length,
    overdue: todos.filter(t => 
      !t.completed && 
      t.dueDate && 
      new Date(t.dueDate) < now
    ).length,
    byPriority: todos.reduce((acc, todo) => {
      acc[todo.priority] = (acc[todo.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };

  return stats;
}

// 検索機能の例
export async function searchTodos(query: string): Promise<Todo[]> {
  const todos = await getTodos();
  const lowerQuery = query.toLowerCase();
  
  return todos.filter(todo =>
    todo.text.toLowerCase().includes(lowerQuery) ||
    todo.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

// バッチ操作の例
export async function bulkUpdateTodos(updates: Array<{ id: string; data: z.infer<typeof UpdateTodoRequestSchema> }>): Promise<Todo[]> {
  const results: Todo[] = [];
  
  for (const update of updates) {
    const result = await updateTodo(update.id, update.data);
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

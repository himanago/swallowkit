# SwallowKit

A React framework for building full-stack Azure Static Web Apps with Cosmos DB integration.

> **Note**: This project is in early development. APIs may change in future versions.

## 🚀 Features

- **Cosmos DB Integration**: Built-in Cosmos DB support with automatic setup
- **React Hooks Based**: Simple server function calls with `useServerFn` / `callServerFn`
- **Type-Safe**: Full TypeScript support with end-to-end type safety
- **Azure Optimized**: Designed for Azure Static Web Apps + Azure Functions v4
- **Developer Experience**: Simple CLI commands to get started

## 📋 Prerequisites

- Node.js 22.x
- Azure Cosmos DB Emulator (for local development)
  - Windows: Install from [official site](https://aka.ms/cosmosdb-emulator)
  - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 📦 Installation

```bash
npm install swallowkit
```

## 🛠️ Quick Start

### Basic Usage

```typescript
import { useServerFn, callServerFn } from 'swallowkit';

// Define your server function type
async function getTodos(): Promise<Todo[]> {
  // Implementation will be on the server side
  throw new Error("Server function");
}

// Use in React component
function TodoList() {
  const { data, loading, error, refetch } = useServerFn(getTodos, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <ul>
        {data?.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

## 🎯 Usage with React

### Query with `useServerFn`

For data fetching operations that need state management:

```tsx
import { useServerFn } from "swallowkit";

function TodoList() {
  const { data: todos, loading, error, refetch } = useServerFn(getTodos, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <ul>
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

### Mutations with `callServerFn`

For operations like create, update, delete that don't need state management:

```tsx
import { useServerFn, callServerFn } from "swallowkit";

function TodoApp() {
  const [newTodoText, setNewTodoText] = useState("");
  const { data: todos, loading, error, refetch } = useServerFn(getTodos, []);

  const handleAddTodo = async () => {
    if (!newTodoText.trim()) return;
    
    await callServerFn(addTodo, { text: newTodoText });
    setNewTodoText("");
    refetch(); // Refetch to get the latest data
  };

  const handleDeleteTodo = async (id: string) => {
    await callServerFn(deleteTodo, { id });
    refetch();
  };

  // ... rendering
}
```

## 📚 API Reference

### `useServerFn<TResult>(serverFn, args, options?)`

**Parameters:**
- `serverFn`: Server function to call
- `args`: Array of function arguments
- `options?`: Optional configuration

**Returns:**
```typescript
{
  data: TResult | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
```

**Example:**
```typescript
const { data, loading, error, refetch } = useServerFn(getTodos, []);
```

### `callServerFn<TArgs, TResult>(serverFn, ...args)`

**Parameters:**
- `serverFn`: Server function to call
- `...args`: Function arguments

**Returns:**
- `Promise<TResult>`: Server function execution result

**Example:**
```typescript
const result = await callServerFn(addTodo, { text: "New todo" });
```

### `useQuery` / `useMutation`

Advanced hooks for more granular control over queries and mutations.

```typescript
import { useQuery, useMutation } from 'swallowkit';

// Query
const { data, isLoading, error } = useQuery({
  queryFn: getTodos,
  queryKey: ['todos']
});

// Mutation
const { mutate } = useMutation({
  mutationFn: addTodo,
  onSuccess: () => {
    // Handle success
  }
});
```

## 🔧 Database Integration

### Cosmos DB Client

```typescript
import { getDatabaseClient } from 'swallowkit';

const client = getDatabaseClient();
// Use Cosmos DB client
```

### Schema-based Repository

```typescript
import { createRepository } from 'swallowkit';
import { z } from 'zod';

const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
});

const todoRepo = createRepository(TodoSchema, 'todos');

// CRUD operations
await todoRepo.create({ id: '1', text: 'Task', completed: false });
await todoRepo.findById('1');
await todoRepo.update('1', { completed: true });
await todoRepo.delete('1');
```

## 🤝 Contributing

This project is in early development. Feedback and suggestions are welcome!

## 📄 License

MIT

## 🔗 Related Links

- [Azure Static Web Apps](https://azure.microsoft.com/services/app-service/static/)
- [Azure Functions](https://azure.microsoft.com/services/functions/)
- [Azure Cosmos DB](https://azure.microsoft.com/services/cosmos-db/)
- [React](https://reactjs.org/)
- [TypeScript](https://www.typescriptlang.org/)


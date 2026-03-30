# SwallowKit Scaffold Guide

## Overview

SwallowKit Scaffold is a powerful code generation tool that automatically creates complete CRUD (Create, Read, Update, Delete) operations from your Zod schema definitions. It generates Azure Functions, Next.js API routes, and type-safe UI components with minimal configuration. When your project uses a C# or Python Functions backend, it also exports OpenAPI and generates backend schema assets from the shared Zod models.

💡 **Reference**: For more information about schema sharing concepts and benefits, please see the **[Zod Schema Sharing Guide](./zod-schema-sharing-guide.md)**.

## Quick Start

### 1. Create Model Template

Use the `create-model` command to generate a model template with `id`, `createdAt`, and `updatedAt` fields:

```bash
npx swallowkit create-model product
```

This generates `shared/models/product.ts`:

```typescript
import { z } from 'zod';

// Product model
export const product = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Product = z.infer<typeof product>;
```

💡 **Create multiple models at once**:

```bash
npx swallowkit create-model user post comment
```

### 2. Customize Your Model

Edit the generated file to add your required fields:

```typescript
// shared/models/product.ts
import { z } from 'zod';

export const product = z.object({
  id: z.string(),
  name: z.string().min(1, "Product name is required"),
  price: z.number().min(0, "Price must be positive"),
  category: z.enum(["electronics", "clothing", "books", "other"]),
  isActive: z.boolean().default(true),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Product = z.infer<typeof product>;
```

⚠️ **Important**: Always include `id`, `createdAt`, and `updatedAt` fields. These are automatically managed by the backend.

#### SwallowKit-Managed Fields Specification

These fields behave as follows:

- **Model Definition**: Defined as `optional()` (not required)
- **Frontend**: Not submitted from forms; automatically set by the backend
- **Backend (Create)**:
  - Values sent from client are ignored
  - `id`: UUID is auto-generated (or uses client-provided value if sent)
  - `createdAt`: Set to current timestamp
  - `updatedAt`: Set to current timestamp
- **Backend (Update)**:
  - Values sent from client are ignored
  - `createdAt`: Existing value is preserved (never changed)
  - `updatedAt`: Updated to current timestamp

This ensures timestamp consistency and prevents clients from setting incorrect values.

### 3. Run Scaffold Command

```bash
npx swallowkit scaffold shared/models/product.ts
```

### 4. Generated Files

The scaffold command generates the following files:

**Azure Functions (Backend):**
- TypeScript backend: `functions/src/product.ts` - CRUD Azure Functions
- C# backend: `functions/Crud/ProductFunctions.cs` - starter CRUD handlers
- Python backend: `functions/blueprints/product.py` - starter CRUD blueprint

**Next.js BFF API Routes:**
- `app/api/product/route.ts` - GET (list) and POST (create) endpoints
- `app/api/product/[id]/route.ts` - GET, PUT, DELETE endpoints for single item

**UI Components:**
- `app/product/page.tsx` - List page with table view
- `app/product/[id]/page.tsx` - Detail page
- `app/product/new/page.tsx` - Create new item page
- `app/product/[id]/edit/page.tsx` - Edit existing item page
- `app/product/_components/ProductForm.tsx` - Reusable form component

**Configuration:**
- `lib/scaffold-config.ts` - Navigation menu configuration

**OpenAPI bridge for C#/Python backends:**
- `functions/openapi/product.openapi.json` - OpenAPI exported from the Zod model graph
- `functions/generated/csharp-models/` or `functions/generated/python-models/` - generated backend schema assets

### Backend Language Behavior

- `typescript`: the generated Functions handlers import the shared Zod schema package directly.
- `csharp` / `python`: the frontend and BFF still use Zod in `shared/models/`, and the backend consumes generated assets derived from the OpenAPI export.
- Re-run `swallowkit scaffold shared/models/<name>.ts` whenever the schema changes so `functions/openapi/` and `functions/generated/` stay in sync.

### 4. Access Your Application

Start the development server:

```bash
npx swallowkit dev
```

Open http://localhost:3000 to see your application.

If you want the Cosmos DB Emulator to start with deterministic debug data, generate a seed environment and launch `dev` with it:

```bash
npx swallowkit create-dev-seeds local
# edit dev-seeds/local/*.json
npx swallowkit dev --seed-env local
```

SwallowKit will map each `{schema}.json` file to the matching Cosmos container and replace that container's local emulator data before Azure Functions starts.

<!-- 画像: ホームページのスクリーンショット。scaffold-config.tsに登録されたモデル（Product, Category, Todoなど）がカード形式で表示されている様子 -->

## Type-Appropriate UI Generation

SwallowKit automatically generates appropriate UI controls based on your Zod schema types:

### Supported Field Types

| Zod Type | Generated UI | Example |
|----------|-------------|---------|
| `z.string()` | Text input | `<input type="text">` |
| `z.number()` | Number input | `<input type="number">` |
| `z.boolean()` | Checkbox | `<input type="checkbox">` |
| `z.string()` (date format) | Text input | `<input type="text">` (ISO string) |
| `z.enum()` | Select dropdown | `<select>` with options |
| `z.array()` | Comma-separated text input | Tags: "tag1, tag2, tag3" |
| Foreign Key | Dropdown with related data | See below |
| Nested Schema (single) | Select dropdown | `category: category` |
| Nested Schema (array) | Multi-select | `tags: z.array(tag)` |

### Boolean Fields

```typescript
isActive: z.boolean().default(true)
```

Generates a checkbox:

```tsx
<input
  type="checkbox"
  checked={formData.isActive}
  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
/>
```

### Enum Fields

```typescript
category: z.enum(["electronics", "clothing", "books", "other"])
```

Generates a dropdown:

```tsx
<select value={formData.category} onChange={...}>
  <option value="">Select an option</option>
  <option value="electronics">electronics</option>
  <option value="clothing">clothing</option>
  <option value="books">books</option>
  <option value="other">other</option>
</select>
```

### Array Fields

```typescript
tags: z.array(z.string()).optional()
```

Generates a comma-separated input:

```tsx
<input
  type="text"
  placeholder="e.g., item1, item2, item3"
  value={formData.tags}
  onChange={...}
/>
```

### Optional Fields

Fields marked with `.optional()` are not required in forms, while others have the `required` attribute.

## Nested Schema References

SwallowKit automatically detects fields that directly reference other Zod schemas and generates appropriate UI. Unlike the `categoryId: z.string()` foreign key pattern, this supports embedding Zod schema objects directly.

> **Recommended**: For parent-child relationships, prefer nested schema references over ID-based foreign keys. Nesting preserves type safety and keeps related data together in the document, which is natural for Cosmos DB's document model.

### Detected Patterns

```typescript
import { category } from './category';
import { tag } from './tag';

export const product = z.object({
  id: z.string(),
  name: z.string().min(1),
  // Single object reference (generates a select dropdown)
  category: category.optional(),
  // Array reference (generates a multi-select)
  tags: z.array(tag).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
```

### Generated UI

#### Single Object Reference

Fields like `category: category.optional()` generate a select dropdown:

```tsx
<select
  id="category"
  value={formData.categoryId}
  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
>
  <option value="">Select an option</option>
  {categoryOptions.map((option) => (
    <option key={option.id} value={option.id}>{option.name}</option>
  ))}
</select>
```

On form submission, the selected ID is automatically converted back to an object.

#### Array Reference

Fields like `tags: z.array(tag)` generate a multi-select:

```tsx
<select
  id="tags"
  multiple
  value={formData.tagsIds}
  onChange={(e) => {
    const selected = Array.from(e.target.selectedOptions, option => option.value);
    setFormData({ ...formData, tagsIds: selected });
  }}
>
  {tagOptions.map((option) => (
    <option key={option.id} value={option.id}>{option.name}</option>
  ))}
</select>
```

#### List & Detail Display

- **Single reference**: Renders display name as `item.category?.name || '-'`
- **Array reference**: Renders as comma-separated display names `item.tags.map(ref => ref.name).join(', ')`

### Display Field Auto-Detection

SwallowKit automatically reads the referenced schema file and detects the display field in the following priority:

1. `name` field
2. `title` field
3. `label` field
4. Default: `name`

## Foreign Key Relationships

SwallowKit automatically detects foreign key relationships using a naming convention pattern.

### Convention

Any field ending with `Id` and having `string` type is treated as a foreign key:

```typescript
// Field name: categoryId -> References: Category model
categoryId: z.string().min(1, "Category is required")
```

**Pattern:** `<ModelName>Id` → References `<ModelName>` model

### Example: Todo with Category Reference

```typescript
// lib/models/category.ts
import { z } from 'zod';

export const category = z.object({
  id: z.string(),
  name: z.string().min(1, "Category name is required"),
  color: z.enum(["red", "blue", "green", "yellow", "purple"]).optional(),
});

export type Category = z.infer<typeof category>;

// lib/models/todo.ts
import { z } from 'zod';

export const todo = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required"),
  categoryId: z.string().min(1, "Category is required"), // Foreign key
  completed: z.boolean().default(false),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export type Todo = z.infer<typeof todo>;
```

### Generated Foreign Key UI

When a foreign key is detected, SwallowKit generates:

1. **Dropdown Select in Forms:**

```tsx
<select
  id="categoryId"
  name="categoryId"
  value={formData.categoryId}
  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
  required
>
  <option value="">Select an option</option>
  {categoryOptions.map((option) => (
    <option key={option.id} value={option.id}>
      {option.name}
    </option>
  ))}
</select>
```

2. **Data Fetching with useEffect:**

```tsx
const [categoryOptions, setCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);

useEffect(() => {
  fetch('/api/category')
    .then(res => res.json())
    .then((data: any[]) => {
      const options = data.map(item => ({
        id: item.id,
        name: item.name || item.title || item.id
      }));
      setCategoryOptions(options);
    })
    .catch(err => console.error('Failed to fetch categorys:', err));
}, []);
```

<!-- 画像: Todoフォームのスクリーンショット。categoryIdフィールドがドロップダウンになっており、作成済みのCategoryが選択肢として表示されている様子 -->

3. **Display Names in List Views:**

Instead of showing raw IDs like `"abc123"`, the list view shows the referenced item's name:

| title | Category | completed |
|-------|----------|-----------|
| Buy groceries | Shopping | ☐ |
| Fix bug | Work | ☑ |

<!-- 画像: Todo一覧画面のスクリーンショット。categoryIdカラムに「Category」というヘッダーがあり、値として実際のカテゴリー名（例: "Work", "Shopping"）が表示されている様子 -->

4. **Display Names in Detail Views:**

```tsx
<dt>Category</dt>
<dd>{categoryMap[todo.categoryId] || todo.categoryId}</dd>
```

Shows "Work" instead of the category ID.

<!-- 画像: Todo詳細画面のスクリーンショット。Categoryフィールドに実際のカテゴリー名が表示されている様子 -->

### ToString Convention

For foreign key display, SwallowKit uses the following priority to determine the display string:

1. `item.name` (if exists)
2. `item.title` (if exists)
3. `item.id` (fallback)

This means your referenced models should have either a `name` or `title` field for better UX.

## Generated Code Examples

### List Page (page.tsx)

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Todo } from '@/lib/models/todo';

export default function TodoListPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/todo')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch todos');
        return res.json();
      })
      .then((data) => {
        setTodos(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    // Fetch foreign key reference data
    fetch('/api/category')
      .then(res => res.json())
      .then((data: any[]) => {
        const map: Record<string, string> = {};
        data.forEach(item => {
          map[item.id] = item.name || item.title || item.id;
        });
        setCategoryMap(map);
      })
      .catch(err => console.error('Failed to fetch categorys:', err));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const res = await fetch(`/api/todo/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete todo');

      setTodos(todos.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-gray-900 dark:text-gray-100">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600 dark:text-red-400">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Todo</h1>
        <Link
          href="/todo/new"
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          Create New
        </Link>
      </div>

      {todos.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No todos found. Create your first one!
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  completed
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {todos.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {String(item.title)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {categoryMap[item.categoryId] || item.categoryId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {String(item.completed)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link
                      href={`/todo/${item.id}`}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4"
                    >
                      View
                    </Link>
                    <Link
                      href={`/todo/${item.id}/edit`}
                      className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 mr-4"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### Form Component (TodoForm.tsx)

```tsx
'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { todo } from '@/lib/models/todo';
import { z } from 'zod';

interface TodoFormProps {
  initialData?: any;
  isEdit?: boolean;
}

export default function TodoForm({ initialData, isEdit = false }: TodoFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categoryOptions, setCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    categoryId: initialData?.categoryId || '',
    completed: initialData?.completed || false,
    priority: initialData?.priority || 'medium',
  });

  useEffect(() => {
    fetch('/api/category')
      .then(res => res.json())
      .then((data: any[]) => {
        const options = data.map(item => ({
          id: item.id,
          name: item.name || item.title || item.id
        }));
        setCategoryOptions(options);
      })
      .catch(err => console.error('Failed to fetch categorys:', err));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // Validate with Zod
      const validatedData = todo.parse({
        ...formData,
        id: initialData?.id || crypto.randomUUID(),
      });

      const url = isEdit ? `/api/todo/${initialData.id}` : '/api/todo';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validatedData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save');
      }

      router.push('/todo');
      router.refresh();
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach((error) => {
          if (error.path) {
            fieldErrors[error.path[0]] = error.message;
          }
        });
        setErrors(fieldErrors);
      } else {
        alert(`Error: ${err.message}`);
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          title *
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          required
        />
        {errors.title && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.title}</p>
        )}
      </div>

      <div>
        <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Category *
        </label>
        <select
          id="categoryId"
          name="categoryId"
          value={formData.categoryId}
          onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          required
        >
          <option value="">Select an option</option>
          {categoryOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {errors.categoryId && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.categoryId}</p>
        )}
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="completed"
          name="completed"
          checked={formData.completed}
          onChange={(e) => setFormData({ ...formData, completed: e.target.checked })}
          className="h-4 w-4 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 border-gray-300 dark:border-gray-600 rounded"
        />
        <label htmlFor="completed" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
          completed
        </label>
        {errors.completed && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.completed}</p>
        )}
      </div>

      <div>
        <label htmlFor="priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          priority
        </label>
        <select
          id="priority"
          name="priority"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
        >
          <option value="">Select an option</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        {errors.priority && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.priority}</p>
        )}
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 text-white px-6 py-2 rounded"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
```

## Best Practices

### 1. Model Naming Conventions

- Schema names: `camelCase` (no suffix): `product`, `category`, `todo`
- Type names: `PascalCase` (no suffix): `Product`, `Category`, `Todo`
- Class names: `PascalCase`: `Product`, `Category`, `Todo`
- Export the schema and type:
  ```typescript
  export const product = z.object({...});
  export type Product = z.infer<typeof product>;
  ```

### 2. Foreign Key Naming

- Always end foreign key fields with `Id`: `categoryId`, `userId`, `orderId`
- Use `z.string()` type for foreign keys (Cosmos DB uses string IDs)
- Add validation messages:
  ```typescript
  categoryId: z.string().min(1, "Category is required")
  ```

### 3. Display String Fields

- Include either `name` or `title` field in your models for better foreign key display
- Example:
  ```typescript
  export const category = z.object({
    id: z.string(),
    name: z.string().min(1, "Name is required"), // Used for display
    // ...other fields
  });
  
  export type Category = z.infer<typeof category>;
  ```

### 4. Optional vs Required Fields

- Use `.optional()` for fields that can be empty
- Add `.default()` for fields with default values
- Provide helpful validation messages:
  ```typescript
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  ```

### 5. Enum Values

- Use meaningful enum values that can be displayed directly:
  ```typescript
  // Good
  priority: z.enum(["low", "medium", "high"])
  
  // Better with display-friendly values
  status: z.enum(["pending", "in_progress", "completed", "cancelled"])
  ```

## Troubleshooting

### Schema Parsing Errors

If you see "Failed to parse model file", ensure:
- Your file has a valid export of a Zod object schema
- You're using `z.object()` as the root schema

### Foreign Key Not Detected

Check that:
- Field name ends with `Id` (case-sensitive)
- Field type is `z.string()`
- Referenced model exists and has been scaffolded

### Missing Display Names

If foreign keys show IDs instead of names:
- Ensure referenced model has a `name` or `title` field
- Check that the referenced model has been scaffolded
- Verify API endpoint `/api/<model>` returns data

## Factory Pattern (Reducing CRUD Code Duplication)

SwallowKit uses a **factory pattern** to generate CRUD code. This eliminates per-entity code duplication (~94%) and significantly improves maintainability.

### How It Works

The `scaffold` command generates the following factory files:

- `lib/api/crud-factory.ts` - Generic CRUD handlers for Next.js BFF
- `functions/src/lib/crud-factory.ts` - Generic CRUD handlers for Azure Functions

Each entity's route file becomes a concise wrapper that simply calls the factory:

**Next.js BFF Route:**

```typescript
// app/api/todo/route.ts
import { createCrudHandlers } from '@/lib/api/crud-factory';
import { todo } from '@/lib/models/todo';

const handlers = createCrudHandlers({
  entityName: 'todo',
  schema: todo,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
```

**Azure Functions:**

```typescript
// functions/src/todo.ts
import { app } from '@azure/functions';
import { createCrudFunctions } from './lib/crud-factory';
import { todo } from './models/todo';

const crud = createCrudFunctions({
  schema: todo,
  containerName: 'Todos',
});

app.http('getTodos', { methods: ['GET'], route: 'todo', handler: crud.getAll });
app.http('getTodoById', { methods: ['GET'], route: 'todo/{id}', handler: crud.getById });
app.http('createTodo', { methods: ['POST'], route: 'todo', handler: crud.create });
app.http('updateTodo', { methods: ['PUT'], route: 'todo/{id}', handler: crud.update });
app.http('deleteTodo', { methods: ['DELETE'], route: 'todo/{id}', handler: crud.delete });
```

## Connector Models

In addition to Cosmos DB models, SwallowKit supports **connector models** that integrate with external data sources such as relational databases (MySQL, PostgreSQL, SQL Server) and REST APIs.

Connector models use the same `scaffold` command and produce the same BFF routes and UI components. The key differences are in the generated Azure Functions code and the model metadata.

### How it works

1. Register a connector in `swallowkit.config.js` using `add-connector`
2. Create a model with `create-model --connector <name>`
3. The model exports a `connectorConfig` object describing the data source mapping
4. `scaffold` detects connector metadata and generates appropriate Functions code

### What changes with connector models

| Aspect | Standard Model (Cosmos DB) | Connector Model |
|--------|---------------------------|-----------------|
| Functions code | Cosmos DB bindings | SQL queries (RDB) or HTTP client (API) |
| Functions location | `functions/src/functions/` (TS) | `functions/Connectors/` (C#) or same dir (TS/Python) |
| BFF routes | Standard `callFunction()` | Identical — transparent |
| UI components | Full CRUD | Same, respecting `operations` |
| Cosmos Bicep | Generated | Skipped |
| Operations | All CRUD | Configurable (e.g., read-only) |

### Read-only models

If a connector model's `operations` only includes `getAll` and/or `getById`, scaffold generates only GET endpoints. POST, PUT, and DELETE handlers are omitted.

### Local development

Use `swallowkit dev --mock-connectors` to start a mock proxy server that serves Zod-generated fake data for connector models. No real database or API connection is needed during development. See the [Connector Guide](./connector-guide.md) for details.

## Authentication Integration

When authentication is set up via `swallowkit add-auth`, you can add role-based access control to your scaffold-generated Functions by exporting an `authPolicy` from your model:

```typescript
// shared/models/estimate.ts
import { z } from 'zod';

export const estimate = z.object({
  id: z.string(),
  title: z.string().min(1),
  amount: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Estimate = z.infer<typeof estimate>;
export const displayName = 'Estimate';

// Role-based access control
export const authPolicy = { roles: ['admin', 'estimator'] };

// Or differentiate read vs write permissions
// export const authPolicy = { read: ['admin', 'estimator'], write: ['admin'] };
```

When `scaffold` detects `authPolicy`, it automatically injects authentication checks and role guards into the generated Functions handlers.

If `auth.authorization.defaultPolicy` is set to `'authenticated'` in `swallowkit.config.js`, all scaffolded Functions require authentication by default — even without an explicit `authPolicy` export.

> 💡 See the **[Authentication Guide](./auth-guide.md)** for full setup instructions and configuration details.

## Next Steps

- Learn about [Connector Guide](./connector-guide.md) - Integrate external data sources with the same Zod workflow
- Learn about [Authentication Guide](./auth-guide.md) - Add authentication and role-based access control
- Learn about [Zod Schema Sharing](./zod-schema-sharing-guide.md) - Understand the concepts behind type-safe schema sharing
- Read the [Deployment Guide](./deployment-guide.md) - Deploy your application to Azure
- Explore the [CLI Reference](./cli-reference.md) - Learn about all available commands
- Explore Azure Functions configuration in `functions/local.settings.json`
- Configure Cosmos DB connection for production deployment
- Customize generated UI components for your brand
- Return to the [README](https://github.com/himanago/swallowkit#readme) for more SwallowKit features

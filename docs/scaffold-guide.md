# SwallowKit Scaffold Guide

## Overview

SwallowKit Scaffold is a powerful code generation tool that automatically creates complete CRUD (Create, Read, Update, Delete) operations from your Zod schema definitions. It generates Azure Functions, Next.js API routes, and type-safe UI components with minimal configuration.

💡 **New to Zod?** Learn about the benefits of schema sharing in the **[Zod Schema Sharing Guide](./zod-schema-sharing-guide.md)**.

## Quick Start

### 1. Define Your Model with Zod

Create a model file in `lib/models/`:

```typescript
// lib/models/product.ts
import { z } from 'zod';

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Product name is required"),
  price: z.number().min(0, "Price must be positive"),
  category: z.enum(["electronics", "clothing", "books", "other"]),
  isActive: z.boolean().default(true),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.date().default(() => new Date()),
});

export type Product = z.infer<typeof ProductSchema>;
```

### 2. Run Scaffold Command

```bash
npx swallowkit scaffold lib/models/product.ts
```

### 3. Generated Files

The scaffold command generates the following files:

**Azure Functions (Backend):**
- `functions/src/models/product.ts` - Model definition
- `functions/src/product.ts` - CRUD Azure Functions

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
- `.swallowkit/scaffold.json` - Navigation menu configuration

### 4. Access Your Application

Start the development server:

```bash
npx swallowkit dev
```

Open http://localhost:3000 to see your application.

<!-- 画像: ホームページのスクリーンショット。scaffold.jsonに登録されたモデル（Product, Category, Todoなど）がカード形式で表示されている様子 -->

## Type-Appropriate UI Generation

SwallowKit automatically generates appropriate UI controls based on your Zod schema types:

### Supported Field Types

| Zod Type | Generated UI | Example |
|----------|-------------|---------|
| `z.string()` | Text input | `<input type="text">` |
| `z.number()` | Number input | `<input type="number">` |
| `z.boolean()` | Checkbox | `<input type="checkbox">` |
| `z.date()` | Date input | `<input type="date">` |
| `z.enum()` | Select dropdown | `<select>` with options |
| `z.array()` | Comma-separated text input | Tags: "tag1, tag2, tag3" |
| Foreign Key | Dropdown with related data | See below |

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
export const CategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Category name is required"),
  color: z.enum(["red", "blue", "green", "yellow", "purple"]).optional(),
});

// lib/models/todo.ts
export const TodoSchema = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required"),
  categoryId: z.string().min(1, "Category is required"), // Foreign key
  completed: z.boolean().default(false),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});
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
import { TodoSchema } from '@/lib/models/todo';
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
      const validatedData = TodoSchema.parse({
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

- Use PascalCase for model names: `Product`, `Category`, `Todo`
- Schema names should end with `Schema`: `ProductSchema`, `CategorySchema`
- Export both the schema and the type:
  ```typescript
  export const ProductSchema = z.object({...});
  export type Product = z.infer<typeof ProductSchema>;
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
  export const CategorySchema = z.object({
    id: z.string(),
    name: z.string().min(1, "Name is required"), // Used for display
    // ...other fields
  });
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
- Your file has a valid default export of a Zod object schema
- The schema name ends with `Schema`
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

## Next Steps

- Learn about [Zod Schema Sharing](./zod-schema-sharing-guide.md) - Understand the concepts behind type-safe schema sharing
- Explore Azure Functions configuration in `functions/local.settings.json`
- Configure Cosmos DB connection for production deployment
- Add authentication and authorization to your routes
- Customize generated UI components for your brand
- Return to the [README](../README.md) for more SwallowKit features

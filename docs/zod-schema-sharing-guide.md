# Zod Schema Sharing Guide

SwallowKit's core feature is **Zod Schema Sharing**, which enables type-safe, validated data flow across your entire stack—from frontend forms to backend APIs to database storage.

## Why Zod Schema Sharing?

### The Problem

In traditional full-stack development, you often define types and validation logic multiple times:

- **Frontend**: Form validation with one library
- **Backend API**: Request validation with another library
- **Database**: Schema definitions in ORM or separate files
- **TypeScript Types**: Manually maintained interfaces

This leads to:
- ❌ Code duplication
- ❌ Inconsistent validation
- ❌ Type drift between layers
- ❌ Maintenance overhead

### The SwallowKit Solution

Define your schema **once** with Zod, and use it everywhere:

```typescript
// lib/schemas/user.ts - Single Source of Truth
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  age: z.number().min(18, 'Must be 18 or older'),
});

export type User = z.infer<typeof UserSchema>;
```

This single schema provides:
- ✅ TypeScript types (`User`)
- ✅ Runtime validation
- ✅ Error messages
- ✅ Transform functions
- ✅ Default values

## Usage Across Layers

### Layer 1: Client-Side Validation

Use the same schema in your React components for immediate user feedback:

```typescript
// components/UserForm.tsx
'use client'

import { UserSchema } from '@/lib/schemas/user';
import { createUserAction } from '@/app/actions';
import { useState } from 'react';

export function UserForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const handleSubmit = async (formData: FormData) => {
    // Client-side validation
    const result = UserSchema.safeParse({
      id: crypto.randomUUID(),
      name: formData.get('name'),
      email: formData.get('email'),
      age: Number(formData.get('age')),
    });
    
    if (!result.success) {
      // Display Zod errors to user
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }
    
    setErrors({});
    await createUserAction(formData);
  };
  
  return (
    <form action={handleSubmit}>
      <input name="name" />
      {errors.name && <span>{errors.name}</span>}
      
      <input name="email" type="email" />
      {errors.email && <span>{errors.email}</span>}
      
      <input name="age" type="number" />
      {errors.age && <span>{errors.age}</span>}
      
      <button>Create User</button>
    </form>
  );
}
```

### Layer 2: Next.js Server Actions

Validate server-side requests before processing:

```typescript
// app/actions.ts
'use server'

import { UserSchema } from '@/lib/schemas/user';
import { createUser } from '@/lib/server/users';
import { revalidatePath } from 'next/cache';

export async function createUserAction(formData: FormData) {
  // Server-side validation (prevents malicious requests)
  const result = UserSchema.safeParse({
    id: crypto.randomUUID(),
    name: formData.get('name'),
    email: formData.get('email'),
    age: Number(formData.get('age')),
  });
  
  if (!result.success) {
    return { 
      error: true, 
      message: result.error.errors[0].message 
    };
  }
  
  // Data is validated, create user
  await createUser(result.data);
  revalidatePath('/users');
  
  return { success: true };
}
```

### Layer 3: Backend Repository

Validate data before saving to Cosmos DB:

```typescript
// lib/server/users.ts
import { createRepository } from 'swallowkit';
import { UserSchema } from '../schemas/user';

const userRepo = createRepository('users', UserSchema);

export async function createUser(data: z.infer<typeof UserSchema>) {
  // Repository automatically validates against UserSchema
  // before writing to Cosmos DB
  return userRepo.create(data);
}

export async function getUsers() {
  // Data from Cosmos DB is validated when read
  return userRepo.findAll();
}
```

### Layer 4: External Azure Functions

Share the same schema in your independent backend:

```typescript
// azure-functions/src/functions/createUser.ts
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { UserSchema } from '../shared/schemas/user';
import { getDatabaseClient } from '../database/client';

app.http('createUser', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const body = await request.json();
    
    // Validate request with shared schema
    const result = UserSchema.safeParse(body);
    
    if (!result.success) {
      return {
        status: 400,
        jsonBody: { error: result.error.errors[0].message }
      };
    }
    
    // Save validated data
    const client = getDatabaseClient();
    await client.createDocument('users', result.data);
    
    return {
      status: 201,
      jsonBody: result.data
    };
  }
});
```

## Advanced Patterns

### Partial Schemas

Validate only specific fields for updates:

```typescript
// Only validate name and email for profile updates
const UpdateProfileSchema = UserSchema.pick({ 
  name: true, 
  email: true 
});

export async function updateProfile(userId: string, data: FormData) {
  const result = UpdateProfileSchema.safeParse({
    name: data.get('name'),
    email: data.get('email'),
  });
  
  if (!result.success) {
    return { error: result.error.errors[0].message };
  }
  
  await userRepo.update({ id: userId, ...result.data });
}
```

### Nested Schemas

Compose complex data structures:

```typescript
const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
});

const UserWithAddressSchema = UserSchema.extend({
  address: AddressSchema,
});

export type UserWithAddress = z.infer<typeof UserWithAddressSchema>;
```

### Custom Validation

Add business logic validation:

```typescript
const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().positive(),
  discount: z.number().min(0).max(100),
}).refine(
  (data) => {
    // Custom validation: discounted price must be positive
    const finalPrice = data.price * (1 - data.discount / 100);
    return finalPrice > 0;
  },
  { message: 'Discounted price must be greater than 0' }
);
```

### Transformations

Transform data during validation:

```typescript
const UserInputSchema = z.object({
  name: z.string().trim().toLowerCase(), // Normalize name
  email: z.string().email().toLowerCase(), // Normalize email
  age: z.string().transform(Number), // Convert string to number
});
```

## Best Practices

### 1. Co-locate Schemas with Domain Logic

```
lib/
  ├─ schemas/
  │   ├─ user.ts
  │   ├─ product.ts
  │   └─ order.ts
  ├─ server/
  │   ├─ users.ts
  │   ├─ products.ts
  │   └─ orders.ts
```

### 2. Export Both Schema and Type

```typescript
// Always export both
export const UserSchema = z.object({ ... });
export type User = z.infer<typeof UserSchema>;
```

### 3. Use safeParse() for Error Handling

```typescript
// ✅ Good: Handle errors gracefully
const result = UserSchema.safeParse(data);
if (!result.success) {
  console.error(result.error.errors);
  return { error: 'Validation failed' };
}

// ❌ Bad: Throws exception
const user = UserSchema.parse(data); // Can throw!
```

### 4. Reuse Schemas with pick() and omit()

```typescript
// Create schema
const CreateUserSchema = UserSchema.omit({ id: true });

// Update schema (partial fields)
const UpdateUserSchema = UserSchema.partial();
```

### 5. Add Descriptions for API Documentation

```typescript
const UserSchema = z.object({
  id: z.string().describe('Unique user identifier'),
  name: z.string().describe('User full name'),
  email: z.string().email().describe('User email address'),
});
```

## Comparison with Other Approaches

### vs. Manual Type Definitions

```typescript
// ❌ Manual approach (error-prone)
interface User {
  id: string;
  name: string;
  email: string;
}

function validateUser(data: any): User {
  if (!data.id || !data.name || !data.email) {
    throw new Error('Invalid user');
  }
  if (!/\S+@\S+\.\S+/.test(data.email)) {
    throw new Error('Invalid email');
  }
  return data;
}

// ✅ Zod approach (type-safe, declarative)
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;
```

### vs. ORM Schemas

```typescript
// ❌ ORM-specific (locked to one library)
// Prisma example
model User {
  id    String @id
  name  String
  email String @unique
}

// ✅ Zod (library-agnostic, portable)
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Can be used with any database/ORM
```

## Migration Guide

### From Existing TypeScript Types

```typescript
// Before
interface User {
  id: string;
  name: string;
  email: string;
}

// After
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;
```

### From Joi/Yup Validation

```typescript
// Before (Joi)
const userSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  email: Joi.string().email().required(),
});

// After (Zod)
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});
```

## Summary

Zod Schema Sharing in SwallowKit provides:

✅ **Single Source of Truth** - Define once, use everywhere  
✅ **Type Safety** - Compile-time and runtime validation  
✅ **Consistency** - Same validation logic across all layers  
✅ **Developer Experience** - IntelliSense, auto-completion, error messages  
✅ **Maintainability** - Change schema once, updates everywhere  

This approach eliminates type drift, reduces bugs, and improves developer productivity across your entire stack.

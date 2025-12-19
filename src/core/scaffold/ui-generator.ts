/**
 * Next.js UI コンポ�Eネント生戁E
 * CRUD 画面�E�一覧、詳細、新規作�E、編雁E��を生�E
 */

import { ModelInfo, toCamelCase, toKebabCase, toPascalCase } from "./model-parser";

/**
 * 一覧画面を生戁E
 */
export function generateListPage(model: ModelInfo): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  
  // フィールドから表示するカラムを抽出（id以外の最初の3つ）
  const displayFields = model.fields
    .filter(f => f.name !== 'id')
    .slice(0, 3);
  
  // 外部キーフィールドを検出
  const foreignKeyFields = displayFields.filter(f => f.isForeignKey);
  const hasForeignKeys = foreignKeyFields.length > 0;
  
  // 外部キー用のstate定義を生成
  const foreignKeyStates = foreignKeyFields.map(f => {
    const refModel = f.referencedModel!;
    const refModelCamel = toCamelCase(refModel);
    return `  const [${refModelCamel}Map, set${refModel}Map] = useState<Record<string, string>>({});`;
  }).join('\n');
  
  // 外部キーデータのフェッチロジックを生成
  const foreignKeyFetches = foreignKeyFields.map(f => {
    const refModel = f.referencedModel!;
    const refModelCamel = toCamelCase(refModel);
    return `    fetch('/api/${refModelCamel}')
      .then(res => res.json())
      .then((data: any[]) => {
        const map: Record<string, string> = {};
        data.forEach(item => {
          // name または title フィールドを表示用文字列として使用
          map[item.id] = item.name || item.title || item.id;
        });
        set${refModel}Map(map);
      })
      .catch(err => console.error('Failed to fetch ${refModel}s:', err));`;
  }).join('\n');
  
  return `'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ${modelName} } from '@/lib/models/${modelKebab}';

export default function ${modelName}ListPage() {
  const [${modelCamel}s, set${modelName}s] = useState<${modelName}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
${hasForeignKeys ? foreignKeyStates : ''}

  useEffect(() => {
    fetch('/api/${modelCamel}')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch ${modelCamel}s');
        return res.json();
      })
      .then((data) => {
        set${modelName}s(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
${hasForeignKeys ? '\n    // Fetch foreign key reference data' : ''}
${hasForeignKeys ? foreignKeyFetches : ''}
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const res = await fetch(\`/api/${modelCamel}/\${id}\`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete ${modelCamel}');

      set${modelName}s(${modelCamel}s.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(\`Error: \${err.message}\`);
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">${modelName}</h1>
        <Link
          href="/${modelKebab}/new"
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          Create New
        </Link>
      </div>

      {${modelCamel}s.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No ${modelCamel}s found. Create your first one!
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
${displayFields.map(f => `                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  ${f.isForeignKey && f.referencedModel ? f.referencedModel : f.name}
                </th>`).join('\n')}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {${modelCamel}s.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
${displayFields.map(f => {
  if (f.isForeignKey && f.referencedModel) {
    const refModel = f.referencedModel;
    const refModelCamel = toCamelCase(refModel);
    return `                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {${refModelCamel}Map[item.${f.name}] || item.${f.name}}
                  </td>`;
  } else {
    return `                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {String(item.${f.name})}
                  </td>`;
  }
}).join('\n')}
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link
                      href={\`/${modelKebab}/\${item.id}\`}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4"
                    >
                      View
                    </Link>
                    <Link
                      href={\`/${modelKebab}/\${item.id}/edit\`}
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
`;
}

/**
 * 詳細画面を生戁E
 */
export function generateDetailPage(model: ModelInfo): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  
  // 外部キーフィールドを検出
  const foreignKeyFields = model.fields.filter(f => f.isForeignKey);
  const hasForeignKeys = foreignKeyFields.length > 0;
  
  // 外部キー用のstate定義を生成
  const foreignKeyStates = foreignKeyFields.map(f => {
    const refModel = f.referencedModel!;
    const refModelCamel = toCamelCase(refModel);
    return `  const [${refModelCamel}Map, set${refModel}Map] = useState<Record<string, string>>({});`;
  }).join('\n');
  
  // 外部キーデータのフェッチロジックを生成
  const foreignKeyFetches = foreignKeyFields.map(f => {
    const refModel = f.referencedModel!;
    const refModelCamel = toCamelCase(refModel);
    return `    fetch('/api/${refModelCamel}')
      .then(res => res.json())
      .then((data: any[]) => {
        const map: Record<string, string> = {};
        data.forEach(item => {
          map[item.id] = item.name || item.title || item.id;
        });
        set${refModel}Map(map);
      })
      .catch(err => console.error('Failed to fetch ${refModel}s:', err));`;
  }).join('\n');
  
  return `'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ${modelName} } from '@/lib/models/${modelKebab}';

export default function ${modelName}DetailPage() {
  const params = useParams();
  const router = useRouter();
  const [${modelCamel}, set${modelName}] = useState<${modelName} | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
${hasForeignKeys ? foreignKeyStates : ''}

  useEffect(() => {
    const id = params?.id as string;
    if (!id) return;

    fetch(\`/api/${modelCamel}/\${id}\`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch ${modelCamel}');
        return res.json();
      })
      .then((data) => {
        set${modelName}(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
${hasForeignKeys ? '\n    // Fetch foreign key reference data' : ''}
${hasForeignKeys ? foreignKeyFetches : ''}
  }, [params]);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const res = await fetch(\`/api/${modelCamel}/\${params?.id}\`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete ${modelCamel}');

      router.push('/${modelKebab}');
    } catch (err: any) {
      alert(\`Error: \${err.message}\`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-gray-900 dark:text-gray-100">Loading...</div>
      </div>
    );
  }

  if (error || !${modelCamel}) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600 dark:text-red-400">Error: {error || '${modelName} not found'}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">${modelName} Details</h1>
          <div className="space-x-2">
            <Link
              href={\`/${modelKebab}/\${${modelCamel}.id}/edit\`}
              className="bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white px-4 py-2 rounded"
            >
              Edit
            </Link>
            <button
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-4 py-2 rounded"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
          <dl className="space-y-4">
${model.fields.map(f => {
  if (f.isForeignKey && f.referencedModel) {
    const refModel = f.referencedModel;
    const refModelCamel = toCamelCase(refModel);
    return `            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">${refModel}</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{${refModelCamel}Map[${modelCamel}.${f.name}] || ${modelCamel}.${f.name}}</dd>
            </div>`;
  } else {
    return `            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">${f.name}</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{String(${modelCamel}.${f.name})}</dd>
            </div>`;
  }
}).join('\n')}
          </dl>
        </div>

        <div className="mt-6">
          <Link
            href="/${modelKebab}"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
          >
            &larr; Back to list
          </Link>
        </div>
      </div>
    </div>
  );
}
`;
}

/**
 * フォームコンポ�Eネントを生�E
 */
export function generateFormComponent(model: ModelInfo): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const schemaName = model.schemaName;
  
  // id, createdAt, updatedAt 以外�Eフィールド（タイムスタンプ�E自動管琁E��E
  const formFields = model.fields.filter(f => 
    f.name !== 'id' && 
    f.name !== 'createdAt' && 
    f.name !== 'updatedAt'
  );
  // 外部キーフィールドを抽出
  const foreignKeyFields = formFields.filter(f => f.isForeignKey);
  const hasForignKeys = foreignKeyFields.length > 0;
  
  return `'use client';

import { useState, FormEvent${hasForignKeys ? ', useEffect' : ''} } from 'react';
import { useRouter } from 'next/navigation';
import { ${schemaName}, ${modelName} } from '@/lib/models/${toKebabCase(modelName)}';

// Input schema: SwallowKit-managed fields (id, createdAt, updatedAt) are optional
// These fields are ignored by the backend and auto-managed
const ${modelName}InputSchema = ${schemaName}.partial({ id: true, createdAt: true, updatedAt: true });

interface ${modelName}FormProps {
  initialData?: ${modelName};
  isEdit?: boolean;
}

export default function ${modelName}Form({ initialData, isEdit = false }: ${modelName}FormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
${hasForignKeys ? foreignKeyFields.map(f => `  const [${toCamelCase(f.referencedModel!)}Options, set${f.referencedModel}Options] = useState<Array<{ id: string; name: string }>>([]);`).join('\n') : ''}
  
  const [formData, setFormData] = useState({
${formFields.map(f => {
  let defaultValue = "''";
  if (f.isArray) {
    // Array の場合は空文字列（カンマ区切りで入力するため）
    defaultValue = "''";
  } else if (f.type === 'number') {
    // Number の場合も空文字列を許容（オプショナル対応）
    defaultValue = "''";
  } else if (f.type === 'boolean') {
    defaultValue = 'false';
  } else {
    defaultValue = "''";
  }
  
  // initialData からの取得も型に応じて変換
  if (f.isArray) {
    return `    ${f.name}: initialData?.${f.name} ? (Array.isArray(initialData.${f.name}) ? initialData.${f.name}.join(', ') : '') : ${defaultValue},`;
  } else if (f.type === 'number') {
    return `    ${f.name}: initialData?.${f.name} !== undefined ? String(initialData.${f.name}) : ${defaultValue},`;
  }
  return `    ${f.name}: initialData?.${f.name} ?? ${defaultValue},`;
}).join('\n')}
  });
${hasForignKeys ? `
  // 外部キーの選択肢を取得
  useEffect(() => {
${foreignKeyFields.map(f => `    // ${f.referencedModel} の一覧を取得
    fetch('/api/${toKebabCase(f.referencedModel!)}')
      .then(res => res.json())
      .then(data => set${f.referencedModel}Options(data.map((item: any) => ({ id: item.id, name: item.name || item.title || item.id }))))
      .catch(err => console.error('Failed to load ${f.referencedModel} options:', err));`).join('\n')}
  }, []);
` : ''}
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // Array フィールドをカンマ区切りから配列に変換
      const submitData = { ...formData };
${formFields.filter(f => f.isArray).map(f => `      if (typeof submitData.${f.name} === 'string') {
        submitData.${f.name} = submitData.${f.name}.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      }`).join('\n')}
${formFields.filter(f => f.type === 'number').length > 0 ? `
      // Number フィールドを変換（空文字列 → undefined、文字列 → 数値）
${formFields.filter(f => f.type === 'number').map(f => `      if (submitData.${f.name} === '' || submitData.${f.name} === null) {
        submitData.${f.name} = undefined;
      } else if (typeof submitData.${f.name} === 'string') {
        submitData.${f.name} = Number(submitData.${f.name});
      }`).join('\n')}` : ''}
      
      // Validate input (excluding SwallowKit-managed fields)
      ${modelName}InputSchema.parse(submitData);

      const url = isEdit ? \`/api/${modelCamel}/\${initialData!.id}\` : '/api/${modelCamel}';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to save ${modelCamel}');
      }

      router.push('/${toKebabCase(modelName)}');
    } catch (err: any) {
      if (err.errors) {
        // Zod validation errors
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach((error: any) => {
          const field = error.path[0];
          fieldErrors[field] = error.message;
        });
        setErrors(fieldErrors);
      } else {
        alert(\`Error: \${err.message}\`);
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
${formFields.map(f => {
  // 外部キーの場合は参照先モデルのドロップダウン
  if (f.isForeignKey && f.referencedModel) {
    const optionsVar = `${toCamelCase(f.referencedModel)}Options`;
    return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${f.referencedModel}${!f.isOptional ? ' *' : ''}
        </label>
        <select
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          ${!f.isOptional ? 'required' : ''}
        >
          <option value="">選択してください</option>
          {${optionsVar}.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
  }
  
  // Enum の場合は select 要素
  if (f.enumValues && f.enumValues.length > 0) {
    return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${f.name}${!f.isOptional ? ' *' : ''}
        </label>
        <select
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          ${!f.isOptional ? 'required' : ''}
        >
          <option value="">選択してください</option>
${f.enumValues.map(v => `          <option value="${v}">${v}</option>`).join('\n')}
        </select>
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
  }
  
  // Boolean の場合は checkbox
  if (f.type === 'boolean') {
    return `      <div className="flex items-center">
        <input
          type="checkbox"
          id="${f.name}"
          name="${f.name}"
          checked={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.checked })}
          className="h-4 w-4 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 border-gray-300 dark:border-gray-600 rounded"
        />
        <label htmlFor="${f.name}" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
          ${f.name}
        </label>
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
  }
  
  // Array の場合はカンマ区切りテキスト
  if (f.isArray) {
    return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${f.name}${!f.isOptional ? ' *' : ''} <span className="text-xs text-gray-500">(カンマ区切りで入力)</span>
        </label>
        <input
          type="text"
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.value })}
          placeholder="例: item1, item2, item3"
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          ${!f.isOptional ? 'required' : ''}
        />
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
  }
  
  // Number の場合
  if (f.type === 'number') {
    return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${f.name}${!f.isOptional ? ' *' : ''}
        </label>
        <input
          type="number"
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          ${!f.isOptional ? 'required' : ''}
        />
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
  }
  
  // Date の場合
  if (f.type === 'date') {
    return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${f.name}${!f.isOptional ? ' *' : ''}
        </label>
        <input
          type="date"
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          ${!f.isOptional ? 'required' : ''}
        />
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
  }
  
  // デフォルト: text input
  return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${f.name}${!f.isOptional ? ' *' : ''}
        </label>
        <input
          type="text"
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}}
          onChange={(e) => setFormData({ ...formData, ${f.name}: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          ${!f.isOptional ? 'required' : ''}
        />
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
}).join('\n\n')}

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/${toKebabCase(modelName)}')}
          className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
`;
}

/**
 * 新規作�E画面を生戁E
 */
export function generateNewPage(model: ModelInfo): string {
  const modelName = model.name;
  const modelKebab = toKebabCase(modelName);
  
  return `import ${modelName}Form from '../_components/${modelName}Form';

export default function New${modelName}Page() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Create New ${modelName}</h1>
        <div className="bg-white shadow-md rounded-lg p-6">
          <${modelName}Form />
        </div>
      </div>
    </div>
  );
}
`;
}

/**
 * 編雁E��面を生戁E
 */
export function generateEditPage(model: ModelInfo): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  
  return `'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ${modelName}Form from '../../_components/${modelName}Form';
import { ${modelName} } from '@/lib/models/${modelKebab}';

export default function Edit${modelName}Page() {
  const params = useParams();
  const [${modelCamel}, set${modelName}] = useState<${modelName} | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = params?.id as string;
    if (!id) return;

    fetch(\`/api/${modelCamel}/\${id}\`)
      .then((res) => res.json())
      .then((data) => {
        set${modelName}(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!${modelCamel}) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">${modelName} not found</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Edit ${modelName}</h1>
        <div className="bg-white shadow-md rounded-lg p-6">
          <${modelName}Form initialData={${modelCamel}} isEdit={true} />
        </div>
      </div>
    </div>
  );
}
`;
}

/**
 * Next.js UI コンポーネント生成
 * CRUD 画面（一覧、詳細、新規作成、編集）を生成する
 */

import { ModelInfo, FieldInfo, toCamelCase, toKebabCase, toPascalCase } from "./model-parser";

/**
 * 一覧画面を生成
 */
export function generateListPage(model: ModelInfo, sharedPackageName: string): string {
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
  
  // ネストスキーマフィールドを検出
  const nestedFields = displayFields.filter(f => f.isNestedSchema);
  const hasNestedSchemas = nestedFields.length > 0;
  
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
  
  const schemaName = model.schemaName;
  // schemaNameとmodelNameが同じ場合はimportエイリアスで名前衝突を回避
  const needsAlias = schemaName === modelName;
  const localSchemaName = needsAlias ? `${toCamelCase(modelName)}Schema` : schemaName;
  const schemaImportLine = needsAlias
    ? `import { ${schemaName} as ${localSchemaName} } from '${sharedPackageName}';`
    : `import { ${schemaName} } from '${sharedPackageName}';`;
  
  return `'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod/v4';
${schemaImportLine}

type ${modelName} = z.infer<typeof ${localSchemaName}>;

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
      <div className="mb-4">
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 text-sm"
        >
          ← Home
        </Link>
      </div>
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
${displayFields.map(f => {
  const headerLabel = f.isNestedSchema && f.nestedModelName
    ? f.nestedModelName
    : (f.isForeignKey && f.referencedModel ? f.referencedModel : f.name);
  return `                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  ${headerLabel}
                </th>`;
}).join('\n')}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {${modelCamel}s.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
${displayFields.map(f => {
  if (f.isNestedSchema && f.nestedModelName) {
    const displayField = f.nestedDisplayField || 'name';
    if (f.isArray) {
      return `                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {Array.isArray(item.${f.name}) ? item.${f.name}.map((ref: any) => ref?.${displayField} || '-').join(', ') : '-'}
                  </td>`;
    } else {
      return `                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {item.${f.name}?.${displayField} || '-'}
                  </td>`;
    }
  } else if (f.isForeignKey && f.referencedModel) {
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
 * 詳細画面を生成
 */
export function generateDetailPage(model: ModelInfo, sharedPackageName: string): string {
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
  
  const schemaName = model.schemaName;
  // Zod公式パターン対応: schemaNameとmodelNameが同じ場合はimportエイリアスで名前衝突を回避
  const needsAlias = schemaName === modelName;
  const localSchemaName = needsAlias ? `${toCamelCase(modelName)}Schema` : schemaName;
  const schemaImportLine = needsAlias
    ? `import { ${schemaName} as ${localSchemaName} } from '${sharedPackageName}';`
    : `import { ${schemaName} } from '${sharedPackageName}';`;
  
  return `'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod/v4';
${schemaImportLine}

type ${modelName} = z.infer<typeof ${localSchemaName}>;

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
              className="inline-flex items-center bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white px-4 py-2 rounded"
            >
              Edit
            </Link>
            <button
              onClick={handleDelete}
              className="inline-flex items-center bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-4 py-2 rounded"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
          <dl className="space-y-4">
${model.fields.map(f => {
  if (f.isNestedSchema && f.nestedModelName) {
    const displayField = f.nestedDisplayField || 'name';
    const label = f.nestedModelName;
    if (f.isArray) {
      return `            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">${label}</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{Array.isArray(${modelCamel}.${f.name}) ? ${modelCamel}.${f.name}.map((ref: any) => ref?.${displayField} || '-').join(', ') : '-'}</dd>
            </div>`;
    } else {
      return `            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">${label}</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{${modelCamel}.${f.name}?.${displayField} || '-'}</dd>
            </div>`;
    }
  } else if (f.isForeignKey && f.referencedModel) {
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
 * フォームコンポーネントを生成
 */
export function generateFormComponent(model: ModelInfo, sharedPackageName: string): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const schemaName = model.schemaName;
  // Zod公式パターン対応: schemaNameとmodelNameが同じ場合はimportエイリアスで名前衝突を回避
  const needsAlias = schemaName === modelName;
  const localSchemaName = needsAlias ? `${toCamelCase(modelName)}Schema` : schemaName;
  const schemaImportLine = needsAlias
    ? `import { ${schemaName} as ${localSchemaName} } from '${sharedPackageName}';`
    : `import { ${schemaName} } from '${sharedPackageName}';`;
  
  // id, createdAt, updatedAt 以外のフィールド
  const formFields = model.fields.filter(f => 
    f.name !== 'id' && 
    f.name !== 'createdAt' && 
    f.name !== 'updatedAt'
  );
  // 外部キーフィールドを抽出
  const foreignKeyFields = formFields.filter(f => f.isForeignKey);
  const hasForignKeys = foreignKeyFields.length > 0;
  
  // ネストスキーマフィールドを抽出
  const nestedSchemaFields = formFields.filter(f => f.isNestedSchema);
  const hasNestedSchemas = nestedSchemaFields.length > 0;
  
  // useEffect が必要かどうか
  const needsUseEffect = hasForignKeys || hasNestedSchemas;
  
  // ネストスキーマ用のstate定義を生成
  const nestedSchemaStates = nestedSchemaFields.map(f => {
    const refModelCamel = toCamelCase(f.nestedModelName!);
    const refModelPascal = f.nestedModelName!;
    return `  const [${refModelCamel}Options, set${refModelPascal}Options] = useState<Array<{ id: string; name: string }>>([]);`;
  }).join('\n');
  
  // ネストスキーマデータのフェッチロジック
  const nestedSchemaFetches = nestedSchemaFields.map(f => {
    const refModelCamel = toCamelCase(f.nestedModelName!);
    const refModelPascal = f.nestedModelName!;
    const displayField = f.nestedDisplayField || 'name';
    return `    // ${refModelPascal} の一覧を取得
    fetch('/api/${refModelCamel}')
      .then(res => res.json())
      .then(data => set${refModelPascal}Options(data.map((item: any) => ({ id: item.id, name: item.${displayField} || item.name || item.title || item.id }))))
      .catch(err => console.error('Failed to load ${refModelPascal} options:', err));`;
  }).join('\n');
  
  return `'use client';

import { useState, FormEvent${needsUseEffect ? ', useEffect' : ''} } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod/v4';
${schemaImportLine}

// Input schema: SwallowKit-managed fields (id, createdAt, updatedAt) are optional
// These fields are ignored by the backend and auto-managed
const ${modelName}InputSchema = ${localSchemaName}.partial({ id: true, createdAt: true, updatedAt: true });

type ${modelName} = z.infer<typeof ${localSchemaName}>;

interface ${modelName}FormProps {
  initialData?: ${modelName};
  isEdit?: boolean;
}

export default function ${modelName}Form({ initialData, isEdit = false }: ${modelName}FormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
${hasForignKeys ? foreignKeyFields.map(f => `  const [${toCamelCase(f.referencedModel!)}Options, set${f.referencedModel}Options] = useState<Array<{ id: string; name: string }>>([]);`).join('\n') : ''}
${hasNestedSchemas ? nestedSchemaStates : ''}
  
  const [formData, setFormData] = useState({
${formFields.map(f => {
  // ネストスキーマの場合は参照ID（単一: string, 配列: string[]）を管理
  if (f.isNestedSchema) {
    if (f.isArray) {
      return `    ${f.name}Ids: initialData?.${f.name} ? (Array.isArray(initialData.${f.name}) ? initialData.${f.name}.map((item: any) => item.id) : []) : [] as string[],`;
    } else {
      return `    ${f.name}Id: initialData?.${f.name}?.id ?? '',`;
    }
  }
  
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
${needsUseEffect ? `
  // 参照データの選択肢を取得
  useEffect(() => {
${hasForignKeys ? foreignKeyFields.map(f => `    // ${f.referencedModel} の一覧を取得
    fetch('/api/${toKebabCase(f.referencedModel!)}')
      .then(res => res.json())
      .then(data => set${f.referencedModel}Options(data.map((item: any) => ({ id: item.id, name: item.name || item.title || item.id }))))
      .catch(err => console.error('Failed to load ${f.referencedModel} options:', err));`).join('\n') : ''}
${hasNestedSchemas ? nestedSchemaFetches : ''}
  }, []);
` : ''}
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // Array フィールドをカンマ区切りから配列に変換
      const submitData: any = { ...formData };
${formFields.filter(f => f.isArray && !f.isNestedSchema).map(f => `      if (typeof submitData.${f.name} === 'string') {
        submitData.${f.name} = submitData.${f.name}.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      }`).join('\n')}
${formFields.filter(f => f.enumValues && f.enumValues.length > 0).length > 0 ? `
      // Enum フィールドの空文字列を undefined に変換（.default() を有効にする）
${formFields.filter(f => f.enumValues && f.enumValues.length > 0).map(f => `      if (submitData.${f.name} === '') {
        submitData.${f.name} = undefined;
      }`).join('\n')}` : ''}
${formFields.filter(f => f.type === 'number').length > 0 ? `
      // Number フィールドを変換（空文字列 → undefined、文字列 → 数値）
${formFields.filter(f => f.type === 'number').map(f => `      if (submitData.${f.name} === '' || submitData.${f.name} === null) {
        submitData.${f.name} = undefined;
      } else if (typeof submitData.${f.name} === 'string') {
        submitData.${f.name} = Number(submitData.${f.name});
      }`).join('\n')}` : ''}
${hasNestedSchemas ? `
      // ネストスキーマ参照をIDからオブジェクトに変換
${nestedSchemaFields.map(f => {
  const refModelCamel = toCamelCase(f.nestedModelName!);
  const refModelPascal = f.nestedModelName!;
  if (f.isArray) {
    return `      // ${refModelPascal} 配列参照の変換
      if (submitData.${f.name}Ids) {
        submitData.${f.name} = submitData.${f.name}Ids
          .map((refId: string) => ${refModelCamel}Options.find(opt => opt.id === refId))
          .filter(Boolean);
        delete submitData.${f.name}Ids;
      }`;
  } else {
    return `      // ${refModelPascal} 単一参照の変換
      if (submitData.${f.name}Id) {
        const selected = ${refModelCamel}Options.find(opt => opt.id === submitData.${f.name}Id);
        submitData.${f.name} = selected || undefined;
        delete submitData.${f.name}Id;
      } else {
        submitData.${f.name} = undefined;
        delete submitData.${f.name}Id;
      }`;
  }
}).join('\n')}
` : ''}
      
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
      if (err.issues) {
        // Zod validation errors
        const fieldErrors: Record<string, string> = {};
        err.issues.forEach((error: any) => {
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
  // ネストスキーマの場合はセレクトボックス（単一）またはマルチセレクト（配列）
  if (f.isNestedSchema && f.nestedModelName) {
    const optionsVar = `${toCamelCase(f.nestedModelName)}Options`;
    const label = f.nestedModelName;
    
    if (f.isArray) {
      // 配列参照: マルチセレクト
      return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${label}${!f.isOptional ? ' *' : ''} <span className="text-xs text-gray-500">(複数選択可)</span>
        </label>
        <select
          id="${f.name}"
          name="${f.name}"
          multiple
          value={formData.${f.name}Ids}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, option => option.value);
            setFormData({ ...formData, ${f.name}Ids: selected });
          }}
className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400 min-h-[120px]"
          ${!f.isOptional ? 'required' : ''}
        >
          {${optionsVar}.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {errors.${f.name} && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.${f.name}}</p>
        )}
      </div>`;
    } else {
      // 単一オブジェクト参照: セレクトボックス
      return `      <div>
        <label htmlFor="${f.name}" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ${label}${!f.isOptional ? ' *' : ''}
        </label>
        <select
          id="${f.name}"
          name="${f.name}"
          value={formData.${f.name}Id}
          onChange={(e) => setFormData({ ...formData, ${f.name}Id: e.target.value })}
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
  }
  
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
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
          className="h-4 w-4 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 border border-gray-300 dark:border-gray-600 rounded"
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
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm px-3 py-2 focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
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
 * 新規作成画面を生成
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
        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
          <${modelName}Form />
        </div>
      </div>
    </div>
  );
}
`;
}

/**
 * 編集画面を生成
 */
export function generateEditPage(model: ModelInfo, sharedPackageName: string): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  
  const schemaName = model.schemaName;
  // Zod公式パターン対応: schemaNameとmodelNameが同じ場合はimportエイリアスで名前衝突を回避
  const needsAlias = schemaName === modelName;
  const localSchemaName = needsAlias ? `${toCamelCase(modelName)}Schema` : schemaName;
  const schemaImportLine = needsAlias
    ? `import { ${schemaName} as ${localSchemaName} } from '${sharedPackageName}';`
    : `import { ${schemaName} } from '${sharedPackageName}';`;
  
  return `'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ${modelName}Form from '../../_components/${modelName}Form';
import { z } from 'zod/v4';
${schemaImportLine}

type ${modelName} = z.infer<typeof ${localSchemaName}>;

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
        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
          <${modelName}Form initialData={${modelCamel}} isEdit={true} />
        </div>
      </div>
    </div>
  );
}
`;
}

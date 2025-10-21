import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface SchemaDefinition {
  name: string;
  schema: z.ZodSchema;
  operations: CRUDOperation[];
  tableName?: string;
  partitionKey?: string;
}

export interface CRUDOperation {
  type: 'create' | 'read' | 'update' | 'delete' | 'list';
  name: string;
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
  customLogic?: string;
}

export interface ParsedServerFunction {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  returnType: string;
  sourceCode: string;
  isAsync: boolean;
}

export class SchemaParser {
  /**
   * TypeScriptファイルからZodスキーマ定義を解析
   */
  static parseSchemaFile(filePath: string): SchemaDefinition[] {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );

    const schemas: SchemaDefinition[] = [];

    const visit = (node: ts.Node) => {
      // const XxxSchema = z.object({...}) パターンを探す
      if (ts.isVariableStatement(node)) {
        const declaration = node.declarationList.declarations[0];
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.name &&
          ts.isIdentifier(declaration.name) &&
          declaration.name.text.endsWith('Schema')
        ) {
          const schemaName = declaration.name.text.replace('Schema', '');
          
          // 基本的なCRUD操作を自動生成
          const operations: CRUDOperation[] = [
            {
              type: 'create',
              name: `create${schemaName}`,
              inputSchema: undefined, // 実際の実装では詳細に解析
              outputSchema: undefined,
            },
            {
              type: 'read',
              name: `get${schemaName}`,
              inputSchema: undefined,
              outputSchema: undefined,
            },
            {
              type: 'list',
              name: `list${schemaName}s`,
              inputSchema: undefined,
              outputSchema: undefined,
            },
            {
              type: 'update',
              name: `update${schemaName}`,
              inputSchema: undefined,
              outputSchema: undefined,
            },
            {
              type: 'delete',
              name: `delete${schemaName}`,
              inputSchema: undefined,
              outputSchema: undefined,
            },
          ];

          schemas.push({
            name: schemaName,
            schema: z.object({}), // 実際の実装では詳細に解析
            operations,
            tableName: schemaName.toLowerCase(),
            partitionKey: 'id',
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return schemas;
  }

  /**
   * サーバー関数の解析
   */
  static parseServerFunctions(filePath: string): ParsedServerFunction[] {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );

    const functions: ParsedServerFunction[] = [];

    const visit = (node: ts.Node) => {
      // async function名前(...) または function名前(...) パターンを探す
      if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        const isAsync = node.modifiers?.some(
          mod => mod.kind === ts.SyntaxKind.AsyncKeyword
        ) || false;

        const parameters = node.parameters.map(param => ({
          name: ts.isIdentifier(param.name) ? param.name.text : 'unknown',
          type: param.type ? param.type.getText(sourceFile) : 'any',
          optional: !!param.questionToken,
        }));

        const returnType = node.type ? node.type.getText(sourceFile) : 'any';
        const sourceCode = node.getText(sourceFile);

        functions.push({
          name: functionName,
          parameters,
          returnType,
          sourceCode,
          isAsync,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  /**
   * プロジェクト内のスキーマファイルを自動検出
   */
  static findSchemaFiles(projectRoot: string): string[] {
    const schemaFiles: string[] = [];
    
    const searchDirs = [
      path.join(projectRoot, 'src/schemas'),
      path.join(projectRoot, 'schemas'),
      path.join(projectRoot, 'src/types'),
      path.join(projectRoot, 'types'),
    ];

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.ts') || file.endsWith('.js')) {
            const fullPath = path.join(dir, file);
            const content = fs.readFileSync(fullPath, 'utf-8');
            
            // Zodスキーマが含まれているかチェック
            if (content.includes('z.object') || content.includes('z.string')) {
              schemaFiles.push(fullPath);
            }
          }
        }
      }
    }

    return schemaFiles;
  }

  /**
   * サーバー関数ファイルを自動検出
   */
  static findServerFunctionFiles(projectRoot: string): string[] {
    const serverFiles: string[] = [];
    
    const searchDirs = [
      path.join(projectRoot, 'src/server'),
      path.join(projectRoot, 'server'),
      path.join(projectRoot, 'src/api'),
      path.join(projectRoot, 'api'),
      path.join(projectRoot, 'src'),
    ];

    for (const dir of searchDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.ts') || file.endsWith('.js')) {
            const fullPath = path.join(dir, file);
            const content = fs.readFileSync(fullPath, 'utf-8');
            
            // async function や export function が含まれているかチェック
            if (
              content.includes('async function') || 
              content.includes('export function') ||
              content.includes('export async function')
            ) {
              serverFiles.push(fullPath);
            }
          }
        }
      }
    }

    return serverFiles;
  }
}

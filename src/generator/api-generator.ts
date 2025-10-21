import * as fs from 'fs';
import * as path from 'path';
import { SchemaParser, SchemaDefinition, ParsedServerFunction } from './schema-parser';
import { 
  AZURE_FUNCTION_V4_TEMPLATE, 
  CRUD_FUNCTION_V4_TEMPLATE, 
  RPC_FUNCTION_V4_TEMPLATE,
  HOST_JSON_V4_TEMPLATE,
  LOCAL_SETTINGS_V4_TEMPLATE,
  TSCONFIG_V4_TEMPLATE,
  FUNCIGNORE_V4_TEMPLATE,
  PACKAGE_JSON_V4_TEMPLATE
} from './templates/azure-functions';
import { DEFAULT_SERVER_FUNCTIONS_TEMPLATE } from './templates/default-server-functions';

export interface GenerationOptions {
  projectRoot: string;
  outputDir: string;
  cosmosDbEndpoint?: string;
  cosmosDbKey?: string;
  cosmosDbDatabase?: string;
}

export class ApiGenerator {
  private options: GenerationOptions;

  constructor(options: GenerationOptions) {
    this.options = options;
  }

  /**
   * APIを自動生成するメイン関数（v4対応）
   */
  async generate(): Promise<void> {
    console.log('🚀 SwallowKit API自動生成を開始します（Azure Functions v4）...');

    // 出力ディレクトリを作成
    this.ensureDirectoryExists(this.options.outputDir);

    // スキーマファイルを検出・解析
    const schemaFiles = SchemaParser.findSchemaFiles(this.options.projectRoot);
    console.log(`📋 検出されたスキーマファイル: ${schemaFiles.length}個`);

    const schemas: SchemaDefinition[] = [];
    for (const file of schemaFiles) {
      const fileSchemas = SchemaParser.parseSchemaFile(file);
      schemas.push(...fileSchemas);
    }

    // サーバー関数ファイルを検出・解析
    const serverFunctionFiles = SchemaParser.findServerFunctionFiles(this.options.projectRoot);
    console.log(`⚡ 検出されたサーバー関数ファイル: ${serverFunctionFiles.length}個`);

    const serverFunctions: ParsedServerFunction[] = [];
    for (const file of serverFunctionFiles) {
      const fileFunctions = SchemaParser.parseServerFunctions(file);
      serverFunctions.push(...fileFunctions);
    }

    // v4形式でfunctionsディレクトリを作成
    const srcDir = path.join(this.options.outputDir, 'src');
    const functionsDir = path.join(srcDir, 'functions');
    this.ensureDirectoryExists(functionsDir);

    // 統合されたAPI関数を生成
    if (schemas.length > 0 || serverFunctions.length > 0) {
      await this.generateV4Functions(schemas, serverFunctions, functionsDir);
      console.log(`✅ Functions生成完了: ${schemas.length}個のスキーマ、${serverFunctions.length}個の関数`);
    }

    // Azure Functions v4設定ファイルを生成
    await this.generateV4ConfigFiles();
    console.log('✅ 設定ファイル生成完了');

    // package.json を生成
    await this.generateV4PackageJson();
    console.log('✅ package.json生成完了');

    // 共有モジュールを生成
    await this.generateSharedModules(schemas, serverFunctions, serverFunctionFiles);
    console.log('✅ 共有モジュール生成完了');

    console.log('🎉 API自動生成が完了しました!');
    console.log(`📁 出力先: ${this.options.outputDir}`);
    console.log(`📁 ファイル構造:`);
    console.log(`  ${path.relative(process.cwd(), this.options.outputDir)}/`);
    console.log(`  ├── src/functions/`);
    console.log(`  │   ├── crud.ts`);
    console.log(`  │   └── rpc.ts`);
    console.log(`  ├── host.json`);
    console.log(`  ├── local.settings.json`);
    console.log(`  ├── tsconfig.json`);
    console.log(`  ├── .funcignore`);
    console.log(`  └── package.json`);
  }

  /**
   * v4形式でFunctions を生成
   */
  private async generateV4Functions(schemas: SchemaDefinition[], serverFunctions: ParsedServerFunction[], functionsDir: string): Promise<void> {
    // CRUD関数を生成
    if (schemas.length > 0) {
      await this.generateV4CrudFunction(schemas, functionsDir);
    }

    // RPC関数を生成
    if (serverFunctions.length > 0) {
      await this.generateV4RpcFunction(serverFunctions, functionsDir);
    }
  }

  /**
   * v4 CRUD関数を生成
   */
  private async generateV4CrudFunction(schemas: SchemaDefinition[], functionsDir: string): Promise<void> {
    // スキーマインポートを生成
    const schemaImports = schemas
      .map(schema => `import { ${schema.name}Schema } from "../shared/schemas";\ntype ${schema.name} = z.infer<typeof ${schema.name}Schema>;`)
      .join('\n');

    // CRUD関数実装を生成
    const functionImplementations = schemas
      .map(schema => schema.operations
        .map(op => this.generateV4CrudOperation(schema, op))
        .join('\n\n'))
      .join('\n\n');

    // オペレーションケースを生成
    const operationCases = schemas
      .map(schema => schema.operations
        .map(op => `        case '${schema.name.toLowerCase()}_${op.name}':
          result = await ${op.name}(${this.generateOperationParams(op)});
          break;`)
        .join('\n'))
      .join('\n');

    // メインファイルを生成
    const crudContent = AZURE_FUNCTION_V4_TEMPLATE
      .replace('{{SCHEMA_IMPORTS}}', schemaImports)
      .replace('{{FUNCTION_IMPLEMENTATIONS}}', functionImplementations)
      .replace('{{OPERATION_CASES}}', operationCases);

    fs.writeFileSync(path.join(functionsDir, 'crud.ts'), crudContent);
  }

  /**
   * v4 RPC関数を生成
   */
  private async generateV4RpcFunction(serverFunctions: ParsedServerFunction[], functionsDir: string): Promise<void> {
    // サーバー関数インポートを生成
    const serverFunctionImports = serverFunctions
      .map(fn => `import { ${fn.name} } from "../shared/server-functions";`)
      .join('\n');

    // 関数マッピングを生成
    const functionMappings = serverFunctions
      .map(fn => `  "${fn.name}": ${fn.name},`)
      .join('\n');

    // メインファイルを生成
    const rpcContent = RPC_FUNCTION_V4_TEMPLATE
      .replace('{{SERVER_FUNCTION_IMPORTS}}', serverFunctionImports)
      .replace('{{FUNCTION_MAPPINGS}}', functionMappings);

    fs.writeFileSync(path.join(functionsDir, 'rpc.ts'), rpcContent);
  }

  /**
   * CRUD操作コードを生成（v4対応）
   */
  private generateV4CrudOperation(schema: SchemaDefinition, operation: any): string {
    const template = CRUD_FUNCTION_V4_TEMPLATE[operation.type as keyof typeof CRUD_FUNCTION_V4_TEMPLATE];
    if (!template) return '';

    return template
      .replace(/{{SCHEMA_NAME}}/g, schema.name)
      .replace(/{{SCHEMA_TYPE}}/g, schema.name)
      .replace(/{{TABLE_NAME}}/g, schema.tableName || schema.name.toLowerCase());
  }

  /**
   * オペレーションパラメータを生成
   */
  private generateOperationParams(operation: any): string {
    switch (operation.type) {
      case 'create':
        return 'data';
      case 'read':
        return 'id';
      case 'list':
        return 'request.query';
      case 'update':
        return 'id, data';
      case 'delete':
        return 'id';
      default:
        return '';
    }
  }

  /**
   * Azure Functions v4設定ファイルを生成
   */
  private async generateV4ConfigFiles(): Promise<void> {
    // host.json
    fs.writeFileSync(
      path.join(this.options.outputDir, 'host.json'),
      HOST_JSON_V4_TEMPLATE
    );

    // local.settings.json
    const localSettings = LOCAL_SETTINGS_V4_TEMPLATE.replace(
      '"COSMOS_DATABASE": "swallowkit-db"',
      `"COSMOS_DATABASE": "${this.options.cosmosDbDatabase || 'swallowkit-db'}"`
    );

    fs.writeFileSync(
      path.join(this.options.outputDir, 'local.settings.json'),
      localSettings
    );

    // tsconfig.json
    fs.writeFileSync(
      path.join(this.options.outputDir, 'tsconfig.json'),
      TSCONFIG_V4_TEMPLATE
    );

    // .funcignore
    fs.writeFileSync(
      path.join(this.options.outputDir, '.funcignore'),
      FUNCIGNORE_V4_TEMPLATE
    );

    // .gitignore
    const gitignoreContent = `# Azure Functions artifacts
dist/
local.settings.json
.vscode/
*.log
node_modules/
.env
.env.local
`;
    fs.writeFileSync(
      path.join(this.options.outputDir, '.gitignore'),
      gitignoreContent
    );
  }

  /**
   * package.json v4対応を生成
   */
  private async generateV4PackageJson(): Promise<void> {
    fs.writeFileSync(
      path.join(this.options.outputDir, 'package.json'),
      PACKAGE_JSON_V4_TEMPLATE
    );
  }

  /**
   * 共有モジュールを生成（v4対応）
   */
  async generateSharedModules(schemas: SchemaDefinition[], serverFunctions: ParsedServerFunction[], serverFunctionFiles: string[]): Promise<void> {
    const srcDir = path.join(this.options.outputDir, 'src');
    const sharedDir = path.join(srcDir, 'shared');
    this.ensureDirectoryExists(sharedDir);

    // スキーマファイルを生成
    if (schemas.length > 0) {
      const schemaExports = schemas
        .map(schema => `export const ${schema.name}Schema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // TODO: 実際のスキーマフィールドを追加
});`)
        .join('\n\n');

      const schemaContent = `import { z } from 'zod';

${schemaExports}
`;

      fs.writeFileSync(path.join(sharedDir, 'schemas.ts'), schemaContent);
    }

    // サーバー関数ファイルを生成（ファイル全体をコピー）
    if (serverFunctionFiles.length > 0) {
      // 最初のサーバー関数ファイルの内容をそのままコピー
      // 複数ファイルがある場合は結合する
      const combinedContent = serverFunctionFiles
        .map(filePath => fs.readFileSync(filePath, 'utf-8'))
        .filter(content => {
          // 空ファイルを除外
          if (content.trim().length === 0) return false;
          // クライアントスタブ（"should be called via useServerFn" を含む）を除外
          if (content.includes('should be called via useServerFn')) return false;
          return true;
        })
        .join('\n\n');

      if (combinedContent.trim().length > 0) {
        fs.writeFileSync(path.join(sharedDir, 'server-functions.ts'), combinedContent);
      } else {
        // 空ファイルまたはクライアントスタブしかない場合はデフォルトテンプレートを使用
        fs.writeFileSync(path.join(sharedDir, 'server-functions.ts'), DEFAULT_SERVER_FUNCTIONS_TEMPLATE);
      }
    } else {
      // サーバー関数ファイルがない場合もデフォルトテンプレートを使用
      fs.writeFileSync(path.join(sharedDir, 'server-functions.ts'), DEFAULT_SERVER_FUNCTIONS_TEMPLATE);
    }
  }

  /**
   * ディレクトリが存在しなければ作成
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

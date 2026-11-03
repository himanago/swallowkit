import { AZURE_SEED_MAX_BYTES, AZURE_SEED_MAX_DOCUMENTS } from "./bootstrap-constants";
import type { BackendLanguage } from "../../types";

const CSHARP_BOOTSTRAP_FUNCTION = String.raw`using System.Net;
using System.Security.Cryptography;
using System.Text;
using Azure.Identity;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Newtonsoft.Json.Linq;

namespace SwallowKit.Functions;

public sealed class BootstrapSeedFunction
{
    private const string ExpectedTokenHash = "__TOKEN_HASH__";
    private const long TokenExpiresAt = __EXPIRES_AT__;
    private const bool Force = __FORCE__;
    private const string EncodedSeed = "__SEED_BASE64__";
    private const string DatabaseName = __DATABASE_NAME__;
    private const int ProcessingLimitSeconds = 180;
    private static readonly HashSet<string> SystemProperties = new(StringComparer.Ordinal)
    {
        "_rid", "_self", "_etag", "_attachments", "_ts"
    };

    [Function("seedBootstrap")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "seed-bootstrap")] HttpRequestData request)
    {
        var authHeader = request.Headers.TryGetValues("Authorization", out var values)
            ? values.FirstOrDefault()
            : null;
        if (string.IsNullOrWhiteSpace(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return await WriteResponseAsync(request, HttpStatusCode.Unauthorized, new { errorCategory = "authentication" });
        }

        var token = authHeader["Bearer ".Length..];
        if (token.Length == 0 || DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= TokenExpiresAt)
        {
            return await WriteResponseAsync(request, HttpStatusCode.Unauthorized, new { errorCategory = token.Length == 0 ? "authentication" : "expired" });
        }

        byte[] expectedHash;
        try
        {
            expectedHash = Convert.FromHexString(ExpectedTokenHash);
        }
        catch (FormatException)
        {
            return await WriteResponseAsync(request, HttpStatusCode.InternalServerError, new { errorCategory = "configuration" });
        }
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        if (expectedHash.Length != suppliedHash.Length || !CryptographicOperations.FixedTimeEquals(expectedHash, suppliedHash))
        {
            return await WriteResponseAsync(request, HttpStatusCode.Unauthorized, new { errorCategory = "authentication" });
        }

        if (string.Equals(request.Method, "GET", StringComparison.OrdinalIgnoreCase))
        {
            return await WriteResponseAsync(request, HttpStatusCode.OK, new { ready = true });
        }

        var started = DateTimeOffset.UtcNow;
        var created = 0;
        var upserted = 0;
        var skipped = 0;
        var conflicts = 0;
        var failed = 0;
        string? activeContainerName = null;
        int? activeSeedDocumentIndex = null;
        var operation = "create-client";

        try
        {
            using var client = CreateCosmosClient();
            operation = "decode-seed";
            var containers = JArray.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(EncodedSeed)));
            foreach (var containerSeed in containers.OfType<JObject>())
            {
                var containerName = containerSeed.Value<string>("containerName")!;
                activeContainerName = containerName;
                activeSeedDocumentIndex = null;
                operation = "get-container";
                var partitionKeyField = containerSeed.Value<string>("partitionKeyField")!;
                var container = client.GetContainer(
                    Environment.GetEnvironmentVariable("COSMOS_DB_DATABASE_NAME") ?? DatabaseName,
                    containerName);

                foreach (var item in containerSeed["documents"]!.OfType<JObject>())
                {
                    activeSeedDocumentIndex = ((JArray)containerSeed["documents"]!).IndexOf(item);
                    operation = "validate-item";
                    if ((DateTimeOffset.UtcNow - started).TotalSeconds >= ProcessingLimitSeconds)
                    {
                        return await WriteResponseAsync(request, HttpStatusCode.GatewayTimeout, new
                        {
                            created, upserted, skipped, conflicts, failed, errorCategory = "processing-time-limit"
                        });
                    }

                    var id = item.Value<string>("id");
                    var partitionValue = item[partitionKeyField];
                    if (string.IsNullOrWhiteSpace(id) ||
                        partitionValue is null ||
                        partitionValue.Type is JTokenType.Null or JTokenType.Object or JTokenType.Array)
                    {
                        failed++;
                        return await WriteResponseAsync(request, HttpStatusCode.BadRequest, new
                        {
                            created, upserted, skipped, conflicts, failed, errorCategory = "invalid-seed"
                        });
                    }

                    var partitionKey = ToPartitionKey(partitionValue);
                    if (Force)
                    {
                        operation = "upsert-item";
                        await container.UpsertItemAsync(item, partitionKey);
                        upserted++;
                        continue;
                    }
                    operation = "read-item";
                    var existing = await ReadExistingAsync(container, id, partitionKey);
                    if (existing is not null)
                    {
                        if (DocumentsEqual(existing, item))
                        {
                            skipped++;
                            continue;
                        }
                        conflicts++;
                        return await WriteResponseAsync(request, HttpStatusCode.Conflict, new
                        {
                            created, upserted, skipped, conflicts, failed, errorCategory = "data-conflict",
                            containerName, seedDocumentIndex = ((JArray)containerSeed["documents"]!).IndexOf(item)
                        });
                    }

                    try
                    {
                        operation = "create-item";
                        await container.CreateItemAsync(item, partitionKey);
                        created++;
                    }
                    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.Conflict)
                    {
                        operation = "read-after-conflict";
                        var racedItem = await ReadExistingAsync(container, id, partitionKey);
                        if (racedItem is not null && DocumentsEqual(racedItem, item))
                        {
                            skipped++;
                            continue;
                        }
                        conflicts++;
                        return await WriteResponseAsync(request, HttpStatusCode.Conflict, new
                        {
                            created, upserted, skipped, conflicts, failed, errorCategory = "data-conflict",
                            containerName, seedDocumentIndex = ((JArray)containerSeed["documents"]!).IndexOf(item)
                        });
                    }
                }
            }

            if ((DateTimeOffset.UtcNow - started).TotalSeconds >= ProcessingLimitSeconds)
            {
                return await WriteResponseAsync(request, HttpStatusCode.GatewayTimeout, new
                {
                    created, upserted, skipped, conflicts, failed, errorCategory = "processing-time-limit"
                });
            }
            return await WriteResponseAsync(request, HttpStatusCode.OK, new { created, upserted, skipped, conflicts, failed });
        }
        catch (Exception error)
        {
            failed++;
            return await WriteResponseAsync(request, HttpStatusCode.ServiceUnavailable, new
            {
                created, upserted, skipped, conflicts, failed, errorCategory = "write-outcome-unknown",
                containerName = activeContainerName, seedDocumentIndex = activeSeedDocumentIndex,
                operation, elapsedMs = (long)(DateTimeOffset.UtcNow - started).TotalMilliseconds,
                diagnostics = BuildFailureDetails(error)
            });
        }
    }

    private static object BuildFailureDetails(Exception error)
    {
        var cosmosError = error as CosmosException;
        return new
        {
            exceptionType = error.GetType().Name,
            innerExceptionType = error.InnerException?.GetType().Name,
            cosmosStatusCode = cosmosError is null ? (int?)null : (int)cosmosError.StatusCode,
            cosmosSubStatusCode = cosmosError?.SubStatusCode,
            activityId = cosmosError?.ActivityId,
            retryAfterMs = cosmosError?.RetryAfter?.TotalMilliseconds
        };
    }

    private static CosmosClient CreateCosmosClient()
    {
        var endpoint = Environment.GetEnvironmentVariable("CosmosDBConnection__accountEndpoint");
        if (!string.IsNullOrWhiteSpace(endpoint))
        {
            return new CosmosClient(endpoint, new DefaultAzureCredential(), new CosmosClientOptions
            {
                RequestTimeout = TimeSpan.FromSeconds(10),
                MaxRetryAttemptsOnRateLimitedRequests = 2,
                MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(10),
            });
        }
        var connectionString = Environment.GetEnvironmentVariable("CosmosDBConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Cosmos DB connection is not configured.");
        }
        return new CosmosClient(connectionString, new CosmosClientOptions
        {
            RequestTimeout = TimeSpan.FromSeconds(10),
            MaxRetryAttemptsOnRateLimitedRequests = 2,
            MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(10),
        });
    }

    private static PartitionKey ToPartitionKey(JToken value)
    {
        return value.Type switch
        {
            JTokenType.String => new PartitionKey(value.Value<string>()!),
            JTokenType.Integer or JTokenType.Float => new PartitionKey(value.Value<double>()),
            JTokenType.Boolean => new PartitionKey(value.Value<bool>()),
            _ => throw new InvalidOperationException("Unsupported partition key value."),
        };
    }

    private static async Task<JObject?> ReadExistingAsync(Container container, string id, PartitionKey partitionKey)
    {
        try
        {
            var response = await container.ReadItemAsync<JObject>(id, partitionKey);
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    private static bool DocumentsEqual(JObject left, JObject right) =>
        JToken.DeepEquals(Normalize(left), Normalize(right));

    private static JToken? Normalize(JToken? node)
    {
        if (node is JObject obj)
        {
            var normalized = new JObject();
            foreach (var entry in obj.Properties().OrderBy(entry => entry.Name, StringComparer.Ordinal))
            {
                if (!SystemProperties.Contains(entry.Name))
                {
                    normalized[entry.Name] = Normalize(entry.Value);
                }
            }
            return normalized;
        }
        if (node is JArray array)
        {
            var normalized = new JArray();
            foreach (var item in array)
            {
                normalized.Add(Normalize(item) ?? JValue.CreateNull());
            }
            return normalized;
        }
        return node?.DeepClone();
    }

    private static async Task<HttpResponseData> WriteResponseAsync(
        HttpRequestData request,
        HttpStatusCode status,
        object body)
    {
        var response = request.CreateResponse(status);
        await response.WriteAsJsonAsync(body);
        return response;
    }
}
`;

const PYTHON_BOOTSTRAP_FUNCTION = String.raw`import base64
import hashlib
import hmac
import json
import os
import time

import azure.functions as func
from azure.cosmos import CosmosClient, exceptions
from azure.identity import DefaultAzureCredential

bp = func.Blueprint()
EXPECTED_TOKEN_HASH = "__TOKEN_HASH__"
TOKEN_EXPIRES_AT = __EXPIRES_AT__
FORCE = __FORCE_PYTHON__
ENCODED_SEED = "__SEED_BASE64__"
DATABASE_NAME = os.environ.get("COSMOS_DB_DATABASE_NAME", __DATABASE_NAME__)
PROCESSING_LIMIT_SECONDS = 180
SYSTEM_PROPERTIES = {"_rid", "_self", "_etag", "_attachments", "_ts"}


def _json_response(payload, status_code):
    return func.HttpResponse(
        body=json.dumps(payload, ensure_ascii=False),
        status_code=status_code,
        mimetype="application/json",
    )


def _clean_document(document):
    return {key: value for key, value in document.items() if key not in SYSTEM_PROPERTIES}


def _same_document(left, right):
    return json.dumps(_clean_document(left), sort_keys=True, separators=(",", ":")) == json.dumps(
        _clean_document(right), sort_keys=True, separators=(",", ":")
    )


def _create_cosmos_client():
    endpoint = os.environ.get("CosmosDBConnection__accountEndpoint")
    if endpoint:
        credential = DefaultAzureCredential()
        try:
            client = CosmosClient(
                endpoint,
                credential=credential,
                timeout=10,
                connection_timeout=5,
                read_timeout=10,
                retry_total=1,
                retry_connect=1,
                retry_read=1,
                retry_backoff_max=1,
                retry_throttle_total=1,
                retry_throttle_backoff_max=1,
            )
        except Exception:
            credential.close()
            raise
        return client, credential
    else:
        connection_string = os.environ.get("CosmosDBConnection")
        if not connection_string:
            raise RuntimeError("Cosmos DB connection is not configured.")
        client = CosmosClient.from_connection_string(
            connection_string,
            timeout=10,
            connection_timeout=5,
            read_timeout=10,
            retry_total=1,
            retry_connect=1,
            retry_read=1,
            retry_backoff_max=1,
            retry_throttle_total=1,
            retry_throttle_backoff_max=1,
        )
        credential = None
    return client, credential


def _get_container(client, container_name):
    database = client.get_database_client(DATABASE_NAME)
    return database.get_container_client(container_name)


def _write_failure(created, skipped, conflicts, failed, category, status, **details):
    return _json_response(
        {
            **details,
            "created": created,
            "skipped": skipped,
            "conflicts": conflicts,
            "failed": failed,
            "errorCategory": category,
        },
        status,
    )


@bp.route(route="seed-bootstrap", methods=["GET", "POST"], auth_level=func.AuthLevel.ANONYMOUS)
def seed_bootstrap(req: func.HttpRequest) -> func.HttpResponse:
    auth_header = req.headers.get("Authorization", "")
    scheme, separator, token = auth_header.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token:
        return _json_response({"errorCategory": "authentication"}, 401)
    if int(time.time()) >= TOKEN_EXPIRES_AT:
        return _json_response({"errorCategory": "expired"}, 401)
    supplied_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(supplied_hash, EXPECTED_TOKEN_HASH):
        return _json_response({"errorCategory": "authentication"}, 401)

    if req.method.upper() == "GET":
        return _json_response({"ready": True}, 200)

    started = time.monotonic()
    created = skipped = conflicts = failed = upserted = 0
    def write_failure(*args, **details):
        return _write_failure(*args, upserted=upserted, **details)
    client = None
    credential = None
    try:
        seeds = json.loads(base64.b64decode(ENCODED_SEED).decode("utf-8"))
        client, credential = _create_cosmos_client()
        for seed in seeds:
            container = _get_container(client, seed["containerName"])
            partition_key_field = seed["partitionKeyField"]
            for document_index, document in enumerate(seed["documents"]):
                if time.monotonic() - started >= PROCESSING_LIMIT_SECONDS:
                    return write_failure(
                        created, skipped, conflicts, failed, "processing-time-limit", 504
                    )

                item_id = document.get("id")
                partition_key = document.get(partition_key_field)
                if not isinstance(item_id, str) or not item_id or partition_key is None:
                    failed += 1
                    return write_failure(created, skipped, conflicts, failed, "invalid-seed", 400)
                if isinstance(partition_key, (dict, list)):
                    failed += 1
                    return write_failure(created, skipped, conflicts, failed, "invalid-seed", 400)

                if FORCE:
                    container.upsert_item(body=document)
                    upserted += 1
                    continue

                try:
                    existing = container.read_item(item=item_id, partition_key=partition_key)
                except exceptions.CosmosResourceNotFoundError:
                    existing = None

                if existing is not None:
                    if _same_document(existing, document):
                        skipped += 1
                        continue
                    conflicts += 1
                    return write_failure(created, skipped, conflicts, failed, "data-conflict", 409,
                                          containerName=seed["containerName"], seedDocumentIndex=document_index)

                try:
                    container.create_item(body=document)
                    created += 1
                except exceptions.CosmosResourceExistsError:
                    try:
                        raced_item = container.read_item(item=item_id, partition_key=partition_key)
                    except exceptions.CosmosResourceNotFoundError:
                        raced_item = None
                    if raced_item is not None and _same_document(raced_item, document):
                        skipped += 1
                        continue
                    conflicts += 1
                    return write_failure(created, skipped, conflicts, failed, "data-conflict", 409,
                                          containerName=seed["containerName"], seedDocumentIndex=document_index)
                except Exception:
                    failed += 1
                    return write_failure(
                        created, skipped, conflicts, failed, "write-outcome-unknown", 503
                    )

        if time.monotonic() - started >= PROCESSING_LIMIT_SECONDS:
            return write_failure(
                created, skipped, conflicts, failed, "processing-time-limit", 504
            )
        return _json_response(
            {"created": created, "upserted": upserted, "skipped": skipped, "conflicts": conflicts, "failed": failed},
            200,
        )
    except Exception:
        failed += 1
        return write_failure(created, skipped, conflicts, failed, "write-outcome-unknown", 503)
    finally:
        if credential is not None:
            credential.close()
`;

const TYPESCRIPT_BOOTSTRAP_FUNCTION = String.raw`import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient, CosmosClientOptions } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { createHash, timingSafeEqual } from "node:crypto";

const expectedTokenHash = "__TOKEN_HASH__";
const tokenExpiresAt = __EXPIRES_AT__;
const force = __FORCE__;
const encodedSeed = "__SEED_BASE64__";
const databaseName = process.env.COSMOS_DB_DATABASE_NAME ?? __DATABASE_NAME__;
const processingLimitMs = 180_000;
const systemProperties = new Set(["_rid", "_self", "_etag", "_attachments", "_ts"]);

type SeedDocument = Record<string, unknown> & { id: string };
type ContainerSeed = { containerName: string; partitionKeyField: string; documents: SeedDocument[] };
type PartitionValue = string | number | boolean;

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !systemProperties.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

function sameDocument(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function createCosmosClient(): { client: CosmosClient; credential?: DefaultAzureCredential } {
  const connectionPolicy: CosmosClientOptions["connectionPolicy"] = {
    requestTimeout: 10_000,
    retryOptions: {
      maxRetryAttemptCount: 1,
      maxWaitTimeInSeconds: 1,
    },
  };
  const endpoint = process.env.CosmosDBConnection__accountEndpoint;
  if (endpoint) {
    const credential = new DefaultAzureCredential();
    return {
      client: new CosmosClient({
      endpoint,
        aadCredentials: credential,
        connectionPolicy,
      }),
      credential,
    };
  }
  const connectionString = process.env.CosmosDBConnection;
  if (!connectionString) throw new Error("Cosmos DB connection is not configured.");
  return { client: new CosmosClient({ connectionString, connectionPolicy }) };
}

function response(status: number, payload: Record<string, unknown>): HttpResponseInit {
  return { status, jsonBody: payload };
}

function isStatus(error: unknown, statusCode: number): boolean {
  return Boolean(error && typeof error === "object" && "statusCode" in error && error.statusCode === statusCode);
}

async function seedBootstrap(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const [scheme, token, ...extra] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || extra.length > 0) {
    return response(401, { errorCategory: "authentication" });
  }
  if (Math.floor(Date.now() / 1000) >= tokenExpiresAt) {
    return response(401, { errorCategory: "expired" });
  }
  const expectedHash = Buffer.from(expectedTokenHash, "hex");
  const suppliedHash = createHash("sha256").update(token, "utf8").digest();
  if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(expectedHash, suppliedHash)) {
    return response(401, { errorCategory: "authentication" });
  }

  if (request.method.toUpperCase() === "GET") {
    return response(200, { ready: true });
  }

  const started = Date.now();
  let created = 0;
  let upserted = 0;
  let skipped = 0;
  let conflicts = 0;
  let failed = 0;
  let client: CosmosClient | undefined;
  let credential: DefaultAzureCredential | undefined;
  try {
    const seeds = JSON.parse(Buffer.from(encodedSeed, "base64").toString("utf8")) as ContainerSeed[];
    const cosmos = createCosmosClient();
    client = cosmos.client;
    credential = cosmos.credential;
    for (const seed of seeds) {
      const container = client.database(databaseName).container(seed.containerName);
      for (const document of seed.documents) {
        if (Date.now() - started >= processingLimitMs) {
          return response(504, { created, upserted, skipped, conflicts, failed, errorCategory: "processing-time-limit" });
        }
        const partitionValue = document[seed.partitionKeyField];
        if (typeof document.id !== "string" || !document.id.trim() ||
            (typeof partitionValue !== "string" && typeof partitionValue !== "number" && typeof partitionValue !== "boolean")) {
          failed++;
          return response(400, { created, upserted, skipped, conflicts, failed, errorCategory: "invalid-seed" });
        }

        const partitionKey = partitionValue as PartitionValue;
        if (force) {
          await container.items.upsert(document);
          upserted++;
          continue;
        }
        let existing: Record<string, unknown> | undefined;
        try {
          const result = await container.item(document.id, partitionKey).read<Record<string, unknown>>();
          existing = result.resource;
        } catch (error) {
          if (!isStatus(error, 404)) throw error;
        }
        if (existing) {
          if (sameDocument(existing, document)) {
            skipped++;
            continue;
          }
          conflicts++;
          return response(409, { created, upserted, skipped, conflicts, failed, errorCategory: "data-conflict",
            containerName: seed.containerName, seedDocumentIndex: seed.documents.indexOf(document) });
        }

        try {
          await container.items.create(document);
          created++;
        } catch (error) {
          if (!isStatus(error, 409)) throw error;
          const raced = await container.item(document.id, partitionKey).read<Record<string, unknown>>();
          if (raced.resource && sameDocument(raced.resource, document)) {
            skipped++;
            continue;
          }
          conflicts++;
          return response(409, { created, upserted, skipped, conflicts, failed, errorCategory: "data-conflict",
            containerName: seed.containerName, seedDocumentIndex: seed.documents.indexOf(document) });
        }
      }
    }

    if (Date.now() - started >= processingLimitMs) {
      return response(504, { created, upserted, skipped, conflicts, failed, errorCategory: "processing-time-limit" });
    }
    return response(200, { created, upserted, skipped, conflicts, failed });
  } catch (error) {
    failed++;
    context.error("Cosmos bootstrap failed; a write may have an indeterminate outcome.", error);
    return response(503, { created, upserted, skipped, conflicts, failed, errorCategory: "write-outcome-unknown" });
  } finally {
    client?.dispose();
    credential?.close();
  }
}

app.http("seedBootstrap", {
  methods: ["GET", "POST"],
  route: "seed-bootstrap",
  authLevel: "anonymous",
  handler: seedBootstrap,
});
`;

const PREPARATION_SCRIPT = String.raw`#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const MAX_DOCUMENTS = __MAX_DOCUMENTS__;
const MAX_BYTES = __MAX_BYTES__;
const SEED_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SYSTEM_PROPERTIES = new Set(["_rid", "_self", "_etag", "_attachments", "_ts"]);
const BACKEND = "__BACKEND__";
const FUNCTION_TEMPLATE = __FUNCTION_TEMPLATE__;
const seedName = process.argv[2] || "";
const tokenHash = process.env.BOOTSTRAP_TOKEN_HASH || "";
const expiresAt = Number(process.env.BOOTSTRAP_EXPIRES_AT || 0);
const force = process.env.BOOTSTRAP_FORCE || "false";

function fail(message) {
  console.error("Bootstrap seed preparation failed: " + message);
  process.exit(1);
}

if (!SEED_NAME_PATTERN.test(seedName)) {
  fail("seed_name must start with an alphanumeric character and contain only letters, numbers, hyphens, or underscores (max 64 characters).");
}
if (force !== "true" && force !== "false") {
  fail("BOOTSTRAP_FORCE must be true or false.");
}
if (!/^[a-f0-9]{64}$/.test(tokenHash) || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
  fail("temporary authentication settings are missing or invalid.");
}

const seedsRoot = path.resolve(root, "dev-seeds");
const seedDirectory = path.resolve(seedsRoot, seedName);
const relativeSeedDirectory = path.relative(seedsRoot, seedDirectory);
if (relativeSeedDirectory.startsWith("..") || path.isAbsolute(relativeSeedDirectory)) {
  fail("seed_name resolves outside dev-seeds.");
}
if (!fs.existsSync(seedsRoot) || fs.lstatSync(seedsRoot).isSymbolicLink() || !fs.statSync(seedsRoot).isDirectory()) {
  fail("dev-seeds must be a regular directory inside the project.");
}
if (!fs.existsSync(seedDirectory) || fs.lstatSync(seedDirectory).isSymbolicLink() || !fs.statSync(seedDirectory).isDirectory()) {
  fail("the selected dev-seeds directory does not exist.");
}
const realSeedsRoot = fs.realpathSync(seedsRoot);
const realSeedDirectory = fs.realpathSync(seedDirectory);
const relativeRealSeedDirectory = path.relative(realSeedsRoot, realSeedDirectory);
if (relativeRealSeedDirectory.startsWith("..") || path.isAbsolute(relativeRealSeedDirectory)) {
  fail("the selected seed directory resolves outside dev-seeds.");
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => walk(path.join(directory, entry.name)))
    .concat(fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
      .map((entry) => path.join(directory, entry.name)));
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pascalCase(value) {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

function modelDefinition(filePath, modelsRoot) {
  const content = fs.readFileSync(filePath, "utf8");
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const schemas = [];
  let partitionKey = "/id";
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) ||
        !statement.modifiers ||
        !statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text === "partitionKey" && declaration.initializer && ts.isStringLiteral(declaration.initializer)) {
        partitionKey = declaration.initializer.text;
      }
      if (!declaration.initializer ||
          !ts.isCallExpression(declaration.initializer) ||
          !ts.isPropertyAccessExpression(declaration.initializer.expression) ||
          declaration.initializer.expression.name.text !== "object") continue;
      schemas.push(declaration.name.text);
    }
  }
  const modelName = pascalCase(path.basename(filePath, ".ts"));
  const exact = schemas.filter((name) => {
    const normalizedName = name.toLowerCase();
    return normalizedName === modelName.toLowerCase() ||
      normalizedName === (modelName + "schema").toLowerCase();
  });
  const schemaName = exact.length === 1 ? exact[0] : schemas.length === 1 ? schemas[0] : null;
  if (!schemaName) fail("could not uniquely identify the Zod object schema for " + filePath + ".");
  if (!partitionKey.startsWith("/") || partitionKey.slice(1).length === 0 || partitionKey.slice(1).includes("/")) {
    fail("unsupported Cosmos partition key path in " + filePath + ".");
  }
  const relativeModel = path.relative(modelsRoot, filePath).replace(/\.ts$/, ".js");
  const compiledModel = path.join(root, "shared", "dist", "models", relativeModel);
  if (!fs.existsSync(compiledModel)) fail("compiled model module is missing: " + relativeModel);
  const modelModule = require(compiledModel);
  const schema = modelModule[schemaName];
  if (!schema || typeof schema.safeParse !== "function") {
    fail("compiled Zod schema is missing for " + filePath + ".");
  }
  return {
    modelName,
    schemaName,
    schema,
    partitionKeyField: partitionKey.slice(1),
    aliases: [modelName, schemaName, path.basename(filePath, ".ts")],
  };
}

const modelsRoot = path.resolve(root, "shared", "models");
if (!fs.existsSync(modelsRoot)) fail("shared/models was not found.");
const models = walk(modelsRoot).map((filePath) => modelDefinition(filePath, modelsRoot));
const modelAliases = new Map();
for (const model of models) {
  for (const alias of model.aliases) {
    const key = normalize(alias);
    const existing = modelAliases.get(key);
    if (existing && existing !== model) fail("model name aliases are ambiguous: " + alias + ".");
    modelAliases.set(key, model);
  }
}

const jsonFiles = fs.readdirSync(seedDirectory)
  .filter((entry) => entry.toLowerCase().endsWith(".json"))
  .sort();
if (jsonFiles.length === 0) fail("the selected dev-seeds directory contains no JSON files.");

let totalDocuments = 0;
let totalBytes = 0;
const containers = [];
for (const fileName of jsonFiles) {
  const filePath = path.join(seedDirectory, fileName);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(filePath)) !== fs.realpathSync(seedDirectory)) {
    fail("seed JSON files must be regular files inside the selected directory.");
  }
  totalBytes += stat.size;
  const model = modelAliases.get(normalize(path.basename(fileName, path.extname(fileName))));
  if (!model) fail("seed file " + fileName + " does not match a model in shared/models.");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail("seed file " + fileName + " is not valid JSON.");
  }
  const documents = Array.isArray(parsed) ? parsed : [parsed];
  if (documents.some((document) => !document || typeof document !== "object" || Array.isArray(document))) {
    fail("seed file " + fileName + " must contain only JSON objects.");
  }
  const seenIds = new Set();
  const validatedDocuments = documents.map((document, index) => {
    const clean = Object.fromEntries(Object.entries(document).filter(([key]) => !SYSTEM_PROPERTIES.has(key)));
    if (typeof clean.id !== "string" || clean.id.trim().length === 0) {
      fail(fileName + " item " + index + " must have a non-empty string id.");
    }
    if (seenIds.has(clean.id)) fail(fileName + " contains duplicate ids.");
    seenIds.add(clean.id);
    if (!Object.prototype.hasOwnProperty.call(clean, model.partitionKeyField) || clean[model.partitionKeyField] === null) {
      fail(fileName + " item " + index + " is missing partition key " + model.partitionKeyField + ".");
    }
    const result = model.schema.safeParse(clean);
    if (!result.success) {
      const issue = result.error.issues[0];
      fail(fileName + " item " + index + " failed Zod validation at " + (issue.path.join(".") || "<root>") + ".");
    }
    return result.data;
  });
  totalDocuments += validatedDocuments.length;
  const containerName = model.modelName.endsWith("s") ? model.modelName : model.modelName + "s";
  containers.push({ containerName, partitionKeyField: model.partitionKeyField, documents: validatedDocuments });
}

if (totalDocuments === 0) fail("the selected seed contains no documents.");
if (totalDocuments > MAX_DOCUMENTS) fail("seed has " + totalDocuments + " documents; limit is " + MAX_DOCUMENTS + ".");
if (totalBytes > MAX_BYTES) fail("seed files total " + totalBytes + " bytes; limit is " + MAX_BYTES + ".");

const encodedSeed = Buffer.from(JSON.stringify(containers), "utf8").toString("base64");
const packageName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name || "App";
const databaseName = packageName.charAt(0).toUpperCase() + packageName.slice(1) + "Database";
const generatedFunction = FUNCTION_TEMPLATE
  .replaceAll("__TOKEN_HASH__", tokenHash)
  .replaceAll("__EXPIRES_AT__", String(expiresAt))
  .replaceAll("__FORCE__", force)
  .replaceAll("__FORCE_PYTHON__", force === "true" ? "True" : "False")
  .replaceAll("__DATABASE_NAME__", JSON.stringify(databaseName))
  .replaceAll("__SEED_BASE64__", encodedSeed);

if (BACKEND === "csharp") {
  const target = path.join(root, "functions", "Crud", "BootstrapSeedFunction.cs");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generatedFunction, "utf8");
} else if (BACKEND === "python") {
  const target = path.join(root, "functions", "blueprints", "bootstrap_seed.py");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generatedFunction, "utf8");
  const appPath = path.join(root, "functions", "function_app.py");
  let app = fs.readFileSync(appPath, "utf8");
  const registration = "from blueprints.bootstrap_seed import bp as bootstrap_seed_bp\napp.register_blueprint(bootstrap_seed_bp)\n";
  const marker = "# SwallowKit scaffold registrations";
  if (!app.includes(marker)) fail("function_app.py is missing the SwallowKit registration marker.");
  app = app.replace(marker, registration + marker);
  fs.writeFileSync(appPath, app, "utf8");
} else {
  const target = path.join(root, "functions", "src", "bootstrap-seed.ts");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generatedFunction, "utf8");
}

console.log("Prepared " + totalDocuments + " validated seed document(s) across " + containers.length + " container(s).");
`;

export function buildBootstrapSeedPreparationScript(backendLanguage: BackendLanguage): string {
  if (backendLanguage !== "csharp" && backendLanguage !== "python" && backendLanguage !== "typescript") {
    throw new Error("Bootstrap seeding supports only TypeScript, C#, and Python Functions backends.");
  }

  const functionTemplate = backendLanguage === "csharp"
    ? CSHARP_BOOTSTRAP_FUNCTION
    : backendLanguage === "python"
      ? PYTHON_BOOTSTRAP_FUNCTION
      : TYPESCRIPT_BOOTSTRAP_FUNCTION;
  return PREPARATION_SCRIPT
    .replace("__MAX_DOCUMENTS__", String(AZURE_SEED_MAX_DOCUMENTS))
    .replace("__MAX_BYTES__", String(AZURE_SEED_MAX_BYTES))
    .replace("__BACKEND__", backendLanguage)
    .replace("__FUNCTION_TEMPLATE__", JSON.stringify(functionTemplate));
}

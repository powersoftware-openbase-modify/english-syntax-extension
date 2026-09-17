import { normalizeBaseUrl } from "./base-url";

export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
  timeoutMs: number;
  /**
   * response_format 能力档位(探到后持久化,undefined/"unknown" = 从 schema 试起):
   * - "supported":端点收 json_schema 严格模式;
   * - "json-object":schema 被拒但收 {type:"json_object"}——DeepSeek V4.1 起
   *   下线了 json_schema,且其非思考模式无约束解码时会在 JSON 正文里吐
   *   `<|endoftext|>` 一类特殊 token,只有 json_object 的服务端约束能压住,
   *   所以被拒后先降到这一档而不是直接裸奔;
   * - "unsupported":连 json_object 也被拒,彻底不发 response_format。
   */
  jsonSchemaSupport: "unknown" | "supported" | "json-object" | "unsupported";
  /**
   * 只持久化否定态:某些 OpenAI 兼容端点不接受 stream(尤其与 response_format 同用),
   * 探到一次就记下来别再试。undefined = 值得尝试流式。
   */
  streamSupport?: "unsupported";
  /**
   * 思考模型会为一句话生成上万 token 推理(实测 deepseek-v4-flash 单句 153 秒 /
   * 14789 tok,带 reasoning_effort:"none" 后 1.41 秒 / 135 tok),而 DeepSeek 的
   * 模型(deepseek-flash 等)思考默认开启。所以默认下发关闭思考的参数,只持久化
   * 否定态降级链:端点拒绝 reasoning_effort 就降为 thinking:{type:"disabled"}
   * ("thinking-disabled",DeepSeek 文档规定的 OpenAI 格式关思考方式);连 thinking
   * 开关也不收就记 "unsupported",之后不再交这笔学费。与 streamSupport 同款套路。
   */
  reasoningControl?: "unsupported" | "thinking-disabled";
  /**
   * 仅为兼容旧 profile 保留的历史字段,不再影响任何请求——关思考现在由
   * reasoningControl 降级链自动接管(见上),无需用户显式勾选。
   */
  disableReasoning?: true;
}

export type PublicModelProfile = Omit<ModelProfile, "apiKey" | "headers">;

interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const PROFILES_KEY = "profiles.v1";
const ACTIVE_PROFILE_ID_KEY = "activeProfileId.v1";
const CACHE_LIMIT_MB_KEY = "cacheLimitMb.v1";
const PREFETCH_DETAIL_KEY = "prefetchDetail.v1";
const STREAM_RENDERING_KEY = "streamRendering.v1";
const DEFAULT_CACHE_LIMIT_MB = 50;
const CACHE_LIMIT_CHOICES_MB = new Set([10, 50, 100, 200]);
const FORBIDDEN_HEADERS = new Set([
  "authorization",
  "host",
  "content-length",
  "origin",
  "x-syntax-request-id",
]);
const JSON_SCHEMA_SUPPORT = new Set<ModelProfile["jsonSchemaSupport"]>([
  "unknown",
  "supported",
  "json-object",
  "unsupported",
]);

function requireNonBlank(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Model profile ${field} must not be blank`);
  }
}

function validateProfile(profile: ModelProfile): ModelProfile {
  requireNonBlank(profile.id, "id");
  requireNonBlank(profile.name, "name");
  requireNonBlank(profile.model, "model");
  if (typeof profile.apiKey !== "string") {
    throw new Error("Model profile apiKey must be a string");
  }
  if (
    !Number.isInteger(profile.timeoutMs) ||
    profile.timeoutMs < 5_000 ||
    profile.timeoutMs > 120_000
  ) {
    throw new Error("Model profile timeout must be between 5000 and 120000 milliseconds");
  }
  if (!JSON_SCHEMA_SUPPORT.has(profile.jsonSchemaSupport)) {
    throw new Error("Model profile jsonSchemaSupport is invalid");
  }
  if (profile.streamSupport !== undefined && profile.streamSupport !== "unsupported") {
    throw new Error("Model profile streamSupport is invalid");
  }
  if (
    profile.reasoningControl !== undefined &&
    profile.reasoningControl !== "unsupported" &&
    profile.reasoningControl !== "thinking-disabled"
  ) {
    throw new Error("Model profile reasoningControl is invalid");
  }
  if (profile.disableReasoning !== undefined && profile.disableReasoning !== true) {
    throw new Error("Model profile disableReasoning is invalid");
  }
  if (
    typeof profile.headers !== "object" ||
    profile.headers === null ||
    Array.isArray(profile.headers)
  ) {
    throw new Error("Model profile headers must be an object");
  }
  for (const [name, value] of Object.entries(profile.headers)) {
    if (FORBIDDEN_HEADERS.has(name.trim().toLowerCase())) {
      throw new Error(`Custom header ${name} is forbidden`);
    }
    if (typeof value !== "string") {
      throw new Error(`Custom header ${name} must have a string value`);
    }
  }

  return structuredClone({ ...profile, baseUrl: normalizeBaseUrl(profile.baseUrl) });
}

export class ConfigRepository {
  constructor(private readonly storage: StorageArea = chrome.storage.local) {}

  async saveProfile(profile: ModelProfile): Promise<void> {
    const validated = validateProfile(profile);
    const profiles = await this.listProfiles();
    const existingIndex = profiles.findIndex(({ id }) => id === validated.id);
    if (existingIndex === -1) {
      profiles.push(validated);
    } else {
      profiles[existingIndex] = validated;
    }
    await this.storage.set({ [PROFILES_KEY]: profiles });
    // A fresh install has no active profile; activate the first one saved so
    // the options page alone is enough to start analyzing.
    if ((await this.getActiveProfileId()) === undefined) {
      await this.storage.set({ [ACTIVE_PROFILE_ID_KEY]: validated.id });
    }
  }

  async listProfiles(): Promise<ModelProfile[]> {
    const stored = (await this.storage.get(PROFILES_KEY))[PROFILES_KEY];
    if (stored === undefined) {
      return [];
    }
    if (!Array.isArray(stored)) {
      throw new Error("Stored model profiles are invalid");
    }
    return stored.map((value) => validateProfile(value as ModelProfile));
  }

  async getProfile(profileId: string): Promise<ModelProfile | undefined> {
    const profile = (await this.listProfiles()).find(({ id }) => id === profileId);
    return profile === undefined ? undefined : structuredClone(profile);
  }

  async setActiveProfile(profileId: string): Promise<void> {
    if ((await this.getProfile(profileId)) === undefined) {
      throw new Error(`Unknown model profile: ${profileId}`);
    }
    await this.storage.set({ [ACTIVE_PROFILE_ID_KEY]: profileId });
  }

  async getActiveProfile(): Promise<ModelProfile | undefined> {
    const profileId = await this.getActiveProfileId();
    return profileId === undefined ? undefined : this.getProfile(profileId);
  }

  async getActiveProfileId(): Promise<string | undefined> {
    const profileId = (await this.storage.get(ACTIVE_PROFILE_ID_KEY))[ACTIVE_PROFILE_ID_KEY];
    return typeof profileId === "string" ? profileId : undefined;
  }

  async listPublicProfiles(): Promise<PublicModelProfile[]> {
    return (await this.listProfiles()).map((profile) => ({
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
      timeoutMs: profile.timeoutMs,
      jsonSchemaSupport: profile.jsonSchemaSupport,
      ...(profile.reasoningControl === undefined
        ? {}
        : { reasoningControl: profile.reasoningControl }),
    }));
  }

  async getCacheLimitBytes(): Promise<number> {
    const stored = (await this.storage.get(CACHE_LIMIT_MB_KEY))[CACHE_LIMIT_MB_KEY];
    const limitMb =
      typeof stored === "number" && CACHE_LIMIT_CHOICES_MB.has(stored)
        ? stored
        : DEFAULT_CACHE_LIMIT_MB;
    return limitMb * 1024 * 1024;
  }

  async setCacheLimitMb(limitMb: number): Promise<void> {
    if (!CACHE_LIMIT_CHOICES_MB.has(limitMb)) {
      throw new Error("Analysis cache limit must be 10, 50, 100, or 200 MB");
    }
    await this.storage.set({ [CACHE_LIMIT_MB_KEY]: limitMb });
  }

  /** 「预载成分详解」全局开关;非 true 的任何存量值一律按 false。 */
  async getPrefetchDetail(): Promise<boolean> {
    return (await this.storage.get(PREFETCH_DETAIL_KEY))[PREFETCH_DETAIL_KEY] === true;
  }

  async setPrefetchDetail(enabled: boolean): Promise<void> {
    await this.storage.set({ [PREFETCH_DETAIL_KEY]: enabled === true });
  }

  /** 「流式渲染」开关;默认开,只有显式存过 false 才关(provider 异常时的退路)。 */
  async getStreamRendering(): Promise<boolean> {
    return (await this.storage.get(STREAM_RENDERING_KEY))[STREAM_RENDERING_KEY] !== false;
  }

  async setStreamRendering(enabled: boolean): Promise<void> {
    await this.storage.set({ [STREAM_RENDERING_KEY]: enabled === true });
  }
}

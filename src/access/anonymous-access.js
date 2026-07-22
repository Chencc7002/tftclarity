import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "tft_visitor";
const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS anonymous_daily_usage (
  subject_type TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_hash, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_anonymous_usage_date
ON anonymous_daily_usage(usage_date);
`;

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function resolveAnonymousAccessConfig(options = {}, env = process.env) {
  const enabled = booleanValue(
    options.enabled ?? env.TFT_AGENT_PUBLIC_MODE,
    env.NODE_ENV === "production"
  );
  const secret = String(options.secret ?? env.TFT_AGENT_VISITOR_SECRET ?? "").trim();
  if (enabled && secret.length < 32) {
    throw new Error("TFT_AGENT_PUBLIC_MODE requires TFT_AGENT_VISITOR_SECRET with at least 32 characters");
  }
  return {
    enabled,
    secret,
    secureCookies: booleanValue(
      options.secureCookies ?? env.TFT_AGENT_SECURE_COOKIES,
      env.NODE_ENV === "production"
    ),
    trustProxy: booleanValue(options.trustProxy ?? env.TFT_AGENT_TRUST_PROXY, false),
    visitorDailyLimit: nonNegativeInteger(
      options.visitorDailyLimit ?? env.TFT_AGENT_VISITOR_DAILY_LLM_LIMIT,
      10
    ),
    ipDailyLimit: nonNegativeInteger(
      options.ipDailyLimit ?? env.TFT_AGENT_IP_DAILY_LLM_LIMIT,
      20
    ),
    globalDailyLimit: nonNegativeInteger(
      options.globalDailyLimit ?? env.TFT_AGENT_GLOBAL_DAILY_LLM_LIMIT,
      500
    ),
    requestsPerMinute: nonNegativeInteger(
      options.requestsPerMinute ?? env.TFT_AGENT_REQUESTS_PER_MINUTE,
      30
    ),
    feedbackVisitorPerMinute: nonNegativeInteger(
      options.feedbackVisitorPerMinute ?? env.TFT_AGENT_FEEDBACK_VISITOR_PER_MINUTE,
      20
    ),
    feedbackIpPerMinute: nonNegativeInteger(
      options.feedbackIpPerMinute ?? env.TFT_AGENT_FEEDBACK_IP_PER_MINUTE,
      60
    )
  };
}

function parseCookies(header = "") {
  return Object.fromEntries(String(header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [part, ""];
      const key = part.slice(0, separator);
      try {
        return [key, decodeURIComponent(part.slice(separator + 1))];
      } catch {
        return [key, ""];
      }
    }));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function dateKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function resetAt(nowMs) {
  const date = new Date(nowMs);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

function hashSubject(secret, type, value) {
  return createHmac("sha256", secret).update(`${type}:${value}`).digest("hex");
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function quotaError() {
  return Object.assign(new Error("今日 AI 增强额度已用完，基础查询仍可继续使用"), {
    code: "llm_quota_exceeded",
    recoverable: true,
    statusCode: 429
  });
}

function changes(result) {
  return Number(result?.changes ?? result?.changesCount ?? 0);
}

export class AnonymousAccessService {
  constructor(options = {}) {
    this.config = resolveAnonymousAccessConfig(options, options.env ?? process.env);
    this.database = options.database ?? null;
    this.now = options.now ?? (() => Date.now());
    this.usage = new Map();
    this.minuteWindows = new Map();
    this.feedbackMinuteWindows = new Map();
    if (this.config.enabled && this.database) this.database.exec(SQLITE_SCHEMA);
  }

  signature(visitorId) {
    return createHmac("sha256", this.config.secret).update(visitorId).digest("base64url");
  }

  cookieValue(visitorId) {
    return `${visitorId}.${this.signature(visitorId)}`;
  }

  parseVisitor(cookieValue) {
    const [visitorId, signature] = String(cookieValue ?? "").split(".");
    if (!VISITOR_ID_PATTERN.test(visitorId ?? "") || !signature) return null;
    return safeEqual(signature, this.signature(visitorId)) ? visitorId : null;
  }

  setCookie(res, visitorId) {
    const cookie = [
      `${COOKIE_NAME}=${encodeURIComponent(this.cookieValue(visitorId))}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${365 * 24 * 60 * 60}`,
      ...(this.config.secureCookies ? ["Secure"] : [])
    ].join("; ");
    res.setHeader("set-cookie", cookie);
  }

  identify(req, res) {
    if (!this.config.enabled) {
      return { id: "local", scope: null, ipHash: "local", anonymous: true };
    }
    const cookies = parseCookies(req.headers.cookie);
    let visitorId = this.parseVisitor(cookies[COOKIE_NAME]);
    if (!visitorId) {
      visitorId = randomBytes(24).toString("base64url");
      this.setCookie(res, visitorId);
    }
    return {
      id: visitorId,
      scope: hashSubject(this.config.secret, "scope", visitorId).slice(0, 32),
      visitorHash: hashSubject(this.config.secret, "visitor", visitorId),
      ipHash: hashSubject(this.config.secret, "ip", clientIp(req, this.config.trustProxy)),
      anonymous: true
    };
  }

  enforceRequestRate(visitor) {
    if (!this.config.enabled || this.config.requestsPerMinute === 0) return;
    const minute = Math.floor(this.now() / 60_000);
    const key = `${visitor.ipHash}:${minute}`;
    const next = (this.minuteWindows.get(key) ?? 0) + 1;
    this.minuteWindows.set(key, next);
    if (this.minuteWindows.size > 2000) {
      for (const entry of this.minuteWindows.keys()) {
        if (!entry.endsWith(`:${minute}`)) this.minuteWindows.delete(entry);
      }
    }
    if (next > this.config.requestsPerMinute) {
      throw Object.assign(new Error("请求过于频繁，请稍后再试"), { statusCode: 429, code: "rate_limited" });
    }
  }

  enforceFeedbackRate(visitor) {
    if (!this.config.enabled) return;
    const minute = Math.floor(this.now() / 60_000);
    const subjects = [
      [`visitor:${visitor.visitorHash}:${minute}`, this.config.feedbackVisitorPerMinute],
      [`ip:${visitor.ipHash}:${minute}`, this.config.feedbackIpPerMinute]
    ];
    for (const [key, limit] of subjects) {
      if (limit === 0) continue;
      const next = (this.feedbackMinuteWindows.get(key) ?? 0) + 1;
      this.feedbackMinuteWindows.set(key, next);
      if (next > limit) {
        throw Object.assign(new Error("反馈提交过于频繁，请稍后再试"), {
          statusCode: 429,
          code: "feedback_rate_limited"
        });
      }
    }
    if (this.feedbackMinuteWindows.size > 4000) {
      for (const key of this.feedbackMinuteWindows.keys()) {
        if (!key.endsWith(`:${minute}`)) this.feedbackMinuteWindows.delete(key);
      }
    }
  }

  memoryCount(type, subjectHash, date) {
    return Number(this.usage.get(`${type}:${subjectHash}:${date}`) ?? 0);
  }

  sqliteCount(type, subjectHash, date) {
    const row = this.database.prepare(`
      SELECT usage_count FROM anonymous_daily_usage
      WHERE subject_type = ? AND subject_hash = ? AND usage_date = ?
    `).get(type, subjectHash, date);
    return Number(row?.usage_count ?? 0);
  }

  count(type, subjectHash, date) {
    return this.database
      ? this.sqliteCount(type, subjectHash, date)
      : this.memoryCount(type, subjectHash, date);
  }

  quota(visitor) {
    if (!this.config.enabled) {
      return { enabled: false, limit: null, used: 0, remaining: null, resetsAt: resetAt(this.now()) };
    }
    const date = dateKey(this.now());
    const used = this.count("visitor", visitor.visitorHash, date);
    return {
      enabled: true,
      limit: this.config.visitorDailyLimit,
      used,
      remaining: Math.max(0, this.config.visitorDailyLimit - used),
      resetsAt: resetAt(this.now())
    };
  }

  reserveMemory(visitor) {
    const date = dateKey(this.now());
    const subjects = [
      ["visitor", visitor.visitorHash, this.config.visitorDailyLimit],
      ["ip", visitor.ipHash, this.config.ipDailyLimit],
      ["global", "all", this.config.globalDailyLimit]
    ];
    if (subjects.some(([type, hash, limit]) => limit === 0 || this.memoryCount(type, hash, date) >= limit)) {
      throw quotaError();
    }
    for (const [type, hash] of subjects) {
      const key = `${type}:${hash}:${date}`;
      this.usage.set(key, this.memoryCount(type, hash, date) + 1);
    }
  }

  reserveSqlite(visitor) {
    const date = dateKey(this.now());
    const updatedAt = new Date(this.now()).toISOString();
    const subjects = [
      ["visitor", visitor.visitorHash, this.config.visitorDailyLimit],
      ["ip", visitor.ipHash, this.config.ipDailyLimit],
      ["global", "all", this.config.globalDailyLimit]
    ];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const [type, hash, limit] of subjects) {
        if (limit === 0) throw quotaError();
        const result = this.database.prepare(`
          INSERT INTO anonymous_daily_usage (
            subject_type, subject_hash, usage_date, usage_count, updated_at
          ) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(subject_type, subject_hash, usage_date) DO UPDATE SET
            usage_count = usage_count + 1,
            updated_at = excluded.updated_at
          WHERE usage_count < ?
        `).run(type, hash, date, updatedAt, limit);
        if (changes(result) < 1) throw quotaError();
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  reserveLlmUse(visitor) {
    if (!this.config.enabled) return this.quota(visitor);
    if (this.database) this.reserveSqlite(visitor);
    else this.reserveMemory(visitor);
    return this.quota(visitor);
  }

  publicStatus(visitor) {
    return {
      anonymous: true,
      quota: this.quota(visitor)
    };
  }
}

export function createAnonymousAccessService(runtime, options = {}, env = process.env) {
  return new AnonymousAccessService({
    ...options,
    env,
    database: options.database ?? runtime?.cacheStore?.database ?? null
  });
}

export function anonymousScopeKey(scope, key) {
  const normalizedScope = String(scope ?? "local").replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64) || "local";
  return `visitor:${normalizedScope}:${key}`;
}

import Redis from "ioredis";
import { redisUrl } from "@/lib/operations/queue";

const globalRedis = globalThis as typeof globalThis & { authRateLimitRedis?: Redis };

function client() {
  if (!process.env.REDIS_URL?.trim() && !process.env.E2E_REDIS_URL?.trim()) return null;
  globalRedis.authRateLimitRedis ??= new Redis(redisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1_500 });
  return globalRedis.authRateLimitRedis;
}

export async function consumeRedisRateLimit(key: string, ttlSeconds = 60) {
  const redis = client();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    const count = await redis.eval(
      "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return current",
      1,
      `api-rate:${key}`,
      ttlSeconds,
    );
    return Number(count);
  } catch {
    return null;
  }
}

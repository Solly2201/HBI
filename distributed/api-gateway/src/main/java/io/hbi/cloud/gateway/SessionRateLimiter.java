package io.hbi.cloud.gateway;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A plain in-memory token bucket per caller, used to slow down anonymous
 * session creation. Deliberately not Redis-backed: the gateway is a single
 * instance, session spam is the only thing being throttled, and losing the
 * counters on a restart costs nothing.
 *
 * Each key holds up to {@code capacity} tokens and refills continuously at
 * {@code refillPerMinute}. One session creation spends one token; an empty
 * bucket means 429.
 */
public class SessionRateLimiter {

    private static final int MAX_TRACKED_KEYS = 10_000;
    private static final long IDLE_EVICTION_MS = 10 * 60 * 1000;

    private final int capacity;
    private final double refillPerMs;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    private static final class Bucket {
        double tokens;
        long lastSeenMs;

        Bucket(double tokens, long now) {
            this.tokens = tokens;
            this.lastSeenMs = now;
        }
    }

    public SessionRateLimiter(int capacity, int refillPerMinute) {
        if (capacity < 1 || refillPerMinute < 1) {
            throw new IllegalArgumentException("capacity and refill must be at least 1");
        }
        this.capacity = capacity;
        this.refillPerMs = refillPerMinute / 60_000.0;
    }

    /** Spends one token for {@code key}; false means the caller is over the limit. */
    public boolean tryAcquire(String key, long nowMs) {
        evictIfCrowded(nowMs);
        Bucket bucket = buckets.computeIfAbsent(key, k -> new Bucket(capacity, nowMs));
        synchronized (bucket) {
            bucket.tokens = Math.min(capacity, bucket.tokens + (nowMs - bucket.lastSeenMs) * refillPerMs);
            bucket.lastSeenMs = nowMs;
            if (bucket.tokens < 1.0) {
                return false;
            }
            bucket.tokens -= 1.0;
            return true;
        }
    }

    /**
     * Keeps the map bounded even if someone rotates through many source
     * addresses: once it grows past the cap, buckets idle long enough to be
     * full again anyway are dropped.
     */
    private void evictIfCrowded(long nowMs) {
        if (buckets.size() <= MAX_TRACKED_KEYS) {
            return;
        }
        for (Iterator<Bucket> it = buckets.values().iterator(); it.hasNext(); ) {
            if (nowMs - it.next().lastSeenMs > IDLE_EVICTION_MS) {
                it.remove();
            }
        }
    }

    int trackedKeys() {
        return buckets.size();
    }
}

package io.hbi.cloud.gateway;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The anonymous-session throttle, pinned with a fake clock: a burst up to
 * capacity passes, the next call is refused, and time refills tokens at the
 * configured rate.
 */
class SessionRateLimiterTest {

    @Test
    void allowsABurstUpToCapacityThenRefuses() {
        SessionRateLimiter limiter = new SessionRateLimiter(5, 60);
        long now = 1_000_000;
        for (int i = 0; i < 5; i++) {
            assertThat(limiter.tryAcquire("1.2.3.4", now)).as("request %d", i).isTrue();
        }
        assertThat(limiter.tryAcquire("1.2.3.4", now)).isFalse();
    }

    @Test
    void refillsOverTimeAtTheConfiguredRate() {
        // 60 per minute = one token per second.
        SessionRateLimiter limiter = new SessionRateLimiter(2, 60);
        long now = 0;
        assertThat(limiter.tryAcquire("k", now)).isTrue();
        assertThat(limiter.tryAcquire("k", now)).isTrue();
        assertThat(limiter.tryAcquire("k", now)).isFalse();

        // 999 ms later: still under one token.
        assertThat(limiter.tryAcquire("k", now + 999)).isFalse();
        // ~1 s after that refusal the bucket is full again (2 tokens banked).
        assertThat(limiter.tryAcquire("k", now + 2000)).isTrue();
        assertThat(limiter.tryAcquire("k", now + 2000)).isTrue();
        assertThat(limiter.tryAcquire("k", now + 2000)).isFalse();
    }

    @Test
    void refillNeverOvershootsCapacity() {
        SessionRateLimiter limiter = new SessionRateLimiter(3, 60);
        long now = 0;
        // A long quiet hour must not bank more than the burst capacity.
        for (int i = 0; i < 3; i++) {
            assertThat(limiter.tryAcquire("k", now + 3_600_000)).isTrue();
        }
        assertThat(limiter.tryAcquire("k", now + 3_600_000)).isFalse();
    }

    @Test
    void callersAreIndependent() {
        SessionRateLimiter limiter = new SessionRateLimiter(1, 60);
        long now = 0;
        assertThat(limiter.tryAcquire("alice-ip", now)).isTrue();
        assertThat(limiter.tryAcquire("alice-ip", now)).isFalse();
        // A different caller has an untouched bucket.
        assertThat(limiter.tryAcquire("bob-ip", now)).isTrue();
    }

    @Test
    void idleBucketsAreEvictedOnceTheMapIsCrowded() {
        SessionRateLimiter limiter = new SessionRateLimiter(1, 60);
        long start = 0;
        for (int i = 0; i <= 10_000; i++) {
            limiter.tryAcquire("key-" + i, start);
        }
        assertThat(limiter.trackedKeys()).isGreaterThan(10_000);
        // 11 minutes later every old bucket is idle past the eviction window.
        limiter.tryAcquire("fresh", start + 11 * 60 * 1000);
        assertThat(limiter.trackedKeys()).isLessThanOrEqualTo(2);
    }

    @Test
    void rejectsNonsenseConfiguration() {
        assertThatThrownBy(() -> new SessionRateLimiter(0, 60)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new SessionRateLimiter(10, 0)).isInstanceOf(IllegalArgumentException.class);
    }
}

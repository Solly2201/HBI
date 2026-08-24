package io.hbi.cloud.rating;

import io.hbi.cloud.rating.RecommendationEngine.ScoredFood;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Coalesces per-event re-scoring.
 *
 * Phase 4 measured the real scalability ceiling of this service: every rating
 * event triggered a full room re-score (progress REST call to room-service,
 * catalogue REST call to food-service, delete/insert of the stored ranking),
 * draining a burst at only ~10-15 events/s. At human rating rates that is
 * irrelevant; under a burst it left minutes of single-partition backlog.
 *
 * The fix is a dirty set, not a queue: the Kafka listener only records that a
 * room needs re-scoring, and a single scheduled thread re-scores every dirty
 * room at most once per flush interval. Ten ratings landing in one window cost
 * one re-score instead of ten. Correctness is unaffected — scoring always
 * reads the full current state from the database, so the last flush after a
 * burst produces exactly the ranking the per-event version would have.
 *
 * The automatic decision check rides in the same flush, so the worst case
 * added latency for "everyone has finished" is one flush interval.
 *
 * A room whose re-score keeps failing is retried on every flush a bounded
 * number of times, then dropped with an error — the next rating event marks
 * it dirty again, and reads never depend on the stored ranking anyway
 * (GET /recommendations scores on read).
 */
@Component
public class RescoreCoalescer {

    private static final Logger log = LoggerFactory.getLogger(RescoreCoalescer.class);
    private static final int MAX_CONSECUTIVE_FAILURES = 40;

    private final BlendService blend;
    private final RoomBroadcaster broadcaster;
    private final Set<String> dirty = ConcurrentHashMap.newKeySet();
    private final Map<String, Integer> failures = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler;

    public RescoreCoalescer(BlendService blend,
                            RoomBroadcaster broadcaster,
                            @Value("${hbi.blend.rescore-interval-ms:250}") long intervalMs) {
        this.blend = blend;
        this.broadcaster = broadcaster;
        if (intervalMs > 0) {
            this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "rescore-coalescer");
                t.setDaemon(true);
                return t;
            });
            this.scheduler.scheduleWithFixedDelay(this::flush, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
            log.info("re-scoring coalesced to at most one run per room per {} ms", intervalMs);
        } else {
            // Interval 0 disables the background thread; flush() is then the
            // caller's job. Used by the unit tests.
            this.scheduler = null;
        }
    }

    /** Records that a room's ratings changed. Cheap and idempotent. */
    public void mark(String roomCode) {
        dirty.add(roomCode);
    }

    /** Re-scores every dirty room once. Runs on the scheduler thread. */
    public void flush() {
        for (String roomCode : dirty) {
            dirty.remove(roomCode);
            try {
                rescore(roomCode);
                failures.remove(roomCode);
            } catch (Exception e) {
                int count = failures.merge(roomCode, 1, Integer::sum);
                if (count >= MAX_CONSECUTIVE_FAILURES) {
                    failures.remove(roomCode);
                    log.error("giving up re-scoring room {} after {} attempts: {}",
                            roomCode, count, e.getMessage());
                } else {
                    dirty.add(roomCode); // retry on the next flush
                    if (count == 1) {
                        log.warn("re-scoring room {} failed, will retry: {}", roomCode, e.getMessage());
                    }
                }
            }
        }
    }

    /** One full re-score: progress push, ranking push, auto-decision check. */
    private void rescore(String roomCode) {
        broadcaster.send(roomCode, "RATING_PROGRESS", blend.progress(roomCode));

        List<ScoredFood> scored = blend.recomputeRecommendations(roomCode);
        if (!scored.isEmpty()) {
            broadcaster.send(roomCode, "RECOMMENDATIONS_GENERATED", blend.storedRecommendations(roomCode));
        }

        if (blend.everyoneHasFinished(roomCode)) {
            blend.finalise(roomCode, "AUTO").ifPresent(decision -> {
                Map<String, Object> payload = new LinkedHashMap<>(decision);
                payload.put("trigger", "ALL_PLAYERS_RATED");
                broadcaster.send(roomCode, "DECISION_FINALIZED", payload);
            });
        }
    }

    @PreDestroy
    void shutdown() {
        if (scheduler != null) {
            // One last flush so a decision reached just before shutdown is
            // not left unannounced.
            scheduler.shutdown();
            flush();
        }
    }
}

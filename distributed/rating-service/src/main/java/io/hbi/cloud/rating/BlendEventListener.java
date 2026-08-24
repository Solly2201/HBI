package io.hbi.cloud.rating;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * The asynchronous half of HBI Microservices.
 *
 *   room-service --(hbi.room-events)--> here --> STOMP --> browsers
 *   this service --(hbi.ratings)------> here --> mark dirty --> RescoreCoalescer
 *                                         |--> STOMP --> browsers
 */
@Component
public class BlendEventListener {

    private static final Logger log = LoggerFactory.getLogger(BlendEventListener.class);

    private final BlendService blend;
    private final RoomBroadcaster broadcaster;
    private final RescoreCoalescer coalescer;

    public BlendEventListener(BlendService blend, RoomBroadcaster broadcaster,
                              RescoreCoalescer coalescer) {
        this.blend = blend;
        this.broadcaster = broadcaster;
        this.coalescer = coalescer;
    }

    /** Lobby changes produced by the room service. */
    @KafkaListener(topics = "${hbi.kafka.room-events-topic}", groupId = "${hbi.kafka.group-id}")
    public void onRoomEvent(Map<String, Object> event) {
        String roomCode = str(event.get("roomId"));
        String type = str(event.get("eventType"));
        if (roomCode == null || type == null) {
            log.warn("ignoring malformed room event: {}", event);
            return;
        }
        log.info("kafka <- {} for room {}", type, roomCode);

        // The room service garbage-collected this room: drop everything this
        // service stored for it. Idempotent — deleting nothing is fine — so
        // replays and retries are harmless. Nothing is broadcast: the room is
        // gone and nobody should be subscribed.
        if ("ROOM_DELETED".equals(type)) {
            blend.purgeRoom(roomCode);
            return;
        }

        broadcaster.send(roomCode, type, event);
    }

    /**
     * A rating landed, or a player blended early. The raw event is forwarded
     * to the room's subscribers immediately; the expensive part — progress,
     * re-scoring, and the everyone-has-finished check — is only *marked* here
     * and executed by the {@link RescoreCoalescer}, so a burst of events
     * costs one re-score per flush window instead of one per event.
     */
    @KafkaListener(topics = "${hbi.kafka.ratings-topic}", groupId = "${hbi.kafka.group-id}")
    public void onRatingSubmitted(Map<String, Object> event) {
        String roomCode = str(event.get("roomId"));
        if (roomCode == null) {
            log.warn("ignoring malformed rating event: {}", event);
            return;
        }
        // The topic also carries DECISION_FINALIZED, which exists for the room
        // service (it marks the room DECIDED). Scoring only reacts to ratings
        // and early finishes.
        String type = str(event.get("eventType"));
        boolean scoringEvent = type == null
                || "RATING_SUBMITTED".equals(type) || "PLAYER_FINISHED".equals(type);
        if (!scoringEvent) {
            return;
        }
        String label = type == null ? "RATING_SUBMITTED" : type;
        log.info("kafka <- {} for room {}", label, roomCode);

        // No blanket catch here: a failure propagates to the container's
        // DefaultErrorHandler, which retries a bounded number of times and
        // then parks the record on the dead letter topic (KafkaErrorConfig).
        broadcaster.send(roomCode, label, event);
        coalescer.mark(roomCode);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}

package io.hbi.cloud.rating;

import io.hbi.cloud.rating.RecommendationEngine.ScoredFood;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The asynchronous half of HBI Microservices.
 *
 *   room-service --(hbi.room-events)--> here --> STOMP --> browsers
 *   this service --(hbi.ratings)------> here --> scoring --> STOMP --> browsers
 */
@Component
public class BlendEventListener {

    private static final Logger log = LoggerFactory.getLogger(BlendEventListener.class);

    private final BlendService blend;
    private final RoomBroadcaster broadcaster;

    public BlendEventListener(BlendService blend, RoomBroadcaster broadcaster) {
        this.blend = blend;
        this.broadcaster = broadcaster;
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
     * A rating landed, or a player blended early. Either way: re-score the
     * room, push the new ranking, and if every active player has now finished,
     * lock the answer in.
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

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}

package io.hbi.cloud.rating;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Emits RATING_SUBMITTED.
 *
 * Writing a rating and re-scoring the room are deliberately decoupled: the HTTP
 * call returns as soon as the rating is stored, and the decision engine picks
 * the event up asynchronously. That is the one place Kafka genuinely earns its
 * place in HBI Cloud.
 */
@Component
public class RatingEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(RatingEventPublisher.class);

    private final KafkaTemplate<String, Object> kafka;
    private final String topic;

    public RatingEventPublisher(KafkaTemplate<String, Object> kafka,
                                @Value("${hbi.kafka.ratings-topic}") String topic) {
        this.kafka = kafka;
        this.topic = topic;
    }

    public void ratingSubmitted(String roomCode, Long userId, Long restaurantId, Integer score) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventType", "RATING_SUBMITTED");
        event.put("roomId", roomCode);
        event.put("userId", userId);
        event.put("restaurantId", restaurantId);
        event.put("score", score);
        event.put("occurredAt", Instant.now().toString());

        kafka.send(topic, roomCode, event);
        log.info("published RATING_SUBMITTED room={} user={} restaurant={}", roomCode, userId, restaurantId);
    }

    /**
     * Announces that a room has decided. The room service consumes this and
     * moves the room to DECIDED — the rating service must not write room state
     * itself. Same topic and key as the rating events, so it is ordered after
     * the rating that triggered it.
     */
    public void decisionFinalized(String roomCode, Long restaurantId, String decidedBy) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventType", "DECISION_FINALIZED");
        event.put("roomId", roomCode);
        event.put("restaurantId", restaurantId);
        event.put("decidedBy", decidedBy);
        event.put("occurredAt", Instant.now().toString());

        kafka.send(topic, roomCode, event);
        log.info("published DECISION_FINALIZED room={} restaurant={}", roomCode, restaurantId);
    }
}

package io.hbi.cloud.rating;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Pushes one envelope shape to /topic/rooms/{roomCode} — on every
 * rating-service instance, not just this one.
 *
 * The STOMP broker is in-memory, so each instance can only reach the browsers
 * connected to itself; across replicas that would split one room over several
 * brokers and leave half the players without events. Hence a shared fan-out
 * hop: {@link #send} PUBLISHES the envelope to a Redis pub/sub channel instead
 * of delivering it, and every instance — including this one — receives the
 * publish through its subscription ({@link RedisFanoutConfig}) and hands it to
 * its own local broker via {@link #deliverLocally}. Each browser is connected
 * to exactly one instance, so each event arrives exactly once.
 *
 * Redis carries nothing but these in-flight frames: no business state, no
 * sessions, nothing durable. If Redis is down the publish fails fast and the
 * envelope is delivered locally instead — exactly the single-instance
 * behaviour this replaces, so a Redis outage degrades real-time delivery to
 * instance-local rather than breaking anything. Ratings, Kafka and REST are
 * untouched by it either way.
 */
@Component
public class RoomBroadcaster {

    /** One channel for all rooms; the envelope's roomId keeps rooms apart. */
    public static final String CHANNEL = "hbi.ws.rooms";

    private static final Logger log = LoggerFactory.getLogger(RoomBroadcaster.class);
    private static final TypeReference<LinkedHashMap<String, Object>> ENVELOPE_TYPE =
            new TypeReference<>() {};

    private final SimpMessagingTemplate messaging;
    private final StringRedisTemplate redis;
    private final ObjectMapper json;

    public RoomBroadcaster(SimpMessagingTemplate messaging, StringRedisTemplate redis,
                           ObjectMapper json) {
        this.messaging = messaging;
        this.redis = redis;
        this.json = json;
    }

    public void send(String roomCode, String type, Object payload) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", type);
        envelope.put("roomId", roomCode);
        envelope.put("payload", payload);
        envelope.put("timestamp", Instant.now().toString());

        try {
            redis.convertAndSend(CHANNEL, json.writeValueAsString(envelope));
            log.info("ws -> room {} : {}", roomCode, type);
        } catch (Exception e) {
            // Redis unreachable (or the payload failed to serialize, which a
            // local delivery at least surfaces to this instance's clients).
            // Degrade to what a single instance always did: deliver to the
            // browsers connected here and carry on.
            log.warn("fan-out publish failed ({}), delivering room {} : {} locally only",
                    e.getMessage(), roomCode, type);
            deliverLocally(envelope);
        }
    }

    /** A frame arrived over the fan-out channel: hand it to local browsers. */
    void onFanoutMessage(String body) {
        Map<String, Object> envelope;
        try {
            envelope = json.readValue(body, ENVELOPE_TYPE);
        } catch (Exception e) {
            log.warn("dropping unparseable fan-out frame: {}", e.getMessage());
            return;
        }
        if (!(envelope.get("roomId") instanceof String roomCode) || roomCode.isBlank()) {
            log.warn("dropping fan-out frame without a roomId");
            return;
        }
        deliverLocally(envelope);
    }

    private void deliverLocally(Map<String, Object> envelope) {
        messaging.convertAndSend("/topic/rooms/" + envelope.get("roomId"), envelope);
    }
}

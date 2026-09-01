package io.hbi.cloud.room;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Publishes lobby changes to Kafka. The rating service consumes this topic and
 * fans the events out to the browsers over STOMP, so the room service never has
 * to know that WebSockets exist.
 */
@Component
public class RoomEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(RoomEventPublisher.class);

    private final KafkaTemplate<String, Object> kafka;
    private final String topic;

    public RoomEventPublisher(KafkaTemplate<String, Object> kafka,
                              @Value("${hbi.kafka.room-events-topic}") String topic) {
        this.kafka = kafka;
        this.topic = topic;
    }

    /**
     * @param eventType one of ROOM_CREATED, USER_JOINED, USER_LEFT, ROOM_STATE_CHANGED
     */
    public void publish(String eventType, Room room, Long userId, String displayName) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventType", eventType);
        event.put("roomId", room.getCode());
        event.put("roomCode", room.getCode());
        event.put("status", room.getStatus().name());
        event.put("hostUserId", room.getHostUserId());
        event.put("userId", userId);
        event.put("displayName", displayName);
        event.put("occurredAt", Instant.now().toString());

        // Keying by room code keeps every event for one room on one partition,
        // which is what preserves join/leave ordering for the clients.
        kafka.send(topic, room.getCode(), event);
        log.info("published {} for room {}", eventType, room.getCode());
    }
}

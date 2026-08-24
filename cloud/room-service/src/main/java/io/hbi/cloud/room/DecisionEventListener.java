package io.hbi.cloud.room;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * Closes the loop on a finished blend.
 *
 * The decision itself is made in the rating service (its Kafka consumer
 * auto-finalises once everyone has rated), but room state belongs to this
 * service. Without this listener a room whose blend had finished stayed in
 * RATING forever and kept admitting new players.
 */
@Component
public class DecisionEventListener {

    private static final Logger log = LoggerFactory.getLogger(DecisionEventListener.class);

    private final RoomRepository rooms;
    private final RoomEventPublisher events;

    public DecisionEventListener(RoomRepository rooms, RoomEventPublisher events) {
        this.rooms = rooms;
        this.events = events;
    }

    @KafkaListener(topics = "${hbi.kafka.ratings-topic}", groupId = "${hbi.kafka.consumer-group-id}")
    @Transactional
    public void onRatingEvent(Map<String, Object> event) {
        // The topic mostly carries RATING_SUBMITTED, which is not our concern.
        if (!"DECISION_FINALIZED".equals(str(event.get("eventType")))) {
            return;
        }
        String code = str(event.get("roomId"));
        if (code == null) {
            log.warn("ignoring malformed decision event: {}", event);
            return;
        }

        rooms.findByCode(code).ifPresentOrElse(room -> {
            if (room.getStatus() == Room.Status.DECIDED) {
                return; // replay or duplicate; nothing to do
            }
            room.setStatus(Room.Status.DECIDED);
            rooms.save(room);
            log.info("room {} marked DECIDED (blend finished)", code);
            events.publish("ROOM_STATE_CHANGED", room, room.getHostUserId(), null);
        }, () -> log.warn("decision event for unknown room {}", code));
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}

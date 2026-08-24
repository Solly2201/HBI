package io.hbi.cloud.rating;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Pushes one envelope shape to /topic/rooms/{roomCode}. */
@Component
public class RoomBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(RoomBroadcaster.class);

    private final SimpMessagingTemplate messaging;

    public RoomBroadcaster(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    public void send(String roomCode, String type, Object payload) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("type", type);
        envelope.put("roomId", roomCode);
        envelope.put("payload", payload);
        envelope.put("timestamp", Instant.now().toString());

        messaging.convertAndSend("/topic/rooms/" + roomCode, envelope);
        log.info("ws -> room {} : {}", roomCode, type);
    }
}

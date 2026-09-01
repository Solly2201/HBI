package io.hbi.cloud.rating;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The fan-out contract: send() publishes to the shared Redis channel and does
 * NOT touch the local broker (delivery happens when the publish comes back
 * through the subscription, on every instance exactly once); a failed publish
 * degrades to instance-local delivery; received frames go to their own room's
 * topic and nowhere else; garbage frames are dropped without harm.
 */
class RoomBroadcasterTest {

    private SimpMessagingTemplate messaging;
    private StringRedisTemplate redis;
    private RoomBroadcaster broadcaster;

    @BeforeEach
    void setUp() {
        messaging = mock(SimpMessagingTemplate.class);
        redis = mock(StringRedisTemplate.class);
        broadcaster = new RoomBroadcaster(messaging, redis, new ObjectMapper());
    }

    @Test
    @SuppressWarnings("unchecked")
    void sendPublishesToTheChannelAndNotToTheLocalBroker() {
        broadcaster.send("HBIROOM", "RATING_PROGRESS", Map.of("done", 1));

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(redis).convertAndSend(eq(RoomBroadcaster.CHANNEL), body.capture());
        assertThat(body.getValue())
                .contains("\"type\":\"RATING_PROGRESS\"")
                .contains("\"roomId\":\"HBIROOM\"");
        verifyNoInteractions(messaging);
    }

    @Test
    void aFailedPublishFallsBackToLocalDelivery() {
        doThrow(new RedisConnectionFailureException("redis is down"))
                .when(redis).convertAndSend(anyString(), anyString());

        broadcaster.send("HBIROOM", "RATING_PROGRESS", Map.of("done", 1));

        verify(messaging).convertAndSend(eq("/topic/rooms/HBIROOM"), any(Map.class));
    }

    @Test
    void aReceivedFrameIsDeliveredToItsOwnRoomOnly() {
        broadcaster.onFanoutMessage(
                "{\"type\":\"USER_JOINED\",\"roomId\":\"HBI0001\",\"payload\":{}}");
        broadcaster.onFanoutMessage(
                "{\"type\":\"USER_JOINED\",\"roomId\":\"HBI0002\",\"payload\":{}}");

        verify(messaging).convertAndSend(eq("/topic/rooms/HBI0001"), any(Map.class));
        verify(messaging).convertAndSend(eq("/topic/rooms/HBI0002"), any(Map.class));
        verify(messaging, never()).convertAndSend(eq("/topic/rooms/HBI0003"), any(Map.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void whatSendPublishesIsWhatAnotherInstanceDelivers() {
        // Round trip: instance A publishes, instance B receives the frame and
        // hands the same envelope to its local broker.
        broadcaster.send("HBIROOM", "DECISION_FINALIZED", Map.of("foodId", 7));
        ArgumentCaptor<String> wire = ArgumentCaptor.forClass(String.class);
        verify(redis).convertAndSend(eq(RoomBroadcaster.CHANNEL), wire.capture());

        SimpMessagingTemplate otherMessaging = mock(SimpMessagingTemplate.class);
        RoomBroadcaster otherInstance = new RoomBroadcaster(otherMessaging,
                mock(StringRedisTemplate.class), new ObjectMapper());
        otherInstance.onFanoutMessage(wire.getValue());

        ArgumentCaptor<Map<String, Object>> delivered = ArgumentCaptor.forClass(Map.class);
        verify(otherMessaging).convertAndSend(eq("/topic/rooms/HBIROOM"), delivered.capture());
        assertThat(delivered.getValue())
                .containsEntry("type", "DECISION_FINALIZED")
                .containsEntry("roomId", "HBIROOM");
        assertThat((Map<String, Object>) delivered.getValue().get("payload"))
                .containsEntry("foodId", 7);
    }

    @Test
    void garbageFramesAreDroppedWithoutTouchingTheBroker() {
        broadcaster.onFanoutMessage("not json at all");
        broadcaster.onFanoutMessage("{\"type\":\"X\",\"payload\":{}}"); // no roomId
        broadcaster.onFanoutMessage("{\"type\":\"X\",\"roomId\":\"\",\"payload\":{}}");

        verifyNoInteractions(messaging);
    }
}

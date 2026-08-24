package io.hbi.cloud.rating;

import io.lettuce.core.ClientOptions;
import org.springframework.boot.autoconfigure.data.redis.LettuceClientConfigurationBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;

/**
 * Wires the Redis pub/sub side of the WebSocket fan-out (see
 * {@link RoomBroadcaster}). Every rating-service instance subscribes to the
 * one fan-out channel and relays each frame to its own in-memory STOMP broker.
 *
 * Redis here is ephemeral plumbing, not a data store: if it restarts, nothing
 * is lost that mattered for longer than the frame's flight time, and the
 * listener container re-subscribes on its own (it retries the connection
 * every few seconds until Redis is back).
 */
@Configuration
public class RedisFanoutConfig {

    @Bean
    RedisMessageListenerContainer fanoutListenerContainer(RedisConnectionFactory connectionFactory,
                                                          RoomBroadcaster broadcaster) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(
                (message, pattern) ->
                        broadcaster.onFanoutMessage(new String(message.getBody(), StandardCharsets.UTF_8)),
                new ChannelTopic(RoomBroadcaster.CHANNEL));
        return container;
    }

    /**
     * Fail fast while Redis is down instead of queueing commands until the
     * client timeout: the publisher's fallback (deliver locally) should kick
     * in immediately, not stall the Kafka listener or the re-score thread.
     * Auto-reconnect stays on, so recovery needs no intervention.
     */
    @Bean
    LettuceClientConfigurationBuilderCustomizer fanoutFailFast() {
        return builder -> builder.clientOptions(ClientOptions.builder()
                .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                .build());
    }
}

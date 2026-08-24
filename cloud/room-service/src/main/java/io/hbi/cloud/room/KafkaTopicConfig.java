package io.hbi.cloud.room;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

/** Declares the topic this service owns so it exists on first boot. */
@Configuration
public class KafkaTopicConfig {

    @Bean
    NewTopic roomEventsTopic(@Value("${hbi.kafka.room-events-topic}") String topic) {
        // Three partitions, matching the rating service's declaration: events
        // are keyed by room code, so per-room ordering survives while up to
        // three consumers share the group.
        return TopicBuilder.name(topic).partitions(3).replicas(1).build();
    }
}

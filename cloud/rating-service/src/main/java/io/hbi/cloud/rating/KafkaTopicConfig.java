package io.hbi.cloud.rating;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaTopicConfig {

    @Bean
    NewTopic ratingsTopic(@Value("${hbi.kafka.ratings-topic}") String topic) {
        return TopicBuilder.name(topic).partitions(1).replicas(1).build();
    }

    /**
     * Declared here too so the consumer can start even if the room service has
     * not booted yet.
     */
    @Bean
    NewTopic roomEventsTopic(@Value("${hbi.kafka.room-events-topic}") String topic) {
        return TopicBuilder.name(topic).partitions(1).replicas(1).build();
    }

    /**
     * Dead letter topics: where a record lands after bounded retries fail.
     * One per source topic, mirroring the source partition count so the
     * recoverer can keep the original partition number.
     */
    @Bean
    NewTopic ratingsDeadLetterTopic(@Value("${hbi.kafka.ratings-topic}") String topic) {
        return TopicBuilder.name(topic + ".DLT").partitions(1).replicas(1).build();
    }

    @Bean
    NewTopic roomEventsDeadLetterTopic(@Value("${hbi.kafka.room-events-topic}") String topic) {
        return TopicBuilder.name(topic + ".DLT").partitions(1).replicas(1).build();
    }
}

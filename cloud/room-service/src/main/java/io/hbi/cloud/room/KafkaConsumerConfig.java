package io.hbi.cloud.room;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Error policy for this service's one listener (DecisionEventListener).
 *
 * A record that cannot be handled is retried twice and then skipped with a
 * log line. No dead letter topic here: the rating service's consumer group
 * already parks unreadable records from this topic on hbi.ratings.DLT, and a
 * second copy from this group would only duplicate it.
 */
@Configuration
public class KafkaConsumerConfig {

    @Bean
    DefaultErrorHandler kafkaErrorHandler() {
        return new DefaultErrorHandler(new FixedBackOff(1000L, 2L));
    }
}

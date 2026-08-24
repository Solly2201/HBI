package io.hbi.cloud.rating;

import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.Serializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.serializer.DelegatingByTypeSerializer;
import org.springframework.kafka.support.serializer.JsonSerializer;
import org.springframework.util.backoff.FixedBackOff;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What happens when a Kafka record cannot be processed.
 *
 * Without this, a record the consumer cannot deserialize is redelivered
 * forever: the offset never advances, the partition is wedged, and the logs
 * flood. With it, a failing record is retried a bounded number of times and
 * then parked on {@code <topic>.DLT}, and the consumer moves on to the next
 * record.
 *
 * Deserialization failures skip the retries entirely (retrying cannot make a
 * record parseable) and go straight to the dead letter topic.
 */
@Configuration
public class KafkaErrorConfig {

    /**
     * Picked up by Spring Boot's listener container auto-configuration: retry
     * twice with a one-second pause (three attempts in total), then hand the
     * record to the dead letter topic and continue with the next offset.
     *
     * The publishing template is built here as a local object, deliberately
     * NOT as a bean: a KafkaTemplate bean would make Boot's auto-configured
     * {@code KafkaTemplate<String, Object>} (used by the event publishers)
     * back off. A failed record's key/value may be raw bytes (deserialization
     * failed) or the parsed object (the listener threw), so the serializer is
     * chosen per record by type.
     */
    @Bean
    DefaultErrorHandler kafkaErrorHandler(
            @Value("${spring.kafka.bootstrap-servers}") String bootstrapServers) {
        Map<String, Object> props = Map.of(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);

        Map<Class<?>, Serializer<?>> delegates = new LinkedHashMap<>();
        delegates.put(byte[].class, new ByteArraySerializer());
        delegates.put(String.class, new StringSerializer());
        delegates.put(Object.class, new JsonSerializer<>());

        KafkaTemplate<Object, Object> deadLetterTemplate = new KafkaTemplate<>(
                new DefaultKafkaProducerFactory<>(props,
                        new DelegatingByTypeSerializer(delegates, true),
                        new DelegatingByTypeSerializer(delegates, true)));

        // Explicit destination: <topic>.DLT, same partition. (This version's
        // default resolver would use a "-dlt" suffix instead.)
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(deadLetterTemplate,
                (record, ex) -> new org.apache.kafka.common.TopicPartition(
                        record.topic() + ".DLT", record.partition()));
        return new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 2L));
    }
}

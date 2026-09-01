package io.hbi.cloud.gateway;

import org.springframework.cloud.gateway.config.HttpClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * Makes the gateway survive backend containers being replaced.
 *
 * Reactor Netty's DNS resolver caches lookups for the TTL Docker's embedded
 * DNS advertises (minutes). When Compose recreates a service the container
 * gets a new address, and the gateway kept dialing the dead one for the whole
 * cached TTL — every request to that service failed with "connection refused"
 * until the gateway itself was restarted. Capping the cache TTL bounds that
 * outage to a few seconds, after which the next lookup returns the live
 * address. Negative answers are cached even shorter so a service that is still
 * starting is retried quickly.
 *
 * The connection pool settings in application.yml bound the matching problem
 * on the pooled side (idle connections to an address that no longer exists).
 */
@Configuration
public class GatewayHttpClientConfig {

    @Bean
    HttpClientCustomizer dnsCacheTtlCap() {
        return httpClient -> httpClient.resolver(spec -> spec
                .cacheMaxTimeToLive(Duration.ofSeconds(5))
                .cacheNegativeTimeToLive(Duration.ofSeconds(1)));
    }
}

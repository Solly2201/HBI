package io.hbi.cloud.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * Throttles anonymous session creation, and nothing else.
 *
 * POST /api/users/session is the one unauthenticated write in the system, so
 * it is the one endpoint a bored script can spam for free rows and free JWTs.
 * Every other endpoint already requires a token that this endpoint issues, so
 * limiting the tap is enough — no other route is rate-limited.
 *
 * The caller key is the last X-Forwarded-For hop when present, otherwise the
 * socket address. The last hop is the one appended by our own nginx frontend
 * ($proxy_add_x_forwarded_for), so a client cannot dodge the limit by sending
 * a forged X-Forwarded-For of its own — its forgery is left of the value
 * nginx appends. When the gateway is reached directly (local development),
 * there is no XFF and the socket address is used.
 */
@Component
public class SessionRateLimitFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(SessionRateLimitFilter.class);
    private static final String SESSION_PATH = "/api/users/session";

    private final SessionRateLimiter limiter;

    public SessionRateLimitFilter(
            @Value("${hbi.rate-limit.session.capacity:60}") int capacity,
            @Value("${hbi.rate-limit.session.refill-per-minute:60}") int refillPerMinute) {
        this.limiter = new SessionRateLimiter(capacity, refillPerMinute);
        log.info("session rate limit: burst {} / refill {} per minute per caller", capacity, refillPerMinute);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        if (!HttpMethod.POST.equals(request.getMethod())
                || !SESSION_PATH.equals(request.getURI().getPath())) {
            return chain.filter(exchange);
        }

        String key = callerKey(request);
        if (limiter.tryAcquire(key, System.currentTimeMillis())) {
            return chain.filter(exchange);
        }

        log.info("throttling session creation from {}", key);
        exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        exchange.getResponse().getHeaders().add("Content-Type", "application/json");
        byte[] body = "{\"status\":429,\"message\":\"Too many sessions - slow down and try again shortly.\"}"
                .getBytes(StandardCharsets.UTF_8);
        return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(body)));
    }

    private String callerKey(ServerHttpRequest request) {
        String xff = request.getHeaders().getFirst("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] hops = xff.split(",");
            return hops[hops.length - 1].trim();
        }
        InetSocketAddress remote = request.getRemoteAddress();
        return remote == null ? "unknown" : remote.getAddress().getHostAddress();
    }

    @Override
    public int getOrder() {
        // Ahead of JwtAuthFilter (-100): the throttle answers before any other
        // work is done for the request.
        return -110;
    }
}

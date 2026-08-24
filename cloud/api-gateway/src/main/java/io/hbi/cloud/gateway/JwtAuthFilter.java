package io.hbi.cloud.gateway;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * The single place HBI Cloud checks who is calling.
 *
 * Every /api/** request must carry a valid Bearer token, except the handful of
 * public endpoints listed below. Downstream services never parse the JWT
 * themselves; they read the X-User-Id / X-User-Name headers stamped here.
 *
 * Any such headers arriving from outside are stripped first, so a client cannot
 * simply assert an identity.
 */
@Component
public class JwtAuthFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/users/session",
            "/actuator/health",
            "/actuator/info",
            "/actuator/metrics");

    /** Browsing the catalogue does not require an account. */
    private static final String RESTAURANTS_PREFIX = "/api/restaurants";

    private final SecretKey key;

    public JwtAuthFilter(@Value("${hbi.jwt.secret}") String secret) {
        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 characters long");
        }
        this.key = Keys.hmacShaKeyFor(raw);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getURI().getPath();

        // Never let a caller supply its own identity headers.
        ServerHttpRequest cleaned = request.mutate()
                .headers(h -> {
                    h.remove("X-User-Id");
                    h.remove("X-User-Name");
                })
                .build();

        if (isPublic(path, request.getMethod())) {
            return chain.filter(exchange.mutate().request(cleaned).build());
        }

        // The WebSocket handshake cannot carry an Authorization header, so the
        // token rides in the query string. It is checked here, before the
        // upgrade is proxied: once the gateway has accepted an upgrade, a
        // downstream rejection no longer closes the client's socket.
        if (path.startsWith("/ws")) {
            String wsToken = queryValue(request.getURI().getQuery(), "token");
            if (wsToken == null || !isValid(wsToken)) {
                return reject(exchange, "Invalid or missing WebSocket token");
            }
            return chain.filter(exchange.mutate().request(cleaned).build());
        }

        String token = bearerToken(cleaned);
        if (token == null) {
            return reject(exchange, "Missing Authorization bearer token");
        }

        Claims claims;
        try {
            claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            log.debug("rejecting {} {}: {}", request.getMethod(), path, e.getMessage());
            return reject(exchange, "Invalid or expired token");
        }

        String userId = claims.getSubject();
        String userName = claims.get("name", String.class);
        ServerHttpRequest authenticated = cleaned.mutate()
                .header("X-User-Id", userId)
                .header("X-User-Name", userName == null ? "" : userName)
                .build();

        return chain.filter(exchange.mutate().request(authenticated).build());
    }

    private boolean isPublic(String path, HttpMethod method) {
        if (PUBLIC_PATHS.contains(path)) {
            return true;
        }
        // The SockJS capability probe carries no data and runs before a token
        // is attached; every other /ws path is checked in filter().
        if (path.equals("/ws/info")) {
            return true;
        }
        return HttpMethod.GET.equals(method) && path.startsWith(RESTAURANTS_PREFIX);
    }

    private boolean isValid(String token) {
        try {
            Jwts.parser().verifyWith(key).build().parseSignedClaims(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Reads one parameter out of a raw query string. */
    private String queryValue(String query, String name) {
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) {
                String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
                return value.isBlank() ? null : value;
            }
        }
        return null;
    }

    private String bearerToken(ServerHttpRequest request) {
        String header = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return null;
        }
        String token = header.substring(7).trim();
        return token.isEmpty() ? null : token;
    }

    private Mono<Void> reject(ServerWebExchange exchange, String reason) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        exchange.getResponse().getHeaders().add("Content-Type", "application/json");
        byte[] body = ("{\"status\":401,\"message\":\"" + reason + "\"}").getBytes(StandardCharsets.UTF_8);
        return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(body)));
    }

    @Override
    public int getOrder() {
        // Ahead of the routing filter so identity is settled before proxying.
        return -100;
    }
}

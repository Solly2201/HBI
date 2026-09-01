package io.hbi.cloud.rating;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.server.HandshakeInterceptor;

import javax.crypto.SecretKey;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * STOMP over WebSocket, using Spring's in-memory simple broker.
 *
 * This replaces HBI Web's Socket.IO layer with a mechanism that fits the
 * microservice model: services publish domain events to Kafka, and this hub is
 * the single place that translates them into browser pushes.
 *
 * Clients connect to /ws?token=<jwt> and subscribe to /topic/rooms/{roomCode}.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketConfig.class);

    private final SecretKey key;

    public WebSocketConfig(@Value("${hbi.jwt.secret}") String secret) {
        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 characters long");
        }
        this.key = Keys.hmacShaKeyFor(raw);
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Native WebSocket - what the browser and the smoke test actually use.
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .addInterceptors(new JwtHandshakeInterceptor());

        // SockJS fallback for networks that block WebSocket upgrades.
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .addInterceptors(new JwtHandshakeInterceptor())
                .withSockJS();
    }

    /**
     * The gateway proxies /ws straight through, so the token is checked here.
     * Browsers cannot set headers on a WebSocket handshake, hence the query
     * parameter.
     */
    private final class JwtHandshakeInterceptor implements HandshakeInterceptor {

        @Override
        public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                       WebSocketHandler wsHandler, Map<String, Object> attributes) {
            String token = firstQueryValue(request.getURI().getQuery(), "token");
            if (token == null) {
                log.debug("rejecting websocket handshake: no token");
                return false;
            }
            try {
                var claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
                attributes.put("userId", claims.getSubject());
                attributes.put("userName", claims.get("name", String.class));
                return true;
            } catch (Exception e) {
                log.debug("rejecting websocket handshake: {}", e.getMessage());
                return false;
            }
        }

        @Override
        public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Exception exception) {
        }

        private String firstQueryValue(String query, String name) {
            if (query == null) {
                return null;
            }
            for (String pair : query.split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0 && pair.substring(0, eq).equals(name)) {
                    return URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
                }
            }
            return null;
        }
    }
}

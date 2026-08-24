package io.hbi.cloud.rating;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.util.List;

/**
 * Reads room membership from the room service over REST.
 *
 * The rating service needs to know who is in a room in order to work out group
 * progress, but it must not read room_db directly — that is the whole point of
 * database-per-service. So it asks the owning service instead.
 */
@Component
public class RoomClient {

    private static final Logger log = LoggerFactory.getLogger(RoomClient.class);

    private final RestTemplate http;
    private final String baseUrl;

    public RoomClient(RestTemplateBuilder builder,
                      @Value("${hbi.services.room-service-url}") String baseUrl) {
        this.http = builder
                .connectTimeout(Duration.ofSeconds(3))
                .readTimeout(Duration.ofSeconds(5))
                .build();
        this.baseUrl = baseUrl;
    }

    public record Member(Long userId, String displayName, boolean host, boolean active) {
    }

    /** Active members of a room, or an empty list if the room service is unreachable. */
    public List<Member> activeMembers(String roomCode) {
        String url = baseUrl + "/api/rooms/" + roomCode + "/members";
        try {
            List<Member> all = http.exchange(url, HttpMethod.GET, null,
                    new ParameterizedTypeReference<List<Member>>() {
                    }).getBody();
            if (all == null) {
                return List.of();
            }
            return all.stream().filter(Member::active).toList();
        } catch (RestClientException e) {
            log.warn("could not read members for room {} from {}: {}", roomCode, url, e.getMessage());
            return List.of();
        }
    }
}

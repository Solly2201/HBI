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
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Duration;
import java.util.List;

/** Reads the restaurant catalogue from the restaurant service over REST. */
@Component
public class RestaurantClient {

    private static final Logger log = LoggerFactory.getLogger(RestaurantClient.class);

    private final RestTemplate http;
    private final String baseUrl;

    public RestaurantClient(RestTemplateBuilder builder,
                            @Value("${hbi.services.restaurant-service-url}") String baseUrl) {
        this.http = builder
                .connectTimeout(Duration.ofSeconds(3))
                .readTimeout(Duration.ofSeconds(5))
                .build();
        this.baseUrl = baseUrl;
    }

    public record RestaurantView(Long id, String name, String cuisine, String signatureDish,
                                 Integer avgCostForTwo, Double distanceKm, Double baseRating,
                                 String imageUrl, String area) {
    }

    /** Restaurants matching the group's combined appetite. */
    public List<RestaurantView> search(List<String> cuisines, Integer budget, Double maxDistanceKm) {
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(baseUrl + "/api/restaurants");
        if (cuisines != null && !cuisines.isEmpty()) {
            uri.queryParam("cuisine", String.join(",", cuisines));
        }
        if (budget != null) {
            uri.queryParam("budget", budget);
        }
        if (maxDistanceKm != null) {
            uri.queryParam("maxDistanceKm", maxDistanceKm);
        }
        return get(uri.toUriString());
    }

    public List<RestaurantView> byIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        String csv = ids.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse("");
        return get(baseUrl + "/api/restaurants?ids=" + csv);
    }

    private List<RestaurantView> get(String url) {
        try {
            List<RestaurantView> body = http.exchange(url, HttpMethod.GET, null,
                    new ParameterizedTypeReference<List<RestaurantView>>() {
                    }).getBody();
            return body == null ? List.of() : body;
        } catch (RestClientException e) {
            log.warn("restaurant lookup failed for {}: {}", url, e.getMessage());
            return List.of();
        }
    }
}

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

/** Reads the food catalogue from the food service over REST. */
@Component
public class FoodClient {

    private static final Logger log = LoggerFactory.getLogger(FoodClient.class);

    private final RestTemplate http;
    private final String baseUrl;

    public FoodClient(RestTemplateBuilder builder,
                      @Value("${hbi.services.food-service-url}") String baseUrl) {
        this.http = builder
                .connectTimeout(Duration.ofSeconds(3))
                .readTimeout(Duration.ofSeconds(5))
                .build();
        this.baseUrl = baseUrl;
    }

    public record FoodView(Long id, String name, String cuisine, String imageUrl) {
    }

    /** Food items matching the group's combined appetite. */
    public List<FoodView> search(List<String> cuisines) {
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(baseUrl + "/api/foods");
        if (cuisines != null && !cuisines.isEmpty()) {
            uri.queryParam("cuisine", String.join(",", cuisines));
        }
        return get(uri.toUriString());
    }

    public List<FoodView> byIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        String csv = ids.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse("");
        return get(baseUrl + "/api/foods?ids=" + csv);
    }

    private List<FoodView> get(String url) {
        try {
            List<FoodView> body = http.exchange(url, HttpMethod.GET, null,
                    new ParameterizedTypeReference<List<FoodView>>() {
                    }).getBody();
            return body == null ? List.of() : body;
        } catch (RestClientException e) {
            log.warn("food lookup failed for {}: {}", url, e.getMessage());
            return List.of();
        }
    }
}

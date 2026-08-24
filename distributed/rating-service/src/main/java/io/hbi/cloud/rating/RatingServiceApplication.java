package io.hbi.cloud.rating;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Rating / Decision service.
 *
 * Owns preferences, ratings, the recommendation scoring and the final decision,
 * and additionally hosts the STOMP-over-WebSocket hub that pushes updates to
 * every connected browser. Keeping the hub here (rather than in a sixth
 * service) is deliberate: it is the component that produces the events players
 * are waiting on.
 */
@SpringBootApplication
public class RatingServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(RatingServiceApplication.class, args);
    }
}

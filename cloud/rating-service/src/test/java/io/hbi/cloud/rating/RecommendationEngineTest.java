package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import io.hbi.cloud.rating.RecommendationEngine.ScoredRestaurant;
import io.hbi.cloud.rating.RestaurantClient.RestaurantView;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The scoring is the one piece of real logic in HBI Cloud, so it is worth
 * pinning down: the same inputs must always give the same answer.
 */
class RecommendationEngineTest {

    private final RecommendationEngine engine = new RecommendationEngine();

    private static RestaurantView restaurant(long id, String cuisine, int cost, double distance) {
        return new RestaurantView(id, "Place " + id, cuisine, "Dish " + id, cost, distance, 4.0,
                "/images/pizza.jpg", "Area");
    }

    private static Preference preference(long userId, List<String> cuisines, int budget, double distance) {
        Preference p = new Preference("HBITEST", userId);
        p.setCuisines(cuisines);
        p.setMaxBudget(budget);
        p.setMaxDistanceKm(distance);
        return p;
    }

    @Test
    void ranksTheBetterRatedRestaurantFirst() {
        List<RestaurantView> candidates = List.of(
                restaurant(1, "Indian", 400, 2.0),
                restaurant(2, "Indian", 400, 2.0));

        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 1L, 2),
                new Rating("HBITEST", 11L, 1L, 2),
                new Rating("HBITEST", 10L, 2L, 5),
                new Rating("HBITEST", 11L, 2L, 5));

        List<Preference> prefs = List.of(
                preference(10L, List.of("Indian"), 800, 5.0),
                preference(11L, List.of("Indian"), 800, 5.0));

        List<ScoredRestaurant> ranked = engine.score(candidates, ratings, prefs, 2);

        assertThat(ranked).hasSize(2);
        assertThat(ranked.get(0).restaurant().id()).isEqualTo(2L);
        assertThat(ranked.get(0).score()).isGreaterThan(ranked.get(1).score());
        assertThat(ranked.get(0).groupRating()).isEqualTo(1.0);
    }

    @Test
    void rewardsTheCuisineTheGroupActuallyAskedFor() {
        List<RestaurantView> candidates = List.of(
                restaurant(1, "Indian", 400, 2.0),
                restaurant(2, "Desserts", 400, 2.0));

        // Identical ratings, so only the cuisine preference can separate them.
        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 1L, 4),
                new Rating("HBITEST", 10L, 2L, 4));

        List<Preference> prefs = List.of(preference(10L, List.of("Indian"), 800, 5.0));

        List<ScoredRestaurant> ranked = engine.score(candidates, ratings, prefs, 1);

        assertThat(ranked.get(0).restaurant().id()).isEqualTo(1L);
        assertThat(ranked.get(0).cuisineFit()).isEqualTo(1.0);
        assertThat(ranked.get(1).cuisineFit()).isEqualTo(0.0);
    }

    @Test
    void penalisesRestaurantsOutsideBudgetAndRange() {
        List<RestaurantView> candidates = List.of(
                restaurant(1, "Italian", 300, 1.0),
                restaurant(2, "Italian", 2000, 20.0));

        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 1L, 3),
                new Rating("HBITEST", 10L, 2L, 3));

        List<Preference> prefs = List.of(preference(10L, List.of("Italian"), 500, 3.0));

        List<ScoredRestaurant> ranked = engine.score(candidates, ratings, prefs, 1);

        assertThat(ranked.get(0).restaurant().id()).isEqualTo(1L);
        assertThat(ranked.get(0).budgetFit()).isEqualTo(1.0);
        assertThat(ranked.get(1).budgetFit()).isEqualTo(0.0);
        assertThat(ranked.get(1).distanceFit()).isEqualTo(0.0);
    }

    @Test
    void isDeterministicAndBreaksTiesOnId() {
        List<RestaurantView> candidates = List.of(
                restaurant(7, "Chinese", 400, 2.0),
                restaurant(3, "Chinese", 400, 2.0));

        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 7L, 4),
                new Rating("HBITEST", 10L, 3L, 4));

        List<Preference> prefs = List.of(preference(10L, List.of("Chinese"), 800, 5.0));

        List<ScoredRestaurant> first = engine.score(candidates, ratings, prefs, 1);
        List<ScoredRestaurant> second = engine.score(candidates, ratings, prefs, 1);

        assertThat(first.get(0).score()).isEqualTo(second.get(0).score());
        // Everything is equal, so the lower id must win.
        assertThat(first.get(0).restaurant().id()).isEqualTo(3L);
    }

    @Test
    void handlesRestaurantsNobodyRatedYet() {
        List<RestaurantView> candidates = List.of(restaurant(1, "Mexican", 400, 2.0));
        List<Preference> prefs = List.of(preference(10L, List.of("Mexican"), 800, 5.0));

        List<ScoredRestaurant> ranked = engine.score(candidates, List.of(), prefs, 1);

        assertThat(ranked).hasSize(1);
        assertThat(ranked.get(0).groupRating()).isEqualTo(0.0);
        assertThat(ranked.get(0).ratingCount()).isZero();
        assertThat(ranked.get(0).score()).isGreaterThan(0.0); // still fits the filters
    }
}

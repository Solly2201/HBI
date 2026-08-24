package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import io.hbi.cloud.rating.FoodClient.FoodView;
import io.hbi.cloud.rating.RecommendationEngine.ScoredFood;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The scoring is the one piece of real logic in HBI Microservices, so it is
 * worth pinning down: the same inputs must always give the same answer, and
 * the answer must rank food items — nothing else.
 */
class RecommendationEngineTest {

    private final RecommendationEngine engine = new RecommendationEngine();

    private static FoodView food(long id, String cuisine) {
        return new FoodView(id, "Dish " + id, cuisine, "/images/pizza.jpg");
    }

    private static Preference preference(long userId, List<String> cuisines) {
        Preference p = new Preference("HBITEST", userId);
        p.setCuisines(cuisines);
        return p;
    }

    @Test
    void ranksTheBetterRatedFoodFirst() {
        List<FoodView> candidates = List.of(food(1, "Indian"), food(2, "Indian"));

        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 1L, 2),
                new Rating("HBITEST", 11L, 1L, 2),
                new Rating("HBITEST", 10L, 2L, 5),
                new Rating("HBITEST", 11L, 2L, 5));

        List<Preference> prefs = List.of(
                preference(10L, List.of("Indian")),
                preference(11L, List.of("Indian")));

        List<ScoredFood> ranked = engine.score(candidates, ratings, prefs, 2);

        assertThat(ranked).hasSize(2);
        assertThat(ranked.get(0).food().id()).isEqualTo(2L);
        assertThat(ranked.get(0).score()).isGreaterThan(ranked.get(1).score());
        assertThat(ranked.get(0).groupRating()).isEqualTo(1.0);
    }

    @Test
    void rewardsTheCuisineTheGroupActuallyAskedFor() {
        List<FoodView> candidates = List.of(food(1, "Indian"), food(2, "Desserts"));

        // Identical ratings, so only the cuisine preference can separate them.
        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 1L, 4),
                new Rating("HBITEST", 10L, 2L, 4));

        List<Preference> prefs = List.of(preference(10L, List.of("Indian")));

        List<ScoredFood> ranked = engine.score(candidates, ratings, prefs, 1);

        assertThat(ranked.get(0).food().id()).isEqualTo(1L);
        assertThat(ranked.get(0).cuisineFit()).isEqualTo(1.0);
        assertThat(ranked.get(1).cuisineFit()).isEqualTo(0.0);
    }

    @Test
    void coverageSeparatesWidelyRatedFoodFromANicheFavourite() {
        // Both foods average 5.0, but only one was rated by the whole group.
        List<FoodView> candidates = List.of(food(1, "Chinese"), food(2, "Chinese"));

        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 1L, 5),
                new Rating("HBITEST", 11L, 1L, 5),
                new Rating("HBITEST", 10L, 2L, 5));

        List<Preference> prefs = List.of(
                preference(10L, List.of("Chinese")),
                preference(11L, List.of("Chinese")));

        List<ScoredFood> ranked = engine.score(candidates, ratings, prefs, 2);

        assertThat(ranked.get(0).food().id()).isEqualTo(1L);
        assertThat(ranked.get(0).coverage()).isEqualTo(1.0);
        assertThat(ranked.get(1).coverage()).isEqualTo(0.5);
        assertThat(ranked.get(0).score()).isGreaterThan(ranked.get(1).score());
    }

    @Test
    void isDeterministicAndBreaksTiesOnId() {
        List<FoodView> candidates = List.of(food(7, "Chinese"), food(3, "Chinese"));

        List<Rating> ratings = List.of(
                new Rating("HBITEST", 10L, 7L, 4),
                new Rating("HBITEST", 10L, 3L, 4));

        List<Preference> prefs = List.of(preference(10L, List.of("Chinese")));

        List<ScoredFood> first = engine.score(candidates, ratings, prefs, 1);
        List<ScoredFood> second = engine.score(candidates, ratings, prefs, 1);

        assertThat(first.get(0).score()).isEqualTo(second.get(0).score());
        // Everything is equal, so the lower id must win.
        assertThat(first.get(0).food().id()).isEqualTo(3L);
    }

    @Test
    void handlesFoodsNobodyRatedYet() {
        List<FoodView> candidates = List.of(food(1, "Mexican"));
        List<Preference> prefs = List.of(preference(10L, List.of("Mexican")));

        List<ScoredFood> ranked = engine.score(candidates, List.of(), prefs, 1);

        assertThat(ranked).hasSize(1);
        assertThat(ranked.get(0).groupRating()).isEqualTo(0.0);
        assertThat(ranked.get(0).ratingCount()).isZero();
        assertThat(ranked.get(0).score()).isGreaterThan(0.0); // cuisine fit still counts
    }
}

package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import io.hbi.cloud.rating.FoodClient.FoodView;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Deterministic group scoring. No machine learning: the same inputs always
 * produce the same ranking, which makes the result explainable to the players
 * and easy to demonstrate.
 *
 * A food item's score blends three normalised (0..1) signals:
 *
 *   groupRating  how well the people who rated it liked it        weight 0.60
 *   cuisineFit   share of players who asked for that cuisine      weight 0.25
 *   coverage     share of players who actually rated it           weight 0.15
 *
 * Coverage matters more now that players may finish early: a dish only some of
 * the room ever saw should not outrank one everybody scored highly.
 *
 * Ties break on food id so the ordering is stable.
 */
@Component
public class RecommendationEngine {

    private static final double W_RATING = 0.60;
    private static final double W_CUISINE = 0.25;
    private static final double W_COVERAGE = 0.15;

    /** Highest score is at position 1. */
    public record ScoredFood(FoodView food,
                             double score,
                             double groupRating,
                             int ratingCount,
                             double cuisineFit,
                             double coverage) {
    }

    public List<ScoredFood> score(List<FoodView> candidates,
                                  List<Rating> ratings,
                                  List<Preference> preferences,
                                  int activeMemberCount) {

        Map<Long, List<Rating>> byFood = ratings.stream()
                .collect(Collectors.groupingBy(Rating::getFoodId));

        int voters = Math.max(activeMemberCount, 1);
        int prefCount = Math.max(preferences.size(), 1);

        // Lower-cased once so cuisine matching is not case sensitive.
        List<Set<String>> wantedCuisines = preferences.stream()
                .map(p -> p.cuisineList().stream()
                        .map(c -> c.toLowerCase(Locale.ROOT))
                        .collect(Collectors.toSet()))
                .toList();

        return candidates.stream()
                .map(f -> {
                    List<Rating> rs = byFood.getOrDefault(f.id(), List.of());

                    double groupRating = rs.isEmpty() ? 0.0
                            : rs.stream().mapToInt(Rating::getScore).average().orElse(0.0) / 5.0;
                    double coverage = (double) rs.size() / voters;

                    String cuisine = f.cuisine() == null ? "" : f.cuisine().toLowerCase(Locale.ROOT);
                    // A player who named no cuisine is happy with anything.
                    double cuisineFit = (double) wantedCuisines.stream()
                            .filter(set -> set.isEmpty() || set.contains(cuisine)).count() / prefCount;

                    double score = W_RATING * groupRating
                            + W_CUISINE * cuisineFit
                            + W_COVERAGE * clamp(coverage);

                    return new ScoredFood(f, round(score), round(groupRating), rs.size(),
                            round(cuisineFit), round(clamp(coverage)));
                })
                .sorted(Comparator.comparingDouble(ScoredFood::score).reversed()
                        .thenComparing(s -> s.food().id()))
                .toList();
    }

    private static double clamp(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}

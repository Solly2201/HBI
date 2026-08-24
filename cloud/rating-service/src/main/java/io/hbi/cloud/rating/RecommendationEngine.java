package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import io.hbi.cloud.rating.RestaurantClient.RestaurantView;
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
 * A restaurant's score blends five normalised (0..1) signals:
 *
 *   groupRating  how well the people who rated it liked it        weight 0.50
 *   cuisineFit   share of players who asked for that cuisine      weight 0.20
 *   budgetFit    share of players whose budget covers it          weight 0.12
 *   distanceFit  share of players willing to travel that far      weight 0.10
 *   coverage     share of players who actually rated it           weight 0.08
 *
 * Ties break on restaurant id so the ordering is stable.
 */
@Component
public class RecommendationEngine {

    private static final double W_RATING = 0.50;
    private static final double W_CUISINE = 0.20;
    private static final double W_BUDGET = 0.12;
    private static final double W_DISTANCE = 0.10;
    private static final double W_COVERAGE = 0.08;

    /** Highest score is at position 1. */
    public record ScoredRestaurant(RestaurantView restaurant,
                                   double score,
                                   double groupRating,
                                   int ratingCount,
                                   double cuisineFit,
                                   double budgetFit,
                                   double distanceFit,
                                   double coverage) {
    }

    public List<ScoredRestaurant> score(List<RestaurantView> candidates,
                                        List<Rating> ratings,
                                        List<Preference> preferences,
                                        int activeMemberCount) {

        Map<Long, List<Rating>> byRestaurant = ratings.stream()
                .collect(Collectors.groupingBy(Rating::getRestaurantId));

        int voters = Math.max(activeMemberCount, 1);
        int prefCount = Math.max(preferences.size(), 1);

        // Lower-cased once so cuisine matching is not case sensitive.
        List<Set<String>> wantedCuisines = preferences.stream()
                .map(p -> p.cuisineList().stream()
                        .map(c -> c.toLowerCase(Locale.ROOT))
                        .collect(Collectors.toSet()))
                .toList();

        return candidates.stream()
                .map(r -> {
                    List<Rating> rs = byRestaurant.getOrDefault(r.id(), List.of());

                    double groupRating = rs.isEmpty() ? 0.0
                            : rs.stream().mapToInt(Rating::getScore).average().orElse(0.0) / 5.0;
                    double coverage = (double) rs.size() / voters;

                    String cuisine = r.cuisine() == null ? "" : r.cuisine().toLowerCase(Locale.ROOT);
                    // A player who named no cuisine is happy with anything.
                    double cuisineFit = (double) wantedCuisines.stream()
                            .filter(set -> set.isEmpty() || set.contains(cuisine)).count() / prefCount;

                    double budgetFit = (double) preferences.stream()
                            .filter(p -> p.getMaxBudget() == null || r.avgCostForTwo() == null
                                    || r.avgCostForTwo() <= p.getMaxBudget()).count() / prefCount;

                    double distanceFit = (double) preferences.stream()
                            .filter(p -> p.getMaxDistanceKm() == null || r.distanceKm() == null
                                    || r.distanceKm() <= p.getMaxDistanceKm()).count() / prefCount;

                    double score = W_RATING * groupRating
                            + W_CUISINE * cuisineFit
                            + W_BUDGET * budgetFit
                            + W_DISTANCE * distanceFit
                            + W_COVERAGE * clamp(coverage);

                    return new ScoredRestaurant(r, round(score), round(groupRating), rs.size(),
                            round(cuisineFit), round(budgetFit), round(distanceFit), round(clamp(coverage)));
                })
                .sorted(Comparator.comparingDouble(ScoredRestaurant::score).reversed()
                        .thenComparing(s -> s.restaurant().id()))
                .toList();
    }

    private static double clamp(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}

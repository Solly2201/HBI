package io.hbi.cloud.restaurant;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

@RestController
@RequestMapping("/api/restaurants")
public class RestaurantController {

    private final RestaurantRepository restaurants;

    public RestaurantController(RestaurantRepository restaurants) {
        this.restaurants = restaurants;
    }

    /**
     * GET /api/restaurants
     * GET /api/restaurants?cuisine=Chinese
     * GET /api/restaurants?cuisine=Chinese,Italian&budget=500&maxDistanceKm=4
     * GET /api/restaurants?ids=1,2,3   (used by the rating service when scoring)
     */
    @GetMapping
    public List<RestaurantView> list(@RequestParam(required = false) String cuisine,
                                     @RequestParam(required = false) Integer budget,
                                     @RequestParam(required = false) Double maxDistanceKm,
                                     @RequestParam(required = false) String ids) {
        if (ids != null && !ids.isBlank()) {
            List<Long> parsed = Arrays.stream(ids.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .map(this::parseId)
                    .toList();
            return parsed.isEmpty() ? List.of() : restaurants.findByIdInOrderByIdAsc(parsed).stream()
                    .map(RestaurantView::of).toList();
        }

        List<String> cuisines = (cuisine == null || cuisine.isBlank())
                ? List.of("")
                : Arrays.stream(cuisine.split(","))
                        .map(c -> c.trim().toLowerCase(Locale.ROOT))
                        .filter(c -> !c.isEmpty())
                        .toList();
        int cuisineCount = (cuisine == null || cuisine.isBlank()) ? 0 : cuisines.size();

        return restaurants.search(cuisines.isEmpty() ? List.of("") : cuisines, cuisineCount, budget, maxDistanceKm)
                .stream().map(RestaurantView::of).toList();
    }

    @GetMapping("/cuisines")
    public List<String> cuisines() {
        return restaurants.findDistinctCuisines();
    }

    @GetMapping("/{id}")
    public RestaurantView get(@PathVariable Long id) {
        return restaurants.findById(id).map(RestaurantView::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Restaurant not found."));
    }

    private Long parseId(String raw) {
        try {
            return Long.valueOf(raw);
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid restaurant id: " + raw);
        }
    }

    public record RestaurantView(Long id, String name, String cuisine, String signatureDish,
                                 Integer avgCostForTwo, Double distanceKm, Double baseRating,
                                 String imageUrl, String area) {
        static RestaurantView of(Restaurant r) {
            return new RestaurantView(r.getId(), r.getName(), r.getCuisine(), r.getSignatureDish(),
                    r.getAvgCostForTwo(), r.getDistanceKm(), r.getBaseRating(), r.getImageUrl(), r.getArea());
        }
    }
}

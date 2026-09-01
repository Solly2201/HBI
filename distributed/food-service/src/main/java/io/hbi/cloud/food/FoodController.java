package io.hbi.cloud.food;

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
@RequestMapping("/api/foods")
public class FoodController {

    private final FoodRepository foods;

    public FoodController(FoodRepository foods) {
        this.foods = foods;
    }

    /**
     * GET /api/foods
     * GET /api/foods?cuisine=Chinese
     * GET /api/foods?cuisine=Chinese,Italian
     * GET /api/foods?ids=1,2,3   (used by the rating service when scoring)
     */
    @GetMapping
    public List<FoodView> list(@RequestParam(required = false) String cuisine,
                               @RequestParam(required = false) String ids) {
        if (ids != null && !ids.isBlank()) {
            List<Long> parsed = Arrays.stream(ids.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .map(this::parseId)
                    .toList();
            return parsed.isEmpty() ? List.of() : foods.findByIdInOrderByIdAsc(parsed).stream()
                    .map(FoodView::of).toList();
        }

        List<String> cuisines = (cuisine == null || cuisine.isBlank())
                ? List.of("")
                : Arrays.stream(cuisine.split(","))
                        .map(c -> c.trim().toLowerCase(Locale.ROOT))
                        .filter(c -> !c.isEmpty())
                        .toList();
        int cuisineCount = (cuisine == null || cuisine.isBlank()) ? 0 : cuisines.size();

        // A count of 0 disables the cuisine filter in the query, but JPQL `in` still
        // needs a non-empty list — which "cuisine=," would otherwise not produce.
        return foods.search(cuisines.isEmpty() ? List.of("") : cuisines, cuisineCount)
                .stream().map(FoodView::of).toList();
    }

    @GetMapping("/cuisines")
    public List<String> cuisines() {
        return foods.findDistinctCuisines();
    }

    @GetMapping("/{id}")
    public FoodView get(@PathVariable Long id) {
        return foods.findById(id).map(FoodView::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Food item not found."));
    }

    private Long parseId(String raw) {
        try {
            return Long.valueOf(raw);
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid food id: " + raw);
        }
    }

    public record FoodView(Long id, String name, String cuisine, String imageUrl) {
        static FoodView of(FoodItem f) {
            return new FoodView(f.getId(), f.getName(), f.getCuisine(), f.getImageUrl());
        }
    }
}

package io.hbi.cloud.food;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Seeds food_db on first boot.
 *
 * The dishes and the eight cuisines are the HBI master food list shared with
 * HBI Web and HBI Mobile, and the images are the same food photos those
 * implementations ship, so this implementation looks and reads like HBI.
 * PostgreSQL stays the single source of truth: the seeder only fills an empty
 * table, and after that the data is edited directly in food_db.
 */
@Configuration
public class FoodSeeder {

    private static final Logger log = LoggerFactory.getLogger(FoodSeeder.class);

    @Bean
    ApplicationRunner seedFoods(FoodRepository repo) {
        return args -> {
            if (repo.count() > 0) {
                log.info("food_db already seeded ({} rows), skipping", repo.count());
                return;
            }
            repo.saveAll(List.of(
                    // --- Indian -------------------------------------------------
                    f("Pani Puri", "Indian", "pani-puri.jpg"),
                    f("Chole Bhature", "Indian", "chole-bhature.jpg"),
                    f("Momos", "Indian", "momos.jpg"),
                    f("Pav Bhaji", "Indian", "pav-bhaji.jpg"),
                    f("Dal Rice", "Indian", "dal-rice.jpg"),
                    f("Samosa", "Indian", "samosa.jpg"),
                    f("Aloo Paratha", "Indian", "aloo-paratha.jpg"),
                    f("Biryani", "Indian", "biryani.jpg"),
                    f("Butter Paneer and Naan", "Indian", "butter-paneer.jpg"),

                    // --- Mexican ------------------------------------------------
                    f("Tacos", "Mexican", "tacos.jpg"),
                    f("Burrito", "Mexican", "burrito.jpg"),
                    f("Nachos", "Mexican", "nachos.jpg"),
                    f("Quesadilla", "Mexican", "quesadilla.jpg"),

                    // --- Chinese ------------------------------------------------
                    f("Manchurian", "Chinese", "manchurian.jpg"),
                    f("Paneer Chilly", "Chinese", "paneer-chilly.jpg"),
                    f("Fried Rice", "Chinese", "fried-rice.jpg"),
                    f("Spring Rolls", "Chinese", "spring-rolls.jpg"),
                    f("Noodles", "Chinese", "noodles.jpg"),
                    f("Ramen", "Chinese", "ramen.jpg"),

                    // --- Italian ------------------------------------------------
                    f("Pizza", "Italian", "pizza.jpg"),
                    f("Pasta", "Italian", "pasta.jpg"),
                    f("Spaghetti", "Italian", "spaghetti.jpg"),

                    // --- South Indian -------------------------------------------
                    f("Pizza Dosa", "South Indian", "pizza-dosa.jpg"),
                    f("Masala Dosa", "South Indian", "masala-dosa.jpg"),
                    f("Idli Sambhar", "South Indian", "idli-sambhar.jpg"),
                    f("Thatte Idli", "South Indian", "thatte-idli.jpg"),
                    f("Medu Wada", "South Indian", "medu-wada.jpg"),
                    f("Utpam", "South Indian", "utpam.jpg"),

                    // --- Beverages ----------------------------------------------
                    f("Cold Coffee", "Beverages", "cold-coffee.jpg"),
                    f("Cold Drink", "Beverages", "cold-drink.jpg"),
                    f("Energy Drink", "Beverages", "energy-drink.jpg"),
                    f("Juice", "Beverages", "juice.jpg"),
                    f("Lassi", "Beverages", "lassi.jpg"),
                    f("Chaas", "Beverages", "chaas.jpg"),
                    f("Coffee", "Beverages", "coffee.jpg"),
                    f("Soup", "Beverages", "soup.jpg"),

                    // --- American -----------------------------------------------
                    f("Burger", "American", "burger.jpg"),
                    f("Sandwich", "American", "sandwich.jpg"),
                    f("Hot Dog", "American", "hot-dog.jpg"),
                    f("Pancakes", "American", "pancake.jpg"),
                    f("French Fries", "American", "french-fries.jpg"),

                    // --- Desserts -----------------------------------------------
                    f("Gulab Jamun", "Desserts", "gulab-jamun.jpg"),
                    f("Ice Cream", "Desserts", "ice-cream.jpg"),
                    f("Waffle", "Desserts", "waffle.jpg"),
                    f("Pie", "Desserts", "pie.jpg"),
                    f("Tiramisu", "Desserts", "tiramisu.jpg"),
                    f("Pastry", "Desserts", "pastry.jpg"),
                    f("Chocolate Mousse", "Desserts", "chocolate-mousse.jpg")
            ));
            log.info("seeded food_db with {} food items", repo.count());
        };
    }

    private static FoodItem f(String name, String cuisine, String image) {
        // Images are served by the frontend from its /images folder.
        return new FoodItem(name, cuisine, "/images/" + image);
    }
}

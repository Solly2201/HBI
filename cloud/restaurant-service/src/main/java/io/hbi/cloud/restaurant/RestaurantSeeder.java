package io.hbi.cloud.restaurant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Seeds restaurant_db on first boot.
 *
 * The eight cuisines and the signature dishes are taken from the HBI master
 * food list shared by HBI Web and HBI Mobile, and the images are the same food
 * photos those implementations ship, so HBI Cloud looks and reads like HBI.
 * The data itself is fictional and lives only in this service's database.
 */
@Configuration
public class RestaurantSeeder {

    private static final Logger log = LoggerFactory.getLogger(RestaurantSeeder.class);

    @Bean
    ApplicationRunner seedRestaurants(RestaurantRepository repo) {
        return args -> {
            if (repo.count() > 0) {
                log.info("restaurant_db already seeded ({} rows), skipping", repo.count());
                return;
            }
            repo.saveAll(List.of(
                    // --- Indian -------------------------------------------------
                    r("Chatori Gali", "Indian", "Pani Puri", 300, 1.2, 4.4, "pani-puri.jpg", "Vile Parle"),
                    r("Punjab Da Dhaba", "Indian", "Chole Bhature", 450, 2.6, 4.2, "chole-bhature.jpg", "Andheri West"),
                    r("Mumbai Tiffin Co.", "Indian", "Pav Bhaji", 350, 0.9, 4.5, "pav-bhaji.jpg", "Juhu"),
                    r("Biryani House", "Indian", "Biryani", 700, 3.8, 4.6, "biryani.jpg", "Bandra"),
                    r("Ghar Ka Khana", "Indian", "Dal Rice", 250, 1.7, 4.0, "dal-rice.jpg", "Santacruz"),

                    // --- South Indian -------------------------------------------
                    r("Dosa Junction", "South Indian", "Masala Dosa", 300, 1.1, 4.5, "masala-dosa.jpg", "Matunga"),
                    r("Idli Express", "South Indian", "Idli Sambhar", 200, 2.2, 4.1, "idli-sambhar.jpg", "Sion"),
                    r("Thatte & Co.", "South Indian", "Thatte Idli", 280, 4.5, 4.3, "thatte-idli.jpg", "Chembur"),
                    r("Coastal Filter", "South Indian", "Medu Wada", 240, 3.1, 4.2, "medu-wada.jpg", "Dadar"),

                    // --- Chinese -------------------------------------------------
                    r("Wok This Way", "Chinese", "Manchurian", 500, 1.4, 4.3, "manchurian.jpg", "Andheri East"),
                    r("Noodle Bar 61", "Chinese", "Noodles", 420, 2.9, 4.1, "noodles.jpg", "Powai"),
                    r("Ramen Republic", "Chinese", "Ramen", 850, 5.2, 4.7, "ramen.jpg", "Lower Parel"),
                    r("Golden Dragon", "Chinese", "Fried Rice", 600, 3.4, 4.0, "fried-rice.jpg", "Khar"),

                    // --- Italian -------------------------------------------------
                    r("Forno Rosso", "Italian", "Pizza", 900, 2.1, 4.6, "pizza.jpg", "Bandra West"),
                    r("Pasta Fresca", "Italian", "Pasta", 750, 3.6, 4.4, "pasta.jpg", "Juhu"),
                    r("Nonna's Kitchen", "Italian", "Spaghetti", 680, 4.9, 4.2, "spaghetti.jpg", "Versova"),
                    r("Slice of Milan", "Italian", "Pizza", 400, 1.0, 3.9, "pizza.jpg", "Vile Parle"),

                    // --- Mexican -------------------------------------------------
                    r("Taco Tuesday", "Mexican", "Tacos", 550, 2.4, 4.3, "tacos.jpg", "Andheri West"),
                    r("Burrito Bros", "Mexican", "Burrito", 480, 1.8, 4.1, "burrito.jpg", "Goregaon"),
                    r("Casa Nacho", "Mexican", "Nachos", 620, 4.2, 4.0, "nachos.jpg", "Malad"),
                    r("El Quesadilla", "Mexican", "Quesadilla", 520, 5.8, 4.2, "quesadilla.jpg", "Borivali"),

                    // --- American ------------------------------------------------
                    r("Patty Palace", "American", "Burger", 450, 1.3, 4.4, "burger.jpg", "Vile Parle"),
                    r("The Sandwich Stop", "American", "Sandwich", 250, 0.7, 4.0, "sandwich.jpg", "Santacruz"),
                    r("Frycraft", "American", "French Fries", 300, 2.7, 3.8, "french-fries.jpg", "Andheri East"),
                    r("Dog House", "American", "Hot Dog", 350, 3.9, 3.9, "hot-dog.jpg", "Kandivali"),

                    // --- Desserts ------------------------------------------------
                    r("Mithai Mahal", "Desserts", "Gulab Jamun", 200, 1.6, 4.5, "gulab-jamun.jpg", "Matunga"),
                    r("Scoops & Co.", "Desserts", "Ice Cream", 280, 1.1, 4.6, "ice-cream.jpg", "Juhu"),
                    r("Waffle Works", "Desserts", "Waffle", 400, 2.3, 4.3, "waffle.jpg", "Bandra"),
                    r("Tiramisu Lane", "Desserts", "Tiramisu", 550, 4.7, 4.4, "tiramisu.jpg", "Lower Parel"),

                    // --- Beverages -----------------------------------------------
                    r("Brew Point", "Beverages", "Coffee", 300, 0.8, 4.5, "coffee.jpg", "Vile Parle"),
                    r("Chill Chaas", "Beverages", "Chaas", 120, 1.9, 4.0, "chaas.jpg", "Dadar"),
                    r("Lassi Corner", "Beverages", "Lassi", 180, 3.2, 4.2, "lassi.jpg", "Sion"),
                    r("Cold Brew Club", "Beverages", "Cold Coffee", 350, 2.5, 4.4, "cold-coffee.jpg", "Powai")
            ));
            log.info("seeded restaurant_db with {} restaurants", repo.count());
        };
    }

    private static Restaurant r(String name, String cuisine, String dish, int cost,
                                double distanceKm, double rating, String image, String area) {
        // Images are served by the HBI Cloud frontend from its /images folder.
        return new Restaurant(name, cuisine, dish, cost, distanceKm, rating, "/images/" + image, area);
    }
}

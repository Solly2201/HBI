package io.hbi.cloud.food;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * One dish from the HBI master food list — the same vocabulary HBI Web and HBI
 * Mobile use, so the three implementations stay recognisably the same product.
 * This table lives in food_db and is owned solely by this service.
 *
 * A food item is the unit players rate, the unit recommendations rank, and the
 * unit the result screen displays. The name is unique, so the same dish can
 * never appear as two competing candidates.
 */
@Entity
@Table(name = "food_item", uniqueConstraints = @UniqueConstraint(columnNames = {"name"}))
public class FoodItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 80)
    private String name;

    @Column(nullable = false, length = 40)
    private String cuisine;

    @Column(name = "image_url", nullable = false, length = 200)
    private String imageUrl;

    protected FoodItem() {
        // for JPA
    }

    public FoodItem(String name, String cuisine, String imageUrl) {
        this.name = name;
        this.cuisine = cuisine;
        this.imageUrl = imageUrl;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getCuisine() {
        return cuisine;
    }

    public String getImageUrl() {
        return imageUrl;
    }
}

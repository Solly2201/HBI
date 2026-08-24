package io.hbi.cloud.restaurant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A restaurant the group can be sent to. Cuisines and signature dishes are the
 * same vocabulary HBI Web and HBI Mobile use, so the three implementations stay
 * recognisably the same product — but this table lives in restaurant_db and is
 * owned solely by this service.
 */
@Entity
@Table(name = "restaurant")
public class Restaurant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 40)
    private String cuisine;

    /** Signature dish, drawn from the HBI master food list. */
    @Column(name = "signature_dish", nullable = false, length = 80)
    private String signatureDish;

    /** Budget signal: approximate cost for two, in rupees. */
    @Column(name = "avg_cost_for_two", nullable = false)
    private Integer avgCostForTwo;

    @Column(name = "distance_km", nullable = false)
    private Double distanceKm;

    /** Editorial baseline rating out of 5, used only as a display hint. */
    @Column(name = "base_rating", nullable = false)
    private Double baseRating;

    @Column(name = "image_url", nullable = false, length = 200)
    private String imageUrl;

    @Column(nullable = false, length = 160)
    private String area;

    protected Restaurant() {
        // for JPA
    }

    public Restaurant(String name, String cuisine, String signatureDish, Integer avgCostForTwo,
                      Double distanceKm, Double baseRating, String imageUrl, String area) {
        this.name = name;
        this.cuisine = cuisine;
        this.signatureDish = signatureDish;
        this.avgCostForTwo = avgCostForTwo;
        this.distanceKm = distanceKm;
        this.baseRating = baseRating;
        this.imageUrl = imageUrl;
        this.area = area;
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

    public String getSignatureDish() {
        return signatureDish;
    }

    public Integer getAvgCostForTwo() {
        return avgCostForTwo;
    }

    public Double getDistanceKm() {
        return distanceKm;
    }

    public Double getBaseRating() {
        return baseRating;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public String getArea() {
        return area;
    }
}

package io.hbi.cloud.restaurant;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    /**
     * Single filter query backing GET /api/restaurants. Every criterion is
     * optional. {@code cuisineCount} is passed separately (rather than testing
     * the list for null) because JPQL {@code in} needs a non-empty list even
     * when the clause is meant to be disabled.
     */
    @Query("""
            select r from Restaurant r
            where (:cuisineCount = 0 or lower(r.cuisine) in :cuisines)
              and (:budget is null or r.avgCostForTwo <= :budget)
              and (:maxDistanceKm is null or r.distanceKm <= :maxDistanceKm)
            order by r.id asc
            """)
    List<Restaurant> search(@Param("cuisines") List<String> cuisines,
                            @Param("cuisineCount") int cuisineCount,
                            @Param("budget") Integer budget,
                            @Param("maxDistanceKm") Double maxDistanceKm);

    @Query("select distinct r.cuisine from Restaurant r order by r.cuisine asc")
    List<String> findDistinctCuisines();

    List<Restaurant> findByIdInOrderByIdAsc(List<Long> ids);
}

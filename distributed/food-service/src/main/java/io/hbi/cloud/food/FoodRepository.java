package io.hbi.cloud.food;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface FoodRepository extends JpaRepository<FoodItem, Long> {

    /**
     * Single filter query backing GET /api/foods. The cuisine filter is
     * optional. {@code cuisineCount} is passed separately (rather than testing
     * the list for null) because JPQL {@code in} needs a non-empty list even
     * when the clause is meant to be disabled.
     */
    @Query("""
            select f from FoodItem f
            where (:cuisineCount = 0 or lower(f.cuisine) in :cuisines)
            order by f.id asc
            """)
    List<FoodItem> search(@Param("cuisines") List<String> cuisines,
                          @Param("cuisineCount") int cuisineCount);

    @Query("select distinct f.cuisine from FoodItem f order by f.cuisine asc")
    List<String> findDistinctCuisines();

    List<FoodItem> findByIdInOrderByIdAsc(List<Long> ids);
}

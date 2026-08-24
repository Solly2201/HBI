package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Recommendation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RecommendationRepository extends JpaRepository<Recommendation, Long> {

    List<Recommendation> findByRoomCodeOrderByPositionAsc(String roomCode);

    void deleteByRoomCode(String roomCode);
}

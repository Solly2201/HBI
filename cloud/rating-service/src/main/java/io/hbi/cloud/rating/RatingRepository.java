package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Rating;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RatingRepository extends JpaRepository<Rating, Long> {

    List<Rating> findByRoomCode(String roomCode);

    Optional<Rating> findByRoomCodeAndUserIdAndFoodId(String roomCode, Long userId, Long foodId);

    void deleteByRoomCode(String roomCode);
}

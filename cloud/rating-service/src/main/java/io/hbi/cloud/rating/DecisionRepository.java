package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Decision;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DecisionRepository extends JpaRepository<Decision, Long> {

    Optional<Decision> findByRoomCode(String roomCode);
}

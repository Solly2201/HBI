package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Preference;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PreferenceRepository extends JpaRepository<Preference, Long> {

    List<Preference> findByRoomCode(String roomCode);

    Optional<Preference> findByRoomCodeAndUserId(String roomCode, Long userId);
}

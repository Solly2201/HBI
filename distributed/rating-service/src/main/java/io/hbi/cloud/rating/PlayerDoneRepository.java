package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.PlayerDone;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PlayerDoneRepository extends JpaRepository<PlayerDone, Long> {

    List<PlayerDone> findByRoomCode(String roomCode);

    void deleteByRoomCode(String roomCode);
}

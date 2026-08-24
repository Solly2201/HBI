package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Candidate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CandidateRepository extends JpaRepository<Candidate, Long> {

    List<Candidate> findByRoomCodeOrderByPositionAsc(String roomCode);
}

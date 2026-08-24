package io.hbi.cloud.room;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface RoomRepository extends JpaRepository<Room, Long> {

    Optional<Room> findByCode(String code);

    boolean existsByCode(String code);

    /**
     * Rooms with no activity since {@code cutoff}, oldest first. Rows created
     * before the activity column existed have a null {@code lastActivityAt}
     * and fall back to {@code createdAt}. Paged so a large backlog is worked
     * through in bounded batches rather than loaded whole.
     */
    @Query("select r from Room r where coalesce(r.lastActivityAt, r.createdAt) < :cutoff "
            + "order by coalesce(r.lastActivityAt, r.createdAt)")
    List<Room> findStaleRooms(@Param("cutoff") Instant cutoff, Pageable page);
}

package io.hbi.cloud.room;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface RoomMemberRepository extends JpaRepository<RoomMember, Long> {

    @Transactional
    void deleteByRoomCode(String roomCode);

    List<RoomMember> findByRoomCodeOrderByJoinedAtAsc(String roomCode);

    List<RoomMember> findByRoomCodeAndActiveTrueOrderByJoinedAtAsc(String roomCode);

    Optional<RoomMember> findByRoomCodeAndUserId(String roomCode, Long userId);

    long countByRoomCodeAndActiveTrue(String roomCode);
}

package io.hbi.cloud.room;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.List;

public final class RoomDtos {

    private RoomDtos() {
    }

    public record MemberView(Long userId, String displayName, boolean host, boolean active, Instant joinedAt) {
    }

    public record RoomView(String roomId,
                           String code,
                           Long hostUserId,
                           String status,
                           int memberCount,
                           int maxMembers,
                           Instant createdAt,
                           List<MemberView> members) {
    }

    public record StatusChangeRequest(@NotNull Room.Status status) {
    }
}

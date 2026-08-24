package io.hbi.cloud.room;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * The TTL garbage collection: stale rooms go (with their members, and with a
 * ROOM_DELETED event for the rating service), live rooms stay — no matter how
 * old they are — and running the sweep again is harmless.
 */
@DataJpaTest
class RoomCleanupTest {

    private static final Instant NOW = Instant.now();
    /** The default 24h TTL, expressed as the cutoff the sweep would compute. */
    private static final Instant CUTOFF = NOW.minus(Duration.ofHours(24));

    @Autowired
    private RoomRepository rooms;

    @Autowired
    private RoomMemberRepository members;

    private RoomEventPublisher events;
    private RoomCleanup cleanup;

    @BeforeEach
    void setUp() {
        events = mock(RoomEventPublisher.class);
        cleanup = new RoomCleanup(rooms, members, events, 24);
    }

    private Room room(String code, Room.Status status, Instant createdAt, Instant lastActivityAt) {
        Room r = new Room(code, 1L);
        r.setStatus(status);
        ReflectionTestUtils.setField(r, "createdAt", createdAt);
        ReflectionTestUtils.setField(r, "lastActivityAt", lastActivityAt);
        return rooms.save(r);
    }

    private static Instant hoursAgo(long h) {
        return NOW.minus(Duration.ofHours(h));
    }

    @Test
    void abandonedRoomIsDeletedWithItsMembers() {
        Room stale = room("HBIAAAA", Room.Status.RATING, hoursAgo(30), hoursAgo(30));
        // The players never pressed Leave — they are still flagged active.
        members.save(new RoomMember(stale.getCode(), 1L, "Alice"));
        members.save(new RoomMember(stale.getCode(), 2L, "Bob"));

        int purged = cleanup.purgeStaleRooms(CUTOFF);

        assertEquals(1, purged);
        assertTrue(rooms.findByCode("HBIAAAA").isEmpty(), "room row should be gone");
        assertTrue(members.findByRoomCodeOrderByJoinedAtAsc("HBIAAAA").isEmpty(),
                "member rows should be gone");
        verify(events).publish(eq("ROOM_DELETED"), any(Room.class), isNull(), isNull());
    }

    @Test
    void decidedRoomIsDeletedAfterTtl() {
        room("HBIBBBB", Room.Status.DECIDED, hoursAgo(50), hoursAgo(26));

        assertEquals(1, cleanup.purgeStaleRooms(CUTOFF));
        assertTrue(rooms.findByCode("HBIBBBB").isEmpty());
    }

    @Test
    void activeRoomIsKeptHoweverOldItIs() {
        // Created three days ago, but somebody rated a minute ago.
        room("HBICCCC", Room.Status.RATING, hoursAgo(72), NOW.minus(Duration.ofMinutes(1)));

        assertEquals(0, cleanup.purgeStaleRooms(CUTOFF));
        assertFalse(rooms.findByCode("HBICCCC").isEmpty(), "an active room must never be reaped");
        verify(events, never()).publish(eq("ROOM_DELETED"), any(), any(), any());
    }

    @Test
    void recentEmptyLobbyIsKeptUntilTheTtlPasses() {
        room("HBIDDDD", Room.Status.LOBBY, hoursAgo(1), hoursAgo(1));

        assertEquals(0, cleanup.purgeStaleRooms(CUTOFF));
        assertFalse(rooms.findByCode("HBIDDDD").isEmpty());
    }

    @Test
    void legacyRowWithoutActivityStampFallsBackToCreatedAt() {
        // Rows written before the column existed read as null.
        room("HBIEEEE", Room.Status.LOBBY, hoursAgo(48), null);
        room("HBIFFFF", Room.Status.LOBBY, hoursAgo(2), null);

        assertEquals(1, cleanup.purgeStaleRooms(CUTOFF));
        assertTrue(rooms.findByCode("HBIEEEE").isEmpty(), "old legacy row goes by created_at");
        assertFalse(rooms.findByCode("HBIFFFF").isEmpty(), "recent legacy row stays");
    }

    @Test
    void sweepIsSafeToRunRepeatedly() {
        Room stale = room("HBIGGGG", Room.Status.LOBBY, hoursAgo(30), hoursAgo(30));
        members.save(new RoomMember(stale.getCode(), 1L, "Alice"));

        assertEquals(1, cleanup.purgeStaleRooms(CUTOFF));
        assertEquals(0, cleanup.purgeStaleRooms(CUTOFF), "second pass finds nothing to do");
        assertEquals(0, cleanup.purgeStaleRooms(CUTOFF));
    }
}

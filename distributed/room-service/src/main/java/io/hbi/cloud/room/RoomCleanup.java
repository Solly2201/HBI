package io.hbi.cloud.room;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Garbage-collects rooms nobody is playing in any more.
 *
 * A room is stale when nothing has happened in it — no join, leave, status
 * change or rating — for {@code hbi.room.ttl-hours}. That covers all three
 * end states the same way: everyone left, everyone silently closed their
 * browser, or the blend finished (DECIDED) and the players moved on. A room
 * that is merely old but still active keeps refreshing its activity stamp and
 * is never touched.
 *
 * Each purged room is announced as ROOM_DELETED on the existing room-events
 * topic; the rating service consumes it and deletes its own room-scoped rows
 * (preferences, ratings, candidates, recommendations, decision). There are no
 * cross-database foreign keys, so each service cleans what it owns.
 *
 * The sweep is deliberately not one big transaction: members are deleted
 * before their room, each room independently, so a crash mid-sweep leaves
 * only rooms that are still stale — the next run finishes the job. Deleting
 * an already-deleted room's data is a no-op everywhere, so repeats are safe.
 */
@Component
public class RoomCleanup {

    private static final Logger log = LoggerFactory.getLogger(RoomCleanup.class);

    /** How many rooms one batch loads; bounds memory however big the backlog. */
    static final int BATCH = 500;

    private final RoomRepository rooms;
    private final RoomMemberRepository members;
    private final RoomEventPublisher events;
    private final Duration ttl;

    public RoomCleanup(RoomRepository rooms,
                       RoomMemberRepository members,
                       RoomEventPublisher events,
                       @Value("${hbi.room.ttl-hours:24}") long ttlHours) {
        this.rooms = rooms;
        this.members = members;
        this.events = events;
        this.ttl = Duration.ofHours(ttlHours);
    }

    @Scheduled(fixedDelayString = "${hbi.cleanup.interval-ms:3600000}",
               initialDelayString = "${hbi.cleanup.initial-delay-ms:60000}")
    public void sweep() {
        Instant cutoff = Instant.now().minus(ttl);
        int total = 0;
        int purged;
        do {
            purged = purgeStaleRooms(cutoff);
            total += purged;
            // A batch that deleted nothing despite stale rooms remaining would
            // loop forever; stop as soon as a batch comes up short.
        } while (purged == BATCH);
        if (total > 0) {
            log.info("cleanup pass removed {} stale room(s)", total);
        }
    }

    /** Deletes one batch of rooms stale at {@code cutoff}; returns how many went. */
    public int purgeStaleRooms(Instant cutoff) {
        List<Room> stale = rooms.findStaleRooms(cutoff, PageRequest.of(0, BATCH));
        int purged = 0;
        for (Room room : stale) {
            try {
                members.deleteByRoomCode(room.getCode());
                rooms.delete(room);
                events.publish("ROOM_DELETED", room, null, null);
                log.info("deleted stale room {} (status {}, last activity {})",
                        room.getCode(), room.getStatus(), room.getLastActivityAt());
                purged++;
            } catch (Exception e) {
                // One stubborn room must not stop the sweep; it stays stale
                // and the next pass retries it.
                log.warn("could not delete stale room {}: {}", room.getCode(), e.getMessage());
            }
        }
        return purged;
    }
}

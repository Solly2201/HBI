package io.hbi.cloud.room;

import io.hbi.cloud.room.RoomDtos.MemberView;
import io.hbi.cloud.room.RoomDtos.RoomView;
import io.hbi.cloud.room.RoomDtos.StatusChangeRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.util.List;
import java.util.Locale;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {

    /** Ambiguous characters (0/O, 1/I) are left out because players read codes aloud. */
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final RoomRepository rooms;
    private final RoomMemberRepository members;
    private final RoomEventPublisher events;

    public RoomController(RoomRepository rooms, RoomMemberRepository members, RoomEventPublisher events) {
        this.rooms = rooms;
        this.members = members;
        this.events = events;
    }

    @PostMapping
    @Transactional
    public ResponseEntity<RoomView> create(@RequestHeader("X-User-Id") Long userId,
                                           @RequestHeader("X-User-Name") String userName) {
        Room room = rooms.save(new Room(newRoomCode(), userId));
        members.save(new RoomMember(room.getCode(), userId, userName));

        events.publish("ROOM_CREATED", room, userId, userName);
        events.publish("USER_JOINED", room, userId, userName);
        return ResponseEntity.status(HttpStatus.CREATED).body(view(room));
    }

    @PostMapping("/{roomId}/join")
    @Transactional
    public RoomView join(@PathVariable String roomId,
                         @RequestHeader("X-User-Id") Long userId,
                         @RequestHeader("X-User-Name") String userName) {
        Room room = require(roomId);
        if (room.getStatus() == Room.Status.DECIDED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That blend has already finished.");
        }

        RoomMember existing = members.findByRoomCodeAndUserId(room.getCode(), userId).orElse(null);
        if (existing != null) {
            // Rejoin: mirrors the reconnect behaviour of HBI Web.
            existing.setActive(true);
            existing.setDisplayName(userName);
            members.save(existing);
        } else {
            if (members.countByRoomCodeAndActiveTrue(room.getCode()) >= Room.MAX_MEMBERS) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Room is full (" + Room.MAX_MEMBERS + " players max).");
            }
            members.save(new RoomMember(room.getCode(), userId, userName));
        }

        events.publish("USER_JOINED", room, userId, userName);
        return view(room);
    }

    @GetMapping("/{roomId}")
    public RoomView get(@PathVariable String roomId) {
        return view(require(roomId));
    }

    @GetMapping("/{roomId}/members")
    public List<MemberView> members(@PathVariable String roomId) {
        Room room = require(roomId);
        return memberViews(room);
    }

    @DeleteMapping("/{roomId}/members/{userId}")
    @Transactional
    public RoomView leave(@PathVariable String roomId,
                          @PathVariable Long userId,
                          @RequestHeader("X-User-Id") Long callerId) {
        Room room = require(roomId);
        // A player can remove themselves; the host can remove anyone.
        if (!callerId.equals(userId) && !callerId.equals(room.getHostUserId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the host can remove other players.");
        }

        RoomMember member = members.findByRoomCodeAndUserId(room.getCode(), userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "That player is not in this room."));
        member.setActive(false);
        members.save(member);

        // If the host walked out, promote the longest-standing remaining player
        // so the room does not get stuck in the lobby.
        if (userId.equals(room.getHostUserId())) {
            members.findByRoomCodeAndActiveTrueOrderByJoinedAtAsc(room.getCode()).stream()
                    .findFirst()
                    .ifPresent(next -> {
                        room.setHostUserId(next.getUserId());
                        rooms.save(room);
                    });
        }

        events.publish("USER_LEFT", room, userId, member.getDisplayName());
        return view(room);
    }

    /** Advances the room through lobby -> preferences -> rating -> decided. Host only. */
    @PutMapping("/{roomId}/status")
    @Transactional
    public RoomView changeStatus(@PathVariable String roomId,
                                 @RequestHeader("X-User-Id") Long callerId,
                                 @Valid @RequestBody StatusChangeRequest req) {
        Room room = require(roomId);
        if (!callerId.equals(room.getHostUserId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the host can move the room forward.");
        }
        room.setStatus(req.status());
        rooms.save(room);

        events.publish("ROOM_STATE_CHANGED", room, callerId, null);
        return view(room);
    }

    // ------------------------------------------------------------------

    private Room require(String roomId) {
        return rooms.findByCode(roomId.trim().toUpperCase(Locale.ROOT))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Room not found."));
    }

    private String newRoomCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            StringBuilder sb = new StringBuilder("HBI");
            for (int i = 0; i < 4; i++) {
                sb.append(CODE_ALPHABET.charAt(RANDOM.nextInt(CODE_ALPHABET.length())));
            }
            String code = sb.toString();
            if (!rooms.existsByCode(code)) {
                return code;
            }
        }
        throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Could not allocate a room code, try again.");
    }

    private List<MemberView> memberViews(Room room) {
        return members.findByRoomCodeOrderByJoinedAtAsc(room.getCode()).stream()
                .map(m -> new MemberView(m.getUserId(), m.getDisplayName(),
                        m.getUserId().equals(room.getHostUserId()), m.isActive(), m.getJoinedAt()))
                .toList();
    }

    private RoomView view(Room room) {
        List<MemberView> all = memberViews(room);
        int activeCount = (int) all.stream().filter(MemberView::active).count();
        return new RoomView(room.getCode(), room.getCode(), room.getHostUserId(), room.getStatus().name(),
                activeCount, Room.MAX_MEMBERS, room.getCreatedAt(), all);
    }
}

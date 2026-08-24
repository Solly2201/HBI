package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/api/rooms/{roomId}")
public class BlendController {

    private final BlendService blend;
    private final RatingEventPublisher events;
    private final RoomClient roomClient;
    private final RoomBroadcaster broadcaster;

    public BlendController(BlendService blend, RatingEventPublisher events,
                           RoomClient roomClient, RoomBroadcaster broadcaster) {
        this.blend = blend;
        this.events = events;
        this.roomClient = roomClient;
        this.broadcaster = broadcaster;
    }

    // ---------------------------------------------------------- preferences

    public record PreferenceRequest(List<String> cuisines) {
    }

    @PostMapping("/preferences")
    public Map<String, Object> submitPreferences(@PathVariable String roomId,
                                                 @RequestHeader("X-User-Id") Long userId,
                                                 @Valid @RequestBody PreferenceRequest req) {
        String room = normalise(roomId);
        Preference saved = blend.savePreference(room, userId,
                req.cuisines() == null ? List.of() : req.cuisines());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", room);
        out.put("userId", saved.getUserId());
        out.put("cuisines", saved.cuisineList());
        out.put("group", blend.aggregatePreferences(room));
        return out;
    }

    @GetMapping("/preferences")
    public Map<String, Object> preferences(@PathVariable String roomId) {
        String room = normalise(roomId);
        Map<String, Object> out = new LinkedHashMap<>(blend.aggregatePreferences(room));
        out.put("perPlayer", blend.preferencesFor(room).stream().map(p -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("userId", p.getUserId());
            m.put("cuisines", p.cuisineList());
            return m;
        }).toList());
        return out;
    }

    /** The frozen shortlist of food items this room is rating. */
    @GetMapping("/candidates")
    public List<FoodClient.FoodView> candidates(@PathVariable String roomId) {
        return blend.candidatesFor(normalise(roomId));
    }

    // -------------------------------------------------------------- ratings

    public record RatingRequest(@NotNull Long foodId,
                                @NotNull @Min(1) @Max(5) Integer score) {
    }

    @PostMapping("/ratings")
    public Map<String, Object> submitRating(@PathVariable String roomId,
                                            @RequestHeader("X-User-Id") Long userId,
                                            @Valid @RequestBody RatingRequest req) {
        String room = normalise(roomId);
        Rating saved;
        try {
            saved = blend.saveRating(room, userId, req.foodId(), req.score());
        } catch (DataIntegrityViolationException e) {
            // Two identical submissions raced: both found no existing row and
            // both inserted, and this one lost. The row exists now, so a
            // single retry finds it and applies the score as an update.
            saved = blend.saveRating(room, userId, req.foodId(), req.score());
        }

        // Persist first, then announce. The decision engine reacts to the event.
        events.ratingSubmitted(room, userId, req.foodId(), req.score());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", room);
        out.put("userId", saved.getUserId());
        out.put("foodId", saved.getFoodId());
        out.put("score", saved.getScore());
        out.put("accepted", true);
        out.put("progress", blend.progress(room));
        return out;
    }

    @GetMapping("/ratings")
    public Map<String, Object> ratings(@PathVariable String roomId) {
        String room = normalise(roomId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", room);
        out.put("progress", blend.progress(room));
        out.put("ratings", blend.ratingsFor(room).stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("userId", r.getUserId());
            m.put("foodId", r.getFoodId());
            m.put("score", r.getScore());
            return m;
        }).toList());
        return out;
    }

    // ------------------------------------------------------------ blend now

    /**
     * The player's optional early finish: "I have rated enough, use my current
     * ratings." Validated server-side against the minimum rating count.
     */
    @PostMapping("/blend-now")
    public Map<String, Object> blendNow(@PathVariable String roomId,
                                        @RequestHeader("X-User-Id") Long userId) {
        String room = normalise(roomId);
        Map<String, Object> progress = blend.markPlayerDone(room, userId);

        // Announce over Kafka so the decision engine re-scores and, if this
        // player was the last one outstanding, finalises - the same async path
        // a rating takes.
        events.playerFinished(room, userId);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", room);
        out.put("userId", userId);
        out.put("done", true);
        out.put("progress", progress);
        return out;
    }

    // ------------------------------------------------- recommendations

    @GetMapping("/recommendations")
    public Map<String, Object> recommendations(@PathVariable String roomId) {
        String room = normalise(roomId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", room);
        out.put("progress", blend.progress(room));
        // Scored on read, so this never lags a rating that has just been
        // accepted but not yet consumed off Kafka.
        out.put("recommendations", blend.liveRecommendations(room));
        return out;
    }

    // ------------------------------------------------------------- decision

    /**
     * The host starts (or forces) the group decision early. Two server-side
     * checks, in order: the caller must be the host, and at least half of the
     * active players must have rated the minimum ({@link BlendService#hostFinalise}).
     */
    @PostMapping("/finalize")
    public Map<String, Object> finalizeBlend(@PathVariable String roomId,
                                             @RequestHeader("X-User-Id") Long userId) {
        String room = normalise(roomId);

        // Only the host can cut the blend short. Membership is owned by the
        // room service, so we ask it rather than reading its database.
        boolean isHost = roomClient.activeMembers(room).stream()
                .anyMatch(m -> m.host() && userId.equals(m.userId()));
        if (!isHost) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the host can finish the blend.");
        }

        Map<String, Object> decision = blend.hostFinalise(room);

        Map<String, Object> payload = new LinkedHashMap<>(decision);
        payload.put("trigger", "HOST_FINALIZED");
        broadcaster.send(room, "DECISION_FINALIZED", payload);
        return decision;
    }

    @GetMapping("/decision")
    public Map<String, Object> decision(@PathVariable String roomId) {
        return blend.decisionFor(normalise(roomId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "This room has not decided yet."));
    }

    private String normalise(String roomId) {
        return roomId.trim().toUpperCase(Locale.ROOT);
    }
}

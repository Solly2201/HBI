package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Candidate;
import io.hbi.cloud.rating.Entities.Decision;
import io.hbi.cloud.rating.Entities.PlayerDone;
import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import io.hbi.cloud.rating.Entities.Recommendation;
import io.hbi.cloud.rating.FoodClient.FoodView;
import io.hbi.cloud.rating.RecommendationEngine.ScoredFood;
import io.hbi.cloud.rating.RoomClient.Member;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The HBI blend, server side: cuisines in, the group's top foods out.
 */
@Service
public class BlendService {

    private static final Logger log = LoggerFactory.getLogger(BlendService.class);

    private final PreferenceRepository preferences;
    private final RatingRepository ratings;
    private final RecommendationRepository recommendations;
    private final DecisionRepository decisions;
    private final CandidateRepository candidates;
    private final PlayerDoneRepository playerDone;
    private final FoodClient foodClient;
    private final RoomClient roomClient;
    private final RecommendationEngine engine;
    private final RatingEventPublisher events;
    private final int shortlistSize;

    public BlendService(PreferenceRepository preferences,
                        RatingRepository ratings,
                        RecommendationRepository recommendations,
                        DecisionRepository decisions,
                        CandidateRepository candidates,
                        PlayerDoneRepository playerDone,
                        FoodClient foodClient,
                        RoomClient roomClient,
                        RecommendationEngine engine,
                        RatingEventPublisher events,
                        @Value("${hbi.blend.shortlist-size:12}") int shortlistSize) {
        this.preferences = preferences;
        this.ratings = ratings;
        this.recommendations = recommendations;
        this.decisions = decisions;
        this.candidates = candidates;
        this.playerDone = playerDone;
        this.foodClient = foodClient;
        this.roomClient = roomClient;
        this.engine = engine;
        this.events = events;
        this.shortlistSize = shortlistSize;
    }

    // ---------------------------------------------------------------- prefs

    @Transactional
    public Preference savePreference(String roomCode, Long userId, List<String> cuisines) {
        Preference pref = preferences.findByRoomCodeAndUserId(roomCode, userId)
                .orElseGet(() -> new Preference(roomCode, userId));
        pref.setCuisines(cuisines);
        pref.touch();
        return preferences.save(pref);
    }

    public List<Preference> preferencesFor(String roomCode) {
        return preferences.findByRoomCode(roomCode);
    }

    /** Union of everyone's cuisines. */
    public Map<String, Object> aggregatePreferences(String roomCode) {
        List<Preference> all = preferences.findByRoomCode(roomCode);
        Set<String> cuisines = new LinkedHashSet<>();
        all.forEach(p -> cuisines.addAll(p.cuisineList()));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", roomCode);
        out.put("submittedBy", all.size());
        out.put("cuisines", List.copyOf(cuisines));
        return out;
    }

    // ----------------------------------------------------------- candidates

    /**
     * The shortlist this room is rating, computed on first call and frozen
     * thereafter.
     *
     * Deliberately not {@code @Transactional}: the insert below must commit
     * (or fail) immediately so that two players racing to freeze the same
     * shortlist can be told apart here and now — inside a wider transaction
     * the unique-constraint violation would only surface at commit, past any
     * chance of handling it.
     */
    public List<FoodView> candidatesFor(String roomCode) {
        List<Candidate> existing = candidates.findByRoomCodeOrderByPositionAsc(roomCode);
        if (!existing.isEmpty()) {
            return orderAsShortlist(existing, foodClient.byIds(
                    existing.stream().map(Candidate::getFoodId).toList()));
        }

        @SuppressWarnings("unchecked")
        List<String> cuisines = (List<String>) aggregatePreferences(roomCode).get("cuisines");

        List<FoodView> found = foodClient.search(cuisines);
        if (found.isEmpty()) {
            // Same safety net as HBI Web: never show an empty rating screen.
            log.info("no food matched the preferences for room {}, falling back to the full catalogue", roomCode);
            found = foodClient.search(List.of());
        }

        List<FoodView> shortlist = found.stream().limit(shortlistSize).toList();
        List<Candidate> rows = new ArrayList<>();
        for (int i = 0; i < shortlist.size(); i++) {
            rows.add(new Candidate(roomCode, shortlist.get(i).id(), i + 1));
        }
        try {
            candidates.saveAll(rows);
        } catch (DataIntegrityViolationException e) {
            // Two players asked for the shortlist at the same moment and the
            // other insert won the freeze. Everyone must rate the same list,
            // so discard ours and return theirs.
            List<Candidate> frozen = candidates.findByRoomCodeOrderByPositionAsc(roomCode);
            log.info("shortlist for room {} was frozen concurrently, using the existing {} rows",
                    roomCode, frozen.size());
            return orderAsShortlist(frozen, foodClient.byIds(
                    frozen.stream().map(Candidate::getFoodId).toList()));
        }
        log.info("froze a shortlist of {} food items for room {}", shortlist.size(), roomCode);
        return shortlist;
    }

    private List<FoodView> orderAsShortlist(List<Candidate> order, List<FoodView> fetched) {
        Map<Long, FoodView> byId = fetched.stream()
                .collect(Collectors.toMap(FoodView::id, f -> f, (a, b) -> a));
        return order.stream().map(c -> byId.get(c.getFoodId()))
                .filter(Objects::nonNull).toList();
    }

    // -------------------------------------------------------------- ratings

    /**
     * Stores one player's score for one food item.
     *
     * The food must be on the room's frozen shortlist: a rating for anything
     * else is rejected, because bogus ids would otherwise count toward
     * "everyone has finished" and could force a group decision built on foods
     * nobody is actually rating.
     */
    @Transactional
    public Rating saveRating(String roomCode, Long userId, Long foodId, Integer score) {
        Set<Long> candidateIds = candidateIdsFreezingIfNeeded(roomCode);
        if (candidateIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This room has no shortlist to rate yet.");
        }
        if (!candidateIds.contains(foodId)) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Food " + foodId + " is not on this room's shortlist.");
        }

        Rating rating = ratings.findByRoomCodeAndUserIdAndFoodId(roomCode, userId, foodId)
                .orElseGet(() -> new Rating(roomCode, userId, foodId, score));
        rating.setScore(score);
        return ratings.save(rating);
    }

    public List<Rating> ratingsFor(String roomCode) {
        return ratings.findByRoomCode(roomCode);
    }

    private Set<Long> candidateIdsFreezingIfNeeded(String roomCode) {
        Set<Long> ids = candidates.findByRoomCodeOrderByPositionAsc(roomCode).stream()
                .map(Candidate::getFoodId).collect(Collectors.toSet());
        if (ids.isEmpty()) {
            // Acting before anyone fetched the shortlist: freeze it now, the
            // same way GET /candidates would have.
            ids = candidatesFor(roomCode).stream().map(FoodView::id).collect(Collectors.toSet());
        }
        return ids;
    }

    /**
     * How far through rating the group is, and what each side of the early
     * blend is allowed to do.
     *
     * A player counts as finished when they have rated the whole shortlist, or
     * when they pressed BLEND NOW after reaching the minimum. Only currently
     * active members count — someone who left neither blocks the room nor
     * pads the host's threshold.
     */
    public Map<String, Object> progress(String roomCode) {
        List<Member> active = roomClient.activeMembers(roomCode);
        Set<Long> activeIds = active.stream().map(Member::userId).collect(Collectors.toSet());

        Set<Long> candidateIds = candidates.findByRoomCodeOrderByPositionAsc(roomCode).stream()
                .map(Candidate::getFoodId).collect(Collectors.toSet());
        int shortlist = candidateIds.size();
        int minRequired = shortlist == 0 ? 0 : BlendPolicy.minRatingsRequired(shortlist);

        // Ratings for foods outside the shortlist must not count.
        List<Rating> all = ratings.findByRoomCode(roomCode).stream()
                .filter(r -> candidateIds.contains(r.getFoodId())).toList();
        Map<Long, Long> perUser = all.stream()
                .collect(Collectors.groupingBy(Rating::getUserId, Collectors.counting()));
        Set<Long> doneIds = playerDone.findByRoomCode(roomCode).stream()
                .map(PlayerDone::getUserId).collect(Collectors.toSet());

        List<Long> finishedIds = activeIds.stream()
                .filter(u -> {
                    long count = perUser.getOrDefault(u, 0L);
                    return shortlist > 0
                            && (count >= shortlist || (doneIds.contains(u) && count >= minRequired));
                })
                .sorted().toList();
        long eligible = activeIds.stream()
                .filter(u -> minRequired > 0 && perUser.getOrDefault(u, 0L) >= minRequired).count();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", roomCode);
        out.put("membersTotal", active.size());
        out.put("membersFinished", finishedIds.size());
        out.put("membersEligible", eligible);
        out.put("shortlistSize", shortlist);
        out.put("minRatingsRequired", minRequired);
        out.put("ratingsSubmitted", all.size());
        out.put("hostCanFinalize", BlendPolicy.hostMayFinalize(active.size(), (int) eligible));
        out.put("finishedUserIds", finishedIds);
        out.put("complete", !active.isEmpty() && shortlist > 0 && finishedIds.size() >= active.size());
        return out;
    }

    /** True once every active player has finished (fully rated or blended early). */
    public boolean everyoneHasFinished(String roomCode) {
        return Boolean.TRUE.equals(progress(roomCode).get("complete"));
    }

    // ------------------------------------------------------------ blend now

    /**
     * A player declares "I have rated enough — use my current ratings."
     * Only allowed once they have rated the minimum number of shortlist foods.
     * Idempotent: pressing BLEND NOW twice is one row.
     */
    public Map<String, Object> markPlayerDone(String roomCode, Long userId) {
        Set<Long> candidateIds = candidateIdsFreezingIfNeeded(roomCode);
        if (candidateIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This room has no shortlist to rate yet.");
        }
        int minRequired = BlendPolicy.minRatingsRequired(candidateIds.size());
        long mine = ratings.findByRoomCode(roomCode).stream()
                .filter(r -> r.getUserId().equals(userId) && candidateIds.contains(r.getFoodId()))
                .count();
        if (mine < minRequired) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Rate at least " + minRequired + " foods before blending (you have rated " + mine + ").");
        }
        try {
            playerDone.save(new PlayerDone(roomCode, userId));
        } catch (DataIntegrityViolationException e) {
            // Already marked done - fine, the outcome is identical.
        }
        log.info("player {} blended early in room {} after {} ratings", userId, roomCode, mine);
        return progress(roomCode);
    }

    // ------------------------------------------------------ recommendations

    /** Re-runs the scoring for a room and replaces the stored ranking. */
    @Transactional
    public List<ScoredFood> recomputeRecommendations(String roomCode) {
        List<FoodView> shortlist = candidatesFor(roomCode);
        if (shortlist.isEmpty()) {
            return List.of();
        }
        int members = Math.max(roomClient.activeMembers(roomCode).size(), 1);
        List<ScoredFood> scored = engine.score(shortlist,
                ratings.findByRoomCode(roomCode), preferences.findByRoomCode(roomCode), members);

        recommendations.deleteByRoomCode(roomCode);
        recommendations.flush();
        List<Recommendation> rows = new ArrayList<>();
        for (int i = 0; i < scored.size(); i++) {
            rows.add(new Recommendation(roomCode, scored.get(i).food().id(), i + 1, scored.get(i).score()));
        }
        recommendations.saveAll(rows);
        return scored;
    }

    /**
     * Scores the room right now and returns the ranking without storing it.
     *
     * Reads use this rather than the stored rows because the stored ranking is
     * written by the Kafka consumer and can therefore lag a rating that was
     * accepted moments ago — someone refreshing the page would see a stale
     * order. Scoring is deterministic and the shortlist is small, so
     * recomputing on read is cheaper than explaining the staleness.
     */
    public List<Map<String, Object>> liveRecommendations(String roomCode) {
        List<FoodView> shortlist = candidatesFor(roomCode);
        if (shortlist.isEmpty()) {
            return List.of();
        }
        int members = Math.max(roomClient.activeMembers(roomCode).size(), 1);
        List<ScoredFood> scored = engine.score(shortlist,
                ratings.findByRoomCode(roomCode), preferences.findByRoomCode(roomCode), members);

        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < scored.size(); i++) {
            ScoredFood s = scored.get(i);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rank", i + 1);
            m.put("score", s.score());
            m.put("food", s.food());
            m.put("groupRating", s.groupRating());
            m.put("ratingCount", s.ratingCount());
            out.add(m);
        }
        return out;
    }

    /** The stored ranking, hydrated with food details for the UI. */
    public List<Map<String, Object>> storedRecommendations(String roomCode) {
        List<Recommendation> rows = recommendations.findByRoomCodeOrderByPositionAsc(roomCode);
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<Long, FoodView> byId = foodClient
                .byIds(rows.stream().map(Recommendation::getFoodId).toList()).stream()
                .collect(Collectors.toMap(FoodView::id, f -> f, (a, b) -> a));

        return rows.stream().map(rec -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rank", rec.getPosition());
            m.put("score", rec.getScore());
            m.put("food", byId.get(rec.getFoodId()));
            m.put("generatedAt", rec.getGeneratedAt().toString());
            return m;
        }).toList();
    }

    // ------------------------------------------------------------- decision

    /**
     * The host cuts the blend short — allowed only once at least half of the
     * active players have rated the minimum. The threshold lives here, on the
     * server, so no amount of frontend creativity can bypass it. Once a room
     * has decided, the check is skipped and the existing decision is returned,
     * which keeps repeated calls harmless.
     *
     * Transactional at this level because {@link #finalise} and
     * {@link #recomputeRecommendations} are reached by self-invocation here,
     * which bypasses the proxy — without a transaction opened at the entry
     * point, the derived delete inside the re-score has no transaction to
     * join and the request fails once a stored ranking exists.
     */
    @Transactional
    public Map<String, Object> hostFinalise(String roomCode) {
        Optional<Decision> already = decisions.findByRoomCode(roomCode);
        if (already.isPresent()) {
            return decisionView(already.get());
        }

        Map<String, Object> progress = progress(roomCode);
        if (!Boolean.TRUE.equals(progress.get("hostCanFinalize"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Not enough players have rated yet - at least half of the active players must rate "
                            + progress.get("minRatingsRequired") + " foods first.");
        }
        return finalise(roomCode, "HOST")
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT,
                        "Nothing to decide yet - submit some ratings first."));
    }

    /**
     * Locks in the top-ranked food. Idempotent: once a room has decided,
     * the existing decision is returned unchanged.
     */
    @Transactional
    public Optional<Map<String, Object>> finalise(String roomCode, String decidedBy) {
        Optional<Decision> already = decisions.findByRoomCode(roomCode);
        if (already.isPresent()) {
            return already.map(this::decisionView);
        }

        List<ScoredFood> scored = recomputeRecommendations(roomCode);
        if (scored.isEmpty()) {
            return Optional.empty();
        }
        ScoredFood winner = scored.get(0);
        Decision decision;
        try {
            decision = decisions.save(
                    new Decision(roomCode, winner.food().id(), winner.score(), decidedBy));
        } catch (DataIntegrityViolationException e) {
            // Two finalisations raced (say, host force and the AUTO consumer);
            // the unique room_code constraint kept it to one row. Return it.
            return decisions.findByRoomCode(roomCode).map(this::decisionView);
        }
        log.info("room {} decided on {} (score {})", roomCode, winner.food().name(), winner.score());

        // Tell the room service, which owns room state, that this blend is
        // over so it can move the room to DECIDED and stop admitting players.
        events.decisionFinalized(roomCode, winner.food().id(), decidedBy);
        return Optional.of(decisionView(decision));
    }

    public Optional<Map<String, Object>> decisionFor(String roomCode) {
        return decisions.findByRoomCode(roomCode).map(this::decisionView);
    }

    /**
     * Removes everything this service stored for a room the room service has
     * garbage-collected. Safe to call repeatedly: every delete is a no-op the
     * second time.
     */
    @Transactional
    public void purgeRoom(String roomCode) {
        preferences.deleteByRoomCode(roomCode);
        ratings.deleteByRoomCode(roomCode);
        candidates.deleteByRoomCode(roomCode);
        recommendations.deleteByRoomCode(roomCode);
        decisions.deleteByRoomCode(roomCode);
        playerDone.deleteByRoomCode(roomCode);
        log.info("purged rating data for deleted room {}", roomCode);
    }

    private Map<String, Object> decisionView(Decision d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("roomId", d.getRoomCode());
        m.put("foodId", d.getFoodId());
        m.put("finalScore", d.getFinalScore());
        m.put("decidedBy", d.getDecidedBy());
        m.put("decidedAt", d.getDecidedAt().toString());
        m.put("food", foodClient.byIds(List.of(d.getFoodId())).stream().findFirst().orElse(null));
        return m;
    }
}

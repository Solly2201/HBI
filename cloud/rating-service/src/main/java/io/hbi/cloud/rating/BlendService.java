package io.hbi.cloud.rating;

import io.hbi.cloud.rating.Entities.Candidate;
import io.hbi.cloud.rating.Entities.Decision;
import io.hbi.cloud.rating.Entities.Preference;
import io.hbi.cloud.rating.Entities.Rating;
import io.hbi.cloud.rating.Entities.Recommendation;
import io.hbi.cloud.rating.RecommendationEngine.ScoredRestaurant;
import io.hbi.cloud.rating.RestaurantClient.RestaurantView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The HBI blend, server side: preferences in, a restaurant out.
 */
@Service
public class BlendService {

    private static final Logger log = LoggerFactory.getLogger(BlendService.class);

    private final PreferenceRepository preferences;
    private final RatingRepository ratings;
    private final RecommendationRepository recommendations;
    private final DecisionRepository decisions;
    private final CandidateRepository candidates;
    private final RestaurantClient restaurantClient;
    private final RoomClient roomClient;
    private final RecommendationEngine engine;
    private final RatingEventPublisher events;
    private final int shortlistSize;

    public BlendService(PreferenceRepository preferences,
                        RatingRepository ratings,
                        RecommendationRepository recommendations,
                        DecisionRepository decisions,
                        CandidateRepository candidates,
                        RestaurantClient restaurantClient,
                        RoomClient roomClient,
                        RecommendationEngine engine,
                        RatingEventPublisher events,
                        @Value("${hbi.blend.shortlist-size:8}") int shortlistSize) {
        this.preferences = preferences;
        this.ratings = ratings;
        this.recommendations = recommendations;
        this.decisions = decisions;
        this.candidates = candidates;
        this.restaurantClient = restaurantClient;
        this.roomClient = roomClient;
        this.engine = engine;
        this.events = events;
        this.shortlistSize = shortlistSize;
    }

    // ---------------------------------------------------------------- prefs

    @Transactional
    public Preference savePreference(String roomCode, Long userId, List<String> cuisines,
                                     Integer maxBudget, Double maxDistanceKm) {
        Preference pref = preferences.findByRoomCodeAndUserId(roomCode, userId)
                .orElseGet(() -> new Preference(roomCode, userId));
        pref.setCuisines(cuisines);
        pref.setMaxBudget(maxBudget);
        pref.setMaxDistanceKm(maxDistanceKm);
        pref.touch();
        return preferences.save(pref);
    }

    public List<Preference> preferencesFor(String roomCode) {
        return preferences.findByRoomCode(roomCode);
    }

    /** Union of everyone's cuisines, and the most generous budget/distance in the room. */
    public Map<String, Object> aggregatePreferences(String roomCode) {
        List<Preference> all = preferences.findByRoomCode(roomCode);
        Set<String> cuisines = new LinkedHashSet<>();
        all.forEach(p -> cuisines.addAll(p.cuisineList()));

        Integer budget = all.stream().map(Preference::getMaxBudget)
                .filter(java.util.Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
        Double distance = all.stream().map(Preference::getMaxDistanceKm)
                .filter(java.util.Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", roomCode);
        out.put("submittedBy", all.size());
        out.put("cuisines", List.copyOf(cuisines));
        out.put("maxBudget", budget);
        out.put("maxDistanceKm", distance);
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
    public List<RestaurantView> candidatesFor(String roomCode) {
        List<Candidate> existing = candidates.findByRoomCodeOrderByPositionAsc(roomCode);
        if (!existing.isEmpty()) {
            return orderAsShortlist(existing, restaurantClient.byIds(
                    existing.stream().map(Candidate::getRestaurantId).toList()));
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> agg = aggregatePreferences(roomCode);
        List<String> cuisines = (List<String>) agg.get("cuisines");
        Integer budget = (Integer) agg.get("maxBudget");
        Double distance = (Double) agg.get("maxDistanceKm");

        List<RestaurantView> found = restaurantClient.search(cuisines, budget, distance);
        if (found.isEmpty()) {
            // Same safety net as HBI Web: never show an empty rating screen.
            log.info("no restaurant matched the preferences for room {}, falling back to the full catalogue", roomCode);
            found = restaurantClient.search(List.of(), null, null);
        }

        List<RestaurantView> shortlist = found.stream().limit(shortlistSize).toList();
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
            return orderAsShortlist(frozen, restaurantClient.byIds(
                    frozen.stream().map(Candidate::getRestaurantId).toList()));
        }
        log.info("froze a shortlist of {} restaurants for room {}", shortlist.size(), roomCode);
        return shortlist;
    }

    private List<RestaurantView> orderAsShortlist(List<Candidate> order, List<RestaurantView> fetched) {
        Map<Long, RestaurantView> byId = fetched.stream()
                .collect(Collectors.toMap(RestaurantView::id, r -> r, (a, b) -> a));
        return order.stream().map(c -> byId.get(c.getRestaurantId()))
                .filter(java.util.Objects::nonNull).toList();
    }

    // -------------------------------------------------------------- ratings

    /**
     * Stores one player's score for one restaurant.
     *
     * The restaurant must be on the room's frozen shortlist: a rating for
     * anything else is rejected, because bogus ids would otherwise count
     * toward "everyone has finished" and could force a group decision built
     * on restaurants nobody is actually rating.
     */
    @Transactional
    public Rating saveRating(String roomCode, Long userId, Long restaurantId, Integer score) {
        Set<Long> candidateIds = candidates.findByRoomCodeOrderByPositionAsc(roomCode).stream()
                .map(Candidate::getRestaurantId).collect(Collectors.toSet());
        if (candidateIds.isEmpty()) {
            // Rating before anyone fetched the shortlist: freeze it now, the
            // same way GET /candidates would have.
            candidateIds = candidatesFor(roomCode).stream()
                    .map(RestaurantView::id).collect(Collectors.toSet());
        }
        if (candidateIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This room has no shortlist to rate yet.");
        }
        if (!candidateIds.contains(restaurantId)) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Restaurant " + restaurantId + " is not on this room's shortlist.");
        }

        Rating rating = ratings.findByRoomCodeAndUserIdAndRestaurantId(roomCode, userId, restaurantId)
                .orElseGet(() -> new Rating(roomCode, userId, restaurantId, score));
        rating.setScore(score);
        return ratings.save(rating);
    }

    public List<Rating> ratingsFor(String roomCode) {
        return ratings.findByRoomCode(roomCode);
    }

    /** How far through rating the group is. Only shortlist ratings count. */
    public Map<String, Object> progress(String roomCode) {
        int members = roomClient.activeMembers(roomCode).size();
        Set<Long> candidateIds = candidates.findByRoomCodeOrderByPositionAsc(roomCode).stream()
                .map(Candidate::getRestaurantId).collect(Collectors.toSet());
        int shortlist = candidateIds.size();
        // Ratings for restaurants outside the shortlist (possible in data
        // written before validation existed) must not count toward completion.
        List<Rating> all = ratings.findByRoomCode(roomCode).stream()
                .filter(r -> candidateIds.contains(r.getRestaurantId())).toList();

        Map<Long, Long> perUser = all.stream()
                .collect(Collectors.groupingBy(Rating::getUserId, Collectors.counting()));
        long finished = shortlist == 0 ? 0 : perUser.values().stream().filter(c -> c >= shortlist).count();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roomId", roomCode);
        out.put("membersTotal", members);
        out.put("membersFinished", finished);
        out.put("shortlistSize", shortlist);
        out.put("ratingsSubmitted", all.size());
        out.put("complete", members > 0 && shortlist > 0 && finished >= members);
        return out;
    }

    /** True once every active player has rated every restaurant on the shortlist. */
    public boolean everyoneHasFinished(String roomCode) {
        return Boolean.TRUE.equals(progress(roomCode).get("complete"));
    }

    // ------------------------------------------------------ recommendations

    /** Re-runs the scoring for a room and replaces the stored ranking. */
    @Transactional
    public List<ScoredRestaurant> recomputeRecommendations(String roomCode) {
        List<RestaurantView> shortlist = candidatesFor(roomCode);
        if (shortlist.isEmpty()) {
            return List.of();
        }
        int members = Math.max(roomClient.activeMembers(roomCode).size(), 1);
        List<ScoredRestaurant> scored = engine.score(shortlist,
                ratings.findByRoomCode(roomCode), preferences.findByRoomCode(roomCode), members);

        recommendations.deleteByRoomCode(roomCode);
        recommendations.flush();
        List<Recommendation> rows = new ArrayList<>();
        for (int i = 0; i < scored.size(); i++) {
            rows.add(new Recommendation(roomCode, scored.get(i).restaurant().id(), i + 1, scored.get(i).score()));
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
        List<RestaurantView> shortlist = candidatesFor(roomCode);
        if (shortlist.isEmpty()) {
            return List.of();
        }
        int members = Math.max(roomClient.activeMembers(roomCode).size(), 1);
        List<ScoredRestaurant> scored = engine.score(shortlist,
                ratings.findByRoomCode(roomCode), preferences.findByRoomCode(roomCode), members);

        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < scored.size(); i++) {
            ScoredRestaurant s = scored.get(i);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rank", i + 1);
            m.put("score", s.score());
            m.put("restaurant", s.restaurant());
            m.put("groupRating", s.groupRating());
            m.put("ratingCount", s.ratingCount());
            out.add(m);
        }
        return out;
    }

    /** The stored ranking, hydrated with restaurant details for the UI. */
    public List<Map<String, Object>> storedRecommendations(String roomCode) {
        List<Recommendation> rows = recommendations.findByRoomCodeOrderByPositionAsc(roomCode);
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<Long, RestaurantView> byId = restaurantClient
                .byIds(rows.stream().map(Recommendation::getRestaurantId).toList()).stream()
                .collect(Collectors.toMap(RestaurantView::id, r -> r, (a, b) -> a));

        return rows.stream().map(rec -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rank", rec.getPosition());
            m.put("score", rec.getScore());
            m.put("restaurant", byId.get(rec.getRestaurantId()));
            m.put("generatedAt", rec.getGeneratedAt().toString());
            return m;
        }).toList();
    }

    // ------------------------------------------------------------- decision

    /**
     * Locks in the top-ranked restaurant. Idempotent: once a room has decided,
     * the existing decision is returned unchanged.
     */
    @Transactional
    public Optional<Map<String, Object>> finalise(String roomCode, String decidedBy) {
        Optional<Decision> already = decisions.findByRoomCode(roomCode);
        if (already.isPresent()) {
            return already.map(this::decisionView);
        }

        List<ScoredRestaurant> scored = recomputeRecommendations(roomCode);
        if (scored.isEmpty()) {
            return Optional.empty();
        }
        ScoredRestaurant winner = scored.get(0);
        Decision decision = decisions.save(
                new Decision(roomCode, winner.restaurant().id(), winner.score(), decidedBy));
        log.info("room {} decided on {} (score {})", roomCode, winner.restaurant().name(), winner.score());

        // Tell the room service, which owns room state, that this blend is
        // over so it can move the room to DECIDED and stop admitting players.
        events.decisionFinalized(roomCode, winner.restaurant().id(), decidedBy);
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
        log.info("purged rating data for deleted room {}", roomCode);
    }

    private Map<String, Object> decisionView(Decision d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("roomId", d.getRoomCode());
        m.put("restaurantId", d.getRestaurantId());
        m.put("finalScore", d.getFinalScore());
        m.put("decidedBy", d.getDecidedBy());
        m.put("decidedAt", d.getDecidedAt().toString());
        m.put("restaurant", restaurantClient.byIds(List.of(d.getRestaurantId())).stream().findFirst().orElse(null));
        return m;
    }
}
